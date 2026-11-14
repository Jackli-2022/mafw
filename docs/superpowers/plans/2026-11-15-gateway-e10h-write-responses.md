# Gateway E10h 写响应契约 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** 193 个写响应 schema + `tts.speakStream` 排除；响应 127 → 320/327。

**Spec:** `docs/superpowers/specs/2026-11-15-gateway-e10h-write-responses-design.md`

## Global Constraints

- 同一 worktree `.superpowers/e10h-worktree` + 分支 `feat/gateway-e10h-write-responses`。
- 每批一个 commit，顺序执行。
- 只声明、不运行时校验；handler 为事实源。
- 生成物入库；`emit:openapi` + `gen:api` 幂等。

### P0: 台账 + pilot

- [ ] `schema-coverage.cjs` 输出 `writeResponses: X/195`（JSON + human）。
- [ ] pilot：`session.create`、`tasks.submit` 响应 schema。
- [ ] Commit `feat(contract): add write-response coverage ledger (E10h-P0)`。

### R1: session 写接口

### R2: pods

### R3: goals / decisions / lead / standing / cognition

### R4: events / automations / approvals / questions / triage / permissions

### R5: mcp / plugins / runtime / config / project / manager / commands / models

### R6: memory / media / tts / chat / python / obs / embedding / tools / eval / llm / mobile / devices / fileHistory / skills

### 收口

- [ ] `write-response-coverage.test.ts`（193 + 2 covered? + 1 excluded = 195）。
- [ ] docs + release + 全量门禁 + 终审 + 合并 + 部署。

## Ledger

`.superpowers/sdd/2026-11-15-gateway-e10h-responses/progress.md`
