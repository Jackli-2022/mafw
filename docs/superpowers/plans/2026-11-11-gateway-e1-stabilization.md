# Gateway E1 止血 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复三份评估合并清单中的 14 个确定性缺陷（E1-1..E1-14），每项 TDD：先写失败测试 → 最小实现 → 验证 → 每项一个 commit。

**Architecture:** 纯修复波，不动路由契约/响应信封/协议。改动集中在 `gateway/src/{boot,index}.ts`、`routes/*`、`server/event-hub.ts`、`events/sse-attach.ts`、`session/registry.ts`、`runtime/instance-lock.ts`、`packages/tui`、`packages/desktop`。

**Tech Stack:** TypeScript (CJS), Jest（gateway）、node --test（tui/desktop），无新依赖。

**Spec:** `docs/superpowers/specs/2026-11-11-gateway-e1-stabilization-design.md`

## Global Constraints

- **TDD 铁律**：没有失败的测试就不写生产代码；每个测试必须先亲眼看到按预期失败。禁止"先实现后补测试"。
- 行为等价优先：除 spec 明确列出的行为修正外，不改任何路径/状态码/响应形状。
- 门禁：gateway `npx tsc --noEmit -p tsconfig.json`；每任务跑对应域测试；收口跑全量。
- **隔离工作区**：共享检出归并行 agent；本波在独立 worktree（`.superpowers/e1-worktree`，从 main 拉分支 `feat/gateway-e1-stabilization`，node_modules junction）。
- 共享检出纪律：显式 git add；不提交他人文件；每次 commit 前 `git status`。
- 已知环境红名单（node_modules 不完整，基线同红）：claude-adapter-acceptance/coverage、plugin-package-e2e；不因它们阻塞本波，但收口须记录对比。
- commit 信息格式：`fix(<scope>): <description> (E1-<n>)`

## Review Focus

1. **E1-4 的 dispatch 顺序**：`/api/goals/control` 从"被 dashboard 遮蔽"变为可达——必须同时验证 `/control` 旧路径与 dashboard 其余兜底形状不受影响（测试先行，R6 回归锚）。
2. **E1-5 的调用方兼容**：收紧目录校验前 grep 全部内部调用；不得破坏 desktop/TUI/移动端创建会话。
3. **E1-11 的退出语义**：未捕获异常 → exit 1（不是 75）；不得吞异常继续运行；supervisor 可重启。
4. **E1-7 的双投递边界**：只去重"在线 WS 设备"；离线设备 push 路径保持。
5. **E1-3 的项目选择**：与 promptAsync 一致用当前项目；无项目时显式报错而非落任意项目。

---

### Task 1: 实例锁心跳（E1-1）

**Files:** Modify `gateway/src/boot.ts`（start 后启动心跳）、`gateway/src/runtime/instance-lock.ts`（fencing 注释）；Test `gateway/tests/unit/runtime/instance-lock-heartbeat.test.ts`

**Interfaces:** Produces: boot 内的 `lockHeartbeatTimer: NodeJS.Timeout`（unref），shutdown 清理。Consumes: `instanceLock.heartbeat()`（已存在）。

- [ ] Step 1: RED — 测试：获取锁 → 启动 boot 同等心跳循环（fake timers 每 10s tick）→ 断言锁文件 mtime 在最近 10s 内；停止心跳并把时钟推 31s → 断言 `isStale` 为 true（保持旧判定）。
- [ ] Step 2: Run `npx jest tests/unit/runtime/instance-lock-heartbeat.test.ts --no-coverage` → 预期 FAIL（心跳未接线）。
- [ ] Step 3: GREEN — boot 启动后 `setInterval(() => void instanceLock.heartbeat().catch(...), 10_000).unref()`；shutdown 清理；instance-lock 头注释注明 fencing 属 E5。
- [ ] Step 4: Run 测试 → PASS；`npx tsc -p` rc=0。
- [ ] Step 5: Commit `fix(runtime): heartbeat the instance lock while running (E1-1)`。

### Task 2: 事件发布类型守卫（E1-2）

**Files:** Modify `gateway/src/routes/event-publish.ts`；Test `gateway/tests/unit/routes/event-publish-guard.test.ts`

**Interfaces:** Consumes `EVENT_FLOW_MATRIX`、`MAFW_FLAT_EVENT_NAMES`、`RUNTIME_NATIVE_DROPPED`；Produces `isReservedEventType(type): boolean`。

- [ ] Step 1: RED — 测试：`mafw_event` / `turn.completed` / `sync` → 400 且 `append` 未被调用；`plugin:demo:custom` → 200 且 append 一次；grep 真实调用方确认无合法保留名（若有，列入白名单并测）。
- [ ] Step 2: Run → 预期 FAIL（当前全放行）。
- [ ] Step 3: GREEN — 守卫函数 + 400 `{error}`。
- [ ] Step 4: Run 测试 PASS + `npx jest tests/unit/routes/ --no-coverage` 绿 + tsc。
- [ ] Step 5: Commit `fix(events): reject reserved event types on external publish (E1-2)`。

