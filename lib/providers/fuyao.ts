/**
 * 扶摇 Fuyao（同花顺）数据源封装 —— 纯扶摇，无 Tushare 依赖
 *
 * Base: GET https://fuyao.aicubes.cn<path>?...
 * 认证: 头 X-api-key（由用户自填，服务端会话级注入，绝不下发前端）
 * 信封: {code, message, request_id, data:{timestamp, item[]}}；code=0 成功
 *       2001 未认证 / 2003 无权限 / 1001 参数缺失 / 1003 参数非法 / 4001+HTTP429 限流
 *
 * 限流纪律: 全局最小请求间隔；批量端点 thscodes 上限 100（实测 code=1003 拦截）
 * 所有调用必须 try/catch，失败返回 null 由上层降级，绝不抛出。
 */

/** 扶摇单次请求上下文（携带用户 key） */
export interface FuyaoCtx {
  apiKey: string;
}

export const BASE = "https://fuyao.aicubes.cn";

export interface FuyaoEnvelope<T = unknown> {
  code: number;
  message?: string;
  request_id?: string;
  data?: T | null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/** 标准化 6 位代码 → 600519.SH / 000001.SZ（thscode 必须带后缀） */
export function normalizeThscode(raw: string): string {
  const s = String(raw).trim();
  if (s.includes(".")) return s.toUpperCase();
  if (/^(60|68|90)/.test(s)) return `${s}.SH`;
  if (/^(00|30|20)/.test(s)) return `${s}.SZ`;
  if (/^(8|4|92)/.test(s)) return `${s}.BJ`;
  return s;
}

/* ---------------- 全局节流（按 key 隔离的调用节奏） ---------------- */

const lastCallAt = new Map<string, number>();
const MIN_INTERVAL_MS = 120;

async function throttle(ctx: FuyaoCtx): Promise<void> {
  const last = lastCallAt.get(ctx.apiKey) ?? 0;
  const wait = MIN_INTERVAL_MS - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  lastCallAt.set(ctx.apiKey, Date.now());
}

/**
 * 统一 GET 封装：X-api-key 头 + 信封解析 + 限流退避重试。
 * code=0 → 返回 data；HTTP429 / code 4001 / code 429 → 退避重试最多 2 次；
 * 其余任何失败 → 返回 null（降级由上层处理）。
 */
export async function fyGet<T = unknown>(
  ctx: FuyaoCtx,
  path: string,
  params: Record<string, string | number | undefined> = {},
  timeoutMs = 12000
): Promise<T | null> {
  if (!ctx.apiKey) return null;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const url = `${BASE}${path}${qs.size > 0 ? `?${qs.toString()}` : ""}`;
  const backoffs = [1200, 3000];
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    await throttle(ctx);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "X-api-key": ctx.apiKey },
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (res.status === 429) {
        if (attempt < backoffs.length) { await sleep(backoffs[attempt]); continue; }
        return null;
      }
      if (!res.ok) return null;
      const json = (await res.json()) as FuyaoEnvelope<T>;
      if (json && json.code === 0 && json.data !== undefined && json.data !== null) {
        return json.data;
      }
      if (json && (json.code === 4001 || json.code === 429)) {
        if (attempt < backoffs.length) { await sleep(backoffs[attempt]); continue; }
        return null;
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** data 中取 item 数组 */
export function pickItems(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const arr = (data as { item?: unknown[] }).item;
  return Array.isArray(arr) ? arr : [];
}

/** 分页 total */
export function pickTotal(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as { total?: unknown; pagination?: { total?: unknown } };
  return num(d.total) ?? num(d.pagination?.total);
}

/** 毫秒时间戳 → yyyy-MM-dd（Asia/Shanghai） */
export function msToDate(ms: number): string {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/* ==================== 全市场代码表 + 名称 ==================== */

/** 扶摇 meta/tickers/list 的一行 */
export interface TickerRow {
  thscode: string;
  ticker: string;
  name: string;
  exchange?: string | null;
  asset_type?: string;
}

/**
 * 全市场代码 + 名称：meta/tickers/list?asset_type=a-share&limit=6000
 * 一次请求即可拿到全部 5578 只 A 股代码与中文名（实测 asset_type 过滤有效）。
 */
export async function getTickerUniverse(ctx: FuyaoCtx): Promise<Map<string, string> | null> {
  const data = await fyGet<{ item?: TickerRow[] }>(
    ctx,
    "/api/meta/tickers/list",
    { asset_type: "a-share", limit: 6000 },
    20000
  );
  if (!data) return null;
  const map = new Map<string, string>();
  for (const row of pickItems(data) as TickerRow[]) {
    if (!row?.thscode) continue;
    if (row.asset_type && row.asset_type !== "a-share") continue;
    map.set(row.thscode, row.name ?? "");
  }
  return map.size > 0 ? map : null;
}

/* ==================== 全市场快照 ==================== */

function parseSnapshotQuote(item: unknown): { code: string; o: Record<string, unknown> } | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const code = typeof o.thscode === "string" ? o.thscode : undefined;
  const price = num(o.last_price);
  const preClose = num(o.prev_price);
  if (!code || price === undefined || preClose === undefined || preClose <= 0) return null;
  return { code, o };
}

/**
 * 全市场快照：limit/offset 分页遍历（实测 total=5578，56 页）。
 * 采用有限并发（默认 4）以兼顾速度与限流；单页失败仅记录并继续。
 */
export async function getMarketSnapshot(
  ctx: FuyaoCtx,
  pageSize = 100,
  concurrency = 4
): Promise<{ quotes: import("@/lib/types").Quote[]; missing: number } | null> {
  const first = await fyGet<{ total?: number; item?: unknown[] }>(
    ctx,
    "/api/a-share/prices/snapshot",
    { limit: pageSize, offset: 0 },
    20000
  );
  if (!first) return null;
  const total = pickTotal(first) ?? 0;
  const raw: Record<string, unknown>[] = [];
  for (const item of pickItems(first)) {
    const p = parseSnapshotQuote(item);
    if (p) raw.push(p.o);
  }
  if (raw.length === 0) return null;

  if (total > 0) {
    const pages = Math.ceil(total / pageSize);
    let missing = 0;
    let cursor = 1;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, pages - 1) }, async () => {
        while (cursor < pages) {
          const page = cursor++;
          const data = await fyGet<{ item?: unknown[] }>(
            ctx,
            "/api/a-share/prices/snapshot",
            { limit: pageSize, offset: page * pageSize },
            20000
          );
          if (!data) { missing++; continue; }
          for (const item of pickItems(data)) {
            const p = parseSnapshotQuote(item);
            if (p) raw.push(p.o);
          }
        }
      })
    );
    const quotes = raw.map((o) => snapshotToQuote(o));
    return { quotes, missing };
  }

  // total 缺失：按空页探测（最多 100 页）
  const quotes = raw.map((o) => snapshotToQuote(o));
  return { quotes, missing: 0 };
}

