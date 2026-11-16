# 2026-11-16 · T1 sparse-first（Phase B：有序时间线 + replay block）

- **分支**：`feat/t1-sparse-first`（基于 Phase A `9a7798f3`）
- **状态**：timeline / replay block / turnCompress 接线完成；T1 feature 检索通道与 `t1.denseIndex` 待做
- **范围**：只改 memory；不引入 project/session 隔离，不改 runtime 契约

## 完成内容

1. `gateway/src/recall/session-timeline.ts`
   - `readSessionTimeline(db, sessionId, opts)`
   - 合并 `t1_observations` + `t1_archive`，按 `turn_seq` 排序
   - 每个 turn 带 `feature`（稀疏事件码）、`summary`（fallback）、`archived`、`traceId`
   - 支持 `turnSeqs` / `fromTurn` / `toTurn` / `maxChars` / `includeRows`
   - 预算截断；不调 LLM
2. `gateway/src/recall/replay-block.ts`
   - `buildReplayBlock(turns, { mode, maxChars, perTurnChars })`
   - `forward` / `reverse` / `interleaved`
   - feature 可用时渲染 `[INTENT]/[ACTION]/[ERROR]/[DECISION]/[RESULT]`
   - 无 feature 时回退 `[TURN] summary`
   - 所有行带 `[trace:<id>]`；有界、可回指
3. `TurnPipeline`
   - 优先使用 ordered timeline replay（active + archive）
   - 失败/legacy/fake DB 回退到原来的 priority transcript
   - `base` 标签按 replay/transcript 区分

## 测试

新增 **10 个测试**：

- `gateway/tests/unit/recall/session-timeline.test.ts`（4）
- `gateway/tests/unit/recall/replay-block.test.ts`（6）
- `turn-pipeline-features.test.ts` 扩展断言：prompt 含 `--- REPLAY START` 与 `[trace:...][INTENT]`

focused：`tests/unit/recall` + T1 features + turn pipeline = 50 suites / 323 tests 全绿。
`tsc --noEmit -p tsconfig.json` rc=0。

## 已知限制

- T1 检索还没有 feature channel；当前仍是 FTS + dense。
- `t1.denseIndex: on | off | shadow` 尚未实现。
- `readSessionTimeline` 的 summary 仍是确定性 fallback；LLM turn summary 可选，尚未接。
- 回填 CLI/HTTP 入口仍未接。

## 下一步

1. `t1_feature_fts` + `searchT1Features`，三路 RRF（dense + FTS + feature）
2. `t1.denseIndex` 配置与 baseline 对比
3. 接 reflection / reconsolidate 使用 timeline
