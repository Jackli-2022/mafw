# Gateway E11 身份 / 配额硬化交付记录（2026-11-13）

- 版本：gateway 4.16.1 / desktop 5.1.0 / SDK 5.1.0（**无版本号变更**；mobile 1.1.0+2 不变）

## 波次

- 分支：`feat/gateway-e11-identity-hardening`（worktree `.superpowers/e11-worktree`），
  基线 `fbf7f915`
- 范围：E11 原清单里设备生命周期已完成（deviceName 校验、WS `?deviceId=` 凭据优先、`pruneStale`
  定时触发、rotate/revoke 已有），本波只做**四个真实缺口** + 一个后续修复：
  human token 轮换（E11-1）、内部会话配额账实（E11-2）、admission 二次校验（E11-3）、
  MCP human 边界审计 + keychain 裁决（E11-4）、manager slot 回滚（E11-2b）
- spec：`docs/superpowers/specs/2026-11-13-gateway-e11-identity-hardening-design.md`
- plan：`docs/superpowers/plans/2026-11-13-gateway-e11-identity-hardening.md`
- 架构现状：`docs/architecture/gateway.md` §「E11 身份 / 配额硬化」+ §「E11-4 身份边界决策」、
  `docs/architecture/desktop.md` §「human token 轮换后的 403 自动重读重试」、
  `docs/architecture/tui.md` §「TUI human token 轮换：需重启」、
  `docs/guides/operations.md` §「轮换 human token」
- TDD：每批先写失败测试 → 最小实现 → 一个 commit；批证据见
  `.superpowers/sdd/2026-11-13-gateway-e11-hardening/{progress.md,batch1-report.md,batch2-report.md,batch3-report.md}`

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `1779edb0` | E11-1 | `feat(auth)`: `rotateHumanToken` + `POST /api/human-token/rotate`（只认 human-token principal）+ kernel live rebind + `mafw rotate-human-token` + 桌面 403 重读重试 |
| `56a9bb1b` | E11-2 | `fix(sessions)`: `registerLeadSessionRecord` 在配额拒绝时回滚内部身份、广播 `session.registration_failed`，两条 Lead 路径统一 |
| `c0e6650c` | E11-3 | `fix(scheduler)`: `SchedulerOpts.resourceAdmission` + `pump()` 起始二次校验（work-conserving）+ governor 恢复边沿 `scheduler.sweep()` |
| `069a62f0` | E11-2b | `fix(sessions)`: `clearManagerSlotsForSession` + `rollbackRejectedLeadRegistration`；配额拒绝的轮换清槽并抛错 |
| `17c1fb2b` | E11-4 | `test(mcp)`: 47 工具名快照 + human-only 动词白名单 + `src/mcp/**` 源码扫描；MCP human / keychain 决策入库 |
| 本记录 | E11-5 | `docs(gateway)`: 架构现状 + 运维指南 + 本记录 + 全量门禁 + ledger（docs-only） |

## 交付项

- **E11-1 human token 轮换**：`core/human-token.ts#rotateHumanToken(dir)` 复用既有原子写
  （`.tmp` + fsync + rename + `chmod 0600`）；`routes/human-token.ts` 挂 `POST /api/human-token/rotate`，
  **只接受 `principal.kind === 'human' && principal.method === 'human-token'`**（device token / service /
  loopback / anonymous 一律 403 稳定体 `{error:'human principal required', code:'human_principal_required'}`，
  且在任何文件访问 / body 读取之前）。成功 `200 {token, rotatedAt}`，kernel `rotateHumanTokenNow()`
  写盘后 `this.humanToken = token`（live getter）→ 新 token 立即生效、**旧 token 立刻失效**；写失败
  `500 {error}` 且旧 token 仍可用；日志只记常量 `[Auth] human token rotated`。
  CLI `mafw rotate-human-token` 只打印 `rotatedAt`；桌面 `mafw-invoke` 捕获 stale-403 后重读 token 并
  **只重试一次**；TUI 记录为「需重启」的已知限制。
- **E11-2 内部会话配额账实**：`core/session/internal-registration.ts#registerLeadSessionRecord`
  保持「internal identity → `registerExternal`」顺序，失败时**先回滚** `unregisterInternalSession`，
  再 `log.warn`、再广播 `session.registration_failed`
  `{sessionId, role, code:'quota_exceeded'|'error', message}`，最后返回 `{ok:false}`——**从不 throw**。
  两条 Lead 路径统一走 kernel 的 `registerLeadRecord`，静默 `.catch(() => {})` 删除。
  配额政策不变（内部会话仍占名额）。
