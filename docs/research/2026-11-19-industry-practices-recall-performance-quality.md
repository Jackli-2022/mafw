# 2026-11-19 · 业界记忆召回的性能与质量实践调研

## 0. 结论

业界对“实时记忆召回”的处理可以概括为两条主线：

1. **性能：把重活移出关键路径。**  
   用预计算、缓存、内存索引、两段式检索和有界的图扩展，把同步路径控制在 100–200ms 级；同时用 p95/p99、分阶段预算和真实验收门来管尾部，而不是只看均值。
2. **质量：把“能不能召回”和“该不该展示”分开评。**  
   业界不只看总准确率，而是拆成编码、检索、生成三层，并重点测知识更新、时间推理、冲突消解、多跳、弃权和 token 成本。静态 QA 基准只能测“能不能命中”，不能测“是否该命中、是否过期、是否解释得通”。

对 MAFW 的直接含义：

- **性能侧**：当前最缺的是“分阶段 p95 + 后台隔离 + 内存化图/证据索引”。我们已有的 snapshot 方向是对的，但实现还没有做到“上一轮回答后必然预取下一轮”。
- **质量侧**：固定 40 条做得比很多公开基准更严格（有 false injection、stale、agreement、REST/AUTO 双口径），但还缺 session-shaped 评测和知识更新/时间推理/冲突消解/弃权这四类高价值能力。
- **两者关系**：性能不是质量的代价。业界做法是用预算驱动优化，同时用逐类别质量门保住正确性，避免“为了 p95 牺牲召回”或“为了召回放垃圾”。

## 1. 性能：业界在做什么

### 1.1 先把预算拆到阶段，再看 p95

生产 RAG 的通用做法是先给每个阶段一个预算，然后分别测量：

```text
query parse
  → embedding / BM25
  → vector / sparse search
  → graph expansion / rerank
  → serialization / prompt assembly
```

参考来源：

