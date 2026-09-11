/**
 * T0 竞价评分 V3（0.5~1.5）
 * T0 = 催化剂×0.5 + 安全性×0.3 + 信号确认×0.2（SPEC 2.3）
 * 复刻自 Alpha-X 公开前端逻辑，仅供学习。
 * 纯函数，无网络依赖。
 */

export interface T0Input {
  grabRankPct?: number;      // 竞价抢筹金额全市场分位 0~1（越小越靠前）
  openPct: number;           // 开盘涨幅 %
  auctionVolRatio?: number;  // 竞价量/近5日均量（缺省时用快照量比 lb 近似）
  pct?: number;              // 当前涨幅 %（信号确认用）
}

export interface T0Result {
  t0: number;
  catalyst: number;
  safety: number;
  confirm: number;
}

/** 催化剂：抢筹金额/涨幅排名分位：前5% → 1.5，前20% → 1.2，中位 → 1.0，后20% → 0.7；无竞价数据 → 1.0 中性 */
function catalyst(rankPct?: number): number {
  if (rankPct === undefined) return 1.0;
  if (rankPct <= 0.05) return 1.5;
  if (rankPct <= 0.20) return 1.2;
  if (rankPct <= 0.80) return 1.0;
  return 0.7;
}

/** 安全性：高开 0~3% → 1.3；3~5% → 1.1；5~7% → 0.9；>7% → 0.6；低开 → 0.8 */
function safety(openPct: number): number {
  if (openPct < 0) return 0.8;
  if (openPct <= 3) return 1.3;
  if (openPct <= 5) return 1.1;
  if (openPct <= 7) return 0.9;
  return 0.6;
}

/** 信号确认：竞价量/近5日均量 >3 且涨幅 0~5% → 1.3；>1.5 → 1.1；<0.8 → 0.8；其余 1.0 */
function confirm(volRatio: number | undefined, pct: number): number {
  if (volRatio === undefined || volRatio <= 0) return 1.0; // 无数据中性
  if (volRatio > 3 && pct >= 0 && pct <= 5) return 1.3;
  if (volRatio > 1.5) return 1.1;
  if (volRatio < 0.8) return 0.8;
  return 1.0;
}

export function scoreT0(input: T0Input): T0Result {
  const c = catalyst(input.grabRankPct);
  const s = safety(input.openPct);
  const cf = confirm(input.auctionVolRatio, input.pct ?? input.openPct);
  // SPEC 2.3 公式（复刻自 Alpha-X 公开前端逻辑，仅供学习）
  const t0 = c * 0.5 + s * 0.3 + cf * 0.2;
  return { t0: Math.round(t0 * 1000) / 1000, catalyst: c, safety: s, confirm: cf };
}
