# MAFW 谐波记忆系统全路径逻辑（代码级）

2026-10-13 · 本文以**当前代码为准**（file:line 均为写作时行号），是端到端运行逻辑的单一索引。
与 AGENTS.md 的出入集中在 §9（AGENTS.md 有多处已过期描述）。
目标架构/未来项见 `docs/research/2026-10-10-memory-target-architecture.md`（本文只写已落地）。

## 0. 总览：三层

```
① T1 观察层（机械、无 LLM）      t1_observations → t1_archive          ← 原始证据，永久可检
② 谐波存储层（文本条目）          OKF md + .harmonic_index.json + 向量    ← semantic/episodic/procedural/global/knowledge
③ 判定层（无存储）                salience / novelty / need / laya / reranker / LLM 判官
```

关键不变量：
- **write 只落盘**（不算 salience、不合并）——`harmonic-file-store.ts:59-169`，MinHash 合并已退役（`:86-92`）
- **检索出口单点撤销 superseded**——`harmonic-index.ts:507-509`
- **worker 输出永不回流 T1**——`index.ts:6290-6296` + `internalSessionRoles`
- 全链 fail-open：任一步失败退化为"更少但正确"（BM25-only / 跳过 / 归档不重试）

## 1. 写入路径

### 1.1 入口全集

| 入口 | 位置 | 特有参数 |
|---|---|---|
| HTTP `POST /api/memory/add` | `index.ts:7125-7245` | `pinned/sticky/stickyDays/importance/authority/sessionID/supersedes`(**单串**)`/novelty` |
| MCP `mafw_add_memory` | `mcp/handlers/add-memory.ts:26-148` | `supersedes[]`(**数组**)、schemaFastPath energy、无 pinned |
| 插件工具 `mafw_add_memory` | `src/tools/add-memory.ts:27-73` | **HTTP 直连**（serve worker 无 MCP） |
| pi host 扩展 | `runtime/pi/pi-mafw-host-extension.ts:109-120` | 同上（HTTP） |
| 内部写者 | turnCompress worker（经 HTTP/MCP）、reflection(`reflection.ts:370-391`)、A2 promote/reject(`:253-273`)、reconsolidate(`index.ts:2302-2318`)、grace(`grace-revisit.ts:95-152`)、consolidation UPDATE(`consolidation-service.ts:357-380`)、skill-install(`skill-install.ts:14-35`)、constraints 迁移(`constraints-migrate.ts:51-73`)、merge-memory(`mcp/handlers/merge-memory.ts`) |
| 非谐波 | `/api/obs/capture` → `t1_observations`（§2.1） |

### 1.2 `HarmonicUnitFileStore.write()` 流水（`harmonic-file-store.ts:59-169`）

1. `cue_anchors` 空 → `extractAnchors(primary_abstraction)`（`:64-66`）
2. **标识符收割**：`harvestIdentifierCues`（`cue-harvest.ts:29-52`），`config.memory.harvestIdentifierCues` 默认 true、预算 `harvestMaxCues`=8（`:70-79`）
3. per-baseDir 串行 `WriteQueue`（`:80`）
4. ~~MinHash 合并~~ **已退役**（`:86-92`，`skipMerge` 为 no-op）
5. `writeOKFFile`（`okf-writer.ts:53-64`）→ `memory/concepts/{type|knowledge}/`；frontmatter 白名单 `okf-writer.ts:7-26`
6. `indexManager.addEntry`（`harmonic-index.ts:250-293`）；`filePath` 相对 `~/.mafw`
7. 锚点图 / 共激活图 upsert（`:130-135`）+ `[[link]]` 边（`:142-146`）
8. **`onMemoryWritten` 监听链**（`:163-166`，逐 cb try/catch）：dense 嵌入索引、`consolidationService.enqueue`、GLiNER 实体收割（**默认关**，`config.recall.entityHarvest=false`）——接线 `index.ts:2855-2870`

