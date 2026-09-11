/**
 * JSON 文件缓存（SPEC 2.5）
 * 快照 TTL 10 分钟，其余当日有效。
 * 不使用原生依赖，直接读写 .cache/ 目录下的 JSON 文件。
 */
import fs from "node:fs/promises";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), ".cache");

interface CacheEntry<T> {
  expires: number; // 过期时间戳（ms）
  data: T;
}

/** 快照 TTL：10 分钟 */
export const SNAPSHOT_TTL = 10 * 60 * 1000;
/** 其余数据：当日有效（到当天 23:59:59） */
export function endOfDayTTL(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime() - Date.now();
}

function keyToFile(key: string): string {
  // 只允许安全字符，避免路径穿越
  const safe = key.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return path.join(CACHE_DIR, `${safe}.json`);
}

/** JSON 序列化：Map → 带标记的 entries 数组（缓存读写透明恢复） */
function mapReplacer(_k: string, v: unknown): unknown {
  if (v instanceof Map) return { __type: "Map", entries: Array.from(v.entries()) };
  if (v instanceof Set) return { __type: "Set", values: Array.from(v.values()) };
  return v;
}

function mapReviver(_k: string, v: unknown): unknown {
  if (v && typeof v === "object" && (v as { __type?: string }).__type === "Map") {
    return new Map((v as { entries: [string, unknown][] }).entries);
  }
  if (v && typeof v === "object" && (v as { __type?: string }).__type === "Set") {
    return new Set((v as { values: unknown[] }).values);
  }
  return v;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(keyToFile(key), "utf-8");
    const entry = JSON.parse(raw, mapReviver) as CacheEntry<T>;
    if (typeof entry.expires !== "number" || entry.expires < Date.now()) return null;
    return entry.data;
  } catch {
    return null; // 缓存不存在或损坏均视为未命中
  }
}

export async function cacheSet<T>(key: string, data: T, ttlMs: number): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const entry: CacheEntry<T> = { expires: Date.now() + ttlMs, data };
    await fs.writeFile(keyToFile(key), JSON.stringify(entry, mapReplacer), "utf-8");
  } catch {
    // 缓存写入失败不影响主流程
  }
}

/** 便捷包装：命中直接返回，未命中执行 loader 并写入缓存 */
export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T | null>): Promise<T | null> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const data = await loader();
  if (data !== null && data !== undefined) await cacheSet(key, data, ttlMs);
  return data;
}

/** 删除指定缓存 key（不存在静默跳过） */
export async function cacheDelete(...keys: string[]): Promise<void> {
  await Promise.all(
    keys.map((k) => fs.rm(keyToFile(k)).catch(() => {})),
  );
}

/** 按前缀删除缓存 key（如 limit_up_pool_、auction_benchmark_） */
export async function cacheDeleteByPrefix(prefix: string): Promise<number> {
  try {
    const files = await fs.readdir(CACHE_DIR);
    const hits = files.filter((f) => f.startsWith(prefix));
    await Promise.all(hits.map((f) => fs.rm(path.join(CACHE_DIR, f)).catch(() => {})));
    return hits.length;
  } catch {
    return 0;
  }
}

/**
 * 清除行情类缓存（快照/情绪/涨跌停池/竞价风向标）。
 * 刷新按钮与竞价窗口内的流水线共用，保证 9:25 后拿到的是竞价终态数据。
 */
export async function clearMarketCache(): Promise<void> {
  await cacheDelete(
    "market_snapshot",
    "emotion_today",
    "limit_up_pool_regime_10m",
    "limit_up_pool_today",
    "limit_down_total",
  );
  await cacheDeleteByPrefix("limit_up_pool_");
  await cacheDeleteByPrefix("auction_benchmark_");
}

/** 当前北京时间 HH:mm 与竞价窗口判断在 lib/time.ts（客户端也用，不能依赖 node:fs） */
export { beijingHM, inAuctionWindow } from "@/lib/time";
