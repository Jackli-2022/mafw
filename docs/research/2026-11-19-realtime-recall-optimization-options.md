# 2026-11-19 · 实时召回优化方案调查

## 0. 结论

当前延迟问题不是单点慢，而是两条路径都没有达到设计目标：

1. **snapshot 本应成为主路径，但覆盖率只有约 19%**；
2. **fallback 仍承担约 81% 的请求，且在 100ms 截止前无法完成**。

推荐按以下优先级实施：

```text
P0 观测与真实口径
  → P1 低风险 fallback 优化（完全相同语义的缓存/预计算）
  → P2 snapshot 生命周期与多候选查询
  → P3 后台构建隔离 / deadline-aware 降级
  → P4 仍不达标时，再讨论 150ms 截止
```

不建议先做：

- 直接把 100ms 改成 200ms；
- 降低 FOK 质量门；
- 关闭图扩展或 exact evidence 换速度；
- 用全量结果缓存冒充会话级 snapshot。

## 1. 当前证据

### 1.1 延迟

最新 warm 40 条：

| 指标 | 值 |
|---|---:|
| AUTO p50 | 162ms |
| AUTO p95 | 226ms |
| AUTO p99（40 样本参考） | 244ms |
| AUTO max | 244ms |
| >100ms | 37/40（92.5%） |
| REST p50/p95 | 32/38ms |

实时日志 fallback 常见 `search=129–653ms`。

### 1.2 Snapshot 使用情况

最近日志（2026-11-18/19）：

| 决策 | 次数 | 占全部 snapshot 决策 |
|---|---:|---:|
| served | 115 | 19.4% |
| stale（TTL 10min） | 243 | 40.9% |
| topic-shift（containment <0.25） | 144 | 24.2% |
| FOK no/low body | 92 | 15.5% |

构建耗时：

- p50：**1,013ms**
- p90：**2,551ms**
- p95：**6,078ms**
- max：12,052ms

已 serve 的快照年龄：

- p50：144s
- p95：534s
- max：590s

### 1.3 当前结构的两个直接洞

- snapshot 只在 `source === 'user_input'` 时调度（`gateway/src/routes/obs.ts:125-129`）；assistant 回答完成后不刷新。因此下一轮快照往往缺少刚完成的 assistant 内容。
- TTL 从用户输入触发构建的时刻开始老化；空闲超过 10 分钟后第一个请求必定 `stale`，即使仍是同一话题。

### 1.4 失败桶不是同一种问题

- **stale 243**：不是 topic 变了，而是缓存过期。其中 73 次 containment ≥0.25；如果只延长 TTL，理论上最多多服务约 12.3% 的全部请求，但伴随 stale 风险。
- **topic-shift 144**：只有 18 次 query <50 字符；大多数是长 query，不能靠“短指令特例”解决。
- **FOK 92**：质量门主动拒绝，不能为了命中率重新展示无把握本体。

### 1.5 对“90% 命中率”的修正

全量请求中 ≥90% snapshot 命中不现实，因为至少有：

- 新会话/冷启动；
- 真正换话题；
- FOK 无可靠答案；
- 长 agent prompt 与上一轮上下文本就不同。

建议把目标拆开：

| 口径 | 目标 |
|---|---:|
| 热会话同话题 continuation 的 snapshot serve | **≥90%** |
| 全部边界请求的 snapshot serve | 近期 40–60%，成熟后 60–80% |
| 所有 snapshot 不可用轮次的 fallback p95 | **≤100ms** |

如果产品要求“所有请求都 90% 命中”，就必须冒险服务 stale/topic 不匹配内容，不建议。

## 2. 方案总览

| 方案 | 主要作用 | 预期收益 | 质量风险 | 复杂度 |
|---|---|---|---:|---:|---|
| P0 stage 观测 + 真实 abort 统计 | 不再盲调 | 决定后续 | 无 | 低 |
| assistant_reply 后刷新 snapshot | 快照含最新回答，降低 topic-shift | 中 | 低 | 低 |
| 双查询/多版本 snapshot | 提高 containment 命中 | 中高 | 中 | 中 |
| 自适应 TTL / stale-while-revalidate | 回收 stale 桶 | 中 | 中 | 中 |
| 图邻接内存缓存 | 去掉 per-seed SQL | 高 | 低 | 中 |
| exact evidence 索引化 | 去掉全库重复扫描 | 中高 | 低 | 中 |
| 动态 query expansion 预算 | 长 query 少跑无用 pass | 中高 | 中 | 中 |
| boot prewarm | 消除首个请求 1.5s 冷尾 | 低（但显著） | 无 | 低 |
| snapshot 构建分阶段/隔离 | 减少主线程 starvation | 中高 | 低 | 高 |
| deadline-aware 降级 | 保 p95/p99 | 中 | 中高 | 中 |
| 100→150ms 截止 | 直接多服务一部分 | 高 | 产品语义变化 | 低 |

