# 2026-11-19 · 实时记忆召回延迟预算调查

## 问题

“实时记忆召回多少毫秒算好？”不能只用一个绝对值回答。对 MAFW，边界 recall 发生在 LLM 调用前，属于**首 token 之前的隐藏预处理**；它的延迟不是“用户点按钮后的交互反馈”，而是直接加到用户等待首个回答的时间上。因此需要同时看：

1. 人类感知阈值；
2. LLM 首 token / 整体响应预算；
3. MAFW 自身的 100ms 硬截止；
4. 同类记忆产品的检索延迟口径。

## 结论

对 MAFW 当前架构，推荐把目标拆成两条路径：

| 路径 | p50 | p95 | p99 | 说明 |
|---|---:|---:|---:|---|
| 已命中 snapshot，直接 serve | ≤5ms | **≤20ms** | ≤50ms | 最理想，应该承担绝大多数轮次 |
| 实时 fallback 检索 | ≤50ms | **≤100ms** | ≤150ms | 不得把 p95 200ms+ 当常态 |
| 后台 snapshot 构建 | ≤500ms | **≤2s** | ≤5s | 不占边界路径，但影响快照新鲜度 |

同时建议把以下作为真正验收指标，而不是只看均值：

- **fallback >100ms 的比例**：目标是 ≤1–5%；若要求 99% 轮次都送达，必须做到 p99≤100ms。
- **snapshot 命中率**：目标 ≥90%；低于 80% 会让大部分轮次落到慢 fallback。
- **记忆对总 TTFT 的增量**：理想 ≤100ms；≤200ms 可接受；>500ms 对每轮自动注入不合理。
- **fail-open 可见性**：超时必须显式计数；不能把服务端“稍后算出的结果”算作用户实际看到。

一句话：

> **“好”的实时边界召回应是 p50 50ms 左右、p95 100ms 内；真正的优秀方案是 snapshot 热路径 p95 20ms，而不是把在线检索优化到 100ms。**

## 证据 1：人类感知阈值

Jakob Nielsen / NN/g 的三档经典阈值：

- **0.1 秒**：用户感觉是“即时反应”，像自己直接操作；
- **1 秒**：用户注意到延迟，但仍保持思路连续；
- **10 秒**：超过后注意力开始转移。

Google RAIL 采用同一量级：

- 用户输入到可见响应目标 **100ms 内**；
- 输入处理本身建议 **50ms 内**；
- 100–1000ms 仍属于自然连续过程，但已不是“即时”。

这些数字原本描述交互反馈。边界 memory recall 没有可见的“点击反馈”，它消耗的是模型首 token 前的空白时间，所以不能因为“用户看不到 recall 进度”就认为它不占感知预算。它实际上全部加到 TTFT 上。

来源：

