# Gateway E10g 请求契约 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** 188 个写 op 的请求契约（JSON body / 空 body / 显式排除）。

**Spec:** `docs/superpowers/specs/2026-11-14-gateway-e10g-request-contracts-design.md`

## Global Constraints

- 同一 worktree `.superpowers/e10g-worktree` + 分支 `feat/gateway-e10g-request-contracts`。
- 每批一个 commit，顺序执行。
- 只声明、不运行时校验；handler 为事实源。
- 生成物入库；`emit:openapi` + `gen:api` 幂等。

### P0: 管线 + pilot

- [ ] `RouteDef.request/requestContentType/requestRequired` + `toOpenApiPaths()` requestBody。
- [ ] registry 单测（JSON / octet-stream / required:false）。
- [ ] `schema-coverage.cjs` 输出 `requests: X/188`。
- [ ] 3 个 pilot（`session.create`、`tasks.submit`、`pods.tasks.create`）。
- [ ] Commit `feat(contract): add requestBody schema plumbing (E10g-P0)`。

### W1: session 写接口

### W2: tasks / terminal / background / usage / subagents / fileHistory

### W3: pods

### W4: goals / decisions / lead / standing / goalRuns

### W5: events / automations / approvals / questions / triage / permissions

### W6: mcp / plugins / runtime / config / project / manager / commands

### W7: memory / media / tts / chat / python / obs / models / embedding / tools / eval / llm / mobile / devices / a2a

### 收口

- [ ] `request-coverage.test.ts`（全量覆盖 + 排除清单）。
- [ ] docs + release + 全量门禁 + 终审 + 合并 + 部署。

## Ledger

`.superpowers/sdd/2026-11-14-gateway-e10g-requests/progress.md`
