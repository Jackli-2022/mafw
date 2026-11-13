# Gateway E8 剩余工程债收口交付记录（2026-11-13）

- 版本：gateway 4.16.1 / desktop 5.1.0 / SDK 5.1.0（无版本号变更；mobile 1.1.0+2 不变）

## 波次

- 分支：`feat/gateway-e8-residual-engineering`（worktree `.superpowers/e8-worktree`），基线 `58318f6e`
  （main，E8 spec/plan 落库时点）
- 范围：E8-1 timer inventory + E8-2 preload 死参数 + E8-3 六个核心读 schema + E8-4 E5b 恢复残留
  + E8-5 删除死 `authorizeWsUpgrade` + E8-6 收口
- spec：`docs/superpowers/specs/2026-11-13-gateway-e8-residual-engineering-design.md`
- plan：`docs/superpowers/plans/2026-11-13-gateway-e8-residual-engineering.md`
- 架构现状：`docs/architecture/gateway.md` §「计时器台账（TimerService）」/ §「E8 剩余工程债收口」、
  `docs/architecture/desktop.md` §「preload `event.url()` 零参（E8-2）」、
  `docs/architecture/mobile.md` §7.5（reset 降 head / busy greeting 排队）
- TDD：每项先写失败测试 → 最小实现 → 一个 commit；批证据见
  `.superpowers/sdd/2026-11-13-gateway-e8-residual/{progress.md,batch1-report.md,batch2-report.md,batch3-report.md}`

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `8367d70e` | E8-1 | `pod:event-prune` / `pod:event-wake` / `heartbeat:sweep` / `queue:sweep` / `session:sweep` / `serve:watchdog` / `discovery:heartbeat` 全部迁入 `TimerService`；`stop()` 归零 handle 支持重建 |
| `7cb56418` | E8-2 | preload `event.url()` 归零参，`mafw-api.ts` 不再转发 `sessionID` |
| `1e1e8078` | E8-3 | `session.get` / `session.messages` / `decisions.list` / `attention.list` / `memory.stats` / `pods.get` 加 200 response schema；`PodAttentionItem` SDK DTO 对齐 wire |
| `7ab21ddb` | E8-4 | mobile reset/truncated 显式把游标落到 `headSeq`（可降）；busy greeting 排队一个、`settled` 后重跑一次 |
| `f0fe8a64` | E8-5 | 删除死 `authorizeWsUpgrade` / `WsAuthRequest` / `WsAuthResult` / `WS_401_BYTES`；测试迁移到 `resolvePrincipal` + 401 字节断言 |
| `958c83a6` | E8-1 follow-up | `queue-busy-wiring` 的源码 pin 从 `setInterval` 形式对齐到 `timers.every('queue:sweep', 60_000, …)`（全量门禁发现的唯一 E8 红） |
| E8-6（本记录） | E8-6 | 架构现状 + 本记录 + 全量门禁 + ledger（docs-only） |

## 交付项

- **E8-1 timer inventory**：`kernel.ts` 新增 `startPodEventTimers()`（`pod:event-prune` 24h、
  启动立即跑一次；`pod:event-wake` 60s）与 `startHousekeepingTimers()`（`heartbeat:sweep` 30min、
  `queue:sweep` 60s、`session:sweep` 60s）；`serve:watchdog` 改 `timers.every`，
  `stopServeWatchdog()` 改 `timers.clear`。`boot.ts` 的 `BootKernel` 增加 `timers: TimerService`，
  `discovery:heartbeat`（10s）走同一台账，`releaseInstanceOwnership` 清 handle。所有 handle 字段
  类型改为 `TimerHandle`；`stop()` 先 `timers.disposeAll()` 再把 6 个 handle 归零，保证再次
  `start()` 不被幂等 guard 误跳过。unref 语义不变（`TimerService.every` 默认 unref）；5s 启动
  Pod 扫描仍是短命 `setTimeout`（spec 非目标）。新增
  `tests/unit/resources/kernel-timers.test.ts` **5 条**（6 个名字各一条、重复 start 幂等、
  原 cadence 仍触发、`disposeAll` 后静默、serve watchdog 停止）+
  `tests/unit/core/discovery-heartbeat-timer.test.ts` **1 条**（10s 注册、释放后 stats 清空）。
  全量门禁发现 `queue-busy-wiring` 仍 pin 旧裸 `setInterval` 源码串，`958c83a6` 把该 pin 对齐到
  `timers.every('queue:sweep', 60_000, …)`（行为侧仍由 `kernel-timers` 的 fake timers 覆盖）。
