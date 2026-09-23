# 联想层（Association Layer）设计

> 日期：2026-09-23 · 状态：设计已确认，已按 spec review 修订，待写实施计划
> 范围：B 路线（中重构）首切片——为谐波记忆引入"共激活联想层"
> 前置调研：`docs/research/2026-09-23-brain-vs-ai-memory-survey.md`（§1.3 联想 / §1.4 取回 / §4 三方对照）

## 1. 背景与动机

调研结论：MAFW 的"联想"目前**只由共享 `cue_anchors` 承载**（词面重叠），缺大脑式的**共激活联想**——记忆因"一起出现"（同会话、同目标、时间邻近）而互相关联（Hebb 细胞集群、engram 共分配）。

现状事实：
- `anchor_edges(unit_a, unit_b, shared_anchors, weight, updated_at)`，边权 = 共享锚点 IDF 和（`gateway/src/graph/anchor-graph-store.ts:33-74`）。
- 多跳扩展为 hop-1 贪心（`gateway/src/core/memory/harmonic-index.ts:320-368`；`maxHops=1 / maxNeighbors=3 / damping=0.6 / candidateCap=50 / rerankGraphWeight=0.15`）。
- 共激活信号现状（**实测**）：
  - `source_session_id`：索引 3264 条中 **3067 条有值（94%）**。写入方：`/api/memory/add`（`index.ts:6038`，来自 `data.sessionID`）、`t1-to-t2-compressor.ts:137`、`reflection.ts:291`。**缺口**：MCP `mafw_add_memory`（`mcp/handlers/add-memory.ts`）**不设** `source_session_id`，且 MCP 传输无状态（`streamable-endpoint.ts`）、`ToolHandler` 上下文无 sessionID（`types.ts:23-37`）——agent 直接写的记忆无会话边（当前约 197 条）。
  - `created_at`：`HarmonicIndexManager.addEntry` 已自动盖章（`unit.created_at || now`，`harmonic-index.ts:223`，commit 7c250909），但 `harmonic-file-store.ts:85-102` 调用处未传 `targetUnit.created_at`，故回退为**写入时刻**而非真实创建时刻；存量（7c250909 前）条目多为空（实测 92/3264 有值）。写入时 `HarmonicUnit.created_at` 恒有值。
  - `goal_sessions(session_id → goal_id)`：`gateway-db.ts:196-204`。
- 启动时 `AnchorGraphStore.rebuild(index)` 全量重建（`index.ts:2166-2177`）。

## 2. 目标 / 非目标

**目标**
1. 检索排序反映共激活联想（同会话 / 同 Goal / 时间邻近），而非仅词面共享锚点。
2. 用**有界 Personalized PageRank（PPR）扩散**替换 hop-1 贪心。
3. 联想强度**随时间衰减**（不再共激活则淡忘）。
4. 守 100ms 边界 recall 契约；可量化验收（LongMemEval multi-session/多跳子集）。

**非目标**
- 不改 `HarmonicUnit` / OKF 存储格式（仅给索引条目补 `created_at` 持久化）。
- 不改 `anchor_edges` 表结构与语义。
- 不做参数化记忆、不做系统巩固回放（后续切片）。
- **不在本切片透传 sessionID 到 MCP `mafw_add_memory`**（见 §5.0 覆盖上限与 §13 风险）——列为后续项。
- 不做周期性 rebuild 调度（本切片仅启动时重建，见 §10）。

## 3. 架构总览

```
写入路径                              检索路径（searchScored）
harmonic-file-store.write()           BM25 → dense RRF
  ├─ anchorGraphStore.upsertUnit()      → 【联想层】批量合并邻居(anchor+coactivation)
  └─ coactivationStore.upsertUnit()     → 有界 PPR 扩散 → 与 BM25 归一融合
        ↑ 会话/Goal/时间信号              → 时间锚定 → rerank
  启动 rebuild 全量重算
```