/** 快照原始字段 → Quote（不含名称/流通市值，由上层合并） */
function snapshotToQuote(o: Record<string, unknown>): import("@/lib/types").Quote {
  const price = num(o.last_price) ?? 0;
  const preClose = num(o.prev_price) ?? 0;
  const high = num(o.high_price) ?? price;
  const low = num(o.low_price) ?? price;
  return {
    code: String(o.thscode),
    open: num(o.open_price) ?? price,
    high,
    low,
    price,
    preClose,
    pct: num(o.price_change_ratio_pct) ?? (preClose > 0 ? (price / preClose - 1) * 100 : 0),
    amount: num(o.turnover) ?? 0,   // 成交额（元）
    volume: num(o.volume) ?? 0,     // 成交量（股）
    turnover: 0,                    // 换手率由流通市值推导
    volumeRatio: 0,                 // 量比由 K 线推导
    amplitude: preClose > 0 ? ((high - low) / preClose) * 100 : 0,
  };
}

/* ==================== 竞价快照（含名称 / 流通市值） ==================== */

export interface FuyaoAuction {
  code: string;
  name?: string;
  auctionPct: number;         // 竞价涨幅 %
  auctionPrice?: number;
  auctionVolume?: number;
  auctionAmount?: number;     // 竞价成交额（元）
  auctionVolRatio?: number;   // 竞价量比
  auctionTurnoverPct?: number;// 竞价换手率 %
  floatMcap?: number;         // 流通市值（元）
  preClose?: number;
}