> **salience 不在 write 计算**：由入口算好传入——`judgeSalience`/`importanceToSalience`（`salience-perceptor.ts` + `judge/salience.ts:29-44`），入口 `index.ts:7170-7172` / `add-memory.ts:77-79`。

### 1.3 三层去重

| 层 | 实现 | 行为 |
|---|---|---|
| L1 写时 exact-hash | `dedup-guard.ts:75-95`；**仅 HTTP 调用**（`index.ts:7140-7145`） | SHA1(content) LRU 10000；命中 `{deduped:true,reason:'exact-hash'}` |
| L2 读时近重折叠 | `harmonic-index.ts:511-523`（`dedup-guard.ts:40-62`） | cos≥0.92 或 token-Jaccard≥0.8，top-30 内折；`memory.dedup.readCollapse` 默认 true |
| L3 巩固层语义合并 | `consolidation-service.ts` + 写相路由 §1.4 | cos≥0.8 召回 + laya/LLM 判定 |

`MinHashMerger`（`minhash-merger.ts`）**仍存在但写路径无消费者**；仅跨 worktree 融合用其 `generateSignature/similarity`（阈值 0.6，`merge-memory.ts:64`）。

### 1.4 写相路由（`memory/route-write.ts`）

装配：`setRouteWriteDeps`（`index.ts:2894-2932`，需 embedding runtime）；缺 deps → 各入口回退裸 `store.write`。

`decideRouting`（`:89-178`）顺序：向量补齐 → 候选召回(θcand 0.8/θdup 0.95/max 3，滤 superseded) → 近似相同+abstraction 精确相等 → `skip` → **G2 laya redundant 门**（`tauRedundantHigh` 默认 1.0 = observe-only）→ LLM 判官 `create/update/separate`（异常 fail-open→create）。

`routeAndWrite`（`:213-288`）落盘效果：
- `skip` 不落盘；`redundant` → energy 0.05 + `redundant:<id>` 锚 + 覆盖条目记 retrieval event（`:223-241`）
- `create` → store.write；`separate` → 追加区分锚 + `distinct_from`（**已持久化**：OKF 白名单 + index entry；consolidation 候选池双向尊重，2026-10-13 修复）
- `update` → memory_value 合并 + `merged_from` + `higherAuthority` + energy `min(1,+0.15)` + `markSuperseded(target)` + 删旧向量 + consume labile 窗（`:263-287`）

### 1.5 字段写时默认

`pinned`(仅 HTTP true/undefined)、`sticky`(true→`stickyDays>0?:7`)、`authority`(`normalizeAuthority`，默认 'agent'，非法报错)、`energy`(HTTP 0.8 / MCP schemaFastPath 0.8~0.95)、`supersedes`(energy 继承 `max`，仅 create 后 `markSuperseded`)、`capTentativeEnergy`(≤0.35, `turn-pipeline.ts:76-81`)、`capCommitment`(≤0.6, `commitment.ts:21-30`)、`source_session_id`(worker-origin 解析回源 session, `index.ts:7193-7195`)。

## 2. 观察 → 巩固路径

### 2.1 T1 捕获

插件 hook（`src/plugin.ts:98-123`）：`chat.message`→`user_input`、`tool.execute.after`→`tool_result`、`experimental.text.complete`→`assistant_reply`、`session.next.reasoning.ended`→`reasoning`、`session.next.tool.failed`→`tool_result(failure)`；经 `pushObservation`（`src/utils/obs-capture.ts:12-32`，5s 超时 fail-open）。

Gateway `POST /api/obs/capture`（`index.ts:6262-6358`）：
递归护栏 A（内部会话拒收 `:6290-6296`）→ 护栏 B（worker prompt 特征拒收 `:6297-6304`）→ turnID（user_input 自增，其余取当前 `:6305`）→ `redactSecrets`（`redact.ts:39-52`）→ `t1_observations` append（UNIQUE 去重，`gateway-db.ts:348-356`）→ t1 向量索引 → user_input 时 `scanService.prefetch` + R8 快照调度 + 消费 `dream-queries`（`:6332-6346`）。

