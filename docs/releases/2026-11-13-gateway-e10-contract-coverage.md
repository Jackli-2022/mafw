# Gateway E10 契约覆盖（第一批）交付记录（2026-11-13）

- 版本：gateway 4.16.1 / desktop 5.1.0 / SDK 5.1.0（无版本号变更；mobile 1.1.0+2 不变）

## 波次

- 分支：`feat/gateway-e10-contract-coverage`（worktree `.superpowers/e10-worktree`），基线 `a7d82c6d`
  （main，E10 spec/plan 落库时点）
- 范围：E10-1 session 读接口 8 ops schema + E10-2 Pod/Work 读接口 8 ops schema
  + E10-3 覆盖率台账与 `session.get` 404 + E10-4 收口
- spec：`docs/superpowers/specs/2026-11-13-gateway-e10-contract-coverage-design.md`
- plan：`docs/superpowers/plans/2026-11-13-gateway-e10-contract-coverage.md`
- 架构现状：`docs/architecture/gateway.md` §「E10 契约覆盖第一批」、
  `docs/architecture/desktop.md` §「缺失会话 404（E10-3）」、`docs/architecture/mobile.md` §7.11
- TDD：每项先写失败测试 → 最小实现 → 一个 commit；批证据见
  `.superpowers/sdd/2026-11-13-gateway-e10-contract/{progress.md,batch1-report.md,batch2-report.md,batch3-report.md}`

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `dcbde7f2` | E10-1 | `session-read.ts`（new）8 个 session 读 op 的 200 response schema + catalog 挂载 + 生成物 + 7 项 `AssertEq` |
| `7a6fd2e5` | E10-2 | Pod/Work 8 个读 op schema（`work.ts` new + `pods.ts` 扩展）+ 8 项 `AssertEq` + DTO 收紧 |
| `72ca271f` | E10-3 | `schema:coverage` 台账（脚本 + 测试）+ `session.get` 缺失改 404 + SDK/桌面调用方适配 |
| E10-4（本记录） | E10-4 | 架构现状 + 本记录 + 全量门禁 + ledger（docs-only） |

## 交付项

- **E10-1 会话读接口 8 ops**（只加 OpenAPI 元数据，handler 零改动）：
  `session.queue.list` / `session.config` / `session.todo` / `session.children` / `session.tokenSummary` /
  `session.checkpoints` / `session.subagents.list` / `session.diff`，schema 集中在
  `gateway/src/routes/schemas/session-read.ts`，字段以 handler 实际 wire 为准。
  - `session.children` 是唯一 **schema-only**（item 由 runtime 拥有：opencode 原生子会话列表 / pi 的
    `AdapterSession`，只有 `id` 必填）→ 用带 owner 注释的边界对象，只承诺 `id` + `depth`，不组合
    `SessionSchema`（会要求 pi 不保证的 title/directory/time）。
  - `session.tokenSummary` 不新增命名 DTO（复用 SDK client 的内联返回类型做 `AssertEq`）；
    `session.subagents.list` 新增 `SubagentRecord` / `SubagentList`（当前无 SDK client 方法 = consumer-free）。
- **E10-2 Pod / Work 读接口 8 ops**：`work.overview`（`routes/schemas/work.ts`，new：五桶 ×
  `PodGoalSchema` + 同源 `counts` + `total`）、`pod.events.list`、`pods.tasks.list`、`pods.messages.list`、
  `pods.goals`、`pods.goals.result`、`pods.goals.reviewItems`、`pods.cost`。
  - `groups[bucket]` 与 `counts[bucket]` 是同一 `goals.views()` 数组的两个投影（handler 不截断），
    按严格五桶建模，不用 `additionalProperties` 放宽；
  - `PodGoalResult.receipt` 是 goal driver 拥有的不透明 receipt JSON（`unknown | null`，带 owner 注释）；
  - `mobile/lib/src/models/pod_models.dart#WorkOverview.fromJson` 与 schema 逐字段对齐，**mobile 零代码改动**。
