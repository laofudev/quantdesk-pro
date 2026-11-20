"use client";

/**
 * 市场环境卡（Phase 0）
 *
 * 三栏结构：
 *   左 —— 半环仪表（TM 开盘涨幅截尾均值）+ 环境判定
 *   中 —— 市场宽度（涨跌家数 / 涨跌比 / 涨停跌停 / 情绪指标）
 *   右 —— 五路 Agent 动态权重（随行情环境自动调整）
 */

import { RegimeDial, WeightBars, Sparkline } from "@/components/charts";
import type { EmotionPoint } from "@/lib/types";

export interface RegimeData {
  tm: number;
  regime: string;
  label: string;
  confirms: string[];
  weights: { ethan: number; lucas: number; edwin: number; sophia: number; mia: number };
  stats: {
    sampleSize: number;
    upCount: number;
    downCount: number;
    limitUpCount: number;
    limitDownCount: number;
    stockAdvRatio: number | null;
  };
  emotion: EmotionPoint | null;
  emotionSeries?: EmotionPoint[];
  source: string;
  degraded: boolean;
  tradeDate?: string;
  sectorCount?: number;
  message?: string;
}

/** 9 档环境配色（暖 = 强，冷 = 弱） */
const REGIME_TONE: Record<string, string> = {
  大涨: "#f6465d",
  上涨: "#f6764f",
  震荡偏强: "#f0a35e",
  震荡均衡: "#a8b0c2",
  均衡: "#a8b0c2",
  震荡偏弱: "#4fd1c5",
  下跌: "#2fb8a6",
  大跌: "#0ecb81",
  超卖反弹: "#d4b06b",
};

function toneOf(regime: string): string {
  return REGIME_TONE[regime] ?? "#a8b0c2";
}

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">{label}</div>
      <div className="tnum mt-0.5 font-mono text-[13px]" style={{ color: accent ?? "var(--ink-soft)" }}>
        {value}
      </div>
    </div>
  );
}

