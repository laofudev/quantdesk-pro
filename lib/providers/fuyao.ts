/**
 * 扶摇 Fuyao（同花顺）数据源封装（SPEC-fuyao 第 1 节）
 * Base: GET https://fuyao.aicubes.cn<path>?...  认证头 X-api-key
 * 信封：{code, message, request_id, data:{timestamp, item[]}}；code=0 成功；
 *       2001 未认证、2003 无权限、4001/HTTP429 限流（退避重试最多 2 次）。
 * 限流纪律：全局最小请求间隔 250ms；批量端点 chunk 间 200ms；快照分页 300ms。
 * 所有调用必须 try/catch，失败返回 null 由上层降级，绝不抛出。
 */
import type { FinanceMetrics, KlineBar, Quote } from "@/lib/types";

const BASE = "https://fuyao.aicubes.cn";

function apiKey(): string {
  return process.env.FUYAO_API_KEY ?? "";
}

export interface FuyaoEnvelope<T = unknown> {
  code: number;
  message?: string;
  request_id?: string;
  data?: T | null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ---- 全局最小请求间隔（避免高并发触发限流） ---- */
let lastCallAt = 0;
const MIN_INTERVAL_MS = 250;
async function throttle(): Promise<void> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/** 标准化 6 位代码 → 600519.SH / 000001.SZ 形式（thscode 必须带后缀） */
export function normalizeThscode(raw: string): string {
  const s = String(raw).trim();
  if (s.includes(".")) return s.toUpperCase();
  if (/^(60|68|90)/.test(s)) return `${s}.SH`;
  if (/^(00|30|20)/.test(s)) return `${s}.SZ`;
  if (/^(8|4|92)/.test(s)) return `${s}.BJ`;
  return s;
}

/**
 * 统一 GET 封装：X-api-key 头 + 信封解析。
 * code=0 → 返回 data；code!==0 抛错被捕获后按类型处理；
 * HTTP429 / code 4001 / code 429 → 退避重试最多 2 次（1.2s / 3s）；
 * 其余任何失败 → 返回 null（降级由上层处理）。
 */
export async function fyGet<T = unknown>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  timeoutMs = 10000
): Promise<T | null> {
  const key = apiKey();
  if (!key) return null;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const url = `${BASE}${path}${qs.size > 0 ? `?${qs.toString()}` : ""}`;
  const backoffs = [1200, 3000];
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    await throttle();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "X-api-key": key },
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (res.status === 429) {
        console.warn(`[fuyao] ${path} HTTP 429 限流（第 ${attempt + 1} 次）`);
        if (attempt < backoffs.length) { await sleep(backoffs[attempt]); continue; }
        return null;
      }
      if (!res.ok) {
        console.warn(`[fuyao] ${path} HTTP ${res.status}，触发降级`);
        return null;
      }
      const json = (await res.json()) as FuyaoEnvelope<T>;
      if (json && json.code === 0 && json.data !== undefined && json.data !== null) {
        return json.data;
      }
      // 信封内限流码：4001（部分实现返回 429 作为业务码）
      if (json && (json.code === 4001 || json.code === 429)) {
        console.warn(`[fuyao] ${path} 限流 code=${json.code}（第 ${attempt + 1} 次）`);
        if (attempt < backoffs.length) { await sleep(backoffs[attempt]); continue; }
        return null;
      }
      console.warn(`[fuyao] ${path} 业务码异常 code=${json?.code} message=${json?.message ?? ""}，触发降级`);
      return null;
    } catch (err) {
      console.warn(`[fuyao] ${path} 请求失败（${err instanceof Error ? err.message : String(err)}），触发降级`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** 信封 data 中取 item 数组（多数端点为 data.item[]） */
function pickItems(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const arr = (data as { item?: unknown[] }).item;
  return Array.isArray(arr) ? arr : [];
}

/** 分页 total：快照在 data.total，资金池类在 data.pagination.total */
function pickTotal(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as { total?: unknown; pagination?: { total?: unknown } };
  return num(d.total) ?? num(d.pagination?.total);
}

/** 毫秒时间戳 → yyyy-MM-dd（Asia/Shanghai） */
export function msToDate(ms: number): string {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 当前上海时区 yyyy-MM-dd / 毫秒 */
function shanghaiNow(): { date: string; ms: number } {
  const ms = Date.now();
  return { date: msToDate(ms), ms };
}

/* ---------------- 全市场快照（分页遍历，~56 页×100，300ms 间隔） ---------------- */

function parseSnapshotQuote(item: unknown): Quote | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const code = typeof o.thscode === "string" ? o.thscode : undefined;
  const price = num(o.last_price);
  const preClose = num(o.prev_price);
  if (!code || price === undefined || preClose === undefined || preClose <= 0) return null;
  const high = num(o.high_price) ?? price;
  const low = num(o.low_price) ?? price;
  return {
    code,
    // 扶摇快照无中文名，名称/行业由 Tushare stock_basic 在 snapshot.ts 合并
    open: num(o.open_price) ?? price,
    high,
    low,
    price,
    preClose,
    pct: num(o.price_change_ratio_pct) ?? (price / preClose - 1) * 100,
    amount: num(o.turnover) ?? 0,              // turnover 单位为元
    volume: num(o.volume) ?? 0,                // 单位为股
    turnover: 0,                               // 换手率由 Tushare daily_basic 合并
    volumeRatio: 0,                            // 量比由 Tushare daily_basic 合并
    amplitude: preClose > 0 ? ((high - low) / preClose) * 100 : 0,
  };
}

/** 全市场快照：limit/offset 分页遍历（data.total 总数），串行 + 300ms 间隔 */
export async function getFuyaoMarketSnapshot(pageSize = 100): Promise<Quote[] | null> {
  const first = await fyGet("/api/a-share/prices/snapshot", { limit: pageSize, offset: 0 }, 15000);
  if (!first) return null;
  const total = pickTotal(first) ?? 0;
  const quotes: Quote[] = [];
  for (const item of pickItems(first)) {
    const q = parseSnapshotQuote(item);
    if (q) quotes.push(q);
  }
  if (quotes.length === 0) return null;
  if (total <= 0) {
    // total 缺失：第一页取满则继续翻页直到空页/请求失败（最多 100 页防失控）
    if (quotes.length < pageSize) return quotes;
    console.warn("[fuyao] snapshot 缺 total，按空页探测继续翻页");
    for (let page = 1; page < 100; page++) {
      await sleep(300);
      const data = await fyGet("/api/a-share/prices/snapshot", { limit: pageSize, offset: page * pageSize }, 15000);
      const items = data ? pickItems(data) : [];
      for (const item of items) {
        const q = parseSnapshotQuote(item);
        if (q) quotes.push(q);
      }
      if (!data || items.length < pageSize) {
        if (!data) console.warn(`[fuyao] snapshot 探测翻页第 ${page + 1} 页失败，快照可能不完整`);
        break;
      }
    }
    return quotes;
  }
  const pages = Math.ceil(total / pageSize);
  for (let page = 1; page < pages; page++) {
    await sleep(300); // 快照分页请求间隔 300ms
    const data = await fyGet("/api/a-share/prices/snapshot", { limit: pageSize, offset: page * pageSize }, 15000);
    if (!data) {
      // 单页失败不致命：记录并继续下一页（结果略缺仍可用）
      console.warn(`[fuyao] snapshot 第 ${page + 1}/${pages} 页失败，跳过`);
      continue;
    }
    for (const item of pickItems(data)) {
      const q = parseSnapshotQuote(item);
      if (q) quotes.push(q);
    }
  }
  return quotes.length > 0 ? quotes : null;
}

/* ---------------- 历史 K 线（前复权） ---------------- */

export async function getFuyaoKline(code: string, limit = 260): Promise<KlineBar[] | null> {
  const end = Date.now();
  const start = end - 400 * 24 * 3600 * 1000;
  const data = await fyGet("/api/a-share/prices/historical", {
    thscode: normalizeThscode(code),
    interval: "1d",
    start,
    end,
    adjust: "forward",
  });
  if (!data) return null;
  const bars: KlineBar[] = [];
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

/* ---------------- 竞价数据（T0 评分核心） ---------------- */

export interface FuyaoAuction {
  auctionPct: number;        // 竞价涨幅 %
  auctionVolRatio?: number;  // 竞价量比
  auctionAmount?: number;    // 竞价成交额（元）
  auctionPrice?: number;
  name?: string;
  floatMarketCap?: number;
  preClose?: number;
}

/** 竞价阶段：9:15~9:25 用 live，其余用 final（盘后数据仍为 final 快照） */
function auctionStage(): "live" | "final" {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return mins >= 555 && mins < 565 ? "live" : "final"; // 09:15~09:25 集合竞价进行中
}

/** 竞价快照：候选股分批 ≤100，串行 200ms 间隔 */
export async function getFuyaoAuction(codes: string[]): Promise<Map<string, FuyaoAuction> | null> {
  if (codes.length === 0) return null;
  const stage = auctionStage();
  const map = new Map<string, FuyaoAuction>();
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += 100) chunks.push(codes.slice(i, i + 100));
  let ok = false;
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(200);
    const data = await fyGet("/api/a-share/auction/snapshot", {
      thscodes: chunks[i].map(normalizeThscode).join(","),
      stage,
    });
    if (!data) continue;
    ok = true;
    for (const item of pickItems(data)) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const code = typeof o.thscode === "string" ? o.thscode : undefined;
      const pct = num(o.auction_pct);
      if (!code || pct === undefined) continue;
      map.set(code, {
        auctionPct: pct,
        auctionVolRatio: num(o.auction_volume_ratio),
        auctionAmount: num(o.auction_amount),
        auctionPrice: num(o.auction_price),
        name: typeof o.name === "string" ? o.name : undefined,
        floatMarketCap: num(o.float_market_cap),
        preClose: num(o.pre_close_price),
      });
    }
  }
  return ok && map.size > 0 ? map : null;
}

