"use client";

/** 系统运作规则说明：每日时间线 / 四层漏斗 / 买卖纪律 / 三个局限 */

const TIMELINE = [
  { time: "08:30 前", title: "数据准备", desc: "拉全市场行情快照" },
  { time: "09:25–09:28", title: "竞价校准（核心）", desc: "竞价终态数据就绪，算 TM 判定市场环境" },
  { time: "09:28 之后", title: "运行筛选", desc: "点「开始筛选」，四层漏斗出结果" },
  { time: "15:10", title: "盘后复盘", desc: "记录 Top8 表现，验证次日收益" },
];

const FUNNEL = [
  {
    layer: "第 0 层 · 市场环境判定（Mia / Edwin）",
    desc: "全市场 5500+ 只竞价涨幅去首尾各 2% 取均值（TM），配合跌停数、涨跌比，判定 9 档环境（大涨→大跌→超卖反弹）。环境越差，风控 Sophia 权重越高（大跌时升至 0.40）。",
  },
  {
    layer: "第 1 层 · 初筛（5500 → 约 200 只）",
    desc: "硬条件过滤：成交额 ≥ 500 万、换手 ≥ 0.5%、量比 ≥ 1、价格 2–100 元，剔除北交所和 ST。留下有流动性、有资金关注的票。",
  },
  {
    layer: "第 2 层 · 深度评估（200 只逐只打分）",
    desc: "Ethan 技术面：六维评分（趋势/资金/质量/位置/动量/安全），偏爱低位蓄势放量，惩罚无量空涨、高开太多。Lucas 板块共振：同板块多只入选加分，踩中当日强势板块 ×1.3。Edwin 基本面：PE/PB/ROE/利润增速，给价值锚定。Sophia 风控：6 条熔断规则，命中任何一条直接淘汰（如前日涨停+今日高开 >7%+竞价缩量 = 一致性陷阱，典型诱多出货形态）。",
  },
  {
    layer: "第 3 层 · T0 竞价确认 + 合成（权重最大）",
    desc: "最终分 = 竞价评分 × 60% + 技术面等综合分 × 40%。昨晚形态再好，今早竞价不确认（没量、高开太多），分数照样起不来。即 Alpha-X 精髓的「两阶段确认」——T-1 日形态初现，T 日竞价验真伪。最后强制行业分散，输出 Top8（全不同行业）。",
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
  "先纸面验证：建议至少连续记录 2 周——每天 9:28 跑一遍，记下 Top8 的开盘价和次日收盘价，算算策略在当下市场环境里到底有没有效，再决定要不要用真金白银。",
];

export default function RulesPanel() {
  return (
    <details className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 text-sm">
      <summary className="cursor-pointer select-none text-slate-300">
        <span className="mr-2 text-amber-accent">📖</span>系统运作规则 · 买卖纪律 · 局限提示
      </summary>

      <div className="mt-4 space-y-5">
        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">一天的时间线</h3>
          <div className="grid gap-2 sm:grid-cols-4">
            {TIMELINE.map((t, i) => (
              <div key={t.time} className="rounded border border-slate-700 bg-slate-900/50 p-2.5">
                <div className="font-mono text-xs text-amber-accent">{t.time}</div>
                <div className="mt-1 font-medium text-slate-200">
                  {t.title}
                  {i < TIMELINE.length - 1 && <span className="ml-1 text-slate-600">→</span>}
                </div>
                <div className="mt-0.5 text-xs text-slate-400">{t.desc}</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">四层漏斗（点「开始筛选」后发生的事）</h3>
          <ol className="space-y-2">
            {FUNNEL.map((f) => (
              <li key={f.layer} className="rounded border border-slate-700 bg-slate-900/50 p-2.5">
                <div className="font-medium text-slate-200">{f.layer}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-slate-400">{f.desc}</div>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">怎么买、什么时候买</h3>
          <ul className="list-inside list-disc space-y-1 text-xs leading-relaxed text-slate-300">
            {BUY_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">必须明白的三个局限</h3>
          <ul className="list-inside list-disc space-y-1 text-xs leading-relaxed text-slate-400">
            {LIMITS.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      </div>
    </details>
  );
}
