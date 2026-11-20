/**
 * POST /api/pipeline/run — 选股流水线全流程
 *
 * Phase 0 regime → Phase 1 初筛 → Phase 2 深度评估（五路 Agent）→ 最终合成 + 行业分散
 *
 * 纯扶摇数据源：快照/名称/流通市值/行业/竞价/估值/财务/K线/涨跌停池 全部来自扶摇。
 * 任何一步失败都不 500 —— 降级为中性值并在 message 中说明。
 */
import { NextRequest, NextResponse } from "next/server";
import {
  Announcement,
  DEFAULT_ENGINE_CONFIG,
  EngineConfig,
  ScoredStock,
  StockContext,
} from "@/lib/types";
import { judgeRegime } from "@/lib/engine/regime";
import { phase1Filter, isSTName } from "@/lib/engine/phase1";
import { scoreEthan } from "@/lib/engine/ethan";
import { scoreLucas } from "@/lib/engine/lucas";
import { scoreEdwin } from "@/lib/engine/edwin";
import { scoreSophia } from "@/lib/engine/sophia";
import { scoreT0 } from "@/lib/engine/t0";
import { buildScoredStock, diversify, scoreMia } from "@/lib/engine/final";
import { cached, clearMarketCache, endOfDayTTL, inAuctionWindow } from "@/lib/cache";
import {
  deriveVolumeExpansion,
  deriveVolumeRatio,
  derivePeriodReturn,
  rankPctByAmount,
} from "@/lib/data/derive";
import { loadMarket, loadSectorPerformance, loadTradingDays, loadValuations } from "@/lib/data/market";
import {
  deriveBenchmarkSectors,
  getAnomaly,
  getAuctionBenchmark,
  getAuctionSnapshot,
  getKline,
  getLimitDownTotal,
  getLimitUpPool,
  prevTradingDayMs,
} from "@/lib/providers/fuyao";
import { requireFuyaoCtx } from "@/lib/api-guard";
import { recordPicks } from "@/lib/journal";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** T0 中性结果（无竞价数据时段落中性 1.0） */
const T0_NEUTRAL = { t0: 1, catalyst: 1, safety: 1, confirm: 1 };

/** 并发池 */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

