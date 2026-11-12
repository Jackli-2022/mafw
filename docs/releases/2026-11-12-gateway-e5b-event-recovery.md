# Gateway E5b 事件恢复源交付记录（2026-11-12）

- 版本：desktop 5.1.0 / gateway 4.16.1

## 波次

- 分支：`feat/gateway-e5b-event-recovery`（worktree `.superpowers/e5b-worktree`）
- 基线：`b72ca273`（main，E5b spec/plan 落库时点）
- 范围：C1 `event_log` 恢复源（REST replay）+ mobile 游标/幂等/重连恢复 + gateway greeting 纪元
- spec：`docs/superpowers/specs/2026-11-12-gateway-e5b-event-recovery-design.md`
- plan：`docs/superpowers/plans/2026-11-12-gateway-e5b-event-recovery.md`
- 架构现状：`docs/architecture/gateway.md` §「E5b 事件恢复源（2026-11-12）」、
  `docs/architecture/mobile.md` §7.5
- TDD：每项先写失败测试 → 最小实现 → 一个 commit；批证据见
  `.superpowers/sdd/2026-11-12-gateway-e5b-event-recovery/{progress.md,batch1-report.md,batch2-report.md,batch3-report.md}`

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `cf9ce38b` | E5b-1 | `EventStore.replayAfter`（升序分页 + head/oldest + fail-open）+ `GET /api/events/replay`（参数校验 / reset / truncated / hasMore / nextSince / 503）+ catalog `event.replay` + TypeBox schema + 契约产物 |
| `76d62f93` | batch1 review | reset（`since > headSeq`）时 `nextSince = headSeq`（不回显 `since`），防客户端持久化后 reset-loop |
| `ad14ed0d` | E5b-2 | `MafwEvent.seq` / `headSeq` / `instanceId`、`EventReplayPage`、`GatewayClient.replayEvents`（404/HTML/503 → null）、`EventCursorStore`（SharedPreferences `mafw_event_seq` + `mafw_event_instance`）、`EventRecoveryService`（分页/去重/fallback/节流持久化） |
| `68d6f526` | batch2 review | 游标单调（live 推进不回滚）、100 页上限 → `pageCap` fallback、`busy` 重入保护、replay 10s 超时、`flush()`、第二页 reset 覆盖 |
| `218fc232` | E5b-3 | gateway greeting `instanceId`（live getter）+ mobile `onGatewayReady` / `emitRecovered` / `RecoveryCoordinator`（先 replay 后刷新；首次连接 baseline；epoch 变化全量重拉） |
| `ff2a29d3` | batch3 review | live∩replay 去重（游标单调分页）、epoch 重设基线、busy 可观测、后台断连竞态保护、`kernel.ts` live getter 注释 |
| `4173902e` | E5b-4 | 架构 / release / ledger 收口（docs-only） |
| `38042164` | docs fix | 修正 recovery contract 与基线计数 |
| `12831674` | acceptance review | `recovery.init()` 后 mounted guard + 可注入 cursor store；recovered provenance + Chat/Tech Lead 不驱动 live 阶段；busy/epoch 回归钉 |

## 交付项

- **C1 服务端（gateway）**：`GET /api/events/replay?since=N&limit=M` 从 `event_log`
  按 `seq` **升序**分页读取，返回 `headSeq` / `oldestSeq` / `hasMore` / `nextSince` /
  `reset` / `truncated`。`reset = since > headSeq`，`truncated = !reset && since+1 < oldestSeq`；
  `nextSince` 在 reset 时钉到 `headSeq`。`limit` 缺省 500、上限 1000（超出 clamp）；
  非法参数 400；event store 缺失 503（不伪装空页）。普通 API 鉴权，**不要求 human**。
  `EventStore.replayAfter` 全程 fail-open（DB 异常 → 空页 + 0/0）。
- **WS greeting 纪元（E5b-3）**：`connected` 帧新增 `instanceId`（`releaseMetadata` /
  `runtimeIdentity` 的实例 id，additive、缺失为 `null`），与既有 `headSeq` 并存；
  WS 仍不回放。SSE 语义零改动。
- **C1 移动端**：`MafwEvent` 解析顶层/内层 `seq` 与 greeting 的 `headSeq` / `instanceId`；
  `GatewayClient.replayEvents` 复用 auth header，旧网关 404/HTML/503 → `null`（回退全量）；
  `EventRecoveryService` 从持久游标逐页补齐（每页 500、最多 100 页、单请求 10s 超时），
  `seq <= 游标` 丢弃、游标只前进、`reset`/`truncated` 钉 `headSeq`、临时失败保留旧游标；
  `RecoveryCoordinator` 在**每个** greeting 上先 `observeHeadSeq`（首次 baseline / epoch
  重建）再 `recover`，**replay 完成后**才刷新工作 tab 与页面；`WsClientV2.emitRecovered`
  把恢复帧送回与 live 相同的 stream；断连/退后台 `flush()` 游标。

