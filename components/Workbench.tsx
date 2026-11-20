"use client";

/**
 * 主工作台（Dashboard）
 *
 * 编排：市场环境（Phase 0）→ 初筛条件（Phase 1）→ 结果表（Phase 2/3）→ 个股抽屉 → 规则与统计
 * 凭据缺失时自动弹出 API Key 引导，不让用户撞到空白页。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { beijingHM } from "@/lib/time";
import TopBar from "@/components/TopBar";
import RegimeCard, { type RegimeData } from "@/components/RegimeCard";
import FilterPanel, { DEFAULT_FILTER, type FilterConfig } from "@/components/FilterPanel";
import ResultTable from "@/components/ResultTable";
import StockDrawer from "@/components/StockDrawer";
import RulesPanel from "@/components/RulesPanel";
import StatsPanel from "@/components/StatsPanel";
import ApiKeyModal, { type CredentialInfo } from "@/components/ApiKeyModal";
import type { PipelineStats, ScoredStock } from "@/lib/types";

interface PipelineResp {
  results: ScoredStock[];
  vetoed: ScoredStock[];
  regime: RegimeData | null;
  stats: PipelineStats | null;
  topN: number;
  degraded: boolean;
  source: string;
  t0Neutral?: boolean;
  message?: string;
  elapsedMs?: number;
}

export default function Workbench({ initialCredential }: { initialCredential: CredentialInfo | null }) {
  const [credential, setCredential] = useState<CredentialInfo | null>(initialCredential);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [regime, setRegime] = useState<RegimeData | null>(null);
  const [regimeLoading, setRegimeLoading] = useState(true);
  const [filter, setFilter] = useState<FilterConfig>(DEFAULT_FILTER);
  const [topN, setTopN] = useState<4 | 8 | 12>(8);
  const [results, setResults] = useState<ScoredStock[]>([]);
  const [vetoed, setVetoed] = useState<ScoredStock[]>([]);
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawerCode, setDrawerCode] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [statsKey, setStatsKey] = useState(0);
  const [elapsedMs, setElapsedMs] = useState<number | undefined>(undefined);
  const [beijingHm, setBeijingHm] = useState(() => beijingHM());

  useEffect(() => {
    const t = setInterval(() => setBeijingHm(beijingHM()), 30000);
    return () => clearInterval(t);
  }, []);

  // 请求序号：只采纳最新一次请求的结果，防止快速切换 TopN 时旧响应覆盖新数据
  const pipelineSeq = useRef(0);

  /** 凭据缺失时引导配置 */
  const handleAuth = useCallback((res: Response) => {
    if (res.status === 401) {
      setSettingsOpen(true);
      return true;
    }
    return false;
  }, []);

  const loadRegime = useCallback(async () => {
    setRegimeLoading(true);
    try {
      const r = await fetch("/api/market/regime");
      if (handleAuth(r)) return;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setRegime((await r.json()) as RegimeData);
    } catch {
      setRegime(null);
    } finally {
      setRegimeLoading(false);
    }
  }, [handleAuth]);

  useEffect(() => {
    void loadRegime();
  }, [loadRegime]);

  const refreshMarket = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch("/api/market/refresh", { method: "POST" });
      await loadRegime();
    } finally {
      setRefreshing(false);
    }
  }, [loadRegime]);

  const runPipeline = useCallback(
    async (n: number = topN, f: FilterConfig = filter) => {
      const seq = ++pipelineSeq.current;
      setRunning(true);
      setNotice(null);
      setError(null);
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
        if (handleAuth(res)) return;
        const data: PipelineResp = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
        if (seq !== pipelineSeq.current) return;
        setResults(data.results ?? []);
        setVetoed(data.vetoed ?? []);
        setStats(data.stats ?? null);
        setElapsedMs(data.elapsedMs);
        setStatsKey((k) => k + 1);
        if (data.regime) {
          // 合并而非覆盖：流水线不带情绪序列，保留 regime 接口的情绪数据
          setRegime((prev) => ({
            ...data.regime!,
            emotion: data.regime!.emotion ?? prev?.emotion ?? null,
            emotionSeries: prev?.emotionSeries ?? data.regime!.emotionSeries,
          }));
        }
        if (data.message) setNotice(data.message);
      } catch (err) {
        if (seq !== pipelineSeq.current) return;
        setError(`请求失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (seq === pipelineSeq.current) setRunning(false);
      }
    },
    [topN, filter, handleAuth]
  );

  const reloadCredential = useCallback(async () => {
    try {
      const r = await fetch("/api/credentials");
      const d = await r.json().catch(() => ({}));
      setCredential(d.credential ?? null);
      if (d.credential?.configured) {
        await loadRegime();
      }
    } catch {
      /* 静默 */
    }
  }, [loadRegime]);

  const neutralRatio =
    results.length > 0 ? results.filter((s) => s.t0Neutral).length / results.length : 0;
  const risky = regime?.regime === "大跌" || regime?.label === "竞价极端偏弱";
  const beforeAuction = beijingHm < "09:25";

  return (
    <div className="min-h-screen">
      <TopBar
        credential={credential}
        degraded={regime?.degraded ?? false}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="mx-auto max-w-[1560px] space-y-4 px-5 py-5">
        {/* 页头 */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-gradient text-[22px] font-semibold tracking-tight">
              A 股集合竞价 · 多因子选股工作台
            </h1>
            <p className="mt-1 text-[11.5px] text-[var(--ink-mute)]">
              五路因子独立打分 · 竞价信号确认 · 硬规则熔断 · 行业分散输出
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {stats && (
              <div className="hidden items-center gap-3 rounded-[9px] border border-[var(--hairline)] bg-black/20 px-3 py-1.5 text-[10.5px] text-[var(--ink-mute)] lg:flex">
                <span>
                  候选池 <span className="tnum font-mono text-[var(--ink-soft)]">{stats.poolSize}</span>
                </span>
                <span>
                  存活 <span className="tnum font-mono text-[var(--ink-soft)]">{stats.aliveCount}</span>
                </span>
                <span>
                  熔断 <span className="tnum font-mono text-[#ff8a99]">{stats.vetoCount}</span>
                </span>
                <span>
                  行业映射{" "}
                  <span className="tnum font-mono text-[var(--ink-soft)]">{stats.industryMapped}</span>
                </span>
              </div>
            )}

            <button
              onClick={refreshMarket}
              disabled={refreshing || beforeAuction}
              title={
                beforeAuction
                  ? `9:25 竞价结束后可用（当前北京时间 ${beijingHm}）`
                  : "清除服务端行情缓存并重新拉取"
              }
              className="btn h-8 px-3 py-0 text-[11.5px]"
            >
              {refreshing ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                  刷新中
                </>
              ) : beforeAuction ? (
                <>⟳ {beijingHm} 后可刷</>
              ) : (
                <>⟳ 刷新行情</>
              )}
            </button>
          </div>
        </header>

        {/* 环境判定 */}
        <RegimeCard data={regime} loading={regimeLoading} />

        {/* 风险提示 */}
        {risky && (
          <div className="animate-fade-up flex items-start gap-3 rounded-[12px] border border-[rgba(246,70,93,0.32)] bg-[rgba(246,70,93,0.07)] px-4 py-3">
            <span className="mt-px text-[13px]" style={{ color: "var(--up)" }}>
              ⚠
            </span>
            <div className="text-[12.5px] leading-relaxed text-[var(--ink-soft)]">
              <span className="font-semibold" style={{ color: "var(--up)" }}>
                今日不建议开仓。
              </span>{" "}
              市场环境判定为「{regime?.regime}」（{regime?.label}），属于空仓观望档 —— 系统再看好也别买，管住手就是赢。
            </div>
          </div>
        )}

        {neutralRatio >= 0.5 && results.length > 0 && (
          <div className="rounded-[10px] border border-[rgba(240,163,94,0.3)] bg-[rgba(240,163,94,0.07)] px-3.5 py-2.5 text-[11.5px] text-[#f0a35e]">
            ⚠️ Top{topN} 中 {results.filter((s) => s.t0Neutral).length} 只缺少竞价数据（T0 落中性 1.0）—— 运行时间不对（应在
            9:25–9:30 竞价结束后运行），当前结果不可信。
          </div>
        )}

        {/* 初筛 */}
        <FilterPanel config={filter} onChange={setFilter} onRun={() => void runPipeline()} running={running} />

        {notice && (
          <div className="rounded-[10px] border border-[rgba(240,163,94,0.3)] bg-[rgba(240,163,94,0.07)] px-3.5 py-2.5 text-[11.5px] text-[#f0a35e]">
            {notice}
          </div>
        )}
        {error && (
          <div className="rounded-[10px] border border-[rgba(246,70,93,0.32)] bg-[rgba(246,70,93,0.08)] px-3.5 py-2.5 text-[11.5px] text-[#ff8a99]">
            {error}
          </div>
        )}

        {/* 结果 */}
        <ResultTable
          results={results}
          vetoed={vetoed}
          topN={topN}
          onTopNChange={(n) => {
            setTopN(n);
            if (results.length > 0 && !running) void runPipeline(n);
          }}
          onSelect={setDrawerCode}
          loading={running}
          elapsedMs={elapsedMs}
        />

        {/* 规则与统计 */}
        <RulesPanel />
        <StatsPanel refreshKey={statsKey} />

        <footer className="flex flex-col items-center gap-1.5 pt-3 pb-6 text-center">
          <p className="text-[11px] text-[var(--ink-mute)]">
            QuantDesk Alpha · 数据源：扶摇 Fuyao（同花顺）· 策略逻辑复刻自公开的 Alpha-X 前端思路
          </p>
          <p className="max-w-3xl text-[10.5px] leading-relaxed text-[var(--ink-faint)]">
            本工具仅供技术学习与研究使用，所有输出均为客观数据统计与规则化计算结果，
            <span className="mx-1 text-[rgba(246,70,93,0.8)]">不构成任何投资建议、荐股或交易指令</span>
            ；市场有风险，决策与后果由使用者自行承担。
          </p>
        </footer>
      </main>

      <StockDrawer code={drawerCode} onClose={() => setDrawerCode(null)} />

      <ApiKeyModal
        open={settingsOpen}
        credential={credential}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => void reloadCredential()}
      />
    </div>
  );
}