## 3. P0：先补观测，避免继续误判

### 3.1 服务端 stage histogram

在 `GET /api/recall/context` 记录并聚合：

```text
snapshot_decision: use|stale|topic-shift|fok|no-snapshot
query_chars
search_ms
expand_ms / expand_passes
graph_ms / graph_queries
fok_ms
exact_ms
lexical_ms
neighbors_ms
render_ms
total_ms
route: snapshot|fallback
```

目前日志只有 `search/noteBoard/goal/neighbours`，无法区分 graph、FOK、exact，也无法算真实 p95。

### 3.2 客户端真实可见率

插件 100ms abort 后服务端不知道结果未送达。建议：

- 插件在 abort/fail-open 时发一个 fail-open 的轻量计数（或本地日志汇总）；
- 服务端在 `res` 提前 close 时计入 `client_aborted`；
- 单独报 `visible_recall_rate`，不要再用固定 40 的服务器 AUTO hit 代替。

### 3.3 会话形状评测

固定 40 条无 sessionID，不能评价 snapshot。新增 held-out session case：

- 2–4 个真实 turn；
- 冻结 query、可接受记忆 family；
- 分别测 snapshot decision、serve latency、fallback latency、真实 visible hit；
- 至少覆盖：同话题追问、短指代、主题切换、10/30/60 分钟空闲、assistant 后立即追问。

没有这一步，不应调整 TTL 或 containment 阈值。

## 4. P1：低风险 fallback 优化

这些改动理论上可在不改变检索结果的前提下减少重复工作，应优先做。

### 4.1 图邻接内存缓存

当前 `searchScored` 每个 seed 分别调用：

- `AnchorGraphStore.getNeighbors`
- `CoactivationGraphStore.getNeighbors`

每次是 SQLite 查询；长 query 的基础 pass 仍可能有 50 seeds × 2 stores。Zep 的生产架构使用 **RAM adjacency lists + CSR**，遍历是 pointer dereference，而不是每次 SQL 查询；Zep 报告 graph retrieve p95 约 100ms 内、完整 retrieval p95 <200ms。

MAFW 的图规模：

- 17k nodes；
- 约 635k anchor edges；
- 约 17k coactivation edges。

可行实现：

1. 启动后懒构建每个节点的 adjacency list；
2. `getNeighbors` 从内存读取，仍应用 topK/exclude/decay；
3. `upsertUnit/removeUnit/rebuild` 只失效受影响节点；
4. 先做 LRU per-node cache，再评估全量 adjacency；
5. 监控 RSS，先测 10k/50k 节点缓存命中与内存。

验收：

- 结果与 SQL 版本逐 id、逐 weight 一致；
- 图更新后不返回旧邻居；
- fallback p95 下降，固定 40 条 0 flip。

### 4.2 exact evidence 索引

`findExactRecallEvidence` 对每个非 inject 轮次扫描全库 metadata：

- 当前 17k entries / 约 180k cue anchors；
- warm 单次几十 ms，冷启更高。

可行：

1. 以 `searchVersion` 缓存 normalized title map；
2. 缓存 cue → entry/DF；
3. 用 Aho-Corasick 或受限 n-gram 查找 contained cue；
4. exact title/identifier 先走 O(1) map，命中后不必扫全部 cue；
5. 索引失效与 harmonic index 同版本。

验收：

- 对现有 exact-evidence 测试逐查询结果完全相同；
- 新索引在 title/cue 变更后失效；
- 非 inject 长 query 的 exact 阶段从几十 ms 降到个位数。

### 4.3 动态 query expansion

当前 `expandQuery` 最多 4 个 secondary pass。优化方向：

