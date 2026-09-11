/**
 * Ethan 六维技术评分
 * 复刻自 Alpha-X 公开前端逻辑，仅供学习。
 * 各维 0-100，权重 trend .18 / capital .22 / quality .15 / position .15 / momentum .15 / safety .15
 * 纯函数，无网络依赖；数据缺失走中性值。
 */
import type { AgentScore, KlineBar, StockContext } from "@/lib/types";

export const ETHAN_WEIGHTS = { trend: 0.18, capital: 0.22, quality: 0.15, position: 0.15, momentum: 0.15, safety: 0.15 } as const;

/* ---------------- 工具函数 ---------------- */

/** K 线按日期升序 */
function sortedKline(kline?: KlineBar[]): KlineBar[] {
  return kline ? [...kline].sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
}

/** 参考均线：最近 n 日收盘均值（不含今日） */
export function refMA(kline: KlineBar[], n: number): number | undefined {
  if (kline.length < n) return undefined;
  const tail = kline.slice(-n);
  return tail.reduce((s, b) => s + b.close, 0) / n;
}

/** 开盘价增量 MA：new_ma5 = (ma5_ref*4 + open) / 5（SPEC 2.3，复刻自 Alpha-X 公开前端逻辑，仅供学习） */
export function incrementalMA(maRef: number | undefined, n: number, open: number): number | undefined {
  if (maRef === undefined) return undefined;
  return (maRef * (n - 1) + open) / n;
}