- **E8-2 preload event.url**：`packages/desktop/src/preload/mafw-types.ts`
  `EventApi.url(): Promise<string>`（删除可选 `sessionID`）；`mafw-api.ts`
  `url: () => invoke("event", "url")`（不再转发第三参）。本仓库没有 `event/url` 专用 main
  handler——统一入口 `mafw-invoke` → `resolveIpcMethod` → SDK `events.url()`（E7-2 起已零参）。
  新增 `tests/event-url-wiring.test.ts` **3 条**（类型无参、preload 不转发、唯一生产调用方零参），
  RED 时 2 failed / 1 passed。
- **E8-3 六个核心读 schema**（只加 OpenAPI 元数据，handler 零改动）：
  | op | endpoint | schema |
  |---|---|---|
  | `session.get` | `GET /api/sessions/:id` | `schemas/session.ts#SessionSchema`（复用） |
  | `session.messages` | `GET /api/sessions/:id/messages` | `schemas/session.ts#SessionMessagesResponse`（flat `{data, nextCursor}`） |
  | `decisions.list` | `GET /api/decisions` | `schemas/read-models.ts#DecisionListResponse` |
  | `attention.list` | `GET /api/attention` | `schemas/read-models.ts#AttentionListResponse` |
  | `memory.stats` | `GET /api/memory/stats` | `schemas/memory-stats.ts#MemoryStatsResponse`（internal diagnostics） |
  | `pods.get` | `GET /api/pods/:podId` | `schemas/pods.ts#PodDetailResponse` |

  `pods.list` 在 catalog 从不存在（`pods.ensure/lookup/create` 都返回单 Pod，单 Pod detail 是
  `pods.get`），按 plan 允许的替换取 `pods.get`。`overrides.json` 删除重复的 `session.get` /
  `session.messages` responseSchema（catalog 成为单一来源；`session.messages` 只保留 prose
  description），重生成 `gateway-paths.json` / `openapi.json` / `api-schema.gen.ts` ——
  `session.get` / `session.messages` 的 schema 此前由 overrides 提供，迁到 catalog 后
  带 200 schema 的 op 从 **16 → 20**（净增 4 个真正的新 schema）。SDK
  `PodAttentionItem` 对齐 wire：新增必填 `revision`、`kind` 扩到 `review` / `failed`、可选
  `podId` / `projectId`（gateway `core/pod/pod-stage.ts` 早已发出）。`session.messages` 的 part
  变体仍由 `contract/view-dto.json` 拥有，schema 只承诺 `type` + open fields。新增
  `api-contract.test.ts` E8-3 describe **4 条** + SDK `contract-compat.checks.ts` **6 条**
  编译期等值断言。
- **E8-4 E5b 恢复残留（mobile）**：
  - `EventRecoveryService._recoverOnce` 的 `reset` / `truncated` 分支改为**显式权威赋值**
    `_cursor = page.headSeq`——同实例事件日志重启后新 head **低于**旧游标也照落（旧游标属于
    死 seq 空间；只抬不降会每次重连 reset-loop）。`observe()`（live 帧）保持单调：非 reset
    帧只前进，测试同时断言两半（reset 降、随后 live 11/13 只到 12→13）。
  - 新增 `isRecovering` / `settled`；`recover()` 在完成 completer **之前**清 `_recovering`，
    避免 waiter 立即重放被判 busy。`RecoveryCoordinator` replay 在途时挂起**一个** greeting，
    等 `settled` 后重跑一次（replay → refresh），结果 `busy:true, queued:true`；第二个并发
    greeting 直接丢弃（`queued:false`）；**epoch change 不排队**（在途 replay 属于旧纪元，
    直接重建 baseline + 全量重拉）；intentional disconnect / 后台交接仍在上游
    `WsClientV2._notifyGatewayReady` 丢弃。新增 `event_recovery_test.dart` **2 条** +
    `recovery_coordinator_test.dart` **2 条**（F3「busy 什么都不做」用例被重跑契约替换）。
- **E8-5 删除死 `authorizeWsUpgrade`**：`git grep` 确认无生产调用方（只命中注释 / 自身测试 /
  文档），`createWsHub` / `http/ws-upgrade.ts` 一直走 `resolvePrincipal`。删除
  `authorizeWsUpgrade`、`WsAuthRequest`、`WsAuthResult`、`WS_401_BYTES`；`WS_401_BYTES` 内联进
  `WS_UNAUTHORIZED_RESPONSE`（仍导出、byte-identical，upgrade 两个 401 站点共用）。
  `authorizeRequest`（registry-dispatch fallback）与 `resolvePrincipal` 保留。原 7 条重复凭据
  矩阵测试删除（`tests/unit/core/principal.test.ts` 已覆盖同一矩阵），替换为 **1 条** pin
  upgrade 401 精确字节的测试；mobile 两处注释改为指向 `resolvePrincipal`。
