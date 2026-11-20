"use client";

/**
 * 选股结果表
 *
 * - 顶部 TopN 切换（4 / 8 / 12）
 * - 每行：排名徽标 / 代码名称 / 行业 / 价格 / 涨幅 / 开盘 / 成交额 / 量比 / T0 / 综合分（含评分条）
 * - 展开：五路 Agent 雷达图 + 逐项明细 + T0 拆解
 * - 底部：风控熔断名单（可折叠）
 */

import { useState } from "react";
import { RadarChart, ScoreBar } from "@/components/charts";
import { AGENT_META, fmtAmount, fmtPct, pctColor, scoreColor } from "@/lib/format";
import type { ScoredStock } from "@/lib/types";

const TOPN_OPTIONS = [4, 8, 12] as const;

const RADAR_AXES = ["技术面", "板块共振", "风格基本面", "风控", "相对强度"];

function Rank({ i }: { i: number }) {
  const tone =
    i === 0
      ? { bg: "rgba(232,200,135,0.18)", border: "rgba(232,200,135,0.5)", color: "#e8c887" }
      : i < 3
        ? { bg: "rgba(79,209,197,0.12)", border: "rgba(79,209,197,0.36)", color: "#4fd1c5" }
        : { bg: "rgba(255,255,255,0.05)", border: "var(--hairline)", color: "var(--ink-mute)" };
  return (
    <span
      className="tnum inline-flex h-6 w-6 items-center justify-center rounded-[7px] border font-mono text-[11.5px] font-semibold"
      style={{ background: tone.bg, borderColor: tone.border, color: tone.color }}
    >
      {i + 1}
    </span>
  );
}

function AgentBlock({
  label, color, score, detail, delay,
}: {
  label: string;
  color: string;
  score: number;
  detail?: React.ReactNode;
  delay: number;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--ink-soft)]">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
          {label}
        </span>
        <span className="tnum font-mono text-[12px]" style={{ color: scoreColor(score) }}>
          {score.toFixed(1)}
        </span>
      </div>
      <ScoreBar value={score} color={color} delay={delay} />
      {detail && <div className="mt-1.5 text-[10.5px] leading-relaxed text-[var(--ink-mute)]">{detail}</div>}
    </div>
  );
}

