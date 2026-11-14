# Gateway E10f 全量读表面收口 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** 56 个 JSON GET schema（69 → 125/318）+ 4 个工程尾巴；overrides 12 → 11。

**Spec:** `docs/superpowers/specs/2026-11-14-gateway-e10f-read-completion-design.md`

## Global Constraints

- 同一 worktree `.superpowers/e10f-worktree` + 分支 `feat/gateway-e10f-read-completion`。
- 每批一个 commit；顺序执行，禁止并行改 catalog/生成物。
- handler 为事实源；边界对象带 owner 注释；生成物入库。
- 已知环境红沿用。

### Task 1: E10f-A 会话/任务/终端/usage（16 ops）

- [ ] schemas + catalog + coverage 69 → 85 + api-contract 断言 + 生成物。
- [ ] Commit `feat(contract): session, task and usage read schemas (E10f-A)`。

### Task 2: E10f-B 项目/manager/runtime/元数据（16 ops）

- [ ] schemas + coverage 85 → 101 + 生成物。
- [ ] Commit `feat(contract): project, runtime and metadata read schemas (E10f-B)`。

### Task 3: E10f-C Goal/Lead/Events/Standing/Automations/Pods（16 ops）

- [ ] `automations.list` override → code-first 并删条目；coverage 101 → 117。
- [ ] Commit `feat(contract): goal, event and automation read schemas (E10f-C)`。

### Task 4: E10f-D 观测/设备/A2A（8 ops）

- [ ] schemas + coverage 117 → 125。
- [ ] Commit `feat(contract): observability, device and A2A read schemas (E10f-D)`。

### Task 5: E10f-E 工程尾巴（4 项）

- [ ] perNoteCap；HarmonicUnit 编译期桥；session.list override 清理；mobile triage 兜底。
- [ ] Commit `fix(contract): close E10 read-surface gaps (E10f-E)`。

### Task 6: 收口（E10f-close）

- [ ] docs + release + 全量门禁 + 终审 + 合并 + 部署。
- [ ] Commit `docs(gateway): E10f read-surface completion closeout (E10f-close)`。

## Ledger

`.superpowers/sdd/2026-11-14-gateway-e10f-coverage/progress.md`