新增两个模块，均复用现有 `GatewayDatabase`（SQLite）与 fail-open 降级约定：
- `gateway/src/graph/coactivation-store.ts` — 共激活边存储与构建。
- `gateway/src/graph/diffusion.ts` — 纯函数 PPR 扩散。

## 4. 数据模型

**时间单位统一为 epoch 秒**（与既有表的 `unixepoch()` 约定一致）。写入侧由 ISO `created_at` 转换：`Math.floor(Date.parse(iso)/1000)`；`now = Math.floor(Date.now()/1000)`。所有窗口与衰减计算均用秒。

新增三张表（`CREATE TABLE IF NOT EXISTS`，见 `gateway-db.ts`）：

```sql
-- 单元 → 共激活键（每单元一行，供按会话/Goal/时间反查）
CREATE TABLE IF NOT EXISTS coactivation_units (
  unit_id    TEXT PRIMARY KEY,
  session_id TEXT,
  goal_id    TEXT,
  created_at INTEGER          -- epoch 秒
);
CREATE INDEX IF NOT EXISTS idx_coact_units_session ON coactivation_units(session_id);
CREATE INDEX IF NOT EXISTS idx_coact_units_goal    ON coactivation_units(goal_id);
CREATE INDEX IF NOT EXISTS idx_coact_units_created ON coactivation_units(created_at);

-- 无向共激活边（归一化 pair 存一行）
CREATE TABLE IF NOT EXISTS coactivation_edges (
  unit_a     TEXT NOT NULL,
  unit_b     TEXT NOT NULL,
  session_co REAL NOT NULL DEFAULT 0,   -- 各信号贡献（0–1）
  goal_co    REAL NOT NULL DEFAULT 0,
  time_co    REAL NOT NULL DEFAULT 0,
  weight     REAL NOT NULL,             -- 加权和（未含读时衰减）
  updated_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (unit_a, unit_b)
);
CREATE INDEX IF NOT EXISTS idx_coact_edges_a ON coactivation_edges(unit_a);
CREATE INDEX IF NOT EXISTS idx_coact_edges_b ON coactivation_edges(unit_b);
```

设计取舍：**独立表**而非扩展 `anchor_edges`——锚点边由 `cue_anchors` 重算、共激活边由会话/Goal/时间重算，生命周期与衰减语义不同，独立表互不干扰且可独立回滚。

**索引补丁**：`addEntry` 已用 `unit.created_at || now` 盖章（`harmonic-index.ts:223`），但 `harmonic-file-store.ts` 调用处未传 `created_at` → 回退为写入时刻。本切片让调用处传 `targetUnit.created_at`，保留**真实创建时刻**（时间边精度）。存量（7c250909 前）条目缺 `created_at` → 时间边 best-effort（见 §12）。

## 5. 边构建（三类信号）

### 5.0 覆盖上限（显式接受）
`session_co` 仅对带 `source_session_id` 的记忆生效（当前 94%）。MCP `mafw_add_memory` 直写的记忆无会话边；这些记忆仍可通过 Goal / 时间信号获得联想。**sessionID 透传到 MCP 列为后续项，不在本切片。**

### 5.1 `upsertUnit(unit)`
`CoactivationGraphStore.upsertUnit(unit: { id: string; source_session_id?: string; created_at?: string /* ISO */ })`——`created_at` 入参为 ISO 字符串，落库转 epoch 秒：

1. **解析 Goal**：`SELECT goal_id FROM goal_sessions WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`（无则 null）。
2. **写 `coactivation_units` 行**（epoch 秒 `created_at`；`ON CONFLICT(unit_id) DO UPDATE` 覆盖 session/goal/created_at，处理重写/合并）。
3. **找共激活邻居**（各 cap `maxNeighbors`，见 §9）：
   - **同会话**：`session_id = ?` 的其它单元 → `session_co = 1.0`。
   - **同 Goal**：`goal_id = ?` 的其它单元 → `goal_co = 1.0`（仅当 goal_id 非空）。
   - **时间邻近**：**对称窗口** `|Δt| ≤ timeWindowSec`（`created_at` 秒）的其它单元 → `time_co = 1 − |Δt|/timeWindowSec`。
