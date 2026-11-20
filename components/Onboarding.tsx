"use client";

/**
 * 首次接入页：引导用户填入自己的扶摇 API Key
 *
 * 设计要点：把「填 Key」包装成一个有仪式感的技术接入流程，
 * 而不是干巴巴的表单 —— 这是参赛作品的第一印象。
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

const FEATURES = [
  {
    icon: "◈",
    title: "五路因子引擎",
    desc: "技术面 / 板块共振 / 风格基本面 / 风控熔断 / 相对强度，各自独立打分后按行情环境动态加权。",
  },
  {
    icon: "◷",
    title: "竞价确认机制",
    desc: "9:25 集合竞价结束后抓取抢筹金额与竞价量比，量价信号双确认，缺数据自动落中性并明确标注。",
  },
  {
    icon: "⛨",
    title: "硬规则风控熔断",
    desc: "流动性枯竭、ST、极度乖离、贴顶压力、一致性陷阱、反向波动——六条硬规则一票否决。",
  },
  {
    icon: "◫",
    title: "行业分散输出",
    desc: "同行业限额 + Top3 强制三个不同行业，避免选股结果过度集中在单一赛道。",
  },
];

const STEPS = [
  { n: "01", t: "获取 API Key", d: "前往 fuyao.aicubes.cn 注册并创建个人 Key" },
  { n: "02", t: "粘贴并验证", d: "服务端即时鉴权，仅你可见" },
  { n: "03", t: "开始扫描", d: "09:25 后运行效果最佳" },
];

export default function Onboarding() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  async function submit() {
    if (!key.trim()) {
      setError("请先填入你的扶摇 API Key");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fuyaoKey: key.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? "验证失败，请检查 Key 是否正确");
        return;
      }
      router.refresh();
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* 背景装饰 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(212,176,107,0.13),transparent_68%)]" />
        <div className="absolute -right-32 top-24 h-[480px] w-[480px] rounded-full bg-[radial-gradient(circle,rgba(79,209,197,0.1),transparent_68%)]" />
      </div>

      <div className="relative mx-auto grid max-w-6xl grid-cols-1 gap-12 px-6 py-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:py-20">
        {/* 左：品牌与卖点 */}
        <div className="animate-fade-up flex flex-col justify-center">
          <div className="mb-7 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[rgba(212,176,107,0.32)] bg-[rgba(212,176,107,0.1)] text-[15px] font-semibold text-[#e8c887]">
              Q
            </div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight">
                QuantDesk <span className="text-[#e8c887]">Alpha</span>
              </div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
                A-Share Auction Factor Desk
              </div>
            </div>
          </div>

          <h1 className="text-gradient mb-5 text-[42px] font-semibold leading-[1.1] tracking-tight sm:text-[52px]">
            A 股集合竞价
            <br />
            多因子选股工作台
          </h1>

          <p className="mb-8 max-w-lg text-[15px] leading-relaxed text-[var(--ink-soft)]">
            复刻公开的 Alpha-X 策略流水线精髓，用你
            <span className="mx-1 text-[#e8c887]">自己的扶摇 API Key</span>
            驱动全市场扫描。五路因子独立打分、竞价信号确认、硬规则熔断、行业分散输出，
            全流程可解释、可回溯。
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="panel panel-sheen animate-fade-up p-4"
                style={{ animationDelay: `${120 + i * 70}ms` }}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[15px] text-[#e8c887]">{f.icon}</span>
                  <span className="text-[13px] font-semibold text-[var(--ink)]">{f.title}</span>
                </div>
                <p className="text-[12px] leading-relaxed text-[var(--ink-mute)]">{f.desc}</p>
              </div>
            ))}
          </div>

          <p className="mt-7 text-[11px] leading-relaxed text-[var(--ink-faint)]">
            本工具仅供技术学习与研究，不构成任何投资建议、荐股或交易指令。
          </p>
        </div>

        {/* 右：接入流程 */}
        <div className="animate-fade-up flex flex-col justify-center" style={{ animationDelay: "160ms" }}>
          <div className="panel panel-sheen panel-strong p-7 shadow-[0_28px_70px_-28px_rgba(0,0,0,0.9)]">
            <div className="mb-6">
              <h2 className="mb-1.5 text-[17px] font-semibold tracking-tight">接入你的数据源</h2>
              <p className="text-[12.5px] leading-relaxed text-[var(--ink-mute)]">
                Key 仅保存在服务端并以 AES-GCM 加密落盘，浏览器只持有一个会话标识，
                不会进入前端 bundle，也不会随请求明文外传。
              </p>
            </div>

            {/* 步骤条 */}
            <ol className="mb-6 space-y-2.5">
              {STEPS.map((s) => (
                <li key={s.n} className="flex items-start gap-3">
                  <span className="tnum mt-px w-6 shrink-0 font-mono text-[11px] text-[rgba(212,176,107,0.75)]">
                    {s.n}
                  </span>
                  <span className="text-[12.5px] leading-relaxed">
                    <span className="font-medium text-[var(--ink)]">{s.t}</span>
                    <span className="text-[var(--ink-mute)]"> · {s.d}</span>
                  </span>
                </li>
              ))}
            </ol>

            <div className="divider mb-5" />

            <label className="label mb-2" htmlFor="fuyao-key">
              扶摇 API Key
            </label>
            <div className="relative">
              <input
                id="fuyao-key"
                type={showKey ? "text" : "password"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) void submit();
                }}
                placeholder="粘贴你的 fuyao.aicubes.cn API Key"
                className="field pr-16 font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] text-[var(--ink-mute)] transition-colors hover:text-[var(--ink)]"
              >
                {showKey ? "隐藏" : "显示"}
              </button>
            </div>

            {error && (
              <div className="mt-3 rounded-[9px] border border-[rgba(246,70,93,0.32)] bg-[rgba(246,70,93,0.1)] px-3.5 py-2.5 text-[12px] text-[#ff8a99]">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="btn btn-primary mt-5 w-full py-2.5"
            >
              {busy ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                  正在验证并加密保存…
                </>
              ) : (
                "验证并进入工作台"
              )}
            </button>

            <div className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-[var(--ink-faint)]">
              <span className="mt-px text-[#4fd1c5]">◆</span>
              <span>
                没有 Key？前往
                <a
                  href="https://fuyao.aicubes.cn"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mx-1 text-[#e8c887] underline decoration-[rgba(212,176,107,0.35)] underline-offset-2 hover:decoration-[#e8c887]"
                >
                  fuyao.aicubes.cn
                </a>
                注册获取，工具完全免费使用你自己的额度。
              </span>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-center gap-5 text-[11px] text-[var(--ink-faint)]">
            <span>纯扶摇数据源</span>
            <span className="h-3 w-px bg-[var(--hairline)]" />
            <span>零第三方依赖</span>
            <span className="h-3 w-px bg-[var(--hairline)]" />
            <span>本地缓存加速</span>
          </div>
        </div>
      </div>
    </main>
  );
}
