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
| 索引文本瘦身（65K→~35K） | **候选**，等新路径真实数据再决定；质量验证可走 LongMemEval L1 scan 集成（`ef28fe5b`）A/B |
| 查询门控/降频 | **降级**——新路径已节流 |
| 观察新路径 | **当前最优行动**：新路径日志已含 cachedTokens+延迟，积累一次真实使用后复查命中率 |
| worker 模型换低价 provider | 若账单证实 $455 口径则是最大成本杠杆（deepseek-flash 隐含 $0.025/M vs qwen3.7-max $0.73/M） |

复盘教训：分析（2026-09-08 早前会话）曾凭 DB 聚合数据推断"supersede 断 prefix 贡献 58% input"，
未做相关性验证；实际两个分组冷扫率几乎相同。教训：**冷/热归因必须对齐事件流做相关性，
不能只看聚合比例**。
