# 锚点图多跳检索（Anchor-Graph Multi-Hop Retrieval）设计

日期：2026-08-20
状态：待审查

## 1. 目标

在 MAFW 谐波记忆检索链上实现 Memora 式锚点图多跳扩展：bm25 初筛命中后，通过共享 `cue_anchors` 的持久化图拉取"相似但不直接相关"的邻居记忆，与 bm25 得分融合重排，提升 multi-session / multi-hop 类查询的召回。图持久化到 SQLite，写路径增量更新 + 启动重建验证，LongMemEval L1 作为质量门禁，可配置回退。

## 2. 背景（调研结论）

**Memora（微软，ICML 2026）**：谐波记忆表示（primary abstraction + memory value + cue anchors），核心创新是 **policy-guided retriever**——迭代精化 query、通过 cue anchors 扩展找多跳相关信息、决定何时停止。LoCoMo 86.3% / LongMemEval 87.4%，多跳推理差距最大。

**MAFW 现状（调研确认）**：
- `HarmonicUnit.primary_abstraction` + `cue_anchors` + `memory_value` 三件套与 Memora 同源（AGENTS.md §3）
- **AnchorGraph 是死代码**：`gateway/src/graph/anchor-graph.ts` 只写（`harmonic-file-store.ts:90` `addUnit`）不读（`buildImplicitEdges`/`getNeighbors` 零调用）
- 检索链单跳：`MemoryService.search → HarmonicIndexManager.searchScored → bm25/token → heuristic reranker`（bm25+recency+energy+salience）
- `CognitiveGraphManager`（`[[link]]` 显式边）有 `getTopAssociations` 也未接检索
- LongMemEval L1 基线（sample 8 / session / bm25 / frozen）：R10=0.949, R1=0.586；multi-session R10=0.91 但 L2 聚合弱

## 3. 数据模型（SQLite，gateway.db）

### 3.1 `anchor_units`（锚点→单元倒排）

```sql
CREATE TABLE IF NOT EXISTS anchor_units (
  anchor TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  weight REAL DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (anchor, unit_id)
);
CREATE INDEX IF NOT EXISTS idx_anchor_units_anchor ON anchor_units(anchor);
CREATE INDEX IF NOT EXISTS idx_anchor_units_unit ON anchor_units(unit_id);
```

### 3.2 `anchor_edges`（单元间共享锚点边）

```sql
CREATE TABLE IF NOT EXISTS anchor_edges (
  unit_a TEXT NOT NULL,
  unit_b TEXT NOT NULL,
  shared_anchors INTEGER NOT NULL,
  weight REAL NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (unit_a, unit_b)
);
CREATE INDEX IF NOT EXISTS idx_anchor_edges_a ON anchor_edges(unit_a);
CREATE INDEX IF NOT EXISTS idx_anchor_edges_b ON anchor_edges(unit_b);
```

要点：
- 边规范化 `unit_a < unit_b` 防重复；不存 superseded 单元的边
- `weight = Σ(共享锚点的 IDF)`，`IDFStats.isNoisy` 过滤 hub 锚点（`hubThreshold=20` 复用）
- 新模块 `gateway/src/graph/anchor-graph-store.ts`：类 `AnchorGraphStore`

## 4. 图构建与更新

### 4.1 写路径增量（harmonic-file-store.ts）

```
write(unit) 成功 → AnchorGraphStore.upsertUnit(unit.id, unit.cue_anchors)
markSuperseded(oldId, byId) → AnchorGraphStore.removeUnit(oldId)
delete(id) → AnchorGraphStore.removeUnit(id)
```

`upsertUnit`：删旧锚点行+旧边 → 插新锚点行 → 对每个锚点查共享单元 → 增量 upsert 边。

### 4.2 启动重建

`AnchorGraphStore.rebuild(index)`：清空两表 → 遍历非 superseded 条目逐个 upsertUnit；幂等可重入；失败降级（`log.warn`，检索退化为无图扩展）。

## 5. 检索链改造（HarmonicIndexManager.searchScored）

```
1. bm25 初筛（recallK=20）
2. 图扩展（graphExpand !== false）：
   for hop in 1..maxHops（默认 1，自适应）:
     邻居 = getNeighbors(候选命中, 3/命中)
     graphScore = 边权重 × nb.energy × nb.salience × 0.6^hop
     候选 upsert（已有取 max）；总上限 50
   自适应：扩展后 top-1 < cutoffRatio → maxHops+1 再跳
3. heuristic reranker（新输入 graphScore，权重 0.15，min-max 归一化融合）
4. 截断 topK
```

关键实现点：
- `searchScored` options 新增：`graphExpand?: boolean`（默认 true）、`maxHops?: number`、`graphMaxNeighbors?: number`（默认 3）、`graphDamping?: number`（默认 0.6）
- `HarmonicIndexManager` 构造可选 `anchorGraphStore` 参数（gateway 装配传入；LongMemEval 隔离 store 不传 → 无图扩展，保持基准可比）
- `HeuristicReranker`：`RerankWeights` 加 `graph: 0.15`（可配置）；无图分时信号 0，行为等价现状
- superseded 邻居排除；`tokenSearchScored` 也走图扩展（一致性）
- `mergedSearch`（L3 参数化融合）不做图扩展（保持简单，YAGNI）

## 6. 配置（config.ts search.graph）

```ts
graph: {
  enabled: true,          // MAFW_SEARCH_GRAPH_ENABLED
  maxHops: 1,             // MAFW_SEARCH_GRAPH_MAX_HOPS
  maxNeighbors: 3,        // MAFW_SEARCH_GRAPH_MAX_NEIGHBORS
  damping: 0.6,           // MAFW_SEARCH_GRAPH_DAMPING
  candidateCap: 50,       // MAFW_SEARCH_GRAPH_CANDIDATE_CAP
  rerankGraphWeight: 0.15 // MAFW_SEARCH_GRAPH_RERANK_WEIGHT
}
```

## 7. 验证与回退

**LongMemEval L1 门禁**：同 seed 48 题复跑，图扩展后 R10 ≥ 0.949（不得下降）；重点看 multi-session / temporal-reasoning 提升。下降 → `graph.enabled=false` 回退。

**单元测试**：
1. `anchor-graph-store.test.ts`：upsertUnit 建边/权重、removeUnit 清边、rebuild 幂等
2. 共享锚点两记忆 → query 命中 A → B 进 top-K
3. 阻尼 hop1 > hop2；superseded 邻居排除
4. `graphExpand:false` 行为与现状完全一致

**性能**：候选 ≤50、邻居 ≤3/命中，单次 `getNeighbors` 一次 SQL（IN 查询）。

## 8. 里程碑

1. M1：anchor-graph-store.ts + 表结构 + 单测
2. M2：harmonic-file-store 写路径增量接线
3. M3：searchScored 多跳扩展 + reranker graph 信号 + 配置
4. M4：LongMemEval L1 门禁验证 + 回退开关
