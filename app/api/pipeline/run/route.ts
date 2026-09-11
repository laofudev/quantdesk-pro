/**
 * POST /api/pipeline/run — 选股流水线全流程
 * Phase 0 regime → Phase 1 初筛 → Phase 2 深度评估 → 最终合成 + 行业分散
 * 数据装配（SPEC-fuyao 第 2/3 节）：扶摇为主源（快照/竞价/涨跌停池/估值/财务/异动），
 * 行业归属与资金流向用 Tushare（stock_basic / moneyflow），其余降级 Tushare → 中性值，绝不 500。
 */
import { NextRequest, NextResponse } from "next/server";
import { Announcement, DEFAULT_ENGINE_CONFIG, EngineConfig, ScoredStock, StockContext } from "@/lib/types";
import { judgeRegime, resolvePresetWeights } from "@/lib/engine/regime";
import { phase1Filter, isSTName } from "@/lib/engine/phase1";
import { scoreEthan } from "@/lib/engine/ethan";
import { scoreLucas } from "@/lib/engine/lucas";
import { scoreEdwin } from "@/lib/engine/edwin";
import { scoreSophia } from "@/lib/engine/sophia";
import { scoreT0 } from "@/lib/engine/t0";
import { buildScoredStock, diversify, scoreMia } from "@/lib/engine/final";
import { cached, clearMarketCache, endOfDayTTL, inAuctionWindow } from "@/lib/cache";
import {
  deriveBenchmarkSectors,
  FuyaoAuction,
  getFuyaoAnomaly,
  getFuyaoAuction,
  getFuyaoBenchmark,
  getFuyaoFinance,
  getFuyaoKline,
  getFuyaoLimitUpPool,
  getFuyaoTradingDays,
  getFuyaoValuations,
  getThsIndexList,
  getThsIndexSnapshot,
  prevTradingDayMs,
} from "@/lib/providers/fuyao";
import { getDailyKline, getMoneyflow } from "@/lib/providers/tushare";
import { loadSnapshot } from "@/lib/snapshot";
import { recordPicks } from "@/lib/journal";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** T0 中性结果（无竞价数据时段落中性 1.0，标注 t0Neutral） */
const T0_NEUTRAL = { t0: 1, catalyst: 1, safety: 1, confirm: 1 };

/** 单只股票深度数据充实：K线（扶摇→Tushare）/资金流（Tushare moneyflow 主源）/财务（扶摇，限前50只），全部 allSettled，失败即中性 */
async function enrichContext(ctx: StockContext, withFinance: boolean): Promise<void> {
  const code = ctx.quote.code;
  const [kline, flow, fin] = await Promise.allSettled([
    cached(`kline_${code}`, endOfDayTTL(), async () =>
      (await getFuyaoKline(code)) ?? (await getDailyKline(code))
    ),
    cached(`flow_${code}`, endOfDayTTL(), () => getMoneyflow(code, 5)),
    withFinance
      ? cached(`fin_${code}`, endOfDayTTL(), () => getFuyaoFinance(code))
      : Promise.resolve(null),
  ]);
  if (kline.status === "fulfilled" && kline.value) ctx.kline = kline.value;
  if (flow.status === "fulfilled" && flow.value) ctx.moneyFlow = flow.value;
  if (fin.status === "fulfilled" && fin.value) ctx.finance = fin.value;
}

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

