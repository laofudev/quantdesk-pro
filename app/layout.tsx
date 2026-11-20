import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "QuantDesk Alpha · A 股竞价多因子选股工作台",
  description:
    "自填扶摇 API Key 的 A 股集合竞价多因子选股工作台。五路因子引擎 + 竞价确认 + 风控熔断 + 行业分散。纯学习研究工具，不构成投资建议。",
  keywords: ["A股", "选股", "集合竞价", "量化", "多因子", "扶摇API", "WorkBuddy"],
  authors: [{ name: "QuantDesk Alpha" }],
  openGraph: {
    title: "QuantDesk Alpha · A 股竞价多因子选股工作台",
    description: "五路因子引擎 + 竞价确认 + 风控熔断 + 行业分散。纯扶摇数据源，不构成投资建议。",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#06080c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${inter.variable} ${mono.variable}`}>
      <body
        style={{
          fontFamily: "var(--font-inter), 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}