/** 前日振幅 % */
function prevAmplitudeFromKline(ctx: StockContext): number | undefined {
  const k = ctx.kline ? [...ctx.kline].sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
  if (k.length < 2) return undefined;
  const last = k[k.length - 1];
  const prevClose = k[k.length - 2].close;
  return prevClose > 0 ? ((last.high - last.low) / prevClose) * 100 : undefined;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const guard = await requireFuyaoCtx();
    if (!guard.ok || !guard.ctx) {
      return guard.response ?? NextResponse.json({ error: "未授权" }, { status: 401 });
    }
    const ctx = guard.ctx;

    const body = (await req.json().catch(() => ({}))) as Partial<EngineConfig> & { enrichLimit?: number };
    const cfg: EngineConfig = {
      ...DEFAULT_ENGINE_CONFIG,
      ...body,
      topN: ([4, 8, 12].includes(body.topN as number) ? body.topN : 8) as 4 | 8 | 12,
    };
    const enrichLimit = Math.min(Math.max(body.enrichLimit ?? 40, 0), 120);

    // ---- Phase 0：快照 + regime ----
    const auctionWindow = inAuctionWindow();
    if (auctionWindow) await clearMarketCache();
    const market = await loadMarket(ctx);
    const snap = market;
    if (snap.quotes.length === 0) {
      return NextResponse.json({
        results: [], vetoed: [], regime: null, stats: null, topN: cfg.topN,
        config: cfg, degraded: true, source: snap.source, t0Neutral: true,
        message: snap.message ?? "无快照数据，流水线中止",
        elapsedMs: Date.now() - startedAt,
      });
    }

    const openPcts = snap.quotes
      .filter((q) => q.preClose > 0 && q.open > 0)
      .map((q) => (q.open / q.preClose - 1) * 100);
    const up = snap.quotes.filter((q) => q.pct > 0).length;
    const down = snap.quotes.filter((q) => q.pct < 0).length;
    const limitUpCount = snap.quotes.filter((q) => q.pct >= 9.8).length;
    const limitDownCount = snap.quotes.filter((q) => q.pct <= -9.8).length;
    const stockAdvRatio = down > 0 ? up / down : up > 0 ? 1 : undefined;

    // 板块涨跌比：基于行业板块涨幅
    const sectorPctMap = market.industryMap
      ? await loadSectorPerformance(ctx, market.industryMap)
      : new Map<string, number>();
    let sectorUp = 0;
    let sectorDown = 0;
    for (const v of sectorPctMap.values()) {
      if (v > 0) sectorUp++;
      else if (v < 0) sectorDown++;
    }
    const sectorAdvRatio = sectorDown > 0 ? sectorUp / sectorDown : sectorUp > 0 ? 1 : undefined;

    const regime = judgeRegime({
      openPcts,
      limitDownCount,
      stockAdvRatio,
      sectorAdvRatio,
      overnightIdxAvg:
        typeof (body as Record<string, unknown>).overnight === "number"
          ? (body as Record<string, number>).overnight
          : null,
    });

    // ---- 辅助数据 ----
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const tradingDays = await loadTradingDays(ctx);
    const prevDayMs = prevTradingDayMs(tradingDays);
    const [todayPool, prevPool, benchmark, limitDownTotal] = await Promise.all([
      cached("limit_up_pool_today", endOfDayTTL(), () => getLimitUpPool(ctx)),
      cached(`limit_up_pool_${prevDayMs}`, endOfDayTTL(), () => getLimitUpPool(ctx, prevDayMs)),
      cached(`auction_benchmark_${today}`, endOfDayTTL(), () => getAuctionBenchmark(ctx)),
      cached("limit_down_total", 10 * 60 * 1000, () => getLimitDownTotal(ctx)),
    ]);

    const stCodes = new Set<string>();
    for (const it of todayPool?.items ?? []) if (it.isSt) stCodes.add(it.code);
    const prevLimitUpSet = new Set((prevPool?.items ?? []).map((i) => i.code));
    const streakMap = new Map(
      (todayPool?.items ?? []).filter((i) => i.streak !== undefined).map((i) => [i.code, i.streak as number])
    );
    const reasonMap = new Map(
      (todayPool?.items ?? []).filter((i) => i.reason).map((i) => [i.code, i.reason as string])
    );
    const sectors = benchmark ? deriveBenchmarkSectors(benchmark) : null;

    // ---- Phase 1 初筛 ----
    // 注：量比由 K 线推导，需在初筛前对候选股补 K 线 —— 这里先按可得字段过滤，
    // 再对较大的一批（phase1Limit × 2.5）拉 K 线补量比后二次过滤。
    const preCfg: EngineConfig = { ...cfg, minVolumeRatio: 0 };
    const pre = phase1Filter(snap.quotes, stCodes, preCfg);
    const candidatePool = pre.pool.slice(0, Math.min(cfg.phase1Limit * 2.5, 500));

    // ---- 候选股批量数据：竞价快照 + 估值 ----
    const poolCodes = candidatePool.map((q) => q.code);
    const [auctionMap, valuations] = await Promise.all([
      cached(`auction_snap_${today}_${poolCodes.length}`, 30 * 60 * 1000, () => getAuctionSnapshot(ctx, poolCodes)),
      loadValuations(ctx, poolCodes),
    ]);
    const t0Neutral = !auctionMap || auctionMap.size === 0;

    // 竞价抢筹金额分位（候选池内，越小越靠前）
    const grabRankPct = new Map<string, number>();
    if (auctionMap) {
      const amounts = new Map<string, number>();
      for (const [code, a] of auctionMap) if (a.auctionAmount) amounts.set(code, a.auctionAmount);
      for (const [code, pct] of rankPctByAmount(amounts)) grabRankPct.set(code, pct);
    }

    // 估值/名称回填
    if (valuations) {
      for (const q of candidatePool) {
        const v = valuations.get(q.code);
        if (!v) continue;
        q.pe = q.pe ?? v.pe;
        q.pb = q.pb ?? v.pb;
        q.name = q.name ?? v.name;
      }
    }

    // ---- 补 K 线：推导量比 / 60 日涨幅 / 前日振幅 / 量能扩张 ----
    const enrichTargets = candidatePool.slice(0, Math.min(candidatePool.length, Math.max(enrichLimit, cfg.phase1Limit)));
    await mapLimit(enrichTargets, 6, async (q) => {
      const bars = await cached(`kline_${q.code}`, endOfDayTTL(), () => getKline(ctx, q.code));
      if (!bars) return;
      q.klineCache = bars;
      q.volumeRatio = deriveVolumeRatio(q.volume, bars);
      q.pct60 = derivePeriodReturn(bars, 60);
    });

    // 用推导出的量比二次过滤（真正的 Phase1 过滤）
    const p1 = phase1Filter(
      candidatePool.map((q) => ({ ...q, klineCache: undefined })),
      stCodes,
      cfg
    );
    const pool = p1.pool.slice(0, cfg.phase1Limit);

    // ---- 板块共振上下文聚合 ----
    const byIndustry = new Map<string, typeof pool>();
    for (const q of pool) {
      const ind = q.industry || "未知";
      if (!byIndustry.has(ind)) byIndustry.set(ind, []);
      byIndustry.get(ind)!.push(q);
    }
    const sectorCtxOf = (code: string, industry?: string) => {
      const ind = industry || "未知";
      const peers = byIndustry.get(ind) ?? [];
      const rank = peers.findIndex((p) => p.code === code) + 1;
      const sectorPct =
        sectorPctMap.get(ind) ??
        (peers.length > 0 ? peers.reduce((s, p) => s + p.pct, 0) / peers.length : 0);
      return {
        peersSelected: peers.length,
        rankInSector: rank > 0 ? rank : 99,
        sectorPct,
        hotSector: sectors?.hot.has(ind) ?? false,
        weakSector: sectors?.weak.has(ind) ?? false,
      };
    };

    // ---- 构建 Phase 2 上下文 ----
    const contexts: StockContext[] = pool.map((q) => {
      const a = auctionMap?.get(q.code);
      const bench = benchmark?.get(q.code);
      const openPct = a?.auctionPct ?? (q.preClose > 0 ? (q.open / q.preClose - 1) * 100 : 0);
      if (!q.name && a?.name) q.name = a.name;
      let rankPct = grabRankPct.get(q.code);
      if (bench && bench.tags.some((t) => t === "放量" || t === "高开")) {
        rankPct = rankPct !== undefined ? rankPct * 0.3 : 0.1;
      }
      const kline = q.klineCache;
      return {
        quote: q,
        isST: stCodes.has(q.code) || isSTName(q.name),
        prevLimitUp: prevLimitUpSet.has(q.code),
        streak: streakMap.get(q.code),
        kline,
        auction: {
          grabAmount: a?.auctionAmount,
          grabRankPct: rankPct,
          auctionVolRatio: a?.auctionVolRatio ?? (q.volumeRatio > 0 ? q.volumeRatio : undefined),
          auctionTurnoverPct: a?.auctionTurnoverPct,
          floatMcap: a?.floatMcap,
          openPct,
        },
        capital: {
          volumeExpansion: deriveVolumeExpansion(kline),
          grabRankPct: rankPct,
          streak: streakMap.get(q.code),
          auctionVolRatio: a?.auctionVolRatio,
        },
        sectorCtx: sectorCtxOf(q.code, q.industry),
      };
    });

    // ---- 异动原因（催化剂）批量 ----
    const anomalyMap = await cached(`anomaly_${today}_${contexts.length}`, endOfDayTTL(), () =>
      getAnomaly(ctx, contexts.map((c) => c.quote.code))
    );
    for (const c of contexts) {
      const an = anomalyMap?.get(c.quote.code);
      const reason = reasonMap.get(c.quote.code);
      const title = an ? `${an.tags.join(" ")} ${an.reason}`.slice(0, 300) : "";
      if (title || reason) {
        const anns: Announcement[] = [
          { time: today, title: reason ? `${reason}；${title}` : title },
        ];
        c.announcements = anns;
      }
    }

    // ---- 财务指标（Edwin 基本面，限前 50 只） ----
    await mapLimit(contexts.slice(0, 50), 5, async (c) => {
      const fin = await cached(`fin_${c.quote.code}`, endOfDayTTL(), () =>
        import("@/lib/providers/fuyao").then((m) => m.getFinance(ctx, c.quote.code))
      );
      if (fin) c.finance = fin;
    });

    for (const c of contexts) {
      if (c.prevAmplitude === undefined) c.prevAmplitude = prevAmplitudeFromKline(c);
    }

    // ---- Phase 2 评分 + 最终合成 ----
    const scored: ScoredStock[] = [];
    let scoreErrors = 0;
    for (const c of contexts) {
      try {
        const ethan = scoreEthan(c);
        const lucas = scoreLucas(c);
        const edwin = scoreEdwin(c, regime.regime);
        const sophia = scoreSophia(c);
        const mia = scoreMia(c, regime.tm);
        const t0 = t0Neutral
          ? T0_NEUTRAL
          : scoreT0({
              grabRankPct: c.auction?.grabRankPct,
              openPct: c.auction?.openPct ?? 0,
              auctionVolRatio: c.auction?.auctionVolRatio,
              pct: c.quote.pct,
            });
        const stock = buildScoredStock(
          c,
          { ethan, lucas, edwin, sophia: { score: sophia.score, details: sophia.details }, mia },
          regime.weights,
          t0,
          sophia
        );
        if (t0Neutral) stock.t0Neutral = true;
        scored.push(stock);
      } catch {
        scoreErrors++;
      }
    }

    const alive = scored.filter((s) => !s.vetoed);
    const vetoed = scored.filter((s) => s.vetoed).slice(0, 20);
    const results = diversify(alive, cfg.topN);

    // 记录当日选股（仅实时源 + 竞价窗口 + 工作日）
    try {
      const dow = new Date(Date.now() + 8 * 3600 * 1000).getUTCDay();
      if (snap.tradeDate && auctionWindow && !snap.degraded && dow >= 1 && dow <= 5) {
        await recordPicks(snap.tradeDate, results.map((s) => ({
          code: s.code, name: s.name, industry: s.industry,
          finalScore: s.finalScore, openPct: s.openPct,
        })));
      }
    } catch {
      // 日志失败不影响主流程
    }

    return NextResponse.json({
      results,
      vetoed,
      regime: {
        tm: Math.round(regime.tm * 1000) / 1000,
        regime: regime.regime,
        label: regime.label,
        confirms: regime.confirms,
        weights: regime.weights,
        stats: {
          sampleSize: openPcts.length,
          upCount: up,
          downCount: down,
          limitUpCount,
          limitDownCount: limitDownCount ?? 0,
          stockAdvRatio: stockAdvRatio !== undefined ? Math.round(stockAdvRatio * 1000) / 1000 : null,
        },
        emotion: null,
        source: snap.source,
        degraded: snap.degraded,
        tradeDate: snap.tradeDate,
      },
      stats: {
        phase1: p1.stats,
        poolSize: pool.length,
        enriched: enrichTargets.length,
        aliveCount: alive.length,
        vetoCount: scored.length - alive.length,
        scoreErrors,
        auctionMatched: auctionMap?.size ?? 0,
        benchmarkSize: benchmark?.size ?? 0,
        industryMapped: market.industryMap?.mapped ?? 0,
      },
      topN: cfg.topN,
      config: cfg,
      source: snap.source,
      degraded: snap.degraded || t0Neutral,
      t0Neutral,
      message: snap.message ?? (t0Neutral ? "竞价数据不可用，T0 已落中性 1.0" : undefined),
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err) {
    return NextResponse.json({
      results: [], vetoed: [], regime: null, stats: null,
      degraded: true, source: "neutral", t0Neutral: true,
      message: `流水线异常：${err instanceof Error ? err.message : String(err)}`,
      elapsedMs: Date.now() - startedAt,
    });
  }
}
