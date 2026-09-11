import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuantDesk · A股竞价短线选股工作台",
  description: "本地运行的 A 股竞价选股工具，仅供个人学习研究，不构成投资建议。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-slate-900">{children}</body>
    </html>
  );
}
