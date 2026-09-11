/**
 * Phase 0 市场环境判定（Mia/Edwin regime）
 * 复刻自 Alpha-X 公开前端逻辑，仅供学习。
 * judgeRegime 为纯函数；权重表优先取 Alpha-X 在线预设（resolvePresetWeights），
 * 不可达时回退到下方本地快照。
 */
import type { AgentWeights } from "@/lib/types";

/** 9 档 regime 权重本地快照（2025-11 与 /api/weights/preset 在线值核对一致，仅作降级） */
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

export interface PresetWeights {
  weights: Record<string, AgentWeights>;
  defaultWeights: AgentWeights;
  from: "remote" | "local";
}

const PRESET_URL = "https://alphax-lab.com/api/weights/preset";
const PRESET_TTL = 6 * 3600 * 1000; // 6 小时缓存
let presetCache: { at: number; data: PresetWeights } | null = null;

function asWeights(v: unknown): AgentWeights | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const w: AgentWeights = {
    ethan: Number(o.ethan), lucas: Number(o.lucas), edwin: Number(o.edwin),
    sophia: Number(o.sophia), mia: Number(o.mia),
  };
  if (!Object.values(w).every((n) => Number.isFinite(n))) return null;
  // 权重和必须为 1，否则合成会被静默缩放
  const sum = w.ethan + w.lucas + w.edwin + w.sophia + w.mia;
  return Math.abs(sum - 1) < 1e-6 ? w : null;
}

/** 校验在线预设 JSON 结构，不合法返回 null */
function normalizePreset(json: unknown): { weights: Record<string, AgentWeights>; defaultWeights: AgentWeights } | null {
  if (!json || typeof json !== "object") return null;
  const raw = (json as Record<string, unknown>).weights;
  if (!raw || typeof raw !== "object") return null;
  const weights: Record<string, AgentWeights> = {};
  for (const [k, v] of Object.entries(raw)) {
    const w = asWeights(v);
    if (!w) return null;
    weights[k] = w;
  }
  const defaultWeights = asWeights((json as Record<string, unknown>).default_weights);
  if (!defaultWeights) return null;
  return { weights, defaultWeights };
}

/**
 * 解析权重表：优先 Alpha-X 在线预设（6 小时内存缓存），
 * 网络不可达/超时/结构不合法时回退本地快照。绝不抛错。
 */
export async function resolvePresetWeights(): Promise<PresetWeights> {
  if (presetCache && Date.now() - presetCache.at < PRESET_TTL) return presetCache.data;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(PRESET_URL, { signal: ctrl.signal, cache: "no-store" });
    if (res.ok) {
      const parsed = normalizePreset(await res.json());
      if (parsed) {
        presetCache = { at: Date.now(), data: { ...parsed, from: "remote" } };
        return presetCache.data;
      }
    }
  } catch {
    // 在线预设不可达 → 本地快照（失败不缓存，下次请求即重试远程）
  } finally {
    clearTimeout(timer);
  }
  return { weights: REGIME_WEIGHTS, defaultWeights: DEFAULT_WEIGHTS, from: "local" };
}

/** 截尾均值：去掉首尾各 trimRatio 后的均值（SPEC 2.1 TM 定义） */
export function trimmedMean(values: number[], trimRatio = 0.02): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const k = Math.floor(sorted.length * trimRatio);
  const core = sorted.slice(k, sorted.length - k);
  if (core.length === 0) return sorted[Math.floor(sorted.length / 2)];
  return core.reduce((s, v) => s + v, 0) / core.length;
}

export interface RegimeInput {
  openPcts: number[];        // 全市场开盘涨幅数组 %（open vs yc）
  sectorAdvRatio?: number;   // 板块涨跌比（上涨板块数/下跌板块数），缺省不参与
  limitDownCount: number;    // 跌停家数
  stockAdvRatio?: number;    // 个股涨跌比（上涨/下跌），缺省不参与
  overnightIdxAvg?: number | null; // 隔夜外部指数均值 %（本地版可省略/手动输入）
}

export interface RegimeResult {
  tm: number;                // 截尾均值 %
  regime: string;            // 9 档 regime 名称
  label: string;             // 展示标签（竞价极端偏弱/偏弱/偏强/震荡）
  confirms: string[];        // 命中的跌势确认项
  weights: AgentWeights;     // 对应 agent 权重
}

/** 跌势确认 4 项判定（SPEC 2.1） */
export function checkConfirms(input: RegimeInput): string[] {
  const hit: string[] = [];
  if (input.sectorAdvRatio !== undefined && input.sectorAdvRatio < 0.30) hit.push("板块涨跌比<0.30");
  if (input.limitDownCount > 10) hit.push("跌停>10只");
  if (input.overnightIdxAvg !== undefined && input.overnightIdxAvg !== null && input.overnightIdxAvg <= -0.5) hit.push("隔夜外部指数≤-0.5%");
  if (input.stockAdvRatio !== undefined && input.stockAdvRatio < 0.30) hit.push("个股涨跌比<0.30");
  return hit;
}

/**
 * 市场环境判定（SPEC 2.1）：
 * TM≤-0.25% 且确认≥3 项 → 竞价极端偏弱；≥1 项 → 竞价偏弱；
 * TM≥+0.25% 对称偏强；其余震荡。
 */
export function judgeRegime(input: RegimeInput, preset?: PresetWeights): RegimeResult {
  const tm = trimmedMean(input.openPcts);
  const confirms = checkConfirms(input);
  let regime: string;
  let label: string;

  if (tm <= -0.25) {
    if (confirms.length >= 3) {
      // 竞价极端偏弱：按幅度细分 大跌/下跌
      regime = tm <= -0.8 ? "大跌" : "下跌";
      label = "竞价极端偏弱";
    } else if (confirms.length >= 1) {
      regime = "震荡偏弱";
      label = "竞价偏弱";
    } else {
      // 低开但无跌势确认 → 视为超卖反弹环境
      regime = "超卖反弹";
      label = "竞价偏弱（无确认）";
    }
  } else if (tm >= 0.25) {
    // 对称偏强
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

  const table = preset?.weights ?? REGIME_WEIGHTS;
  return { tm, regime, label, confirms, weights: table[regime] ?? preset?.defaultWeights ?? DEFAULT_WEIGHTS };
}
