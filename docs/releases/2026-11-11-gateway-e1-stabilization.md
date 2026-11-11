# Gateway E1 止血交付记录（2026-11-11）

## 波次

- 分支：`feat/gateway-e1-stabilization`（worktree `.superpowers/e1-worktree`）
- 基线：`ffd920f8`（main @ 2026-11-11，含 D2+D3 合并与 P2.4 事件层）
- 范围：三份评估合并清单中的 **14 项确定性缺陷**（A 类 + C7/B17）；只修行为，不改协议/路由契约/响应信封
- spec：`docs/superpowers/specs/2026-11-11-gateway-e1-stabilization-design.md`
- 架构现状：`docs/architecture/gateway.md` §「E1 止血（2026-11-11）」
- TDD：每项先写失败测试并确认按预期失败 → 最小实现 → 一个 commit；证据见
  `.superpowers/sdd/2026-11-11-gateway-e1-stabilization/batch{1..5}-report.md`

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `462d5e10` | E1-1 | 实例锁 10s 心跳（unref，shutdown 清理）；fencing 留给 E5 |
| `c0d47f84` | E1-2 | 外部 `POST /api/events` 拒绝保留事件名（`mafw_event`/canonical/扁平/`sync`），只放行自定义命名空间 |
| `474bb9d6` | E1-3 | WS `send` 无 `sessionID` 时用当前项目；无注册项目 → `ws_error` |
| `6c3bd034` | E1-4 | `goals.get` 单对象（404 语义）+ `goals.control` registry 可达（R6 死臂修复）；共用 `handleGoalControlCommand` |
| `3aaa999d` | E1-5 | `POST /api/session` 必填绝对目录（400），worktree 不回退 `'.'`；desktop 入口随迁 |
| `911407ca` | E1-6 | 删除死配置 `memory.maxMemoriesPerTier`（类型 + loader 默认值）；旧配置容忍 |
| `5e823505` | E1-7 | 移动端广播单投：WS 主通道，`excludeDeviceIds` 让 push 只兜底 |
| `74b1f5f2` | E1-8 | TUI 连接状态边沿触发（稳定连接不再每秒重载 Experience/queue） |
| `ea87a378` | E1-9 | desktop SSE 单例：`sse/sse-connection.ts` in-flight 守卫，并发只开一条流 |
| `b1e6fd8f` | E1-10 | 设备库不再持久化网关 token（只存 hash）；注册校验 token，不匹配 401 |
| `71ee746b` | E1-11 | 全局 `uncaughtException`/`unhandledRejection` → `[FATAL]` + 受控 `exit(1)` |
| `df0739c1` | E1-12 | 注册表 TTL 三态：`undefined` 保持 / `null` 永久 / 数字覆盖 |
| `48449317` | E1-13 | SSE 卫生：`X-Accel-Buffering: no`、首帧 `retry: 3000`、15s `: ping`；CORS 默认方法与头补全 |
| 文档 commit | E1-14 | 本节 + `docs/architecture/gateway.md` §E1 现状 + 全量门禁（`push-gateway.test.ts` 的 E1-10 断言随迁） |

## 逐项要点（补充架构节未覆盖的细节）

- **E1-1**：`startInstanceLockHeartbeat(lock, {intervalMs,onError})` 在 `runtime/instance-lock.ts`；boot 在
  `claimGatewayInstance` 成功后启动、`releaseInstanceOwnership()` 首步停止。心跳失败（被接管）只 warn。
- **E1-2**：守卫 = `EVENT_FLOW_MATRIX` keys ∪ `MAFW_FLAT_EVENT_NAMES` ∪ `RUNTIME_NATIVE_DROPPED`
  ∪ `mafw_event` 前缀。原 `mafw_event` HTTP 信封分支（含 `mafwBroadcast`）整段删除；SDK/文档旧描述需按新行为理解。
- **E1-3**：`sendEnrichedInternal` 改用 `resolvedProjectDir()`；`handleWsMessage` 在无 `sessionID` 且
  `registeredProjects.size === 0` 时先回 `ws_error`。
- **E1-4**：新 `routes/goal-get.ts`（`projectGoalView` 输出 SDK `Goal` 形状）+ `core/goal/control-command.ts`
  （大写动作族，transport `/control` 与 registry `goals.control` 共用）。transport 的 R6 回归测试改为钉
  "dispatch 漏接时的 dashboard 兜底"，可达性由新 dispatch 顺序测试钉住。
- **E1-5**：`session-create.ts` 统一 400；`session-worktree.ts` 对直接调用方也抛绝对路径错误；
  `sessions-core.ts` 删除 `?? resolvedProjectDir()`。desktop renderer 新会话传 `currentProject()`。