### 2.2 turnCompress（`0 * * * *`，`pipeline-rules.ts:9`）

`TurnPipeline.runOnce`（`turn-pipeline.ts:257-281`）→ `completeTurns`（`turn-completion.ts:40-50`）→ per-session `runSession`（`:288-426`）：
budget gate(`extract`) → 按 `obs.salience+ageHours` priority 采样（cap `transcriptMaxChars` 40000）→ transcript（USER/THINKING/TOOL/ASSISTANT）→ **S2 schema interleave** → prompt 拼接（base+schema+prior+grade+eventSeg）→ 持久 worker session（`SessionWorkerPool`，TTL 24h，`maxSessions` 64，`runExclusive` 互斥）→ `worker.prompt(..., TOOL_EXTRACTION_SYSTEM, workerModel, 'memory-curator')`。

- **worker 自主调 `mafw_add_memory`**（gateway 不解析输出）；工具白名单只读+3 记忆工具，`edit/bash` deny（`skills/memory-curator-agent.ts:5-23,49`）
- **B1 交错回放**（`:203-238`）：`replayPriorityForMemory = (1+ln(1+need))·salience/max(0.2,energy)`；48h `last_replayed` 排除窗；池全排除回填；`stampReplayed` 盖戳
- **gradeFor（D）**：goal_outcomes 成败信号进 prompt
- **一律归档**：`archiveTurn` 循环（`:417-423`），失败不重试；`[NOOP]` 记 `t1_noop_log`

### 2.3 reflection（`0 3 * * *`，`pipeline-rules.ts:10`）

`reflectSession`（`reflection.ts:288-442`）：QUESTIONS 生成问题 → 检索证据（bm25+可选 dense RRF）→ 机械 `extractEntities` → **A4 selection feedback**（既有 insights 的 7 天 need 命中，`selectionFeedbackBlock`）→ REFLECT 蒸馏 insights（category ∈ failure/correction/insight/preference/convention/tool-quirk）→ `buildInsightUnit`（锚加 `cat:<category>`，`authority:'pipeline'`）→ `capCommitment` → `routeAndWrite` → 游标 `markReflected`。

同趟：**A2** tentative 裁决（promote→去 tentative+`verified:`+energy 0.7；reject→0.05+`rejected`）、**D1b** 源 episode 降能（factor 0.3，非 supersede）、**A5** `stampDistilled` 直写 OKF。

**V2⑤ grace-revisit**（同 cron，`grace-revisit.ts`）：≤48h semantic/procedural + PE 门 → keep/update/merge/demote 四值；`mode` 默认 `shadow`（只记 verdict）；`live` 且非 user 权威才执行。

### 2.4 其余管线（cron 均 UTC，`pipeline-rules.ts`）

| 管线 | cron | 核心 | 落盘 |
|---|---|---|---|
| stale-verify | `0 4 * * 0` | top-10（龄≥14 天、review 间隔≥21 天、energy×salience）worker 只读探测 | 矛盾→supersedes；全候选 `stampReview` |
| reconsolidate (D2) | `30 4 * * *` | labile 队列（24h TTL，feedback/update 触发）+ newer related + PE 门 | rewrite→新条目+supersede+`reconsolidated` 锚；每 id 只消费一次 |
| dream-prefetch (D4a) | `0 2 * * *` | 近 24h 活跃 session ≤5，生成 ≤3 条"下次可能问" | kv `dream-queries`（user_input 时一次性消费） |
| axiom-distill (A1) | `0 6 * * 0` | ≥14 天 + need>0 semantic，取 20，需 ≥3 源 | **triage 草稿**（`summary.axiomDraft`，确认后 L5Store） |
| skill-promotion (W2) | `0 5 * * 0` | 六闸门（need7d≥3 / energy≥0.5 / 一致映射 / verified 锚 / 稳定≥7 天 / 数量<30 / 权威 G6）零 LLM | `skill-staging/<name>/SKILL.md` + triage 草稿；安装后源记忆改指针 |

