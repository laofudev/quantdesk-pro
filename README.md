# QuantDesk · A 股竞价短线选股工作台（本地版）

复刻 Alpha-X 平台选股流水线精髓，使用用户自己的数据源（扶摇 Fuyao / 同花顺 + Tushare）实现的**本地运行**选股工具。仅供个人学习研究。

> 技术栈：Next.js 14（App Router）+ TypeScript + Tailwind CSS，深色金融终端风（slate-900 + 琥珀 #D4B06B）。

---

## 一、本地运行步骤

```bash
# 1. 安装依赖（Node 18+）
npm install

# 2. 配置 token（已提供 .env.local；自行部署时复制 .env.example 填入自己的 token）
cp .env.example .env.local   # 首次自行配置时

# 3. 启动开发服务器
npm run dev
# 打开 http://localhost:3000

# 4. 生产构建
npm run build && npm run start

# 5. 引擎单元测试（纯函数，无网络依赖）
npm run test:engine
```

## 二、Token 说明

| 环境变量 | 来源 | 用途 |
|---|---|---|
| `FUYAO_API_KEY` | 扶摇 Fuyao（同花顺，fuyao.aicubes.cn） | 全市场快照（分页遍历）、历史 K 线（前复权）、竞价快照/风向标、涨停/跌停/炸板池、连板天梯、热股榜、异动原因、估值 PE/PB、财务指标、交易日历。认证头 `X-api-key`；**注意限流**：4001/HTTP429 触发退避重试（最多 2 次），全部批量请求已内置串行 + 小延迟（批量 200ms、快照分页 300ms），请勿自行高并发调用 |
| `TUSHARE_TOKEN` | Tushare（需 5000 积分） | **行业归属（stock_basic.industry）与资金流向（moneyflow，近 5 日逐只 150ms 间隔）的主源**；同时是快照（daily + daily_basic）与 K 线（daily）的**降级源**，并为扶摇快照补齐名称/换手率/量比/市值 |

Token 只存在于 `.env.local`（已被 `.gitignore` 忽略），仅在服务端 Route Handlers 中使用，**绝不进入前端 bundle**。

## 三、策略逻辑简介

选股流水线复刻自 Alpha-X 公开前端逻辑（仅供学习），参数均可在 UI 调整：

- **Phase 0 市场环境判定（Regime）**：全市场开盘涨幅截尾均值 TM（去首尾各 2%）+ 跌势确认 4 项（板块涨跌比<0.30 / 跌停>10 只 / 隔夜外部指数≤-0.5% / 个股涨跌比<0.30），判定 9 档 regime（大涨~大跌、超卖反弹、均衡），每档对应一组五路 Agent 权重（ethan/lucas/edwin/sophia/mia）。
- **Phase 1 初筛**：成交额 ≥500 万、换手率 ≥0.5%、剔除北交所（8/4/92 开头）与 ST/退市、量比 ≥1.0、价格 2~100 元；按"量比+换手+涨幅弹性"基础分截断 ≤200 只进入深度评估。
- **Phase 2 深度评估（五路 Agent）**：
  - **Ethan 技术六维**：趋势（开盘价增量 MA5/20/60 排列）、资金（近 5 日主力净流入分档）、质量（PE/PB/ROE）、位置（MA5 乖离率）、动量（60 日涨幅分档）、安全（20 日平均振幅），权重 .18/.22/.15/.15/.15/.15，外加 tech_bonus 加减分（蓄势爆量+15、一致性陷阱-15 等 8 条）。
  - **Lucas 板块共振**：基准 50，同板块入选数量加分（≥5 只 +12）、板块强度分档、板块内排名前 3 奖励；命中竞价强势板块 ×1.3，弱势板块高开 -30；公告催化剂（回购/增持/预增 +5 等）。
  - **Edwin 风格×基本面**：`风格匹配×0.5 + 基本面×0.5`，风格按 regime 匹配市值/估值/波动（大跌偏好大盘低估值），基本面由净利/营收同比、ROE、净利率、资产负债率合成。
  - **Sophia 风控熔断（veto）**：成交额<300 万 / ST / 偏离 5 日线>30% / 贴 20 或 250 日顶<1% / 一致性陷阱（前日涨停+高开>7%+竞价量比<10）/ 前日振幅>15%，命中即淘汰并记录原因；另有非熔断扣分（利空公告 -20、≥3 连板 -30）。
  - **Mia 市场相对强度**：个股开盘涨幅相对全市场 TM 的超额收益映射。
- **T0 竞价评分 V3（0.5~1.5）**：`催化剂×0.5 + 安全性×0.3 + 信号确认×0.2`，分别基于竞价抢筹金额分位、高开幅度分档、竞价量比分档。
- **最终合成**：
  ```
  agent_base = Σ(agent分 × regime权重)
  t0_norm    = (T0 - 0.5) × 100
  final      = t0_norm×0.6 + agent_base×0.4 - sophia_penalty   （veto → -∞）
  开盘涨幅 ≥ 9.5% 时 final × 0.30
  ```
