"use client";

/** 结果表：行业分散 Top4/8/12 切换，行展开显示各 agent 分明细 */

import { useState } from "react";
import type { ScoredStock } from "@/lib/types";

const TOPN_OPTIONS = [4, 8, 12] as const;

function fmtAmount(v: number): string {
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  return `${(v / 1e4).toFixed(0)}万`;
}

function Pct({ v }: { v: number }) {
  return (
    <span className={`font-mono ${v >= 0 ? "text-red-400" : "text-emerald-400"}`}>
      {v >= 0 ? "+" : ""}{v.toFixed(2)}%
    </span>
  );
}

function ScoreBar({ label, value, detail }: { label: string; value: number; detail?: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono text-slate-200">{value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-slate-700">
        <div className="h-full bg-amber-accent/80" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      {detail && <div className="mt-1 text-[11px] leading-4 text-slate-500">{detail}</div>}
    </div>
  );
}

function ExpandedDetail({ s }: { s: ScoredStock }) {
  const ethanDetails = (s.agents.ethan.details ?? {}) as Record<string, unknown>;
  const lucasHits = (s.agents.lucas.details as { hits?: string[] } | undefined)?.hits ?? [];
  const edwinDetails = (s.agents.edwin.details ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : "-";
  };
  return (
    <div className="grid grid-cols-1 gap-4 border-t border-slate-700/60 px-4 py-3 md:grid-cols-2 lg:grid-cols-3">
      <ScoreBar
        label="Ethan 技术（六维加权+bonus）"
        value={s.agents.ethan.score}
        detail={
          <>
            趋势{num(ethanDetails.trend)} / 资金{num(ethanDetails.capital)} / 质量{num(ethanDetails.quality)} /
            位置{num(ethanDetails.position)} / 动量{num(ethanDetails.momentum)} / 安全{num(ethanDetails.safety)}，
            加减分{num(ethanDetails.tech_bonus)}
            {Array.isArray(ethanDetails.bonus_hits) && (ethanDetails.bonus_hits as string[]).length > 0 && (
              <span className="block">{(ethanDetails.bonus_hits as string[]).join("；")}</span>
            )}
          </>
        }
      />
      <ScoreBar label="Lucas 板块共振" value={s.agents.lucas.score} detail={lucasHits.join("；")} />
      <ScoreBar
        label="Edwin 风格×基本面"
        value={s.agents.edwin.score}
        detail={`风格${num(edwinDetails.style)} / 基本面${num(edwinDetails.fundamental)}`}
      />
      <ScoreBar
        label="Sophia 风控"
        value={s.agents.sophia.score}
        detail={
          s.penaltyReasons.length > 0 ? s.penaltyReasons.join("；") : "未触发扣分"
        }
      />
      <ScoreBar label="Mia 市场相对强度" value={s.agents.mia.score} />
      <div>
        <div className="mb-0.5 flex items-center justify-between text-xs">
          <span className="text-slate-400">T0 竞价评分</span>
          <span className="font-mono text-slate-200">{s.t0.t0.toFixed(2)}（归一 {s.t0Norm.toFixed(0)}）</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded bg-slate-700">
          <div className="h-full bg-amber-accent/80" style={{ width: `${Math.max(0, Math.min(100, (s.t0.t0 - 0.5) * 100))}%` }} />
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          催化剂 {s.t0.catalyst} × 0.5 + 安全性 {s.t0.safety} × 0.3 + 信号确认 {s.t0.confirm} × 0.2
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          agent_base {s.agentBase.toFixed(1)}；开盘涨幅 {s.openPct >= 0 ? "+" : ""}{s.openPct.toFixed(2)}%
          {s.openPct >= 9.5 && <span className="text-amber-accent">（≥9.5% 总分×0.3）</span>}
        </div>
      </div>
    </div>
  );
}