### 2.5 护栏

- `PipelineHeartbeat`（`pipeline-heartbeat.ts`）：每管线 `record`，`stale = age > 2×interval`；30min `sweep` 告警；`/api/memory/stats.pipelines`
- `PipelineBudget`（`pipeline-budget.ts`）：`recall.pipelineBudgetUsdPerDay`（默认 0=无限）门控 extract/reflect/review/reconsolidate/index-scan/dream/axiomDistill/consolidation 判官；laya（本地）与 decay 不受控
- `PipelineGuard`（`pipeline-guard.ts`）：同名互斥 + 30min watchdog
- worker 会话：TTL/上限驱动 dispose；失败 dispose 重建；`workerCompactIdleMs`(8h) 空闲先 `session.summarize` 再续用

## 3. 读路径

### 3.1 边界 recall（每轮 LLM 前）

插件 `session-recall.ts`：游标增量（TtlMap 24h）→ `buildQuery`（≤500 字符）→ **短增量回退**（增量<50 字符时拼 assistant 尾 300 字符，`session-recall.ts:55-64`）→ `fetchRecall`（**100ms abort + fail-open**，`:66-83`）→ 注入 `{type:'text', synthetic:true}` 进最后一条真实 user 消息 parts（`:108-115`）。

Gateway `GET /api/recall/context`（`index.ts:5993-6193`）分支：
goal 快照（仅 manager session）→ **note-board** → 空 query 提前返回 → **快照命中 vs 实时**（`config.search.snapshot.enabled` **默认 false**）→ 实时：`scanSnapshot` + （`boundaryDense` 默认 false）+ `searchRecallMemories` + `computeRecallFokZone` + **G4 arbiter**（`search.arbiter` 默认 true，annotate-only）+ 记 retrieval event → R6 邻居呈现（默认 false）→ `formatRecallContext` → 拼 `[pointers, noteBoard, goalSnap]`。

### 3.2 R8 快照

构建（`index.ts:1900-2047`）：user_input 防抖 2s，**全局串行**；滚动窗口（4 轮/600 字符，`recall-snapshot.ts:72-92`）→ hybrid（BM25+dense RRF）→ `rerankDetailed`（R3+R5 一次出排序+概率）→ 邻居 → 渲染 → kv `recall-snapshot`；命中判定 `decideSnapshotUse`（TTL 10min + **containment=inter/min** ≥0.25，`:136-150`）。

### 3.3 `searchScored()`（`harmonic-index.ts:316-567`）执行序

检索器分派（bm25 默认/guided/token）→ **多跳扩展**（`:340-354`，score×0.4）→ **dense RRF**（`denseScores` 时，`:359-371`，k=60）→ channelSplit（类型 RRF，默认 on）→ **图扩展/PPR**（`diffusion.enabled` 默认 on：`alpha 0.85/iter 15`，**Hebbian needModulation** 默认 on，**hubFloor 50**）→ **时间锚定 ×1.5**（`time-anchor.ts`）→ heuristic reranker（默认 off）→ **`resolveSupersededHeads`（唯一出口点，maxDepth 5，悬空/成环丢弃）** → **读时近重折叠** → cutoffRatio → R6 检索层邻居（默认 off）→ slice topK → hook。

BM25：k1=1.2/b=0.75；searchable=abstraction+anchors；**tokenCache 词频表**（`:712-726`）；**R7 标识符拆词**（camelCase/snake_case 部件，`tokenizeBM25:771-788`）；`score = bm25 × energy × salience × (superseded?0.5) × (merged?0.8)`。

### 3.4 R3 / R5

