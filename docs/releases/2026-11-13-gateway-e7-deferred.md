# Gateway E7 部署前 deferred 收口交付记录（2026-11-13）

- 版本：gateway 4.16.1 / desktop 5.1.0 / SDK 5.1.0（无版本号变更；mobile 1.1.0+2 不变）

## 波次

- 分支：`feat/gateway-e7-deferred-cleanup`（worktree `.superpowers/e7-worktree`），基线 `fb53caa9`
  （main，E7 spec/plan 落库时点）
- 范围：E7-1 剩余 human gates + E7-2 SDK 死面 + E7-3 worktree 配额回滚 + E7-4 MCP 磁盘门
  + E7-5 客户端小残留 + E7-6 收口
- spec：`docs/superpowers/specs/2026-11-13-gateway-e7-deferred-cleanup-design.md`
- plan：`docs/superpowers/plans/2026-11-13-gateway-e7-deferred-cleanup.md`
- 架构现状：`docs/architecture/gateway.md` §「E7 部署前 deferred 收口（2026-11-13）」、
  `docs/architecture/desktop.md` §「交互模型…（E6）」的 reset/truncated 游标条、
  `docs/architecture/mobile.md` §7.5 / §7.9
- TDD：每项先写失败测试 → 最小实现 → 一个 commit；批证据见
  `.superpowers/sdd/2026-11-13-gateway-e7-deferred-cleanup/{progress.md,batch1-report.md}`

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `4ee87b1c` | E7-1 | 统一 `core/http/human-guard.ts#requireHumanPrincipal`；plan-approval、triage confirm/reject/dismiss、lead.boundaries accept/merge/undo、approvals.respond、permissions.reply 全部 human/device 专属（只读/建议面不拦） |
| `67873a02` | E7-2 | 删除 `DEAD_CONTRACT_TODO` 与过滤（review-items 由 `pods.goals.reviewItems*` 覆盖，契约 4/4 无豁免）；删除 `session.events()`、`event.url(sessionID?)` 参数、`SSEConnection.connectToSession()` |
| `52ebf232` | E7-3 | `createSessionWithWorktree` 在 session 创建被拒（含 429）时 best-effort 回滚 worktree/branch，原错误原样抛出、不写 kv |
| `51c888da` | E7-4 | kernel 注入 `Services.pressure` live getter；`mafw_add_memory` 在 disk critical 时返回 `disk_low`，不再绕过 HTTP 门 |
| `f1cda812` | E7-5 | mobile 建模 `time.updated` 并重排；replay `nextSince <= since` 改 `protocol` fallback；desktop reset/truncated 后游标落盘 `headSeq` |
| E7-6（本记录） | E7-6 | 架构现状 + 本记录 + 全量门禁 + ledger（docs-only） |

## 交付项

- **E7-1 剩余 human gates**：新增 `gateway/src/core/http/human-guard.ts` 的
  `requireHumanPrincipal(req, res)`（human principal → `true`；否则 403
  `{ error:'human principal required', code:'human_principal_required' }`，缺失 principal
  fail-closed）。接入 `routes/goal-plan.ts`（仅 POST plan-approval；GET plan 只读）、
  `triage.ts`（confirm/reject；list/propose 不拦）、`wave1-handlers.ts`（dismiss）、
  `lead-boundaries.ts`（accept/merge/undo；list/observe 不拦）、`approvals.ts`（respond；
  list 与 rules CRUD 不拦）、`questions-permissions.ts`（reply；`replyRuntime` runtime 内部路径
  不动，list 不拦）。旧 pods/decisions/standing-goals 的本地 helper 不重构。新增
  `tests/unit/routes/human-only-guards-e7.test.ts` 38 条：每路由 missing/service/local/anonymous
  → 403 code + human/device → 原成功，外加只读/建议面不拦的负向断言。
- **E7-2 SDK 死面清理**：`contract.test.ts` 删除 `DEAD_CONTRACT_TODO`、其过滤与陈旧守卫测试；
  review-items 4 op 已由 SDK `pods.goals.reviewItems*` 方法覆盖，契约测试 **4/4 无豁免**
  （spec 的 5/5 计数包含被删的陈旧守卫，删除后为 4）。`client.ts` 删除 `session.events()`、
  `event.url()` 归零参并恒为 `${base}/api/events`；`sse.ts` 删除 `connectToSession()`；
  `types.ts` 同步。SDK 全量 224（删 4 条死面测试 + 1 条陈旧守卫）。全仓 grep 无生产调用方。
- **E7-3 worktree 配额回滚**：`createSessionWithWorktree` 把 `createSession` + `kvSet` 包进
  try/catch；失败时 best-effort `manager.remove(wt.worktreeDir, wt.branch)` 后 **rethrow 原错误**
  （remove 自身失败被吞，429/500 语义不变）。新增 3 条测试：回滚 + 原错传播 + 无 kv、remove 失败
  仍原错优先、成功路径不回归。
