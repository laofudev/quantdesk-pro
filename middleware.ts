/** 全局访问控制：未登录的页面请求重定向到 /login，API 请求返回 401 */
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, isAuthEnabled, verifyToken } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!isAuthEnabled() || pathname === "/login" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }
  if (await verifyToken(req.cookies.get(AUTH_COOKIE)?.value)) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "未登录或会话已过期" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
