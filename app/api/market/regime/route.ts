/**
 * GET /api/market/regime — 当日市场环境判定（Phase 0）
 * 返回 TM、regime、权重、涨跌停统计、情绪周期摘要。
 * 扶摇不可达时优雅降级到 Tushare 快照/中性值，绝不 500。
 * 情绪周期：由扶摇涨跌停池+连板天梯+热股榜当日衍生，并逐日累积近 40 日序列（缓存）。
 */
import { NextResponse } from "next/server";
import { judgeRegime, resolvePresetWeights } from "@/lib/engine/regime";
import {
  getFuyaoHotList,
  getFuyaoLadder,
  getFuyaoLimitBreakTotal,
  getFuyaoLimitDownTotal,
  getFuyaoLimitUpPool,
} from "@/lib/providers/fuyao";
import { cached, cacheGet, cacheSet, endOfDayTTL } from "@/lib/cache";
import { loadSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

interface EmotionPoint {
  date: string;        // yyyy-MM-dd
  ztjs?: number;       // 涨停家数
  dtjs?: number;       // 跌停家数
  szbl?: number;       // 上涨比例 0~1
  dbcgl?: number;      // 打板成功率 0~1
  lbjs?: number;       // 最高连板高度
  lbgs?: number;       // 连板只数
  hot?: string[];      // 人气榜 Top5
}

/** 当日涨停池（10 分钟缓存，供情绪衍生与涨跌停计数复用；独立 key 避免与流水线的当日 TTL 缓存互相覆盖） */
function getUpPoolCached() {
  return cached("limit_up_pool_regime_10m", 10 * 60 * 1000, () => getFuyaoLimitUpPool());
}

/** 由扶摇涨跌停池/炸板池/连板天梯/热股榜衍生当日情绪指标，并维护近 40 日序列 */
async function deriveEmotion(upCount: number, downCount: number): Promise<EmotionPoint | null> {
  return cached("emotion_today", endOfDayTTL(), async () => {
    const [upPool, dtTotal, breakTotal, ladder, hot] = await Promise.all([
      getUpPoolCached(),
      getFuyaoLimitDownTotal(),
      getFuyaoLimitBreakTotal(),
      getFuyaoLadder(),
      getFuyaoHotList(),
    ]);
    if (upPool === null && dtTotal === null && ladder === null) return null;
    const ztjs = upPool?.total;
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
    // 逐日累积近 40 日序列（90 天 TTL，覆盖窗口足够）
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
    const url = new URL(req.url);
    // 隔夜外部指数均值 %（本地版手动输入，可省略）
    const overnightParam = url.searchParams.get("overnight");
    const parsedOvernight = overnightParam !== null && overnightParam !== "" ? parseFloat(overnightParam) : null;
    const overnightIdxAvg = parsedOvernight !== null && Number.isFinite(parsedOvernight) ? parsedOvernight : null;

    const snap = await loadSnapshot();
    const quotes = snap.quotes;

    // 开盘涨幅数组（扶摇快照 open_price vs prev_price）
    const openPcts = quotes
      .filter((q) => q.preClose > 0 && q.open > 0)
      .map((q) => (q.open / q.preClose - 1) * 100);

    // 个股涨跌比
    const up = quotes.filter((q) => q.pct > 0).length;
    const down = quotes.filter((q) => q.pct < 0).length;
    const stockAdvRatio = down > 0 ? up / down : up > 0 ? 1 : undefined;

    // 涨跌停家数：优先扶摇涨跌停池 total，失败回退快照 ±9.8% 近似
    const [upPoolTotal, limitDownPoolTotal] = await Promise.all([
      getUpPoolCached().then((p) => p?.total ?? null),
      cached("limit_down_total", 10 * 60 * 1000, () => getFuyaoLimitDownTotal()),
    ]);
    const limitUpCount = upPoolTotal ?? quotes.filter((q) => q.pct >= 9.8).length;
    const limitDownCount = limitDownPoolTotal ?? quotes.filter((q) => q.pct <= -9.8).length;

    const preset = await resolvePresetWeights();
    const regime = judgeRegime({
      openPcts,
      limitDownCount,
      stockAdvRatio,
      overnightIdxAvg,
      // 板块涨跌比需要板块级数据，本地版缺省不参与确认
    }, preset);

    // 情绪周期摘要（扶摇涨跌停池+天梯+热榜衍生，缓存当日，失败降级 null）
    const emotion = await deriveEmotion(up, down);
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
      source: snap.source,
      degraded: snap.degraded,
      weightsPreset: preset.from,
      tradeDate: snap.tradeDate,
      message: snap.message,
    });
  } catch (err) {
    // 兜底：中性 regime，绝不 500
    return NextResponse.json({
      tm: 0, regime: "均衡", label: "数据不可用（中性）", confirms: [],
      weights: { ethan: 0.2, lucas: 0.2, edwin: 0.2, sophia: 0.2, mia: 0.2 },
      stats: { sampleSize: 0, upCount: 0, downCount: 0, limitUpCount: 0, limitDownCount: 0, stockAdvRatio: null },
      emotion: null, source: "neutral", degraded: true,
      message: `regime 接口异常：${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
