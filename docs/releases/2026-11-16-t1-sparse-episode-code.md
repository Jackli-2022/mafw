# 2026-11-16 · T1 稀疏 episode 编码（actor / concept / sparse）

- **分支**：`feat/t1-sparse-first`
- **状态**：Phase C 完成；raw capture 仍是唯一真相源，actor/concept/sparse 全部是派生索引
- **范围**：只改 memory；不做 project/session 隔离

## 两阶段写入

```text
A. raw capture（同步，不可变）
   POST /api/obs/capture
   → t1_observations
   → dense T1 vector（可选 fallback）

B. episode encode（turn 完成后，归档前）
   TurnPipeline.runSession
   → readTurnRows（active + archive）
   → readTrajectoryEvents（同 session_id + turn_id 的 agent/tool_name）
   → extractTurnFeature
   → extractTurnActors
   → extractTurnConcepts
   → encodeTurnSparseTerms
   → t1_turn_actors / t1_turn_concepts / t1_sparse_terms
   → t1_turn_encoding（完成标记）
   → archiveTurn
```

`encodeT1Turn` 失败 fail-open：raw T1 和 feature 仍在，只是该 turn 没有 episode code。
`backfillT1Encoding` 用 `t1_turn_encoding` 判断缺口，空 actor/concept 的 turn 也能前进。

## Actor（主体）

- `t1_actors(actor_id, kind, label)` + `t1_turn_actors(trace_id, actor_id, role, weight)`
- 来源：
  - `user_input` → `user:local` / `requester`
  - `trajectory_events.agent` → `agent:reviewer` / `agent:builder` / `agent:tech-lead` / `agent:memory-curator` / `agent:probe`；未知 agent 保留 `agent:<name>` / `subject`
  - `trajectory_events.tool_name` → `tool:<name>` / `instrument`
  - 可选 `project:<id>` / `context`
- `searchT1Actors`：
  - 多 actor 默认同 turn AND
  - 无同 turn 命中时回退到同 session ≤12 turn 的窗口（anchor = 最后一个参与者出现的 turn）
  - `user:*` / `project:*` 不参与 pattern completion（否则等于全扫）

## Concept（同义词）

- `t1_concepts(term, concept_id, weight)` + `t1_turn_concepts(trace_id, concept_id, weight)`
- 启动时幂等 seed `DEFAULT_CONCEPT_ALIASES`；运行时新增条目不会被删除
- 匹配：ASCII 词边界，CJK substring；按 concept 取最大 weight
- 例子：`解析失败 / unparseable / json parse → error:json_parse`，`覆盖率 / coverage → metric:coverage`，`合并 / merge / consolidation → action:merge`
- 覆盖边界明确：只命中已收录 alias，不做开放式 paraphrase

## Sparse（embedding + 稀疏分解）

- `t1_sparse_terms(trace_id, term_id, kind, weight, model)`
- 每 turn 输出：
  - `concept:<id>`
  - `actor:<id>`
  - `entity:<path-or-identifier>`
  - `tok:<fnv1a>`（哈希词项）
  - `sem:<concept-id>`（embedding + anchor 字典稀疏分解，model `sparse-embed-v1`）
- `querySparseTermIds` 镜像 token hash + concept expansion，查询直接走倒排
- `T1SemanticEncoder`（`recall/t1-semantic-atoms.ts`）：
  - 每个 concept 一个 anchor（alias 表第一个 surface form）
  - turn text 一次 embedding → 对 anchor 向量算 cosine → 取 ≥0.35 的 top 8
  - anchor 向量按 provider 缓存（`WeakMap`），turn 文本按 16 条批量 embed
  - 无 runtime / provider 失败 → 空 atoms，lexical/concept code 照常写
- 词项模型版本化：`sparse-lex-v1` / `sparse-embed-v1`

## 检索

`fuseT1Hits(dense, lexical, k, { feature, concept, actor, sparse })`：

- `T1Hit.sources` 增加 `concept` / `actor` / `sparse` / `neighbor`
- 同 trace 跨通道累计 RRF，excerpt 优先顺序 lexical → feature → concept → actor → sparse
- 直接命中不足 k 时，`expandT1Neighbors` 做 pattern completion（共享 concept、非 user/project actor、或同 session ±2 turn 邻接），邻居只补位

