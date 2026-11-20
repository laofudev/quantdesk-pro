/**
 * GET /api/market/snapshot — 全市场快照（带缓存与降级）
 */
import { NextResponse } from "next/server";
import { loadMarket } from "@/lib/data/market";
import { requireFuyaoCtx } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const guard = await requireFuyaoCtx();
    if (!guard.ok || !guard.ctx) {
      return guard.response ?? NextResponse.json({ error: "未授权" }, { status: 401 });
    }
    const market = await loadMarket(guard.ctx);
    return NextResponse.json({
      count: market.quotes.length,
      source: market.source,
      degraded: market.degraded,
      tradeDate: market.tradeDate,
      message: market.message,
      quotes: market.quotes.map((q) => ({
        code: q.code, name: q.name, industry: q.industry,
        price: q.price, pct: q.pct, turnover: q.turnover,
        amount: q.amount, volumeRatio: q.volumeRatio, amplitude: q.amplitude,
      })),
    });
  } catch (err) {
    return NextResponse.json({
      count: 0, source: "neutral", degraded: true,
      message: `快照接口异常：${err instanceof Error ? err.message : String(err)}`,
      quotes: [],
    });
  }
}