- **强制行业分散输出**：Top4/8/12 可切换，同一行业最多 ⌈N/4⌉ 只，Top3 必须三个不同行业。

## 四、数据降级策略

所有外部请求都在服务端 Route Handlers 中完成，**任何失败都不会导致 500**：

| 数据 | 主源 | 降级链 |
|---|---|---|
| 全市场快照 | 扶摇 prices/snapshot 分页遍历（约 56 页×100，串行 300ms 间隔，缓存 10 分钟）；换手率/量比/PE/PB/市值由 Tushare daily_basic 合并 | Tushare daily + daily_basic（最近交易日，非实时） → 中性空集 |
| Regime 判定 | 扶摇快照 open_price/prev_price 全市场数组；跌停数取 limit-down-pool total | Tushare 快照 → 中性 regime"均衡"（等权） |
| 竞价数据（T0 核心） | 扶摇 auction/snapshot（候选股分批 100）+ short-term-benchmark（"放量"/"高开" tags 加分） | 无 → **T0 落中性 1.0 并标注 `t0Neutral: true`** |
| 涨停/跌停/炸板/连板 | 扶摇 limit-up-pool / limit-down-pool / limit-break-pool / limit-up-ladder | Tushare limit_list_d → 快照 ±9.8% 近似 |
| 情绪周期 | 由涨跌停池 + 连板天梯 + 热股榜当日衍生，逐日累积近 40 日序列（缓存） | Tushare limit_list_d 聚合 → null |
| 催化剂 / 异动 | 扶摇 anomaly-analysis-stock 异动原因 + 涨停池 limit_up_reason 关键词 | 无 → 中性 |
| 估值 PE/PB | 扶摇 valuations/snapshot（候选股分批 100） | Tushare daily_basic（pe_ttm/pb） |
| 财务指标（Edwin 基本面） | 扶摇 financials/indicators 最新报告期（逐只 200ms 间隔，限前 50 只候选） | 无 → 中性 50 |
| K 线 | 扶摇 prices/historical（前复权） | Tushare daily → 中性值 |
| **行业归属（行业分散/Lucas）** | **Tushare stock_basic.industry（全市场一次拉取，当日缓存）** | "未知"桶（行业分散同样受限） |
| **资金流向（Ethan capital）** | **Tushare moneyflow（近 5 日，候选股逐只 150ms 间隔）** | 中性 55 |
| ST 名单 | 涨停池 is_st 字段 + Tushare stock_basic 名称含 ST/退 | 名称含 ST/退 字样兜底 |
| 交易日历 | 扶摇 calendar/trading-days | Tushare trade_cal |
| 板块强度（Lucas） | 同花顺行业指数快照（a-share-index/prices/snapshot，行业名精确匹配） | 映射缺失 → 候选池内同行业平均涨幅近似 |

缓存为 `.cache/` 目录下的 JSON 文件：快照 TTL 10 分钟，其余当日有效，无需任何原生数据库依赖。

界面中"数据源"标识会显示当前处于 扶摇/同花顺（实时）/ Tushare（降级）/ 中性值 哪种状态。

## 五、目录结构

```
quantdesk/
├── app/
│   ├── layout.tsx / page.tsx / globals.css     # 主 Dashboard
│   └── api/
│       ├── pipeline/run/route.ts               # POST 筛选配置 → 全流程 → 结果
│       ├── market/regime/route.ts              # GET 当日市场环境
│       ├── market/snapshot/route.ts            # GET 全市场快照（缓存）
│       └── stock/[code]/route.ts               # GET 个股明细
├── lib/
│   ├── providers/fuyao.ts / tushare.ts         # 数据源封装（全 try/catch 降级）
│   ├── cache.ts                                # JSON 文件缓存
│   ├── engine/                                 # 纯函数引擎（无网络依赖）
│   │   ├── regime.ts / phase1.ts / ethan.ts / lucas.ts
│   │   ├── edwin.ts / sophia.ts / t0.ts / final.ts
│   └── types.ts
├── components/                                 # RegimeCard / FilterPanel / ResultTable / StockDrawer
└── tests/engine.test.ts / fuyao.test.ts        # 引擎单测 + 扶摇信封解析单测（node:test）
```

## 六、免责声明

本项目仅为**个人学习研究**用途，策略逻辑复刻自 Alpha-X 公开前端逻辑：

1. 本项目不构成任何投资建议、投资咨询或交易指令；
2. 股市有风险，投资需谨慎。任何基于本项目输出的交易行为及其后果由使用者自行承担；
3. 数据来源于第三方接口（扶摇/同花顺 / Tushare），其准确性、及时性、完整性不作任何保证；
4. 历史表现不代表未来收益，量化策略存在失效风险；
5. 请勿将本项目用于任何商业用途或对外提供服务。
