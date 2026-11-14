# Gateway E10d 契约覆盖（第四批）— Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** memory 扩展 / lead.context / pods 8 个读接口 schema；覆盖 53 → 61/318。

**Spec:** `docs/superpowers/specs/2026-11-14-gateway-e10d-memory-pods-coverage-design.md`

## Global Constraints

- TDD；一个实现 commit + 一个收口 commit。
- 不改 wire；schema 只加元数据。
- 隔离 `.superpowers/e10d-worktree` + 分支 `feat/gateway-e10d-memory-pods-coverage`。
- 已知环境红沿用。

### Task 1: 8 个读接口 schema（E10d-1）

**Files:** `gateway/src/routes/schemas/memory-extra.ts`（新）、`pods.ts`（扩展）、`lead-topics.ts`（扩展或新）、`route-catalog.ts`、`contract-compat.checks.ts`、`schema-coverage.test.ts`、生成物。

- [ ] 8 个 op 的 TypeBox schema；`pods.goals.worktree.diff` 对 `PodWorktreeDiff` AssertEq；`pods.transcript` runtime boundary。
- [ ] 覆盖率清单 53 → 61，TOTAL_OPS 318；api-contract 断言每个 op。
- [ ] `emit:openapi` + `gen:api`；diff 只允许 8 个目标 op。
- [ ] Commit `feat(contract): memory, lead and pod read response schemas (E10d-1)`。

### Task 2: 收口（E10d-2）

- [ ] docs `gateway.md` 覆盖台账 61/318。
- [ ] release `docs/releases/2026-11-14-gateway-e10d-memory-pods-coverage.md`。
- [ ] 全量门禁 + 终审 + 合并 + 部署。
- [ ] Commit `docs(gateway): E10d contract coverage closeout (E10d-2)`。

## Ledger

`.superpowers/sdd/2026-11-14-gateway-e10d-contract/progress.md`