- base 已经有足够候选且 top-1 明显领先时，只跑 0–1 个 expansion；
- base 候选不足、没有 identifier 命中时才扩展到 2–4；
- 用 deadline remaining 决定还能跑几个；
- 每次 expansion 都复用 postings cache，不再重复扫描。

风险：expansion 是 implicit 召回信号，不能仅凭速度砍掉。必须离线 paired 40 条 + session-shaped eval 证明 0 flip 或收益。

### 4.4 启动 prewarm

冷启动首个 recall 曾到 1.5–1.7s；当前也有 cold 400ms。

在 HTTP ready 后 idle 阶段预热：

- tokenize 一次示例 query，构建 postings；
- 读一批高 degree graph nodes 建立 neighbor cache；
- 预热 exact title/cue map；
- 预热 reranker 仅在后台 snapshot 路径，不占边界。

不要阻塞 boot；失败 fail-open。

## 5. P2：提高 snapshot 覆盖率

### 5.1 assistant 结束后的刷新

当前只在用户输入后构建，导致 snapshot 不包含刚生成的 assistant 回答。

建议：

- gateway 收到 `assistant_reply`（或 session idle 的最终 assistant）后，同样调用 `scheduleSnapshotRefresh`；
- 继续使用 2s debounce，按 session 合并；
- assistant 刷新时带上 `lastTurnId`，丢弃乱序的旧构建；
- 不在 reasoning/tool_result 上触发。

收益：

- snapshot 查询变成“用户问题 + 刚完成的回答”，更接近下一轮追问；
- builtAt 更接近下一次使用；
- 对 10 分钟 stale 无根治，但降低 topic-shift 和旧上下文概率。

### 5.2 双版本 snapshot

单一“最近4轮/600字”窗口可能既太长又太散。建议每个 session 存两个 query fingerprint：

1. **last-pair**：最后一条 user + assistant，用于直接追问；
2. **rolling-window**：最近4轮，用于延续话题。

各自预计算 block；serve 时选 containment 更高的版本。若两个都不过阈值，fallback。

成本：

- 后台多一次检索/rerank；
- 可通过共享候选池、只对 top candidates 分开 verify 控制；
- 不在边界路径增加模型调用。

实验前先测当前查不到的原因是“窗口太散”还是“确实换题”。用 shadow 记录双版本 would-use，不先上线。

### 5.3 自适应 TTL / stale-while-revalidate

日志显示 stale 中 73/243 containment ≥0.25；简单把 TTL 从10min 提到30min，最多回收约12%全部请求，但会服务旧内容。

更稳的分层：

- `age ≤10min`：正常 serve；
- `10–30min` 且 containment≥0.5：serve，日志标记 `ageBand=warm`；
- `10–30min` 且 0.25≤containment<0.5：shadow only，比较 live 结果；
- `>30min`：fallback；
- 若 session 有明确 topic 变更/新 episode：立即失效。

不要仅延长 TTL 而不加内容版本/话题校验。

### 5.4 短指代特例

topic-shift 中只有 18/144 是 <50 字符，所以特例只能贡献小头，不能作为主方案。

可以额外允许：

- “继续/然后呢/这个/那个”且最近 TTL 内有 snapshot；
- topic state 未变化；
- 没有新实体/新文件路径。

但这属于行为语义改动，需要 session-shaped eval 和 false-injection 控制，优先级低于前两项。

## 6. P3：后台构建与 deadline-aware

### 6.1 snapshot build 阶段化

当前 build p95 6s，且它在 Node 主线程里做部分同步 BM25/SQLite 工作，可能与 fallback 争抢事件循环。

先记录：

```text
window_ms, search_ms, dense_ms, t1_ms, episodes_ms,
rerank_ms, render_ms, total_ms, queue_wait_ms
```

然后选择：

- 只把 T1/dense/episodes 作为可延迟增强，先存 harmonic snapshot；
- 把后台构建移到 worker thread / child process（读索引快照）；
- 对同步 SQL/CPU 进行分块 yield；
- 保持“每个 session 同时只有一个 build”。

目标不是让 build 更快，而是让它**不拖慢边界 fallback**。

### 6.2 Deadline-aware fallback

由客户端传 `deadlineMs`，服务端维护 deadline：