- **E11-2b manager slot 回滚**：`rotateCreateManagerSession` 在注册前就持久化 `manager-session` 槽；
  注册被拒时 `clearManagerSlotsForSession(store, sessionId, runtime)` 清槽并抛
  `Error('<code>: <message>')`，死 session id 不出网关（槽行保留 `{byRuntime:{}}`，其他 runtime /
  `unattributed` 不动）；`archiveLeadSession` 复用同一 helper。
- **E11-3 admission 二次校验**：`SchedulerOpts.resourceAdmission?: () => boolean`（**只**表达资源压力，
  不复用 budget checker）；`pump()` 每次求值一次，压力下跳过非前台候选（留在队列，不拒绝 / 不丢 /
  不重复），前台仍被考虑；kernel 注入 `() => !(this.governor?.isDegraded() ?? false)`；
  `shouldResumeScheduler(prev, next)`（`degraded` 非空 → 空）在 governor `onChange` 触发
  `void this.scheduler.sweep()` 自动续跑。
- **E11-4 MCP human 边界 + keychain 裁决**：`gateway/tests/unit/mcp/human-boundary.test.ts`
  47 工具名快照（含 handler/definition 双向 parity）、human-only 动词扫描（3 条具名白名单
  `mafw_pod_review_respond` / `mafw_decision_draft` / `mafw_ask_user`，每条按 key 与理由措辞双向钉住）、
  `gateway/src/mcp/**` 静态扫描禁 `requireHumanPrincipal` / `confirmDecision` / `shelveDecision` /
  `acceptGoal` / `replyPermission` / `rotateHumanToken` / `human.token`。
  `gateway.md` 记录 **MCP human 工具 = won't do**、**OS keychain / 进程签名 = won't do（本阶段）**。

## 行为变化 / Breaking

1. **轮换会立即使旧 token 失效**（intended）：`POST /api/human-token/rotate` 成功后，任何仍缓存旧
   token 的客户端在 human-only 动作上拿到 403 `human_principal_required`。桌面自动恢复（重读 + 重试一次），
   **TUI 需重启**（无集中重试入口），其他外部脚本需自行重读 `~/.mafw/human.token`。
2. **device token 不能轮换 human token**：手机（`dev_…`）、service apiToken、loopback 无凭据调用一律 403。
   这是刻意的——轮换必须证明持有被替换的凭据，否则已配对设备可以单方面作废桌面凭据。
3. **新增事件 `session.registration_failed`**（additive）：`{sessionId, role, code, message}`，进 event_log
   / SSE 广播；旧消费者忽略未知事件即可（desktop / mobile 未接线，仅观测 + 未来 UI 入口）。
4. **Lead 配额失败现在会回滚身份**：配额满时不再留下「幽灵内部会话」（invisible 但占 identity 的会话）。
   `rotateCreateManagerSession` 在同样情况下**清 manager slot 并抛错**，调用方拿到
   `quota_exceeded: …` 而不是一个死 session id。
5. **准入复检可能延后排队中的后台任务**：降级期间 `pump()` 不启动非前台任务（留在队列），恢复后由
   governor 采样边沿触发 `sweep()` 续跑。前台不受影响；submit-time 拒绝语义逐字不变。
6. **wire 新增 1 个 op**：`humanToken.rotate`（POST，tag `auth`，200 `{token, rotatedAt}`）→ catalog
   317 → **318**；SDK **不提供**该方法（`NON_SDK_EXEMPT` 具名豁免 + stale 守卫）。其余 wire 零变化。

## 覆盖率数学

| 口径 | operations | 说明 |
|---|---|---|
| 基线 `fbf7f915` | **44 / 317** | E10b 收口值 |
| **E11 终值** | **45 / 318（14.2%）** | +1（`humanToken.rotate`），分母同时 +1（317 → 318）；未覆盖 **273** |

- spec 写的「45/317」是**分母算错**（新 op 同时进入分子与分母）；台账
  `gateway/tests/unit/architecture/schema-coverage.test.ts` 钉住 45 / 318，`npm run schema:coverage`
  实测 by-tag 分区和 = 45，`auth 1/1`（新 op 独占该 tag）。
- 生成链不变：catalog `RouteDef.response` → `npm run emit:openapi` → SDK `npm run gen:api` →
  `contract/gateway-paths.json` / `contract/openapi.json` / `src/api-schema.gen.ts` 入库。