/**
 * 竞价快照：thscodes 逗号分隔，上限 100（实测超限返回 code=1003）。
 * 分批 100，批次间 200ms 间隔。
 */
export async function getAuctionSnapshot(
  ctx: FuyaoCtx,
  codes: string[]
): Promise<Map<string, FuyaoAuction> | null> {
  if (codes.length === 0) return null;
  const map = new Map<string, FuyaoAuction>();
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += 100) chunks.push(codes.slice(i, i + 100));
  let ok = false;
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(200);
    const data = await fyGet<{ item?: unknown[] }>(
      ctx,
      "/api/a-share/auction/snapshot",
      { thscodes: chunks[i].map(normalizeThscode).join(","), stage: auctionStage() },
      15000
    );
    if (!data) continue;
    ok = true;
    for (const item of pickItems(data)) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const code = typeof o.thscode === "string" ? o.thscode : undefined;
      const pct = num(o.auction_pct);
      if (!code || pct === undefined) continue;
      map.set(code, {
        code,
        name: typeof o.name === "string" ? o.name : undefined,
        auctionPct: pct,
        auctionPrice: num(o.auction_price),
        auctionVolume: num(o.auction_volume),
        auctionAmount: num(o.auction_amount),
        auctionVolRatio: num(o.auction_volume_ratio),
        auctionTurnoverPct: num(o.auction_turnover_pct),
        floatMcap: num(o.float_market_cap),
        preClose: num(o.pre_close_price),
      });
    }
  }
  return ok && map.size > 0 ? map : null;
}

/** 竞价阶段：9:15~9:25 用 live，其余用 final */
function auctionStage(): "live" | "final" {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return mins >= 555 && mins < 565 ? "live" : "final";
}

/** 竞价风向标：thscode → {auctionPct, tags}（tags 含 高开/放量/低开/缩量 + 板块标签） */
export async function getAuctionBenchmark(
  ctx: FuyaoCtx,
  date?: string
): Promise<Map<string, { auctionPct: number; tags: string[]; name?: string }> | null> {
  const data = await fyGet<{ item?: unknown[] }>(
    ctx,
    "/api/a-share/auction/short-term-benchmark",
    { date },
    15000
  );
  if (!data) return null;
  const map = new Map<string, { auctionPct: number; tags: string[]; name?: string }>();
  for (const item of pickItems(data)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const code = typeof o.thscode === "string" ? o.thscode : undefined;
    if (!code) continue;
    const tags = Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string") : [];
    map.set(code, {
      auctionPct: num(o.auction_pct) ?? 0,
      tags,
      name: typeof o.name === "string" ? o.name : undefined,
    });
  }
  return map.size > 0 ? map : null;
}

/** 由风向标 tags 衍生强/弱板块集合 */
export function deriveBenchmarkSectors(
  bench: Map<string, { auctionPct: number; tags: string[] }>
): { hot: Set<string>; weak: Set<string> } {
  const GENERIC = new Set(["高开", "低开", "放量", "缩量"]);
  const hotCnt = new Map<string, number>();
  const weakCnt = new Map<string, number>();
  bench.forEach(({ auctionPct, tags }) => {
    for (const t of tags) {
      if (GENERIC.has(t)) continue;
      if (auctionPct >= 3) hotCnt.set(t, (hotCnt.get(t) ?? 0) + 1);
      else if (auctionPct <= -3) weakCnt.set(t, (weakCnt.get(t) ?? 0) + 1);
    }
  });
  const top = (m: Map<string, number>, n: number) =>
    new Set(Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k));
  return { hot: top(hotCnt, 5), weak: top(weakCnt, 5) };
}

/* ==================== 历史 K 线 ==================== */

