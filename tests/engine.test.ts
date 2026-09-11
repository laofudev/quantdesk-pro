/**
 * 引擎单元测试（node:test + tsx）
 * 覆盖：final 合成（sophia veto / 高开9.5%×0.3 / 行业分散 TopN）、sophia 熔断规则、
 *       regime 判定、t0 分档、phase1 过滤。
 * 引擎为纯函数，测试无网络依赖。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { judgeRegime, trimmedMean, REGIME_WEIGHTS, DEFAULT_WEIGHTS } from "../lib/engine/regime";
import { phase1Filter, isBSE, isSTName } from "../lib/engine/phase1";
import { checkSophia } from "../lib/engine/sophia";
import { scoreT0 } from "../lib/engine/t0";
import { synthesize, diversify } from "../lib/engine/final";
import type { Quote, ScoredStock, StockContext } from "../lib/types";
import { DEFAULT_ENGINE_CONFIG } from "../lib/types";

/* ---------------- 构造工具 ---------------- */

function makeQuote(over: Partial<Quote> = {}): Quote {
  return {
    code: "000001.SZ", name: "测试股", open: 10.5, high: 10.8, low: 10.2,
    price: 10.6, preClose: 10, pct: 6, amount: 1e8, volume: 1e5,
    turnover: 3, volumeRatio: 2, amplitude: 5, ...over,
  };
}

function makeCtx(over: Partial<StockContext> = {}): StockContext {
  return { quote: makeQuote(), ...over };
}

function makeScored(code: string, score: number, industry?: string): ScoredStock {
  return {
    code, industry, openPct: 2, finalScore: score, vetoed: false,
    vetoReasons: [], sophiaPenalty: 0, penaltyReasons: [],
    quote: { price: 10, pct: 2, open: 10, preClose: 9.8, amount: 1e8, turnover: 2, volumeRatio: 2, amplitude: 3 },
    agents: {
      ethan: { score: 60, details: {} }, lucas: { score: 60, details: {} },
      edwin: { score: 60, details: {} }, sophia: { score: 100, details: {} }, mia: { score: 50, details: {} },
    },
    t0: { t0: 1, catalyst: 1, safety: 1, confirm: 1 },
    agentBase: 60, t0Norm: 50,
  };
}