## 验证（worktree @ E11-5）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `npx tsc --noEmit -p tsconfig.json`（`gateway/`，gateway-local TS **5.9.3**） | **0 errors** |
| gateway 全量 | `npx jest --runInBand --forceExit --no-coverage`（`gateway/`） | **7243 tests：7231 passed / 9 failed / 3 skipped**；suites **3 failed / 1 skipped / 917 passed（920 of 921）**；**9 条失败恰好是 3 个已知 env-red suite，零 E11 红**；264.9s（明细见下） |
| 覆盖率台账 | `npm run schema:coverage` | **45/318 operations（14.2%）**，by-tag 分区和 = 45，未覆盖 273 |
| 路由分析 | `node scripts/analyze-routes.cjs` | **`TOTAL 0 (match 0, equals 0)`** |
| 契约产物新鲜度 | `npm run emit:openapi`（gateway） | **318 routes → 284 paths / 318 operations，无 diff**（`git status` 干净） |
| kernel-split 守卫 | jest `tests/unit/architecture/kernel-split-guards.test.ts` | **7 / 7 passed** |
| SDK 类型 | `npx tsc --noEmit -p tsconfig.json` | **0 errors** |
| SDK 全量 | `npm test`（`src/*.test.ts`） | **226 / 226 passed（0 fail）** |
| SDK contract | `node --import tsx --require ../test-shim/require-hook.cjs --test src/contract.test.ts` | **4 / 4 passed**（`NON_SDK_EXEMPT` 具名豁免 `humanToken.rotate` → `bin/mafw.js rotate-human-token`，stale 守卫在位） |
| desktop 全量 | `npm run test:desktop`（worktree root） | **3843 tests / 731 suites：3842 passed / 1 failed**。唯一红 = `src/main/mafw-gateway-resolver.test.ts` dev-path（worktree 未构建 `gateway/dist`） |
| desktop 类型 | `npx tsgo --noEmit -p tsconfig.json`（`packages/desktop`） | 只剩已知 `node:tls` **2 条**（`getCACertificates` / `setDefaultCACertificates`），0 新增 |
| mobile 定向 | `flutter test <file> --concurrency=1` | `direction_question` **26/26**、`lead_entry` **13/13**、`pairing_page` **45/45**、`ws_auth` **8/8**（合计 **92 passed**）。首轮 `direction_question` 命中已知 widget worker `did not complete`（21 passed 后 worker 卡住），隔离重跑全绿；主 checkout 同样现象 → 环境 flake，非本波 |
| mobile analyzer | `dart analyze lib test`（先 `flutter pub get`） | **No issues found（0）** |
| TUI | `npm run test:tui` | **env-red**：`ERR_MODULE_NOT_FOUND` — `@earendil-works/pi-tui` 未安装（全仓同；本波零 TUI 代码改动） |

### gateway 全量明细

```
Test Suites: 3 failed, 1 skipped, 917 passed, 920 of 921 total
Tests:       9 failed, 3 skipped, 7231 passed, 7243 total
Snapshots:   0 total
Time:        264.871 s
```

- 失败**恰好**是 3 个已知 env-red suite：`tests/integration/plugin-package-e2e.test.ts`（4 个用例）、
  `tests/unit/runtime/claude-adapter-acceptance.test.ts`（4）、
  `tests/unit/runtime/claude-adapter-coverage.test.ts`（1）——esbuild 解析不到
  `@anthropic-ai/claude-agent-sdk`。**零 E11 红**（无新增失败 suite / 用例）。
- 总量 7243 对基线 `fbf7f915` = **+60**（E11-1 19 + E11-2 7 + E11-3 12 + E11-2b 9 + E11-4 13）。
  `3 skipped` 之一是本波新增的 POSIX 0600 用例（Windows 上跳过）。

## 新增测试（对基线 `fbf7f915` 的增量）

