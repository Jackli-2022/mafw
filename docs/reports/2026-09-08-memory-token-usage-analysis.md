# 记忆系统 Token 用量与缓存命中率分析（2026-09-08）

数据源：`~/.mafw/memory/gateway.db` trajectory_turns（2026-08-25 → 09-08，7,779 turns）、
`~/.mafw/logs/mafw.log*` 554 次 index refresh 事件、`~/.mafw/memory/.harmonic_index.json`（948 条）。

## 总量

| 角色 | input | cache read | 命中率 | turns | opencode 报告成本 |
|---|---|---|---|---|---|
| index-scan | 63.6M | 552.4M | 89.7% | 6,739 | $377.4 |
| extract (turnCompress) | 18.0M | 57.2M | 76.0% | 358 | $73.8 |
| manager | 1.8M | 7.5M | 80.2% | 131 | $0.13 |
| reflect | 0.45M | 4.1M | 90.2% | 90 | $3.9 |
| **记忆系统合计** | **83.9M** | **621.2M** | **88.1%** | 7,318 | $455.2 |
| 全局（含主对话） | 97.6M | 673.7M | 87.3% | 7,779 | $521.2 |

记忆系统占全局 input 86%、cache read 92%。主对话命中率 79.3%。

## 成本口径矛盾（未决）

- trajectory 记录（opencode 上报）：qwen3.7-max 记忆系统 **$455**（隐含 $0.73/M prompt）
- `model-prices.ts` 价目表：input $0.20/M、cached $0.02/M → 估算 **~$27**
- 两者差 17×，需对照阿里云 DashScope 账单核实。token 数为权威信号，美元数字存疑。

## 冷扫描根因分析（systematic-debugging Phase 1）

冷扫描定义 hit<50%（cache.read/(input+cache.read)）。全量 490/6,739 = 7%，但贡献 ~58% 的
uncached input（37M tokens）。

**被否定的假设**：supersede 删条目打断 append-only 文本 prefix。
证据：条目数变化的 refresh 后冷扫率 7.3% vs 条目数不变 7.1%——无相关；冷扫描距上次
refresh p50 = 27 分钟。tombstone 修复方案随之取消。

**实际病因（burst 位置分析，burst = 连续 <60s 的扫描串）**：

| burst 内位置 | n | 冷扫率 |
|---|---|---|
| pos 0（闲置 ≥60s 后首次） | 171 | **43.3%** |
| pos 1 | 159 | 22.0% |
| pos 2~5 | ~530 | 12-20% |
| pos 7+ | ~540 | ~6% |

- 病因 A：闲置 >5min 后缓存 TTL 过期，burst 首扫付全价
- 病因 B：burst 内持续 12-20% 冷，与 DashScope 隐式缓存**异步写入**一致（连续请求过快，上次缓存未落盘）

## 关键背景修正

全部历史扫描数据来自**旧 session-based 路径**（2026-09-01 `ab1e7f9f` 之前）：
无 cache_control、无 in-flight 去重、prefetch 无节流 → 放大倍数 10-51 次 scan/主对话回合。

09-01 起的新路径（direct HTTP，`index-scan.ts`）已内置：显式 `cache_control: ephemeral` +
并发去重 + 60s/session prefetch 节流 + 失败指数退避。**扫描风暴根因大概率已被架构切换修掉**，
新路径生产数据尚为零（日志中 5ms 延迟行均为单测 mock）。索引体积实测 p50 prompt 65K
（948 条 / ~124K chars，CJK≈1 token/char），远超设计注释的 25-30K 假设；09-07 unmerge 清理
已将索引 3MB → 566KB。

## 结论与后续

| 措施 | 状态 |
|---|---|
| tombstone 修 prefix | **取消**（无证据） |
| 索引文本瘦身（65K→~35K） | **已否决**（2026-09-08 A/B，见下节） |
| 查询门控/降频 | **降级**——新路径已节流 |
| 观察新路径 | **已失效被取代**——scan 通道一度 disabled（workerModel=gateway 无 direct endpoint），2026-09-08 端点泛化后恢复，改看 trajectory 自埋点数据 |
| worker 模型换低价 provider | **已完成**——workerModel 已切 gateway/glm-5.3-flash（免费），dollar 成本归零 |

## Step 4 A/B 实测（2026-09-08）：瘦身否决

工具：`evaluation/longmemeval/src/scan-ab.ts`（三臂 paired，24 题 × 3 扫描，qwen3.7-max，
指标=gold-session recall）。Control 采用生产形态（abstraction 截 200 = 写路径现状 p99）：

| 臂 | 截断 | session-recall | avg prompt |
|---|---|---|---|
| A-prod200 | abs 200 + 5 anchors | **73.9%** | 14.4K chars (~5.8K tok) |
| B-slim60 | abs 60 + 2 anchors | **65.2%**（-8.7pp，未过非劣门槛 5pp） | 7.7K chars (~3.1K tok) |
| C-slim40 | abs 40 + 1 anchor | **39.1%**（剂量反应单调崩塌） | 5.5K chars (~2.2K tok) |

结论：
1. **截断单调杀 scan 召回**，B 未过预注册的非劣门槛 → 不合入生产默认
2. 全文对照（3 题 smoke）recall=100% vs prod200 80% → **写路径 200 截断本身已是 scan 质量上限的约束**——若未来要提升 scan 质量，方向是写路径保留更多判别信号（与瘦身相反）
3. 瘦身的 dollar 动机已被免费 workerModel 归零，不再值得冒险
4. 附带修复（本过程中发现）：scan short-id 从头部 12 位改**尾部 10 位 + endsWith**——头部前缀在同毫秒批量写时碰撞（eval 实测 53 条全同前缀），生产批量写同样存在隐患（`9d06b0da`）
5. `formatEntryForIndex` 截断 opts 与 `formatIndexForScanSlim` 保留为已测试的基础设施，供未来按需实验

复盘教训：分析（2026-09-08 早前会话）曾凭 DB 聚合数据推断"supersede 断 prefix 贡献 58% input"，
未做相关性验证；实际两个分组冷扫率几乎相同。教训：**冷/热归因必须对齐事件流做相关性，
不能只看聚合比例**。Step 4 补充教训：**A/B 的 control 必须先锚定生产形态**（第一版用
eval 全文当 control 得出"100%→40% 崩塌"的误导性对比；换成生产形态 control 后数字才有意义）。
