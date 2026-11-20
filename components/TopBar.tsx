"use client";

/** 顶栏：品牌 / 交易时钟 / 数据源状态 / API Key 入口 */

import { useEffect, useState } from "react";
import { beijingHM } from "@/lib/time";
import { marketPhase } from "@/lib/format";
import type { CredentialInfo } from "@/components/ApiKeyModal";

interface Props {
  credential: CredentialInfo | null;
  degraded: boolean;
  onOpenSettings: () => void;
}

export default function TopBar({ credential, degraded, onOpenSettings }: Props) {
  const [hm, setHm] = useState(() => beijingHM());
  useEffect(() => {
    const t = setInterval(() => setHm(beijingHM()), 20000);
    return () => clearInterval(t);
  }, []);

  const phase = marketPhase(hm);
  const statusColor =
    phase.status === "open"
      ? "var(--down)"
      : phase.status === "auction"
        ? "var(--gold-bright)"
        : "var(--ink-mute)";

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--hairline)] bg-[rgba(6,8,12,0.82)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1560px] items-center gap-4 px-5">
        {/* 品牌 */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-[rgba(212,176,107,0.3)] bg-[rgba(212,176,107,0.09)] text-[13px] font-semibold text-[#e8c887]">
            Q
          </div>
          <div className="leading-none">
            <div className="text-[13.5px] font-semibold tracking-tight">
              QuantDesk <span className="text-[#e8c887]">Alpha</span>
            </div>
            <div className="mt-0.5 hidden text-[9.5px] uppercase tracking-[0.2em] text-[var(--ink-faint)] sm:block">
              Auction Factor Desk
            </div>
          </div>
        </div>

        <div className="ml-1 hidden h-5 w-px bg-[var(--hairline)] sm:block" />

        {/* 交易状态 */}
        <div className="hidden items-center gap-2 sm:flex">
          <span
            className="animate-pulse-dot h-1.5 w-1.5 rounded-full"
            style={{ background: statusColor }}
          />
          <span className="tnum font-mono text-[12.5px] text-[var(--ink-soft)]">{hm}</span>
          <span className="text-[11.5px] text-[var(--ink-mute)]">{phase.label}</span>
        </div>

        <div className="flex-1" />

        {/* 数据源状态 */}
        {degraded && (
          <span className="chip chip-up" title="部分数据源降级中，结果可能失真">
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            数据降级
          </span>
        )}

        <span className="chip chip-cyan" title="唯一数据源：扶摇（同花顺）">
          扶摇数据源
        </span>

        {/* 免责声明入口 */}
        <span
          className="hidden text-[11px] text-[var(--ink-faint)] lg:inline"
          title="本工具不构成投资建议"
        >
          不构成投资建议
        </span>

        {/* API Key */}
        <button onClick={onOpenSettings} className="btn h-8 px-3 py-0 text-[12px]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#4ade9b]" />
          <span className="font-mono">{credential?.masked ?? "API Key"}</span>
        </button>
      </div>
    </header>
  );
}
