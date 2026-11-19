# Snapshot Current-query Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阻止“构建 snapshot 时相关、当前轮已不相关”的预渲染记忆块直接注入，并过滤不相关邻居与重复 T1 证据。

**Architecture:** 在 snapshot serve 前增加一个纯函数适配器：用现有 lexical-support 对当前 query 与 snapshot 的结构化 metadata 做校验；无当前轮支持则回退 live fallback，有支持则只保留受支持 anchor、独立受支持的邻居和非冗余 T1 行，再确定性重渲染。旧 snapshot 没有结构化 metadata 时保持 legacy 行为，10 分钟 TTL 后自然消失。

**Tech Stack:** TypeScript、Jest、现有 `lexical-support.ts`、`inject-format.ts`、`verbatim-recall.ts`。

**Spec:** 用户提供的 2026-11-19 误召回块；`docs/research/2026-11-19-recall-next-bottleneck.md`；`docs/architecture/memory.md` snapshot 与 lexical veto 契约。

## Global Constraints

- 普通 low-confidence/no-memory 本体继续抑制，不新增 lexical-clue，不改 FOK 阈值。
- 只修改 snapshot serve/结构化 metadata；live fallback、固定 40 条、note-board、FOK 构建逻辑不变。
- 当前 query 没有词级单位或没有任何受支持候选时，snapshot 不得 serve，必须回 live fallback。
- 邻居必须同时对当前 query 有独立词级支持，且其 anchor 被保留；不允许仅因 anchor 相关就带出无关邻居。
- T1 与 Harmonic 共享同一个长度 ≥12 的 ASCII 标识短语时视为冗余，Harmonic 已展示则不再重复 T1；T1 自身只做精确规范化去重，不做激进去重。
- 旧 snapshot 缺结构化 metadata 可保持 legacy serve；有 metadata 时必须过滤。
- fail-open 仅用于异常，不得用于“当前 query 无支持”的明确拒绝。
- 子代理不 commit/build/restart；父会话统一 review、测试、提交和部署。

## Review Focus

- “再分析一下”与示例 snapshot 无支持时必须 fallback，而不是原样注入 7 条 Harmonic + 3 条 T1。
- 查询“子代理实施用哪个模型”时只保留模型偏好，不带 bash 错误邻居，不重复 3 条 T1。
- 查询“记忆召回延迟”时示例 snapshot 应 fallback，让 live 路径寻找当前性能记忆。
- 保留多个合法 Harmonic anchor 时顺序、类型分组、知识更新提示不变。
- legacy snapshot / episodes / 空 T1 / 无 cue_anchors / 异常均要有明确行为。

---

### Task 1: Current-query snapshot admission and rendering

**Files:**
- Create: `gateway/src/recall/snapshot-current-query.ts`
- Create: `gateway/tests/unit/recall/snapshot-current-query.test.ts`
- Modify: `gateway/src/routes/recall.ts`
- Modify: `gateway/src/recall/recall-snapshot.ts`（结构化 memories 增加 optional cue_anchors）
- Modify: `gateway/src/recall/snapshot-builder.ts`（保存 anchor cue_anchors）
- Modify: `gateway/src/recall/recall-context.ts` / `gateway/src/kernel.ts`（仅为邻居保留 cue_anchors，如实现需要）
- Modify: `gateway/src/recall/recall-metrics.ts`（snapshotDecision 增加 `current-query-filter`）
- Test: `gateway/tests/unit/recall/recall-route-metrics.test.ts` 及 snapshot 既有测试

**Interfaces:**
- Produces:
  - `adaptSnapshotToCurrentQuery(snapshot: RecallSnapshot, query: string): { action: 'serve'; snapshot: RecallSnapshot; kept: { anchors: number; neighbors: number; t1: number } } | { action: 'fallback'; reason: 'no-query-units' | 'no-current-support' | 'empty-render' | 'episodes-unsupported' }`
  - route 在 `decision==='use' && snapFok==='inject'` 后、记录曝光前调用。
- 不重写 DB 中的 snapshot；返回新对象，原对象不可变。

- [ ] **Step 1: 写失败测试**

至少覆盖：
1. 用户示例：`再分析一下` → fallback，不能 serve 原 block。
2. `记忆召回延迟` → fallback。
3. `子代理实施用哪个模型` → 仅保留 `nzi4oy`，删除 `jviztm` 邻居，T1 因共享 `deepseek-v4.1-flash` 被去重。
4. 邻居自己支持 query 且 anchor 保留时才可保留。
5. 无 query units、无支持、空 render → fallback。
6. legacy 无结构化 metadata → 原样 serve。
7. episodes snapshot → fallback（不擅自重渲染 layered episode block）。
8. 原 snapshot 对象不被修改。

- [ ] **Step 2: 运行 RED**

Run: `cd gateway; npx jest tests/unit/recall/snapshot-current-query.test.ts --runInBand`

Expected: 新模块不存在或行为未实现而 FAIL。

- [ ] **Step 3: 最小实现**

- 复用 `selectLexicallySupportedCandidates`，不复制 query tokenization。
- Harmonic anchor 与 T1 excerpt 分别计算当前 query 支持；两者都零支持时 fallback。
- anchor 顺序不变；neighbor 必须独立支持且 anchor 保留。
- 用 `formatRecallContext` 重渲染 Harmonic，用 `renderT1Lines` 重渲染 T1。
- T1 与保留 Harmonic 共享长度 ≥12 ASCII 标识短语时删除 T1；T1 自身只做 NFKC/lowercase/whitespace 精确去重。
- 结构化 snapshot 增加 optional `cue_anchors`，不改变旧快照读取。

- [ ] **Step 4: 接入 route**

- 仅对 `decision==='use'` 且 `fok=inject` 的 snapshot 调用。
- fallback 时设 `snapshotDecision='current-query-filter'` 并走既有 live fallback。
- serve 时使用 filtered snapshot 的 block/ids/memories/t1Hits 记录曝光、FOK sample 和 receipt。
- 记录 kept 计数，响应体形状不变。

- [ ] **Step 5: 验证 GREEN 与回归**

Run: `cd gateway; npx jest tests/unit/recall/snapshot-current-query.test.ts tests/unit/recall tests/unit/routes/memory-receipt-route.test.ts --runInBand; npx tsc --noEmit -p tsconfig.json`

Expected: 全部 PASS，类型门 exit 0。报告新增测试数、RED/GREEN 计数与残留风险。