- **E8-6 收口**：architecture 三份文档现状更新（timer 台账全量、preload 零参、6 个 schema、
  E5b 残留收口、auth 删除、残余清单去重）、本记录、全量门禁、ledger。

## 行为变化 / Breaking

1. **`authorizeWsUpgrade` 删除（编译期 breaking，wire 不变）**：`gateway/src/core/auth.ts` 不再
   导出 `authorizeWsUpgrade` / `WsAuthRequest` / `WsAuthResult` / `WS_401_BYTES`。任何仓库外
   直接 import 这些符号的代码会编译失败；WS upgrade 的 401 字节与 `resolvePrincipal` 行为逐字
   不变（`WS_UNAUTHORIZED_RESPONSE` 仍是唯一字节源）。
2. **`pods.get` schema 是 exact DTO 等值（契约收紧）**：OpenAPI `pods.get` 现在精确描述 SDK
   `PodDetail`。gateway 若给 Pod detail 增加字段而不同步 `schemas/pods.ts` + SDK `types.ts`，
   `contract-compat.checks.ts` 的 `AssertEq` 会红；对客户端是**新增**元数据，正常路径 payload
   形状不变。
3. **`session.get` / `session.messages` 的 override 移除**：`overrides.json` 不再覆盖这两个 op
   的 responseSchema（catalog 为单一来源）。生成产物（`gateway-paths.json` / `openapi.json` /
   `api-schema.gen.ts`）有 diff，但 wire 输出不变。
4. **preload `event.url()` 零参**：`EventApi.url` 不再接受 `sessionID`；桌面内无调用方传值，
   SSE 仍恒为全局 `/api/events`。仓库外自定义 preload 调用方若传参会在类型层失败（运行时本来
   就被忽略）。
5. **timer 观测面扩大**：`/api/kernel/stats.timers` 的 `byName` 新增 7 个名字
   （`pod:event-prune` / `pod:event-wake` / `heartbeat:sweep` / `queue:sweep` / `session:sweep` /
   `serve:watchdog` / `discovery:heartbeat`）。只是观测键增加，客户端须忽略未知键。
6. **mobile busy greeting 语义**：replay 在途时到达的 greeting 从「直接丢弃」变为「排队一个、
   在途完成后重跑」；第二个并发 greeting 仍丢弃。乱序/重复 refresh 由幂等 REST 对账吸收。
7. **mobile reset 游标可降**：同实例 reset 的新 `headSeq` 低于旧游标时不再保留死游标，直接落到
   `headSeq`（消除 reset-loop）。跨纪元仍走 instanceId 变更路径。