1. 必做：base BM25 + FOK + lexical support；
2. 可选：graph expansion、secondary expansion、exact evidence、neighbors；
3. 剩余预算不足时跳过可选阶段，返回仍然通过质量门的候选；
4. 无法在 deadline 前完成质量门时，fail-open 到 topic/note-board，不展示低置信本体。

这样 p95 是设计出来的，不是靠“通常够快”。

## 7. P4：是否放宽 100ms

如果 P1–P3 后 fallback p95 仍在 120–150ms，有两个选择：

- 继续架构优化；
- 把插件 deadline 改为150ms，并明确接受 TTFT 增加。

行业公开记忆检索 p95 约 155–200ms，100ms 是较严格目标；但 MAFW 的自动注入是在模型首 token 前，不能直接按“普通搜索 API”放宽。

建议：

- 不全局放宽；
- 若放宽，只对 cold/first-turn fallback 放宽到150ms，snapshot serve 仍保持20ms；
- 单独统计慢路径的命中收益，证明多等50ms换回了有价值的记忆。

## 8. 推荐实施顺序与验收

### Step 0：观测与 session eval

- 新增 stage histogram、abort/visible 指标、session-shaped 20–50 cases；
- 不改召回行为。

Gate：能输出按 route、topic、query 长度的 p50/p95/p99 与真实可见率。

### Step 1：exact evidence 索引

- 结果必须逐查询一致；
- 只改确定性 metadata 扫描。

Gate：exact 阶段 p95 降低 ≥50%，固定40条 0 flip。

### Step 2：图邻接缓存

- 先 LRU，再决定全量 adjacency；
- 每个变更路径有失效测试。

Gate：fallback p95 降低 ≥20%，图结果一致，内存可接受。

### Step 3：assistant_reply 刷新 snapshot

- 单独开关，按 session 合并；
- shadow 观察 serve ratio/topic-shift/错误注入。

Gate：热会话 continue serve 提升；false=0、stale=0；build 不堆积。

### Step 4：动态 expansion 预算

- 只在 base 候选充足时跳过；
- paired 40 + session eval 0 flip。

Gate：长 query fallback p95 ≤100ms 或显著下降。

### Step 5：双版本 snapshot / 自适应 TTL

- 先 shadow would-use；
- 再小流量 enable；
- 任何同域错误展示立即回滚。

Gate：热会话同话题 serve ≥90%；所有请求 serve ≥40–60%；质量不低于 live fallback。

### Step 6：后台隔离/worker

只有 Step 1–5 后仍出现 build 与 fallback 争抢时再做。

## 9. 外部证据

- **Predictive prefetching for RAG**（ICML 2026）：预测下一步检索并预取，报告最多 43.5% E2E 延迟下降、62.4% TTFT 改善；同步 fallback 保留为底线。  
  https://arxiv.org/abs/2605.17989
- **RaLMSpec**：speculative retrieval + batched verification，迭代 RAG 提升 1.31–2.39×。  
  https://proceedings.mlr.press/v235/zhang24cq.html
- **Zep / Konig**：hot graph 使用 RAM adjacency lists + CSR，vector/BM25/graph 统一检索；p95 retrieval <100ms，完整 retrieval <200ms。  
  https://www.getzep.com/blog/why-we-built-a-graph-database-service-for-agent-memory/
- **Zep scaling**：拆分 vector/BM25 与 graph 服务，图搜索 p95 从600ms降到150ms，完整 context retrieval p95约200ms。  
  https://www.getzep.com/blog/scaling-agent-memory-zep-30x/
- **Anyscale production RAG**：多级缓存、prefix caching、adaptive TTL、event-driven invalidation、versioned cache keys。  
  https://docs.anyscale.com/rag/production-scalability
- **Proximity approximate cache**：LSH 缓存相似 query 的检索结果，数据库调用减少78.9%，缓存查找约4.8µs；但必须控制相似度容差和错误复用。  
  https://arxiv.org/html/2503.05530v2
- **NN/g / RAIL**：100ms 直接操作阈值、1s 思路连续阈值。  
  https://www.nngroup.com/articles/response-times-3-important-limits/  
  https://web.dev/articles/rail

## 10. 明确不做

- 不把低置信记忆重新自动展示；
- 不在固定 40 条上追求无法反映 snapshot 的提升；
- 不用简单 sleep/重试或单次抖动证明性能；
- 不为了 p95 牺牲图召回、FOK 或 lexical veto 而不做 paired 质量门。
