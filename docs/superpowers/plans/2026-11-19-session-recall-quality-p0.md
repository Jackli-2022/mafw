# Session Recall Quality P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 filtered snapshot 的 FOK 校准污染，并用真实 session fixture 建立块级 precision、answer coverage、false display 与 legitimate suppression 的可复现基线。

**Architecture:** FOK 只保留未过滤 snapshot 的原始概率/ids 对应样本。评测以冻结 JSON 为输入，直接调用真实 `decideSnapshotUse` + `adaptSnapshotToCurrentQuery`，纯函数计算指标；不写生产 DB、不调用模型、不改变生产准入。

**Tech Stack:** TypeScript、Jest、现有 snapshot pure functions、ts-node、JSON fixtures。

**Spec:** `docs/research/2026-11-19-recall-quality-improvement.md` §1.6、§4 P0、§5；种子数据 `Temp/opencode/session-recall-seed.json`。

## Global Constraints

- 主 checkout；不建 worktree/分支、不 push、不覆盖其他会话改动。
- 固定 40 条及期望不变；live 指标继续由 `evaluation/personal-recall` 单独报告。
- 不改 FOK 阈值、lexical veto、containment、snapshot 当前轮准入或任何生产返回块。
- 首版明确为 **bootstrap**，不称公共 benchmark；真实误展示可以作为当前基线，不得修改标注来制造改善。
- 标注单位 `(turn, memory id)`；answer family 同时含参考陈述与等价 ids；neighbor-only 不计入主 answer coverage。
- legitimate suppression 只统计 pre-admission `snapshot.memories` 中 answer/context 候选被丢弃，不把 pool miss 算入。
- 无分母时指标为 `null`，同时返回 numerator/denominator；不得把 0/0 当作 100%。
- 子代理不 commit/build/restart、不跑全量、不派生子代理、不调用记忆工具；父会话统一 review、验证、部署。
- 种子 JSON 只读；fixture 冻结后不得从 live DB 自动更新。

## Review Focus

- filtered snapshot 即使仍含原 top1 也不写错位 FOK 样本；unfiltered 仍写 → Task 1 route 测试。
- stale/topic-shift/FOK/no-current-support 都无展示，但不能把空分母算作满分 → Task 2 指标测试。
- 同一 expected id 仅在 neighbor 展示时，主 answer coverage 不命中 → Task 2 测试。
- 负例中的 noise 被实际展示才计 false display；候选被过滤则计入相应 suppression → Task 2 测试。
- 真实 fixture 的角色/标签/id 必须完整且只读种子转换，运行结果不得改变 fixture → Task 2 校验与 baseline。

---

### Task 1: Exclude filtered snapshots from original-window FOK samples

**Files:**
- Modify: `gateway/src/routes/recall.ts`
- Test: `gateway/tests/unit/recall/recall-route-metrics.test.ts`
- Modify: `docs/architecture/memory.md`

**Interfaces:**
- Consumes: 现有 `adapted.kept.filtered`、`served.top1prob`、`appendFokEvent`。
- Produces: `adapted.kept.filtered === true` 时不 append 原 window FOK sample；false 时现有样本不变。

- [ ] **Step 1: 写失败测试**

新增 filtered snapshot serve 测试：曝光/receipt 仍用 filtered ids，但 `appendFokEvent` 不调用；既有 unfiltered snapshot 测试继续断言样本写入。若既有测试未断言，则先补该正常行为断言。

- [ ] **Step 2: 运行 RED**

Run: `cd gateway; npx jest tests/unit/recall/recall-route-metrics.test.ts --runInBand`
Expected: 当前 filtered serve 仍写原 top1prob/ids，新增断言 FAIL。

- [ ] **Step 3: 最小实现与文档**

只在 snapshot FOK sample 写入点跳过 filtered；文档说明原因与未过滤路径不变。

- [ ] **Step 4: 验证 GREEN**

Run: `cd gateway; npx jest tests/unit/recall tests/unit/routes/memory-receipt-route.test.ts --runInBand; npx tsc --noEmit -p tsconfig.json`
Expected: 全 PASS，类型门 exit 0。

### Task 2: Frozen session-shaped quality evaluator and bootstrap baseline

**Files:**
- Create: `gateway/src/recall/session-quality.ts`
- Create: `gateway/tests/unit/recall/session-quality.test.ts`
- Create: `evaluation/session-recall/fixtures.json`
- Create: `evaluation/session-recall/run.ts`
- Create: `evaluation/session-recall/README.md`
- Create: `evaluation/session-recall/baseline.json`（由 runner 生成）
- Modify: `docs/architecture/memory.md`

**Interfaces:**
- `evaluateSessionSnapshotFixture(fixture: SessionSnapshotQualityFixture): SessionSnapshotQualityResult` 调用真实 snapshot decision/adapter，返回 decision、kept ids/roles 与四项主/安全指标的分子分母。
- `summarizeSessionSnapshotQuality(results: readonly SessionSnapshotQualityResult[]): SessionSnapshotQualitySummary` 聚合样本，并保留 per-case 结果。
- Fixture 包含 `id/currentQuery/now/snapshot/origin/annotations/expectedAnswerFamilies/isNoAnswerControl`；annotation label 为 `answer|context|noise|repeat|stale-or-conflict`。
- 主指标：`usefulAnchorPrecision`、`answerCoverage`；安全指标：`falseDisplay`、`legitimateSuppression`。另报 serve/filter、neighbor precision、T1 repeat 作为诊断。
- Runner：`npx ts-node --project gateway/tsconfig.json evaluation/session-recall/run.ts --out evaluation/session-recall/baseline.json`。

- [ ] **Step 1: 写失败测试与最小 fixture**

测试覆盖：正确 anchor+noise 混合、真实负例 false display、合法 answer/context 被过滤、neighbor-only 不命中 answer coverage、零分母 null、decision/adapter fallback、输入不可变、annotation 缺 id/未知 id/重复角色校验。

- [ ] **Step 2: 运行 RED**

Run: `cd gateway; npx jest tests/unit/recall/session-quality.test.ts --runInBand`
Expected: 新模块不存在而 FAIL。

- [ ] **Step 3: 实现纯 evaluator 与 fixture validator**

使用真实 snapshot 函数，不复制准入逻辑。指标返回 `{numerator,denominator,value}`；空分母 value=null。answer coverage 只认 anchor；false display 对 no-answer control 的实际 noise 展示计数；legitimate suppression 只看 pre-admission answer/context。

- [ ] **Step 4: 冻结三个 bootstrap fixture 并实现 runner**

从种子只读转换：两条用户提供的真实误展示/偏题块 + 当前真实 model-preference 混合 snapshot。每个 id 标 answer/context/noise/repeat/stale；参考陈述与等价 ids 预注册。fixture 明示 bootstrap 与非公共 benchmark。

- [ ] **Step 5: 运行 GREEN、生成 baseline、写文档**

Run: `cd gateway; npx jest tests/unit/recall/session-quality.test.ts tests/unit/recall/recall-route-metrics.test.ts --runInBand; npx tsc --noEmit -p tsconfig.json; cd ..; npx ts-node --project gateway/tsconfig.json evaluation/session-recall/run.ts --out evaluation/session-recall/baseline.json`
Expected: 全 PASS，类型门 exit 0；baseline 可复现，真实负例不得被标成正确。
