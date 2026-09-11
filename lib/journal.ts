/**
 * 选股日志与胜负结算：
 * 每次流水线产出 TopN 后按交易日记录到 data/picks.json；
 * 结算用 Tushare 日线把每笔模拟为「T 日开盘买入 → T+1 收盘卖出」，
 * 开盘涨幅 ≥9.5% 的票按规则"不追"剔除（买不进），-5% 止损单独标记。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { cached, endOfDayTTL } from "@/lib/cache";
import { getDailyKline } from "@/lib/providers/tushare";

const DATA_DIR = path.join(process.cwd(), "data");
const JOURNAL_FILE = path.join(DATA_DIR, "picks.json");

export interface PickItem {
  code: string;
  name?: string;
  industry?: string;
  finalScore: number;
  openPct: number; // T 日开盘涨幅 %
}

export interface PickResult {
  code: string;
  buy: number;      // T 日开盘价
  sell: number;     // T+1 收盘价
  retPct: number;   // 收盘卖收益 %
  low: number;      // T+1 最低价（止损判定）
  stopHit: boolean; // 盘中触及 -5% 止损
  nodata?: boolean; // 缺数据（停牌等），不计入统计
}

export interface PickRecord {
  date: string; // T 日（交易日 yyyy-MM-dd）
  stocks: PickItem[];
  results?: PickResult[];
  settled: boolean;
}

export interface StatsSummary {
  trades: number;              // 已结算且可执行的笔数（剔除买不进/无数据）
  wins: number;
  winRate: number | null;      // %
  avgRet: number | null;       // 平均单笔收益 %（T+1 收盘卖）
  cumRet: number | null;       // 等权日组合复利累计收益 %
  avgRetWithStop: number | null; // 严格执行 -5% 止损的平均单笔收益 %
  noBuyCount: number;          // 开盘涨停买不进的次数
  nodataCount: number;
  settledDays: number;
  pendingDays: number;
}

async function readJournal(): Promise<PickRecord[]> {
  try {
    const arr = JSON.parse(await fs.readFile(JOURNAL_FILE, "utf-8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeJournal(records: PickRecord[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(JOURNAL_FILE, JSON.stringify(records, null, 2), "utf-8");
}

/** 记录当日选股（幂等：同日期未结算记录被最新一次运行覆盖；已结算的不动） */
export async function recordPicks(date: string, stocks: PickItem[]): Promise<void> {
  if (stocks.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const records = await readJournal();
  const idx = records.findIndex((r) => r.date === date);
  const rec: PickRecord = { date, stocks: stocks.slice(0, 12), settled: false };
  if (idx >= 0) {
    if (!records[idx].settled) records[idx] = rec;
  } else {
    records.push(rec);
  }
  records.sort((a, b) => (a.date < b.date ? -1 : 1));
  await writeJournal(records);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 结算单日：逐票取日线，T 日开盘买入、T+1 收盘卖出；数据不齐则整单保持待结算 */
async function settleRecord(rec: PickRecord): Promise<PickRecord> {
  const results: PickResult[] = [];
  for (const s of rec.stocks) {
    const bars = await cached(`settle_daily_${s.code}`, endOfDayTTL(), () => getDailyKline(s.code));
    const i = bars?.findIndex((b) => b.date === rec.date) ?? -1;
    if (!bars || i < 0) return rec; // T 日 K 线还不存在（数据未更新），下次再结
    const t0 = bars[i];
    const t1 = i + 1 < bars.length ? bars[i + 1] : null;
    // T+1 K 线未出（T 日收盘后查看时必然如此）→ 保持待结算，防止提前定案成"无数据"
    if (!t1) return rec;
    results.push({
      code: s.code,
      buy: t0.open,
      sell: t1.close,
      retPct: round2((t1.close / t0.open - 1) * 100),
      low: t1.low,
      stopHit: t1.low <= t0.open * 0.95,
    });
  }
  return { ...rec, results, settled: true };
}

/** 结算所有未结算记录（幂等，可反复调用） */
export async function settlePending(): Promise<PickRecord[]> {
  const records = await readJournal();
  let dirty = false;
  for (let i = 0; i < records.length; i++) {
    if (records[i].settled) continue;
    const next = await settleRecord(records[i]);
    if (next.settled) {
      records[i] = next;
      dirty = true;
    }
  }
  if (dirty) await writeJournal(records);
  return records;
}

export async function loadJournal(): Promise<PickRecord[]> {
  return readJournal();
}

const NO_BUY_THRESHOLD = 9.5; // 开盘涨幅 ≥9.5% 按规则不追（买不进）

export function summarize(records: PickRecord[]): StatsSummary {
  let trades = 0, wins = 0, sum = 0, sumStop = 0, noBuyCount = 0, nodataCount = 0;
  let settledDays = 0, pendingDays = 0;
  let cum = 1; // 等权日组合复利
  for (const r of records) {
    if (!r.settled || !r.results) {
      pendingDays++;
      continue;
    }
    settledDays++;
    let daySum = 0, dayN = 0;
    for (const res of r.results) {
      if (res.nodata) {
        nodataCount++;
        continue;
      }
      const s = r.stocks.find((x) => x.code === res.code);
      if (s && s.openPct >= NO_BUY_THRESHOLD) {
        noBuyCount++; // 涨停开，规则不追
        continue;
      }
      trades++;
      dayN++;
      if (res.retPct > 0) wins++;
      sum += res.retPct;
      sumStop += res.stopHit ? -5 : res.retPct;
      daySum += res.retPct;
    }
    if (dayN > 0) cum *= 1 + daySum / dayN / 100;
  }
  return {
    trades,
    wins,
    winRate: trades > 0 ? round2((wins / trades) * 100) : null,
    avgRet: trades > 0 ? round2(sum / trades) : null,
    cumRet: settledDays > 0 ? round2((cum - 1) * 100) : null,
    avgRetWithStop: trades > 0 ? round2(sumStop / trades) : null,
    noBuyCount,
    nodataCount,
    settledDays,
    pendingDays,
  };
}
