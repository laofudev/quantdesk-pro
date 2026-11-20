/**
 * 凭据获取守卫：所有数据类 API 的统一入口。
 *
 * - 从会话 Cookie 取 sessionId → 查服务端凭据 → 得到扶摇 key
 * - 没有凭据时返回 401 + 结构化提示，前端据此弹出「配置 API Key」引导
 * - 同时把缓存命名空间切到该会话，实现会话间缓存隔离
 */
import { NextResponse } from "next/server";
import { getCredential } from "@/lib/credentials";
import { getSessionId } from "@/lib/session";
import { setCacheNamespace } from "@/lib/cache";
import type { FuyaoCtx } from "@/lib/providers/fuyao";

export interface AuthResult {
  ok: boolean;
  ctx?: FuyaoCtx;
  sessionId?: string;
  response?: NextResponse;
}

/** 取当前会话的扶摇上下文（无凭据返回 401 响应） */
export async function requireFuyaoCtx(): Promise<AuthResult> {
  try {
    const sessionId = await getSessionId();
    setCacheNamespace(sessionId);
    const cred = await getCredential(sessionId);
    if (!cred || !cred.fuyaoKey) {
      return {
        ok: false,
        sessionId,
        response: NextResponse.json(
          {
            error: "尚未配置扶摇 API Key",
            code: "NO_CREDENTIAL",
            hint: "请在右上角「API 设置」中填入你的扶摇 API Key",
          },
          { status: 401 }
        ),
      };
    }
    return { ok: true, ctx: { apiKey: cred.fuyaoKey }, sessionId };
  } catch (err) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `凭据读取失败：${err instanceof Error ? err.message : String(err)}` },
        { status: 500 }
      ),
    };
  }
}
