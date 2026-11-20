/**
 * 会话层：浏览器侧的 sessionId Cookie ↔ 服务端凭据。
 *
 * 中间件不拦截（允许未配置 Key 时进入落地页），
 * 但所有数据类 API 在缺少凭据时返回 401，由前端引导用户去设置页。
 */
import { cookies } from "next/headers";
import { CRED_COOKIE, newSessionId } from "@/lib/credentials";

/** 读取当前会话 ID（不存在则生成并写入 Cookie） */
export async function getSessionId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(CRED_COOKIE)?.value;
  if (existing && existing.length >= 16) return existing;
  const sid = newSessionId();
  store.set(CRED_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
  return sid;
}


