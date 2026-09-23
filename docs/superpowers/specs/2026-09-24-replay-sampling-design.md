# 回放采样 + 簇级交错（Replay Sampling & Cluster Interleaving）：脑式重构 S2

> 日期：2026-09-24 · 状态：设计待审
> 范围：把 turn_pipeline 的「dump 全部回合 + 扁平 top-5 旧记忆」改为**优先采样 + 簇级交错回放**
> 依据：`docs/research/2026-09-23-brain-vs-ai-memory-survey.md` §1.2F（SPW-R 回放：优先采样、压缩、交错、gist）、§4（系统巩固=最大架构缺口）、CLS `McClelland 1995`
> 相关：`2026-09-24-write-time-routing-design.md`（S1，整合的执行侧）、`2026-09-23-consolidation-replay-design.md`（P1 回放雏形）

## 1. 背景与诊断

### 1.1 现状
`TurnPipeline.runSession`（`gateway/src/recall/turn-pipeline.ts`）：
- 把**本小时全部完成回合**拼成一个 transcript（cap 40k 字符，`capTranscript`），**无优先级**；
- `sessionContext` 取本会话最近 10 条 episodic 摘要；
- `priorKnowledgeFor` 取跨会话 **top-5 扁平**旧记忆（`replayK=5`，`replayMaxChars=1500`），只排除本会话/episodic/superseded。

### 1.2 脑对照缺口
| 大脑回放 | 现状 | 缺口 |
|---|---|---|
| **优先采样**（salience/奖赏/新颖，非均匀） | 全量 dump，无优先级 | ❌ |
| **交错**（新旧交替，训练慢层） | 旧记忆以扁平列表附在尾部 | ◐（有但弱） |
| **gist 整合**（输出统计结构） | 让 worker 自由抽取 | ◐（S1 补执行侧） |
| **压缩**（10–20×） | 字符 cap（粗暴） | ◐ |
| **图式**（挂接既有结构） | 无"簇/图式"概念 | ❌ |

**核心缺口**：现状把旧记忆当"参考列表"，而非"要被整合进的结构"。worker 看到 5 条孤立旧记忆，倾向**新建**而非**整合**（→ 21.5% 碎片）。回放应呈现**既有 schema 簇**，诱导整合。

## 2. 目标 / 非目标

**目标**
1. **优先采样**：按 `salience × novelty × recency` 采样回合与旧记忆，而非全量/均匀。
2. **簇级交错**：把既有 semantic 记忆按嵌入聚类，取相关簇的**代表（schema）**与新回合**交错**注入。
3. 预算化（chars），低优先级不丢（归档保留），只是不进本轮 prompt。

**非目标**
- 不改归档语义（`t1_archive` 仍全量保留）。
- 不引入 LLM 做聚类/采样（确定性 + 嵌入）。
- 不做编码门控打标（S3）、不做再巩固（S5）。

## 3. 设计

### 3.1 优先采样
为每个已完成回合计算 `replayPriority`：
```
priority = salience(obs) × (1 + novelty) × recencyDecay(ageHours)
```
- `salience(obs)`：来自 S3 的观测显著度（S3 未落地前回退：正则情绪 + 长度启发式）。
- `novelty`：该回合嵌入与"本会话近期回合质心"的 1 − cos。
- `recencyDecay = exp(−ageHours / τ)`（τ 默认 24h）。
- 按 priority 降序填充 transcript 预算（`transcriptMaxChars`），替换现有"按时间全量"。

### 3.2 簇级交错（schema replay）
- **簇来源**：对既有 `type=semantic` 条目做嵌入聚类（离线增量：新写入归入最近簇或开新簇；阈值 cos≥0.85，与 S1 的 θ_cand 对齐）。
- **相关簇选择**：以 transcript 的嵌入质心检索最相关的 top-N 簇（N 默认 3）。
- **簇代表**：每簇取 `energy × salience` 最高者为代表，附 `[schema:<clusterId>] id: <代表id> 成员数:<n>`。
- **交错渲染**：prompt 中把「新回合块」与「相关 schema 块」**交替**呈现（而非"新在前、旧在尾"），并在指令中要求：**优先把新信息整合进匹配的 schema 簇（UPDATE 代表）**，仅当无匹配簇才新建。与 S1 路由形成"引导（S2）+ 强制（S1）"双保险。

### 3.3 预算与降级
- 总预算 `transcriptMaxChars`；schema 块预算 `replayMaxChars`（默认 1500，可调）。
- 簇检索失败/嵌入不可用 → 回退现状（`priorKnowledgeFor` top-5）。fail-open。

## 4. 测试与验收

- **单测** `replay-sampling.test.ts`：priority 公式排序、预算截断、recency 衰减边界、空输入。
- **单测** `cluster-replay.test.ts`：簇归属（增量归入/开新簇）、代表选择、相关簇 top-N、交错渲染顺序。
- **集成**：构造同主题多回合 → 采样优先高显著；构造既有 schema 簇 + 相关新回合 → prompt 含 schema 块且指令为"整合"。
- **回归**：turn_pipeline 现有测试全绿；`capTranscript` 语义不变。
- **验收**：同主题会话产出的**新建条目数下降**（因整合进 schema）；`replayK` 语义由"扁平条数"升级为"相关簇数"。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| 采样漏掉关键回合 | 归档保留 + 低优先级下轮可采；priority 下限保底 |
| 聚类漂移 / 簇爆炸 | 固定阈值 + 代表制 + 簇上限；离线可重建 |
| 交错增加 prompt 复杂度 → worker 更慢 | 预算 cap；指令精简（与 S1 的 prompt 收敛协同） |
| 依赖 S3 显著度 | S3 未落地时回退启发式，不阻塞 |

## 6. 涉及文件

- 新增：`gateway/src/recall/replay-sampling.ts`（priority 纯函数）、`gateway/src/memory/schema-clusters.ts`（嵌入聚类 + 代表）
- 修改：`gateway/src/recall/turn-pipeline.ts`（采样 + 交错渲染 + 指令）、`gateway/src/config.ts`（τ、簇阈值、topN、schema 预算）
- 测试：`gateway/tests/unit/replay-sampling.test.ts`、`schema-clusters.test.ts` + turn-pipeline 集成回归

## 7. 依赖与分解

- **依赖 S3**（显著度打标）以获得 `salience(obs)`；未落地时回退启发式。
- **与 S1 协同**：S2 引导整合，S1 强制整合。建议顺序 S1 → S3 → S2。
