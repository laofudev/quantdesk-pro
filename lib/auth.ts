/**
 * 简单口令认证：ADMIN_PASSWORD 环境变量为唯一凭据。
 * 会话 token = base64url(签发时间戳).base64url(HMAC_SHA256(口令, 时间戳))，
 * Edge middleware 与 Node route 共用，均只用 Web Crypto（双端可用）。
 * 未设置 ADMIN_PASSWORD 时认证整体禁用（放行所有请求，控制台告警）。
 */

export const AUTH_COOKIE = "qd_session";
export const SESSION_MAX_AGE_S = 7 * 24 * 3600; // 7 天

const encoder = new TextEncoder();

const getSecret = () => process.env.ADMIN_PASSWORD ?? "";

export function isAuthEnabled(): boolean {
  return getSecret().length > 0;
}

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function hmac(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(getSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, encoder.encode(msg)));
}

/** 签发会话 token */
export async function issueToken(): Promise<string> {
  const ts = String(Date.now());
  return `${b64url(encoder.encode(ts))}.${await hmac(ts)}`;
}

/** 校验会话 token：签名正确且未过期 */
export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token || !isAuthEnabled()) return false;
  const [tsB64, sig] = token.split(".");
  if (!tsB64 || !sig) return false;
  let ts: number;
  try {
    ts = Number(atob(tsB64.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return false;
  }
  if (!Number.isFinite(ts) || Date.now() - ts > SESSION_MAX_AGE_S * 1000) return false;
  return (await hmac(String(ts))) === sig;
}

/** 口令校验：SHA-256 后逐字节常量时间比较，避免时序侧信道 */
export async function verifyPassword(pw: string): Promise<boolean> {
  if (!isAuthEnabled()) return false;
  const digest = (s: string) => crypto.subtle.digest("SHA-256", encoder.encode(s));
  const [a, b] = await Promise.all([digest(pw), digest(getSecret())]);
  const ua = new Uint8Array(a), ub = new Uint8Array(b);
  if (ua.length !== ub.length) return false;
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}