## 行为变化 / Breaking

1. **纯增量（无 breaking）**：新端点 `event.replay`（internal，不进 SDK 面）、新 greeting 字段
   `instanceId`、mobile 新模型/服务；既有 SSE、WS 帧、普通 API 响应形状与鉴权逐字不变。
2. **移动端恢复语义变化**：断线重连从「立即全量 refetch」改为「先 replay 补齐、再 REST 对账」；
   `reset`/`truncated`/旧网关/请求失败仍走全量重拉，旧 gateway 下行为退化为现状。
3. **游标持久化键**：`mafw_event_seq` / `mafw_event_instance`（SharedPreferences 两个标量键）；
   首次连接以 greeting `headSeq` 建立 baseline，不 replay。
4. **`onReconnected` 保留但不再由 `main.dart` 使用**：配置了 `onGatewayReady` 时客户端抑制旧钩子，
   `ConnectionEvents` / `WorkRefreshBus` 由 `RecoveryCoordinator` 在 replay 后驱动。
5. **契约产物**：新增 `event.replay`（`gateway-paths.json` / `openapi.json` / `api-schema.gen.ts`
   纯增量 +231 行）；catalog 315 → **316 operations / 281 → 282 paths**；SDK 无调用方，contract 5/5。

## 验收 review fix（`12831674`）

全分支终审 3 个 Important，2 个成立、1 个不成立：

1. **`recovery.init()` 后缺少 mounted 复检**：`main.dart` 现在在 await 后再次检查
   `mounted`，已销毁的 State 不再 `setState` / 启动 observer；同时给 `MafwMobileApp`
   加只用于测试的 `cursorStore` 注入点，widget 测试覆盖「dispose 时 init 仍在途」。
2. **回放帧可能驱动 live turn 状态**：`MafwEvent.recovered` + `WsClientV2.emitRecovered`
   标记 provenance，`drivesLiveTurn` 让 Chat / Tech Lead 的回放帧只刷新历史、不改
   `_sending` / `_phase`，避免旧 `turn.completed` 结束新发送。
3. **busy gate 抑制 epoch/fallback 重拉**：未复现。epoch change 分支会跳过 `recover()`，
   fallback 与 busy 互斥；新增回归测试钉住「epoch change while replay in flight →
   refresh + full reload」，未改代码。

