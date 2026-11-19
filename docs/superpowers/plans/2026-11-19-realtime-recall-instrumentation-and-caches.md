# Realtime Recall Instrumentation and Caches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把实时召回的关键路径拆成可观测的 p95 阶段，并用确定性缓存把 exact evidence 与图邻接的重复扫描移出 100ms 边界预算。

**Architecture:** 先在 route 层建立分段计时与客户端可见率观测，再为 exact evidence 建立按 `searchVersion` 失效的内存索引，最后为 anchor/coactivation 图建内存邻接缓存并保持 SQL 语义不变。三个改动互不改变召回质量门，只减少重复计算。

**Tech Stack:** TypeScript、Jest、Node 内置 `Map/Set/WeakMap`、现有 SQLite graph stores、现有 `HarmonicIndex`。

**Spec:** `docs/research/2026-11-19-realtime-recall-optimization-options.md` §3–§6、§9；`docs/research/2026-11-19-industry-practices-recall-performance-quality.md` §1、§3.1。

## Global Constraints

- 不得降低 FOK、lexical veto、exact evidence 或 note-board 的质量门。
- 不得把 100ms 截止放宽；所有改动只作用于 fallback/后台路径。
- 不得改变固定 40 条召回结果的语义；性能优化必须以 0 flip 或逐 id 一致为验收。
- 缓存必须有明确失效路径：`searchVersion` 或图写入/删除必须失效旧结果。
- 所有新模块/字段必须可选或 fail-open，不得破坏旧客户端契约。
- 子代理实施时不得 commit/build/restart；由父会话统一审查、提交、构建与重启。
- 共享 main 上有其他会话改动；实施只允许触碰本计划列出的文件。

## Review Focus

- **客户端 abort 后不可见**：route 必须能把“服务端完成但客户端未收到”与“真正完成”分开，否则 visible recall 率会虚高。
- **缓存后结果漂移**：exact evidence 与图邻接缓存必须与未缓存版本逐 id、逐 weight 一致，不能只看命中率。
- **失效缺口**：`searchVersion`、图写入、删除、rebuild 任一路径漏失效都会把旧结果带回边界路径。
- **长 query 的 p95**：分段计时必须能把 graph、expansion、FOK、exact 各自耗时分开，否则无法判断 100ms 超在哪。
- **后台构建争用**：stage metrics 要能标记请求是否与 snapshot build 并发，否则 p95 会被后台噪声污染。

---

### Task 1: Recall stage metrics + visible rate

**Files:**
- Create: `gateway/src/recall/recall-metrics.ts`
- Create: `gateway/tests/unit/recall/recall-metrics.test.ts`
- Modify: `gateway/src/routes/recall.ts`
- Test: `gateway/tests/unit/recall/recall-route-metrics.test.ts`（可并入 route 既有测试文件，若新增则用此路径）

**Interfaces:**
- Produces:
  - `recordRecallStage(stage: RecallStageKey, ms: number): void`
  - `recordRecallRequest(metrics: RecallRequestMetrics): void`
  - `snapshotRecallMetrics(): RecallMetricsSnapshot`
  - `resetRecallMetricsForTest(): void`
  - `RecallStageKey = 'search' | 'graph' | 'expansion' | 'fok' | 'exact' | 'lexical' | 'neighbors' | 'render' | 'total'`
  - `RecallRequestMetrics = { route: 'snapshot' | 'fallback'; snapshotDecision?: 'use'|'stale'|'topic-shift'|'fok'|'no-snapshot'; clientAborted?: boolean; totalMs: number }`
- Consumes:
  - 现有 `log`、`Date.now()`、`res`/`req` 生命周期事件；不新增外部依赖。

- [ ] **Step 1: 写失败测试**

新增测试覆盖：
1. `recordRecallStage` 后 `snapshotRecallMetrics().stages.search.p50/p95/p99` 可读；
2. 多样本 p50/p95/p99 排序正确；
3. `recordRecallRequest` 后 `snapshotRecallMetrics().requests` 按 route/snapshotDecision/clientAborted 计数；
4. `resetRecallMetricsForTest()` 清空；
5. route 层至少能把 `search/fok/exact/lexical/neighbors/render/total` 打点进 metrics，并把 `res.destroyed` 视作 `clientAborted=true`。

