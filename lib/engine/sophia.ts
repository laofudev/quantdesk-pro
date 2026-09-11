/**
 * Sophia 风控熔断（veto，命中即淘汰并记录原因）
 * 复刻自 Alpha-X 公开前端逻辑，仅供学习。
 * 纯函数，无网络依赖。
 */
import type { AgentScore, StockContext } from "@/lib/types";
import { isSTName } from "./phase1";
import { hasNegativeCatalyst } from "./lucas";

export interface SophiaCheck {
  veto: boolean;
  reasons: string[];        // 熔断原因
  penalty: number;          // 高危非熔断扣分
  penaltyReasons: string[];
}

/** 乖离率：现价 / MA5 - 1（%） */
function biasFromKline(ctx: StockContext): number {
  if (!ctx.kline || ctx.kline.length < 5) return 0;
  const tail = [...ctx.kline].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-5);
  const ma5 = tail.reduce((s, b) => s + b.close, 0) / 5;
  return ma5 > 0 ? (ctx.quote.price / ma5 - 1) * 100 : 0;
}

/** 距 N 日高点幅度 %（负值=在高点之下）；返回 { high20, high250 } 的距离 */
function distToHighs(ctx: StockContext): { d20?: number; d250?: number } {
  const k = ctx.kline ? [...ctx.kline].sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
  const out: { d20?: number; d250?: number } = {};
  if (k.length >= 5) {
    const h20 = Math.max(...k.slice(-20).map((b) => b.high));
    if (h20 > 0) out.d20 = (ctx.quote.price / h20 - 1) * 100;
  }
  if (k.length >= 60) {
    const h250 = Math.max(...k.slice(-250).map((b) => b.high));
    if (h250 > 0) out.d250 = (ctx.quote.price / h250 - 1) * 100;
  }
  return out;
}

/**
 * 熔断规则（SPEC 2.3，命中任一即淘汰）：
 * 1. 成交额 < 300 万
 * 2. ST/退市
 * 3. 偏离 5 日线 > 30%
 * 4. 距 250 日或 20 日高点 < 1%（贴顶）
 * 5. 一致性陷阱：前日涨停 + 今日高开>7% + 竞价量比<10
 * 6. 反向波动：前日振幅 > 15%
 */
export function checkSophia(ctx: StockContext): SophiaCheck {
  const q = ctx.quote;
  const reasons: string[] = [];
  const penaltyReasons: string[] = [];
  let penalty = 0;

  // 规则 1：成交额 < 300 万
  if (q.amount < 3_000_000) reasons.push(`成交额${(q.amount / 10000).toFixed(0)}万 < 300万`);

  // 规则 2：ST/退市
  if (ctx.isST || isSTName(q.name)) reasons.push("ST/退市标的");

  // 规则 3：偏离 5 日线 > 30%
  const bias = biasFromKline(ctx);
  if (Math.abs(bias) > 30) reasons.push(`偏离5日线${bias.toFixed(1)}% > 30%`);

  // 规则 4：距 250 日或 20 日高点 < 1%（贴顶）
  const { d20, d250 } = distToHighs(ctx);
  if (d20 !== undefined && d20 > -1) reasons.push("贴近20日高点(<1%)");
  else if (d250 !== undefined && d250 > -1) reasons.push("贴近250日高点(<1%)");

  // 规则 5：一致性陷阱：前日涨停 + 今日高开>7% + 竞价量比<10
  const openPct = q.preClose > 0 ? (q.open / q.preClose - 1) * 100 : 0;
  const auctionVR = ctx.auction?.auctionVolRatio ?? q.volumeRatio;
  if (ctx.prevLimitUp && openPct > 7 && auctionVR > 0 && auctionVR < 10) {
    reasons.push(`一致性陷阱：前日涨停+高开${openPct.toFixed(1)}%+竞价量比${auctionVR.toFixed(1)}<10`);
  }

  // 规则 6：反向波动：前日振幅 > 15%
  if (ctx.prevAmplitude !== undefined && ctx.prevAmplitude > 15) {
    reasons.push(`前日振幅${ctx.prevAmplitude.toFixed(1)}% > 15%`);
  }

  // 高危非熔断扣分 sophia_penalty（SPEC 2.3）：公告利空 -20；3 板以上连板 -30
  const neg = hasNegativeCatalyst(ctx.announcements);
  if (neg) { penalty += 20; penaltyReasons.push(`公告利空（${neg}）-20`); }
  if (ctx.streak !== undefined && ctx.streak >= 3) {
    penalty += 30; penaltyReasons.push(`${ctx.streak}连板高位 -30`);
  }

  return { veto: reasons.length > 0, reasons, penalty, penaltyReasons };
}

/** Sophia agent 分（作为风控维度参与合成）：无熔断=100-penalty，有熔断仍给出低分供展示 */
export function scoreSophia(ctx: StockContext): AgentScore & SophiaCheck {
  const check = checkSophia(ctx);
  const score = check.veto ? 10 : Math.max(0, 100 - check.penalty);
  return {
    ...check,
    score,
    details: { veto_reasons: check.reasons, penalty_reasons: check.penaltyReasons },
  };
}
