/**
 * 全市场快照加载（带缓存与降级链）
 * 扶摇 prices/snapshot 分页遍历 → 降级 Tushare daily+daily_basic → 中性空集
 * 扶摇快照缺中文名/换手率/量比/估值，由 Tushare stock_basic + daily_basic 合并补齐。
 * 供 market/snapshot、market/regime、pipeline/run 三个 Route Handler 复用。
 */
import { cached, endOfDayTTL, SNAPSHOT_TTL } from "@/lib/cache";
import { getFuyaoMarketSnapshot } from "@/lib/providers/fuyao";
import { getDailyBasicMap, getDailySnapshot, getStockBasic } from "@/lib/providers/tushare";
import type { Quote, SnapshotResult } from "@/lib/types";

/** 用 Tushare stock_basic（名称/行业）+ daily_basic（换手/量比/PE/PB/市值）补齐快照字段；返回 daily_basic 是否合并成功 */
async function enrichQuotes(quotes: Quote[]): Promise<boolean> {
  const [basic, dailyBasic] = await Promise.all([
    cached("stock_basic", endOfDayTTL(), () => getStockBasic()),
    cached("daily_basic_latest", endOfDayTTL(), () => getDailyBasicMap()),
  ]);
  if (basic) {
    for (const q of quotes) {
      const b = basic.get(q.code);
      if (b) {
        q.name = q.name ?? b.name;
        q.industry = q.industry ?? b.industry;
      }
    }
  }
  if (dailyBasic) {
    for (const q of quotes) {
      const d = dailyBasic.map.get(q.code);
      if (!d) continue;
      const n = (v: unknown) => {
        const x = typeof v === "string" ? parseFloat(v) : (v as number);
        return typeof x === "number" && Number.isFinite(x) ? x : undefined;
      };
      q.turnover = n(d.turnover_rate) ?? q.turnover;
      q.volumeRatio = n(d.volume_ratio) ?? q.volumeRatio;
      q.pe = q.pe ?? n(d.pe_ttm);
      q.pb = q.pb ?? n(d.pb);
      const tmv = n(d.total_mv);
      const cmv = n(d.circ_mv);
      q.totalMcap = q.totalMcap ?? (tmv !== undefined ? tmv * 10000 : undefined); // 万元→元
      q.circMcap = q.circMcap ?? (cmv !== undefined ? cmv * 10000 : undefined);
    }
  }
  return dailyBasic !== null;
}

export async function loadSnapshot(): Promise<SnapshotResult> {
  return (
    (await cached<SnapshotResult>("market_snapshot", SNAPSHOT_TTL, async () => {
      // 主源：扶摇全市场快照（分页遍历）
      const fy = await getFuyaoMarketSnapshot();
      if (fy && fy.length > 0) {
        const enriched = await enrichQuotes(fy);
        // 全市场约 5400+ 只，明显偏少说明分页中途断裂
        const incomplete = fy.length < 3000;
        return {
          quotes: fy,
          source: "fuyao",
          degraded: !enriched || incomplete,
          tradeDate: new Date().toISOString().slice(0, 10),
          message: !enriched
            ? "换手率/量比未补齐（Tushare 不可达），初筛结果可能为空或失真"
            : incomplete
              ? `快照不完整（仅 ${fy.length} 只，分页可能中断），TM 与涨跌统计失真`
              : undefined,
        } satisfies SnapshotResult;
      }
      // 降级：Tushare daily + daily_basic（合并行业归属）
      const ts = await getDailySnapshot();
      if (ts && ts.quotes.length > 0) {
        const basic = await cached("stock_basic", endOfDayTTL(), () => getStockBasic());
        if (basic) {
          for (const q of ts.quotes) {
            const b = basic.get(q.code);
            if (b) { q.name = q.name ?? b.name; q.industry = q.industry ?? b.industry; }
          }
        }
        return {
          quotes: ts.quotes, source: "tushare", degraded: true, tradeDate: ts.tradeDate,
          message: "扶摇快照不可用，已降级到 Tushare 日线快照（非实时竞价数据）",
        } satisfies SnapshotResult;
      }
      // 双源均不可用：中性空集，绝不抛错
      return {
        quotes: [], source: "neutral", degraded: true,
        message: "扶摇与 Tushare 均不可用，返回空快照（请检查 FUYAO_API_KEY 与网络）",
      } satisfies SnapshotResult;
    })) ?? { quotes: [], source: "neutral", degraded: true, message: "缓存读取失败" }
  );
}
