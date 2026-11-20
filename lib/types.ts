/**
 * QuantDesk Alpha · 全局类型定义
 *
 * 数据源：仅扶摇 Fuyao（同花顺）—— 用户自填 API Key，服务端按会话隔离。
 * 字段语义化命名，缺失一律走中性值（引擎内兜底），绝不让上游异常冒泡。
 */

/** 全市场快照（个股） */
export interface Quote {
  code: string;         // 证券代码，如 000001.SZ
  name?: string;        // 名称（扶摇 meta/tickers/list 全市场一次性取回）
  open: number;         // 开盘价
  high: number;         // 最高价
  low: number;          // 最低价
  price: number;        // 现价
  preClose: number;     // 昨收
  pct: number;          // 涨跌幅 %
  amount: number;       // 成交额（元）
  volume: number;       // 成交量（股）
  turnover: number;     // 换手率 %（由 成交额/流通市值 推导，扶摇无直接字段）
  volumeRatio: number;  // 量比（由候选池 K 线推导；未推导时为 0）
  amplitude: number;    // 振幅 %
  pe?: number;          // 市盈率 TTM
  pb?: number;          // 市净率 MRQ
  circMcap?: number;    // 流通市值（元）
  totalMcap?: number;   // 总市值（元）
  pct60?: number;       // 近 60 日涨幅 %（由 K 线推导）
  industry?: string;    // 所属行业（由同花顺 390 个行业指数成分反查归并）
  floatMcap?: number;   // 流通市值（扶摇 auction/snapshot 直接字段，优先于推导）
  /** 装配阶段临时挂载的 K 线（仅服务端流水线内部使用，不下发前端） */
  klineCache?: KlineBar[];
}

/** K 线（日线，前复权） */
export interface KlineBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount?: number;
}

/** 竞价信号（早盘抢筹）—— 扶摇 auction/snapshot 原生字段 */
export interface AuctionSignal {
  grabAmount?: number;      // 竞价成交额（元）
  grabPct?: number;         // 竞价涨幅 %
  grabRankPct?: number;     // 竞价抢筹额全市场分位 0~1（越小越靠前）
  auctionVolRatio?: number; // 竞价量比
  auctionTurnoverPct?: number; // 竞价换手率 %
  floatMcap?: number;       // 流通市值（元）
  openPct: number;          // 开盘涨幅 % = (open/preClose-1)*100
}

/** Phase 2 深度评估上下文（引擎纯函数输入，缺省字段走中性值） */
export interface StockContext {
  quote: Quote;
  kline?: KlineBar[];
  finance?: FinanceMetrics;
  announcements?: Announcement[];
  auction?: AuctionSignal;
  /** 资金强度代理（纯扶摇口径：量能扩张 + 竞价抢筹分位 + 连板高度） */
  capital?: CapitalProxy;
  prevLimitUp?: boolean;
  prevAmplitude?: number;
  streak?: number;
  isST?: boolean;
  /** 板块共振上下文（由流水线按行业聚合后填入） */
  sectorCtx?: {
    peersSelected: number;
    rankInSector: number;
    sectorPct: number;
    hotSector: boolean;
    weakSector: boolean;
  };
}

/** 资金强度代理（扶摇可得的等价信号，替代逐笔资金流） */
export interface CapitalProxy {
  /** 近 3 日均额 ÷ 前 2 日均额（量能扩张倍数） */
  volumeExpansion?: number;
  /** 竞价抢筹金额全市场分位 0~1（越小越靠前） */
  grabRankPct?: number;
  /** 连板高度 */
  streak?: number;
  /** 竞价量比 */
  auctionVolRatio?: number;
}

/** 财务指标（近一期报告期） */
export interface FinanceMetrics {
  roe?: number;         // 净资产收益率 %
  yoyProfit?: number;   // 归母净利润同比 %
  yoyRevenue?: number;  // 营业收入同比 %
  netMargin?: number;   // 净利率 %
  debtRatio?: number;   // 资产负债率 %
}

/** 公告 / 异动（合并为统一文本载体，供关键词扫描） */
export interface Announcement {
  time: string;
  title: string;
}

/** 个股所属行业与概念标签 */
export interface SectorInfo {
  industry?: string;
  concepts: string[];
}

/** 引擎可调参数（UI 可修改） */
export interface EngineConfig {
  minAmount: number;      // 成交额门槛（元）默认 5,000,000
  minTurnover: number;    // 换手率门槛 % 默认 0.5
  minVolumeRatio: number; // 量比门槛 默认 1.0（0 = 关闭）
  minPrice: number;       // 价格下限 默认 2
  maxPrice: number;       // 价格上限 默认 100
  phase1Limit: number;    // Phase1 截断数量 默认 200
  topN: 4 | 8 | 12;       // 输出数量
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

/** Agent 权重 */
export interface AgentWeights {
  ethan: number;
  lucas: number;
  edwin: number;
  sophia: number;
  mia: number;
}

/** 单个 agent 评分结果 */
export interface AgentScore {
  score: number;
  details: Record<string, number | string | string[]>;
}

/** 个股最终评分结果 */
export interface ScoredStock {
  code: string;
  name?: string;
  industry?: string;
  quote: Pick<Quote, "price" | "pct" | "open" | "preClose" | "amount" | "turnover" | "volumeRatio" | "amplitude">;
  openPct: number;
  finalScore: number;      // -Infinity 表示被熔断
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
  t0: { t0: number; catalyst: number; safety: number; confirm: number };
  t0Neutral?: boolean;
  agentBase: number;
  t0Norm: number;
}

/** 数据源状态 */
export type DataSource = "fuyao" | "neutral";

export interface SnapshotResult {
  quotes: Quote[];
  source: DataSource;
  degraded: boolean;
  tradeDate?: string;
  message?: string;
}

/** 流水线响应 */
export interface PipelineResponse {
  results: ScoredStock[];
  vetoed: ScoredStock[];
  regime: RegimePayload | null;
  stats: PipelineStats | null;
  topN: number;
  config: EngineConfig;
  source: DataSource;
  degraded: boolean;
  t0Neutral: boolean;
  message?: string;
  elapsedMs: number;
}

export interface RegimePayload {
  tm: number;
  regime: string;
  label: string;
  confirms: string[];
  weights: AgentWeights;
  stats: {
    sampleSize: number;
    upCount: number;
    downCount: number;
    limitUpCount: number;
    limitDownCount: number;
    stockAdvRatio: number | null;
  };
  emotion: EmotionPoint | null;
  emotionSeries?: EmotionPoint[];
  source: DataSource;
  degraded: boolean;
  tradeDate?: string;
  message?: string;
}

export interface EmotionPoint {
  date: string;
  ztjs?: number;   // 涨停家数
  dtjs?: number;   // 跌停家数
  szbl?: number;   // 上涨比例 0~1
  dbcgl?: number;  // 打板成功率 0~1
  lbjs?: number;   // 最高连板高度
  lbgs?: number;   // 连板只数
  hot?: string[];
}

export interface PipelineStats {
  phase1: {
    total: number;
    byAmount: number;
    byTurnover: number;
    byBoard: number;
    byST: number;
    byVolumeRatio: number;
    byPrice: number;
  };
  poolSize: number;
  enriched: number;
  aliveCount: number;
  vetoCount: number;
  auctionMatched: number;
  benchmarkSize: number;
  industryMapped: number;
}
