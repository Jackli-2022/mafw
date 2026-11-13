# Gateway E10b 契约覆盖（第二批）— Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** 15 个读接口 code-first schema；覆盖 29 → 44 个 covered（合并 main 后 **44/317**）；5 个 override 转 code-first。

**Spec:** `docs/superpowers/specs/2026-11-13-gateway-e10b-contract-coverage-design.md`

## Global Constraints

- TDD；每批一个 commit `(E10b-n)`。
- 不改 wire；schema 只加元数据。
- 隔离 `.superpowers/e10b-worktree` + 分支 `feat/gateway-e10b-contract-coverage`。
- 生成物入库；`schema-coverage.test.ts` 清单与阈值同步。
- 已知环境红沿用（gateway 9、desktop resolver 1、TUI 缺包、mobile 并行 flake）。

### Task 1: Goal / Pod Goal 读接口（E10b-1）

**Files:** `gateway/src/routes/schemas/goals.ts`（新）、`pods.ts`（扩展）、`route-catalog.ts`、`gateway/tests/unit/api-contract.test.ts`、`gateway/tests/unit/architecture/schema-coverage.test.ts`、SDK checks、生成物。

- [ ] 8 个 op 的 TypeBox schema；`goals.list` / `goals.sessions` 先读 override，handler 为准；`Goal` / `GoalSessionInfo` / `PodGoalRevision` 加/保持 `AssertEq`。
- [ ] 覆盖率清单追加 8，阈值 29 → 37。
- [ ] `emit:openapi` + `gen:api`；api-contract 断言每个 op 200 schema + 关键字段。
- [ ] Commit `feat(contract): goal read response schemas (E10b-1)`。

### Task 2: Human-gate / 权限读接口（E10b-2）

**Files:** `schemas/human-gate.ts`（新）、`route-catalog.ts`、`contract/overrides.json`（删 5 条）、SDK checks、生成物。

- [ ] 7 个 op schema；`approvals.list` / `questions.list` / `triage.list` 以 handler 为准转 code-first，`Approval` / `QuestionRequest` / `TriageItem` AssertEq 保持。
- [ ] 删除 5 个被取代的 override 条目并更新 `$comment`；`gen:api` 验证只有预期 op 变化。
- [ ] 覆盖率清单追加 7，阈值 37 → 44。
- [ ] Commit `feat(contract): human-gate and permission read schemas (E10b-2)`。

### Task 3: 收口（E10b-3）

- [ ] docs：`gateway.md` 覆盖台账 44/317、override 18 → 13；`desktop.md` / `mobile.md` 如有消费面变化。
- [ ] release `docs/releases/2026-11-13-gateway-e10b-contract-coverage.md`。
- [ ] 全量门禁 + 终审 + 合并 + 部署（gateway + desktop 重建）。
- [ ] Commit `docs(gateway): E10b contract coverage closeout (E10b-3)`。

## Ledger

`.superpowers/sdd/2026-11-13-gateway-e10b-contract/progress.md`
