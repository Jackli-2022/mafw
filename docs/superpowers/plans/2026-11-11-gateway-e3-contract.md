# Gateway E3 契约硬化 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 契约层收口：幽灵 op 删除 + 可达性守卫、Mode B 删除、框架级错误码、Experience 动作绑定、opt-in 版本校验、4 个读接口 schema 增量。全部 TDD。

**Architecture:** 删除已死面（11 ops、dashboard 死模块、Mode B），把"catalog=可达面"变成数据驱动守卫；框架边界统一错误码；版本头 opt-in；schema 只加元数据。

**Tech Stack:** TypeScript (CJS), Jest（gateway）、node --test（SDK/desktop），无新依赖。

**Spec:** `docs/superpowers/specs/2026-11-11-gateway-e3-contract-hardening-design.md`

## Global Constraints

- TDD 铁律；每项一个 commit `(E3-n)`。
- 正常路径响应形状不变；错误只加字段；删除的都是不可达/已死面。
- 隔离工作区 `.superpowers/e3-worktree` + 分支 `feat/gateway-e3-contract-hardening`（基 main；若 main 前移以此为准）。
- 契约产物：catalog 变更后 `npm run emit:openapi` + SDK `merge-contract.mjs`（openapi-typescript 若环境缺则记录）。
- 已知环境红名单沿用（claude-adapter ×2、plugin-package-e2e、desktop resolver 需 dist）。

## Review Focus

1. **可达性守卫的准确性**：动态 attach（pods/wave 循环）不能被误判为未挂载；allowlist 每项有人话 reason；删除 11 op 前必须实测"确实无 handler"。
2. **Mode B 删除的兼容**：`/api/events?sessionID=x` 必须仍能订阅（忽略参数走 Mode A），不能 404/挂起。
3. **409 只对主动携带 epoch 的客户端**触发；未携带永远放行。
4. **错误码只加不改**：所有既有 `error` 字符串保持。
5. **schema 增量不改 wire**：只加 openapi 元数据。

---

### Task 1: 可达性守卫（RED）+ 幽灵清理（E3-1）

**Files:** Modify `gateway/tests/unit/api-contract.test.ts`；Delete `gateway/src/dashboard/`；Modify `gateway/src/routes/route-catalog.ts`；Emit artifacts.

**Interfaces:** 守卫数据：`buildRouteCatalog()` × 源码扫描 `attachHandler('...')` × 三类 allowlist（`TRANSPORT_ALLOWLIST` / `DASHBOARD_RESIDUE_ALLOWLIST` / `RUNTIME_PROXY_ALLOWLIST`，每项 `{id, reason}`）。

- [ ] Step 1: RED — 写守卫：`catalog − attached − allowlist = ∅`；先跑出当前差集（应暴露 11 个幽灵 + 可能的动态 attach 误判），把动态 attach 的 id 来源识别出来（pods/wave 的循环数组）。
- [ ] Step 2: 确认 11 个幽灵确实无 handler（grep + 运行时既有测试），删 catalog 条目；删死模块 `src/dashboard/`；emit:openapi + merge-contract。
- [ ] Step 3: GREEN — 守卫通过；`analyze-routes` 0；`node node_modules/jest/bin/jest.js tests/unit/api-contract.test.ts tests/unit/architecture/ --no-coverage` 绿。
- [ ] Step 4: Commit `refactor(contract): reachability guard and ghost-op cleanup (E3-1)`。

### Task 2: 删除 Mode B（E3-2）

**Files:** Modify `gateway/src/routes/events-sse.ts`、`gateway/src/runtime/event-dispatch.ts`、`gateway/src/kernel.ts`（ctx 构建）、`packages/gateway-sdk/src/{client,types,client.test,types.test}.ts`；Delete `gateway/src/chat/chat-sessions.ts` + 测试。

