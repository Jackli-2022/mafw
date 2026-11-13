# Gateway E10 契约覆盖（第一批）— Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 16 个读接口加 response schema + SDK `AssertEq` + 覆盖率台账 + `session.get` 404。

**Spec:** `docs/superpowers/specs/2026-11-13-gateway-e10-contract-coverage-design.md`

## Global Constraints

- TDD；每批一个 commit `(E10-n)`。
- 不改 wire（E10-3 的 404 除外）；schema 只加元数据。
- 隔离 `.superpowers/e10-worktree` + 分支 `feat/gateway-e10-contract-coverage`。
- 已知环境红沿用：gateway 9 tests / 3 suites、desktop resolver 1、TUI 缺包、mobile 并行 flake。
- 生成物入库：`gateway-paths.json`、`openapi.json`、`api-schema.gen.ts`。

### Task 1: 会话读接口 schema（E10-1）

**Files:** `gateway/src/routes/schemas/session.ts`（或新增 `session-read.ts`）、`route-catalog.ts`、`packages/gateway-sdk/src/contract-compat.checks.ts`、生成物。

- [ ] 为 spec §E10-1 的 8 个 op 写 TypeBox schema，字段以 handler 实际返回为准；`Session & {depth}` 用 `SessionSchema` 组合。
- [ ] catalog 挂 `response`；`emit:openapi` + SDK `gen:api`。
- [ ] 对 `Todo` / `QueueItem` / `SessionCheckpoint` 等已有 DTO 加 `AssertEq`；冲突以 handler 为准修 DTO 并报告消费者。
- [ ] 测试：api-contract 断言 8 个 op 有 200 schema 且关键字段存在；SDK tsc。
- [ ] Commit `feat(contract): session read response schemas (E10-1)`。

### Task 2: Pod / Work 读接口 schema（E10-2）

**Files:** `gateway/src/routes/schemas/pods.ts`（扩展）、`work.ts`（新）、`route-catalog.ts`、SDK checks、生成物。

- [ ] 为 spec §E10-2 的 8 个 op 写 schema；`PodGoal` / `PodTask` / `PodMessage` / `PodGoalResult` / `PodReviewItemList` / `PodEventItem` 加 `AssertEq`。
- [ ] `work.overview` 与 mobile 解析对齐（`mobile/lib/src/models/work_models.dart` 或等价文件）。
- [ ] `emit:openapi` + SDK `gen:api` + 测试。
- [ ] Commit `feat(contract): pod and work read response schemas (E10-2)`。

### Task 3: 覆盖率台账 + `session.get` 404（E10-3）

**Files:** `gateway/scripts/schema-coverage.cjs`、`gateway/package.json`、`gateway/tests/unit/architecture/schema-coverage.test.ts`、`gateway/src/routes/sessions-core.ts`、desktop 调用方、SDK docs/tests。

- [ ] `schema:coverage` 脚本：总数/覆盖数/按 tag/未覆盖清单；测试断言 `E10_COVERED_OPS` 全部有 schema 且覆盖数 ≥ 29。
- [ ] `session.get` 缺失改 404（body 不变）；审计 desktop `ChatPane`/`MafwShell`/`session-status` 与 SDK 调用方，补错误处理；gateway 测试覆盖 404。
- [ ] 不引入其他 wire 变更。
- [ ] Commit `feat(contract): schema coverage report and session.get 404 (E10-3)`。

### Task 4: 收口（E10-4）

- [ ] docs：`gateway.md`（覆盖率台账口径 + 404）、`desktop.md`（session 缺失处理）、`mobile.md`（如有）。
- [ ] release `docs/releases/2026-11-13-gateway-e10-contract-coverage.md`：基线 13/316、新增 16、终值 29/316、commits、门禁、已知红、剩余 deferred。
- [ ] 全量门禁 + 终审 + 合并 + 部署。
- [ ] Commit `docs(gateway): E10 contract coverage closeout (E10-4)`。

## Ledger

`.superpowers/sdd/2026-11-13-gateway-e10-contract/progress.md`

## Progress log

- [ ] Batch 1 (Task 1) dispatched
- [ ] Batch 2 (Task 2) dispatched
- [ ] Batch 3 (Task 3) dispatched
- [ ] Closeout (Task 4) dispatched
