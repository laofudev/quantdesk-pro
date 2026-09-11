"use client";

/** 初筛条件表单（滑杆/数字输入），对应 SPEC 2.2 默认条件 */

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

function Field({
  label, value, unit, min, max, step, onChange,
}: {
  label: string; value: number; unit: string; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono text-amber-accent">{value}{unit}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          className="h-1 flex-1 accent-[#D4B06B]"
          min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <input
          type="number"
          className="w-20 rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 font-mono text-xs text-slate-200 focus:border-amber-accent focus:outline-none"
          min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
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
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">初筛条件（Phase 1）</h2>
        <button
          onClick={onRun}
          disabled={running}
          className="rounded bg-amber-accent px-4 py-1.5 text-sm font-semibold text-slate-900 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "运行中…" : "运行选股流水线"}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="成交额下限" unit=" 万元" min={0} max={20000} step={100} value={config.minAmount} onChange={(v) => set("minAmount", v)} />
        <Field label="换手率下限" unit="%" min={0} max={20} step={0.1} value={config.minTurnover} onChange={(v) => set("minTurnover", v)} />
        <Field label="量比下限（0=关闭）" unit="" min={0} max={10} step={0.1} value={config.minVolumeRatio} onChange={(v) => set("minVolumeRatio", v)} />
        <Field label="价格下限" unit=" 元" min={0} max={100} step={1} value={config.minPrice} onChange={(v) => set("minPrice", v)} />
        <Field label="价格上限" unit=" 元" min={5} max={500} step={5} value={config.maxPrice} onChange={(v) => set("maxPrice", v)} />
        <Field label="Phase1 截断数量" unit=" 只" min={20} max={500} step={10} value={config.phase1Limit} onChange={(v) => set("phase1Limit", v)} />
        <Field label="深度评估数量（K线/资金拉取）" unit=" 只" min={0} max={80} step={5} value={config.enrichLimit} onChange={(v) => set("enrichLimit", v)} />
      </div>
    </div>
  );
}