function clamp100(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/* ---------------- 六维评分 ---------------- */

/** trend：MA5>MA20>MA60 → 85；MA5>MA20 → 70；MA5>MA60 → 60；MA20>MA60 → 50；其他 30 */
function scoreTrend(ctx: StockContext, mas: { ma5?: number; ma20?: number; ma60?: number }): number {
  const { ma5, ma20, ma60 } = mas;
  if (ma5 === undefined || ma20 === undefined || ma60 === undefined) return 50; // 数据缺失中性
  if (ma5 > ma20 && ma20 > ma60) return 85;
  if (ma5 > ma20) return 70;
  if (ma5 > ma60) return 60;
  if (ma20 > ma60) return 50;
  return 30;
}

/** capital：近 5 日主力净流入分档：正且递增 → 85；正 → 70；平衡 → 55；流出 → 35 */
function scoreCapital(ctx: StockContext): number {
  const flow = ctx.moneyFlow;
  if (!flow || flow.length === 0) return 50; // 缺失中性
  const tail = flow.slice(-5);
  const sum = tail.reduce((s, f) => s + f.netMain, 0);
  const avgAbs = tail.reduce((s, f) => s + Math.abs(f.netMain), 0) / tail.length;
  const increasing = tail.every((f, i) => i === 0 || f.netMain >= tail[i - 1].netMain);
  if (avgAbs === 0) return 55; // 全零视为无资金往来，按平衡档而非流出档
  if (sum > 0 && increasing && tail.length >= 3) return 85;
  if (sum > 0) return 70;
  if (avgAbs > 0 && Math.abs(sum) <= avgAbs * 0.5) return 55; // 进出基本平衡
  return 35;
}

/** quality：PE>0 且 <50 → 70；ROE>8% → +15；PB<5 → 70 基准；数据缺失 → 50 */
function scoreQuality(ctx: StockContext): number {
  const { pe, pb } = ctx.quote;
  const roe = ctx.finance?.roe;
  if (pe === undefined && pb === undefined && roe === undefined) return 50;
  let s = 55;
  if (pe !== undefined && pe > 0 && pe < 50) s = 70;
  else if (pb !== undefined && pb < 5) s = 70;
  if (roe !== undefined && roe > 8) s += 15;
  return clamp100(s);
}

/** position：乖离率 bias=(price/ma5-1)*100：<3% → 85；<5% 且支撑距<30% → 70；<8% → 55；其他 35 */
function scorePosition(price: number, mas: { ma5?: number; ma20?: number }): number {
  if (mas.ma5 === undefined || mas.ma5 <= 0) return 50;
  const bias = (price / mas.ma5 - 1) * 100;
  // 支撑距：价格相对 MA20 的距离（MA20 视为支撑位）
  const supportDist = mas.ma20 !== undefined && mas.ma20 > 0 ? (price / mas.ma20 - 1) * 100 : 0;
  if (bias < 3) return 85;
  if (bias < 5 && supportDist < 30) return 70;
  if (bias < 8) return 55;
  return 35;
}

/** momentum：zdf60 / 近20日涨幅分档：温和(5~30) → 80；强势(30~60) → 65；滞涨 → 50；下跌 → 35 */
function scoreMomentum(ctx: StockContext, kline: KlineBar[]): number {
  let mom = ctx.quote.pct60;
  if (mom === undefined && kline.length >= 21) {
    const base = kline[kline.length - 21].close;
    if (base > 0) mom = (ctx.quote.price / base - 1) * 100;
  }
  if (mom === undefined) return 50;
  if (mom >= 5 && mom <= 30) return 80;
  if (mom > 30 && mom <= 60) return 65;
  if (mom >= 0 && mom < 5) return 50;   // 滞涨
  if (mom < 0) return 35;               // 下跌
  return 55;                            // >60% 过热，不追
}

/** safety：近 20 日平均振幅 <4% → 80；<7% → 60；否则 40 */
function scoreSafety(ctx: StockContext, kline: KlineBar[]): number {
  let amps: number[] = [];
  if (kline.length >= 5) {
    const tail = kline.slice(-20);
    amps = tail.map((b) => (b.close > 0 ? ((b.high - b.low) / b.close) * 100 : 0));
  } else if (ctx.quote.amplitude > 0) {
    amps = [ctx.quote.amplitude];
  }
  if (amps.length === 0) return 50;
  const avg = amps.reduce((s, v) => s + v, 0) / amps.length;
  if (avg < 4) return 80;
  if (avg < 7) return 60;
  return 40;
}

/* ---------------- tech_bonus 加减分（SPEC 2.3，复刻自 Alpha-X 公开前端逻辑，仅供学习） ---------------- */

function techBonus(ctx: StockContext, mas: { ma5?: number; ma20?: number; ma60?: number }, kline: KlineBar[]): { bonus: number; hits: string[] } {
  const q = ctx.quote;
  const openPct = q.preClose > 0 ? (q.open / q.preClose - 1) * 100 : 0;
  let bonus = 0;
  const hits: string[] = [];

  if (q.volumeRatio > 10 && q.pct < 4) { bonus += 15; hits.push("蓄势爆量 +15"); }
  else if (q.volumeRatio > 5 && q.pct < 5) { bonus += 10; hits.push("放量蓄势 +10"); }
  if (q.volumeRatio < 2 && q.pct > 5 && q.volumeRatio > 0) { bonus -= 10; hits.push("无量空涨 -10"); }
  if (openPct > 8) { bonus -= 15; hits.push("一致性陷阱(高开>8%) -15"); }

  // 高位压力：距 20/250 日高点回落 >10%
  const highs = kline.slice(-250).map((b) => b.high);
  const high20 = kline.length >= 5 ? Math.max(...kline.slice(-20).map((b) => b.high)) : undefined;
  const high250 = highs.length >= 60 ? Math.max(...highs) : undefined;
  if ((high20 !== undefined && q.price < high20 * 0.9) || (high250 !== undefined && q.price < high250 * 0.9)) {
    bonus -= 10; hits.push("高位压力 -10");
  }
  // 低位启动：现价距 20 日低点 <20%（且未跌破 20 日低点，避免给创新低暴跌股加分）
  const low20 = kline.length >= 5 ? Math.min(...kline.slice(-20).map((b) => b.low)) : undefined;
  if (low20 !== undefined && low20 > 0 && q.price >= low20 && q.price < low20 * 1.2) { bonus += 8; hits.push("低位启动 +8"); }

  // 均线多头
  if (mas.ma5 !== undefined && mas.ma20 !== undefined && mas.ma60 !== undefined && mas.ma5 > mas.ma20 && mas.ma20 > mas.ma60) {
    bonus += 5; hits.push("均线多头 +5");
  }
  // 接近支撑：现价在 MA20 上方 0~3% 以内
  if (mas.ma20 !== undefined && mas.ma20 > 0) {
    const d = (q.price / mas.ma20 - 1) * 100;
    if (d >= 0 && d < 3) { bonus += 5; hits.push("接近支撑 +5"); }
  }
  return { bonus, hits };
}

/* ---------------- 主入口 ---------------- */

/** ethan = Σ(dim × weight) + tech_bonus，归一 0-100 */
export function scoreEthan(ctx: StockContext): AgentScore & { ma: { ma5?: number; ma20?: number; ma60?: number } } {
  const kline = sortedKline(ctx.kline);
  const mas = {
    ma5: incrementalMA(refMA(kline, 5), 5, ctx.quote.open),
    ma20: incrementalMA(refMA(kline, 20), 20, ctx.quote.open),
    ma60: incrementalMA(refMA(kline, 60), 60, ctx.quote.open),
  };

  const dims = {
    trend: scoreTrend(ctx, mas),
    capital: scoreCapital(ctx),
    quality: scoreQuality(ctx),
    position: scorePosition(ctx.quote.price, mas),
    momentum: scoreMomentum(ctx, kline),
    safety: scoreSafety(ctx, kline),
  };
  const { bonus, hits } = techBonus(ctx, mas, kline);

  const raw =
    dims.trend * ETHAN_WEIGHTS.trend +
    dims.capital * ETHAN_WEIGHTS.capital +
    dims.quality * ETHAN_WEIGHTS.quality +
    dims.position * ETHAN_WEIGHTS.position +
    dims.momentum * ETHAN_WEIGHTS.momentum +
    dims.safety * ETHAN_WEIGHTS.safety;

  return {
    score: Math.round(clamp100(raw + bonus) * 100) / 100,
    ma: mas,
    details: {
      trend: dims.trend, capital: dims.capital, quality: dims.quality,
      position: dims.position, momentum: dims.momentum, safety: dims.safety,
      tech_bonus: bonus, bonus_hits: hits,
    },
  };
}