function ExpandedDetail({ s }: { s: ScoredStock }) {
  const ethan = (s.agents.ethan.details ?? {}) as Record<string, unknown>;
  const lucasHits = (s.agents.lucas.details as { hits?: string[] } | undefined)?.hits ?? [];
  const edwin = (s.agents.edwin.details ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(1) : "—";
  };
  const bonusHits = Array.isArray(ethan.bonus_hits) ? (ethan.bonus_hits as string[]) : [];

  const radarSeries = [
    {
      label: "五路因子",
      color: "#d4b06b",
      values: [
        s.agents.ethan.score,
        s.agents.lucas.score,
        s.agents.edwin.score,
        s.agents.sophia.score,
        s.agents.mia.score,
      ],
    },
  ];

  return (
    <div className="animate-fade-in grid gap-6 border-t border-[var(--hairline)] bg-black/15 px-5 py-4 lg:grid-cols-[auto_1fr_1fr]">
      {/* 雷达 */}
      <div className="flex flex-col items-center">
        <RadarChart series={radarSeries} axes={RADAR_AXES} size={196} />
        <div className="mt-1 text-[10px] text-[var(--ink-faint)]">五路因子评分雷达</div>
      </div>

      {/* Agent 明细 */}
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <AgentBlock
          label={AGENT_META.ethan.label}
          color={AGENT_META.ethan.color}
          score={s.agents.ethan.score}
          delay={0}
          detail={
            <>
              趋势 {num(ethan.trend)} · 资金 {num(ethan.capital)} · 质量 {num(ethan.quality)} ·
              位置 {num(ethan.position)} · 动量 {num(ethan.momentum)} · 安全 {num(ethan.safety)}
              {bonusHits.length > 0 && (
                <span className="mt-1 block text-[rgba(232,200,135,0.85)]">{bonusHits.join("；")}</span>
              )}
            </>
          }
        />
        <AgentBlock
          label={AGENT_META.lucas.label}
          color={AGENT_META.lucas.color}
          score={s.agents.lucas.score}
          delay={60}
          detail={lucasHits.length > 0 ? lucasHits.join("；") : "无板块共振加分"}
        />
        <AgentBlock
          label={AGENT_META.edwin.label}
          color={AGENT_META.edwin.color}
          score={s.agents.edwin.score}
          delay={120}
          detail={`风格匹配 ${num(edwin.style)} · 基本面 ${num(edwin.fundamental)}`}
        />
        <AgentBlock
          label={AGENT_META.mia.label}
          color={AGENT_META.mia.color}
          score={s.agents.mia.score}
          delay={180}
          detail="相对市场均值的超额收益映射"
        />
        <div className="sm:col-span-2">
          <AgentBlock
            label={AGENT_META.sophia.label}
            color={AGENT_META.sophia.color}
            score={s.agents.sophia.score}
            delay={240}
            detail={
              s.penaltyReasons.length > 0 ? (
                <span style={{ color: "rgba(246,70,93,0.85)" }}>扣分：{s.penaltyReasons.join("；")}</span>
              ) : (
                "未触发风控扣分"
              )
            }
          />
        </div>
      </div>

      {/* T0 拆解 */}
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11.5px] text-[var(--ink-soft)]">T0 竞价评分</span>
            <span className="tnum font-mono text-[12px] text-[var(--ink)]">
              {s.t0.t0.toFixed(2)}
              <span className="ml-1 text-[10px] text-[var(--ink-faint)]">归一 {s.t0Norm.toFixed(0)}</span>
            </span>
          </div>
          <ScoreBar value={(s.t0.t0 - 0.5) * 100} color="#d4b06b" />
          <div className="mt-1.5 text-[10.5px] leading-relaxed text-[var(--ink-mute)]">
            催化剂 {s.t0.catalyst} × 0.5 · 安全性 {s.t0.safety} × 0.3 · 信号确认 {s.t0.confirm} × 0.2
          </div>
        </div>

        <div className="divider" />

        <div className="space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-[var(--ink-mute)]">五路因子加权</span>
            <span className="tnum font-mono text-[var(--ink-soft)]">{s.agentBase.toFixed(1)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--ink-mute)]">T0 归一分</span>
            <span className="tnum font-mono text-[var(--ink-soft)]">{s.t0Norm.toFixed(1)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--ink-mute)]">开盘涨幅</span>
            <span className="tnum font-mono" style={{ color: pctColor(s.openPct) }}>
              {fmtPct(s.openPct)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--ink-mute)]">综合得分</span>
            <span className="tnum font-mono text-[13px] font-semibold" style={{ color: scoreColor(s.finalScore) }}>
              {s.finalScore.toFixed(1)}
            </span>
          </div>
        </div>

        {s.openPct >= 9.5 && (
          <div className="rounded-[9px] border border-[rgba(240,163,94,0.3)] bg-[rgba(240,163,94,0.09)] px-3 py-2 text-[10.5px] leading-relaxed text-[#f0a35e]">
            开盘涨幅 ≥ 9.5%，已按规则将总分乘以 0.30（大概率买不进，按纪律不追）。
          </div>
        )}
        {s.t0Neutral && (
          <div className="rounded-[9px] border border-[rgba(240,163,94,0.3)] bg-[rgba(240,163,94,0.09)] px-3 py-2 text-[10.5px] leading-relaxed text-[#f0a35e]">
            缺少竞价数据，T0 已落中性值 1.0 —— 建议在 9:25–9:28 竞价结束后重新运行。
          </div>
        )}
      </div>
    </div>
  );
}

