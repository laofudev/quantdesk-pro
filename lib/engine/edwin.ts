/**
 * Edwin 风格与基本面评分
 * edwin = 风格匹配 × 0.5 + 基本面 × 0.5（SPEC 2.3）
 * 复刻自 Alpha-X 公开前端逻辑，仅供学习。
 * 纯函数，无网络依赖；数据缺失 → 50 中性。
 */
import type { AgentScore, StockContext } from "@/lib/types";

function clamp100(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/**
 * 风格匹配（0-100）：按 regime 匹配市值 / 估值 / 波动风格
 * - 大跌/下跌：偏好大盘、低估值、低波动
 * - 大涨/超卖反弹：偏好小盘弹性
 * - 其余：均衡
 */
export function styleMatch(ctx: StockContext, regime: string): { score: number; note: string } {
  const q = ctx.quote;
  const mcap = q.circMcap; // 流通市值（元）
  let score = 50;
  const notes: string[] = [];

  const bigMcap = mcap !== undefined && mcap >= 2e10;      // ≥200亿 大盘
  const smallMcap = mcap !== undefined && mcap < 5e9;      // <50亿 小盘
  const lowPe = q.pe !== undefined && q.pe > 0 && q.pe < 30;
  const lowVol = q.amplitude > 0 && q.amplitude < 4;

  if (regime === "大跌" || regime === "下跌") {
    if (bigMcap) { score += 25; notes.push("弱势市偏好大盘 +25"); }
    if (lowPe) { score += 15; notes.push("低估值 +15"); }
    if (lowVol) { score += 10; notes.push("低波动 +10"); }
    if (smallMcap) { score -= 10; notes.push("小盘弱势市减分 -10"); }
  } else if (regime === "大涨" || regime === "超卖反弹") {
    if (smallMcap) { score += 20; notes.push("强势市偏好小盘弹性 +20"); }
    if (q.pct60 !== undefined && q.pct60 > 5) { score += 15; notes.push("动量风格 +15"); }
    if (!lowVol && q.amplitude > 0) { score += 5; notes.push("高波动弹性 +5"); }
  } else {
    // 震荡市：中市值 + 温和估值
    if (mcap !== undefined && mcap >= 5e9 && mcap < 5e10) { score += 20; notes.push("震荡市偏好中市值 +20"); }
    if (lowPe) { score += 10; notes.push("低估值 +10"); }
  }
  if (notes.length === 0) notes.push("风格中性 50");
  return { score: clamp100(score), note: notes.join("；") };
}

/**
 * 基本面合成（0-100，缺失 → 50）
 * 输入 corp_finance_metrics：yoy_profit / yoy_revenue / ROE / 净利率 / 资产负债率
 */
export function fundamentalScore(ctx: StockContext): { score: number; note: string } {
  const f = ctx.finance;
  if (!f || (f.roe === undefined && f.yoyProfit === undefined && f.yoyRevenue === undefined)) {
    return { score: 50, note: "基本面数据缺失（中性 50）" };
  }
  let score = 50;
  const notes: string[] = [];
  if (f.yoyProfit !== undefined) {
    if (f.yoyProfit > 30) { score += 15; notes.push(`净利同比${f.yoyProfit.toFixed(0)}% +15`); }
    else if (f.yoyProfit > 0) { score += 8; notes.push(`净利同比${f.yoyProfit.toFixed(0)}% +8`); }
    else { score -= 10; notes.push(`净利同比${f.yoyProfit.toFixed(0)}% -10`); }
  }
  if (f.yoyRevenue !== undefined) {
    if (f.yoyRevenue > 20) { score += 10; notes.push(`营收同比${f.yoyRevenue.toFixed(0)}% +10`); }
    else if (f.yoyRevenue < 0) { score -= 8; notes.push(`营收同比${f.yoyRevenue.toFixed(0)}% -8`); }
  }
  if (f.roe !== undefined) {
    if (f.roe > 12) { score += 12; notes.push(`ROE ${f.roe.toFixed(1)}% +12`); }
    else if (f.roe > 8) { score += 6; notes.push(`ROE ${f.roe.toFixed(1)}% +6`); }
    else if (f.roe < 3) { score -= 8; notes.push(`ROE ${f.roe.toFixed(1)}% -8`); }
  }
  if (f.netMargin !== undefined && f.netMargin > 15) { score += 6; notes.push(`净利率${f.netMargin.toFixed(1)}% +6`); }
  if (f.debtRatio !== undefined && f.debtRatio > 70) { score -= 10; notes.push(`资产负债率${f.debtRatio.toFixed(0)}% -10`); }
  return { score: clamp100(score), note: notes.join("；") || "基本面中性 50" };
}

export function scoreEdwin(ctx: StockContext, regime: string): AgentScore {
  const style = styleMatch(ctx, regime);
  const fund = fundamentalScore(ctx);
  const score = style.score * 0.5 + fund.score * 0.5; // SPEC 2.3 公式
  return {
    score: Math.round(clamp100(score) * 100) / 100,
    details: { style: style.score, fundamental: fund.score, style_note: style.note, fund_note: fund.note },
  };
}