- **E7-4 MCP 磁盘门**：`gateway/src/types.ts` 增加 `Services.pressure?: () => { disk: string;
  degraded: string[] } | null`；`kernel.ts` 注入读 `this.governor` 的 live getter（governor 未建
  → null fail-open）；`mcp/handlers/add-memory.ts` 在 authority 校验之后、store/embedding 之前检查
  `disk === 'critical' || degraded.includes('disk_critical')` → `{success:false,
  error:'disk space critical', code:'disk_low'}` + `isError:true`。新增 6 条测试（critical 不落库、
  ok/null/无 pressure 正常、非法 authority 优先、degraded 标记）。
- **E7-5 客户端小残留**：
  - mobile `MafwSession.timeUpdated`（`fromJson` 读 `time.updated`、`copyWith`、`_mergeInfo`
    present-only patch）；`compareSessionRows` = Lead 先 + `timeUpdated ?? timeCreated` 倒序；
    `session.updated` 带来新 `timeUpdated` 时重排，其它字段 patch 不动顺序。
  - mobile `EventRecoveryService`：`hasMore && nextSince <= since` → `RecoveryFallback.protocol`
    + `fellBack`（游标停在最后已应用 seq；coordinator 走 refresh + fullReload），不再假
    `recovered`。
  - desktop `SseConnection`：replay `reset` / `truncated` 清游标后 `writeSeq(gap.headSeq)`，下次
    冷启动从 headSeq 补新缺口而不是全量重同步。
- **E7-6 收口**：architecture 三份文档现状更新（human gates / SDK 死面 / MCP 门 / worktree 回滚 /
  `time.updated` / protocol fallback / reset 游标 / 残余清单）、AGENTS.md 人类专属不变量补一行、
  本记录、全量门禁、ledger。

## 行为变化 / Breaking

1. **human-only 收紧（intended security fix）**：`POST /api/goals/:id/plan-approval`、
   `triage.confirm|reject|dismiss`、`lead.boundaries.accept|merge|undo`、`approvals.respond`、
   `permissions.reply` 对 service/local/anonymous/缺失 principal 一律 403
   `human_principal_required`。desktop/TUI/mobile 这些 UI 路径自 E5a 起已带 human/device 凭据；
   之前靠 service/local 驱动这些动作的 agent/automation 会被拒绝。只读/建议面逐字不变。
2. **SDK breaking（编译期）**：`session.events()` 删除；`event.url(sessionID?)` → `event.url()`；
   `SSEConnection.connectToSession()` 删除。无生产调用方；desktop preload 的 bridge 仍声明可选
   `sessionID` 参数但运行时已忽略（无调用方传值，保留待后续清理）。
3. **MCP `mafw_add_memory` 满盘行为**：disk critical 时从「仍可写」变为 `disk_low` 拒绝
   （与 HTTP `POST /api/memory/add` 对齐）；governor 缺失/非 critical 行为不变。
4. **worktree 失败语义**：session 创建失败不再遗留 worktree/branch；对外仍是原 429/500。
5. **mobile 排序**：列表按最近活动（`time.updated`）排序，旧数据回退 `time.created`；
   `session.updated` 可能触发重排（此前不重排）。
6. **mobile replay 违约**：`nextSince <= since` 从「静默按 recovered 结束」变为
   `protocol` fallback → 调用方多一次全量重拉（正确性优先）。
7. **desktop 冷启动**：`reset`/`truncated` 后持久游标 = `headSeq`，不再每次重启全量重同步。

