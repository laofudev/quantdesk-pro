/**
 * GET /api/stock/[code] — 个股明细（K线 + 资金 + 板块 + 异动/公告）
 * 扶摇主源（K线/财务/异动），行业归属与资金流用 Tushare（stock_basic / moneyflow），
 * 失败字段返回 null，绝不 500。
 */
import { NextRequest, NextResponse } from "next/server";
import { cached, endOfDayTTL } from "@/lib/cache";
import {
  getFuyaoAnomaly,
  getFuyaoFinance,
  getFuyaoKline,
  normalizeThscode,
} from "@/lib/providers/fuyao";
import { getDailyKline, getMoneyflow, getStockBasic } from "@/lib/providers/tushare";
import type { SectorInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 板块归属：Tushare stock_basic.industry 为主源，概念标签用扶摇异动 keyword_list */
async function resolveSector(code: string, anomalyTags: string[]): Promise<SectorInfo | null> {
  const basic = await cached("stock_basic", endOfDayTTL(), () => getStockBasic());
  const industry = basic?.get(code)?.industry;
  if (!industry && anomalyTags.length === 0) return null;
  return { industry: industry || undefined, concepts: anomalyTags };
}

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  let code = "";
  try {
    code = normalizeThscode(decodeURIComponent(params.code || ""));
    if (!/^[0-9A-Z.]{4,12}$/.test(code)) {
      return NextResponse.json({ code, error: "无效的证券代码" }, { status: 400 });
    }
    const [klineR, flowR, finR, anomalyR] = await Promise.allSettled([
      cached(`kline_${code}`, endOfDayTTL(), async () => (await getFuyaoKline(code)) ?? (await getDailyKline(code))),
      cached(`flow_${code}`, endOfDayTTL(), () => getMoneyflow(code, 5)),
      cached(`fin_${code}`, endOfDayTTL(), () => getFuyaoFinance(code)),
      cached(`anomaly_stock_${code}`, endOfDayTTL(), () => getFuyaoAnomaly([code])),
    ]);
    const val = <T,>(r: PromiseSettledResult<T | null>): T | null => (r.status === "fulfilled" ? r.value : null);
    const kline = val(klineR);
    const flow = val(flowR);
    const anomaly = val(anomalyR)?.get(code) ?? null;
    // 异动原因映射为公告样式（催化剂关键词扫描）+ 板块概念标签
    const announcements = anomaly
      ? [{ time: new Date().toISOString().slice(0, 10), title: `${anomaly.tags.join(" ")} ${anomaly.reason}`.slice(0, 300) }]
      : null;
    const sector = await resolveSector(code, anomaly?.tags ?? []);
    return NextResponse.json({
      code,
      kline: kline ? kline.slice(-120) : null,
      moneyFlow: flow,
      finance: val(finR),
      sector,
      announcements,
      anomaly: anomaly ? { tags: anomaly.tags, tagName: anomaly.tagName, reason: anomaly.reason } : null,
      degraded: !kline,
      message: !kline ? "K线数据不可用（双源均失败）" : undefined,
    });
  } catch (err) {
    return NextResponse.json({
      code, kline: null, moneyFlow: null, finance: null, sector: null, announcements: null,
      degraded: true, message: `个股明细接口异常：${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
