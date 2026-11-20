"use client";

/**
 * 个股明细抽屉
 *
 * 内容：日 K 线（含 MA5/MA20）· 财务指标 · 行业与概念 · 异动/公告
 * 数据全部来自扶摇，缺字段以 "—" 呈现，绝不白屏。
 */

import { useEffect, useMemo, useState } from "react";
import { CandleChart } from "@/components/charts";
import { fmtPct, pctColor } from "@/lib/format";
import type { Announcement, FinanceMetrics, KlineBar, SectorInfo } from "@/lib/types";

interface StockDetail {
  code: string;
  kline: KlineBar[] | null;
  finance: FinanceMetrics | null;
  sector: SectorInfo | null;
  announcements: Announcement[] | null;
  anomaly?: { tags: string[]; tagName?: string; reason?: string } | null;
  degraded: boolean;
  message?: string;
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-[9px] border border-[var(--hairline)] bg-black/20 px-3 py-2">
      <div className="text-[10px] text-[var(--ink-faint)]">{label}</div>
      <div className="tnum mt-0.5 font-mono text-[13px]" style={{ color: accent ?? "var(--ink-soft)" }}>
        {value}
      </div>
    </div>
  );
}

export default function StockDrawer({ code, onClose }: { code: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setDetail(null);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setDetail(null);
    setError(null);
    fetch(`/api/stock/${encodeURIComponent(code)}`, { signal: ctrl.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        return d as StockDetail;
      })
      .then((d) => setDetail(d))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [code]);

  useEffect(() => {
    if (!code) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [code, onClose]);

  const klineStats = useMemo(() => {
    const bars = detail?.kline ?? [];
    if (bars.length < 2) return null;
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    const chg = prev.close > 0 ? ((last.close / prev.close - 1) * 100) : 0;
    const first = bars[0];
    const period = first.close > 0 ? ((last.close / first.close - 1) * 100) : 0;
    return { chg, period, count: bars.length };
  }, [detail]);

  if (!code) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-sm" />

      <aside
        className="relative z-10 h-full w-full max-w-2xl animate-fade-up overflow-y-auto border-l border-[var(--hairline)] bg-[rgba(8,10,15,0.97)] shadow-[0_0_80px_-20px_rgba(0,0,0,0.9)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--hairline)] bg-[rgba(8,10,15,0.92)] px-5 py-3.5 backdrop-blur-xl">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="tnum font-mono text-[15px] font-semibold text-[#e8c887]">{code}</span>
              {detail?.sector?.industry && (
                <span className="chip chip-gold">{detail.sector.industry}</span>
              )}
            </div>
            {klineStats && (
              <div className="mt-0.5 text-[11px] text-[var(--ink-mute)]">
                收盘 {detail?.kline?.[detail.kline.length - 1]?.close.toFixed(2)} ·
                <span style={{ color: pctColor(klineStats.chg) }}> {fmtPct(klineStats.chg)} </span>·
                区间 {fmtPct(klineStats.period)} / {klineStats.count} 日
              </div>
            )}
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className="btn h-8 px-3 py-0 text-[12px]" aria-label="关闭">
            <span className="text-[13px]">✕</span>
          </button>
        </div>

        <div className="space-y-6 px-5 py-5">
          {loading && (
            <div className="space-y-3">
              <div className="skeleton h-[190px] rounded-[10px]" />
              <div className="skeleton h-24 rounded-[10px]" />
              <div className="skeleton h-24 rounded-[10px]" />
            </div>
          )}

          {!loading && error && (
            <div className="rounded-[9px] border border-[rgba(246,70,93,0.32)] bg-[rgba(246,70,93,0.1)] px-3.5 py-2.5 text-[12px] text-[#ff8a99]">
              加载失败：{error}
            </div>
          )}

          {!loading && !error && !detail && (
            <div className="py-10 text-center text-[12px] text-[var(--ink-mute)]">暂无数据</div>
          )}

          {!loading && !error && detail && (
            <>
              {detail.message && (
                <div className="rounded-[9px] border border-[rgba(240,163,94,0.3)] bg-[rgba(240,163,94,0.08)] px-3.5 py-2.5 text-[11.5px] text-[#f0a35e]">
                  {detail.message}
                </div>
              )}

              {/* K 线 */}
              <section>
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                    日 K 线 · MA5 / MA20
                  </h3>
                  <div className="flex items-center gap-3 text-[10px] text-[var(--ink-faint)]">
                    <span className="flex items-center gap-1">
                      <span className="h-[2px] w-3" style={{ background: "#d4b06b" }} />MA5
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-[2px] w-3" style={{ background: "#4fd1c5" }} />MA20
                    </span>
                  </div>
                </div>
                <div className="rounded-[12px] border border-[var(--hairline)] bg-black/25 p-3">
                  {detail.kline && detail.kline.length > 0 ? (
                    <CandleChart bars={detail.kline} height={210} />
                  ) : (
                    <div className="py-10 text-center text-[11.5px] text-[var(--ink-mute)]">
                      K 线数据不可用
                    </div>
                  )}
                </div>
              </section>

              {/* 财务 */}
              <section>
                <h3 className="mb-2 text-[11px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                  财务指标 · 近一期报告期
                </h3>
                {detail.finance ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Metric
                      label="ROE"
                      value={detail.finance.roe !== undefined ? `${detail.finance.roe.toFixed(1)}%` : "—"}
                    />
                    <Metric
                      label="归母净利同比"
                      value={
                        detail.finance.yoyProfit !== undefined ? `${fmtPct(detail.finance.yoyProfit, 1)}` : "—"
                      }
                      accent={
                        detail.finance.yoyProfit !== undefined
                          ? pctColor(detail.finance.yoyProfit)
                          : undefined
                      }
                    />
                    <Metric
                      label="营收同比"
                      value={
                        detail.finance.yoyRevenue !== undefined ? `${fmtPct(detail.finance.yoyRevenue, 1)}` : "—"
                      }
                      accent={
                        detail.finance.yoyRevenue !== undefined
                          ? pctColor(detail.finance.yoyRevenue)
                          : undefined
                      }
                    />
                    <Metric
                      label="净利率"
                      value={detail.finance.netMargin !== undefined ? `${detail.finance.netMargin.toFixed(1)}%` : "—"}
                    />
                    <Metric
                      label="资产负债率"
                      value={
                        detail.finance.debtRatio !== undefined ? `${detail.finance.debtRatio.toFixed(1)}%` : "—"
                      }
                    />
                  </div>
                ) : (
                  <div className="rounded-[9px] border border-[var(--hairline)] bg-black/20 px-3.5 py-3 text-[11.5px] text-[var(--ink-mute)]">
                    财务指标不可用
                  </div>
                )}
              </section>

              {/* 行业与概念 */}
              <section>
                <h3 className="mb-2 text-[11px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                  行业与概念
                </h3>
                {detail.sector && (detail.sector.industry || detail.sector.concepts.length > 0) ? (
                  <div className="flex flex-wrap gap-1.5">
                    {detail.sector.industry && (
                      <span className="chip chip-gold">{detail.sector.industry}</span>
                    )}
                    {detail.sector.concepts.slice(0, 16).map((c) => (
                      <span key={c} className="chip">
                        {c}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11.5px] text-[var(--ink-mute)]">板块数据不可用</div>
                )}
              </section>

              {/* 异动 / 公告 */}
              <section>
                <h3 className="mb-2 text-[11px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                  异动与公告
                </h3>
                {detail.announcements && detail.announcements.length > 0 ? (
                  <div className="space-y-1.5">
                    {detail.announcements.slice(0, 10).map((a, i) => (
                      <div
                        key={i}
                        className="rounded-[9px] border border-[var(--hairline)] bg-black/20 px-3.5 py-2.5 text-[12px] leading-relaxed text-[var(--ink-soft)]"
                      >
                        <span className="tnum mr-2 font-mono text-[10.5px] text-[var(--ink-faint)]">
                          {a.time?.slice(0, 10) ?? ""}
                        </span>
                        {a.title}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11.5px] text-[var(--ink-mute)]">
                    近 10 日无异动公告或数据不可用
                  </div>
                )}
              </section>

              <p className="pt-2 text-[10.5px] leading-relaxed text-[var(--ink-faint)]">
                数据来源：扶摇 Fuyao（同花顺）。本页所有内容仅为客观行情与财务数据展示，
                不构成任何投资建议、荐股或交易指令。
              </p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