## 验证（worktree @ E7-6）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`gateway/`，gateway-local TS 5.9.3） | **0 errors** |
| gateway 全量 | `node ../node_modules/jest/bin/jest.js --runInBand --forceExit --no-coverage`（`gateway/`） | **7055 tests：7039 passed / 14 failed / 2 skipped**；**897 suites：892 passed / 4 failed / 1 skipped**。失败 = 3 个基线 env-red suite（`plugin-package-e2e` 4、`claude-adapter-acceptance` 4、`claude-adapter-coverage` 1）+ `tests/unit/pod/pod-worktree-service` 5 条 **5s timeout**（全量并发下 git I/O 慢；单跑 **16/16 passed**，与 E7 无关）。E7-3 自己的 `worktree/routes-session-worktree` 在套件内全绿 |
| SDK 类型 | `node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`packages/gateway-sdk`） | **0 errors** |
| SDK 全量 | `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test "src/*.test.ts"` | **224/224 passed** |
| SDK contract | 同上 `--test src/contract.test.ts` | **4/4 passed，0 dead ops，0 exemptions** |
| desktop | `npm run test:desktop`（worktree root） | **3728 tests / 3727 passed / 1 failed**（`src/main/mafw-gateway-resolver.test.ts` dev-path：worktree 未构建 `gateway/dist`，与 E5b/E6 同红；725 suites） |
| desktop 类型 | `node ../../node_modules/@typescript/native-preview/bin/tsgo.js --noEmit -p tsconfig.json` | **仅既有 `node:tls` 噪声 2 条**（`getCACertificates` / `setDefaultCACertificates`，`src/main/index.ts:6`） |
| TUI | `npm run test:tui` | **env-red**：`@earendil-works/pi-tui` 未安装（`ERR_MODULE_NOT_FOUND`，主 checkout 同）；本波零 TUI 改动 |
| mobile 定向 | `flutter test test/session_list_events_test.dart test/event_recovery_test.dart test/recovery_coordinator_test.dart` | **79/79 passed**（8 条 E7 `time.updated` 用例 + 2 条 protocol fallback/coordinator 期望） |
| mobile analyzer | `dart analyze lib test` | **No issues found**（0） |
| mobile 全量 | `flutter test` | **496 passed 后 runner 中止**（61 条 `did not complete`，集中在 `direction_question_test` 等 widget 套件——Windows 并发 flake，已知；该文件 `--concurrency=1` 单跑 **26/26 passed**，主 checkout 同文件亦全绿） |
| 路由扫描 | `node scripts/analyze-routes.cjs`（`gateway/`） | **TOTAL 0 (match 0, equals 0)** |
| kernel-split 守卫 | jest `tests/unit/architecture/kernel-split-guards.test.ts` | **7/7 passed** |
| 契约产物新鲜度 | `npm run emit:openapi`（316 routes → 282 paths / 316 operations）+ `node scripts/merge-contract.mjs`（overrides 命中 19） | **内容无 diff**（工作区仅 docs 变更） |

## 新增测试（对基线 `fb53caa9` 的增量）

| 面 | 新增 | 依据 |
|---|---|---|
| gateway | **+47** | E7-1 38（`tests/unit/routes/human-only-guards-e7.test.ts`）+ E7-3 3（`worktree/routes-session-worktree.test.ts` 配额回滚 describe）+ E7-4 6（`tests/unit/mcp/add-memory-pressure.test.ts`） |
| mobile | **+9** | `session_list_events_test.dart` +8（`time.updated` 建模 3 + 事件 patch/重排/Lead-first/legacy fallback/title-only 5）+ `event_recovery_test.dart` +1（hasMore 不前进 = protocol fallback）；`recovery_coordinator_test.dart` 仅改既有期望 |
| desktop | **+1** | `tests/sse-replay-gap.test.ts` 冷启动只补新缺口用例（另 2 条既有 reset/truncated 用例改断言） |

> 计数口径：可执行 test case 数，不是断言数。SDK 为**减少** 5 条（4 条死面 + 1 条陈旧守卫）。
> gateway 基线（`fb53caa9`，按 7055 − 47 推算）7008 tests（6997 passed / 9 failed / 2 skipped）。

## 已知红（非本波代码问题）

1. **gateway env-red**：`integration/plugin-package-e2e`、`claude-adapter-acceptance`、
   `claude-adapter-coverage`（esbuild 解析不到 `@anthropic-ai/claude-agent-sdk` / Desktop
   `node_modules` 的 `@mafw/plugin-contract` staging），与基线同集合（9 条）。
2. **gateway 负载 flake**：`tests/unit/pod/pod-worktree-service` 5 条 5s timeout（全量套件下 git
   I/O 慢；单跑 16/16 全绿），本波只改 `routes/session-worktree.ts`，未触碰该服务。
3. **desktop 1 条环境红**：worktree 未构建 `gateway/dist` 时 `mafw-gateway-resolver` 的 dev-path
   用例拿到 `null`；`gateway npm run build` 后即全绿。
4. **desktop 类型门禁**：只剩既有 `node:tls` 2 条噪声（tsgo 与 tsc 结果一致）。
5. **TUI**：`@earendil-works/pi-tui` 未安装（`ERR_MODULE_NOT_FOUND`），主 checkout 同；本波零
   TUI 改动。
6. **mobile 全量 flake**：Windows `flutter test` 并发 widget 套件偶发 runner 中止
   （`did not complete` / `Connection closed before test suite loaded`），被中断文件单跑全绿
   （`direction_question_test` 26/26，主 checkout 同）。

## Deferred（E7 后仍保留）

- 约 300 个 op 的 response schema 覆盖。
- 全进程 timer inventory（serve watchdog / heartbeat / queue sweep / loader）。
- mobile 工作 tab 增量渲染（已有 `goalId` 局部更新）。
- `pod.updated` 记录级 payload、attention → decision 投影、OS keychain / 进程签名、MCP human 工具。
- 强制版本协商 / SDK 全量 schema 类型化。
- E5b 同实例 `reset` 低 head 的重复 reset、busy/后台 greeting 竞态。
- `authorizeWsUpgrade` 仅 deprecated；desktop preload event bridge 的 `sessionID` 形参待清理。
- 插件/manager 会话的配额副作用（内部会话失败只 log）。
