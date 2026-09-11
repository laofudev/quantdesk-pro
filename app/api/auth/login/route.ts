/** POST /api/auth/login — 校验 ADMIN_PASSWORD，签发 HttpOnly 会话 Cookie */
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, SESSION_MAX_AGE_S, isAuthEnabled, issueToken, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ error: "服务端未设置 ADMIN_PASSWORD，登录已禁用" }, { status: 400 });
  }
  let password = "";
  try {
    const body = await req.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    // 空/非 JSON body 按空口令处理
  }
  if (!(await verifyPassword(password))) {
    return NextResponse.json({ error: "口令错误" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await issueToken(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}