/** 竞价风向标：thscode → {auctionPct, tags}（tags 含 "高开"/"放量" 及板块标签） */
export async function getFuyaoBenchmark(date?: string): Promise<Map<string, { auctionPct: number; tags: string[] }> | null> {
  const data = await fyGet("/api/a-share/auction/short-term-benchmark", { date });
  if (!data) return null;
  const map = new Map<string, { auctionPct: number; tags: string[] }>();
  for (const item of pickItems(data)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const code = typeof o.thscode === "string" ? o.thscode : undefined;
    if (!code) continue;
    const tags = Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string") : [];
    map.set(code, { auctionPct: num(o.auction_pct) ?? 0, tags });
  }
  return map.size > 0 ? map : null;
}

/** 由竞价风向标 tags 衍生强/弱板块集合（竞价涨幅 ≥3% 的板块标签为强势，≤-3% 为弱势） */
export function deriveBenchmarkSectors(bench: Map<string, { auctionPct: number; tags: string[] }>): { hot: Set<string>; weak: Set<string> } {
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

/* ---------------- 涨停/跌停/炸板/连板 ---------------- */

export interface LimitPoolItem {
  code: string;
  name?: string;
  isSt?: boolean;
  streak?: number;      // continue_day_cnt 连板数
  reason?: string;      // limit_up_reason
  sealMoney?: number;   // 封单额（元）
  pct?: number;
}

interface PoolPage {
  total: number;
  items: LimitPoolItem[];
}

async function fetchPool(path: string, dateMs?: number, maxPages = 10): Promise<PoolPage | null> {
  const size = 200;
  const first = await fyGet(path, { date_ms: dateMs, page: 1, size });
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
    const data = await fyGet(path, { date_ms: dateMs, page: p, size });
    if (!data) continue;
    parse(pickItems(data));
  }
  return { total, items };
}