- [NN/g · Response Times: The 3 Important Limits](https://www.nngroup.com/articles/response-times-3-important-limits/)
- [web.dev · Measure performance with the RAIL model](https://web.dev/articles/rail)
- [MDN · How long is too long?](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_long_is_too_long)

## 证据 2：LLM 首 token 预算

对话式 LLM 的体验主要被 **TTFT** 决定；总生成时间可以通过流式输出掩盖。业界实践常把短 prompt 的交互式聊天目标放在：

- **p95 TTFT ≤1s** 属于可接受；
- **p95 200–500ms** 属于响应较好；
- **p95 >1.5–2s** 开始明显迟钝。

这不是统一标准，但可以作为比例约束：如果模型自身 TTFT 已经在 800ms–1.5s，额外增加 200–500ms 的 memory 检索会显著放大等待；把召回控制在 100ms 内，最多只占常见 TTFT 的约 10%。

来源：

- [OpenAI · Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization)
- [DeepInfra · TTFT and provider KPIs](https://deepinfra.com/blog/llm-api-provider-performance-kpis-101)
- [ClickHouse · LLM inference latency](https://clickhouse.com/resources/engineering/llm-inference-latency)

## 证据 3：同类记忆产品的公开延迟

公开数字的**测量范围不同**，不能直接横排成“谁更快”，但可提供量级参照：

| 系统 | 公开检索延迟 | 口径 |
|---|---:|---|
| Mem0 | p50 148ms / p95 200ms | LoCoMo search-only（论文口径） |
| Zep | LongMemEval p50 104ms / p95 162ms | retrieval-only，不含 LLM 生成 |
| Zep | LoCoMo p50 87ms / p95 155ms | retrieval-only |
| Graphiti | p95 约 300ms | hybrid semantic + BM25 + graph |

来源：

- [Mem0 arXiv 2504.19413](https://arxiv.org/abs/2504.19413)
- [Zep · Memory benchmarks](https://www.getzep.com/research/memory-benchmarks/)
- [Cognee · Memory retrieval latency at scale](https://www.cognee.ai/ai-memory-retrieval-latency-at-scale)

这些数字说明：**100–200ms 的“记忆搜索”在行业里不算慢**。但它们是完整检索 API 的延迟，不是“每轮 LLM 调用前必须完成”的隐形预处理。对 MAFW 这种每轮自动注入路径，100ms 仍然应是更严格的边界。

## 证据 4：MAFW 自己的硬截止

当前插件在 `src/hooks/session-recall.ts:73-89` 使用：

```ts
const timeout = setTimeout(() => controller.abort(), 100)
```

超过 100ms 直接 abort，返回 `pointers:null`，fail-open 继续模型调用。

这意味着 100ms 对 MAFW 不只是“体验目标”，而是**功能截止**：

- 50ms 完成：正常注入；
- 100ms 完成：临界；
- 162ms 完成：服务端可能已经算出记忆，但用户侧已经拿不到。

## 当前实测与判断

固定 40 条 warm artifact（`personal-recall-after-memory-health-warm.json`）：

- AUTO p50：**162ms**
- p90：**219ms**
- p95：**226ms**
- p99（40 条样本仅供参考）：**244ms**
- max：**244ms**
- **>100ms：37/40（92.5%）**

最近日志：

- snapshot 命中并 serve：`search=0ms, noteBoard=2ms, neighbours=0ms`；
- fallback：`search=129–653ms`，另有 `noteBoard 1–7ms`、`neighbours 10–33ms`；
- 最近两天日志计数：snapshot served 115，stale/topic/FOK skip 合计 477，粗略 serve 比例约 **19%**。

这表示当前不是“差一点到 100ms”，而是：

1. **snapshot 热路径已经很好**，但覆盖不足；
2. **fallback 经常超过插件硬截止**；
3. 固定 40 条的 AUTO 命中是“服务端会返回”的口径，真实插件轮次中超时后会静默 fail-open，用户实际看到自动记忆的比例更低。

## 推荐决策

### 方案 A：坚持 100ms 硬截止（推荐，除非产品愿改契约）

目标：

- snapshot serve：p95 ≤20ms，命中率 ≥90%；
- fallback：p50 ≤50ms、p95 ≤90ms、p99 ≤100ms；
- >100ms fail-open 比例 ≤1–5% 并单独观测。

代价：fallback 还要继续优化；短 query 和长 query 都要测，不能用短查询均值掩盖长 query 尾部。

### 方案 B：把截止放宽到 150ms

目标：

- fallback p50 ≤80ms、p95 ≤150ms、p99 ≤250ms；
- 明确接受每次最多额外 150ms 的 TTFT 增量；
- snapshot 仍是主路径，fallback 只兜底。

代价：更多轮次能拿到记忆，但模型首 token 的等待上限变大；不能悄悄改，必须作为产品语义变更。

### 不推荐

- 把 p95 200ms+ 当成“实时召回已达标”；
- 只用均值而不看 p95/p99 和 >100ms 比例；
- 通过关闭 snapshot/增大超时来掩盖 fallback 结构问题；
- 把服务端评测命中率直接当作真实用户看到自动记忆的比例。

## 验收矩阵（未来实现/优化使用）

| 门 | 指标 | 通过标准 |
|---|---|---:|
| G1 | snapshot serve p95 | ≤20ms |
| G2 | snapshot 命中率 | ≥90% |
| G3 | fallback p95 | ≤100ms（方案 A）或 ≤150ms（方案 B） |
| G4 | >截止比例 | ≤5%（A 方案更严格时 ≤1%） |
| G5 | 固定 40 条质量 | 不低于当前 paired 结果，false=0、stale=0 |
| G6 | 真实插件可见注入率 | 单独统计，不能只看服务端 AUTO |

## 局限

- 40 条样本不足以可靠估计 p99；需要真实会话的 500–1000 个边界请求直方图。
- 公开记忆产品延迟来自不同硬件、语料、并发和统计范围，只能看量级。
- snapshot serve 的 20ms 是围绕当前 100ms 预算提出的工程目标，不是外部统一标准。
- 本轮只做调查，没有修改代码、配置或延迟契约。