### Task 3: WS send 项目选择（E1-3）

**Files:** Modify `gateway/src/kernel.ts`（handleWsMessage 的 send 分支）；Test `gateway/tests/unit/runtime/ws-send-project.test.ts`

**Interfaces:** Consumes `resolvedProjectDir()`、`registeredProjects`；Produces 无新接口。

- [ ] Step 1: RED — fake 环境注册两个项目（当前=第二个）：无 sessionID 的 send 在第二个项目建会话；无注册项目：回 `ws_error` 且不建会话。
- [ ] Step 2: Run → FAIL（当前用第一个项目）。
- [ ] Step 3: GREEN — 用 `resolvedProjectDir()`；无项目 → error。
- [ ] Step 4: Run PASS + tsc。
- [ ] Step 5: Commit `fix(session): ws send without sessionID uses current project (E1-3)`。

### Task 4: goals.get 单对象 + goals.control 可达（E1-4）

**Files:** Create `gateway/src/routes/goal-get.ts`；Modify `gateway/src/routes/goals-inline.ts`（control attach）或 transport 的 control 提取、`gateway/src/subsystems/api-routes.ts`（接线）；Test `gateway/tests/unit/routes/goals-dispatch-fixes.test.ts`

**Interfaces:** `attachGoalGetRoute(registry, deps: { findGoalStatePath, loadGoalState })`；`handleGoalControl(req, deps)`（从 transport 分支提取，transport 继续用 `/control`）。

- [ ] Step 1: RED — (a) GET `/api/goals/<id>` → 单对象 `{goalId,...}`；未知 id → 404；(b) POST `/api/goals/control` → control handler 被调（fake 断言）且返回控制结果而非 goals 列表；(c) `/control` 旧路径仍工作；(d) dashboard 对 `/api/goals/<id>/loops` 的兜底保持原状。
- [ ] Step 2: Run → FAIL（a 返回列表；b 返回列表）。
- [ ] Step 3: GREEN — 注册 `goals.get` 与 `goals.control`（catalog shadow 已存在）；control 逻辑提取复用；保持 dashboard 兜底顺序。
- [ ] Step 4: Run PASS + `npx jest tests/unit/routes/ tests/unit/http/ tests/unit/architecture/ --no-coverage` + tsc。
- [ ] Step 5: Commit `fix(goals): reachable goals.get/goals.control with correct shapes (E1-4)`。

### Task 5: 会话目录严格化（E1-5）

**Files:** Modify `gateway/src/routes/sessions-core.ts`（create + worktree 路由）；Test `gateway/tests/unit/routes/session-dir-strict.test.ts`

- [ ] Step 1: RED — `directory` 缺失 → 400；相对路径 → 400；绝对路径 → 创建成功。先 grep 内部调用方并在报告记录。
- [ ] Step 2: Run → FAIL（当前静默兜底）。
- [ ] Step 3: GREEN — `path.isAbsolute` 校验；删除 `?? deps.resolvedProjectDir()` 与 `?? '.'` 兜底（本路由内）。
- [ ] Step 4: Run PASS + 相关 session 测试全绿 + tsc。
- [ ] Step 5: Commit `fix(session): require absolute directory on session create (E1-5)`。

### Task 6: 死配置清理（E1-6）

**Files:** Modify `gateway/src/core/types/config.d.ts`、`gateway/src/config-loader.ts`（或实际 loader 文件）；Test `gateway/tests/unit/config/loader-dead-config.test.ts`

- [ ] Step 1: RED — loader 对含 `maxMemoriesPerTier` 的旧配置加载成功且不报错（文档化移除）。
- [ ] Step 2: Run → 通过的话说明无行为…… 改为：测试断言类型/接口不再导出该字段（通过编译期断言文件 `tests/types/no-dead-config.ts` 的 `// @ts-expect-error`）。
- [ ] Step 3: GREEN — 删除类型/loader 字段；全仓 grep 0。
- [ ] Step 4: Run tsc + 测试。
- [ ] Step 5: Commit `chore(config): remove dead maxMemoriesPerTier (E1-6)`。

### Task 7: 移动端双投递去重（E1-7）

**Files:** Modify `gateway/src/server/event-hub.ts`；Test `gateway/tests/unit/events/hub-push-dedupe.test.ts`

- [ ] Step 1: RED — 在线设备（wsClients 中 deviceId 对应 socket）+ push 记录器：broadcast 后 push 0 次、ws 1 次；离线设备（device 记录无 socket）→ push 1 次。
- [ ] Step 2: Run → FAIL（在线设备双投）。
- [ ] Step 3: GREEN — push 路径排除在线设备（ws 为主通道）。
- [ ] Step 4: Run PASS + `tests/unit/events/` 绿 + tsc。
- [ ] Step 5: Commit `fix(mobile): dedupe online-device broadcast delivery (E1-7)`。

### Task 8: TUI 边沿触发（E1-8）

**Files:** Modify `packages/tui/src/store/connection.ts`；Test `packages/tui/test/connection-edge.test.ts`（或现有测试目录）