## 验证（worktree @ E8-6）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`gateway/`，gateway-local TS 5.9.3） | **0 errors** |
| gateway 全量 | `node ../node_modules/jest/bin/jest.js --runInBand --forceExit --no-coverage`（`gateway/`） | **7082 tests：7071 passed / 9 failed / 2 skipped**；**899 suites：895 passed / 3 failed / 1 skipped**。9 条 = 恰好 3 个基线 env-red suite（`plugin-package-e2e` 4、`claude-adapter-acceptance` 4、`claude-adapter-coverage` 1），**零 E8 红** |
| gateway timer 定向 | jest `tests/unit/resources` + `discovery-heartbeat-timer` + `queue-busy-wiring` + `timer-migration`（`--runInBand --forceExit`） | **19 suites / 168 tests 全绿**（含 `958c83a6` 对齐后的 pin） |
| SDK 类型 | `node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`packages/gateway-sdk`） | **0 errors** |
| SDK 全量 | `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test "src/*.test.ts"` | **224 / 224 passed** |
| SDK contract | 同上 `--test src/contract.test.ts` | **4 / 4 passed，0 dead ops，0 exemptions** |
| desktop 全量 | `npm run test:desktop`（worktree root） | **3764 tests / 3763 passed / 1 failed**（`src/main/mafw-gateway-resolver.test.ts` dev-path：worktree 未构建 `gateway/dist`，与 E5b/E6/E7 同红；**727 suites**） |
| desktop 类型 | `node ../../node_modules/@typescript/native-preview/bin/tsgo.js --noEmit -p tsconfig.json` | **仅既有 `node:tls` 噪声 2 条**（`getCACertificates` / `setDefaultCACertificates`，`src/main/index.ts:6`，文件未改） |
| mobile 定向（E8） | `flutter test test/event_recovery_test.dart test/recovery_coordinator_test.dart` | **44 / 44 passed**（E8-4 reset 降 head / truncated / isRecovering+settled / busy greeting 排队重跑 / 第二个丢弃） |
| mobile analyzer | `dart analyze lib test` | **No issues found**（0） |
| mobile 全量 | `flutter test` | **544 passed 后 runner 中止**（16 条 `did not complete`，`direction_question_test` / `lead_entry_test` 等 widget 套件——Windows 并发 flake，已知）；被中断文件 `--concurrency=1` 单跑：`direction_question_test` **26/26**、`lead_entry_test` **13/13** 全绿 |
| TUI | `npm run test:tui` | **env-red**：`@earendil-works/pi-tui` 未安装（`ERR_MODULE_NOT_FOUND`，主 checkout 同）；本波零 TUI 改动 |
| 路由扫描 | `node scripts/analyze-routes.cjs`（`gateway/`） | **TOTAL 0 (match 0, equals 0)** |
| kernel-split 守卫 | jest `tests/unit/architecture/kernel-split-guards.test.ts` | **7 / 7 passed** |
| 契约产物新鲜度 | `npm run emit:openapi`（316 routes → 282 paths / 316 operations）+ `node scripts/merge-contract.mjs`（overrides 命中 18） | **内容无 diff**（工作区仅 docs 变更） |

## 新增测试（对基线 `58318f6e` 的增量）

| 面 | 新增 | 依据 |
|---|---|---|
| gateway | **+11 / −7** | E8-1 6（`tests/unit/resources/kernel-timers.test.ts` 5 + `tests/unit/core/discovery-heartbeat-timer.test.ts` 1）+ E8-3 4（`tests/unit/api-contract.test.ts` E8-3 describe）+ E8-5 1（`tests/unit/core/auth.test.ts` upgrade 401 字节，替换删除的 7 条重复矩阵） |
| desktop | **+3** | `packages/desktop/tests/event-url-wiring.test.ts`（类型无参 / 不转发 / 唯一调用方零参） |
| mobile | **+4** | `event_recovery_test.dart` +2（lower-head reset + truncated、`isRecovering`/`settled`）+ `recovery_coordinator_test.dart` +2（busy greeting 重跑一次、第二个丢弃）；F3 旧用例被替换 |
| SDK | **+6（编译期）** | `contract-compat.checks.ts`：`decisions.list` / `attention.list` / `pods.get` exact AssertEq + `session.messages` cursor/role 边界（无新增运行时 test case，仍 224） |

> 计数口径：可执行 test case 数，不是断言数。gateway 净增 4（+11/−7）。

## 已知红（非本波代码问题）

1. **gateway env-red**：`integration/plugin-package-e2e`（4）、`claude-adapter-acceptance`（4）、
   `claude-adapter-coverage`（1）——esbuild 解析不到 `@anthropic-ai/claude-agent-sdk`，
   `@mafw/plugin-contract` staging / `adapters/opencode` 的 `RuntimeDiscoveryRoots` 构建在未预构建
   checkout 下失败；与基线 `58318f6e` 同集合（9 条 / 3 suites）。
2. **desktop 1 条环境红**：worktree 未构建 `gateway/dist` 时 `mafw-gateway-resolver` 的 dev-path
   用例拿到 `null`；`gateway npm run build` 后即全绿。
3. **desktop 类型门禁**：只剩既有 `node:tls` 2 条噪声（tsgo 与 tsc 结果一致）。
4. **TUI**：`@earendil-works/pi-tui` 未安装（`ERR_MODULE_NOT_FOUND`），主 checkout 同；本波零
   TUI 改动。
5. **mobile 全量 flake**：Windows `flutter test` 并发 widget 套件偶发 runner 中止
   （`did not complete`），本次为 544 passed + 16 did not complete；被中断的
   `direction_question_test`（26/26）与 `lead_entry_test`（13/13）`--concurrency=1` 单跑全绿。
6. **E8 自造红已修复**：`958c83a6` 之前 `queue-busy-wiring` 仍 pin 旧裸 `setInterval` 源码串
   （E8-1 迁到 `timers.every` 后失败 1/5）；pin 对齐后该 suite **5/5**、gateway 全量回到
   仅基线 9 条。**当前无 E8-caused failure。**

## Deferred（E8 后仍保留）

- 剩余约 296 个 op 的 response schema 覆盖（316 operations 中 20 个已带 200 schema）。
- mobile 工作 tab 增量渲染（已有 `goalId` 局部更新）。
- `pod.updated` 记录级 payload、attention → decision 投影、OS keychain / 进程签名、MCP human 工具。
- 强制版本协商 / SDK 全量 schema 类型化。
- 插件 / manager 会话的配额副作用（内部会话失败只 log）。
- 插件 loader / self-update / 第三方 transport 的本地 interval（不属于命名长驻台账）。
