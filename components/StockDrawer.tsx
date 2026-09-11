"use client";

/** 个股明细抽屉：K线简图 + 资金流向 + 板块归属 + 公告 */

import { useEffect, useMemo, useState } from "react";
import type { Announcement, FinanceMetrics, KlineBar, MoneyFlow, SectorInfo } from "@/lib/types";

interface StockDetail {
  code: string;
  kline: KlineBar[] | null;
  moneyFlow: MoneyFlow[] | null;
  finance: FinanceMetrics | null;
  sector: SectorInfo | null;
  announcements: Announcement[] | null;
  degraded: boolean;
  message?: string;
}

/** 纯 SVG 迷你 K 线图（最近 60 根） */
function MiniKline({ bars }: { bars: KlineBar[] }) {
  const data = bars.slice(-60);
  if (data.length === 0) return <div className="text-xs text-slate-500">无 K 线数据</div>;
  const W = 520, H = 160, PAD = 4;
  const hi = Math.max(...data.map((b) => b.high));
  const lo = Math.min(...data.map((b) => b.low));
  const range = hi - lo || 1;
  const bw = (W - PAD * 2) / data.length;
  const y = (p: number) => PAD + (1 - (p - lo) / range) * (H - PAD * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {data.map((b, i) => {
        const up = b.close >= b.open;
        const color = up ? "#f87171" : "#34d399";
        const x = PAD + i * bw;
        const bodyTop = y(Math.max(b.open, b.close));
        const bodyH = Math.max(1, Math.abs(y(b.open) - y(b.close)));
        return (
          <g key={b.date}>
            <line x1={x + bw / 2} x2={x + bw / 2} y1={y(b.high)} y2={y(b.low)} stroke={color} strokeWidth={1} />
            <rect x={x + 0.5} y={bodyTop} width={Math.max(1, bw - 1)} height={bodyH} fill={up ? "none" : color} stroke={color} strokeWidth={1} />
          </g>
        );
      })}
    </svg>
  );
}

export default function StockDrawer({ code, onClose }: { code: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) { setDetail(null); setError(null); return; }
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

  const flowSum = useMemo(
    () => (detail?.moneyFlow ?? []).slice(-5).reduce((s, f) => s + f.netMain, 0),
    [detail]
  );

  if (!code) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-mono text-lg font-semibold text-amber-accent">{code}</h2>
          <button onClick={onClose} className="rounded bg-slate-700/70 px-3 py-1 text-sm text-slate-300 hover:bg-slate-700">关闭</button>
        </div>

        {loading && <div className="py-10 text-center text-sm text-slate-400">加载中…</div>}

        {!loading && error && (
          <div className="rounded border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            加载失败:{error}
          </div>
        )}

        {!loading && !error && !detail && (
          <div className="py-10 text-center text-xs text-slate-500">暂无数据</div>
        )}

        {!loading && !error && detail && (
          <div className="space-y-5">
            {detail.message && <div className="rounded border border-amber-accent/40 bg-amber-accent/10 px-3 py-2 text-xs text-amber-accent">{detail.message}</div>}

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">日 K 线（近 60 日）</h3>
              <div className="rounded border border-slate-700 bg-slate-800/50 p-2">
                {detail.kline ? <MiniKline bars={detail.kline} /> : <div className="p-3 text-xs text-slate-500">K线数据不可用</div>}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">近 5 日主力净流入</h3>
              {detail.moneyFlow && detail.moneyFlow.length > 0 ? (
                <>
                  <div className={`mb-1 font-mono text-sm ${flowSum >= 0 ? "text-red-400" : "text-emerald-400"}`}>
                    合计 {flowSum >= 0 ? "+" : ""}{(flowSum / 1e4).toFixed(0)} 万元
                  </div>
                  <div className="space-y-1">
                    {detail.moneyFlow.slice(-5).map((f) => (
                      <div key={f.date} className="flex justify-between font-mono text-xs">
                        <span className="text-slate-500">{f.date}</span>
                        <span className={f.netMain >= 0 ? "text-red-400" : "text-emerald-400"}>
                          {f.netMain >= 0 ? "+" : ""}{(f.netMain / 1e4).toFixed(0)}万
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : <div className="text-xs text-slate-500">资金流数据不可用</div>}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">板块归属</h3>
              {detail.sector ? (
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {detail.sector.industry && (
                    <span className="rounded bg-amber-accent/20 px-2 py-0.5 text-amber-accent">{detail.sector.industry}</span>
                  )}
                  {detail.sector.concepts?.slice(0, 12).map((c) => (
                    <span key={c} className="rounded bg-slate-700/60 px-2 py-0.5 text-slate-300">{c}</span>
                  ))}
                  {!detail.sector.industry && (detail.sector.concepts?.length ?? 0) === 0 && <span className="text-slate-500">无板块数据</span>}
                </div>
              ) : <div className="text-xs text-slate-500">板块数据不可用</div>}
            </section>

            {detail.finance && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">财务指标（近一期）</h3>
                <div className="grid grid-cols-2 gap-2 font-mono text-xs text-slate-300">
                  <div>ROE：{detail.finance.roe?.toFixed(1) ?? "-"}%</div>
                  <div>净利同比：{detail.finance.yoyProfit?.toFixed(1) ?? "-"}%</div>
                  <div>营收同比：{detail.finance.yoyRevenue?.toFixed(1) ?? "-"}%</div>
                  <div>净利率：{detail.finance.netMargin?.toFixed(1) ?? "-"}%</div>
                  <div>资产负债率：{detail.finance.debtRatio?.toFixed(1) ?? "-"}%</div>
                </div>
              </section>
            )}

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">近期公告</h3>
              {detail.announcements && detail.announcements.length > 0 ? (
                <div className="space-y-1">
                  {detail.announcements.slice(0, 10).map((a, i) => (
                    <div key={i} className="text-xs">
                      <span className="mr-2 font-mono text-slate-500">{a.time?.slice(0, 10) ?? ""}</span>
                      <span className="text-slate-300">{a.title}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="text-xs text-slate-500">近 10 日无公告或数据不可用</div>}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