export default function ResultTable({
  results, vetoed, topN, onTopNChange, onSelect, loading,
}: {
  results: ScoredStock[];
  vetoed: ScoredStock[];
  topN: number;
  onTopNChange: (n: (typeof TOPN_OPTIONS)[number]) => void;
  onSelect: (code: string) => void;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showVetoed, setShowVetoed] = useState(false);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60">
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-200">选股结果（行业分散强制）</h2>
        <div className="flex items-center gap-1 text-xs">
          <span className="mr-1 text-slate-500">TopN：</span>
          {TOPN_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => onTopNChange(n)}
              className={`rounded px-2.5 py-1 font-mono transition ${
                topN === n ? "bg-amber-accent font-semibold text-slate-900" : "bg-slate-700/60 text-slate-300 hover:bg-slate-700"
              }`}
            >
              Top{n}
            </button>
          ))}
          <span className="ml-3 text-slate-500">同行业最多 {Math.ceil(topN / 4)} 只</span>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-slate-400">流水线运行中，请稍候…</div>
      ) : results.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-500">暂无结果。请先运行选股流水线。</div>
      ) : (
        <div className="divide-y divide-slate-700/60 overflow-x-auto">
          {/* 表头 */}
          <div className="grid min-w-[760px] grid-cols-12 gap-2 px-4 py-2 text-xs text-slate-500">
            <div className="col-span-1">#</div>
            <div className="col-span-2">代码 / 名称</div>
            <div className="col-span-2">行业</div>
            <div className="col-span-1 text-right">现价</div>
            <div className="col-span-1 text-right">涨幅</div>
            <div className="col-span-1 text-right">开盘</div>
            <div className="col-span-1 text-right">成交额</div>
            <div className="col-span-1 text-right">量比</div>
            <div className="col-span-1 text-right">T0</div>
            <div className="col-span-1 text-right">综合分</div>
          </div>
          {results.map((s, i) => (
            <div key={s.code}>
              <div
                className="grid min-w-[760px] cursor-pointer grid-cols-12 items-center gap-2 px-4 py-2 text-sm transition hover:bg-slate-700/30"
                onClick={() => setExpanded(expanded === s.code ? null : s.code)}
              >
                <div className="col-span-1 font-mono text-amber-accent">{i + 1}</div>
                <div className="col-span-2">
                  <button
                    className="font-mono text-slate-200 underline decoration-slate-600 underline-offset-2 hover:text-amber-accent"
                    onClick={(e) => { e.stopPropagation(); onSelect(s.code); }}
                  >
                    {s.code}
                  </button>
                  <span className="ml-1.5 text-xs text-slate-400">{s.name ?? ""}</span>
                </div>
                <div className="col-span-2 truncate text-xs text-slate-400">{s.industry ?? "未知"}</div>
                <div className="col-span-1 text-right font-mono">{s.quote.price.toFixed(2)}</div>
                <div className="col-span-1 text-right"><Pct v={s.quote.pct} /></div>
                <div className="col-span-1 text-right"><Pct v={s.openPct} /></div>
                <div className="col-span-1 text-right font-mono text-xs text-slate-300">{fmtAmount(s.quote.amount)}</div>
                <div className="col-span-1 text-right font-mono text-xs text-slate-300">{s.quote.volumeRatio.toFixed(1)}</div>
                <div className="col-span-1 text-right font-mono text-xs text-slate-300">{s.t0.t0.toFixed(2)}</div>
                <div className="col-span-1 text-right font-mono font-semibold text-amber-accent">{s.finalScore.toFixed(1)}</div>
              </div>
              {expanded === s.code && <ExpandedDetail s={s} />}
            </div>
          ))}
        </div>
      )}

      {/* 熔断名单 */}
      {vetoed.length > 0 && (
        <div className="border-t border-slate-700 px-4 py-2">
          <button className="text-xs text-slate-400 hover:text-amber-accent" onClick={() => setShowVetoed(!showVetoed)}>
            {showVetoed ? "收起" : "展开"}风控熔断名单（{vetoed.length} 只）
          </button>
          {showVetoed && (
            <div className="mt-2 space-y-1">
              {vetoed.map((s) => (
                <div key={s.code} className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="font-mono text-slate-300">{s.code}</span>
                  <span className="text-slate-500">{s.name ?? ""}</span>
                  <span className="text-emerald-300">{s.vetoReasons.join("；")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
