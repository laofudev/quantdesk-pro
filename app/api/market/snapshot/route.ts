/**
 * GET /api/market/snapshot — 全市场快照（带缓存与降级）
 * 扶摇（分页遍历）→ Tushare → 中性空集，任何失败都不 500。
 */
import { NextResponse } from "next/server";
import { loadSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snap = await loadSnapshot();
    return NextResponse.json({
      count: snap.quotes.length,
      source: snap.source,
      degraded: snap.degraded,
      tradeDate: snap.tradeDate,
      message: snap.message,
      quotes: snap.quotes,
    });
  } catch (err) {
    // 兜底：任何意外也不 500
    return NextResponse.json({
      count: 0, source: "neutral", degraded: true,
      message: `快照接口异常：${err instanceof Error ? err.message : String(err)}`,
      quotes: [],
    });
  }
}