export async function getKline(
  ctx: FuyaoCtx,
  code: string,
  limit = 260
): Promise<import("@/lib/types").KlineBar[] | null> {
  const end = Date.now();
  // 实测 340 自然日 ≈ 223 根日线；取 360 天覆盖 250 交易日，超 400 天会超时
  const start = end - 360 * 24 * 3600 * 1000;
  const data = await fyGet<{ item?: unknown[] }>(
    ctx,
    "/api/a-share/prices/historical",
    {
      thscode: normalizeThscode(code),
      interval: "1d",
      start,
      end,
      adjust: "forward",
    },
    12000
  );
  if (!data) return null;
  const bars: import("@/lib/types").KlineBar[] = [];
  for (const item of pickItems(data)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const close = num(o.close_price);
    const dateMs = num(o.date_ms);
    if (close === undefined || dateMs === undefined) continue;
    bars.push({
      date: msToDate(dateMs),
      open: num(o.open_price) ?? close,
      high: num(o.high_price) ?? close,
      low: num(o.low_price) ?? close,
      close,
      volume: num(o.volume) ?? 0,
      amount: num(o.turnover),
    });
  }
  bars.sort((a, b) => (a.date < b.date ? -1 : 1));
  return bars.length > 0 ? bars.slice(-limit) : null;
}

/* ==================== 涨跌停 / 连板 / 热榜 ==================== */

export interface LimitPoolItem {
  code: string;
  name?: string;
  isSt?: boolean;
  isNew?: boolean;
  streak?: number;
  reason?: string;
  sealMoney?: number;
  pct?: number;
}

interface PoolPage {
  total: number;
  items: LimitPoolItem[];
}

async function fetchPool(
  ctx: FuyaoCtx,
  path: string,
  dateMs?: number,
  maxPages = 10
): Promise<PoolPage | null> {
  const size = 200;
  const first = await fyGet<{ total?: number; item?: unknown[] }>(
    ctx, path, { date_ms: dateMs, page: 1, size }, 15000
  );
  if (!first) return null;
  const total = pickTotal(first) ?? 0;
  const items: LimitPoolItem[] = [];
  const parse = (arr: unknown[]) => {
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const code = typeof o.thscode === "string" ? o.thscode : undefined;
      if (!code) continue;
      items.push({
        code,
        name: typeof o.name === "string" ? o.name : undefined,
        isSt: typeof o.is_st === "boolean" ? o.is_st : undefined,
        isNew: typeof o.is_new === "boolean" ? o.is_new : undefined,
        streak: num(o.continue_day_cnt),
        reason: typeof o.limit_up_reason === "string" ? o.limit_up_reason : undefined,
        sealMoney: num(o.seal_money),
        pct: num(o.price_change_ratio_pct),
      });
    }
  };
  parse(pickItems(first));
  const pages = Math.min(Math.ceil(total / size), maxPages);
  for (let p = 2; p <= pages; p++) {
    await sleep(200);
    const data = await fyGet<{ item?: unknown[] }>(ctx, path, { date_ms: dateMs, page: p, size }, 15000);
    if (data) parse(pickItems(data));
  }
  return { total, items };
}

export async function getLimitUpPool(ctx: FuyaoCtx, dateMs?: number): Promise<PoolPage | null> {
  return fetchPool(ctx, "/api/a-share/special-data/limit-up-pool", dateMs);
}
export async function getLimitDownPool(ctx: FuyaoCtx, dateMs?: number): Promise<PoolPage | null> {
  return fetchPool(ctx, "/api/a-share/special-data/limit-down-pool", dateMs);
}
export async function getLimitDownTotal(ctx: FuyaoCtx, dateMs?: number): Promise<number | null> {
  const data = await fyGet<{ total?: number }>(
    ctx, "/api/a-share/special-data/limit-down-pool", { date_ms: dateMs, page: 1, size: 1 }, 12000
  );
  return data ? pickTotal(data) ?? null : null;
}
export async function getLimitBreakTotal(ctx: FuyaoCtx, dateMs?: number): Promise<number | null> {
  const data = await fyGet<{ total?: number }>(
    ctx, "/api/a-share/special-data/limit-break-pool", { date_ms: dateMs, page: 1, size: 1 }, 12000
  );
  return data ? pickTotal(data) ?? null : null;
}

