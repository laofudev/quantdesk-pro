/**
 * POST /api/market/refresh — 手动清除行情相关缓存（快照/情绪/涨跌停池/竞价风向标），
 * 下次拉取即强制重新请求数据源。供 9:25 竞价结束后手动刷新用。
 */
import { NextResponse } from "next/server";
import { clearMarketCache } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await clearMarketCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
