# Gateway E10e 契约覆盖（第五批）— Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** 元数据/注册面 8 个读接口 schema；覆盖 61 → 69/318。

**Spec:** `docs/superpowers/specs/2026-11-14-gateway-e10e-meta-coverage-design.md`

## Global Constraints

- TDD；一个实现 commit + 一个收口 commit。
- 不改 wire；schema 只加元数据。
- 隔离 `.superpowers/e10e-worktree` + 分支 `feat/gateway-e10e-meta-coverage`。
- 已知环境红沿用。

### Task 1: 8 个读接口 schema（E10e-1）

**Files:** `gateway/src/routes/schemas/meta.ts`（新）、`route-catalog.ts`、`contract-compat.checks.ts`、`schema-coverage.test.ts`、生成物。

- [ ] 8 个 op 的 TypeBox schema；4 个 DTO op 加 AssertEq；config/tools/skills/scheduler schema-only。
- [ ] 覆盖率清单 61 → 69，TOTAL_OPS 318；api-contract 断言每个 op。
- [ ] `emit:openapi` + `gen:api`；diff 只允许 8 个目标 op。
- [ ] Commit `feat(contract): metadata and registry read response schemas (E10e-1)`。

### Task 2: 收口（E10e-2）

- [ ] docs `gateway.md` 覆盖台账 69/318。
- [ ] release `docs/releases/2026-11-14-gateway-e10e-meta-coverage.md`。
- [ ] 全量门禁 + 终审 + 合并 + 部署。
- [ ] Commit `docs(gateway): E10e contract coverage closeout (E10e-2)`。

## Ledger

`.superpowers/sdd/2026-11-14-gateway-e10e-contract/progress.md`