- [ ] **Step 2: 运行测试验证 RED**

Run: `cd gateway; npx jest tests/unit/recall/recall-metrics.test.ts --runInBand`

Expected: 模块不存在或字段缺失导致 FAIL。

- [ ] **Step 3: 实现 `recall-metrics.ts`**

要点：
- 用固定长度环形缓冲保存最近 1000 条请求样本，避免无界增长；
- stage 用小顶/排序数组或简单排序计算 p50/p95/p99；
- `snapshotDecision` 与 `clientAborted` 只是计数，不参与延迟排序；
- fail-open：metrics 抛错不影响 recall 返回。

- [ ] **Step 4: 接入 `routes/recall.ts`**

要点：
- 在 `searchRecallMemories` 前后记录 `search`；
- 在 `evaluateRecallFokZone` 前后记录 `fok`；
- 在 `selectLexicallySupportedCandidates` 前后记录 `lexical`；
- 在 `findExactRecallEvidence` 前后记录 `exact`；
- 在 `recallNeighbors` 前后记录 `neighbors`；
- 在 `formatRecallContext` 后记录 `render`；
- 请求结束时记录 `total` 与 `route=snapshot|fallback`；
- 通过 `res.destroyed` / `req.destroyed` 记录 `clientAborted`；
- 保留现有 debug 日志，不改变响应体。

- [ ] **Step 5: 验证 GREEN 与类型**

Run: `cd gateway; npx jest tests/unit/recall/recall-metrics.test.ts tests/unit/recall --runInBand; npx tsc --noEmit -p tsconfig.json`

Expected: 测试 PASS，类型门 exit 0。

---

### Task 2: Exact evidence index cache

**Files:**
- Modify: `gateway/src/core/memory/harmonic-index.ts`
- Modify: `gateway/src/recall/exact-evidence.ts`
- Modify: `gateway/src/routes/recall.ts`
- Create: `gateway/tests/unit/recall/exact-evidence-cache.test.ts`

**Interfaces:**
- Produces:
  - `HarmonicIndex.getSearchVersion(): number`
  - `findExactRecallEvidence(entries, query, limit, searchVersion?)`
  - 内部 `ExactEvidenceIndexCache`，按 `searchVersion` + entries array identity 失效。
- Consumes:
  - 现有 `normalizedCues`、`normalizeRecallText`、`identifierToken`、`isExactEvidenceEligible`。
- 约束：
  - 不传 `searchVersion` 时保持旧纯函数行为，不启用缓存；
  - 传版本时只允许逐 id、逐 kind、逐 specificity 完全一致。

- [ ] **Step 1: 写失败测试**

测试覆盖：
1. 同一 `searchVersion` 下重复调用只构建一次索引（可用内部计数或耗时比较）；
2. `searchVersion` 变化后重建索引；
3. 缓存与非缓存结果在 title/identifier/cue 三类证据上逐字段一致；
4. superseded / retracted / unpinned episodic 不因缓存进入结果；
5. cue 长度、DF、coverage 规则不变；
6. 传入 17k 级 synthetic entries 时缓存后 p95 明显低于未缓存（性能测试用小型 subset，不要求固定 ms 阈值，只要求缓存耗时 < 未缓存耗时的 50%）。

- [ ] **Step 2: 运行测试验证 RED**

Run: `cd gateway; npx jest tests/unit/recall/exact-evidence-cache.test.ts --runInBand`

Expected: `getSearchVersion` 或缓存行为缺失导致 FAIL。

- [ ] **Step 3: 实现 `getSearchVersion()` 与缓存**

要点：
- `harmonic-index.ts` 暴露只读 `getSearchVersion()`；
- `exact-evidence.ts` 增加模块级缓存：`{ version, entriesRef, cueSet, cueLengths, titleMap, identifierMap }`；
- 只缓存**归一化后的 distinctive cue 集合**与 cue→entry 映射，不缓存 eligibility 判定结果；
- 查询时按 cue 长度生成 query substring，查 `cueSet`，再按现有 DF/coverage 规则判定；
- 不改变 `findExactRecallEvidence` 返回顺序与 specificity。

- [ ] **Step 4: 接入 route**

