/**
 * QuantDesk 全局类型定义
 * 数据源字段映射见 SPEC.md 第 1 节
 */

/** 全市场快照（个股）—— 字段名统一为语义化命名 */
export interface Quote {
  code: string;        // 证券代码，如 000001.SZ
  name?: string;       // 名称
  open: number;        // o 开盘价
  high: number;        // h 最高
  low: number;         // l 最低
  price: number;       // p 现价
  preClose: number;    // yc 昨收
  pct: number;         // pc 涨跌幅 %
  amount: number;      // cje 成交额（元）
  volume: number;      // v 成交量（手）
  turnover: number;    // hs 换手率 %
  volumeRatio: number; // lb 量比
  amplitude: number;   // zf 振幅 %
  pe?: number;         // pe 市盈率
  pb?: number;         // sjl 市净率
  circMcap?: number;   // lt 流通市值（元）
  totalMcap?: number;  // sz 总市值（元）
  pct60?: number;      // zdf60 近60日涨幅 %
  industry?: string;   // 所属行业（申万/板块归属）
}

/** K 线（日线） */
export interface KlineBar {
  date: string;   // yyyy-MM-dd
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // 手
  amount?: number;
}

/** 资金流向（单日） */
export interface MoneyFlow {
  date: string;
  netMain: number; // 主力净流入（元，特大+大单）
}

/** 财务指标（近一期） */
export interface FinanceMetrics {
  roe?: number;        // 净资产收益率 %
  yoyProfit?: number;  // 净利润同比 %
  yoyRevenue?: number; // 营收同比 %
  netMargin?: number;  // 净利率 %
  debtRatio?: number;  // 资产负债率 %
}

/** 公告 */
export interface Announcement {
  time: string;
  title: string;
}

/** 个股所属板块 */
export interface SectorInfo {
  industry?: string;   // 行业
  concepts: string[];  // 概念标签
}

/** 竞价信号（早盘抢筹） */
export interface AuctionSignal {
  grabAmount?: number;   // 竞价抢筹金额（元）
  grabPct?: number;      // 抢筹涨幅 %
  grabRankPct?: number;  // 抢筹金额在全市场的分位 0~1（越小越靠前）
  auctionVolRatio?: number; // 竞价量/近5日均量（缺省时用快照量比近似）
  openPct: number;       // 开盘涨幅 % = (open/preClose-1)*100
}

/** Phase 2 深度评估所需的个股上下文（引擎纯函数输入，缺省字段走中性值） */
export interface StockContext {
  quote: Quote;
  kline?: KlineBar[];          // 近 60~250 日（不含今日），新→旧或旧→新均可，引擎内部排序
  moneyFlow?: MoneyFlow[];     // 近 5 日主力净流入
  finance?: FinanceMetrics;
  announcements?: Announcement[]; // 近 3 日公告
  auction?: AuctionSignal;
  prevLimitUp?: boolean;   // 前日是否涨停
  prevAmplitude?: number;  // 前日振幅 %
  streak?: number;         // 连板数
  isST?: boolean;          // ST/退市标记
  /** 板块共振上下文（由流水线按板块聚合后填入） */
  sectorCtx?: {
    peersSelected: number; // 同板块同时入选数量
    rankInSector: number;  // 板块内排名（按 Phase1 基础分，1 起）
    sectorPct: number;     // 板块涨幅 %
    hotSector: boolean;    // 命中当日竞价强势板块
    weakSector: boolean;   // 命中弱势板块
  };
}

/** 引擎可调参数（UI 可修改，默认值见 SPEC 2.1~2.4） */
export interface EngineConfig {
  minAmount: number;      // 成交额门槛（元）默认 5,000,000
  minTurnover: number;    // 换手率门槛 % 默认 0.5
  minVolumeRatio: number; // 量比门槛 默认 1.0（0 = 关闭）
  minPrice: number;       // 价格下限 默认 2
  maxPrice: number;       // 价格上限 默认 100
  phase1Limit: number;    // Phase1 截断数量 默认 200
  topN: 4 | 8 | 12;       // 行业分散输出数量
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  minAmount: 5_000_000,
  minTurnover: 0.5,
  minVolumeRatio: 1.0,
  minPrice: 2,
  maxPrice: 100,
  phase1Limit: 200,
  topN: 8,
};

/** Agent 权重（ethan/lucas/edwin/sophia/mia） */
export interface AgentWeights {
  ethan: number;
  lucas: number;
  edwin: number;
  sophia: number;
  mia: number;
}

/** 单个 agent 评分结果 */
export interface AgentScore {
  score: number;           // 0-100
  details: Record<string, number | string | string[]>;
}

/** 个股最终评分结果 */
export interface ScoredStock {
  code: string;
  name?: string;
  industry?: string;
  quote: Pick<Quote, "price" | "pct" | "open" | "preClose" | "amount" | "turnover" | "volumeRatio" | "amplitude">;
  openPct: number;          // 开盘涨幅 %
  finalScore: number;       // -Infinity 表示被熔断
  vetoed: boolean;
  vetoReasons: string[];
  sophiaPenalty: number;
  penaltyReasons: string[];
  agents: {
    ethan: AgentScore;
    lucas: AgentScore;
    edwin: AgentScore;
    sophia: AgentScore;
    mia: AgentScore;
  };
  t0: {
    t0: number;             // 0.5~1.5
    catalyst: number;
    safety: number;
    confirm: number;
  };
  t0Neutral?: boolean;      // 无竞价数据时段 T0 落中性 1.0 时标注 true
  agentBase: number;
  t0Norm: number;
}

/** 数据源状态（用于降级提示） */
export type DataSource = "fuyao" | "tushare" | "neutral";

export interface SnapshotResult {
  quotes: Quote[];
  source: DataSource;
  degraded: boolean;
  tradeDate?: string;
  message?: string;
}