- **E10-3 覆盖率台账**：`gateway/scripts/schema-coverage.cjs`（文本解析 `route-catalog.ts`，去注释 +
  字符串感知；输出 `total / covered / coveredOps / byTag / uncoveredOps`，支持 `--json`，CLI 恒退出 0）
  + `npm run schema:coverage`；测试 `gateway/tests/unit/architecture/schema-coverage.test.ts`（3 条）：
  逐 op 断言仍带 `response`、`covered >= 29` 且 `total === 316`、脚本输出与 `buildRouteCatalog()` 完全一致。
- **E10-3 `session.get` 缺失 → 404**：`gateway/src/routes/sessions-core.ts` 的 miss 从
  `200 {error:'not found'}` 改为 `404 {error:'not found'}`（body 逐字不变；runtime 投影优先 / SDK fallback /
  500 分支不变）。调用方审计：
  - SDK `sessions.get()` 现在对非 2xx 抛错（`HTTP 404: not found`），不再把错误信封当 `Session`；
  - 桌面**唯一行为变更**在 `renderer/mafw/subagent-reconcile.ts`：新增 `isSessionNotFoundError(err)`
    （`status === 404` 或消息含 `404` + `not found`），404 收敛 `session-deleted`（旧 gateway 的 200
    信封仍兼容），非 404 失败继续 fail-open——修复了「会话已删但子代理行永远 stale running」；
  - `ChatPane` / `MafwShell` / `session-status` 本就 try/catch（失败 = 不可用），只补语义注释；
  - TUI / mobile 无 `sessions.get` 直用；根 `src/tools/pod-common.ts` 经 `podRequest` 本就对非 2xx 抛错，
    只是错误文案从 `session directory unavailable` 变成更准确的 `HTTP 404 not found`；
  - SDK `types.ts` / `client.ts` 注释 + `client.test.ts` 新增 404 用例。

## 覆盖率数学

| 口径 | operations | 说明 |
|---|---|---|
| 基线 `a7d82c6d` | **13 / 316** | `schema:coverage` 脚本实测（E8/E9 release 里「20/316」是含非 catalog 统计的旧口径） |
| E10-1 后 | 21 / 316 | +8（session 读） |
| E10-2 后 | 29 / 316 | +8（pod/work 读） |
| **终值** | **29 / 316（9.2%）** | by-tag 分区和 = 29；未覆盖 287 |

本波新增的 16 op 分组：**session 8**（E10-1）+ **pod/work 8**（E10-2）。生成链：catalog `RouteDef.response`
→ `npm run emit:openapi`（gateway）→ SDK `npm run gen:api`（`merge-contract.mjs` + `openapi-typescript`）→
`contract/gateway-paths.json` / `contract/openapi.json` / `src/api-schema.gen.ts` 入库。

## 行为变化 / Breaking

1. **`session.get` 缺失返回 404（唯一 wire 变化）**：旧版是 `200 {error:'not found'}`。body 逐字相同，
   变的只是状态码。**旧 desktop 构建产物 + 新 gateway** 的混搭下，旧代码会把缺失会话当活会话
   （读 `{error}` 后多数调用方 fail-open，不会崩，只是状态偏旧 / 子代理行可能停在 stale running）。
   本仓库 desktop 打包自带同版本 managed gateway，正常升级路径不触发；跨版本混用请以「桌面跟 gateway
   同版本」为准。SDK 侧是编译期无感、运行时行为变化：`sessions.get()` 现在 **reject**，容忍缺失的调用方
   必须 `catch` / `.catch(() => null)`。
2. **SDK DTO 收紧（以 handler 为准，0 破坏性消费者）**：
   - `SessionConfigState.thinkingLevelSupported` 可选 → **必填**（`SessionConfigService.get()` 恒发）；
   - `SessionCheckpoint.actions` 抽出 `SessionCheckpointActions`，新增 `SessionCheckpointListItem`
     （`checkpoints()` 返回列表条目；GET 列表恒带路由层 `projectCheckpointActions`，POST 创建不带
     actions，两者不能共用一个可选形状）；
   - `PodMessage` 的 `protocol` / `externalMessageId` / `deliveredAt` / `deliveredSessionId`
     可选 → **必填可空**（wire 恒发 `string | null`）；
   - `PodGoalResult` 的 `revision` / `reviewed` / `assessment` / `worktree` / `acceptance` 可选 → 必填，
     `failure` → `PodGoalResultFailure | null`，`goalConditions` 改为 `PodGoalCondition`，
     `goalResults` / `tasks` 抽出 `PodGoalResultCheck` / `PodGoalResultTask`；
   - `PodEventItem` 的 `reason` / `audience` / `severity` → 联合类型（与 `pod-event-model.ts` 写侧一致）。
   受影响消费者：桌面 `pod-result-view-model.ts`（已提供全部字段）、`PodInbox` / `pod-store`（只读）、
   `pod-store.test.ts` 的 mock 用本地宽松类型 → `tsgo` 无新增红，均为 **0 破坏**。这三处 DTO 上「旧 gateway
   可能不发」的注释随之下架（wire 一直发，注释是陈旧的保守表述）。