- [ ] Step 1: RED — 连续 5 次 healthTick ok → onState('ok') 仅 1 次；down 后 ok → 再 1 次。
- [ ] Step 2: Run `npm run test:tui`（或 `node --test` 单文件）→ FAIL。
- [ ] Step 3: GREEN — 状态变更才回调。
- [ ] Step 4: Run PASS + `npm run test:tui` 全绿。
- [ ] Step 5: Commit `fix(tui): edge-trigger connection state callbacks (E1-8)`。

### Task 9: desktop SSE 单例竞态（E1-9）

**Files:** Modify `packages/desktop/src/renderer/mafw/MafwShell.tsx`（connectSse）；Test `packages/desktop/test/mafw/sse-singleton.test.ts`

- [ ] Step 1: RED — 并发两次 connectSse（fake EventSource 计数）→ 只创建 1 个；dispose 后可再建。
- [ ] Step 2: Run `npm run test:desktop -- --conditions=browser`（或 node --test 单文件带 `--conditions=browser`）→ FAIL。
- [ ] Step 3: GREEN — in-flight promise 守卫。
- [ ] Step 4: Run PASS + 相关 desktop 测试。
- [ ] Step 5: Commit `fix(desktop): guard concurrent SSE connects (E1-9)`。

### Task 10: 设备 token 存储止血（E1-10）

**Files:** Modify `gateway/src/routes/devices-mobile.ts`、`gateway/src/mobile/device-store.ts`；Test `gateway/tests/unit/mobile/device-token-storage.test.ts`

- [ ] Step 1: RED — 注册后 store 中不出现原始 token；hash 不匹配 → 401；旧记录（仅 fcmToken）读取兼容。
- [ ] Step 2: Run → FAIL（当前明文写 fcmToken）。
- [ ] Step 3: GREEN — 只写 hash；注册时校验（提供 token 时）；读路径兼容。
- [ ] Step 4: Run PASS + `tests/unit/mobile/` 绿 + tsc。
- [ ] Step 5: Commit `fix(mobile): stop persisting the gateway token in device store (E1-10)`。

### Task 11: 全局异常兜底（E1-11）

**Files:** Modify `gateway/src/index.ts`；Test `gateway/tests/unit/runtime/uncaught-exit.test.ts`（spawn 子进程）

- [ ] Step 1: RED — spawn 一个加载 index 等价 bootstrap 的子进程并触发 unhandledRejection → 退出码 1、stderr/stdout 日志含错误；进程不挂死。
- [ ] Step 2: Run → FAIL（当前无 handler，进程按 Node 默认 exit 1？若是，则测试断言"日志含标记"失败——以日志标记为判定）。
- [ ] Step 3: GREEN — 注册 handlers：log.error + process.exit(1)。
- [ ] Step 4: Run PASS + tsc。
- [ ] Step 5: Commit `fix(runtime): handle uncaught exceptions with controlled exit (E1-11)`。

### Task 12: Registry TTL patch（E1-12）

**Files:** Modify `gateway/src/session/registry.ts`；Test `gateway/tests/unit/session/registry-ttl-patch.test.ts`

- [ ] Step 1: RED — register(ttl=60s) → register(ttlMs=undefined) → TTL 仍 60s；ttlMs=null → 永久。
- [ ] Step 2: Run → FAIL（undefined 清 TTL）。
- [ ] Step 3: GREEN — 三态语义。
- [ ] Step 4: Run PASS + `tests/unit/session/` 绿。
- [ ] Step 5: Commit `fix(session): preserve ttl on undefined patch in registry (E1-12)`。

### Task 13: SSE 卫生（E1-13）

**Files:** Modify `gateway/src/events/sse-attach.ts`、`gateway/src/config.ts`（cors 默认）；Test `gateway/tests/unit/events/sse-hygiene.test.ts`

- [ ] Step 1: RED — 响应头含 `X-Accel-Buffering: no`；fake timer 15s 收到 `: ping`；`retry: 3000` 首帧；OPTIONS 对 PUT/PATCH/DELETE 204 且 ACAO 正确。
- [ ] Step 2: Run → FAIL。
- [ ] Step 3: GREEN — 补头/心跳（unref + close 清理）/CORS 默认。
- [ ] Step 4: Run PASS + `tests/unit/events/` + `tests/unit/http/` 绿 + tsc。
- [ ] Step 5: Commit `fix(events): sse keepalive, retry and cors hygiene (E1-13)`。

### Task 14: 收口（E1-14）

- [ ] Step 1: `docs/architecture/gateway.md` 现状段补 E1；新建 `docs/releases/2026-11-11-gateway-e1-stabilization.md`（14 项、commit、测试数、已知环境红）。
- [ ] Step 2: 全量门禁：gateway `npx tsc -p` + `npx jest --no-coverage --forceExit`；`npm run test:tui`；`npm run test:desktop`；SDK contract 4/4。记录基线对比。
- [ ] Step 3: 更新 ledger + 终审（whole-wave review）；commit `docs(gateway): E1 closeout (E1-14)`。

## Ledger

`.superpowers/sdd/2026-11-11-gateway-e1-stabilization/progress.md`
