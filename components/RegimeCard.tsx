"use client";

/** 市场环境卡：TM、regime、涨跌停统计、情绪周期摘要 */

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
  emotion: { ztjs?: number; dtjs?: number; szbl?: number; dbcgl?: number; lbjs?: number } | null;
  source: string;
  degraded: boolean;
  weightsPreset?: "remote" | "local";
  message?: string;
}

const REGIME_COLOR: Record<string, string> = {
  大涨: "text-red-400", 上涨: "text-red-300", 震荡偏强: "text-red-200",
  震荡均衡: "text-slate-300", 均衡: "text-slate-300",
  震荡偏弱: "text-emerald-200", 下跌: "text-emerald-300", 大跌: "text-emerald-400",
  超卖反弹: "text-amber-accent",
};

const AGENT_LABEL: Record<string, string> = { ethan: "技术", lucas: "板块", edwin: "风格", sophia: "风控", mia: "市场" };

export default function RegimeCard({ data, loading }: { data: RegimeData | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
        <div className="text-sm text-slate-400">正在判定市场环境…</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
        <div className="text-sm text-slate-400">市场环境数据不可用</div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <div className="text-xs text-slate-500">市场环境（Regime）</div>
          <div className={`text-2xl font-bold ${REGIME_COLOR[data.regime] ?? "text-slate-200"}`}>
            {data.regime}
            <span className="ml-2 text-sm font-normal text-slate-400">{data.label}</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">开盘涨幅截尾均值 TM</div>
          <div className={`text-xl font-mono ${data.tm >= 0 ? "text-red-400" : "text-emerald-400"}`}>
            {data.tm >= 0 ? "+" : ""}{data.tm.toFixed(3)}%
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">涨 / 跌 / 涨停 / 跌停</div>
          <div className="font-mono text-sm">
            <span className="text-red-400">{data.stats.upCount}</span>
            <span className="text-slate-500"> / </span>
            <span className="text-emerald-400">{data.stats.downCount}</span>
            <span className="text-slate-500"> / </span>
            <span className="text-red-300">{data.stats.limitUpCount}</span>
            <span className="text-slate-500"> / </span>
            <span className="text-emerald-300">{data.stats.limitDownCount}</span>
          </div>
        </div>
        {data.emotion && (
          <div>
            <div className="text-xs text-slate-500">情绪：涨停/跌停/上涨比例/打板成功率</div>
            <div className="font-mono text-sm text-slate-300">
              {data.emotion.ztjs ?? "-"} / {data.emotion.dtjs ?? "-"} /{" "}
              {data.emotion.szbl !== undefined ? `${(data.emotion.szbl * 100).toFixed(0)}%` : "-"} /{" "}
              {data.emotion.dbcgl !== undefined ? `${(data.emotion.dbcgl * 100).toFixed(0)}%` : "-"}
            </div>
          </div>
        )}
        <div className="ml-auto text-right">
          <div className="text-xs text-slate-500">数据源</div>
          <div className={`text-sm ${data.degraded ? "text-amber-accent" : "text-slate-300"}`}>
            {data.source === "fuyao" ? "扶摇/同花顺（实时）" : data.source === "tushare" ? "Tushare（降级）" : "中性值"}
          </div>
          <div className="text-xs text-slate-600">
            权重：{data.weightsPreset === "remote" ? "在线预设" : "本地快照"}
          </div>
        </div>
      </div>

      {/* agent 权重条 */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-slate-500">Agent 权重</span>
        <div className="flex h-3 flex-1 overflow-hidden rounded">
          {(Object.keys(data.weights) as (keyof typeof data.weights)[]).map((k) => (
            <div
              key={k}
              className="bg-amber-accent/70 odd:bg-amber-accent/40"
              style={{ width: `${data.weights[k] * 100}%` }}
              title={`${AGENT_LABEL[k]} ${(data.weights[k] * 100).toFixed(0)}%`}
            />
          ))}
        </div>
        <div className="flex gap-2 text-xs text-slate-400">
          {(Object.keys(data.weights) as (keyof typeof data.weights)[]).map((k) => (
            <span key={k}>{AGENT_LABEL[k]} {(data.weights[k] * 100).toFixed(0)}%</span>
          ))}
        </div>
      </div>

      {data.confirms.length > 0 && (
        <div className="mt-2 text-xs text-amber-accent">跌势确认项：{data.confirms.join("、")}</div>
      )}
      {data.message && <div className="mt-2 text-xs text-slate-500">{data.message}</div>}
    </div>
  );
}
