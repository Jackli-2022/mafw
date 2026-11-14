# Gateway E10c 契约覆盖（第三批）— Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** memory/recall/lead 8 个读接口 code-first schema；覆盖 45 → 53/318；`memory.search` override 转 code-first。

**Spec:** `docs/superpowers/specs/2026-11-14-gateway-e10c-memory-recall-coverage-design.md`

## Global Constraints

- TDD；一个实现 commit + 一个收口 commit。
- 不改 wire；schema 只加元数据。
- 隔离 `.superpowers/e10c-worktree` + 分支 `feat/gateway-e10c-memory-recall-coverage`。
- 已知环境红沿用。

### Task 1: 8 个读接口 schema（E10c-1）

**Files:** `gateway/src/routes/schemas/memory.ts`（新）、`recall.ts`（新）、`lead.ts`（新）、`route-catalog.ts`、`contract/overrides.json`、`contract-compat.checks.ts`、`schema-coverage.test.ts`、生成物。

- [ ] 8 个 op 的 TypeBox schema；`memory.search` 的 `results` 与 `MemoryUnit` AssertEq；`memory.get` 成功/失败体。
- [ ] 删除 `memory.search` override，`$comment` 记录；`gen:api` diff 审计。
- [ ] 覆盖率清单 45 → 53，TOTAL_OPS 318；api-contract 断言每个 op。
- [ ] Commit `feat(contract): memory and recall read response schemas (E10c-1)`。

### Task 2: 收口（E10c-2）

- [ ] docs `gateway.md` 覆盖台账 53/318、override 13 → 12。
- [ ] release `docs/releases/2026-11-14-gateway-e10c-memory-recall-coverage.md`。
- [ ] 全量门禁 + 终审 + 合并 + 部署。
- [ ] Commit `docs(gateway): E10c contract coverage closeout (E10c-2)`。

## Ledger

`.superpowers/sdd/2026-11-14-gateway-e10c-contract/progress.md`
