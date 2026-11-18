# 2026-11-18 · Auto Recall 与 MCP 注入分叉排查

## 范围

只读排查，未改生产代码、配置或记忆数据。实现/排查子代理：`gateway/volcengine/deepseek-v4.1-flash`；父会话复核关键路由、FOK 与 T1 读取代码。

前置版本：图扩展通道修复 `465a97926`，交付文档 `bacec48f3`，gateway `pid=45196`。

## 现象

同一 session（`ses_e7444718cffeVJ3eJOTAReq8F0`）重复调用结果稳定：

| query | REST / MCP | 边界实时 FOK | 最终 auto recall |
|---|---|---|---|
| `5cd9885f5` | 有相关候选；MCP `inject`, top1prob≈0.9909 | ratio≈1.051 → `no-memory` | `相关记忆：无` |
| `Proactive Topic Recall 主题工具设计` | 相关目标可检索；MCP `inject`, top1prob≈0.9930 | ratio≈1.309 → `low-confidence` | `相关记忆：无` |
| `检索路径 parity 修复上线与质量缺口` | REST/MCP 目标 rank 1 | ratio≈2.065 → `inject` | 目标第一条，尾部有弱相关邻居 |
| 冰岛消费无答案查询 | MCP `no-memory` | ratio≈1.104 → `no-memory` | `相关记忆：无`（正确） |

对 `5cd9885f5`，边界路径实际已生成 3 条候选和完整 recall 本体；目标不是检索不到，而是在路由出口被抑制。

## 主因 R1：边界 FOK 与 MCP 使用不同证据

- `gateway/src/routes/recall.ts:257-270`：边界先检索，再调用 `computeRecallFokZone`。
- `gateway/src/recall/recall-context.ts:269-279`：该门只读取 `index.bm25RawScores(query, 10)`，使用 top1/mean 比值；不读取最终展示候选的归一化分数，也不读取 graph/dense/scan/reranker 证据。
- MCP `gateway/src/mcp/handlers/search-hybrid.ts` 与 snapshot verify 使用 cross-encoder `rerankDetailed` 概率和 `probHigh/probLow`。
- 因此同一 query 可以同时得到边界 `no-memory/low-confidence` 与 MCP `inject`。多条同长度精确命中会压平 top1/mean，比值尤其容易误判。

文档既有校准也说明比值是弱特征（AUROC 0.582，概率 0.782），不能将两套阈值混用。

## 主因 R2：出口策略把非 inject 都呈现为“无”

- `gateway/src/recall/topic-recall.ts:8-15`：`hasRelatedRecallBody` 只在 `inject` 时返回 true。
- `gateway/src/routes/recall.ts:311-327`：非 inject 时 `relatedBody=null`，最终只剩主题头 `相关记忆：无`。

这不是候选被渲染器删除；`formatRecallContext` 已生成候选本体，删除发生在 route 出口。

该抑制是既有有意策略，必须继续满足：

- `no-memory` / `low-confidence` 不重新注入旧 recall 本体。
- 不能通过简单降低阈值或一律展示 low-confidence 候选来“修复”，否则会重新引入低置信噪声。
- 当前文案无法区分“确定无记忆”和“有候选但低置信被抑制”；可以改进状态说明，但不等于放本体。

## 主因 R3：snapshot 查询窗口在压缩后塌缩

- `gateway/src/kernel.ts:2679-2686`：`recentTurnTexts` 使用 `db.listTurns()` + `db.readTurn()`。
- `gateway/src/memory/gateway-db.ts:1221-1243`：这两个方法只读 `t1_observations` 热表。
- 当前会话大量近期 turn 已在 `t1_archive`，热表只剩极少行；snapshot query 因而塌成最新短指令“排查一下”，snapshot 自身 `top1prob≈0.168 / no-memory`，无法被 route 采用，只能回退到 R1 的实时比值门。
- 数据层已有 `readTurnRows()`（`gateway-db.ts:1440`），可读 active+archive；snapshot 窗口没有使用它。

这解释的是**真实自动回合为什么拿不到较好的 snapshot reranker 概率**，与 R1 是相互叠加的独立问题。

## 其他独立因素

