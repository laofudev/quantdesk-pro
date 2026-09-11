/**
 * Phase 2.4 最终合成与输出（含行业分散 TopN）
 * 复刻自 Alpha-X 公开前端逻辑，仅供学习。
 * 纯函数，无网络依赖。
 */
import type { AgentScore, AgentWeights, ScoredStock, StockContext } from "@/lib/types";
import type { T0Result } from "./t0";
import type { SophiaCheck } from "./sophia";

/**
 * Mia 市场维度分（相对强度代理）：
 * 个股开盘涨幅相对全市场 TM 的超额收益映射到 0-100。
 * 复刻自 Alpha-X 公开前端逻辑，仅供学习。
 */
export function scoreMia(ctx: StockContext, tm: number): AgentScore {
  const q = ctx.quote;
  const openPct = q.preClose > 0 ? (q.open / q.preClose - 1) * 100 : 0;
  const excess = openPct - tm;
  const score = Math.max(0, Math.min(100, 50 + excess * 10));
  return { score: Math.round(score * 100) / 100, details: { tm, openPct: Math.round(openPct * 100) / 100, excess: Math.round(excess * 100) / 100 } };
}

export interface SynthesizeInput {
  agents: { ethan: AgentScore; lucas: AgentScore; edwin: AgentScore; sophia: AgentScore; mia: AgentScore };
  weights: AgentWeights;
  t0: T0Result;
  sophia: SophiaCheck;
  openPct: number; // 开盘涨幅 %
}

export interface SynthesizeOutput {
  finalScore: number;
  agentBase: number;
  t0Norm: number;
  vetoed: boolean;
}

/**
 * 最终合成（SPEC V3 公式，复刻自 Alpha-X 公开前端逻辑，仅供学习）：
 *   agent_base = ethan*w_e + lucas*w_l + edwin*w_ed + sophia*w_s + mia*w_m
 *   t0_norm    = (T0 - 0.5) * 100
 *   final      = sophia_veto ? -∞ : t0_norm*0.6 + agent_base*0.4
 *   开盘涨幅 ≥ 9.5% 时 final *= 0.30（一字板/准一字不追）
 * 注意：sophia 罚分只通过 sophia 维度得分（100-penalty）折进 agent_base 生效一次，
 * 公式不再额外 -penalty（对照 AlphaX平台策略运行机制研究.md 3.3 节原文）。
 */
export function synthesize(input: SynthesizeInput): SynthesizeOutput {
  const { agents, weights, t0, sophia, openPct } = input;
  const agentBase =
    agents.ethan.score * weights.ethan +
    agents.lucas.score * weights.lucas +
    agents.edwin.score * weights.edwin +
    agents.sophia.score * weights.sophia +
    agents.mia.score * weights.mia;
  const t0Norm = (t0.t0 - 0.5) * 100;
  if (sophia.veto) {
    return { finalScore: Number.NEGATIVE_INFINITY, agentBase: Math.round(agentBase * 100) / 100, t0Norm, vetoed: true };
  }
  let finalScore = t0Norm * 0.6 + agentBase * 0.4;
  if (openPct >= 9.5) finalScore *= 0.3;
  return { finalScore: Math.round(finalScore * 100) / 100, agentBase: Math.round(agentBase * 100) / 100, t0Norm, vetoed: false };
}

/**
 * 强制行业分散（SPEC 2.4，复刻自 Alpha-X 公开前端逻辑，仅供学习）：
 * - 同一行业最多 ⌈N/4⌉ 只
 * - Top3 必须三个不同行业
 * - 行业缺失归入 "未知" 桶，同样受限
 */
export function diversify(stocks: ScoredStock[], topN: number): ScoredStock[] {
  const maxPerIndustry = Math.ceil(topN / 4);
  const sorted = stocks
    .filter((s) => !s.vetoed && Number.isFinite(s.finalScore))
    .sort((a, b) => b.finalScore - a.finalScore);
  const picked: ScoredStock[] = [];
  const industryCount = new Map<string, number>();

  for (const s of sorted) {
    if (picked.length >= topN) break;
    const ind = s.industry || "未知";
    const cnt = industryCount.get(ind) ?? 0;
    if (cnt >= maxPerIndustry) continue; // 行业名额已满
    // Top3 必须三个不同行业
    if (picked.length < 3 && picked.some((p) => (p.industry || "未知") === ind)) continue;
    picked.push(s);
    industryCount.set(ind, cnt + 1);
  }
  return picked;
}

/** 便捷封装：把上下文各 agent 结果组装成 ScoredStock */
export function buildScoredStock(
  ctx: StockContext,
  agents: ScoredStock["agents"],
  weights: AgentWeights,
  t0: T0Result,
  sophia: SophiaCheck
): ScoredStock {
  const q = ctx.quote;
  const openPct = q.preClose > 0 ? (q.open / q.preClose - 1) * 100 : 0;
  const out = synthesize({ agents, weights, t0, sophia, openPct });
  return {
    code: q.code,
    name: q.name,
    industry: q.industry,
    quote: {
      price: q.price, pct: q.pct, open: q.open, preClose: q.preClose,
      amount: q.amount, turnover: q.turnover, volumeRatio: q.volumeRatio, amplitude: q.amplitude,
    },
    openPct: Math.round(openPct * 100) / 100,
    finalScore: out.finalScore,
    vetoed: out.vetoed,
    vetoReasons: sophia.reasons,
    sophiaPenalty: sophia.penalty,
    penaltyReasons: sophia.penaltyReasons,
    agents,
    t0: { t0: t0.t0, catalyst: t0.catalyst, safety: t0.safety, confirm: t0.confirm },
    agentBase: out.agentBase,
    t0Norm: out.t0Norm,
  };
}