export default function ResultTable({
  results, vetoed, topN, onTopNChange, onSelect, loading, elapsedMs,
}: {
  results: ScoredStock[];
  vetoed: ScoredStock[];
  topN: number;
  onTopNChange: (n: (typeof TOPN_OPTIONS)[number]) => void;
  onSelect: (code: string) => void;
  loading: boolean;
  elapsedMs?: number;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showVetoed, setShowVetoed] = useState(false);

  const maxScore = results.length > 0 ? Math.max(...results.map((s) => s.finalScore)) : 1;

  return (
    <div className="panel panel-sheen overflow-hidden">
      {/* 头部 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--hairline)] px-5 py-3">
        <div>
          <div className="text-[13.5px] font-semibold tracking-tight">选股结果</div>
          <div className="mt-0.5 text-[10.5px] text-[var(--ink-faint)]">
            行业分散强制约束 · 同行业最多 ⌈TopN/4⌉ 只 · Top3 必属三个不同行业
          </div>
        </div>

        <div className="flex-1" />

        {elapsedMs !== undefined && results.length > 0 && (
          <span className="chip tnum">耗时 {(elapsedMs / 1000).toFixed(1)}s</span>
        )}

        <div className="flex items-center gap-1 rounded-[9px] border border-[var(--hairline)] bg-black/20 p-0.5">
          {TOPN_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => onTopNChange(n)}
              className={`tnum rounded-[6px] px-2.5 py-1 font-mono text-[11.5px] transition-all ${
                topN === n
                  ? "bg-[rgba(212,176,107,0.16)] text-[#e8c887] shadow-[inset_0_0_0_1px_rgba(212,176,107,0.35)]"
                  : "text-[var(--ink-mute)] hover:text-[var(--ink)]"
              }`}
            >
              Top{n}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-9 rounded-[8px]" style={{ animationDelay: `${i * 90}ms` }} />
          ))}
          <div className="pt-2 text-center text-[11.5px] text-[var(--ink-mute)]">
            正在拉取全市场快照并逐只打分，耗时约 10–30 秒…
          </div>
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
          <span className="text-[22px] text-[var(--ink-faint)]">◍</span>
          <div className="text-[13px] text-[var(--ink-soft)]">暂无结果</div>
          <div className="text-[11.5px] text-[var(--ink-faint)]">
            点击上方「运行选股流水线」开始全市场扫描
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            {/* 表头 */}
            <div className="grid grid-cols-[42px_1.6fr_1.1fr_72px_72px_72px_84px_60px_56px_130px] items-center gap-2 border-b border-[var(--hairline)] px-5 py-2 text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
              <div>#</div>
              <div>代码 / 名称</div>
              <div>行业</div>
              <div className="text-right">现价</div>
              <div className="text-right">涨幅</div>
              <div className="text-right">开盘</div>
              <div className="text-right">成交额</div>
              <div className="text-right">量比</div>
              <div className="text-right">T0</div>
              <div className="text-right">综合得分</div>
            </div>

            {results.map((s, i) => (
              <div key={s.code}>
                <div
                  className="row-hover grid cursor-pointer grid-cols-[42px_1.6fr_1.1fr_72px_72px_72px_84px_60px_56px_130px] items-center gap-2 border-b border-[var(--hairline)]/50 px-5 py-2.5 text-[13px]"
                  onClick={() => setExpanded(expanded === s.code ? null : s.code)}
                >
                  <div>
                    <Rank i={i} />
                  </div>

                  <div className="flex items-baseline gap-2 overflow-hidden">
                    <button
                      className="tnum shrink-0 font-mono text-[12px] text-[var(--ink-soft)] transition-colors hover:text-[#e8c887]"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(s.code);
                      }}
                      title="查看个股明细"
                    >
                      {s.code}
                    </button>
                    <span className="truncate text-[12.5px] text-[var(--ink)]">{s.name ?? "—"}</span>
                  </div>

                  <div className="truncate text-[11.5px] text-[var(--ink-mute)]">{s.industry ?? "未知"}</div>

                  <div className="tnum text-right font-mono text-[12.5px] text-[var(--ink)]">
                    {s.quote.price.toFixed(2)}
                  </div>

                  <div className="tnum text-right font-mono text-[12.5px]" style={{ color: pctColor(s.quote.pct) }}>
                    {fmtPct(s.quote.pct)}
                  </div>

                  <div className="tnum text-right font-mono text-[12.5px]" style={{ color: pctColor(s.openPct) }}>
                    {fmtPct(s.openPct)}
                  </div>

                  <div className="tnum text-right font-mono text-[12px] text-[var(--ink-soft)]">
                    {fmtAmount(s.quote.amount)}
                  </div>

                  <div className="tnum text-right font-mono text-[12px] text-[var(--ink-soft)]">
                    {s.quote.volumeRatio > 0 ? s.quote.volumeRatio.toFixed(1) : "—"}
                  </div>

                  <div className="tnum text-right font-mono text-[12px] text-[var(--ink-soft)]">
                    {s.t0.t0.toFixed(2)}
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <div className="hidden w-[72px] sm:block">
                      <ScoreBar
                        value={maxScore > 0 ? (s.finalScore / maxScore) * 100 : 0}
                        color={scoreColor(s.finalScore)}
                        height={4}
                        delay={i * 60}
                      />
                    </div>
                    <span
                      className="tnum w-10 text-right font-mono text-[13.5px] font-semibold"
                      style={{ color: scoreColor(s.finalScore) }}
                    >
                      {s.finalScore.toFixed(1)}
                    </span>
                  </div>
                </div>

                {expanded === s.code && <ExpandedDetail s={s} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 熔断名单 */}
      {vetoed.length > 0 && (
        <div className="border-t border-[var(--hairline)] px-5 py-2.5">
          <button
            className="text-[11.5px] text-[var(--ink-mute)] transition-colors hover:text-[#ff8a99]"
            onClick={() => setShowVetoed(!showVetoed)}
          >
            {showVetoed ? "收起" : "展开"}风控熔断名单（{vetoed.length} 只）
          </button>
          {showVetoed && (
            <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
              {vetoed.map((s) => (
                <div
                  key={s.code}
                  className="flex flex-wrap items-baseline gap-2 rounded-[8px] border border-[rgba(246,70,93,0.2)] bg-[rgba(246,70,93,0.05)] px-2.5 py-1.5 text-[11px]"
                >
                  <span className="tnum font-mono text-[var(--ink-soft)]">{s.code}</span>
                  <span className="text-[var(--ink-mute)]">{s.name ?? ""}</span>
                  <span className="text-[#ff8a99]">{s.vetoReasons.join("；")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
