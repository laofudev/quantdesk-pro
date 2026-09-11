/**
 * GET /api/stats — 胜负统计：返回选股日志（自动结算未结算记录）+ 汇总指标
 * 结算口径：T 日开盘价买入 → T+1 收盘价卖出；开盘 ≥9.5% 的票按规则"不追"剔除；-5% 止损单独标记
 */
import { NextResponse } from "next/server";
import { loadJournal, settlePending, summarize, type StatsSummary } from "@/lib/journal";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const records = await settlePending();
    const summary: StatsSummary = summarize(records);
    return NextResponse.json({ records, summary });
  } catch (err) {
    return NextResponse.json(
      { records: [], summary: null, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
