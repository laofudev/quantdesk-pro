"use client";

/** API Key 设置弹窗：随时更换/清除已保存的扶摇 Key */

import { useEffect, useState } from "react";

export interface CredentialInfo {
  configured: boolean;
  masked: string | null;
  createdAt: number | null;
  lastUsedAt: number | null;
}

interface Props {
  open: boolean;
  credential: CredentialInfo | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function ApiKeyModal({ open, credential, onClose, onSaved }: Props) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (open) {
      setKey("");
      setError(null);
      setOk(null);
      setShowKey(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function save() {
    if (!key.trim()) {
      setError("请填写 API Key");
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
        setError(data.error ?? "保存失败");
        return;
      }
      setOk("已保存，正在加载最新行情…");
      setTimeout(() => {
        onSaved();
        onClose();
      }, 600);
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await fetch("/api/credentials", { method: "DELETE" });
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div className="panel panel-sheen panel-strong relative w-full max-w-md p-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.95)] animate-fade-up">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[16px] font-semibold tracking-tight">扶摇 API Key</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--ink-mute)]">
              {credential?.configured
                ? `当前已配置：${credential.masked}`
                : "尚未配置 API Key，无法拉取行情数据。"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 rounded p-1.5 text-[var(--ink-mute)] transition-colors hover:bg-white/5 hover:text-[var(--ink)]"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <label className="label mb-2" htmlFor="modal-key">
          {credential?.configured ? "替换为新的 Key" : "输入 API Key"}
        </label>
        <div className="relative">
          <input
            id="modal-key"
            type={showKey ? "text" : "password"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void save();
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
        {ok && (
          <div className="mt-3 rounded-[9px] border border-[rgba(14,203,129,0.32)] bg-[rgba(14,203,129,0.1)] px-3.5 py-2.5 text-[12px] text-[#4ade9b]">
            {ok}
          </div>
        )}

        <div className="mt-5 flex items-center gap-2.5">
          <button onClick={save} disabled={busy} className="btn btn-primary flex-1">
            {busy ? "处理中…" : "保存并验证"}
          </button>
          {credential?.configured && (
            <button onClick={clear} disabled={busy} className="btn text-[#ff8a99]">
              清除
            </button>
          )}
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-[var(--ink-faint)]">
          Key 以 AES-GCM 加密后保存在服务端磁盘，前端仅持有 HttpOnly 会话 Cookie。
          更换 Key 会清空该会话的行情缓存并重新拉取。
        </p>
      </div>
    </div>
  );
}