- 重排：`HeuristicReranker`/`CrossEncoder`/`LlamaCppReranker`（`reranker.ts:195-208`），单例 `reranker-singleton.ts`；`rerankDetailed` 一次出排序+概率；接线：快照 `verify`、`search-hybrid.ts:121-151`
- FOK **两套阈值不可混用**（`fok-gate.ts`）：分数比（`low/high`）仅边界实时路径；概率（`probLow 0.2/probHigh 0.5`）用于快照/显式搜索；行为=**声明不撤回**（`no-memory` 保留候选 + 不臆造提示，`inject-format.ts:126-136`）
- 样本 `logs/fok-samples.jsonl`（`inj` 带 topic / `rdm`）；`fitFokThresholdsByTopic`（minPerTopic 30）→ `byTopic[topic] ?? global`

### 3.5 注入格式（`recall/inject-format.ts`）

`formatRecallContext`（`:180-271`）指针行 `- #mem-<尾6> [date type] "…" (E:x)` + A5 `↳ gist 已蒸馏` + 邻居 `↳` 行（≤4）+ 锚行 ≤5；`formatPinnedProfile`(20/2000, 非 user 加 `[待确认]`)、`formatNoteBoard`(10/**1600**/单条 240)、`formatAgentPriors`(5+5/800)。

注入 hook（`src/plugin.ts:125-137`）：messages.transform → `<recall>`；system.transform 顺序 `<memory-guide>`(静态) → `<user-profile>`(150ms fail-open) → `<agent-priors>`(150ms) → voice-guide。`<note-board>`/`<goal-snapshot>` 由 context 路由追加。

### 3.6 检索结算（ACT-R）

`RetrievalEventBuffer`（环形 5000，need 索引 7 天）→ 三出口登记（边界实时 `index.ts:6152-6158`、快照 serve `:6058-6064`、`search-hybrid.ts:162-165`）→ decay pass 同趟 `drain()` → `actrBonus`（`d=0.5`/offset 24h/`k=0.03`/cap 0.02/曝光>5 折扣）→ bonus 先于衰减应用。

### 3.7 显式出口

`mafw_search_hybrid`（hybrid=BM25+dense RRF；guided 多跳 state 迭代 maxRounds 2；R3+R5）、`/api/memory/search?retriever=`（**不记 retrieval event**）、`mafw_get_memory`（尾 6 位、`rdm` 采样、supersede 链附 latest、C0 源重建）、G4 arbiter（`search.arbiter` 默认 on，annotate-only，samples jsonl）。

## 4. 能量动力学

- **衰减**：`memory-decay` `30 3 * * *`（`automation-engine.ts:148-178`）→ v1→v2 迁移（盖 `last_decay_at`，不补扣）→ 增量（base=`last_decay_at||created_at`）→ 类型速率 `decayRateFor`（episodic 0.010 / semantic 0.005 / procedural 0.003 / global 0.001，`abstraction-level.ts:17-22`）→ **CATD**（`base/(1+β·ln1p(degree))`，`decay.catd` 默认 on，β 0.5）→ `diff>0.005` 才写+盖章 → graduation（48h 升至 0.75）
- **加成**：ACT-R（§3.6）；goal PASS `+0.08`（`goal-reward.ts`，失败不降权）；**`EnergySystem.calculateEnergy` 的事件 delta 只作用于 L3 参数化 store**，不作用于谐波单位（`store.ts:77,91`）
- `markSuperseded`：energy ×0.5（floor 0.1）

## 5. 演化 / 合并

- **P2 consolidation**（`consolidation-service.ts`）：`onMemoryWritten` 触发 → cos≥minCosine 召回 → 候选池滤 superseded/孤儿（H4）→ **laya 三值**（tauHigh 0.99 adopt / tauLow 0 关 / 中间转 LLM）→ 判官 update/separate/create → UPDATE 合入+soft-supersede+删旧向量；审计 `logs/consolidation-pairs.jsonl`（含 `decidedBy`）；`redundant:`/`merged_from` skip
- **跨 worktree**：`mafw_merge_memory`（阈值 0.6，策略 manual/higher_energy/newer，新条目 energy 0.4 + `merged_from`）+ archive-worktree 自动 `mergeMemoryFromWorktree`（跳过 episodic）；`fusion-log.jsonl`