/** 近 60 日平稳 K 线（close 全为 10，振幅 2%） */
function flatKline(n = 60) {
  return Array.from({ length: n }, (_, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, "0")}`,
    open: 10, high: 10.1, low: 9.9, close: 10, volume: 1000,
  }));
}

/* ---------------- regime ---------------- */

test("trimmedMean 去掉首尾各 2%", () => {
  const values = Array.from({ length: 100 }, (_, i) => i); // 0..99
  // 去掉首尾各 2 个 → 2..97 均值 = 49.5
  assert.equal(trimmedMean(values, 0.02), 49.5);
  assert.equal(trimmedMean([], 0.02), 0);
});

test("regime：TM≤-0.25% 且确认≥3 项 → 竞价极端偏弱", () => {
  const r = judgeRegime({
    openPcts: Array(100).fill(-1.2),
    sectorAdvRatio: 0.2, limitDownCount: 30, stockAdvRatio: 0.2, overnightIdxAvg: -1,
  });
  assert.equal(r.label, "竞价极端偏弱");
  assert.equal(r.regime, "大跌");
  assert.equal(r.confirms.length, 4);
  assert.deepEqual(r.weights, REGIME_WEIGHTS["大跌"]);
});

test("regime：确认 1~2 项 → 竞价偏弱（震荡偏弱）", () => {
  const r = judgeRegime({
    openPcts: Array(100).fill(-0.4),
    sectorAdvRatio: 0.5, limitDownCount: 20, stockAdvRatio: 0.5, overnightIdxAvg: 0,
  });
  assert.equal(r.label, "竞价偏弱");
  assert.equal(r.regime, "震荡偏弱");
});

test("regime：低开但无确认 → 超卖反弹；TM≥+0.25% → 偏强；其余震荡", () => {
  assert.equal(judgeRegime({ openPcts: Array(100).fill(-0.4), limitDownCount: 0, stockAdvRatio: 0.8, sectorAdvRatio: 0.8 }).regime, "超卖反弹");
  assert.equal(judgeRegime({ openPcts: Array(100).fill(0.3), limitDownCount: 0 }).regime, "上涨");
  assert.equal(judgeRegime({ openPcts: Array(100).fill(1.0), limitDownCount: 0 }).regime, "大涨");
  assert.equal(judgeRegime({ openPcts: Array(100).fill(0), limitDownCount: 0 }).regime, "震荡均衡");
});

test("regime 权重表：9 档 + default 权重各维度求和≈1", () => {
  for (const [k, w] of Object.entries(REGIME_WEIGHTS)) {
    const sum = w.ethan + w.lucas + w.edwin + w.sophia + w.mia;
    assert.ok(Math.abs(sum - 1) < 1e-9, `${k} 权重和应为 1，实际 ${sum}`);
  }
  const d = DEFAULT_WEIGHTS;
  assert.ok(Math.abs(d.ethan + d.lucas + d.edwin + d.sophia + d.mia - 1) < 1e-9);
});

/* ---------------- phase1 ---------------- */

test("phase1：流动性/换手/北交所/ST/量比/价格过滤", () => {
  assert.ok(isBSE("830799.BJ") && isBSE("430047") && isBSE("920001"));
  assert.ok(!isBSE("000001.SZ"));
  assert.ok(isSTName("ST 某某") && isSTName("XX退") && !isSTName("平安银行"));

  const quotes = [
    makeQuote({ code: "000001.SZ" }),                                            // 通过
    makeQuote({ code: "000002.SZ", amount: 1e6 }),                               // 成交额不足
    makeQuote({ code: "830799.BJ", amount: 1e8 }),                               // 北交所
    makeQuote({ code: "000003.SZ", name: "ST测试" }),                             // ST 名称
    makeQuote({ code: "000004.SZ", volumeRatio: 0.5 }),                          // 量比不足
    makeQuote({ code: "000005.SZ", price: 150, open: 150, high: 150, low: 148 }), // 超价格上限
  ];
  const r = phase1Filter(quotes, new Set(), DEFAULT_ENGINE_CONFIG);
  assert.equal(r.pool.length, 1);
  assert.equal(r.pool[0].code, "000001.SZ");
});

/* ---------------- sophia 熔断 ---------------- */

test("sophia 规则1：成交额 < 300 万 → 熔断", () => {
  const r = checkSophia(makeCtx({ quote: makeQuote({ amount: 2_999_999 }) }));
  assert.ok(r.veto);
  assert.ok(r.reasons.some((s) => s.includes("300万")));
});

test("sophia 规则2：ST/退市 → 熔断", () => {
  assert.ok(checkSophia(makeCtx({ isST: true })).veto);
  assert.ok(checkSophia(makeCtx({ quote: makeQuote({ name: "ST测试" }) })).veto);
});

test("sophia 规则3：偏离 5 日线 > 30% → 熔断", () => {
  // MA5=10，现价 13.5 → 偏离 35%
  const r = checkSophia(makeCtx({ kline: flatKline(), quote: makeQuote({ price: 13.5, high: 13.8, low: 13.2 }) }));
  assert.ok(r.veto);
  assert.ok(r.reasons.some((s) => s.includes("5日线")));
});

test("sophia 规则4：贴顶（距 20 日高点 <1%）→ 熔断", () => {
  // 20 日高点 10.1，现价 10.05 → 距离 -0.5%
  const r = checkSophia(makeCtx({ kline: flatKline(), quote: makeQuote({ price: 10.05, high: 10.1, low: 10 }) }));
  assert.ok(r.veto);
  assert.ok(r.reasons.some((s) => s.includes("高点")));
});

test("sophia 规则5：一致性陷阱（前日涨停+高开>7%+竞价量比<10）→ 熔断", () => {
  const r = checkSophia(makeCtx({
    prevLimitUp: true,
    quote: makeQuote({ open: 10.8, preClose: 10, volumeRatio: 5 }),
  }));
  assert.ok(r.veto);
  assert.ok(r.reasons.some((s) => s.includes("一致性陷阱")));
  // 缺一条件则不熔断
  assert.ok(!checkSophia(makeCtx({ prevLimitUp: true, quote: makeQuote({ open: 10.8, preClose: 10, volumeRatio: 15 }) })).veto);
  assert.ok(!checkSophia(makeCtx({ prevLimitUp: false, quote: makeQuote({ open: 10.8, preClose: 10, volumeRatio: 5 }) })).veto);
});

test("sophia 规则6：前日振幅 > 15% → 熔断", () => {
  assert.ok(checkSophia(makeCtx({ prevAmplitude: 16 })).veto);
  assert.ok(!checkSophia(makeCtx({ prevAmplitude: 10 })).veto);
});

test("sophia 非熔断扣分：≥3 连板 -30；利空公告 -20", () => {
  const r1 = checkSophia(makeCtx({ streak: 3 }));
  assert.ok(!r1.veto);
  assert.equal(r1.penalty, 30);
  const r2 = checkSophia(makeCtx({ announcements: [{ time: "2024-01-01", title: "关于股东减持计划的公告" }] }));
  assert.equal(r2.penalty, 20);
  const r3 = checkSophia(makeCtx({ streak: 4, announcements: [{ time: "2024-01-01", title: "收到立案告知书" }] }));
  assert.equal(r3.penalty, 50);
});

test("sophia：健康标的不熔断不扣分", () => {
  const r = checkSophia(makeCtx({ kline: flatKline(), quote: makeQuote({ price: 10.3, high: 10.4, low: 10.1 }) }));
  // 现价 10.3 高于 20 日高点 10.1 → 创新高（d20 = +2% > -1%）会触发贴顶规则
  // 修正预期：突破新高视为贴顶，应熔断
  assert.ok(r.veto);
  const r2 = checkSophia(makeCtx({ kline: flatKline(), quote: makeQuote({ price: 9.9, high: 10, low: 9.8 }) }));
  assert.ok(!r2.veto);
  assert.equal(r2.penalty, 0);
});

/* ---------------- t0 ---------------- */

test("t0 三维分档与合成", () => {
  // 前5% 抢筹 + 高开1.5% + 量比4且涨幅2% → 1.5*0.5+1.3*0.3+1.3*0.2 = 1.4
  const r = scoreT0({ grabRankPct: 0.03, openPct: 1.5, auctionVolRatio: 4, pct: 2 });
  assert.equal(r.catalyst, 1.5);
  assert.equal(r.safety, 1.3);
  assert.equal(r.confirm, 1.3);
  assert.ok(Math.abs(r.t0 - 1.4) < 1e-9);
  // 无竞价数据 → 催化剂中性 1.0
  assert.equal(scoreT0({ openPct: 1 }).catalyst, 1.0);
  // 高开 8% → 安全性 0.6；低开 → 0.8；后 20% → 0.7
  assert.equal(scoreT0({ openPct: 8 }).safety, 0.6);
  assert.equal(scoreT0({ openPct: -1 }).safety, 0.8);
  assert.equal(scoreT0({ grabRankPct: 0.9, openPct: 2 }).catalyst, 0.7);
  assert.equal(scoreT0({ grabRankPct: 0.15, openPct: 2 }).catalyst, 1.2);
  // 信号确认：量比 0.5 → 0.8；量比 2 → 1.1
  assert.equal(scoreT0({ openPct: 2, auctionVolRatio: 0.5 }).confirm, 0.8);
  assert.equal(scoreT0({ openPct: 2, auctionVolRatio: 2 }).confirm, 1.1);
});

/* ---------------- final 合成 ---------------- */

const W = { ethan: 0.25, lucas: 0.15, edwin: 0.2, sophia: 0.25, mia: 0.15 }; // default 权重

function synthInput(over: Partial<Parameters<typeof synthesize>[0]> = {}): Parameters<typeof synthesize>[0] {
  return {
    agents: {
      ethan: { score: 80, details: {} }, lucas: { score: 60, details: {} },
      edwin: { score: 70, details: {} }, sophia: { score: 100, details: {} }, mia: { score: 50, details: {} },
    },
    weights: W,
    t0: { t0: 1.2, catalyst: 1.2, safety: 1.3, confirm: 1.1 },
    sophia: { veto: false, reasons: [], penalty: 0, penaltyReasons: [] },
    openPct: 2,
    ...over,
  };
}

test("final 合成：agent_base 与 t0_norm 公式", () => {
  const r = synthesize(synthInput());
  // agent_base = 80*.25 + 60*.15 + 70*.2 + 100*.25 + 50*.15 = 20+9+14+25+7.5 = 75.5
  assert.ok(Math.abs(r.agentBase - 75.5) < 1e-9);
  // t0_norm = (1.2-0.5)*100 = 70
  assert.ok(Math.abs(r.t0Norm - 70) < 1e-9);
  // final = 70*0.6 + 75.5*0.4 - 0 = 42 + 30.2 = 72.2
  assert.ok(Math.abs(r.finalScore - 72.2) < 1e-9);
  assert.ok(!r.vetoed);
});

test("final 合成：sophia veto → -∞", () => {
  const r = synthesize(synthInput({ sophia: { veto: true, reasons: ["ST/退市标的"], penalty: 0, penaltyReasons: [] } }));
  assert.equal(r.finalScore, Number.NEGATIVE_INFINITY);
  assert.ok(r.vetoed);
});

test("final 合成：sophia 罚分只经 agent_base 的 sophia 维度生效一次（SPEC V3 公式无额外 -penalty）", () => {
  // 3 连板 -30 → scoreSophia 给 sophia 维度分 100-30=70，
  // 罚分随权重折进 agent_base（w_s=0.25 时折损 7.5），synthesize 不再额外全额扣 30
  const agents = {
    ethan: { score: 80, details: {} }, lucas: { score: 60, details: {} },
    edwin: { score: 70, details: {} }, sophia: { score: 70, details: {} }, mia: { score: 50, details: {} },
  };
  const r = synthesize(synthInput({ agents, sophia: { veto: false, reasons: [], penalty: 30, penaltyReasons: ["3连板高位 -30"] } }));
  // agent_base = 80*.25 + 60*.15 + 70*.2 + 70*.25 + 50*.15 = 68
  assert.ok(Math.abs(r.agentBase - 68) < 1e-9);
  // final = 70*0.6 + 68*0.4 = 69.2（不再 -30）
  assert.ok(Math.abs(r.finalScore - 69.2) < 1e-9);
});

test("final 合成：开盘涨幅 ≥9.5% → final × 0.30", () => {
  const r95 = synthesize(synthInput({ openPct: 9.5 }));
  assert.ok(Math.abs(r95.finalScore - 72.2 * 0.3) < 1e-9);
  const r949 = synthesize(synthInput({ openPct: 9.49 }));
  assert.ok(Math.abs(r949.finalScore - 72.2) < 1e-9); // 9.49% 不触发
});

/* ---------------- 行业分散 ---------------- */

test("行业分散：同行业最多 ⌈N/4⌉ 只", () => {
  // Top4 → 同行业最多 1 只
  const stocks = [
    makeScored("A1", 90, "电子"), makeScored("A2", 85, "电子"), makeScored("A3", 80, "电子"),
    makeScored("B1", 75, "医药"), makeScored("C1", 70, "计算机"), makeScored("D1", 65, "有色"),
  ];
  const r4 = diversify(stocks, 4);
  assert.equal(r4.length, 4);
  const inds = r4.map((s) => s.industry);
  assert.deepEqual(inds, ["电子", "医药", "计算机", "有色"]);

  // Top12 → 同行业最多 3 只
  const many = Array.from({ length: 12 }, (_, i) => makeScored(`E${i}`, 100 - i, "电子"));
  const r12 = diversify(many, 12);
  assert.ok(r12.length <= 3, "全同行业时 Top12 最多选 3 只");
});

test("行业分散：Top3 必须三个不同行业", () => {
  const stocks = [
    makeScored("A1", 90, "电子"), makeScored("A2", 89, "电子"), makeScored("A3", 88, "电子"),
    makeScored("B1", 10, "医药"), makeScored("C1", 5, "计算机"), makeScored("D1", 1, "有色"),
  ];
  const r = diversify(stocks, 8);
  assert.ok(r.length >= 3);
  const top3Inds = r.slice(0, 3).map((s) => s.industry);
  assert.equal(new Set(top3Inds).size, 3, "Top3 必须三个不同行业");
  // 即使 A2/A3 分数远高于 B1/C1，也被分散规则跳过
  assert.deepEqual(top3Inds, ["电子", "医药", "计算机"]);
});

test("行业分散：行业缺失归入'未知'桶且受限", () => {
  const stocks = Array.from({ length: 5 }, (_, i) => makeScored(`N${i}`, 100 - i, undefined));
  const r = diversify(stocks, 4);
  assert.equal(r.length, 1, "未知行业 Top4 最多 1 只");
});
