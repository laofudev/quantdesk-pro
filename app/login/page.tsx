"use client";

/** 登录页：口令表单，成功后回到工作台 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-800/60 p-6">
        <h1 className="mb-1 text-xl font-bold text-slate-100">
          Quant<span className="text-amber-accent">Desk</span>
        </h1>
        <p className="mb-4 text-xs text-slate-500">请输入访问口令进入工作台</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="访问口令"
          autoFocus
          className="mb-3 w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-accent"
        />
        {error && <div className="mb-3 rounded border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">{error}</div>}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full rounded bg-amber-accent px-3 py-2 text-sm font-medium text-slate-900 hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "验证中…" : "进入"}
        </button>
        <p className="mt-4 text-center text-[11px] text-slate-600">仅供本人使用 · 不构成投资建议</p>
      </form>
    </main>
  );
}
