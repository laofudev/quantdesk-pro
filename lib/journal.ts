/**
 * 选股日志与胜负结算（纯扶摇）
 *
 * 每次流水线产出 TopN 后按交易日记录到 data/picks.json；
 * 结算用扶摇日线把每笔模拟为「T 日开盘买入 → T+1 收盘卖出」，
 * 开盘涨幅 ≥9.5% 的票按规则"不追"剔除（买不进），-5% 止损单独标记。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { cached, endOfDayTTL } from "@/lib/cache";
import { getKline, type FuyaoCtx } from "@/lib/providers/fuyao";

const DATA_DIR = path.join(process.cwd(), "data");
const JOURNAL_FILE = path.join(DATA_DIR, "picks.json");

export interface PickItem {
  code: string;
  name?: string;
  industry?: string;
  finalScore: number;
  openPct: number;
}

export interface PickResult {
  code: string;
  buy: number;
  sell: number;
  retPct: number;
  low: number;
  stopHit: boolean;
  nodata?: boolean;
}

export interface PickRecord {
  date: string;
  stocks: PickItem[];
  results?: PickResult[];
  settled: boolean;
}

export interface StatsSummary {
  trades: number;
  wins: number;
  winRate: number | null;
  avgRet: number | null;
  cumRet: number | null;
  avgRetWithStop: number | null;
  noBuyCount: number;
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
async function settleRecord(ctx: FuyaoCtx, rec: PickRecord): Promise<PickRecord> {
  const results: PickResult[] = [];
  for (const s of rec.stocks) {
    const bars = await cached(`settle_kline_${s.code}`, endOfDayTTL(), () => getKline(ctx, s.code));
    const i = bars?.findIndex((b) => b.date === rec.date) ?? -1;
    if (!bars || i < 0) return rec;
    const t0 = bars[i];
    const t1 = i + 1 < bars.length ? bars[i + 1] : null;
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
export async function settlePending(ctx: FuyaoCtx): Promise<PickRecord[]> {
  const records = await readJournal();
  let dirty = false;
  for (let i = 0; i < records.length; i++) {
    if (records[i].settled) continue;
    const next = await settleRecord(ctx, records[i]);
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

const NO_BUY_THRESHOLD = 9.5;

export function summarize(records: PickRecord[]): StatsSummary {
  let trades = 0, wins = 0, sum = 0, sumStop = 0, noBuyCount = 0, nodataCount = 0;
  let settledDays = 0, pendingDays = 0;
  let cum = 1;
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
        noBuyCount++;
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