- **E1-6**：`gateway/src/core/types/config.d.ts`、`core/utils/config-loader.ts`、根 `src/types/config.d.ts`
  三处代码 0 命中；归档文档保留历史原文。
- **E1-7**：`PushGateway.onBroadcast(event, { excludeDeviceIds })` 跳过已由 WS 送达的设备；限流不变。
  离线设备的真实推送仍缺 FCM sender（dispatch 契约已就位）。
- **E1-8**：`ConnectionStore.emitState()` 去重；`start()` 重置 `lastState`。
- **E1-9**：`SseConnection` deps = `{open,onOpen,onError,onMessage,onRetry?,retryDelayMs?}`；MafwShell 仅提供
  gateway 信息与事件路由；flow-card seed 移入 `onOpen`（幂等）。
- **E1-10**：`DeviceStore.register` 单点写空 `fcmToken`；`load()` 归一化缺失 `apiTokenHash` 为 `''`；
  route 层用 sha256(16) 对比 `config.server.apiToken`（空 token = 跳过校验，保持 loopback dev 行为）。
- **E1-11**：`registerCrashHandlers({emitter,log,stderr,exit})` 可注入；默认同步写 fd 2；每 emitter 幂等。
- **E1-12**：active 记录重注册 = 续租（保留 TTL、从当刻重算 `expiresAt`）；ended 记录重建按首次注册语义。
- **E1-13**：`retry` 与 greeting 同帧（帧数契约不变）；`: ping` 用 `writeFrame`，写失败即 dispose。

## 验证（worktree @ `ea87a378` + E1-14 文档改动）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | **0 errors** |
| gateway 全量 | `node node_modules/jest/bin/jest.js --no-coverage --forceExit --runInBand` | **6266 tests：6256 passed / 9 failed / 1 skipped**；**807 suites：804 passed / 3 failed**（3 个均为下列 env-red）；耗时 ~150s |
| TUI | `npm run test:tui` | **309 tests：308 passed / 0 failed / 1 skipped** |
| desktop | `npm run test:desktop` | **3236 tests：3235 passed / 1 failed**（env-red resolver）；耗时 ~20s |
| SDK contract | `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test src/contract.test.ts`（`packages/gateway-sdk`） | **4/4 passed** |
| 路由扫描 | `node scripts/analyze-routes.cjs`（`gateway/`） | **TOTAL 0 (match 0, equals 0)** |
| kernel-split 守卫 | `jest tests/unit/architecture/kernel-split-guards.test.ts` | **7/7 passed** |

## 已知环境红（非本波代码问题；均在本环境基线同样红）

1. `tests/unit/runtime/claude-adapter-acceptance.test.ts` + `claude-adapter-coverage.test.ts`：
   `adapters/claude` esbuild 构建失败 — `Could not resolve "@anthropic-ai/claude-agent-sdk"`
   （共享 `node_modules` junction 缺包；`adapters/` 与本波无关）。
2. `tests/integration/plugin-package-e2e.test.ts`：模拟 Desktop `node_modules` 的
   `@mafw/plugin-contract` staging 失败（同属依赖/构建环境，非 E1 代码）。
3. desktop `src/main/mafw-gateway-resolver.test.ts` "resolves dev path relative to module location"：
   worktree 无 `gateway/dist`（未构建）→ 解析返回 null；该测试文件与 BASE 逐字节相同，
   在把本波全部改动 stash 后同样 4 pass / 1 fail。
4. TUI `tsc --noEmit`：`error TS5023: Unknown compiler option 'rewriteRelativeImportExtensions'` —
   仓库 `typescript` 为 5.6.3，该选项需要 ≥5.7；配置级、与本波无关（全仓现状）。

## Deferred（明确不在 E1 范围）

- **A2** `actorSessionID` 缺省=人类：属已声明的 audit-hint 契约，真修复 = per-client principal → **E5 身份闭环**。
- **A7** 11 个不可达 catalog op：逐 op 决策（实现/代理/删除）→ **E3 契约硬化**。
- **A13 完整形态** per-device 凭据：本波只做"停止明文存 token + 校验可用性"最小止血 → **E5**。
- **B15** WS delivery/idempotencyKey 对齐 → **E2**。
- **SDK `session.create` 的 `directory` 类型收紧**（gateway 已强制绝对路径，SDK 仍 optional）→ SDK 契约后续。
- 结构性 B 类（WS 总线化、快照+增量协议、错误信封统一）与 E1-1 的 per-owner fencing（E5）。
