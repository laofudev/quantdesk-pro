/**
 * Phase 1 初筛（全市场 → 股票池）
 * 纯函数，无网络依赖。
 *
 * 扶摇口径说明：换手率由「成交额 / 流通市值」推导，量比由 K 线推导。
 */
import type { EngineConfig, Quote } from "@/lib/types";

export interface Phase1Result {
  pool: (Quote & { baseScore: number })[];
  stats: {
    total: number;
    byAmount: number;
    byTurnover: number;
    byBoard: number;   // 剔除北交所后剩余
    byST: number;
    byVolumeRatio: number;
    byPrice: number;
  };
}

/** 是否北交所代码（8xxxxx / 4xxxxx / 92xxxx） */
export function isBSE(code: string): boolean {
  const s = code.split(".")[0];
  if (/\.BJ$/i.test(code)) return true;
  return /^(8|4|92)/.test(s);
}

/** 名称含 ST / 退 字样 */
export function isSTName(name?: string): boolean {
  if (!name) return false;
  return /ST|退/.test(name.toUpperCase());
}

/**
 * Phase1 基础分（量比 + 换手 + 涨幅弹性合成）—— 用于截断排序，非最终分
 */
export function baseScore(q: Quote): number {
  const lb = Math.min(Math.max(q.volumeRatio, 0), 10);   // 量比截断到 10
  const hs = Math.min(Math.max(q.turnover, 0), 20);      // 换手截断到 20%
  // 涨幅弹性：0~5% 温和最强，过高（>7%）透支，下跌无分
  let elasticity = 0;
  if (q.pct >= 0 && q.pct <= 5) elasticity = (5 - Math.abs(q.pct - 2)) * 4; // 峰值在 +2%
  else if (q.pct > 5 && q.pct <= 7) elasticity = 6;
  return lb * 10 + hs * 2 + elasticity;
}

/** Phase 1 过滤 + 基础分排序 + 截断（默认 ≤200 只进入 Phase 2） */
export function phase1Filter(quotes: Quote[], stCodes: Set<string>, cfg: EngineConfig): Phase1Result {
  const stats = { total: quotes.length, byAmount: 0, byTurnover: 0, byBoard: 0, byST: 0, byVolumeRatio: 0, byPrice: 0 };

  let list = quotes.filter((q) => q.amount >= cfg.minAmount);
  stats.byAmount = list.length;
  list = list.filter((q) => q.turnover >= cfg.minTurnover);
  stats.byTurnover = list.length;
  list = list.filter((q) => !isBSE(q.code));
  stats.byBoard = list.length;
  list = list.filter((q) => !stCodes.has(q.code) && !isSTName(q.name));
  stats.byST = list.length;
  if (cfg.minVolumeRatio > 0) list = list.filter((q) => q.volumeRatio >= cfg.minVolumeRatio);
  stats.byVolumeRatio = list.length;
  list = list.filter((q) => q.price >= cfg.minPrice && q.price <= cfg.maxPrice);
  stats.byPrice = list.length;

  const scored = list
    .map((q) => ({ ...q, baseScore: baseScore(q) }))
    .sort((a, b) => b.baseScore - a.baseScore);

  return { pool: scored.slice(0, cfg.phase1Limit), stats };
}
