/**
 * 用户自填 API Key 凭据管理（服务端会话级）
 *
 * 设计要点：
 * 1. Key 只存在于服务端内存（不落盘、不进前端 bundle、不写日志）；
 * 2. 浏览器侧只拿到一个随机的 sessionId（HttpOnly Cookie），凭据按 sessionId 索引；
 * 3. 提供 AES-GCM 静态加密落盘（.cache/credentials.enc），重启后仍可用；
 * 4. 任何接口都只返回 key 的掩码（前后各 4 位），永不回传明文。
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const CRED_COOKIE = "qd_sid";
export const SESSION_MAX_AGE_S = 30 * 24 * 3600; // 30 天

const STORE_DIR = path.join(process.cwd(), ".cache");
const STORE_FILE = path.join(STORE_DIR, "credentials.enc");

/** 单条凭据记录 */
export interface Credential {
  /** 扶摇 API Key */
  fuyaoKey: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 最后使用时间戳 */
  lastUsedAt: number;
}

/** sessionId → Credential（内存索引） */
const memory = new Map<string, Credential>();
/** 主密钥（进程级随机，重启后从落盘文件头读取） */
let masterKey: Buffer | null = null;

/* ---------------- 掩码 ---------------- */

/** 掩码显示：sk-abcd****wxyz —— 只暴露首尾各 4 位 */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 10) return key.slice(0, 2) + "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

/* ---------------- 主密钥 ---------------- */

async function getMasterKey(): Promise<Buffer> {
  if (masterKey) return masterKey;
  // 优先使用环境变量（部署时可固定），否则从已存在的加密文件头读取，否则生成新的
  const env = process.env.CREDENTIAL_SECRET;
  if (env && env.length >= 16) {
    masterKey = crypto.createHash("sha256").update(env).digest();
    return masterKey;
  }
  try {
    const buf = await fs.readFile(STORE_FILE);
    if (buf.length > 16) {
      masterKey = buf.subarray(0, 16);
      return masterKey;
    }
  } catch {
    // 文件不存在 → 新生成
  }
  masterKey = crypto.randomBytes(16);
  return masterKey;
}

/* ---------------- 加解密 ---------------- */

function encrypt(plain: string, key: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-128-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

function decrypt(buf: Buffer, key: Buffer): string {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-128-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/* ---------------- 持久化 ---------------- */

async function persist(): Promise<void> {
  try {
    if (memory.size === 0) {
      await fs.rm(STORE_FILE, { force: true });
      return;
    }
    const key = await getMasterKey();
    const payload = JSON.stringify(Array.from(memory.entries()));
    await fs.mkdir(STORE_DIR, { recursive: true });
    // 文件头写主密钥（无 CREDENTIAL_SECRET 环境下用于重启后解封）
    const head = process.env.CREDENTIAL_SECRET ? Buffer.alloc(0) : key;
    const body = encrypt(payload, key);
    await fs.writeFile(STORE_FILE, Buffer.concat([head, body]), "utf-8");
  } catch {
    // 落盘失败不影响内存使用
  }
}

let loaded = false;

/** 启动时加载已落盘的凭据（幂等） */
export async function loadCredentials(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const buf = await fs.readFile(STORE_FILE);
    const env = process.env.CREDENTIAL_SECRET;
    const key = env
      ? crypto.createHash("sha256").update(env).digest()
      : buf.subarray(0, 16);
    const body = env ? buf : buf.subarray(16);
    const entries = JSON.parse(decrypt(body, key)) as [string, Credential][];
    for (const [sid, cred] of entries) memory.set(sid, cred);
  } catch {
    // 无历史凭据或解密失败（改了 CREDENTIAL_SECRET）→ 忽略
  }
}

/* ---------------- 会话 ---------------- */

export function newSessionId(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** 读取某 session 的凭据（不存在返回 null） */
export async function getCredential(sessionId: string | undefined): Promise<Credential | null> {
  if (!sessionId) return null;
  await loadCredentials();
  const cred = memory.get(sessionId);
  if (!cred) return null;
  // 过期清理
  if (Date.now() - cred.createdAt > SESSION_MAX_AGE_S * 1000) {
    memory.delete(sessionId);
    await persist();
    return null;
  }
  return cred;
}

/** 保存凭据（覆盖同 session） */
export async function saveCredential(sessionId: string, fuyaoKey: string): Promise<Credential> {
  await loadCredentials();
  const cred: Credential = {
    fuyaoKey: fuyaoKey.trim(),
    createdAt: memory.get(sessionId)?.createdAt ?? Date.now(),
    lastUsedAt: Date.now(),
  };
  memory.set(sessionId, cred);
  await persist();
  return cred;
}

/** 删除凭据 */
export async function deleteCredential(sessionId: string): Promise<void> {
  await loadCredentials();
  memory.delete(sessionId);
  await persist();
}

/** 校验扶摇 key 是否可用（发一个轻量请求验证 code=0） */
export async function verifyFuyaoKey(fuyaoKey: string): Promise<{ ok: boolean; message: string }> {
  const key = (fuyaoKey || "").trim();
  if (!key) return { ok: false, message: "API Key 为空" };
  try {
    const res = await fetch("https://fuyao.aicubes.cn/api/a-share/calendar/trading-days", {
      headers: { "X-api-key": key },
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) return { ok: false, message: "鉴权失败：Key 无效或无权限" };
    const json = (await res.json().catch(() => null)) as { code?: number; message?: string } | null;
    if (!json) return { ok: false, message: "响应格式异常" };
    if (json.code === 0) return { ok: true, message: "鉴权通过" };
    if (json.code === 2001) return { ok: false, message: "鉴权失败：Key 无效（2001）" };
    if (json.code === 2003) return { ok: false, message: "鉴权失败：Key 无该接口权限（2003）" };
    if (json.code === 4001 || json.code === 429) return { ok: false, message: "触发限流，请稍后再试" };
    return { ok: false, message: `接口返回异常（code=${json.code}）：${json.message ?? ""}` };
  } catch (err) {
    return { ok: false, message: `网络异常：${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 脱敏后的凭据状态（供前端展示） */
export async function credentialStatus(sessionId: string | undefined): Promise<{
  configured: boolean;
  masked: string | null;
  createdAt: number | null;
  lastUsedAt: number | null;
} | null> {
  const cred = await getCredential(sessionId);
  if (!cred) return null;
  return {
    configured: true,
    masked: maskKey(cred.fuyaoKey),
    createdAt: cred.createdAt,
    lastUsedAt: cred.lastUsedAt,
  };
}