export default function RegimeCard({ data, loading }: { data: RegimeData | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="panel panel-sheen p-5">
        <div className="mb-3 h-3 w-40 rounded skeleton" />
        <div className="grid gap-6 md:grid-cols-[auto_1fr_1fr]">
          <div className="skeleton h-[104px] w-[168px] rounded-full" />
          <div className="skeleton h-[90px] rounded-[10px]" />
          <div className="skeleton h-[90px] rounded-[10px]" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="panel panel-sheen p-5">
        <div className="text-[13px] text-[var(--ink-mute)]">市场环境数据不可用</div>
      </div>
    );
  }

  const tone = toneOf(data.regime);
  const s = data.stats;
  const total = s.upCount + s.downCount;
  const upPct = total > 0 ? (s.upCount / total) * 100 : 0;
  const em = data.emotion;
  const series = (data.emotionSeries ?? []).map((p) => p.ztjs ?? 0);

  return (
    <div className="panel panel-sheen overflow-hidden">
      {/* 顶部条 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--hairline)] px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: tone, boxShadow: `0 0 10px ${tone}` }}
          />
          <span className="label">市场环境 · Regime</span>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-[19px] font-semibold tracking-tight" style={{ color: tone }}>
            {data.regime}
          </span>
          <span className="text-[12px] text-[var(--ink-mute)]">{data.label}</span>
        </div>

        {data.tradeDate && (
          <span className="chip chip-gold tnum">交易日 {data.tradeDate}</span>
        )}
        {data.sectorCount !== undefined && data.sectorCount > 0 && (
          <span className="chip">覆盖行业 {data.sectorCount}</span>
        )}

        <div className="flex-1" />

        {data.degraded && <span className="chip chip-up">数据降级</span>}
        <span className="chip chip-cyan">{data.source === "fuyao" ? "扶摇 · 同花顺" : "中性值"}</span>
      </div>

      {/* 三栏 */}
      <div className="grid gap-6 p-5 md:grid-cols-[auto_1fr_1fr]">
        {/* 左：仪表 */}
        <div className="flex flex-col items-center justify-center">
          <RegimeDial value={data.tm} label={data.regime} sublabel="TM 开盘涨幅截尾均值" color={tone} />
          <div className="mt-1 text-center text-[10.5px] leading-relaxed text-[var(--ink-faint)]">
            全市场 {s.sampleSize} 只样本 · 去除首尾各 2% 后取均值
          </div>
        </div>

        {/* 中：市场宽度 */}
        <div className="flex flex-col gap-3">
          <div className="label">市场宽度</div>

          <div className="grid grid-cols-3 gap-x-3 gap-y-3">
            <Stat label="上涨" value={<span style={{ color: "var(--up)" }}>{s.upCount}</span>} />
            <Stat label="下跌" value={<span style={{ color: "var(--down)" }}>{s.downCount}</span>} />
            <Stat
              label="涨跌比"
              value={s.stockAdvRatio === null ? "—" : s.stockAdvRatio.toFixed(2)}
            />
            <Stat label="涨停" value={<span style={{ color: "var(--up)" }}>{s.limitUpCount}</span>} />
            <Stat label="跌停" value={<span style={{ color: "var(--down)" }}>{s.limitDownCount}</span>} />
            <Stat
              label="情绪"
              value={
                em?.dbcgl !== undefined
                  ? `打板 ${(em.dbcgl * 100).toFixed(0)}%`
                  : em?.ztjs !== undefined
                    ? `涨停 ${em.ztjs}`
                    : "—"
              }
            />
          </div>

          {/* 涨跌宽度条 */}
          <div>
            <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--ink-faint)]">
              <span>上涨占比</span>
              <span className="tnum">{upPct.toFixed(1)}%</span>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full transition-[width] duration-700"
                style={{ width: `${upPct}%`, background: "var(--up)" }}
              />
              <div
                className="h-full transition-[width] duration-700"
                style={{ width: `${100 - upPct}%`, background: "var(--down)" }}
              />
            </div>
          </div>

          {/* 情绪序列 */}
          {series.length > 2 && (
            <div className="flex items-center justify-between gap-3 rounded-[9px] border border-[var(--hairline)] bg-black/20 px-3 py-2">
              <div>
                <div className="text-[10px] text-[var(--ink-faint)]">近 {series.length} 日涨停家数</div>
                <div className="tnum mt-0.5 font-mono text-[13px] text-[var(--ink-soft)]">
                  {em?.ztjs ?? "—"}
                  <span className="ml-1 text-[10px] text-[var(--ink-faint)]">今日</span>
                </div>
              </div>
              <Sparkline data={series} width={130} height={34} color="var(--up)" />
            </div>
          )}

          {em?.hot && em.hot.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {em.hot.map((h) => (
                <span key={h} className="chip chip-gold">
                  {h}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 右：权重 */}
        <div className="flex flex-col gap-3">
          <div className="label">因子动态权重 · 随行情自适应</div>
          <WeightBars weights={data.weights} />
          <p className="text-[10.5px] leading-relaxed text-[var(--ink-faint)]">
            环境越差，风控（Sophia）权重自动升高、基本面权重压低；环境转强则技术面与板块共振权重上移。
          </p>
        </div>
      </div>

      {/* 底部：跌势确认 */}
      {data.confirms.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--hairline)] bg-[rgba(246,70,93,0.045)] px-5 py-2.5">
          <span className="text-[11px] font-medium" style={{ color: "var(--up)" }}>
            跌势确认
          </span>
          {data.confirms.map((c) => (
            <span key={c} className="chip chip-up">
              {c}
            </span>
          ))}
        </div>
      )}
      {data.message && (
        <div className="border-t border-[var(--hairline)] px-5 py-2 text-[11px] text-[var(--ink-faint)]">
          {data.message}
        </div>
      )}
    </div>
  );
}