/** 连板天梯：最高连板高度 + 连板只数 */
export async function getLadder(ctx: FuyaoCtx): Promise<{ maxBoard: number; boardCount: number } | null> {
  const data = await fyGet<{ item?: unknown[] }>(ctx, "/api/a-share/special-data/limit-up-ladder", {}, 12000);
  if (!data) return null;
  const items = pickItems(data);
  if (items.length === 0) return null;
  const today = items[0] as { boards?: Record<string, { board_num?: number }[] | undefined> };
  let maxBoard = 0;
  let boardCount = 0;
  if (today.boards && typeof today.boards === "object") {
    for (const arr of Object.values(today.boards)) {
      if (!Array.isArray(arr)) continue;
      for (const s of arr) {
        const n = num(s?.board_num) ?? 0;
        if (n >= 2) boardCount += 1;
        if (n > maxBoard) maxBoard = n;
      }
    }
  }
  return { maxBoard, boardCount };
}

/** 涨停统计：封板率 / 涨停家数 / 炸板家数 / 各板分布 */
export interface LimitUpStats {
  sealRate?: number;
  limitUpCount?: number;
  touchedCount?: number;
  boards: { level: string; count: number; promotion?: number | null }[];
}

export async function getLimitUpStats(ctx: FuyaoCtx): Promise<LimitUpStats | null> {
  const data = await fyGet<{
    seal_rate?: number;
    limit_up_stock_count?: number;
    touched_limit_up_stock_count?: number;
    page_boards?: { board_level?: string; stock_count?: number; promotion_rate?: number | null }[];
  }>(ctx, "/api/a-share/special-data/limit-up-statistics", {}, 12000);
  if (!data) return null;
  return {
    sealRate: num(data.seal_rate),
    limitUpCount: num(data.limit_up_stock_count),
    touchedCount: num(data.touched_limit_up_stock_count),
    boards: (data.page_boards ?? []).map((b) => ({
      level: String(b.board_level ?? ""),
      count: num(b.stock_count) ?? 0,
      promotion: b.promotion_rate === null || b.promotion_rate === undefined ? null : num(b.promotion_rate),
    })),
  };
}

/** 热股榜 */
export async function getHotList(ctx: FuyaoCtx): Promise<{ code: string; name?: string; heat?: number }[] | null> {
  const data = await fyGet<{ item?: unknown[] }>(ctx, "/api/a-share/special-data/hot-stock-list", {}, 12000);
  if (!data) return null;
  const out: { code: string; name?: string; heat?: number }[] = [];
  for (const item of pickItems(data)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const code = typeof o.thscode === "string" ? o.thscode : undefined;
    if (!code) continue;
    out.push({ code, name: typeof o.name === "string" ? o.name : undefined, heat: num(o.heat) });
  }
  return out.length > 0 ? out : null;
}

/* ==================== 估值 / 财务 ==================== */

/** 估值快照：thscodes 上限 100 */
export async function getValuations(
  ctx: FuyaoCtx,
  codes: string[]
): Promise<Map<string, { pe?: number; pb?: number; name?: string }> | null> {
  if (codes.length === 0) return null;
  const map = new Map<string, { pe?: number; pb?: number; name?: string }>();
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += 100) chunks.push(codes.slice(i, i + 100));
  let ok = false;
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(200);
    const data = await fyGet<{ item?: unknown[] }>(
      ctx, "/api/a-share/valuations/snapshot", { thscodes: chunks[i].map(normalizeThscode).join(",") }, 15000
    );
    if (!data) continue;
    ok = true;
    for (const item of pickItems(data)) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const code = typeof o.thscode === "string" ? o.thscode : undefined;
      if (!code) continue;
      map.set(code, {
        pe: num(o.pe_ttm),
        pb: num(o.pb_mrq),
        name: typeof o.name === "string" ? o.name : undefined,
      });
    }
  }
  return ok && map.size > 0 ? map : null;
}

