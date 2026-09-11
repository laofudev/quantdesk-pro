"use client";

/** 主 Dashboard：RegimeCard + FilterPanel + ResultTable + StockDrawer */

import { useCallback, useEffect, useRef, useState } from "react";
import { beijingHM } from "@/lib/time";
import RegimeCard, { type RegimeData } from "@/components/RegimeCard";
import FilterPanel, { DEFAULT_FILTER, type FilterConfig } from "@/components/FilterPanel";
import ResultTable from "@/components/ResultTable";
import StockDrawer from "@/components/StockDrawer";
import RulesPanel from "@/components/RulesPanel";
import StatsPanel from "@/components/StatsPanel";
import type { ScoredStock } from "@/lib/types";

interface PipelineResp {
  results: ScoredStock[];
  vetoed: ScoredStock[];
  regime: RegimeData | null;
  topN: number;
  degraded: boolean;
  source: string;
  message?: string;
  elapsedMs?: number;
}

export default function Home() {
  const [regime, setRegime] = useState<RegimeData | null>(null);
  const [regimeLoading, setRegimeLoading] = useState(true);
  const [filter, setFilter] = useState<FilterConfig>(DEFAULT_FILTER);
  const [topN, setTopN] = useState<4 | 8 | 12>(8);
  const [results, setResults] = useState<ScoredStock[]>([]);
  const [vetoed, setVetoed] = useState<ScoredStock[]>([]);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [drawerCode, setDrawerCode] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [statsKey, setStatsKey] = useState(0);
  // 刷新按钮时间门槛：9:25 竞价结束前禁用（此时数据未定稿，刷了也没用）
  const [beijingHm, setBeijingHm] = useState(() => beijingHM());
  useEffect(() => {
    const t = setInterval(() => setBeijingHm(beijingHM()), 30000);
    return () => clearInterval(t);
  }, []);
  // 流水线请求序号：只采纳最新一次请求的结果，防止快速切换 topN 时旧响应覆盖新数据
  const pipelineSeq = useRef(0);

  // 拉取市场环境（页面加载与手动刷新共用）
  const loadRegime = useCallback(async () => {
    setRegimeLoading(true);
    try {
      const r = await fetch("/api/market/regime");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setRegime((await r.json()) as RegimeData);
    } catch {
      setRegime(null);
    } finally {
      setRegimeLoading(false);
    }
  }, []);

  useEffect(() => { loadRegime(); }, [loadRegime]);

  // 手动刷新：清服务端行情缓存（快照/情绪/涨跌停池）后重新拉取
  const refreshMarket = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch("/api/market/refresh", { method: "POST" });
      await loadRegime();
    } finally {
      setRefreshing(false);
    }
  }, [loadRegime]);

  const runPipeline = useCallback(async (n: number = topN, f: FilterConfig = filter) => {
    const seq = ++pipelineSeq.current;
    setRunning(true);
    setNotice(null);
    try {
      const res = await fetch("/api/pipeline/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minAmount: f.minAmount * 10000, // 万元 → 元
          minTurnover: f.minTurnover,
          minVolumeRatio: f.minVolumeRatio,
          minPrice: f.minPrice,
          maxPrice: f.maxPrice,
          phase1Limit: f.phase1Limit,
          enrichLimit: f.enrichLimit,
          topN: n,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PipelineResp = await res.json();
      if (seq !== pipelineSeq.current) return; // 已有更新的请求在途，丢弃本次结果
      setResults(data.results ?? []);
      setVetoed(data.vetoed ?? []);
      setStatsKey((k) => k + 1); // 触发胜负统计刷新
      if (data.regime) {
        // 合并而非覆盖：流水线不带 emotion，保留 regime 接口的情绪数据
        setRegime((prev) => ({ ...data.regime!, emotion: data.regime!.emotion ?? prev?.emotion ?? null }));
      }
      if (data.message) setNotice(data.message);
    } catch (err) {
      if (seq !== pipelineSeq.current) return;
      setNotice(`请求失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (seq === pipelineSeq.current) setRunning(false);
    }
  }, [topN, filter]);

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-4 py-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold text-slate-100">
          Quant<span className="text-amber-accent">Desk</span>
          <span className="ml-3 text-sm font-normal text-slate-500">A 股竞价短线选股工作台 · 本地版</span>
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-600">仅供学习研究，不构成投资建议</span>
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
              window.location.href = "/login";
            }}
            className="rounded bg-slate-700/70 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700"
          >
            退出
          </button>
        </div>
      </header>

      <div className="flex items-end justify-between gap-3">
        <div className="flex-1"><RegimeCard data={regime} loading={regimeLoading} /></div>
        <button
          onClick={refreshMarket}
          disabled={refreshing || beijingHm < "09:25"}
          title={beijingHm < "09:25" ? `9:25 竞价结束后可用（现在北京时间 ${beijingHm}）` : "清除服务端行情缓存并重新拉取"}
          className="shrink-0 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs text-slate-300 hover:border-amber-accent/60 hover:text-amber-accent disabled:opacity-40"
        >
          {refreshing ? "刷新中…" : beijingHm < "09:25" ? `⟳ ${beijingHm} 后可刷` : "⟳ 刷新行情"}
        </button>
      </div>

      {regime && (regime.label === "竞价极端偏弱" || regime.regime === "大跌") && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="mr-2 font-bold">🚫 今日不建议开仓</span>
          市场环境判定为「{regime.regime}」（{regime.label}），属于空仓观望档——系统再看好也别买，管住手就是赢。
        </div>
      )}

      {results.length > 0 &&
        results.filter((s) => s.t0Neutral).length / results.length >= 0.5 && (
          <div className="rounded border border-amber-accent/40 bg-amber-accent/10 px-3 py-2 text-xs text-amber-accent">
            ⚠️ Top{topN} 中 {results.filter((s) => s.t0Neutral).length} 只缺少竞价数据（t0Neutral）——跑的时间不对（应在 9:25–9:28 竞价结束后运行），当前结果不可信。
          </div>
        )}

      <FilterPanel config={filter} onChange={setFilter} onRun={() => runPipeline()} running={running} />

      {notice && (
        <div className="rounded border border-amber-accent/40 bg-amber-accent/10 px-3 py-2 text-xs text-amber-accent">{notice}</div>
      )}

      <ResultTable
        results={results}
        vetoed={vetoed}
        topN={topN}
        onTopNChange={(n) => { setTopN(n); if (results.length > 0 && !running) runPipeline(n); }}
        onSelect={setDrawerCode}
        loading={running}
      />

      <StockDrawer code={drawerCode} onClose={() => setDrawerCode(null)} />

      <RulesPanel />

      <StatsPanel refreshKey={statsKey} />

      <footer className="pt-2 text-center text-xs text-slate-600">
        策略逻辑复刻自 Alpha-X 公开前端逻辑，仅供学习 · 数据：扶摇 Fuyao（同花顺）/ Tushare
      </footer>
    </main>
  );
}
