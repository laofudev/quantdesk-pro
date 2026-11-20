"use client";

/**
 * 初筛条件面板（Phase 1）
 *
 * 滑杆 + 数字输入联动，实时回显当前阈值。
 * 顶部带「漏斗预览」提示，让用户知道每一步会砍掉多少股票。
 */

export interface FilterConfig {
  minAmount: number;      // 万元
  minTurnover: number;    // %
  minVolumeRatio: number;
  minPrice: number;
  maxPrice: number;
  phase1Limit: number;
  enrichLimit: number;
}

export const DEFAULT_FILTER: FilterConfig = {
  minAmount: 500,
  minTurnover: 0.5,
  minVolumeRatio: 1.0,
  minPrice: 2,
  maxPrice: 100,
  phase1Limit: 200,
  enrichLimit: 30,
};

function Slider({
  label, hint, value, unit, min, max, step, onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="group">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] text-[var(--ink-soft)]">
          {label}
          {hint && <span className="ml-1.5 text-[10px] text-[var(--ink-faint)]">{hint}</span>}
        </span>
        <span className="flex items-baseline gap-0.5">
          <input
            type="number"
            className="tnum w-16 rounded-[6px] border border-[var(--hairline)] bg-black/25 px-1.5 py-0.5 text-right font-mono text-[11.5px] text-[var(--ink)] outline-none transition-colors focus:border-[rgba(212,176,107,0.5)]"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
            }}
          />
          <span className="text-[10px] text-[var(--ink-faint)]">{unit}</span>
        </span>
      </div>
      <div className="relative">
        <div className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/[0.07]" />
        <div
          className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full transition-[width] duration-200"
          style={{
            width: `${Math.max(0, Math.min(100, pct))}%`,
            background: "linear-gradient(90deg, rgba(212,176,107,0.5), #e8c887)",
          }}
        />
        <input
          type="range"
          className="relative z-10 h-4 w-full cursor-pointer appearance-none bg-transparent
            [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-[#e8c887]
            [&::-webkit-slider-thumb]:bg-[#0b0e14] [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_rgba(212,176,107,0.16)]
            [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-110
            [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-[#e8c887] [&::-moz-range-thumb]:bg-[#0b0e14]"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      </div>
    </div>
  );
}

export default function FilterPanel({
  config, onChange, onRun, running,
}: {
  config: FilterConfig;
  onChange: (c: FilterConfig) => void;
  onRun: () => void;
  running: boolean;
}) {
  const set = <K extends keyof FilterConfig>(k: K, v: number) => onChange({ ...config, [k]: v });
  const reset = () => onChange(DEFAULT_FILTER);

  const dirty = JSON.stringify(config) !== JSON.stringify(DEFAULT_FILTER);

  return (
    <div className="panel panel-sheen">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--hairline)] px-5 py-3">
        <div>
          <div className="text-[13.5px] font-semibold tracking-tight">初筛条件</div>
          <div className="mt-0.5 text-[10.5px] text-[var(--ink-faint)]">
            Phase 1 硬过滤 · 硬条件不满足的股票直接出局
          </div>
        </div>

        <div className="flex-1" />

        {dirty && (
          <button onClick={reset} className="btn h-8 px-3 py-0 text-[11.5px]">
            恢复默认
          </button>
        )}

        <button onClick={onRun} disabled={running} className="btn btn-primary h-8 px-4 py-0 text-[12.5px]">
          {running ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
              扫描中…
            </>
          ) : (
            <>
              <span>▶</span>
              运行选股流水线
            </>
          )}
        </button>
      </div>

      <div className="grid gap-x-8 gap-y-5 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Slider
          label="成交额下限"
          hint="流动性门槛"
          value={config.minAmount}
          unit="万元"
          min={0}
          max={20000}
          step={100}
          onChange={(v) => set("minAmount", v)}
        />
        <Slider
          label="换手率下限"
          hint="剔除死盘"
          value={config.minTurnover}
          unit="%"
          min={0}
          max={20}
          step={0.1}
          onChange={(v) => set("minTurnover", v)}
        />
        <Slider
          label="量比下限"
          hint="0 = 关闭"
          value={config.minVolumeRatio}
          unit=""
          min={0}
          max={10}
          step={0.1}
          onChange={(v) => set("minVolumeRatio", v)}
        />
        <Slider
          label="价格区间"
          hint={`${config.minPrice} ~ ${config.maxPrice} 元`}
          value={config.maxPrice}
          unit="元"
          min={5}
          max={500}
          step={5}
          onChange={(v) => set("maxPrice", v)}
        />
        <Slider
          label="价格下限"
          value={config.minPrice}
          unit="元"
          min={0}
          max={100}
          step={1}
          onChange={(v) => set("minPrice", v)}
        />
        <Slider
          label="Phase1 截断"
          hint="进入深度评估上限"
          value={config.phase1Limit}
          unit="只"
          min={20}
          max={500}
          step={10}
          onChange={(v) => set("phase1Limit", v)}
        />
        <Slider
          label="深度增强"
          hint="补 K 线 / 财务数量"
          value={config.enrichLimit}
          unit="只"
          min={0}
          max={120}
          step={5}
          onChange={(v) => set("enrichLimit", v)}
        />

        <div className="flex items-end">
          <div className="w-full rounded-[9px] border border-[var(--hairline)] bg-black/20 px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">当前漏斗</div>
            <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-[var(--ink-soft)]">
              <span className="text-[var(--ink-faint)]">全市场</span>
              <span className="text-[var(--ink-faint)]">→</span>
              <span className="text-[#e8c887]">≤{config.phase1Limit}</span>
              <span className="text-[var(--ink-faint)]">→</span>
              <span className="text-[#4fd1c5]">{config.enrichLimit}</span>
              <span className="text-[var(--ink-faint)]">→</span>
              <span className="text-[#f0a35e]">Top</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
