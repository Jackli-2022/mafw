# Session Recall Quality P1 Shadow Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用冻结的 snapshot/live 对照判断当前误展示来自哪一层，并验证一个确定性的 TopicState entity/key + raw-query facet 约束是否值得扩样。

**Architecture:** 保留 P0 evaluator 与 baseline 数值；新增 shadow evaluator 包装真实 P0 结果、原始 snapshot block 和冻结 live block。Topic/facet 是独立离线 admission，不接生产 route。shadow runner 生成独立 baseline 与一致性测试。

**Tech Stack:** TypeScript、Jest、现有 session-quality / snapshot pure functions、ts-node、JSON fixtures。

**Spec:** `docs/research/2026-11-19-recall-quality-improvement.md` §4 P1；种子 `Temp/opencode/session-recall-live-seed.json`、`session-topic-audit-seed.json`。

## Global Constraints

- 主 checkout；不建 worktree/分支、不 push、不覆盖其他会话改动。
- 本切片是 **P1 shadow pilot**，不改生产 route、FOK、lexical veto、containment、snapshot 准入或返回块。
- 固定 40 不改；P0 四项数值不变。P0 baseline 若因 fixture metadata 扩展需重生成，只允许元数据变化。
- 不把 3 条 pilot 当 benchmark；本切片先决定是否值得扩样，不宣称泛化。
- live-only 臂使用捕获后冻结的 API block，不在 runner 中请求 live Gateway；命名为 `live-frozen`。
- TopicState 是可能过期的注意力状态，不是事实源；aliases/entities/retrievalKeys 为空或换题不确定时回退当前规则。
- 子代理不 commit/build/restart、不跑全量、不派生子代理、不调用记忆工具；父会话统一 review 与验证。

## Review Focus

- `current-query-off` 只绕过当前轮 adapter，保留 decision/FOK，不得误称整个 live lexical veto 都被关闭。
- live 无 recall body 时 display=0、falseDisplay=0/1，但 legitimate suppression=null（没有 pre-admission pool）。
- Topic/facet 只把 entities/aliases/retrievalKeys 作为候选领域证据；topic/summary 仅用于可用性/不确定性，避免“质量”一词成为领域捷径。
- 确定性 exact evidence 可在 Topic/facet 中旁路；其他 candidate 必须同时有领域和 raw-query 支持。
- 每个 arm 都保留 per-case displayed/suppressed/families 与 measurement warnings，不能只报聚合。

---

### Task 1: Four-arm frozen shadow evaluator and fixtures

**Files:**
- Create: `gateway/src/recall/session-quality-shadow.ts`
- Create: `gateway/tests/unit/recall/session-quality-shadow.test.ts`
- Modify: `evaluation/session-recall/fixtures.json`
- Modify: `evaluation/session-recall/baseline.json`（仅新 fixture metadata 的同步）
- Create: `evaluation/session-recall/run-shadow.ts`
- Create: `evaluation/session-recall/shadow-baseline.json`
- Modify: `evaluation/session-recall/README.md`
- Modify: `docs/architecture/memory.md`

**Interfaces:**
- `evaluateSessionShadowFixture(fixture, { snapshotConfig })` 返回四臂：`snapshot-current`（真实 P0）、`current-query-off`（decision+FOK 后原 block）、`live-frozen`、`topic-facet`。
- 每臂复用 P0 的 `SessionSnapshotQualityResult` 字段；新增 `arm`，并在 shadow summary 按 arm 聚合四项主/安全指标与诊断。
- Fixture 每 case 增加可选 `liveCapture: { capturedAt, block }`、独立 `liveAnnotations`、`topicState`；live 与 snapshot id 可不同，分别校验 answer 标签属于 expected family。
- Topic/facet 候选规则：exact evidence 旁路；否则 active/usable 时要求 entities/aliases/retrievalKeys 领域支持 AND raw currentQuery 支持；neighbor 仍需 anchor 保留。无可用领域或 `snapshotContainment(topic+summary, rawQuery) < 0.25` 时回退当前 adapter。
- 不重写 Harmonic/T1 去重算法：Topic/facet 只替换 Harmonic 的当前支持选择，T1 保留当前规则。

- [ ] **Step 1: 写失败测试**

覆盖：off 臂保留原块；live 无 body/有 body；live 无 pre-pool 时 suppression=null；topic/facet 拒绝仅有“质量”而无 entity/key 的候选；exact id 旁路；无 topic/空领域/低 containment 回退；neighbor anchor 被删；输入不可变与零分母。

- [ ] **Step 2: 运行 RED**

Run: `cd gateway; npx jest tests/unit/recall/session-quality-shadow.test.ts --runInBand`
Expected: 新模块/四臂缺失而 FAIL。

- [ ] **Step 3: 最小实现**

复用 P0 evaluator、真实 snapshot decision/adapter、lexical support、exact evidence 与现有 renderer；不得修改生产模块。对 shadow 自定义 arm 明确标识 replay。

- [ ] **Step 4: 冻结 live/topic 数据并生成 shadow baseline**

从两个种子只读转换；live annotations 独立审查。冻结 TopicState 审计：9 total / 5 active；summary、entities、openLoops、retrievalKeys 各 4/5，aliases 0/5；当前 summary 含旧“误注入已清零/implicit 2/10”，标为 stale-risk。

Run: `npx ts-node --project gateway/tsconfig.json evaluation/session-recall/run-shadow.ts --out evaluation/session-recall/shadow-baseline.json --generated-at <fixed>`

- [ ] **Step 5: 验证 GREEN 与 P0 不回退**

Run: `cd gateway; npx jest tests/unit/recall/session-quality-shadow.test.ts tests/unit/recall/session-quality.test.ts tests/unit/recall/session-quality-runner.test.ts --runInBand; npx tsc --noEmit -p tsconfig.json`
Expected: 全 PASS；P0 数值不变，shadow 四臂结果可复现。

### Task 2: Shadow runner consistency gate and pilot decision report

**Files:**
- Create: `gateway/tests/unit/recall/session-quality-shadow-runner.test.ts`
- Modify: `evaluation/session-recall/run-shadow.ts`
- Modify: `evaluation/session-recall/shadow-baseline.json`
- Modify: `evaluation/session-recall/README.md`
- Create: `docs/research/2026-11-19-session-recall-p1-shadow-results.md`

**Interfaces:**
- Consumes: Task 1 runner 输出与四臂结果。
- Produces: 固定 generatedAt 重跑，对 fixture/config/arms/summary/cases/codeFingerprint 与 checked-in shadow baseline 一致；记录实际命令与代码指纹。

- [ ] **Step 1: 写失败一致性测试**

覆盖 import runner 不执行 main、陈旧 shadow baseline 会失败、当前 pilot 的核心结果字面锁定、显式 override 会改变 decision。

- [ ] **Step 2: 运行 RED**

Run: `cd gateway; npx jest tests/unit/recall/session-quality-shadow-runner.test.ts --runInBand`
Expected: 一致性 API/当前产物缺失导致 FAIL。

- [ ] **Step 3: 最小修复并写结果报告**

报告逐臂 precision/coverage/false display/suppression、真实负例是否消失、live 与 snapshot 的边际质量、TopicState 风险；只能给“继续扩样/停止/再设计”的 pilot 判定，不给生产上线结论。

- [ ] **Step 4: 验证 GREEN**

Run: `cd gateway; npx jest tests/unit/recall --runInBand; npx tsc --noEmit -p tsconfig.json`
Expected: 全 PASS，P0 与 shadow 数值均可复现。
