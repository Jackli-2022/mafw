# 2026-11-19 · 实时召回分段计时与确定性缓存

## 交付标识

- Gateway 版本：**v5.1.0**
- 实施基线：`81a3eff9b`
- 本切片代码：单一合并提交（见 git log）
- 相关调研：
  - `docs/research/2026-11-19-realtime-recall-latency-budget.md`
  - `docs/research/2026-11-19-realtime-recall-optimization-options.md`
  - `docs/research/2026-11-19-industry-practices-recall-performance-quality.md`
- 运行验证：Gateway v5.1.0，PID 52896，health `ok`
- 本地 main，未 push。

## 1. 交付内容

### 1.1 分段计时与可见率观测

新增 `gateway/src/recall/recall-metrics.ts`：

- 纯内存、fail-open；
- 最近 1000 条请求环形缓冲；
- 阶段 p50/p95/p99：`search/fok/exact/lexical/neighbors/render/total`；
- 请求级计数：`route=snapshot|fallback`、`snapshotDecision`、`clientAborted`；
- `graph/expansion` 预留键，当前未接线。

`routes/recall.ts` 已打点，不改响应体、不改 FOK / lexical veto / exact evidence 语义。

### 1.2 exact evidence 索引缓存

- `HarmonicIndex.getSearchVersion()` 只读暴露；
- `findExactRecallEvidence(entries, query, limit, searchVersion?)`：
  - 不传版本：保持旧纯函数；
  - 传版本：启用内存索引缓存；
- 缓存内容：归一化 cue、cue 长度桶、title、identifier；
- 失效：`searchVersion`、entries 数组身份、cue_anchors 数组引用；
- 结果与未缓存版本逐 id、逐 kind、逐 specificity 完全一致。

### 1.3 图邻接 LRU 缓存

新增 `gateway/src/graph/graph-neighbor-cache.ts`：

- 有界 per-node LRU（默认 512 节点 / 50k 条目）；
- `AnchorGraphStore` / `CoactivationGraphStore` 共用；
- 失效：显式写入 + `total_changes()` + `PRAGMA data_version`；
- 不做整图预载，避免 840ms 冷启动和约 420MB 内存；
- 结果与 SQL 版本逐 id、逐 weight、逐 sharedAnchors 完全一致。

## 2. 测试与构建

- **新增测试：38 个**
  - Task 1：14 个
  - Task 2：14 个
  - Task 3：10 个
- Focused：
  - `tests/unit/recall` + `tests/unit/graph`
  - **82 suites / 637 tests，637 passed**
- Gateway typecheck：`npx tsc --noEmit -p tsconfig.json` exit 0
- `npm run build`：成功
- Gateway restart：成功

### 全量 suite（非全绿，非本切片）

`npm test -- --forceExit`：

- Suites：1055 passed / **5 failed**
- Tests：8554 passed / **8 failed** / 2 skipped

失败面：

- `runtime/architecture-boundaries.test.ts`
- `architecture/legacy-route-inventory.test.ts`
- `runtime/validate-shape.test.ts`
- `runtime/prompt-budget-wiring.test.ts`
- `pod/pod-worktree-service.test.ts`（超时）

均属共享 main 上其他会话的 runtime/transport/pod 改动，不在本切片修改面。

## 3. 固定 40 条 live 配对评测

Before artifact：`%TEMP%\opencode\personal-recall-after-memory-health-warm.json`
After artifacts：`%TEMP%\opencode\personal-recall-after-stage-caches.json`、`...-warm.json`

| 指标 | before | after | after warm |
|---|---:|---:|---:|
| AUTO hit | 17/30 | 17/30 | 17/30 |
| exact / current / implicit | 10/10 / 6/10 / 1/10 | 同左 | 同左 |
| false injection | 0/10 | 0/10 | 0/10 |
| stale injection | 0 | 0 | 0 |
| agreement | 25/30 | 25/30 | 25/30 |
| REST p50 / p95 | 32 / 38ms | 33 / 43ms | 31 / 43ms |
| AUTO p50 / p95 | **162 / 226ms** | **142 / 198ms** | **130 / 181ms** |

质量结论：

- AUTO hit、false injection、stale、agreement 均不变；
- `exact-t1-semantic-encoder` 仅同族 expected 记忆排序变化，目标仍在 anchor rank 1；
- `negative-penguin-molt` 仍为 no-memory，无注入；
- 没有任何命中/误注入翻转。

## 4. 已知边界

- 100ms 契约仍未达标；warm p95 181ms。
- `graph/expansion` 阶段尚未接线，当前只是预留键。
- `clientAborted` 是响应时点的 `res.destroyed || req.destroyed`，偏乐观，不是精确可见率。
- exact evidence 缓存冷路径重建成本未做 17k 级专项测量。
- 图邻接缓存的收益窗口是“一次无写入的检索轮”，不跨回合。
- session-shaped 质量基准尚未实施，需要单独切片。
- 全量 suite 的 8 个失败属共享 main 其他改动，不应计入本切片。

## 5. 后续建议

1. 把 dense 计时并入 `search` 或新增 `dense` stage；
2. 为 `visibleRate` 拆分 `served/errorBody/aborted`；
3. 为 exact cache 补 17k 级 build-only 计时；
4. 将 `prewarmNeighbors` 接入 kernel 启动路径；
5. 建 session-shaped 评测集，补 KU / TR / conflict / provenance。