### R4：边界候选池较小

边界 `topK=3`，`searchRecallMemories` 初始取 `topK*2=6`；MCP 默认候选池更大并 rerank。旧精确标题的某个目标在 BM25 中约 rank 10，可能根本进不了边界 6 条池。它不是本次 `5cd9885f5` 误抑制的主因，但会影响自然语言标题命中。

### R5：尾部弱相关来自候选与邻居呈现

新精确标题已经 `inject` 且目标第一，尾部弱相关包括 BM25 第 2–3 名和 `temporalNeighbors.presentation` 追加的 `↳` 邻居。与 FOK 误判不同源，应通过固定查询集评估候选与呈现策略，不能用放宽/收紧 FOK 代替。

### R6：FOK 观测混合构建与真实注入

snapshot build 与 snapshot served 都写 `inj` 样本，`fok.injections/hitRate` 不是纯真实注入指标。后续阈值校准前需先拆分事件类型。

### R7：100ms 契约存在独立风险

子代理只读统计近期 `[Recall] timing`：search p50≈258ms、p90≈818ms；本次探针约 152–294ms。插件客户端有 100ms abort。即使准入修复，若真实回合超时，仍可能整块看不到。该问题需独立性能切片，不与 FOK 逻辑混改。

## 已排除

- 不是图扩展双计分残留：`465a97926` 后候选与分布正常。
- 不是 `formatRecallContext` 删除候选：删除发生在 route 出口。
- 不是 reranker 概率数组错位：MCP 与 snapshot verify 概率复算一致。
- 不是 `searchRecallMemoriesSync` 缺 cue anchors：该函数不在当前 `/api/recall/context` 消费路径。
- scan containment 会拒绝显式 query 与短 snapshot 的不匹配，但当前 snapshot 自身也为 `no-memory`；不是最后一道直接抑制门。

## 推荐修复顺序（尚未实施）

### P1：确定性精确证据准入，而非全局放宽 FOK

为 active 候选的精确 title / cue-anchor / identifier 证据增加独立 admission guard；只有外部确定性证据成立时才允许绕过失真的比值低 FOK。不得让 superseded 候选获得准入，不得把普通低置信候选重新注入。

必须先写的测试：

1. 多条同强度候选导致 ratio 平坦，但 active 候选含查询中的精确 identifier/cue → 允许精确目标进入，当前应为 RED。
2. 精确 title 命中同样可准入；部分词面重叠或普通高 BM25 不得自动等价于精确证据。
3. 冰岛式无答案查询保持 `no-memory` 且无 recall 本体。
4. 非精确证据的 `low-confidence` 继续抑制，不改变既有策略。
5. superseded / retracted 精确命中不得准入；若有 active supersede 链头，只评估有效链头。
6. note-board 仍独立 must-surface，不计入相关记忆准入。

### P2：snapshot 读取 active+archive

让 `recentTurnTexts` 使用能读取归档的 turn 列表/行 primitive，保证压缩后仍构造真实滚动窗口。

必须先写：早期 turn 归档后，`recentTurnTexts(sid, N)` 仍返回最近 N 轮 user/assistant 文本，而不是只剩热表短指令。

### P3：先测性能，再决定边界内允许的工作

建立真实 16k corpus + graph 的 endpoint 性能基线与 p95 门禁。任何精确准入实现都必须维持 100ms 契约，必要时利用已有后台 snapshot，而非在边界新增 reranker。

### P4：修正观测后再校准

区分 `snapshot_build` 与真实 `injection` 事件；之后才能用 FOK samples 衡量 zone 分布和准入修复效果。固定 40 条综合查询继续评估 hit@1/3、false-injection、stale-injection 与 entrypoint agreement。

## 结论

当前问题不是“记忆库没有内容”，而是：

1. 实时边界用弱 BM25 比值否掉了 cross-encoder 已确认的相关候选；
2. snapshot 因只读热表失去真实上下文，无法提供较好的后台概率；
3. 出口按既定策略抑制非 inject 本体。

正确下一步是**精确证据准入 + snapshot 完整窗口 + 性能验证**，不是简单降低阈值或重新放出所有低置信旧记忆。
