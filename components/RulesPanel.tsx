"use client";

/**
 * 系统运作规则
 *
 * 一天的时间线 · 四层漏斗 · 买卖纪律 · 三个局限
 * 折叠式面板，默认收起，保持工作台主视图的干净。
 */

const TIMELINE = [
  { time: "09:15–09:25", title: "集合竞价", desc: "采集竞价抢筹金额与竞价量比，量价信号成形" },
  { time: "09:25–09:30", title: "环境判定", desc: "全市场竞价涨幅去首尾各 2% 取均值（TM），落 9 档环境" },
  { time: "09:30 之后", title: "运行筛选", desc: "点「运行选股流水线」，四层漏斗出结果" },
  { time: "次日收盘", title: "自动结算", desc: "按「T 日开盘买入 → T+1 收盘卖出」口径结算胜负" },
];

const FUNNEL = [
  {
    layer: "第 0 层 · 市场环境判定",
    desc: "全市场 5500+ 只竞价涨幅去首尾各 2% 取均值（TM），配合跌停数、个股与板块涨跌比，判定 9 档环境（大涨 → 大跌 → 超卖反弹）。环境越差，风控 Sophia 权重越高（极端时升至 0.40），基本面权重同步压低。",
  },
  {
    layer: "第 1 层 · 初筛（全市场 → 约 200 只）",
    desc: "硬条件过滤：成交额 ≥ 500 万、换手率 ≥ 0.5%、量比 ≥ 1、价格 2–100 元，剔除 ST 与流动性枯竭个股。量比由候选池日 K 线按分钟进度校正后推导，不依赖任何第三方数据源。",
  },
  {
    layer: "第 2 层 · 深度评估（逐只打分）",
    desc: "Ethan 技术面：六维评分（趋势 / 资金 / 质量 / 位置 / 动量 / 安全），资金维度由「量能扩张 × 0.4 + 竞价抢筹分位 × 0.35 + 连板高度 × 0.25」构成。Lucas 板块共振：同行业多只入选加分，踩中强势行业额外加成。Edwin 风格基本面：PE / PB / ROE / 利润与营收增速，给价值锚定。Sophia 风控：六条熔断规则，命中任何一条一票否决（如「前日涨停 + 今日高开 > 7% + 竞价缩量」的一致性陷阱）。",
  },
  {
    layer: "第 3 层 · T0 竞价确认 + 合成",
    desc: "最终分 = T0 竞价归一分 × 60% + 五路因子加权分 × 40%。昨晚形态再好，今早竞价不确认（没量、高开太多），分数照样起不来——这是「两阶段确认」的精髓：T-1 日形态初现，T 日竞价验真伪。开盘涨幅 ≥ 9.5% 的票总分乘 0.30（大概率买不进）。最后强制行业分散，输出 Top N。",
  },
];

const BUY_RULES = [
  "买入时机：9:25 竞价结束后运行筛选，9:30 开盘后以开盘价附近买入（回测口径 = T 日开盘价买）；或开盘后 5 分钟内回踩不破开盘价再进。",
  "不要追高：开盘后直线拉升超过 +3% 宁可放弃——违背「竞价确认但不追」的原则。",
  "卖出时机：次日（T+1）收盘前清仓。次日冲高就走，不恋战；尾盘无论如何离场。",
  "止损线：跌破买入价 -5% 无条件割（Sophia 只管买入前，买入后靠纪律）。",
  "单票仓位 ≤ 总资金的 1/8，正好配 Top8 分散逻辑。",
];

const LIMITS = [
  "回测 ≠ 实盘：T 日开盘价买入在实盘有滑点、有买不进的情况（秒拉涨停根本买不进），实际收益必然打折。",
  "概率工具不是预言机：它做的是「在 5500 只里找出竞价最强、形态最健康、板块有共振、没踩风控雷的 8 只」，单次胜率可能只有 50–60%，靠的是长期纪律 + 分散 + 严格止损。",
  "先纸面验证：建议至少连续记录 2 周——每天竞价结束后跑一遍，记下 Top N 的开盘价和次日收盘价，算算策略在当下市场环境里到底有没有效，再决定要不要用真金白银。",
];

const DISCLAIMER =
  "本工具为技术学习与研究用途的量化分析演示，所有输出均为客观数据统计与规则化计算结果，" +
  "不构成任何投资建议、荐股、买卖推荐或收益承诺。市场有风险，决策与后果由使用者自行承担。";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 text-[11px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">{title}</h3>
      {children}
    </section>
  );
}

export default function RulesPanel() {
  return (
    <details className="panel panel-sheen group overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.02]">
        <span className="text-[14px] text-[#e8c887]">◈</span>
        <span className="text-[13.5px] font-semibold tracking-tight">系统运作规则 · 买卖纪律 · 局限提示</span>
        <span className="text-[10.5px] text-[var(--ink-faint)]">四层漏斗 · 时间线 · 风险提示</span>
        <span className="flex-1" />
        <span className="text-[var(--ink-mute)] transition-transform duration-300 group-open:rotate-90">›</span>
      </summary>

      <div className="space-y-6 border-t border-[var(--hairline)] px-5 py-5">
        <Section title="一天的时间线">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {TIMELINE.map((t) => (
              <div
                key={t.time}
                className="rounded-[11px] border border-[var(--hairline)] bg-black/20 p-3 transition-colors hover:border-[rgba(212,176,107,0.28)]"
              >
                <div className="tnum font-mono text-[11px] text-[#e8c887]">{t.time}</div>
                <div className="mt-1 text-[12.5px] font-medium text-[var(--ink)]">{t.title}</div>
                <div className="mt-1 text-[11px] leading-relaxed text-[var(--ink-mute)]">{t.desc}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="四层漏斗（点「运行选股流水线」后发生的事）">
          <ol className="space-y-2.5">
            {FUNNEL.map((f, i) => (
              <li
                key={f.layer}
                className="flex gap-3 rounded-[11px] border border-[var(--hairline)] bg-black/20 p-3.5"
              >
                <span className="tnum mt-px shrink-0 font-mono text-[11px] text-[rgba(212,176,107,0.7)]">
                  L{i}
                </span>
                <div>
                  <div className="text-[12.5px] font-medium text-[var(--ink)]">{f.layer}</div>
                  <div className="mt-1 text-[11.5px] leading-relaxed text-[var(--ink-mute)]">{f.desc}</div>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="怎么买、什么时候买">
          <ul className="space-y-2">
            {BUY_RULES.map((r, i) => (
              <li key={r} className="flex gap-2.5 text-[12px] leading-relaxed text-[var(--ink-soft)]">
                <span className="tnum mt-px shrink-0 font-mono text-[10.5px] text-[var(--ink-faint)]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="必须明白的三个局限">
          <ul className="space-y-2">
            {LIMITS.map((r, i) => (
              <li
                key={r}
                className="rounded-[11px] border border-[rgba(240,163,94,0.22)] bg-[rgba(240,163,94,0.05)] px-3.5 py-2.5 text-[12px] leading-relaxed text-[var(--ink-soft)]"
              >
                <span className="mr-1.5 text-[#f0a35e]">△</span>
                {r}
              </li>
            ))}
          </ul>
        </Section>

        <div className="rounded-[11px] border border-[rgba(246,70,93,0.22)] bg-[rgba(246,70,93,0.05)] px-4 py-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#ff8a99]">
            免责声明
          </div>
          <p className="text-[11.5px] leading-relaxed text-[var(--ink-soft)]">{DISCLAIMER}</p>
        </div>
      </div>
    </details>
  );
}