## 6. 披露层

| 层 | 路由/渲染 | 预算 | 语义 |
|---|---|---|---|
| pinned `<user-profile>` | `routes/pinned-recall.ts` / `inject-format.ts:286-302` | 20 / 2000 | 每轮注入，energy×salience 截断 |
| sticky `<note-board>` | `routes/note-board.ts` / `:325-348` | 10 / 1600 / 单条 240 | 到期只下架（本体保留），到期近者优先 |
| agent-priors `<agent-priors>` | `routes/agent-priors.ts` / `:359-386` | 5+5 / 800 | L5 + `cat:failure`/`cat:correction`，pipeline ×0.7 |
| memory-guide | `hooks/memory-guide.ts` | 静态 | 主动写入/检索引导 |
| goal-snapshot | `index.ts:6006-6016` | ≤10/500 | 仅 manager session |

## 7. 数据模型 / 存储

`HarmonicUnit`（`harmonic-types.ts:23-67`）+ index entry（`:75-113`）字段与写读点见 §1；index-only 字段：`last_decay_at`/`last_replayed`/`commitment_capped_at`（不写 OKF）。
`goal_id` **无生产写入**（历史兼容）。

布局（`~/.mafw`）：`memory/concepts/{semantic|episodic|procedural|global|knowledge}/*.md`（OKF）、`memory/.harmonic_index.json`（v2）、`memory/vectors-*.json`、`memory/vectors-t1-*.json`、`memory/gateway.db`（表：t1_observations/t1_archive/t1_noop_log/kv_store/anchor_*/coactivation_*/trajectory_*/goal_*）、`logs/*.jsonl`、`triage/*.json`、`skill-staging/`、`l5/*.json`。

## 8. 配置 / 可观测

见 §2.5（heartbeat/budget）与各节内联开关。**代码默认多为关闭**（生产覆盖在 `~/.mafw/config.yaml`，本文无法断言）：`search.snapshot.enabled=false`、`search.fok.enabled=false`、`search.reranker='off'`、`search.temporalNeighbors.enabled/presentation=false`、`search.boundaryDense=false`、`memory.embedding.provider='off'`、`recall.entityHarvest=false`、`recall.graceRevisit='shadow'`、`recall.segmentation='shadow'`。默认开：`search.arbiter`、`search.graph.diffusion`（含 needModulation/hubFloor）、`channelSplit`、`memory.dedup.*`、`harvestIdentifierCues`、`decay.catd`、`t1Recall`。

## 9. 曾经的 AGENTS.md 出入（**2026-10-13 已全部修正**）

1. **写路径 MinHash 合并已退役**（`harmonic-file-store.ts:86-92`）；`MinHashMerger.merge()` 无调用者 → AGENTS §3.3 已改写为去重三层
2. **write() 不计算 salience**（入口 `judgeSalience`/`importanceToSalience`）→ 已同步
3. **2000 字符合并截断**属退役 MinHash 逻辑；现 update 合并不截断（HTTP content 另有 4000 上限）→ 已注明
4. **note-board 预算 1600 字符** → 已同步；`/api/memory/sticky` 兜底改经 `emptyNoteBoardBudget()` 单一来源（原硬编码 800 已修）
5. **`supersedes` 类型两入口不同**（HTTP 单串 / MCP 数组）→ 已注明
6. **`EnergySystem` 事件 delta 不作用于谐波记忆**（仅 L3 `ParametricStore`）→ 已注明
7. **GLiNER 实体收割默认 false** → 已注明
8. **`distinct_from` 写后即丢** → **已修**（OKF 白名单 + `HarmonicIndexEntry` + `addEntry` + consolidation 双向尊重）
9. merge 阈值 **0.6** → 已注明确切值
10. `core/mcp/tools.ts` 另有 legacy `mafw_merge_memory`（deprecated）→ 保留说明（未清理）
