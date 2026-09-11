/**
 * Tushare 数据源封装（SPEC 1.2，历史/基本面/降级源）
 * 网关：POST https://api.waditu.com  body {api_name, token, params, fields}
 * 所有调用必须 try/catch，失败返回 null 由上层降级，绝不抛出。
 */
import type { KlineBar, MoneyFlow, Quote } from "@/lib/types";

const API = "https://api.waditu.com";

function token(): string {
  return process.env.TUSHARE_TOKEN ?? "";
}

export interface TushareItem {
  fields: string[];
  items: unknown[][];
}

/** 通用调用：返回行对象数组，任何失败均返回 null */
export async function tushareCall(
  apiName: string,
  params: Record<string, string | number> = {},
  fields = "",
  timeoutMs = 10000
): Promise<Record<string, unknown>[] | null> {
  const tk = token();
  if (!tk) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_name: apiName, token: tk, params, fields }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[tushare] ${apiName} HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { code?: number; msg?: string; data?: TushareItem };
    if (json.code !== 0 || !json.data) {
      console.warn(`[tushare] ${apiName} 业务错误 code=${json.code} msg=${json.msg ?? ""}`);
      return null;
    }
    const { fields: flds, items } = json.data;
    return items.map((row) => Object.fromEntries(flds.map((f, i) => [f, row[i]])));
  } catch (err) {
    console.warn(`[tushare] ${apiName} 请求失败（${err instanceof Error ? err.message : String(err)}）`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/** yyyyMMdd 格式 */
export function fmtTsDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/** 最近若干个交易日（倒序，最新在前；Tushare 交易日历 trade_cal） */
export async function getRecentTradeDates(count = 5): Promise<string[] | null> {
  const today = new Date();
  const start = new Date(Date.now() - 20 * 24 * 3600 * 1000);
  const rows = await tushareCall(
    "trade_cal",
    { start_date: fmtTsDate(start), end_date: fmtTsDate(today), is_open: "1" },
    "cal_date,is_open"
  );
  if (!rows || rows.length === 0) return null;
  const dates = rows.map((r) => String(r.cal_date)).sort().reverse();
  return dates.slice(0, count);
}

/** 股票列表 stock_basic：code → {name, industry}（用于行业归属与名称补全） */
export async function getStockBasic(): Promise<Map<string, { name: string; industry: string }> | null> {
  const rows = await tushareCall("stock_basic", { list_status: "L" }, "ts_code,name,industry");
  if (!rows || rows.length === 0) return null;
  const map = new Map<string, { name: string; industry: string }>();
  for (const r of rows) {
    const code = String(r.ts_code ?? "");
    if (!code) continue;
    map.set(code, { name: String(r.name ?? ""), industry: String(r.industry ?? "") });
  }
  return map.size > 0 ? map : null;
}

/**
 * 降级快照：Tushare daily + daily_basic 按交易日合并为 Quote（字段映射见 SPEC 1.2）
 * 注意：daily 为收盘数据，open 为当日真实开盘价，可用于开盘涨幅计算。
 */
export async function getDailySnapshot(tradeDate?: string): Promise<{ quotes: Quote[]; tradeDate: string } | null> {
  // 今日盘中/盘前 daily 尚未发布，需向前回溯找到最近有数据的交易日
  const candidates = tradeDate ? [tradeDate] : (await getRecentTradeDates(5)) ?? [];
  let date: string | null = null;
  let daily: Record<string, unknown>[] | null = null;
  let basic: Record<string, unknown>[] | null = null;
  for (const d of candidates) {
    const [dr, br] = await Promise.all([
      tushareCall("daily", { trade_date: d }, "ts_code,open,high,low,close,pre_close,pct_chg,vol,amount"),
      tushareCall("daily_basic", { trade_date: d }, "ts_code,turnover_rate,volume_ratio,pe_ttm,pb,total_mv,circ_mv"),
    ]);
    if (dr && dr.length > 0) {
      date = d; daily = dr; basic = br;
      break;
    }
  }
  if (!date || !daily || daily.length === 0) return null;
  const basicMap = new Map((basic ?? []).map((b) => [String(b.ts_code), b]));
  const quotes: Quote[] = [];
  for (const r of daily) {
    const code = String(r.ts_code ?? "");
    const close = num(r.close);
    const preClose = num(r.pre_close);
    if (!code || close === undefined || preClose === undefined || preClose <= 0) continue;
    const b = basicMap.get(code);
    const high = num(r.high) ?? close;
    const low = num(r.low) ?? close;
    quotes.push({
      code,
      open: num(r.open) ?? close,
      high,
      low,
      price: close,
      preClose,
      pct: num(r.pct_chg) ?? (close / preClose - 1) * 100,
      amount: (num(r.amount) ?? 0) * 1000, // tushare amount 单位为千元
      volume: num(r.vol) ?? 0,
      turnover: num(b?.turnover_rate) ?? 0,
      volumeRatio: num(b?.volume_ratio) ?? 0,
      amplitude: preClose > 0 ? ((high - low) / preClose) * 100 : 0,
      pe: num(b?.pe_ttm),
      pb: num(b?.pb),
      totalMcap: num(b?.total_mv) !== undefined ? (num(b?.total_mv) as number) * 10000 : undefined, // 万元→元
      circMcap: num(b?.circ_mv) !== undefined ? (num(b?.circ_mv) as number) * 10000 : undefined,
    });
  }
  return quotes.length > 0 ? { quotes, tradeDate: date } : null;
}

/** 历史 K 线 daily（降级源） */
export async function getDailyKline(code: string, limit = 260): Promise<KlineBar[] | null> {
  const et = new Date();
  const st = new Date(Date.now() - 400 * 24 * 3600 * 1000);
  const rows = await tushareCall(
    "daily",
    { ts_code: code, start_date: fmtTsDate(st), end_date: fmtTsDate(et) },
    "trade_date,open,high,low,close,vol,amount"
  );
  if (!rows || rows.length === 0) return null;
  const bars: KlineBar[] = [];
  for (const r of rows) {
    const close = num(r.close);
    if (close === undefined) continue;
    const d = String(r.trade_date ?? "");
    bars.push({
      date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      open: num(r.open) ?? close,
      high: num(r.high) ?? close,
      low: num(r.low) ?? close,
      close,
      volume: num(r.vol) ?? 0,
      amount: num(r.amount),
    });
  }
  bars.sort((a, b) => (a.date < b.date ? -1 : 1));
  return bars.slice(-limit);
}

/** 最近一个有 daily_basic 数据的交易日 + 数据（供快照合并换手率/量比/估值） */
export async function getDailyBasicMap(tradeDate?: string): Promise<{ map: Map<string, Record<string, unknown>>; tradeDate: string } | null> {
  const candidates = tradeDate ? [tradeDate] : (await getRecentTradeDates(5)) ?? [];
  for (const d of candidates) {
    const rows = await tushareCall(
      "daily_basic",
      { trade_date: d },
      "ts_code,turnover_rate,volume_ratio,pe_ttm,pb,total_mv,circ_mv"
    );
    if (rows && rows.length > 0) {
      // 盘中当日 daily_basic 的 volume_ratio 尚未填充（全 null），需回退到前一交易日
      const vrCount = rows.filter((r) => r.volume_ratio !== null && r.volume_ratio !== undefined).length;
      if (!tradeDate && vrCount < 100) continue;
      const map = new Map<string, Record<string, unknown>>();
      for (const r of rows) {
        const code = String(r.ts_code ?? "");
        if (code) map.set(code, r);
      }
      if (map.size > 0) return { map, tradeDate: d };
    }
  }
  return null;
}

/* moneyflow 逐只请求最小间隔 150ms（SPEC-fuyao 第 2 节：资金流主源为 Tushare moneyflow） */
let lastMoneyflowAt = 0;

/** 主力净流入 moneyflow：net_mf_amount 单位万元 → 元（候选股逐只，带 150ms 间隔） */
export async function getMoneyflow(code: string, days = 10): Promise<MoneyFlow[] | null> {
  const wait = 150 - (Date.now() - lastMoneyflowAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastMoneyflowAt = Date.now();
  const et = new Date();
  const st = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const rows = await tushareCall(
    "moneyflow",
    { ts_code: code, start_date: fmtTsDate(st), end_date: fmtTsDate(et) },
    "trade_date,net_mf_amount"
  );
  if (!rows || rows.length === 0) return null;
  const flows = rows
    .map((r) => {
      const d = String(r.trade_date ?? "");
      return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, netMain: (num(r.net_mf_amount) ?? 0) * 10000 };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return flows.slice(-days);
}

/** 涨跌停 limit_list_d：补连板/行业信息 */
export async function getLimitList(tradeDate: string): Promise<{ code: string; status: string; streak?: number; industry?: string }[] | null> {
  const rows = await tushareCall(
    "limit_list_d",
    { trade_date: tradeDate },
    "ts_code,limit,up_stat,industry"
  );
  if (!rows) return null;
  return rows.map((r) => ({
    code: String(r.ts_code ?? ""),
    status: String(r.limit ?? ""),
    streak: num(r.up_stat) !== undefined ? parseInt(String(r.up_stat).split("/")[0], 10) || 1 : undefined,
    industry: r.industry !== undefined ? String(r.industry) : undefined,
  }));
}
