"use client";

/**
 * 胜负统计面板
 *
 * 口径：T 日开盘买入 → T+1 收盘卖出；开盘涨幅 ≥ 9.5% 按「不追」规则剔除；
 * -5% 止损单独标记。数据来自服务端日志（data/picks.json）。
 */

import { useCallback, useEffect, useState } from "react";
import { Sparkline } from "@/components/charts";
import { pctColor } from "@/lib/format";
import type { PickRecord, StatsSummary } from "@/lib/journal";

const NO_BUY_THRESHOLD = 9.5;

function RetBadge({ ret, stopHit }: { ret: number; stopHit: boolean }) {
  return (
    <span className="tnum font-mono" style={{ color: pctColor(ret) }}>
      {ret > 0 ? "+" : ""}
      {ret.toFixed(2)}%
      {stopHit && (
        <span className="ml-1 rounded-[4px] bg-[rgba(240,163,94,0.16)] px-1 py-px text-[9.5px] text-[#f0a35e]">
          止损
        </span>
      )}
    </span>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-[11px] border border-[var(--hairline)] bg-black/20 px-2.5 py-2.5 text-center transition-colors hover:border-[var(--hairline-strong)]">
      <div className="tnum font-mono text-[15px] font-semibold" style={{ color: tone ?? "var(--ink)" }}>
        {value}
      </div>
      <div className="mt-1 text-[10px] leading-tight text-[var(--ink-faint)]">{label}</div>
    </div>
  );
}

