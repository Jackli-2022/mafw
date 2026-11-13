# Gateway E11 身份 / 配额硬化 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** token 轮换、内部会话账实、admission 二次校验、MCP human 边界审计。

**Spec:** `docs/superpowers/specs/2026-11-13-gateway-e11-identity-hardening-design.md`

## Global Constraints

- TDD；每项一个 commit `(E11-n)`。
- 不改变既有 human-only 语义；轮换只接受 `human-token` method。
- 隔离 `.superpowers/e11-worktree` + 分支 `feat/gateway-e11-identity-hardening`。
- 已知环境红沿用。

### Task 1: Human token 轮换（E11-1）

**Files:** `gateway/src/core/human-token.ts`、`gateway/src/routes/human-token.ts`（新）、`gateway/src/subsystems/api-routes.ts`、`gateway/src/kernel.ts`、`gateway/src/routes/route-catalog.ts`、`gateway/src/routes/schemas/human-token.ts`（新）、`bin/mafw.js`、`packages/desktop/src/main/mafw-ipc.ts`、`packages/desktop/src/main/human-token.ts` + tests。

- [ ] `rotateHumanToken` + 路由（human-token method only）+ catalog/schema + kernel live field + CLI。
- [ ] desktop `isStaleHumanTokenError` + `mafw-invoke` 一次重试。
- [ ] 测试：旧 token 失效/新 token 生效、device/service 403、文件 0600、CLI 不打印 token、desktop 重读重试。
- [ ] Commit `feat(auth): add human token rotation with live reload (E11-1)`。

### Task 2: 内部会话配额账实（E11-2）

**Files:** `gateway/src/kernel.ts` + tests。

- [ ] lead 注册 helper：失败回滚 internal identity、广播 `session.registration_failed`、消除静默 catch。
- [ ] 测试 quota=0 的失败路径与事件。
- [ ] Commit `fix(sessions): roll back internal identity when quota rejects lead registration (E11-2)`。

### Task 3: Admission 二次校验（E11-3）

**Files:** `gateway/src/scheduler/scheduler.ts`、`gateway/src/scheduler/task-descriptor.ts`（如需）、`gateway/src/kernel.ts` + tests。

- [ ] `resourceAdmission` 注入；pump 对非前台二次检查；governor 恢复时 `sweep()`。
- [ ] 测试降级/恢复/前台旁路。
- [ ] Commit `fix(scheduler): re-check resource admission when starting queued tasks (E11-3)`。

### Task 4: MCP human 边界审计（E11-4）

**Files:** `gateway/tests/unit/mcp/human-boundary.test.ts`（新）、`docs/architecture/gateway.md`、release。

- [ ] 名称快照 + 动词白名单 + 源码禁止标识符扫描。
- [ ] 文档：MCP human tools won't do；OS keychain / 进程签名 won't do + 缓解。
- [ ] Commit `test(mcp): guard the human-only boundary (E11-4)`。

### Task 5: 收口（E11-5）

- [ ] `gateway.md` / `operations.md`（CLI 命令）/ `desktop.md`（403 重试）；release。
- [ ] 全量门禁 + 终审 + 合并 + 部署。
- [ ] Commit `docs(gateway): E11 identity hardening closeout (E11-5)`。

## Ledger

`.superpowers/sdd/2026-11-13-gateway-e11-hardening/progress.md`