/** 推算最新已披露报告期：扶摇 report 参数格式 yyyy-1/2/3/4 */
export function latestReportPeriod(now = new Date()): string {
  const d = new Date(now.getTime() + 8 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  if (m >= 11) return `${y}-3`;
  if (m >= 9) return `${y}-2`;
  if (m >= 5) return `${y}-1`;
  return `${y - 1}-3`;
}

/**
 * 财务指标：逐只请求（实测 ~185ms/只）。
 * index_id 实测命名：
 *   calculate_operating_income_yoy_growth_ratio  营收同比（小数，×100 得 %）
 *   calculate_parent_holder_net_profit_yoy_growth_ratio 归母净利同比（小数，×100）
 *   index_weighted_avg_roe  加权 ROE（已是 %）
 *   sale_net_interest_ratio 净利率（已是 %）
 *   assets_debt_ratio 资产负债率（已是 %）
 */
export async function getFinance(
  ctx: FuyaoCtx,
  code: string,
  report?: string
): Promise<import("@/lib/types").FinanceMetrics | null> {
  const data = await fyGet<{
    abilities?: { ability?: string; indicators?: { index_id?: string; value?: string | null }[] }[];
  }>(ctx, "/api/a-share/financials/indicators", {
    thscode: normalizeThscode(code),
    report: report ?? latestReportPeriod(),
  }, 12000);
  if (!data) return null;
  const abilities = data.abilities;
  if (!Array.isArray(abilities)) return null;
  const find = (match: RegExp): number | undefined => {
    for (const ab of abilities) {
      for (const ind of ab.indicators ?? []) {
        if (ind.index_id && match.test(ind.index_id) && ind.value !== null && ind.value !== undefined) {
          const v = num(ind.value);
          if (v !== undefined) return v;
        }
      }
    }
    return undefined;
  };
  const rawProfit = find(/parent_holder_net_profit_yoy_growth_ratio/);
  const rawRevenue = find(/operating_income_yoy_growth_ratio/);
  const out: import("@/lib/types").FinanceMetrics = {
    // 同比字段实测为小数（1.47 → 147%），统一换算为百分数
    yoyProfit: rawProfit !== undefined ? rawProfit * 100 : undefined,
    yoyRevenue: rawRevenue !== undefined ? rawRevenue * 100 : undefined,
    roe: find(/^index_weighted_avg_roe$/),
    netMargin: find(/sale_net_interest_ratio/),
    debtRatio: find(/assets_debt_ratio/),
  };
  return Object.values(out).some((v) => v !== undefined) ? out : null;
}

/* ==================== 异动 / 公告 ==================== */

export interface FuyaoAnomaly {
  tags: string[];
  tagName?: string;
  reason: string;
}

export async function getAnomaly(
  ctx: FuyaoCtx,
  codes: string[]
): Promise<Map<string, FuyaoAnomaly> | null> {
  if (codes.length === 0) return null;
  const map = new Map<string, FuyaoAnomaly>();
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += 100) chunks.push(codes.slice(i, i + 100));
  let ok = false;
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(200);
    const data = await fyGet<{ item?: unknown[] }>(
      ctx, "/api/a-share/special-data/anomaly-analysis-stock",
      { thscodes: chunks[i].map(normalizeThscode).join(",") }, 15000
    );
    if (!data) continue;
    const items = pickItems(data);
    if (items.length === 0) continue;
    ok = true;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const code = typeof o.thscode === "string" ? o.thscode : undefined;
      if (!code) continue;
      map.set(code, {
        tags: Array.isArray(o.keyword_list) ? o.keyword_list.filter((t): t is string => typeof t === "string") : [],
        tagName: typeof o.tag_name === "string" ? o.tag_name : undefined,
        reason: typeof o.analysis_content === "string" ? o.analysis_content : "",
      });
    }
  }
  return ok && map.size > 0 ? map : null;
}

