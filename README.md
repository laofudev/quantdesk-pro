# QuantDesk Alpha · A 股集合竞价多因子选股工作台

基于公开 Alpha-X 策略流水线思路复刻的**本地运行**选股工具，纯扶摇（同花顺）数据源，仅供个人学习研究。

> 技术栈：Next.js 14（App Router）+ TypeScript + Tailwind CSS，深色金融终端风。

---

## 一、本地运行步骤

```bash
# 1. 安装依赖（Node 18+）
npm install

# 2. 启动开发服务器
npm run dev
# 打开 http://localhost:3000

# 3. 首次使用需在页面右上角「API 设置」填入你的扶摇 API Key
#    Key 仅保存在服务端并以 AES-GCM 加密落盘，浏览器只持有随机 sessionId Cookie。

# 4. 生产构建
npm run build && npm run start

# 5. 引擎单元测试（纯函数，无网络依赖）
npm run test:engine
```

## 二、数据源说明

| 数据源 | 获取方式 | 用途 |
|---|---|---|
| 扶摇 Fuyao（同花顺） | https://fuyao.aicubes.cn 注册获取个人 Key | 全市场快照、历史 K 线、竞价快照/风向标、涨跌停/炸板池、连板天梯、热股榜、异动原因、估值 PE/PB、财务指标、交易日历、行业指数等。认证头 `X-api-key`；注意限流（4001/HTTP429 已内置退避重试） |

所有外部请求均在服务端 Route Handlers 中完成，Key 明文**永不进入前端 bundle、响应体或日志**。

## 三、策略逻辑简介

选股流水线参数均可在 UI 调整：

- **Phase 0 市场环境判定（Regime）**：全市场开盘涨幅截尾均值 TM + 跌势确认 4 项，判定 9 档 regime，每档对应一组五路 Agent 权重。
- **Phase 1 初筛**：成交额、换手率、北交所/ST 剔除、量比、价格范围等硬过滤。
- **Phase 2 深度评估（五路 Agent）**：
  - **Ethan 技术面**：趋势/资金/质量/位置/动量/安全六维评分 + tech_bonus 加减分。
  - **Lucas 板块共振**：同板块入选数量、板块强度、板块内排名、催化剂公告。
  - **Edwin 风格×基本面**：按 regime 匹配市值/估值/波动风格 + 财务指标。
  - **Sophia 风控熔断**：6 条硬规则一票否决 + 非熔断扣分。
  - **Mia 相对强度**：个股开盘涨幅相对全市场 TM 的超额收益映射。
- **T0 竞价评分**：催化剂/安全性/信号确认三维合成。
- **最终合成**：`final = t0_norm×0.6 + agent_base×0.4`，开盘涨幅 ≥9.5% 时 ×0.30。
- **强制行业分散**：同行业限额 + Top3 强制三个不同行业。

## 四、数据降级策略

所有外部请求都包裹 try/catch，**任何失败都不会导致 500**：

| 数据 | 主源 | 降级 |
|---|---|---|
| 全市场快照 | 扶摇 prices/snapshot 分页遍历 | 空集（界面提示数据不可用） |
| Regime 判定 | 扶摇快照推导 | 中性 regime"均衡"（等权） |
| 竞价数据（T0 核心） | 扶摇 auction/snapshot + short-term-benchmark | T0 落中性 1.0 并标注 `t0Neutral: true` |
| 涨跌停/连板/热榜 | 扶摇对应端点 | null |
| 情绪周期 | 由涨跌停池 + 连板天梯 + 热股榜当日衍生 | null |
| 估值 PE/PB | 扶摇 valuations/snapshot | null |
| 财务指标 | 扶摇 financials/indicators | 中性 50 |
| K 线 | 扶摇 prices/historical | null |
| 行业归属 | 同花顺概念板块成分反查归并到 31 个一级行业 | "未知"桶 |
| 板块强度 | 同花顺行业指数快照 | 候选池内同行业平均涨幅近似 |
| 交易日历 | 扶摇 calendar/trading-days | null |

缓存为 `.cache/` 目录下的 JSON 文件：快照 TTL 10 分钟，其余当日有效，无需数据库。

## 五、目录结构

```
quantdesk/
├── app/
│   ├── layout.tsx / page.tsx / globals.css          # 主入口
│   └── api/
│       ├── credentials/route.ts                     # 扶摇 API Key 读写
│       ├── pipeline/run/route.ts                    # POST 选股全流程
│       ├── market/regime/route.ts                   # GET 市场环境
│       ├── market/snapshot/route.ts                 # GET 全市场快照
│       ├── market/refresh/route.ts                  # POST 清除行情缓存
│       ├── stock/[code]/route.ts                    # GET 个股明细
│       └── stats/route.ts                           # GET 胜负统计
├── components/                                      # Onboarding / Workbench / TopBar / 各面板
├── lib/
│   ├── providers/fuyao.ts                           # 扶摇数据源封装
│   ├── data/market.ts / derive.ts / industry.ts     # 市场数据装配与行业映射
│   ├── cache.ts / credentials.ts / session.ts       # 缓存、凭据、会话
│   ├── api-guard.ts                                 # 数据 API 统一鉴权入口
│   ├── journal.ts                                   # 选股日志与胜负结算
│   ├── format.ts / time.ts / types.ts               # 工具与类型
│   └── engine/                                      # 纯函数选股引擎
├── tests/                                           # 引擎 + 扶摇 envelope 单测
└── AlphaX平台策略运行机制研究.md                    # 策略参考文档
```

## 六、环境变量（可选）

| 变量 | 说明 |
|---|---|
| `CREDENTIAL_SECRET` | 固定凭据主密钥（≥16 位）。不设置时服务端每次启动随机生成，单实例可用；多实例建议显式设置。 |

## 七、免责声明

本项目仅为**个人学习研究**用途：

1. 不构成任何投资建议、投资咨询或交易指令；
2. 股市有风险，投资需谨慎。任何基于本项目输出的交易行为及其后果由使用者自行承担；
3. 数据来源于第三方接口（扶摇/同花顺），其准确性、及时性、完整性不作任何保证；
4. 历史表现不代表未来收益，量化策略存在失效风险；
5. 请勿将本项目用于任何商业用途或对外提供服务。