/** 前日振幅 %：K 线最后一根 (high-low)/前收 */
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
    const body = (await req.json().catch(() => ({}))) as Partial<EngineConfig> & { enrichLimit?: number };
    const cfg: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, ...body, topN: ([4, 8, 12].includes(body.topN as number) ? body.topN : 8) as 4 | 8 | 12 };
    const enrichLimit = Math.min(Math.max(body.enrichLimit ?? 30, 0), 80);

    // ---- Phase 0：快照 + regime ----
    // 竞价买入窗口（09:25–09:35）内强制清行情缓存重拉，防止用到 9:20 前后的
    // 意向竞价数据（快照 10 分钟缓存未过期）或当日首次访问冻结的竞价风向标/涨停池
    const auctionWindow = inAuctionWindow();
    if (auctionWindow) await clearMarketCache();
    const snap = await loadSnapshot();
    if (snap.quotes.length === 0) {
      return NextResponse.json({
        results: [], vetoed: [], regime: null, stats: null, topN: cfg.topN,
        degraded: true, source: snap.source,
        message: snap.message ?? "无快照数据，流水线中止",
      });
    }
    const openPcts = snap.quotes.filter((q) => q.preClose > 0 && q.open > 0).map((q) => (q.open / q.preClose - 1) * 100);
    const up = snap.quotes.filter((q) => q.pct > 0).length;
    const down = snap.quotes.filter((q) => q.pct < 0).length;
    const limitUpCount = snap.quotes.filter((q) => q.pct >= 9.8).length;
    const limitDownCount = snap.quotes.filter((q) => q.pct <= -9.8).length;
    const stockAdvRatio = down > 0 ? up / down : up > 0 ? 1 : undefined;
    const preset = await resolvePresetWeights();
    const regime = judgeRegime({
      openPcts,
      limitDownCount,
      stockAdvRatio,
      overnightIdxAvg: body && typeof (body as Record<string, unknown>).overnight === "number" ? (body as Record<string, number>).overnight : null,
    }, preset);

    // ---- 辅助数据（全部可降级）：交易日历 / 当日涨停池（ST+连板+原因）/ 前日涨停池 / 竞价风向标 ----
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const tradingDays = await cached("trading_days", endOfDayTTL(), () => getFuyaoTradingDays());
    const prevDayMs = prevTradingDayMs(tradingDays);
    const [todayPool, prevPool, benchmark] = await Promise.all([
      cached("limit_up_pool_today", endOfDayTTL(), () => getFuyaoLimitUpPool()),
      cached(`limit_up_pool_${prevDayMs}`, endOfDayTTL(), () => getFuyaoLimitUpPool(prevDayMs)),
      cached(`auction_benchmark_${today}`, endOfDayTTL(), () => getFuyaoBenchmark()),
    ]);
    // ST 名单：涨停池 is_st 字段 + Tushare stock_basic 名称含 ST/退（名称已在快照合并，此处补充池内标记）
    const stCodes = new Set<string>();
    for (const it of todayPool?.items ?? []) if (it.isSt) stCodes.add(it.code);
    const prevLimitUpSet = new Set((prevPool?.items ?? []).map((i) => i.code));
    const streakMap = new Map((todayPool?.items ?? []).filter((i) => i.streak !== undefined).map((i) => [i.code, i.streak as number]));
    const reasonMap = new Map((todayPool?.items ?? []).filter((i) => i.reason).map((i) => [i.code, i.reason as string]));
    // 竞价强/弱板块集合（由风向标 tags 衍生）
    const sectors = benchmark ? deriveBenchmarkSectors(benchmark) : null;

    // ---- Phase 1 初筛 ----
    const p1 = phase1Filter(snap.quotes, stCodes, cfg);
    const poolCodes = p1.pool.map((q) => q.code);

    // ---- 候选股批量数据：竞价快照 / 估值（扶摇，分批 ≤100）----
    const [auctionMap, valuations] = await Promise.all([
      cached(`auction_snap_${today}`, 30 * 60 * 1000, () => getFuyaoAuction(poolCodes)),
      cached(`valuations_${today}`, endOfDayTTL(), () => getFuyaoValuations(poolCodes)),
    ]);
    const t0Neutral = !auctionMap || auctionMap.size === 0; // 无竞价数据时段 → T0 中性 1.0

    // 竞价成交额分位（候选池内，越小越靠前），供 T0 催化剂维度
    const grabRankPct = new Map<string, number>();
    if (auctionMap) {
      const ranked = Array.from(auctionMap.entries())
        .filter(([, a]) => a.auctionAmount !== undefined && a.auctionAmount > 0)
        .sort((a, b) => (b[1].auctionAmount as number) - (a[1].auctionAmount as number));
      ranked.forEach(([code], i) => grabRankPct.set(code, (i + 1) / ranked.length));
    }

    // 估值/名称回填
    if (valuations) {
      for (const q of p1.pool) {
        const v = valuations.get(q.code);
        if (!v) continue;
        q.pe = q.pe ?? v.pe;
        q.pb = q.pb ?? v.pb;
        q.name = q.name ?? v.name;
      }
    }

    // ---- 板块强度：同花顺行业指数涨幅（名称精确匹配），映射缺失回退候选池同行业均值 ----
    const poolIndustries = Array.from(new Set(p1.pool.map((q) => q.industry || "未知")));
    const indexPctByIndustry = await (async () => {
      try {
        const catalog = await cached("ths_index_list", endOfDayTTL(), () => getThsIndexList());
        if (!catalog) return new Map<string, number>();
        const matched = new Map<string, string>(); // industry → index thscode
        for (const ind of poolIndustries) {
          const code = catalog.get(ind);
          if (code) matched.set(ind, code);
        }
        if (matched.size === 0) return new Map<string, number>();
        const snapMap = await cached(`ths_index_snap_${today}`, 30 * 60 * 1000, () => getThsIndexSnapshot(Array.from(matched.values())));
        if (!snapMap) return new Map<string, number>();
        const out = new Map<string, number>();
        matched.forEach((code, ind) => {
          const pct = snapMap.get(code);
          if (pct !== undefined) out.set(ind, pct);
        });
        return out;
      } catch {
        return new Map<string, number>();
      }
    })();

    // ---- 板块共振上下文聚合 ----
    const byIndustry = new Map<string, typeof p1.pool>();
    for (const q of p1.pool) {
      const ind = q.industry || "未知";
      if (!byIndustry.has(ind)) byIndustry.set(ind, []);
      byIndustry.get(ind)!.push(q);
    }
    const sectorCtxOf = (code: string, industry?: string) => {
      const ind = industry || "未知";
      const peers = byIndustry.get(ind) ?? [];
      const rank = peers.findIndex((p) => p.code === code) + 1; // pool 已按 baseScore 降序
      // 板块强度：同花顺行业指数涨幅优先，缺失则用候选池内同行业平均涨幅近似
      const sectorPct = indexPctByIndustry.get(ind) ??
        (peers.length > 0 ? peers.reduce((s, p) => s + p.pct, 0) / peers.length : 0);
      return {
        peersSelected: peers.length,
        rankInSector: rank > 0 ? rank : 99,
        sectorPct,
        hotSector: sectors?.hot.has(ind) ?? false,
        weakSector: sectors?.weak.has(ind) ?? false,
      };
    };

    // ---- 构建 Phase 2 上下文（竞价数据装配：auction_pct / auction_volume_ratio / auction_amount 分位 / 风向标 tags）----
    const contexts: StockContext[] = p1.pool.map((q) => {
      const a: FuyaoAuction | undefined = auctionMap?.get(q.code);
      const bench = benchmark?.get(q.code);
      const openPct = a?.auctionPct ?? (q.preClose > 0 ? (q.open / q.preClose - 1) * 100 : 0);
      // 竞价快照缺失时名称回填
      if (!q.name && a?.name) q.name = a.name;
      // 风向标 "放量"/"高开" tags 加分：提升抢筹分位输入（无分位数据时给到前 10%）
      let rankPct = grabRankPct.get(q.code);
      if (bench && bench.tags.some((t) => t === "放量" || t === "高开")) {
        rankPct = rankPct !== undefined ? rankPct * 0.3 : 0.1;
      }
      return {
        quote: q,
        isST: stCodes.has(q.code) || isSTName(q.name),
        prevLimitUp: prevLimitUpSet.has(q.code), // Sophia 规则 5：前日涨停
        streak: streakMap.get(q.code),
        auction: {
          grabAmount: a?.auctionAmount,
          grabRankPct: rankPct,
          auctionVolRatio: a?.auctionVolRatio ?? (q.volumeRatio > 0 ? q.volumeRatio : undefined),
          openPct,
        },
        sectorCtx: sectorCtxOf(q.code, q.industry),
      };
    });

    // 深度数据充实：仅对基础分前 enrichLimit 只拉取 K线/资金/财务/异动（其余走中性值；财务限前 50 只）
    const enrichTargets = contexts.slice(0, enrichLimit);
    // 异动原因（催化剂，批量一次）：映射为公告标题供 Lucas/Sophia 关键词扫描 + 涨停池 limit_up_reason
    const anomalyMap = await cached(`anomaly_${today}_${enrichLimit}`, endOfDayTTL(), () =>
      getFuyaoAnomaly(enrichTargets.map((c) => c.quote.code))
    );
    if (anomalyMap) {
      for (const ctx of enrichTargets) {
        const an = anomalyMap.get(ctx.quote.code);
        if (!an) continue;
        const reason = reasonMap.get(ctx.quote.code);
        const title = `${an.tags.join(" ")} ${an.reason}`.slice(0, 300);
        const anns: Announcement[] = [{ time: today, title: reason ? `${reason}；${title}` : title }];
        ctx.announcements = anns;
      }
    } else {
      for (const ctx of enrichTargets) {
        const reason = reasonMap.get(ctx.quote.code);
        if (reason) ctx.announcements = [{ time: today, title: reason }];
      }
    }
    await mapLimit(enrichTargets, 6, (ctx, i) => enrichContext(ctx, i < 50));
    for (const ctx of enrichTargets) {
      if (ctx.prevAmplitude === undefined) ctx.prevAmplitude = prevAmplitudeFromKline(ctx);
    }

    // ---- Phase 2 评分 + 最终合成（单只评分异常只跳过该只，不拖垮全流程）----
    const scored: ScoredStock[] = [];
    let scoreErrors = 0;
    for (const ctx of contexts) {
      try {
        const ethan = scoreEthan(ctx);
        const lucas = scoreLucas(ctx);
        const edwin = scoreEdwin(ctx, regime.regime);
        const sophia = scoreSophia(ctx);
        const mia = scoreMia(ctx, regime.tm);
        const t0 = t0Neutral
          ? T0_NEUTRAL
          : scoreT0({
              grabRankPct: ctx.auction?.grabRankPct,
              openPct: ctx.auction?.openPct ?? 0,
              auctionVolRatio: ctx.auction?.auctionVolRatio,
              pct: ctx.quote.pct,
            });
        const stock = buildScoredStock(
          ctx,
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
    const vetoed = scored.filter((s) => s.vetoed).slice(0, 20); // 展示前 20 只被熔断标的
    const results = diversify(alive, cfg.topN);

    // 记录当日选股到胜负日志。
    // 仅在竞价买入窗口内、数据为实时源（非降级）、且是工作日时记录，
    // 防止盘中重跑/降级数据污染统计。
    try {
      const dow = new Date(Date.now() + 8 * 3600 * 1000).getUTCDay(); // 北京时间星期
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
          limitDownCount,
          stockAdvRatio: stockAdvRatio !== undefined ? Math.round(stockAdvRatio * 1000) / 1000 : null,
        },
        emotion: null,
        source: snap.source,
        degraded: snap.degraded,
        weightsPreset: preset.from,
      },
      stats: {
        phase1: p1.stats,
        poolSize: p1.pool.length,
        enriched: Math.min(enrichLimit, contexts.length),
        aliveCount: alive.length,
        vetoCount: scored.length - alive.length,
        scoreErrors,
        auctionMatched: auctionMap?.size ?? 0,
        benchmarkSize: benchmark?.size ?? 0,
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
    // 兜底：任何意外也不 500
    return NextResponse.json({
      results: [], vetoed: [], regime: null, stats: null, degraded: true, source: "neutral",
      message: `流水线异常：${err instanceof Error ? err.message : String(err)}`,
      elapsedMs: Date.now() - startedAt,
    });
  }
}
