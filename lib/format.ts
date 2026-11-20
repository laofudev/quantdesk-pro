/** 通用格式化工具（客户端/服务端共用，无副作用） */

/** 带符号百分比 */
export function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

/** 金额：自动切换 亿 / 万 */
export function fmtAmount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(n / 1e4).toFixed(0)}万`;
  return n.toFixed(0);
}

/** 涨跌色（红涨绿跌） */
export function pctColor(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return "var(--flat)";
  return n > 0 ? "var(--up)" : "var(--down)";
}

/** 评分 → 颜色 */
export function scoreColor(n: number): string {
  if (n >= 80) return "#e8c887";
  if (n >= 65) return "#4fd1c5";
  if (n >= 50) return "#8b9bb4";
  if (n >= 35) return "#6b7488";
  return "#5a6274";
}

/** 五路 Agent 元信息 */
export const AGENT_META = {
  ethan: { label: "技术面", color: "#d4b06b", desc: "六维技术评分 + 加减分" },
  lucas: { label: "板块共振", color: "#4fd1c5", desc: "行业共振 + 催化剂" },
  edwin: { label: "风格基本面", color: "#8b7ff0", desc: "风格匹配 + 财务质量" },
  sophia: { label: "风控熔断", color: "#f6465d", desc: "硬规则否决 + 扣分" },
  mia: { label: "相对强度", color: "#f0a35e", desc: "超额收益映射" },
} as const;

export type AgentKey = keyof typeof AGENT_META;

/** 交易时段判断（北京时间） */
export function marketPhase(hm: string): { label: string; status: "pre" | "auction" | "open" | "post" | "closed" } {
  if (hm < "09:15") return { label: "盘前", status: "pre" };
  if (hm < "09:25") return { label: "集合竞价", status: "auction" };
  if (hm < "09:30") return { label: "竞价撮合", status: "auction" };
  if (hm <= "11:30") return { label: "早盘", status: "open" };
  if (hm < "13:00") return { label: "午间休市", status: "closed" };
  if (hm <= "15:00") return { label: "午盘", status: "open" };
  return { label: "已收盘", status: "post" };
}