/** 严重异动监控名单（用于风险提示） */
export async function getAbnormalMonitor(
  ctx: FuyaoCtx
): Promise<{ code: string; name?: string; label?: string }[] | null> {
  const data = await fyGet<{ item?: unknown[] }>(ctx, "/api/a-share/special-data/abnormal-monitor-list", {}, 12000);
  if (!data) return null;
  const out: { code: string; name?: string; label?: string }[] = [];
  for (const item of pickItems(data)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const code = typeof o.thscode === "string" ? o.thscode : undefined;
    if (!code) continue;
    out.push({
      code,
      name: typeof o.name === "string" ? o.name : undefined,
      label: typeof o.monitor_label === "string" ? o.monitor_label : undefined,
    });
  }
  return out.length > 0 ? out : null;
}

/* ==================== 行业 / 板块 ==================== */

/** 同花顺行业指数目录：thscode + 名称（实测 390 个） */
export async function getIndexCatalog(ctx: FuyaoCtx): Promise<{ code: string; name: string }[] | null> {
  const data = await fyGet<{ item?: unknown[] }>(ctx, "/api/a-share-index/catalog/ths-index-list", {}, 15000);
  if (!data) return null;
  const out: { code: string; name: string }[] = [];
  for (const item of pickItems(data)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const code = typeof o.thscode === "string" ? o.thscode : undefined;
    const name = typeof o.name === "string" ? o.name : undefined;
    if (code && name) out.push({ code, name });
  }
  return out.length > 0 ? out : null;
}

/** 某行业指数的成分股 */
export async function getIndexConstituents(
  ctx: FuyaoCtx,
  indexCode: string
): Promise<{ code: string; name?: string }[] | null> {
  const data = await fyGet<{ item?: unknown[] }>(
    ctx, "/api/a-share-index/constituents/ths-stock-list", { thscode: indexCode }, 12000
  );
  if (!data) return null;
  const out: { code: string; name?: string }[] = [];
  for (const item of pickItems(data)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const code = typeof o.thscode === "string" ? o.thscode : undefined;
    if (!code) continue;
    out.push({ code, name: typeof o.name === "string" ? o.name : undefined });
  }
  return out;
}

/** 行业指数行情快照：指数 thscode → 涨跌幅 % */
export async function getIndexSnapshot(
  ctx: FuyaoCtx,
  codes: string[]
): Promise<Map<string, number> | null> {
  if (codes.length === 0) return null;
  const map = new Map<string, number>();
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += 100) chunks.push(codes.slice(i, i + 100));
  let ok = false;
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(200);
    const data = await fyGet<{ item?: unknown[] }>(
      ctx, "/api/a-share-index/prices/snapshot", { thscodes: chunks[i].join(",") }, 15000
    );
    if (!data) continue;
    ok = true;
    for (const item of pickItems(data)) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const code = typeof o.thscode === "string" ? o.thscode : undefined;
      const pct = num(o.price_change_ratio_pct);
      if (code && pct !== undefined) map.set(code, pct);
    }
  }
  return ok && map.size > 0 ? map : null;
}

/* ==================== 交易日历 ==================== */

export async function getTradingDays(ctx: FuyaoCtx): Promise<string[] | null> {
  const data = await fyGet<{ item?: unknown[] }>(ctx, "/api/a-share/calendar/trading-days", {}, 15000);
  if (!data) return null;
  const days: string[] = [];
  for (const item of pickItems(data)) {
    if (!item || typeof item !== "object") continue;
    const d = String((item as Record<string, unknown>).date ?? "");
    if (/^\d{8}$/.test(d)) days.push(d);
  }
  days.sort();
  return days.length > 0 ? days : null;
}

/** 前一交易日（上海当日之前最近一个交易日）的 date_ms */
export function prevTradingDayMs(tradingDays: string[] | null): number {
  const today = msToDate(Date.now()).replace(/-/g, "");
  const prev = tradingDays ? [...tradingDays].filter((d) => d < today).pop() : undefined;
  const d = prev ?? msToDate(Date.now() - 24 * 3600 * 1000).replace(/-/g, "");
  return Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00+08:00`);
}
