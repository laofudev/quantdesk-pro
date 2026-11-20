/**
 * GET /api/stock/[code] — 个股明细（K线 + 财务 + 行业 + 异动/公告）
 * 纯扶摇数据源，失败字段返回 null，绝不 500。
 */
import { NextRequest, NextResponse } from "next/server";
import { cached, endOfDayTTL } from "@/lib/cache";
import { getAnomaly, getFinance, getKline, normalizeThscode } from "@/lib/providers/fuyao";
import { buildIndustryMap } from "@/lib/data/market";
import { requireFuyaoCtx } from "@/lib/api-guard";
import type { Announcement, FinanceMetrics, KlineBar, SectorInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  let code = "";
  try {
    const guard = await requireFuyaoCtx();
    if (!guard.ok || !guard.ctx) {
      return guard.response ?? NextResponse.json({ error: "未授权" }, { status: 401 });
    }
    const ctx = guard.ctx;
    code = normalizeThscode(decodeURIComponent(params.code || ""));
    if (!/^[0-9A-Z.]{4,12}$/.test(code)) {
      return NextResponse.json({ code, error: "无效的证券代码" }, { status: 400 });
    }
    const [klineR, finR, anomalyR, indMapR] = await Promise.allSettled([
      cached(`kline_${code}`, endOfDayTTL(), () => getKline(ctx, code)),
      cached(`fin_${code}`, endOfDayTTL(), () => getFinance(ctx, code)),
      cached(`anomaly_stock_${code}`, endOfDayTTL(), () => getAnomaly(ctx, [code])),
      cached("industry_map", endOfDayTTL(), () => buildIndustryMap(ctx)),
    ]);
    const val = <T,>(r: PromiseSettledResult<T | null>): T | null =>
      r.status === "fulfilled" ? r.value : null;
    const kline = val(klineR);
    const fin = val(finR);
    const anomaly = val(anomalyR)?.get(code) ?? null;
    const indMap = val(indMapR);

    const announcements: Announcement[] | null = anomaly
      ? [
          {
            time: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
            title: `${anomaly.tags.join(" ")} ${anomaly.reason}`.slice(0, 300),
          },
        ]
      : null;

    const sector: SectorInfo | null = (() => {
      const industry = indMap?.byCode.get(code);
      const concepts = anomaly?.tags ?? [];
      if (!industry && concepts.length === 0) return null;
      return { industry, concepts };
    })();

    return NextResponse.json({
      code,
      kline: kline ? (kline.slice(-120) as KlineBar[]) : null,
      finance: fin as FinanceMetrics | null,
      sector,
      announcements,
      anomaly: anomaly ? { tags: anomaly.tags, tagName: anomaly.tagName, reason: anomaly.reason } : null,
      degraded: !kline,
      message: !kline ? "K线数据不可用" : undefined,
    });
  } catch (err) {
    return NextResponse.json({
      code, kline: null, finance: null, sector: null, announcements: null,
      degraded: true, message: `个股明细接口异常：${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
