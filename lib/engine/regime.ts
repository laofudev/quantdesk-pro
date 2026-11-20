/**
 * Phase 0 市场环境判定（Regime）
 *
 * 9 档 regime 权重表为本地快照（与公开 preset 核对一致），**不依赖任何外部站点**，
 * 保证离线可用与部署稳定。
 *
 * 判定逻辑：
 *   TM = 全市场开盘涨幅截尾均值（去首尾各 2%）
 *   TM ≤ -0.25% 时检查 4 项跌势确认 → 极端偏弱 / 偏弱 / 超卖反弹
 *   TM ≥ +0.25% → 偏强（按幅度细分大涨 / 上涨 / 震荡偏强）
 *   其余 → 震荡均衡
 */
import type { AgentWeights } from "@/lib/types";

/** 9 档 regime 权重表 */
export const REGIME_WEIGHTS: Record<string, AgentWeights> = {
  大涨: { ethan: 0.20, lucas: 0.15, edwin: 0.20, sophia: 0.30, mia: 0.15 },
  上涨: { ethan: 0.22, lucas: 0.18, edwin: 0.20, sophia: 0.25, mia: 0.15 },
  震荡偏强: { ethan: 0.25, lucas: 0.10, edwin: 0.20, sophia: 0.30, mia: 0.15 },
  震荡均衡: { ethan: 0.25, lucas: 0.10, edwin: 0.20, sophia: 0.30, mia: 0.15 },
  震荡偏弱: { ethan: 0.20, lucas: 0.15, edwin: 0.20, sophia: 0.30, mia: 0.15 },
  下跌: { ethan: 0.20, lucas: 0.10, edwin: 0.25, sophia: 0.35, mia: 0.10 },
  大跌: { ethan: 0.15, lucas: 0.10, edwin: 0.25, sophia: 0.40, mia: 0.10 },
  超卖反弹: { ethan: 0.30, lucas: 0.15, edwin: 0.20, sophia: 0.20, mia: 0.15 },
  均衡: { ethan: 0.20, lucas: 0.20, edwin: 0.20, sophia: 0.20, mia: 0.20 },
};

/** 默认权重（无法判定 regime 时使用） */
export const DEFAULT_WEIGHTS: AgentWeights = {
  ethan: 0.25, lucas: 0.15, edwin: 0.20, sophia: 0.25, mia: 0.15,
};

/** 截尾均值：去掉首尾各 trimRatio 后的均值 */
export function trimmedMean(values: number[], trimRatio = 0.02): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const k = Math.floor(sorted.length * trimRatio);
  const core = sorted.slice(k, sorted.length - k);
  if (core.length === 0) return sorted[Math.floor(sorted.length / 2)];
  return core.reduce((s, v) => s + v, 0) / core.length;
}

export interface RegimeInput {
  openPcts: number[];         // 全市场开盘涨幅数组 %
  sectorAdvRatio?: number;    // 板块涨跌比（上涨板块数/下跌板块数）
  limitDownCount: number;     // 跌停家数
  stockAdvRatio?: number;     // 个股涨跌比
  overnightIdxAvg?: number | null; // 隔夜外部指数均值 %
}

export interface RegimeResult {
  tm: number;
  regime: string;
  label: string;
  confirms: string[];
  weights: AgentWeights;
}

/** 跌势确认 4 项判定 */
export function checkConfirms(input: RegimeInput): string[] {
  const hit: string[] = [];
  if (input.sectorAdvRatio !== undefined && input.sectorAdvRatio < 0.30) hit.push("板块涨跌比<0.30");
  if (input.limitDownCount > 10) hit.push("跌停>10只");
  if (input.overnightIdxAvg !== undefined && input.overnightIdxAvg !== null && input.overnightIdxAvg <= -0.5) {
    hit.push("隔夜外部指数≤-0.5%");
  }
  if (input.stockAdvRatio !== undefined && input.stockAdvRatio < 0.30) hit.push("个股涨跌比<0.30");
  return hit;
}

/** 市场环境判定 */
export function judgeRegime(input: RegimeInput): RegimeResult {
  const tm = trimmedMean(input.openPcts);
  const confirms = checkConfirms(input);
  let regime: string;
  let label: string;

  if (tm <= -0.25) {
    if (confirms.length >= 3) {
      regime = tm <= -0.8 ? "大跌" : "下跌";
      label = "竞价极端偏弱";
    } else if (confirms.length >= 1) {
      regime = "震荡偏弱";
      label = "竞价偏弱";
    } else {
      regime = "超卖反弹";
      label = "竞价偏弱（无确认）";
    }
  } else if (tm >= 0.25) {
    if (tm >= 0.8) {
      regime = "大涨";
    } else if (confirms.length === 0) {
      regime = "上涨";
    } else {
      regime = "震荡偏强";
    }
    label = "竞价偏强";
  } else {
    regime = "震荡均衡";
    label = "震荡";
  }

  return { tm, regime, label, confirms, weights: REGIME_WEIGHTS[regime] ?? DEFAULT_WEIGHTS };
}