4. **hub 防护**：session/goal 成员数 > `maxGroupSize`（默认 50）时**跳过该信号**（不建边），避免"大会话/大 Goal"把记忆连成团。
5. **写边**：`weight = sessionWeight·session_co + goalWeight·goal_co + timeWeight·time_co`，归一化 pair（`a<b`），跳过自身；`ON CONFLICT(unit_a,unit_b) DO UPDATE` **合并**（刷新各 `*_co`、`weight`、`updated_at`），**非** delete-and-rebuild。

> 对称窗口保证：较晚写入的单元会回溯窗口内较早的邻居；较早单元被重写时，对称窗口仍能重新发现较晚邻居，不会因单向窗口丢边。

### 5.2 `removeUnit(unitId)`
删除 `coactivation_units` 行与相关 `coactivation_edges`（与 `AnchorGraphStore.removeUnit` 同构）。

### 5.3 `rebuild(index)`
清表后遍历 index（跳过 `superseded_by`）逐条 `upsertUnit`；`created_at` 缺失的条目跳过时间信号。

### 5.4 `getNeighbors(unitIds, topK, exclude?)`
`Map<string, Map<string, number>>` —— 按单元返回其邻居及**读时衰减后**的权重（`weight × exp(−(now−updated_at)/(halfLifeDays·86400))`）。语义对齐 `AnchorGraphStore.getNeighbors`（批量、跳过命中-命中边、按权重降序取 topK）。邻居超 `maxNeighbors` 的确定性 tie-break：先按衰减后权重降序，再按 `unit_id` 字典序（保可复现）。

## 6. 边衰减

读时指数衰减，不写回、不 mutate（与 energy 衰减同思路），全部以**秒**计：

```
effectiveWeight(edge) = edge.weight × exp(−(now − edge.updated_at) / (halfLifeDays·86400))
```

共激活（写时 upsert 命中已存在边）刷新 `updated_at`，即"再次一起出现则强化"。可选周期性 prune 掉 `effectiveWeight` 低于阈值的边（后续切片）。

## 7. 扩散算法

`diffusion.ts` 纯函数：

```ts
personalizedPageRank(
  seeds: string[],
  neighborsOf: (id: string) => Map<string, number>,  // 合并后的边权
  opts: { alpha: number; iterations: number; candidateCap: number },
): Map<string, number>
```

- 子图 = 从 seeds 经 `neighborsOf` 扩展至 `candidateCap`（默认 50）节点。
- 幂迭代 ≤ `iterations`（默认 15）或收敛（L1 变化 < 1e-6）。
- 返回归一化 PPR 分数（0–1）。
- 复杂度 ≤ 50 节点 × 15 迭代 ≈ 微秒级，不影响 100ms 边界。

## 8. 检索接线

`HarmonicIndexManager.searchScored` 中，**替换**现有 graph 段（`harmonic-index.ts:320-368`）：

1. 种子 = 当前 `scored`（BM25/dense 融合后）top-`seedK`，`seedK = min(scored.length, config.search.graph.candidateCap)`（默认 50）。
2. **逐种子**构建合并邻接：对每个种子 id 调用 `anchorGraphStore.getNeighbors([id], …)` 与 `coactivationStore.getNeighbors([id], …)`（两者均以 `exclude = 全部种子 id 集` 跳过命中-命中边），两路各自 min-max 归一后按 `edgeMix.anchor : edgeMix.coactivation` 合并为 `Map<seedId, Map<neighborId, weight>>`；`neighborsOf(id)` 查该表。种子 ≤ `candidateCap`(50)，逐种子查询开销可忽略。
3. `personalizedPageRank(seeds, neighborsOf, opts)`。
4. 融合：现有 min-max 归一加权（`rerankGraphWeight`）保持不变。**注意**：PPR 会给种子分配传送质量，而现 hop 贪心把种子 `graphScore` 视为 0（仅扩展项受提权）——归一后扩展项的相对提升会略被压缩，属**预期排序变化**，验收时对照基线。
5. 降级：`diffusion.enabled=false` → 回退现有 hop 贪心；`coactivation.enabled=false` → 仅锚点边。**两条回退路径均需测试覆盖。**