要点：
- route 调用 `harmonicIndex.getSearchVersion()`；
- 把版本传给 `findExactRecallEvidence`；
- 不传版本的旧测试/调用保持原行为。

- [ ] **Step 5: 验证 GREEN 与类型**

Run: `cd gateway; npx jest tests/unit/recall/exact-evidence.test.ts tests/unit/recall/exact-evidence-cache.test.ts tests/unit/recall --runInBand; npx tsc --noEmit -p tsconfig.json`

Expected: 全部 PASS，类型门 exit 0。

---

### Task 3: Graph adjacency in-memory cache

**Files:**
- Modify: `gateway/src/graph/anchor-graph-store.ts`
- Modify: `gateway/src/graph/coactivation-store.ts`
- Create: `gateway/src/graph/graph-neighbor-cache.ts`（如共享结构需要；若各自实现更简单，可不建共享文件）
- Create: `gateway/tests/unit/graph/anchor-graph-store-cache.test.ts`
- Create: `gateway/tests/unit/graph/coactivation-store-cache.test.ts`
- Modify: `gateway/src/core/memory/harmonic-index.ts`（仅在需要显式 prewarm 或失效钩子时）

**Interfaces:**
- Produces:
  - `AnchorGraphStore.getNeighbors(unitIds, topK, exclude?)` / `CoactivationGraphStore.getNeighbors(...)` 在缓存开启时返回与 SQL 完全一致的结果；
  - `prewarmNeighbors(ids: string[])`（可选）
  - `clearNeighborCache()`（测试与失效用）
- Consumes:
  - 现有 SQLite 表 `anchor_edges`、`coactivation_edges`、`anchor_units`、`coactivation_units`。
- 约束：
  - 缓存开启时不能改变 topK、exclude、decay、weight、排序；
  - `upsertUnit` / `removeUnit` / `rebuild` 必须使受影响节点缓存失效；
  - 默认开启缓存，但提供 `graph.neighborCache.enabled` 开关，默认 true。

- [ ] **Step 1: 写失败测试**

测试覆盖：
1. 缓存开启时 `getNeighbors` 与 SQL 版本逐 id、逐 weight、逐 `sharedAnchors` 一致；
2. `upsertUnit` 后旧邻居不再返回；
3. `removeUnit` 后节点和边缓存都不再命中；
4. `rebuild` 后缓存重建；
5. 高并发 / 多节点查询下缓存不改变结果；
6. 开关 off 时行为与旧 SQL 完全一致；
7. 内存邻接结构不随查询增长无界（可用固定容量 LRU 或按 store 管理上限）。

- [ ] **Step 2: 运行测试验证 RED**

Run: `cd gateway; npx jest tests/unit/graph/anchor-graph-store-cache.test.ts tests/unit/graph/coactivation-store-cache.test.ts --runInBand`

Expected: 缓存行为缺失导致 FAIL。

- [ ] **Step 3: 实现缓存**

要点：
- 首选方案：每个 store 维护 `Map<unitId, Array<{ neighborId, weight, sharedAnchors? }>>` 的邻接表；
- 初始化时从 SQL 一次性加载全部边，构建双向邻接；
- `upsertUnit` / `removeUnit` / `rebuild` 时同步更新邻接表，避免全量重建；
- `getNeighbors` 直接在邻接表上过滤 exclude、按 weight 排序、截断 topK；
- 若内存占用超过阈值，退化为 per-node LRU；但不得改变结果；
- 不引入新依赖，不使用 worker thread。

- [ ] **Step 4: 验证 GREEN 与类型**

Run: `cd gateway; npx jest tests/unit/graph/anchor-graph-store-cache.test.ts tests/unit/graph/coactivation-store-cache.test.ts tests/unit/recall/expansion-graph-fanout.test.ts --runInBand; npx tsc --noEmit -p tsconfig.json`

Expected: 全部 PASS，类型门 exit 0。

- [ ] **Step 5: 父会话统一验收**

由父会话执行：
- `npm test -- --forceExit`（全量）
- `npm run build`
- `mafw restart`
- `node evaluation/personal-recall/run.js` paired before/after
- 更新 `docs/architecture/memory.md` 与 release 记录，注明缓存语义、失效路径与实测延迟。
