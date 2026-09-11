"use client";

/** 胜负统计面板：每日 TopN 的 T+1 结算结果与胜率汇总（口径见系统运作规则） */

import { useCallback, useEffect, useState } from "react";
import type { PickRecord, StatsSummary } from "@/lib/journal";

const NO_BUY_THRESHOLD = 9.5;

function RetBadge({ ret, stopHit }: { ret: number; stopHit: boolean }) {
  const color = ret > 0 ? "text-red-400" : ret < 0 ? "text-emerald-400" : "text-slate-400";
  return (
    <span className={`font-mono ${color}`}>
      {ret > 0 ? "+" : ""}{ret.toFixed(2)}%{stopHit && <span className="ml-1 text-[10px] text-amber-accent" title="盘中触及 -5% 止损">🔻止损</span>}
    </span>
  );
}

export default function StatsPanel({ refreshKey }: { refreshKey: number }) {
  const [records, setRecords] = useState<PickRecord[]>([]);
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/stats");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setRecords(d.records ?? []);
      setSummary(d.summary ?? null);
    } catch {
      setRecords([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <details className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 text-sm" open={false}>
      <summary className="cursor-pointer select-none text-slate-300">
        <span className="mr-2">🎯</span>胜负统计
        <span className="ml-2 text-xs text-slate-500">
          口径：T 日开盘买入 → T+1 收盘卖出 · 开盘涨停（≥{NO_BUY_THRESHOLD}%）不追剔除 · 止损线 -5%
        </span>
      </summary>

      {loading ? (
        <div className="mt-3 text-xs text-slate-500">加载中…</div>
      ) : records.length === 0 ? (
        <div className="mt-3 text-xs text-slate-500">
          还没有记录。每天 9:25 后点「开始筛选」会自动记录当日 Top8，次日 T+1 收盘后自动结算出胜负。
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {summary && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {[
                ["可执行笔数", summary.trades],
                ["胜率", summary.winRate !== null ? `${summary.winRate}%` : "-"],
                ["平均收益", summary.avgRet !== null ? `${summary.avgRet > 0 ? "+" : ""}${summary.avgRet}%` : "-"],
                ["含止损均收益", summary.avgRetWithStop !== null ? `${summary.avgRetWithStop > 0 ? "+" : ""}${summary.avgRetWithStop}%` : "-"],
                ["累计收益(等权)", summary.cumRet !== null ? `${summary.cumRet > 0 ? "+" : ""}${summary.cumRet}%` : "-"],
                ["涨停开未追", summary.noBuyCount],
                ["已结算/待结算", `${summary.settledDays}/${summary.pendingDays}`],
              ].map(([label, val]) => (
                <div key={String(label)} className="rounded border border-slate-700 bg-slate-900/50 p-2 text-center">
                  <div className="font-mono text-base font-semibold text-amber-accent">{val}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{label}</div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {[...records].reverse().map((r) => {
              const dayTrades = (r.results ?? []).filter((res) => {
                if (res.nodata) return false;
                const s = r.stocks.find((x) => x.code === res.code);
                return !(s && s.openPct >= NO_BUY_THRESHOLD);
              });
              const dayWins = dayTrades.filter((res) => res.retPct > 0).length;
              return (
                <div key={r.date} className="rounded border border-slate-700 bg-slate-900/50 p-2.5">
                  <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs text-slate-300">{r.date}</span>
                    {r.settled ? (
                      <>
                        <span className="text-xs text-slate-400">
                          可执行 {dayTrades.length} 笔 · 胜 <span className="text-red-400">{dayWins}</span> / 负{" "}
                          <span className="text-emerald-400">{dayTrades.length - dayWins}</span>
                        </span>
                        <span className="font-mono text-xs text-amber-accent">
                          日均 {dayTrades.length > 0 ? `${(dayTrades.reduce((s, x) => s + x.retPct, 0) / dayTrades.length).toFixed(2)}%` : "-"}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-slate-500">待结算（等 T+1 收盘数据）</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {(r.results ?? r.stocks.map((s) => ({ code: s.code, pending: true as const }))).map((res) => {
                      const stock = r.stocks.find((x) => x.code === res.code);
                      const noBuy = stock && stock.openPct >= NO_BUY_THRESHOLD;
                      return (
                        <span key={res.code} className="font-mono">
                          <span className="text-slate-400">{stock?.name ?? res.code}</span>
                          {"pending" in res ? (
                            <span className="ml-1 text-slate-600">?</span>
                          ) : res.nodata ? (
                            <span className="ml-1 text-slate-600">无数据</span>
                          ) : noBuy ? (
                            <span className="ml-1 text-slate-500" title={`开盘 +${stock?.openPct}%，涨停开买不进，按规则不追`}>
                              未追(+{stock?.openPct.toFixed(1)}%)
                            </span>
                          ) : (
                            <span className="ml-1"><RetBadge ret={res.retPct} stopHit={res.stopHit} /></span>
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
    </details>
  );
}