/** 涨停池（默认当日/最近交易日） */
export async function getFuyaoLimitUpPool(dateMs?: number): Promise<PoolPage | null> {
  return fetchPool("/api/a-share/special-data/limit-up-pool", dateMs);
}

/** 跌停池总数（regime 判定用） */
export async function getFuyaoLimitDownTotal(dateMs?: number): Promise<number | null> {
  const data = await fyGet("/api/a-share/special-data/limit-down-pool", { date_ms: dateMs, page: 1, size: 1 });
  if (!data) return null;
  return pickTotal(data) ?? null;
}

/** 炸板池总数（打板成功率/炸板率用） */
export async function getFuyaoLimitBreakTotal(dateMs?: number): Promise<number | null> {
  const data = await fyGet("/api/a-share/special-data/limit-break-pool", { date_ms: dateMs, page: 1, size: 1 });
  if (!data) return null;
  return pickTotal(data) ?? null;
}

/** 连板天梯：返回当日最高连板高度与连板只数 */
export async function getFuyaoLadder(): Promise<{ maxBoard: number; boardCount: number } | null> {
  const data = await fyGet("/api/a-share/special-data/limit-up-ladder");
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

/** 热股榜 Top30 人气 */
export async function getFuyaoHotList(): Promise<{ code: string; name?: string }[] | null> {
  const data = await fyGet("/api/a-share/special-data/hot-stock-list");
  if (!data) return null;
  const out: { code: string; name?: string }[] = [];
  for (const item of pickItems(data)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const code = typeof o.thscode === "string" ? o.thscode : undefined;
    if (!code) continue;
    out.push({ code, name: typeof o.name === "string" ? o.name : undefined });
  }
  return out.length > 0 ? out : null;
}

/* ---------------- 个股异动原因（催化剂） ---------------- */

export interface FuyaoAnomaly {
  tags: string[];      // keyword_list 异动标签
  tagName?: string;    // tag_name 如 "涨停"
  reason: string;      // analysis_content 异动原因文本
}

export async function getFuyaoAnomaly(codes: string[]): Promise<Map<string, FuyaoAnomaly> | null> {
  if (codes.length === 0) return null;
  const map = new Map<string, FuyaoAnomaly>();
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += 100) chunks.push(codes.slice(i, i + 100));
  let ok = false;
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(200);
    const data = await fyGet("/api/a-share/special-data/anomaly-analysis-stock", {
      thscodes: chunks[i].map(normalizeThscode).join(","),
    });
    if (!data) continue;
    ok = true;
    for (const item of pickItems(data)) {
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

/* ---------------- 估值快照（PE/PB，分批 ≤100） ---------------- */

export async function getFuyaoValuations(codes: string[]): Promise<Map<string, { pe?: number; pb?: number; name?: string }> | null> {
  if (codes.length === 0) return null;
  const map = new Map<string, { pe?: number; pb?: number; name?: string }>();
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += 100) chunks.push(codes.slice(i, i + 100));
  let ok = false;
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(200);
    const data = await fyGet("/api/a-share/valuations/snapshot", {
      thscodes: chunks[i].map(normalizeThscode).join(","),
    });
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

/* ---------------- 财务指标（Edwin 基本面，逐只 200ms 间隔） ---------------- */

let lastFinanceCallAt = 0;

/** 推算最新已披露报告期：扶摇 report 参数格式 yyyy-1/2/3/4 */
export function latestReportPeriod(now = new Date()): string {
  const d = new Date(now.getTime() + 8 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  // Q3 10 月底前披露；H1 8 月底前；Q1 4 月底前；年报 4 月底前
  if (m >= 11) return `${y}-3`;
  if (m >= 9) return `${y}-2`;
  if (m >= 5) return `${y}-1`;
  return `${y - 1}-3`;
}

export async function getFuyaoFinance(code: string, report?: string): Promise<FinanceMetrics | null> {
  // 逐只请求，限 200ms 间隔
  const wait = 200 - (Date.now() - lastFinanceCallAt);
  if (wait > 0) await sleep(wait);
  lastFinanceCallAt = Date.now();
  const data = await fyGet("/api/a-share/financials/indicators", {
    thscode: normalizeThscode(code),
    report: report ?? latestReportPeriod(),
  });
  if (!data) return null;
  const abilities = (data as { abilities?: { ability?: string; indicators?: { index_id?: string; value?: string | null }[] }[] }).abilities;
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
  const out: FinanceMetrics = {
    yoyProfit: find(/net_profit_yoy_growth/),
    yoyRevenue: find(/operating_income_yoy_growth/),
    roe: find(/weighted_avg_roe/),
    netMargin: find(/sale_net_interest_ratio/),
    debtRatio: find(/assets_debt_ratio/),
  };
  return Object.values(out).some((v) => v !== undefined) ? out : null;
}

/* ---------------- 交易日历 ---------------- */

/** 交易日历：返回升序 yyyyMMdd 数组（缓存由上层处理） */
export async function getFuyaoTradingDays(): Promise<string[] | null> {
  const data = await fyGet("/api/a-share/calendar/trading-days", {}, 15000);
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

/** 前一交易日（上海当日之前最近一个交易日）的 date_ms；无日历时回退到昨天 */
export function prevTradingDayMs(tradingDays: string[] | null): number {
  const today = shanghaiNow().date.replace(/-/g, "");
  const prev = tradingDays ? [...tradingDays].filter((d) => d < today).pop() : undefined;
  const d = prev ?? msToDate(Date.now() - 24 * 3600 * 1000).replace(/-/g, "");
  return Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00+08:00`);
}

/* ---------------- 同花顺板块指数（Lucas 板块强度） ---------------- */

/** 板块指数目录：名称 → 指数 thscode（885xxx.TI 等） */
export async function getThsIndexList(): Promise<Map<string, string> | null> {
  const data = await fyGet("/api/a-share-index/catalog/ths-index-list", {}, 15000);
  if (!data) return null;
  const map = new Map<string, string>();
  for (const item of pickItems(data)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name : undefined;
    const code = typeof o.thscode === "string" ? o.thscode : undefined;
    if (name && code) map.set(name, code);
  }
  return map.size > 0 ? map : null;
}

/** 板块指数行情快照：指数 thscode → 涨跌幅 % */
export async function getThsIndexSnapshot(codes: string[]): Promise<Map<string, number> | null> {
  if (codes.length === 0) return null;
  const map = new Map<string, number>();
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += 100) chunks.push(codes.slice(i, i + 100));
  let ok = false;
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(200);
    const data = await fyGet("/api/a-share-index/prices/snapshot", { thscodes: chunks[i].join(",") });
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
