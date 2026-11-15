# Gateway E10i 错误响应契约 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** 全部 327 op 有 `default` 错误包；`/api/*` 有 401/403；高价值域补显式状态码。

**Spec:** `docs/superpowers/specs/2026-11-15-gateway-e10i-error-contracts-design.md`

## Global Constraints

- 同一 worktree `.superpowers/e10i-worktree` + 分支 `feat/gateway-e10i-error-contracts`。
- 每批一个 commit，顺序执行。
- 只声明、不运行时校验；handler 为事实源。
- 生成物入库；`emit:openapi` + `gen:api` 幂等。

### P0: 管线 + 全局错误包

- [ ] `ErrorEnvelope` + `RouteDef.errors/errorSchemas/errorDescription`。
- [ ] `toOpenApiPaths()`：所有 op `default`；`/api/` op 401/403；显式状态投影。
- [ ] registry 单测；api-contract 抽样。
- [ ] Commit `feat(contract): add error response plumbing (E10i-P0)`。

### E1: session + pods 显式状态码

### E2: goals/decisions/lead/standing + events/automations/approvals/questions/triage/permissions

### E3: plugins/runtime/config/mcp + memory/media/tts/mobile/devices + 收口守卫

### 收口

- [ ] `error-coverage.test.ts`（default 327/327、/api 401/403、显式状态最低数）。
- [ ] docs + release + 全量门禁 + 终审 + 合并 + 部署。

## Ledger

`.superpowers/sdd/2026-11-15-gateway-e10i-errors/progress.md`
