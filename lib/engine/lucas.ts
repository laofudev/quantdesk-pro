/**
 * Lucas 板块共振评分（0-100，基准 50 起）
 * 纯函数，无网络依赖。
 * 板块归属使用「一级行业」（由 390 个概念板块归并而来）。
 */
import type { AgentScore, Announcement, StockContext } from "@/lib/types";

function clamp100(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/** 公告催化剂关键词扫描（SPEC 2.3）：回购/增持/预增=强 +5；中标/订单=中 +3；其他中性 +1；利空关键词交给 Sophia 扣分 */
export function catalystScore(announcements?: Announcement[]): { score: number; hit: string } {
  if (!announcements || announcements.length === 0) return { score: 1, hit: "无公告（中性 +1）" };
  const text = announcements.map((a) => a.title).join(" ");
  if (/回购|增持|预增/.test(text)) return { score: 5, hit: "强催化（回购/增持/预增）+5" };
  if (/中标|订单/.test(text)) return { score: 3, hit: "中催化（中标/订单）+3" };
  return { score: 1, hit: "中性 +1" };
}

/** 利空公告检测（立案/减持/预亏）→ 转 Sophia 扣分，本模块只负责识别 */
export function hasNegativeCatalyst(announcements?: Announcement[]): string | null {
  if (!announcements || announcements.length === 0) return null;
  const text = announcements.map((a) => a.title).join(" ");
  const m = text.match(/立案|减持|预亏/);
  return m ? m[0] : null;
}

export function scoreLucas(ctx: StockContext): AgentScore {
  const q = ctx.quote;
  const sc = ctx.sectorCtx;
  const hits: string[] = [];
  // 基准 50 起（SPEC 2.3，复刻自 Alpha-X 公开前端逻辑，仅供学习）
  let score = 50;

  // 共振基础分：同板块同时入选 ≥5 只 +12；3-4 只 +10；2 只 +8
  const peers = sc?.peersSelected ?? 0;
  if (peers >= 5) { score += 12; hits.push(`同板块入选${peers}只 +12`); }
  else if (peers >= 3) { score += 10; hits.push(`同板块入选${peers}只 +10`); }
  else if (peers >= 2) { score += 8; hits.push(`同板块入选${peers}只 +8`); }

  // 板块强度：>5% +6；3-5% +4；1-3% +2；<1% +1
  const sp = sc?.sectorPct ?? 0;
  if (sp > 5) { score += 6; hits.push(`板块强度${sp.toFixed(1)}% +6`); }
  else if (sp >= 3) { score += 4; hits.push(`板块强度${sp.toFixed(1)}% +4`); }
  else if (sp >= 1) { score += 2; hits.push(`板块强度${sp.toFixed(1)}% +2`); }
  else { score += 1; hits.push("板块强度<1% +1"); }

  // 板块内排名奖励：第 1/2/3 名 +3/+2/+1
  const rank = sc?.rankInSector ?? 0;
  if (rank === 1) { score += 3; hits.push("板块内第1名 +3"); }
  else if (rank === 2) { score += 2; hits.push("板块内第2名 +2"); }
  else if (rank === 3) { score += 1; hits.push("板块内第3名 +1"); }

  // 命中当日竞价强势板块 ×1.3
  if (sc?.hotSector) { score *= 1.3; hits.push("命中竞价强势板块 ×1.3"); }

  // 命中弱势板块且乖离>8% 或高开>4% → -30
  const openPct = q.preClose > 0 ? (q.open / q.preClose - 1) * 100 : 0;
  // 乖离率：现价 / MA5 - 1（MA5 用参考均线，不含今日）
  let bias = 0;
  if (ctx.kline && ctx.kline.length >= 5) {
    const tail = [...ctx.kline].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-5);
    const ma5 = tail.reduce((s, b) => s + b.close, 0) / 5;
    if (ma5 > 0) bias = (q.price / ma5 - 1) * 100;
  }
  if (sc?.weakSector && (bias > 8 || openPct > 4)) {
    score -= 30; hits.push("弱势板块且乖离>8%/高开>4% -30");
  }

  // 催化剂
  const cat = catalystScore(ctx.announcements);
  score += cat.score;
  hits.push(cat.hit);

  return { score: Math.round(clamp100(score) * 100) / 100, details: { base: 50, hits } };
}