| 面 | 新增 | 依据 |
|---|---|---|
| gateway | **+60** | E11-1：`tests/unit/core/human-token.test.ts` 6（轮换 / 再轮换 / 空目录 / 无 `.tmp` 残留 / 写失败清理 / POSIX 0600 跳过）· `tests/unit/routes/human-token-rotate.test.ts` 12（rotate 成功 / 旧 token 403 与 新 token 200 走真实 `resolvePrincipal` / 5 种被拒 principal 且文件与内存未动 / 500 保留旧凭据 / POST-only / 空 token fail-closed / 日志常量 / CLI 不回显）· `api-contract` +1（`humanToken.rotate` schema 块）。E11-2：`tests/unit/session/internal-registration.test.ts` 7（成功路径顺序 / 配额回滚顺序 + 事件 payload / 通用错误 / 真实 `SdkSessionResource` 配额拒绝 / 每目录配额 / 无 `unhandledRejection` / 自定义 role）。E11-3：`tests/unit/scheduler/resource-admission.test.ts` 6 + `tests/unit/resources/admission-integration.test.ts` +6（5 条 `shouldResumeScheduler` 边沿 + governor→sweep 集成）。E11-2b：`tests/unit/session/manager-slot-rollback.test.ts` 9（清槽 + 持久化 / 其他 runtime 与 `unattributed` 保留 / 无行不写 / 幂等 / `<code>: <message>` / 通用 code / 清理失败上抛 / kernel 接线守卫）。E11-4：`tests/unit/mcp/human-boundary.test.ts` 13（快照 + parity / 动词扫描 + 白名单 / 源码扫描 + 报告器正向控制 / 无代行断言） |
| SDK | 0 | 无新增运行时用例；`contract.test.ts` 只新增 `NON_SDK_EXEMPT` 具名豁免 + stale 守卫（同 4 条用例内断言） |
| desktop | **+12** | `src/main/human-token.test.ts`：`isStaleHumanTokenError` 6（403+码 / 文本形态 / 403 无码 / 401·429·500 / 网络 / 结构化 code）+ `withHumanTokenRetry` 5（成功不刷新 / stale 刷新重试一次 / 二次失败上抛 / 刷新抛错 / 非 stale 不重试）+ 1 条 IPC 接线守卫 |
| mobile | 0 | 无代码变更 |
| **合计** | **+72** | 可执行 test case 数（非断言数） |

## 已知红（非本波代码问题）

1. **gateway env-red 9 条 / 3 suites**：`tests/integration/plugin-package-e2e`、`tests/unit/runtime/claude-adapter-acceptance`、
   `tests/unit/runtime/claude-adapter-coverage`——esbuild 在未预构建的 worktree 里解析不到
   `@anthropic-ai/claude-agent-sdk` / `@mafw/plugin-contract` staging；与 E10b 基线同集合，E11 未触碰适配器 / 插件打包路径。
2. **desktop 1 条环境红**：worktree 未构建 `gateway/dist` → `mafw-gateway-resolver` dev-path 拿到 `null`；
   `gateway npm run build` 后即全绿。
3. **desktop 类型 `node:tls` 2 条**：`@types/node` 比运行时 `node:tls` 旧，既有噪声。
4. **TUI env-red**：`@earendil-works/pi-tui` 未安装（全仓同），本波零 TUI 改动。
5. **mobile widget worker `did not complete`（Windows，非确定性）**：`flutter test --concurrency=1` 偶发把
   `direction_question_test.dart` 的后续用例标 `did not complete`（首轮 21 passed 后卡住，重跑 **26/26 全绿**）；
   主 checkout 复现同一现象，mobile 本波**零代码改动**，与 E11 无关。

## Deferred（E11 后仍保留）

- 剩余约 **273** 个 op 的 response schema 覆盖（45/318；继续按同族读接口 7–8 ops/批推进，台账
  `npm run schema:coverage` 固定口径）。
- POST/PUT/PATCH/DELETE 的请求 / 响应 schema（E10 / E10b / E11 只建模读接口与单个 auth op 的 200 成功体，
  错误体不建模）。
- 强制版本协商 / SDK 全量 schema 类型化。
- **TUI / mobile 的 triage phantom 字段渲染**：`ui/triage-tab.ts` 与 `triage_page.dart` 仍读
  `reason` / `goalId` / `severity`（真实 wire 只有 `summary` / `source` / `state` / `proposedGoal`），
  对齐方式同桌面 `triage-model`，留待后续批次。
- mobile 工作 tab 的其余增量 patch（E9-1 后 flat 帧已能触发 `goalId` 局部 patch，任务 / 消息仍是整页快照）。
- `session.list` override 的 responseSchema 元数据仍保留（catalog 已优先，留待后续清理）。
- `rotateCreateManagerSession` 被拒的 **runtime 会话不删除**（轮换失败是调用方可见错误，不是会话删除路径；
  后续可 best-effort `session.delete()`）。
- **won't do（本阶段，已有决策）**：OS keychain / 进程签名、MCP human 工具（E11-4，理由与缓解见
  `gateway.md`）；`pod.updated` 记录级实体 payload（E9-3）；`PodGoal` 可选性收紧（E8 先例）。