- [ ] Step 1: 现状测试（RED）——`/api/events?sessionID=x` 仍订阅 Mode A（忽略参数）；当前会走 Mode B（测试应显示差异后再改）。
- [ ] Step 2: 删除 Mode B 分支 + stage 22 + chatSessions deps + 模块 + SDK 方法；更新 event-dispatch 测试的 stage 断言（24→23）。
- [ ] Step 3: GREEN — gateway events 测试 + SDK 全量 + tsc；`/api/events?sessionID=x` 行为测试通过。
- [ ] Step 4: Commit `refactor(events): remove dead mode-b session streams (E3-2)`。

### Task 3: 框架级错误码（E3-3）

**Files:** Create `gateway/src/core/http/api-error.ts`；Modify `gateway/src/http/transport.ts`、`gateway/src/routes/registry-dispatch.ts`、`gateway/src/kernel.ts`（capGuard）；Test `gateway/tests/unit/http/framework-error-codes.test.ts`

- [ ] Step 1: RED — 401/403/500/503 边界响应含 `code`（unauthorized/forbidden/internal/capability_unavailable）且 `error` 字符串不变。
- [ ] Step 2: GREEN — helper + 边界应用点。
- [ ] Step 3: Run PASS + `tests/unit/http/ tests/unit/routes/` 绿。
- [ ] Step 4: Commit `feat(http): machine-readable codes on framework errors (E3-3)`。

### Task 4: Experience 动作绑定（E3-4）

**Files:** Modify `gateway/src/experience/experience-contract.ts`、`experience-projector.ts`（或实际投影文件）；Test `gateway/tests/unit/experience/action-binding.test.ts`

- [ ] Step 1: RED — supported 且有 catalog 路由的动作带 `operationId`，且该 id 存在于 `buildRouteCatalog()`；无路由动作不带。
- [ ] Step 2: GREEN — 字段 + 最小映射表。
- [ ] Step 3: Run PASS + tsc。
- [ ] Step 4: Commit `feat(experience): bind actions to catalog operationIds (E3-4)`。

### Task 5: 版本握手 opt-in（E3-5）

**Files:** Modify `gateway/src/http/transport.ts`；Test `gateway/tests/unit/http/schema-epoch-header.test.ts`

- [ ] Step 1: RED — 响应对所有请求带 `X-MAFW-Schema-Epoch`；请求带不匹配 epoch → 409 `{error, code:'schema_epoch_mismatch'}`；不携带 → 正常。
- [ ] Step 2: GREEN — 在 auth 之后、registry 之前校验；header 早设。
- [ ] Step 3: Run PASS + `tests/unit/http/` 绿。
- [ ] Step 4: Commit `feat(http): opt-in schema-epoch handshake (E3-5)`。

### Task 6: 读接口 schema 增量（E3-6）

**Files:** Modify `gateway/src/routes/route-catalog.ts`（4 个 op 的 response schema，参考 session.list 的声明方式）；Emit artifacts；Modify `gateway/tests/unit/api-contract.test.ts`（断言 4 op 有 200 schema）

- [ ] Step 1: RED — contract 测试断言 4 op 的 openapi 有 200 schema → 当前缺失（红）。
- [ ] Step 2: GREEN — 加 schema 声明；`emit:openapi` + `merge-contract.mjs`；`api-schema.gen.ts` 若可生成则更新，否则记录。
- [ ] Step 3: Run PASS + SDK contract 4/4。
- [ ] Step 4: Commit `feat(contract): response schemas for four read endpoints (E3-6)`。

### Task 7: 收口（E3-7）

- [ ] Step 1: `docs/architecture/gateway.md` E3 段 + `docs/releases/2026-11-11-gateway-e3-contract.md`（含 breaking 清单：SDK subscribeToSession 删除、Mode B 移除、11 op 删除）。
- [ ] Step 2: 全量门禁（gateway/SDK/desktop/TUI）+ 对比基线。
- [ ] Step 3: 终审 + ledger；commit `docs(gateway): E3 closeout (E3-7)`。

## Ledger

`.superpowers/sdd/2026-11-11-gateway-e3-contract/progress.md`