- [RAG Retrieval Latency Playbook](https://www.stratenity.com/resources/01_evidence/insights/essays/retrieval-latency-where-the-milliseconds-hide)  
  提出按阶段预算（如 10/30/40/20ms）并用 p95/p99 管尾部，而不是看均值。
- [OpenAI latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization)  
  强调分别测 TTFT、端到端、检索前后各阶段。
- [web.dev RAIL](https://web.dev/articles/rail) / [NN/g](https://www.nngroup.com/articles/response-times-3-important-limits/)  
  把 100ms 当“直接操作”阈值，1s 当“思路连续”阈值。

**MAFW 对照**

当前 `gateway/src/routes/recall.ts` 只记录：

```text
search / noteBoard / goal / neighbours
```

还缺 graph、expansion、FOK、exact、render、client abort。因此我们还不能把 p95 归因到具体阶段，这和业界“先预算后优化”的顺序不一致。

### 1.2 两段式检索：先快召回，再有界扩展

图 + 向量混合检索的常见形态是：

1. Stage 1：BM25 / 向量做快速候选召回；
2. Stage 2：只在需要时做**有界**的图扩展；
3. 合并后一次 rerank，再截断到少量结果。

参考来源：

- [Graph-Vector Hybrid Search for RAG](https://techbytes.app/posts/graph-vector-hybrid-search-rag-multi-hop-reasoning/)  
  提出“两段式 + 有界 hop + 硬节点预算”，目标 p95 控制在 300ms 内。
- [Zep / Konig](https://www.getzep.com/blog/why-we-built-a-graph-database-service-for-agent-memory/)  
  热图用内存 adjacency + CSR，BM25/向量/图统一检索，p95 retrieval <100ms、端到端 <200ms。

**MAFW 对照**

我们已经做了：

- BM25 postings cache；
- secondary expansion 不再重复图扩展；
- exact evidence / lexical veto / FOK。

但还没有做到：

- 基础图查询的内存化邻接缓存；
- exact evidence 的索引化；
- 动态 expansion 预算。

这三项是当前 fallback p95 从 226ms 压到 100ms 内的主要空间。

### 1.3 预取和缓存：把“会重复的工作”移出关键路径

生产系统常用的三层：

1. **结果缓存**：相同/近似 query 直接复用；
2. **中间产物缓存**：embedding、BM25、图邻接、exact evidence 索引；
3. **预测性预取**：在上一轮还没结束时就开始准备下一轮。

参考来源：

- [Proximity approximate cache](https://arxiv.org/html/2503.05530v2)  
  LSH 语义缓存，使数据库调用减少约 78.9%。
- [Predictive prefetching for RAG](https://arxiv.org/abs/2605.17989)  
  预测下一步检索并预取，报告最多 43.5% 端到端延迟下降、62.4% TTFT 改善。
- [TeleRAG](https://proceedings.mlsys.org/paper_files/paper/2026/file/7fd522b89ac21009b7bbe7560a9a5add-Paper-Conference.pdf)  
  lookahead retrieval，让数据搬运与生成重叠。
- [Zep scaling](https://www.getzep.com/blog/scaling-agent-memory-zep-30x/)  
  图搜索 p95 从 600ms 降到 150ms，靠拆分检索服务和缓存热数据。

**MAFW 对照**

- `snapshot` 是预取思想，方向正确；
- 但只在 `user_input` 时触发，assistant 回答结束后不刷新；
- 且构建 p95 约 6s，说明预取没有跟上对话节奏；
- fallback 里最贵的部分（图、exact evidence）还没有索引化缓存。

这说明我们的问题不是“没做预取”，而是**预取生命周期和缓存层级都没做完**。

### 1.4 业界的延迟量级

这些数字不能直接横比（口径不同），但能说明“什么算正常”：

| 系统 / 场景 | 公开延迟 | 口径 |
|---|---:|---|
| Mem0（LoCoMo） | search p50 148ms / p95 200ms | search-only |
| Zep / Konig | retrieval p50 87–104ms，p95 155–162ms | retrieval-only |
| Zep 生产 | graph search p95 150ms，context retrieval p95 200ms | 检索管线 |
| 两段式图+向量 RAG | p95 目标 300ms 内 | 检索 + 有界图扩展 |
| MAFW 当前 | AUTO p50 162ms / p95 226ms | live boundary recall + 渲染 |

结论：

- **100ms 是一个偏严但合理的目标**，因为 MAFW 是“模型前注入”，不是普通检索 API；
- 业界多数系统用 150–200ms 作为检索-only p95 基准；
- 因此我们不应该把 100ms 当作“行业标准”，但应该把它当作**产品契约**，用 snapshot 和预算化 fallback 去逼近。

## 2. 质量：业界在做什么

### 2.1 不只看总准确率，按能力拆分

记忆质量不是单一分数。业界常见的拆分是：

- 信息抽取（IE）
- 多会话推理（MR）
- 知识更新（KU）
- 时间推理（TR）
- 弃权 / abstention（ABS）
- 冲突消解
- 多跳推理
- provenance / source attribution

参考来源：

- [LongMemEval](https://arxiv.org/abs/2410.10813)  
  把能力拆成 IE / MR / KU / TR / ABS，并报告 recall@k、nDCG。
- [LoCoMo](https://snap-research.github.io/locomo/)  
  把问题分为 single-hop、multi-hop、temporal、commonsense、adversarial。
- [RECON](https://arxiv.org/abs/2607.16716)  
  专门测级联失效、冲突消解、反事实、时间约束。
- [MemBench](https://arxiv.org/html/2506.21605)  
  把记忆效率、准确性和维护分开评估。

**MAFW 对照**

固定 40 条已经覆盖：

- exact（identifier / title）
- current-state（当前事实）
- implicit（自然改写）
- negative（无答案）
- false injection
- stale injection
- REST / AUTO agreement
- latency

这比很多公开基准更严格，因为我们有“**不该注入就不注入**”的负例和入口一致性。但还缺：

- knowledge update（不止 current-state，还要测新旧事实冲突）
- temporal reasoning（时间先后、有效期、point-in-time）
- conflict resolution（同一事实多版本、互斥槽位）
- abstention 的“假前提 / 错误前提”
- multi-session reasoning
- provenance（能否解释为什么这条记忆可信）

这就是为什么 implicit 2/10 现在还难以安全修复：我们还没有一个能分清“主题相关但答非所问”的高质量基准。

### 2.2 把编码、检索、生成分开归因

生产级记忆系统通常把失败拆成三层：

1. **编码失败**：该存的事实没有写进去；
2. **检索失败**：存了，但没取出来；
3. **生成失败**：取出来了，但模型没用好。

参考来源：

- [EvalMem](https://arxiv.org/abs/2609.22231)  
  用 Encoding / Retrieval / Generation Examiner 三路诊断，发现“检索是最高频失败层”。
- [Hindsight temporal-correctness bugs](https://hindsight.vectorize.io/blog/2026/03/23/agent-memory-benchmark)  
  列出常见时间正确性 bug：时区、as-of 边界、删除重建、标签过滤失效。
- [RECON](https://arxiv.org/abs/2607.16716)  
  指出“检索完美也不等于推理正确”，反事实和级联失效仍会失败。

**MAFW 对照**

我们已经在做：

- encoding：`mafw_add_memory` 写入 + T1 观察；
- retrieval：固定 40 + FOK + lexical veto + exact evidence；
- generation：部分依赖上层的 prompt / redemption 信号。

但我们还缺一个统一的“三层归因”评测。当前只看到“这条 query miss 了”，但不知道是：

- 没写入；
- 写入了但没召回；
- 召回了但被 FOK 压制；
- 召回了但排序错了；
- 召回了但展示层没放行；
- 召回了但模型没用。

这也是为什么 implicit 修不动：我们没有足够的失败归因。

### 2.3 时间、冲突、更新是真正的难点

业界共识是：

- 单条事实召回并不难；
- 难的是“事实变了之后，系统能否优先当前版本”；
- 更难的是“事实失效后，哪些下游结论需要级联更新”。

参考来源：

- LongMemEval 的 knowledge update 和 temporal reasoning；
- RECON 的 cascade propagation 和 source conflict；
- Mem0 的 LLM update resolver（ADD / UPDATE / DELETE / NOOP）；
- Zep 的 temporal invalidation；
- Hindsight 的 temporal bug 清单。

**MAFW 对照**

我们有：

- supersede 链；
- active head 重写；
- `must_exclude` stale 对照；
- exact evidence 只认 active 条目。

这已经比很多公开系统更严格。但还缺：

- point-in-time 查询；
- 冲突消解基准；
- 时区 / 日期边界；
- 多源冲突；
- 级联失效后的下游结论更新。

这类问题不能用“更高召回率”解决，必须用**时间语义和证据链**。

### 2.4 弃权比“猜对”更重要

业界普遍把 abstention 当独立能力，而不是把它当“负例”顺手测一下。

参考来源：

- LongMemEval 的 ABS；
- RECON 的 explicit abstain option；
- [Evaluating Agent Memory Honestly](https://huggingface.co/blog/mjfk/evaluating-agent-memory-honestly)  
  明确说“宁可说不知道，也不要自信地回答过期事实”。

**MAFW 对照**

这是我们目前做得比较对的地方：

- `no-memory` / `low-confidence` 本体抑制；
- negative 10 条 false injection 0/10；
- 词级 veto；
- exact evidence 只走确定性旁路。

这也是为什么“放宽低置信展示”被否决的原因——它换来的是 implicit 命中，但会破坏弃权能力。这个取舍和业界共识一致。

## 3. 业界做法映射到 MAFW

### 3.1 性能侧映射

| 业界模式 | MAFW 现状 | 差距 |
|---|---|---|
| 分阶段延迟预算 | 只记录总 `search` | 缺 graph/expansion/FOK/exact/abort |
| 两段式有界图扩展 | 已关 secondary graph，但 base graph 仍每 seed 查 SQL | 需要内存邻接缓存 |
| 结果/中间缓存 | postings 已缓存，exact/graph 未索引化 | exact evidence 和图邻接应索引化 |
| 预测性预取 | snapshot 已有，但只在 user_input 触发 | 需 assistant_reply 后刷新 + 双版本 query |
| 热路径与后台隔离 | snapshot build 与请求共享 Node 主线程 | 需 stage 化 / worker 隔离 |
| p95/p99 验收门 | 固定 40 只报 p50/p95 | 需真实验收门，不只看均值 |

### 3.2 质量侧映射

| 业界模式 | MAFW 现状 | 差距 |
|---|---|---|
| 分能力评测 | exact / current / implicit / negative 已分 | 缺 KU / TR / conflict / provenance |
| 编码-检索-生成归因 | 有部分分层，但没有统一评测 | 需要 EvalMem 式三层归因 |
| 时间正确性 | 有 supersede / stale 对照 | 缺 point-in-time / 时区 / 日期边界 |
| 冲突消解 | 有 supersede 链 | 缺同槽位冲突 / 多源冲突基准 |
| 弃权 | 做得好 | 不应为了 implicit 放弃当前低置信抑制 |
| token / 成本 | 未纳入固定 40 | 应补 token budget / 平均返回长度 |
| 生产路径评测 | 固定 40 是真实 API | 缺带 session 的 snapshot 评测 |

## 4. 对 MAFW 的具体建议

### 4.1 性能优先做这四件事

1. **补 stage histogram**
   - graph_ms、expand_passes、fok_ms、exact_ms、neighbors_ms、render_ms、total_ms
   - 客户端 abort 率
   - snapshot decision / build stage / queue wait
2. **exact evidence 索引化**
   - title/identifier O(1) map；
   - cue/DF 缓存；
   - 按 `searchVersion` 失效。
3. **图邻接缓存**
   - 先 LRU per-node；
   - 写入/删除时只失效受影响节点；
   - 结果与 SQL 版本逐 id/weight 一致。
4. **snapshot 生命周期**
   - assistant 回答后刷新；
   - 双版本 query（last-pair + rolling-window）；
   - build stage 化，避免阻塞 fallback。

### 4.2 质量优先做这三件事

1. **建 session-shaped 评测集**
   - 20–50 条真实 turn 序列；
   - 冻结 expected memory family；
   - 分别测 snapshot serve、fallback、真实 visible hit。
2. **把固定 40 扩成 5 类能力**
   - exact / current-state / implicit / negative 保留；
   - 新增 knowledge-update、temporal-reasoning、conflict-resolution、provenance。
3. **做编码-检索-生成归因**
   - 每个 miss 标记是 encode miss、pool miss、FOK suppress、rank miss、render miss 还是 generation miss；
   - 不再只报“AUTO miss”。

### 4.3 不要为了 p95 破坏质量

业界给我们的直接提醒是：

- p95 优化应该用**缓存和预算**解决，不该用**降低置信门**解决；
- implicit 召回差是真实问题，但解决方案应该是更好的 session-shaped 评测和 answerability verifier，不是把低置信记忆硬塞给模型；
- “宁可不答”在记忆系统里是特性，不是缺陷。

## 5. 参考

- RAG latency playbook: https://www.stratenity.com/resources/01_evidence/insights/essays/retrieval-latency-where-the-milliseconds-hide
- OpenAI latency: https://developers.openai.com/api/docs/guides/latency-optimization
- Graph-vector hybrid RAG: https://techbytes.app/posts/graph-vector-hybrid-search-rag-multi-hop-reasoning/
- Zep / Konig: https://www.getzep.com/blog/why-we-built-a-graph-database-service-for-agent-memory/
- Zep scaling: https://www.getzep.com/blog/scaling-agent-memory-zep-30x/
- Proximity cache: https://arxiv.org/html/2503.05530v2
- Predictive prefetching: https://arxiv.org/abs/2605.17989
- LongMemEval: https://arxiv.org/abs/2410.10813
- LoCoMo: https://snap-research.github.io/locomo/
- EvalMem: https://arxiv.org/abs/2609.22231
- RECON: https://arxiv.org/abs/2607.16716
- Hindsight temporal bugs: https://hindsight.vectorize.io/blog/2026/03/23/agent-memory-benchmark
- Honest agent-memory evaluation: https://huggingface.co/blog/mjfk/evaluating-agent-memory-honestly
