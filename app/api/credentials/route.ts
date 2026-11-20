/**
 * /api/credentials —— 用户自填扶摇 API Key 的读写
 *
 * POST   { fuyaoKey }  → 校验并保存（服务端 AES-GCM 加密落盘，浏览器只持有 sessionId Cookie）
 * GET                   → 返回配置状态（仅掩码，绝不回传明文）
 * DELETE                → 清除当前会话的凭据
 */
import { NextRequest, NextResponse } from "next/server";
import { deleteCredential, credentialStatus, saveCredential, verifyFuyaoKey } from "@/lib/credentials";
import { getSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sid = await getSessionId();
    const status = await credentialStatus(sid);
    return NextResponse.json({ configured: !!status, credential: status });
  } catch (err) {
    return NextResponse.json(
      { configured: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { fuyaoKey?: string };
    const key = (body.fuyaoKey ?? "").trim();
    if (!key) {
      return NextResponse.json({ ok: false, error: "请填写扶摇 API Key" }, { status: 400 });
    }
    if (key.length < 8) {
      return NextResponse.json({ ok: false, error: "API Key 格式不正确" }, { status: 400 });
    }
    // 鉴权验证
    const verify = await verifyFuyaoKey(key);
    if (!verify.ok) {
      return NextResponse.json({ ok: false, error: verify.message }, { status: 400 });
    }
    const sid = await getSessionId();
    await saveCredential(sid, key);
    const status = await credentialStatus(sid);
    return NextResponse.json({ ok: true, credential: status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const sid = await getSessionId();
    await deleteCredential(sid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