## 9. 配置

`config.search.graph` 下新增（默认值）：

```yaml
edgeMix:                     # 合并两路邻居时的权重比（归一后）
  anchor: 0.6
  coactivation: 0.4
coactivation:
  enabled: true
  sessionWeight: 1.0
  goalWeight: 0.6
  timeWeight: 0.3
  timeWindowSec: 3600        # 1h（epoch 秒）
  halfLifeDays: 14
  maxNeighbors: 3            # 缺省复用 search.graph.maxNeighbors
  maxGroupSize: 50           # 超过则跳过该 session/goal 信号
diffusion:
  enabled: true
  iterations: 15
  alpha: 0.85
```

## 10. 可观测

- `GET /api/memory/stats` 增 `coactivation` 字段：边总数、各信号非零计数、平均有效权重。
- 启动 rebuild 纳入 `PipelineHeartbeat`（`record('coactivation-rebuild', {ok, counts})`）。
- 周期性 rebuild 调度**不在本切片**（仅启动时重建）。

## 11. 测试

- **单测** `coactivation-store.test.ts`：同会话/同 Goal/时间邻近建边、权重计算、对称窗口、hub 防护（`maxGroupSize`）、衰减、`rebuild`、`removeUnit`、`ON CONFLICT` 合并语义。
- **单测** `diffusion.test.ts`：小图上 PPR 收敛与排序、`alpha`/`iterations` 边界、空种子。
- **集成** `harmonic-index` 测试：注入共激活边后，`searchScored` 将共激活项排到无关联项之前；**回退路径**（`diffusion.enabled=false`、`coactivation.enabled=false`）行为等价现状。
- **基准**：LongMemEval multi-session/多跳子集，对照开关（可复现、确定性）。

## 12. 迁移与回滚

- 三张新表由 `CREATE TABLE IF NOT EXISTS` 自动创建，无破坏性迁移。
- 启动 `rebuild` 从**现有索引**回填共激活边（fail-open：失败仅告警，不影响启动）。
- 存量条目缺 `created_at` → 时间边 best-effort（重写或新写后补齐；会话/Goal 边不受影响）。
- 回滚：配置开关一键回退（`coactivation.enabled=false` + `diffusion.enabled=false`），行为等价现状。

## 13. 风险

| 风险 | 缓解 |
|---|---|
| 大会话/大 Goal 造成"全连接"团 | `maxGroupSize` 跳过该信号 + `maxNeighbors` cap |
| 时间窗口 O(n²) | 对称窗口反查 + cap；rebuild 用时间分桶（后续） |
| 边界 recall 延迟 | 子图 ≤50、迭代 ≤15、纯函数无 IO |
| Goal 重分配致边陈旧 | 启动 rebuild（周期性后续） |
| **MCP 写入无 sessionID（6% 覆盖缺口）** | 显式接受；Goal/时间信号兜底；sessionID 透传列后续项 |
| **存量 `created_at` 缺失致时间边稀疏** | 索引补丁持久化 `created_at`；存量 best-effort |
| 基准不可复现 | 开关可关，默认值固定 |

## 14. 涉及文件

- 新增：`gateway/src/graph/coactivation-store.ts`、`gateway/src/graph/diffusion.ts`
- 修改：`gateway/src/memory/gateway-db.ts`（建表）、`gateway/src/config.ts`（配置）、`gateway/src/core/memory/harmonic-index.ts`（检索接线）、`gateway/src/memory/harmonic-file-store.ts`（写时构建 + `addEntry` 补 `created_at`）、`gateway/src/index.ts`（wiring/rebuild）、stats 路由
- 测试：`gateway/tests/unit/graph/coactivation-store.test.ts`、`diffusion.test.ts`、`harmonic-index` 集成
