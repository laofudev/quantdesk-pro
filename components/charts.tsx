"use client";

/**
 * SVG 可视化组件集（零依赖，手写路径）
 * - RadarChart：五路因子雷达
 * - RegimeDial：市场环境半环仪表
 * - WeightBars：Agent 权重条
 * - Sparkline：情绪序列迷你折线
 * - CandleChart：K 线 + 均线
 */

import { useMemo } from "react";

/* ============================ 雷达图 ============================ */

export interface RadarSeries {
  label: string;
  color: string;
  values: number[]; // 0-100
}

export function RadarChart({
  series,
  axes,
  size = 220,
  max = 100,
}: {
  series: RadarSeries[];
  axes: string[];
  size?: number;
  max?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 34;
  const n = axes.length;

  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i: number, v: number) => {
    const rr = (Math.max(0, Math.min(v, max)) / max) * r;
    return [cx + Math.cos(angle(i)) * rr, cy + Math.sin(angle(i)) * rr] as const;
  };

  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
      <defs>
        {series.map((s, si) => (
          <linearGradient key={si} id={`radar-grad-${si}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.34" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0.06" />
          </linearGradient>
        ))}
      </defs>

      {/* 网格环 */}
      {rings.map((k) => (
        <polygon
          key={k}
          points={axes
            .map((_, i) => {
              const rr = r * k;
              return `${cx + Math.cos(angle(i)) * rr},${cy + Math.sin(angle(i)) * rr}`;
            })
            .join(" ")}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth="1"
        />
      ))}

      {/* 轴线 */}
      {axes.map((_, i) => {
        const [x, y] = point(i, max);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
          />
        );
      })}

      {/* 数据多边形 */}
      {series.map((s, si) => (
        <g key={si}>
          <polygon
            points={s.values.map((v, i) => point(i, v).join(",")).join(" ")}
            fill={`url(#radar-grad-${si})`}
            stroke={s.color}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          {s.values.map((v, i) => {
            const [x, y] = point(i, v);
            return <circle key={i} cx={x} cy={y} r="2.4" fill={s.color} />;
          })}
        </g>
      ))}

      {/* 轴标签 */}
      {axes.map((label, i) => {
        const [x, y] = point(i, max * 1.19);
        const anchor = Math.abs(x - cx) < 6 ? "middle" : x > cx ? "start" : "end";
        return (
          <text
            key={label}
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
            fontSize="10.5"
            fill="var(--ink-mute)"
            style={{ fontWeight: 500 }}
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}

/* ============================ 半环仪表 ============================ */

export function RegimeDial({
  value,
  label,
  sublabel,
  color = "var(--gold-bright)",
  size = 168,
}: {
  value: number; // -3 ~ +3 %
  label: string;
  sublabel?: string;
  color?: string;
  size?: number;
}) {
  const w = size;
  const h = size * 0.62;
  const cx = w / 2;
  const cy = h - 14;
  const r = size / 2 - 16;
  const min = -3;
  const max = 3;

  const arc = (from: number, to: number, rad: number) => {
    const a0 = Math.PI + ((from - min) / (max - min)) * Math.PI;
    const a1 = Math.PI + ((to - min) / (max - min)) * Math.PI;
    const x0 = cx + Math.cos(a0) * rad;
    const y0 = cy + Math.sin(a0) * rad;
    const x1 = cx + Math.cos(a1) * rad;
    const y1 = cy + Math.sin(a1) * rad;
    return `M ${x0} ${y0} A ${rad} ${rad} 0 0 1 ${x1} ${y1}`;
  };

  const clamped = Math.max(min, Math.min(max, value));
  const t = (clamped - min) / (max - min);
  const a = Math.PI + t * Math.PI;
  const nx = cx + Math.cos(a) * (r - 13);
  const ny = cy + Math.sin(a) * (r - 13);

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <linearGradient id="dial-track" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(246,70,93,0.4)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.08)" />
          <stop offset="100%" stopColor="rgba(14,203,129,0.4)" />
        </linearGradient>
        <filter id="dial-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path d={arc(min, max, r)} fill="none" stroke="url(#dial-track)" strokeWidth="9" strokeLinecap="round" />
      {/* 刻度 */}
      {[-3, -1.5, 0, 1.5, 3].map((v) => {
        const aa = Math.PI + ((v - min) / (max - min)) * Math.PI;
        const x1 = cx + Math.cos(aa) * (r + 6);
        const y1 = cy + Math.sin(aa) * (r + 6);
        const x2 = cx + Math.cos(aa) * (r + 11);
        const y2 = cy + Math.sin(aa) * (r + 11);
        return (
          <line
            key={v}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="1.2"
          />
        );
      })}

      <circle cx={nx} cy={ny} r="5" fill={color} filter="url(#dial-glow)" />

      <text x={cx} y={cy - 16} textAnchor="middle" fontSize="27" fontWeight="600" fill="var(--ink)" className="tnum">
        {value > 0 ? "+" : ""}
        {value.toFixed(2)}%
      </text>
      <text x={cx} y={cy + 2} textAnchor="middle" fontSize="12.5" fill={color} fontWeight="600">
        {label}
      </text>
      {sublabel && (
        <text x={cx} y={cy + 17} textAnchor="middle" fontSize="10" fill="var(--ink-faint)">
          {sublabel}
        </text>
      )}
    </svg>
  );
}

/* ============================ 权重条 ============================ */

export function WeightBars({
  weights,
}: {
  weights: Record<string, number>;
}) {
  const meta: Record<string, { label: string; color: string }> = {
    ethan: { label: "技术", color: "#d4b06b" },
    lucas: { label: "板块", color: "#4fd1c5" },
    edwin: { label: "风格", color: "#8b7ff0" },
    sophia: { label: "风控", color: "#f6465d" },
    mia: { label: "强度", color: "#f0a35e" },
  };
  return (
    <div className="space-y-1.5">
      {Object.entries(weights).map(([k, v]) => {
        const m = meta[k];
        if (!m) return null;
        return (
          <div key={k} className="flex items-center gap-2.5">
            <span className="w-8 shrink-0 text-[11px] text-[var(--ink-mute)]">{m.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: `${Math.min(100, (v / 0.45) * 100)}%`,
                  background: `linear-gradient(90deg, ${m.color}99, ${m.color})`,
                }}
              />
            </div>
            <span className="tnum w-9 shrink-0 text-right font-mono text-[11px] text-[var(--ink-soft)]">
              {(v * 100).toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ============================ 迷你折线 ============================ */

export function Sparkline({
  data,
  width = 120,
  height = 30,
  color = "var(--cyan)",
  fill = true,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}) {
  const path = useMemo(() => {
    if (data.length < 2) return { line: "", area: "" };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const pts = data.map((v, i) => {
      const x = (i / (data.length - 1)) * (width - 2) + 1;
      const y = height - 2 - ((v - min) / span) * (height - 4);
      return [x, y] as const;
    });
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    const area = `${line} L ${width - 1} ${height} L 1 ${height} Z`;
    return { line, area };
  }, [data, width, height]);

  if (data.length < 2) {
    return <div style={{ width, height }} className="skeleton" />;
  }

  return (
    <svg width={width} height={height} className="overflow-visible">
      {fill && <path d={path.area} fill={color} opacity="0.12" />}
      <path d={path.line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ============================ K 线图 ============================ */

interface Candle {
  x: number;
  bw: number;
  yHigh: number;
  yLow: number;
  yOpen: number;
  yClose: number;
  up: boolean;
}

export function CandleChart({
  bars,
  height = 190,
  showMA = true,
}: {
  bars: { date: string; open: number; high: number; low: number; close: number }[];
  height?: number;
  showMA?: boolean;
}) {
  const w = 620;
  const pad = { top: 12, right: 46, bottom: 20, left: 8 };

  const { candles, ma5, ma20, min, max } = useMemo(() => {
    if (bars.length === 0) return { candles: [] as Candle[], ma5: "", ma20: "", min: 0, max: 1 };
    const closes = bars.map((b) => b.close);
    const lows = bars.map((b) => b.low);
    const highs = bars.map((b) => b.high);
    const lo = Math.min(...lows);
    const hi = Math.max(...highs);
    const padY = (hi - lo) * 0.08 || 1;
    const minV = lo - padY;
    const maxV = hi + padY;
    const span = maxV - minV || 1;

    const plotH = height - pad.top - pad.bottom;
    const plotW = w - pad.left - pad.right;
    const bw = Math.max(1.6, (plotW / bars.length) * 0.62);
    const gap = plotW / bars.length;

    const c = bars.map((b, i) => {
      const x = pad.left + i * gap + (gap - bw) / 2;
      const yHigh = pad.top + (1 - (b.high - minV) / span) * plotH;
      const yLow = pad.top + (1 - (b.low - minV) / span) * plotH;
      const yOpen = pad.top + (1 - (b.open - minV) / span) * plotH;
      const yClose = pad.top + (1 - (b.close - minV) / span) * plotH;
      return { x, bw, yHigh, yLow, yOpen, yClose, up: b.close >= b.open };
    });

    const ma = (n: number) =>
      closes.map((_, i) => {
        if (i < n - 1) return null;
        const slice = closes.slice(i - n + 1, i + 1);
        return slice.reduce((s, v) => s + v, 0) / n;
      });

    const toY = (v: number) => pad.top + (1 - (v - minV) / span) * plotH;
    const line = (arr: (number | null)[]) => {
      let d = "";
      let started = false;
      arr.forEach((v, i) => {
        if (v === null) return;
        const x = pad.left + i * gap + gap / 2;
        const y = toY(v);
        d += `${started ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)} `;
        started = true;
      });
      return d;
    };

    return {
      candles: c,
      ma5: line(ma(5)),
      ma20: line(ma(20)),
      min: minV,
      max: maxV,
    };
  }, [bars, height]);

  if (bars.length === 0) return <div className="skeleton" style={{ height }} />;

  const last = bars[bars.length - 1];
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  const changePct = prev ? ((last.close / prev.close - 1) * 100) : 0;
  const lineColor = changePct >= 0 ? "var(--up)" : "var(--down)";

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      {candles.map((c, i) => (
        <g key={i}>
          <line
            x1={c.x + c.bw / 2}
            y1={c.yHigh}
            x2={c.x + c.bw / 2}
            y2={c.yLow}
            stroke={c.up ? "var(--up)" : "var(--down)"}
            strokeWidth="0.9"
            opacity="0.75"
          />
          <rect
            x={c.x}
            y={Math.min(c.yOpen, c.yClose)}
            width={c.bw}
            height={Math.max(1, Math.abs(c.yClose - c.yOpen))}
            fill={c.up ? "var(--up)" : "var(--down)"}
            opacity={c.up ? 0.9 : 0.85}
            rx="0.4"
          />
        </g>
      ))}
      {showMA && ma5 && <path d={ma5} fill="none" stroke="#d4b06b" strokeWidth="1.3" opacity="0.85" />}
      {showMA && ma20 && <path d={ma20} fill="none" stroke="#4fd1c5" strokeWidth="1.3" opacity="0.7" />}
      {/* 右轴最新价 */}
      <line
        x1={pad.left}
        y1={candles[candles.length - 1].yClose}
        x2={w - pad.right}
        y2={candles[candles.length - 1].yClose}
        stroke={lineColor}
        strokeWidth="0.8"
        strokeDasharray="3 3"
        opacity="0.5"
      />
      <text
        x={w - pad.right + 5}
        y={candles[candles.length - 1].yClose}
        fontSize="10.5"
        fill={lineColor}
        dominantBaseline="middle"
        className="tnum"
      >
        {last.close.toFixed(2)}
      </text>
    </svg>
  );
}

/* ============================ 评分条 ============================ */

export function ScoreBar({
  value,
  color,
  height = 5,
  delay = 0,
}: {
  value: number;
  color: string;
  height?: number;
  delay?: number;
}) {
  return (
    <div
      className="w-full overflow-hidden rounded-full bg-white/[0.07]"
      style={{ height }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-1000 ease-out"
        style={{
          width: `${Math.max(0, Math.min(100, value))}%`,
          background: `linear-gradient(90deg, ${color}66, ${color})`,
          transitionDelay: `${delay}ms`,
          animation: "bar-grow 0.9s cubic-bezier(0.22,1,0.36,1) both",
          transformOrigin: "left",
        }}
      />
    </div>
  );
}
