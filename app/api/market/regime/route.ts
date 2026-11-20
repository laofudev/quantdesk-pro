/**
 * GET /api/market/regime — 当日市场环境判定（Phase 0）
 * 纯扶摇数据源；任何失败都优雅降级，绝不 500。
 */
import { NextResponse } from "next/server";
import { judgeRegime } from "@/lib/engine/regime";
import {
  getHotList,
  getLadder,
  getLimitBreakTotal,
  getLimitDownTotal,
  getLimitUpPool,
  getLimitUpStats,
} from "@/lib/providers/fuyao";
import { cached, cacheGet, cacheSet, endOfDayTTL } from "@/lib/cache";
import { loadMarket, loadSectorPerformance } from "@/lib/data/market";
import { requireFuyaoCtx } from "@/lib/api-guard";
import type { EmotionPoint } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 当日涨停池（10 分钟缓存） */
function getUpPoolCached(ctx: { apiKey: string }) {
  return cached("limit_up_pool_regime_10m", 10 * 60 * 1000, () => getLimitUpPool(ctx));
}

/** 由涨跌停池 + 天梯 + 热榜衍生情绪指标，并维护近 40 日序列 */
async function deriveEmotion(
  ctx: { apiKey: string },
  upCount: number,
  downCount: number
): Promise<EmotionPoint | null> {
  return cached("emotion_today", endOfDayTTL(), async () => {
    const [upPool, dtTotal, breakTotal, ladder, hot, stats] = await Promise.all([
      getUpPoolCached(ctx),
      getLimitDownTotal(ctx),
      getLimitBreakTotal(ctx),
      getLadder(ctx),
      getHotList(ctx),
      getLimitUpStats(ctx),
    ]);
    if (upPool === null && dtTotal === null && ladder === null) return null;
    const ztjs = upPool?.total ?? stats?.limitUpCount;
    const dbcgl =
      ztjs !== undefined && breakTotal !== null && breakTotal !== undefined && ztjs + breakTotal > 0
        ? ztjs / (ztjs + breakTotal)
        : undefined;
    const point: EmotionPoint = {
      date: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
      ztjs,
      dtjs: dtTotal ?? undefined,
      szbl: upCount + downCount > 0 ? upCount / (upCount + downCount) : undefined,
      dbcgl,
      lbjs: ladder?.maxBoard,
      lbgs: ladder?.boardCount,
      hot: hot?.slice(0, 5).map((h) => h.name ?? h.code),
    };
    try {
      const series = (await cacheGet<EmotionPoint[]>("emotion_series")) ?? [];
      const idx = series.findIndex((p) => p.date === point.date);
      if (idx >= 0) series[idx] = point;
      else series.push(point);
      series.sort((a, b) => (a.date < b.date ? -1 : 1));
      await cacheSet("emotion_series", series.slice(-40), 90 * 24 * 3600 * 1000);
    } catch {
      // 序列维护失败不影响主流程
    }
    return point;
  });
}

export async function GET(req: Request) {
  try {
    const guard = await requireFuyaoCtx();
    if (!guard.ok || !guard.ctx) {
      return guard.response ?? NextResponse.json({ error: "未授权" }, { status: 401 });
    }
    const ctx = guard.ctx;
    const url = new URL(req.url);
    const overnightParam = url.searchParams.get("overnight");
    const parsed = overnightParam !== null && overnightParam !== "" ? parseFloat(overnightParam) : null;
    const overnightIdxAvg = parsed !== null && Number.isFinite(parsed) ? parsed : null;

    const market = await loadMarket(ctx);
    const quotes = market.quotes;
    const openPcts = quotes
      .filter((q) => q.preClose > 0 && q.open > 0)
      .map((q) => (q.open / q.preClose - 1) * 100);
    const up = quotes.filter((q) => q.pct > 0).length;
    const down = quotes.filter((q) => q.pct < 0).length;
    const stockAdvRatio = down > 0 ? up / down : up > 0 ? 1 : undefined;

    const [upPoolTotal, limitDownPoolTotal, sectorPctMap] = await Promise.all([
      getUpPoolCached(ctx).then((p) => p?.total ?? null),
      cached("limit_down_total", 10 * 60 * 1000, () => getLimitDownTotal(ctx)),
      market.industryMap ? loadSectorPerformance(ctx, market.industryMap) : Promise.resolve(new Map<string, number>()),
    ]);
    const limitUpCount = upPoolTotal ?? quotes.filter((q) => q.pct >= 9.8).length;
    const limitDownCount = limitDownPoolTotal ?? quotes.filter((q) => q.pct <= -9.8).length;

    let sectorUp = 0, sectorDown = 0;
    sectorPctMap.forEach((v) => {
      if (v > 0) sectorUp++;
      else if (v < 0) sectorDown++;
    });
    const sectorAdvRatio = sectorDown > 0 ? sectorUp / sectorDown : sectorUp > 0 ? 1 : undefined;

    const regime = judgeRegime({
      openPcts,
      limitDownCount,
      stockAdvRatio,
      sectorAdvRatio,
      overnightIdxAvg,
    });

    const emotion = await deriveEmotion(ctx, up, down);
    const emotionSeries = (await cacheGet<EmotionPoint[]>("emotion_series")) ?? undefined;

    return NextResponse.json({
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
      emotion: emotion ?? null,
      emotionSeries: emotionSeries && emotionSeries.length > 1 ? emotionSeries : undefined,
      sectorCount: sectorPctMap.size,
      source: market.source,
      degraded: market.degraded,
      tradeDate: market.tradeDate,
      message: market.message,
    });
  } catch (err) {
    return NextResponse.json({
      tm: 0, regime: "均衡", label: "数据不可用（中性）", confirms: [],
      weights: { ethan: 0.2, lucas: 0.2, edwin: 0.2, sophia: 0.2, mia: 0.2 },
      stats: { sampleSize: 0, upCount: 0, downCount: 0, limitUpCount: 0, limitDownCount: 0, stockAdvRatio: null },
      emotion: null, source: "neutral", degraded: true,
      message: `regime 接口异常：${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