export default function StatsPanel({ refreshKey }: { refreshKey: number }) {
  const [records, setRecords] = useState<PickRecord[]>([]);
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/stats");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setRecords(d.records ?? []);
      setSummary(d.summary ?? null);
    } catch (e) {
      setRecords([]);
      setSummary(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const settled = records.filter((r) => r.settled && r.results);
  const equity = settled.map((r) => {
    const trades = (r.results ?? []).filter((res) => {
      if (res.nodata) return false;
      const s = r.stocks.find((x) => x.code === res.code);
      return !(s && s.openPct >= NO_BUY_THRESHOLD);
    });
    if (trades.length === 0) return null;
    return trades.reduce((s, x) => s + x.retPct, 0) / trades.length;
  });

  return (
    <details className="panel panel-sheen group overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.02]">
        <span className="text-[14px] text-[#4fd1c5]">◷</span>
        <span className="text-[13.5px] font-semibold tracking-tight">胜负统计</span>
        <span className="hidden text-[10.5px] text-[var(--ink-faint)] sm:block">
          口径：T 日开盘买入 → T+1 收盘卖出 · 开盘涨停（≥9.5%）不追剔除 · 止损线 -5%
        </span>
        <span className="flex-1" />
        {summary && summary.trades > 0 && (
          <span className="chip chip-cyan tnum">胜率 {summary.winRate ?? "—"}%</span>
        )}
        <span className="text-[var(--ink-mute)] transition-transform duration-300 group-open:rotate-90">›</span>
      </summary>

      <div className="border-t border-[var(--hairline)] px-5 py-5">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton h-12 rounded-[10px]" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-[9px] border border-[rgba(246,70,93,0.28)] bg-[rgba(246,70,93,0.08)] px-3.5 py-2.5 text-[11.5px] text-[#ff8a99]">
            统计加载失败：{error}
          </div>
        ) : records.length === 0 ? (
          <div className="rounded-[11px] border border-dashed border-[var(--hairline)] px-4 py-8 text-center">
            <div className="text-[12.5px] text-[var(--ink-soft)]">还没有记录</div>
            <div className="mx-auto mt-1.5 max-w-md text-[11px] leading-relaxed text-[var(--ink-faint)]">
              在集合竞价结束后（9:25–9:30）运行一次流水线，系统会自动记录当日 Top N；
              次日收盘数据到齐后自动结算出胜负与胜率。
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {summary && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                <SummaryCard label="可执行笔数" value={String(summary.trades)} />
                <SummaryCard
                  label="胜率"
                  value={summary.winRate !== null ? `${summary.winRate}%` : "—"}
                  tone={summary.winRate !== null && summary.winRate >= 50 ? "var(--up)" : "var(--ink)"}
                />
                <SummaryCard
                  label="平均收益"
                  value={summary.avgRet !== null ? `${summary.avgRet > 0 ? "+" : ""}${summary.avgRet}%` : "—"}
                  tone={summary.avgRet !== null ? pctColor(summary.avgRet) : undefined}
                />
                <SummaryCard
                  label="含止损均收益"
                  value={
                    summary.avgRetWithStop !== null
                      ? `${summary.avgRetWithStop > 0 ? "+" : ""}${summary.avgRetWithStop}%`
                      : "—"
                  }
                  tone={summary.avgRetWithStop !== null ? pctColor(summary.avgRetWithStop) : undefined}
                />
                <SummaryCard
                  label="累计收益(等权)"
                  value={summary.cumRet !== null ? `${summary.cumRet > 0 ? "+" : ""}${summary.cumRet}%` : "—"}
                  tone={summary.cumRet !== null ? pctColor(summary.cumRet) : undefined}
                />
                <SummaryCard label="涨停开未追" value={String(summary.noBuyCount)} />
                <SummaryCard label="已结算/待结算" value={`${summary.settledDays}/${summary.pendingDays}`} />
              </div>
            )}

            {equity.filter((x) => x !== null).length > 1 && (
              <div className="flex items-center justify-between gap-4 rounded-[11px] border border-[var(--hairline)] bg-black/20 px-4 py-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                    日度等权收益序列
                  </div>
                  <div className="mt-1 text-[11.5px] text-[var(--ink-mute)]">
                    按结算日排序，红色为正收益、绿色为负收益
                  </div>
                </div>
                <Sparkline
                  data={equity.filter((x) => x !== null) as number[]}
                  width={220}
                  height={44}
                  color="var(--up)"
                />
              </div>
            )}

            <div className="space-y-2.5">
              {[...records].reverse().map((r) => {
                const dayTrades = (r.results ?? []).filter((res) => {
                  if (res.nodata) return false;
                  const s = r.stocks.find((x) => x.code === res.code);
                  return !(s && s.openPct >= NO_BUY_THRESHOLD);
                });
                const dayWins = dayTrades.filter((res) => res.retPct > 0).length;
                const dayAvg =
                  dayTrades.length > 0
                    ? dayTrades.reduce((s, x) => s + x.retPct, 0) / dayTrades.length
                    : null;
                return (
                  <div
                    key={r.date}
                    className="rounded-[11px] border border-[var(--hairline)] bg-black/20 px-3.5 py-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="tnum font-mono text-[12px] text-[var(--ink-soft)]">{r.date}</span>
                      {r.settled ? (
                        <>
                          <span className="text-[11px] text-[var(--ink-mute)]">
                            可执行 {dayTrades.length} 笔 · 胜{" "}
                            <span style={{ color: "var(--up)" }}>{dayWins}</span> / 负{" "}
                            <span style={{ color: "var(--down)" }}>{dayTrades.length - dayWins}</span>
                          </span>
                          {dayAvg !== null && (
                            <span className="tnum font-mono text-[11.5px]" style={{ color: pctColor(dayAvg) }}>
                              日均 {dayAvg > 0 ? "+" : ""}
                              {dayAvg.toFixed(2)}%
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="chip">待结算（等 T+1 收盘数据）</span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px]">
                      {(r.results ??
                        r.stocks.map((s) => ({ code: s.code, pending: true as const }))).map((res) => {
                        const stock = r.stocks.find((x) => x.code === res.code);
                        const noBuy = stock && stock.openPct >= NO_BUY_THRESHOLD;
                        return (
                          <span key={res.code} className="font-mono">
                            <span className="text-[var(--ink-mute)]">{stock?.name ?? res.code}</span>
                            {"pending" in res ? (
                              <span className="ml-1 text-[var(--ink-faint)]">待结算</span>
                            ) : res.nodata ? (
                              <span className="ml-1 text-[var(--ink-faint)]">无数据</span>
                            ) : noBuy ? (
                              <span
                                className="ml-1 text-[var(--ink-faint)]"
                                title={`开盘 +${stock?.openPct.toFixed(1)}%，涨停开买不进，按规则不追`}
                              >
                                未追(+{stock?.openPct.toFixed(1)}%)
                              </span>
                            ) : (
                              <span className="ml-1">
                                <RetBadge ret={res.retPct} stopHit={res.stopHit} />
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