## Baseline（fixtureVersion 2）

| channel | recall@3 | MRR | no-answer |
|---|---:|---:|---:|
| FTS | 0.643 | 0.571 | 1.00 |
| dense | 0.643 | 0.643 | 1.00 |
| feature | 0.643 | 0.607 | 1.00 |
| concept | 0.929 | 0.857 | 1.00 |
| actor | 0.214 | 0.214 | 1.00 |
| sparse | 0.929 | 0.857 | 1.00 |
| fused | 0.929 | 0.929 | 1.00 |

- `q-parse-holdout`（`解码失败`）是唯一 fused miss：不在 alias、raw 文本、synthetic embedding 里
- concept 的 0.929 部分是循环的：多数 fixture 查询本就在 seed alias 表里
- actor 0.214 是特化通道的正常表现：多数 query 不点名参与者
- 这些数字只验证通道接线与融合，不代表真实模型质量

## 测试

新增 **33** 个测试：

- `gateway/tests/unit/recall/t1-encoding.test.ts`（14）
  - actor 抽取 / canonical role / build 不被误判为 builder / project context
  - `parseActorQuery` 英文角色、中文角色、显式 id、泛词不误判
  - concept 中文别名、ASCII 词边界、dedupe
  - sparse concept/actor/entity/token、query token 对齐、semantic atoms、空 turn
  - `encodeT1Turn` 写三类 code + completion marker
- `gateway/tests/unit/gateway-db-t1-encoding.test.ts`（9）
  - actor/concept/sparse roundtrip
  - 重编码替换旧集合
  - 中文同义 concept 命中
  - 多 actor 同 turn AND
  - 跨 turn episode 窗口 fallback
  - sparse concept/token 命中
  - pattern completion 共享 concept / 同 session 邻接 / 忽略 user actor
- `gateway/tests/unit/recall/t1-search.test.ts`（+4）
  - concept/actor/sparse 通道融合与 provenance
  - 同 trace 跨通道累计
  - `createGatewayT1Search` 实际查询 concept/sparse 通道
  - 直接命中不足 k 时用 1-hop neighbor 补位
- `gateway/tests/unit/recall/t1-semantic-atoms.test.ts`（6）
  - anchor 每 concept 唯一
  - cosine 边界
  - `encodeMany` 批量 embed + anchor 缓存
  - threshold / maxAtoms
  - provider 失败 fail-open
  - encoder 按 provider 实例缓存
- `gateway/tests/unit/turn-pipeline-features.test.ts`（扩展）
  - 端到端管线 join trajectory 写 actor/concept/sparse + completion marker

focused：10 suites / 95 tests 全绿。
gateway 全量：**959/959 suites，7738 tests（7736 passed，2 skipped，0 failed）**。
`tsc --noEmit -p tsconfig.json` rc=0；`npm run build`（gateway）rc=0；`evaluation/t1` tsc rc=0。

## 已知限制

- concept 覆盖 = alias 表；未收录 synonym 仍会漏（`解码失败`）
- `semantic` atoms 是 anchor 字典 sparse coding，不是训练过的 SPLADE/SAE；换 embedding model 需要重算
- `semantic` atom 与 concept 通道可能命中同一概念，RRF 会累加两条证据；后续可按 term 去重或降权
- sparse 的 semantic 通道仍受 embedding 覆盖率约束（T1 向量约 37%）；没有 embedding 的 turn 只有 lexical/concept 码
- actor 窗口是启发式（同 session ≤12 turn），没有正式 `t1_episodes` 边界
- `t1_feature_fts` / actor / concept / sparse 都缺少独立重建命令；当前靠 re-encode 覆盖
- T1 向量覆盖约 37%，dense fallback 仍不完整

## 下一步

1. `t1_episodes` + episode 切分（时间间隔 / goal / 目录 / 工具失败断点）
2. 用真实本地 embedding 评估 `semantic` atoms，再决定 anchor 字典是否换成 SPLADE
3. `t1.denseIndex: on | off | shadow`
4. 用真实本地模型重跑 baseline，再决定 dense 去留