3. **`work.overview` / pod 读接口的 OpenAPI schema 新增**：纯元数据，wire 不变；生成物
   `gateway-paths.json` 有 +6675/−1429 的 diff，绝大部分是 git 对齐噪声（`PodGoalSchema` 在
   `work.overview` 里被内联 5 次），按解析后 JSON 比对确认只有 8 个目标 op 变化。
4. **`session.children` 的 SDK 声明与 wire 不一致（既有问题，本波只记录不改）**：client `children()`
   声明 `Promise<any[]>`，实际是 `{items}`，桌面 `subagent-reconcile` 的 `Array.isArray(children)`
   判断使 children 快照实际静默 no-op。修它要动 desktop（`ChatPane`、`subagent-reconcile`、
   preload `mafw-types`），留待单独批次。

## 验证（worktree @ E10-4）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`gateway/`，gateway-local TS **5.9.3**） | **0 errors**（E9 记的 `boot.ts#BootKernel` 基线红已被 `f0ac64cb` 修掉） |
| gateway 全量 | `node ../node_modules/jest/bin/jest.js --runInBand --forceExit --no-coverage`（`gateway/`） | **7153 tests：7142 passed / 9 failed / 2 skipped**；**912 suites：908 passed / 3 failed / 1 skipped**。9 条失败**恰好**是 3 个已知 env-red suite（`plugin-package-e2e` 4、`claude-adapter-acceptance` 4、`claude-adapter-coverage` 1），**零 E10 红** |
| 覆盖率台账 | `npm run schema:coverage` | **29/316 operations（9.2%）**，by-tag 分区和 = 29，未覆盖 287 |
| 路由分析 | `node scripts/analyze-routes.cjs` | **`TOTAL 0 (match 0, equals 0)`** |
| 契约产物新鲜度 | `npm run emit:openapi`（gateway） | **316 routes → 282 paths / 316 operations，无 diff**（工作区仅 docs 变更） |
| kernel-split 守卫 | jest `tests/unit/architecture/kernel-split-guards.test.ts` | **7 / 7 passed** |
| SDK 类型 | `node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | **0 errors** |
| SDK 全量 | `npm test`（`src/*.test.ts`） | **225 / 225 passed（0 fail）** |
| SDK contract | `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test src/contract.test.ts` | **4 / 4 passed**（0 dead ops，0 exemptions） |
| SDK 生成物 | `git status`（SDK + 仓库根） | **无 generated-artifact diff**（`gateway-paths.json` / `openapi.json` / `api-schema.gen.ts` 与 HEAD 一致） |
| desktop 全量 | `npm run test:desktop`（worktree root） | **3799 tests：3798 passed / 1 failed**；**728 suites**。唯一红 = `src/main/mafw-gateway-resolver.test.ts` dev-path（worktree 未构建 `gateway/dist`，E5b/E6/E7/E8/E9 同红） |
| desktop 类型 | `node ../../node_modules/@typescript/native-preview/bin/tsgo.js --noEmit -p tsconfig.json`（`packages/desktop`） | 只剩已知 `node:tls` **2 条**（`getCACertificates` / `setDefaultCACertificates`），无 E10 新增 |
| mobile 定向 | `flutter test test/pod_models_test.dart test/work_tab_test.dart --concurrency=1` | **51 / 51 passed** |
| mobile 全量 | `flutter test --concurrency=1` | **562 passed + 5 `did not complete`**（`pairing_page_test.dart` 3 + `sessions_page_test.dart` 2，已知 Windows widget worker flake）；两个文件单跑 **56 / 56 passed** |
| mobile analyzer | `dart analyze lib test` | **No issues found**（0） |
| TUI | `npm run test:tui` | **env-red**：`ERR_MODULE_NOT_FOUND` — `@earendil-works/pi-tui` 未安装（主 checkout 同）；本波零 TUI 改动 |

## 新增测试（对基线 `a7d82c6d` 的增量）

| 面 | 新增 | 依据 |
|---|---|---|
| gateway | **+12** | `tests/unit/api-contract.test.ts` +9（E10-1 四个 / E10-2 五个 → 文件 14 → 23）；`tests/unit/architecture/schema-coverage.test.ts` +3（29 op 逐个带 schema / `covered >= 29` 且 `total === 316` / 脚本↔catalog 一致）；`tests/unit/routes/sessions-core-wiring.test.ts` 1 条**改写**（200 → 404，不新增） |
| SDK | **+1** | `src/client.test.ts`：`sessions.get` 缺失抛 `HTTP 404`（不返回错误信封）；`contract-compat.checks.ts` 15 个 `AssertEq` 是编译期，不计入运行时计数 |
| desktop | **+2** | `renderer/mafw/subagent-reconcile.test.ts`：404 收敛 `session-deleted` / 500 不误判 |
| mobile | 0 | 无代码变更（`WorkOverview.fromJson` 只做契约对齐核对） |
| **合计** | **+15** | 可执行 test case 数（非断言数） |

## 已知红（非本波代码问题）

1. **gateway env-red 9 条 / 3 suites**：`tests/integration/plugin-package-e2e`（4）、
   `tests/unit/runtime/claude-adapter-acceptance`（4）、`tests/unit/runtime/claude-adapter-coverage`（1）——
   esbuild 在未预构建的 worktree 里解析不到 `@anthropic-ai/claude-agent-sdk` /
   `@mafw/plugin-contract` staging；与基线同集合，E10 未触碰适配器 / 插件打包路径。
2. **desktop 1 条环境红**：worktree 未构建 `gateway/dist` → `mafw-gateway-resolver` dev-path 拿到 `null`；
   `gateway npm run build` 后即全绿。
3. **desktop 类型 `node:tls` 2 条**：`@types/node` 版本比运行时的 `node:tls` 旧，既有噪声。
4. **TUI env-red**：`@earendil-works/pi-tui` 未安装（全仓同），本波零 TUI 改动。
5. **mobile 全量 flake 5 条**：`flutter test --concurrency=1` 在 Windows 上偶发 widget worker 卡住，
   runner 把该文件剩余用例标 `did not complete`（本次是 `pairing_page_test.dart` 3 条、
   `sessions_page_test.dart` 2 条；日志显示同一用例 6 秒内重复打印后超时）。两个文件单独跑
   **56 / 56 passed**；与 E9 的 `tab_shell_test.dart` / `theme_tokens_test.dart` 同类，与 E10 无关。

## Deferred（E10 后仍保留）

- 剩余 **287** 个 op 的 response schema 覆盖（29/316 已覆盖；下一批继续按 8 ops/批推进，台账
  `npm run schema:coverage` 把口径固定在脚本上）。
- POST/PUT/PATCH/DELETE 的请求 / 响应 schema（本波只建模读接口的 200 成功体，错误体不建模）。
- `session.structured` / `session.trajectory` 的深度建模（runtime-owned 不透明 payload）。
- OS keychain / 进程签名、MCP human 工具。
- 强制版本协商 / SDK 全量 schema 类型化。
- 插件 / manager 会话的配额副作用（内部会话失败只 log）。
- `PodGoal` 可选性比 handler 实际输出宽（收紧要动约 12 个 DTO 字段并打破桌面测试夹具，E8 先例）；
  `FileDiffInfo.file` 仍可选，而 `session.diff` 的 `MafwDiff.file` 必填。
- `session.children` 的 SDK `children()` 返回类型未修（见上「行为变化」第 4 条）。
- **won't do**：`pod.updated` 记录级实体 payload（E9-3）；mobile 工作 tab 的其余增量渲染。

> E9 release 里记的 gateway 基线类型红（`boot.ts#BootKernel` 缺 `bindPluginAutomation`）已在本波基线前被
> `f0ac64cb`（wire plugin events/actions into live kernel）修掉，E10 的 `tsc` 为 0 error，不再是已知红。
