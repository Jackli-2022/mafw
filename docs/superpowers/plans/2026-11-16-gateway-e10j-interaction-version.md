# Gateway E10j 交互与版本协商补齐 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** TUI triage 真实字段 + SDK/desktop/TUI 自动 schema epoch。

**Spec:** `docs/superpowers/specs/2026-11-16-gateway-e10j-interaction-version-design.md`

## Global Constraints

- 隔离 `.superpowers/e10j-worktree` + 分支 `feat/gateway-e10j-interaction-version`。
- 每批一个 commit。
- 不新增 API；不改 gateway wire。

### J1: TUI triage 对齐

- [ ] `triage-view-model.ts` + `triage-tab.ts` 改造 + `tests/triage-view-model.test.ts`。
- [ ] Commit `fix(tui): render real triage wire fields (E10j-J1)`。

### J2: 自动 schema epoch

- [ ] SDK option `schemaEpoch?: number | 'auto'`；client request 缓存/重试；desktop/TUI opt-in。
- [ ] SDK client tests + desktop tests + TUI 纯函数测试。
- [ ] Commit `feat(sdk): negotiate schema epoch automatically (E10j-J2)`。

### J3: 收口

- [ ] docs + release + 全量门禁 + 终审 + 合并 + 部署。
- [ ] Commit `docs(gateway): E10j interaction/version closeout (E10j-J3)`。

## Ledger

`.superpowers/sdd/2026-11-16-gateway-e10j/progress.md`