## 验证（worktree @ E5b-4 文档改动后）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`gateway/`，gateway-local TS 5.9.3） | **0 errors** |
| gateway 全量 | `node ../node_modules/jest/bin/jest.js --runInBand --forceExit --no-coverage --json`（`gateway/`） | **6959 tests：6948 passed / 9 failed / 2 skipped**；**887 suites：883 passed / 3 failed / 1 skipped**（3 个失败 suite 与基线同集合：`plugin-package-e2e` 4、`claude-adapter-acceptance` 4、`claude-adapter-coverage` 1，见已知红 #1；基线未重跑全量，新增测试按文件计 +28） |
| SDK 类型 | `node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`packages/gateway-sdk`） | **0 errors** |
| SDK 全量 | `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test "src/*.test.ts"` | **229/229 passed** |
| SDK contract | 同上 `--test src/contract.test.ts` | **5/5 passed** |
| desktop | `npm run test:desktop`（worktree root） | **3569 tests / 3569 passed / 0 failed**（696 suites）。首次运行 3568/1：`mafw-gateway-resolver.test.ts` 的 dev-path 用例因 worktree 无 `gateway/dist`（隔离环境，非代码）返回 null；`gateway npm run build` 后复跑全绿 |
| TUI 测试 | `npm run test:tui` | **env-red**：`@earendil-works/pi-tui` 未安装（`ERR_MODULE_NOT_FOUND`，主 checkout 同）；本波零 TUI 改动 |
| mobile 定向 | `flutter test test/event_replay_test.dart test/event_recovery_test.dart test/ws_recovery_test.dart test/recovery_coordinator_test.dart` | **69/69 passed** |
| mobile review fix 定向 | `flutter test` 上述 4 文件 + `event_effects_test.dart` + `widget_test.dart` | **90/90 passed** |
| mobile review fix analyzer | `dart analyze lib test` | **No issues found**（0 issues） |
| mobile 全量 | `flutter test` | **485 passed 后 runner 中止**（`did not complete` 级联，已知 Windows 并发 flake）；被中断文件隔离复跑全绿：`plan_approval_test` 17/17、`work_tab_test` 29/29、`pairing_page_test` 45/45 |
| mobile analyzer | `dart analyze lib test` | **No issues found**（0） |
| 路由扫描 | `node scripts/analyze-routes.cjs`（`gateway/`） | **TOTAL 0 (match 0, equals 0)** |
| kernel-split 守卫 | `node ../node_modules/jest/bin/jest.js tests/unit/architecture/kernel-split-guards.test.ts --no-coverage --runInBand --forceExit`（`gateway/`） | **7/7 passed** |
| 契约产物新鲜度 | `npm run emit:openapi`（`gateway/`，316 routes → 282 paths / 316 operations）+ `node scripts/merge-contract.mjs`（SDK，overrides 19） | **内容无 diff**（工作区干净） |

## 新增测试（对基线 `b72ca273` 的增量）

| 面 | 新增 | 依据 |
|---|---|---|
| gateway | **+28** | E5b-1：`event-store-replay-after` 7 + `events-replay` 15 + `api-contract.test.ts` +1；E5b-3：`ws-connected-hearseq.test.ts` 3 → 8（+5，greeting `instanceId` + live getter + 鉴权回归钉） |
| mobile | **+74** | 四个新测试文件：`event_replay_test.dart` 23、`event_recovery_test.dart` 28、`ws_recovery_test.dart` 9、`recovery_coordinator_test.dart` 12（含 batch2/batch3/acceptance review 修正用例）；review 回归另含 `event_effects_test` +1、`widget_test` +1 |

> 计数口径：可执行 test case 数，不是断言数。

## 已知红（非本波代码问题）

1. **gateway 已知 env-red（3 suites / 9 tests，基线同红）**：`integration/plugin-package-e2e`
   （Desktop `node_modules` 的 `@mafw/plugin-contract` staging）、`claude-adapter-acceptance` /
   `claude-adapter-coverage`（`@anthropic-ai/claude-agent-sdk` 缺失）。
2. **TUI**：`@earendil-works/pi-tui` 未安装在本地 `node_modules`（`ERR_MODULE_NOT_FOUND`，主 checkout 同），
   与 E5b 无关；本波未触碰 TUI 源码。
3. **mobile 全量 flake**：Windows `flutter test` 并发 widget 套件偶发 runner 中止
   （`did not complete` / `Connection closed before test suite loaded`），被中断文件单独跑全绿；
   E5b 的四个新文件均为纯 unit/service 测试，定向运行可稳定复现全绿。
4. **desktop 1 次环境红（非本波，已消除）**：worktree 内未构建 `gateway/dist` 时，
   `mafw-gateway-resolver.test.ts` 的 dev-path 用例拿到 `null`（resolver 只按模块位置/cwd 找
   `gateway/dist/index.js`）；`gateway npm run build` 后复跑 **3569/3569**。本波 desktop 零 diff。

## Deferred（明确不在 E5b 范围）

- **E6**：desktop replay 接入、单点扇出、单一实体缓存、事件→增量补丁、mobile 增量渲染。
- **已知残留（E5b 接受）**：
  1. 同实例 `reset` 且新 `headSeq` **低于**本地游标时，游标只抬不降 → 每次重连重复
     reset + 全量重拉（有界，不丢数据）。
  2. `hasMore` 页出现 `nextSince <= since`（服务端契约违约）时循环静默结束：尾部小缺口
     被跳过且不发 fallback 信号（契约守卫优先于穷举）。
  3. busy / 后台竞态：在途 replay 期间到达的 greeting 返回 `busy` 且不刷新（在途调用者负责）；
     主动断连（退后台）期间到达的 greeting 被丢弃，可能整段生命周期不做恢复。
  4. `onReconnected` 仅保留兼容，`main.dart` 不再使用（配置 `onGatewayReady` 时被抑制）。
  5. 持久化节流窗口（50 条 / 250ms）内进程被杀，冷启动可能重放少量已应用 seq；
     消费面按 **at-least-once** 设计，重复由幂等刷新 / REST 对账吸收（不是 exactly-once）。
  6. greeting 的 `headSeq` 为 null 时 `observeHeadSeq` 直接返回，旧游标保留；下次重连仍会
     reset/fallback（有界，不丢数据）。
- **回放保留策略**：不改 `event_log` retention / 表结构；超出保留窗口只能 `truncated` → 全量重拉。
- **鉴权面**：replay 沿用普通 API（loopback / human / device / service），未新增 rate limit；
  不要求 human（只读恢复通道）。
