/**
 * JSON 文件缓存（服务端）
 *
 * 命名空间隔离：每个用户会话独立命名空间（session 前 8 位），
 * 避免 A 用户的行情缓存被 B 用户读到（虽然数据相同，但缓存内容含
 * 该用户 key 的请求结果，隔离更安全，且便于按会话清理）。
 */
import fs from "node:fs/promises";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), ".cache");

interface CacheEntry<T> {
  expires: number;
  data: T;
}

export const SNAPSHOT_TTL = 10 * 60 * 1000;
export function endOfDayTTL(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime() - Date.now();
}

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

/** 会话命名空间 */
let namespace = "global";
export function setCacheNamespace(ns: string): void {
  namespace = safeKey(ns || "global").slice(0, 12);
}

function fileOf(key: string): string {
  return path.join(CACHE_DIR, namespace, `${safeKey(key)}.json`);
}

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
    const raw = await fs.readFile(fileOf(key), "utf-8");
    const entry = JSON.parse(raw, mapReviver) as CacheEntry<T>;
    if (typeof entry.expires !== "number" || entry.expires < Date.now()) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(key: string, data: T, ttlMs: number): Promise<void> {
  try {
    const file = fileOf(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const entry: CacheEntry<T> = { expires: Date.now() + ttlMs, data };
    await fs.writeFile(file, JSON.stringify(entry, mapReplacer), "utf-8");
  } catch {
    // 缓存写入失败不影响主流程
  }
}

export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T | null>): Promise<T | null> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const data = await loader();
  if (data !== null && data !== undefined) await cacheSet(key, data, ttlMs);
  return data;
}

export async function cacheDelete(...keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => fs.rm(fileOf(k)).catch(() => {})));
}

export async function cacheDeleteByPrefix(prefix: string): Promise<number> {
  try {
    const dir = path.join(CACHE_DIR, namespace);
    const files = await fs.readdir(dir);
    const hits = files.filter((f) => f.startsWith(prefix));
    await Promise.all(hits.map((f) => fs.rm(path.join(dir, f)).catch(() => {})));
    return hits.length;
  } catch {
    return 0;
  }
}

/** 清除行情类缓存（快照/情绪/涨跌停池/竞价风向标/行业映射） */
export async function clearMarketCache(): Promise<void> {
  await cacheDelete("market_snapshot", "emotion_today", "limit_up_pool_regime_10m", "limit_down_total");
  await cacheDeleteByPrefix("limit_up_pool_");
  await cacheDeleteByPrefix("auction_benchmark_");
  await cacheDeleteByPrefix("industry_map");
}

export { beijingHM, inAuctionWindow } from "@/lib/time";
