# Gateway E10b 契约覆盖（第二批）交付记录（2026-11-13）

- 版本：gateway 4.16.1 / desktop 5.1.0 / SDK 5.1.0（无版本号变更；mobile 1.1.0+2 不变）

## 波次

- 分支：`feat/gateway-e10b-contract-coverage`（worktree `.superpowers/e10b-worktree`），
  基线 `946937f1`（main，E10b spec/plan 落库时点）
- 范围：E10b-1 Goal / Pod Goal 读接口 8 ops + E10b-2 human-gate / 权限读接口 7 ops
  （含 5 个 override 转 code-first）+ E10b-3 桌面 triage 渲染收口 + E10b-4 收口
- spec：`docs/superpowers/specs/2026-11-13-gateway-e10b-contract-coverage-design.md`
- plan：`docs/superpowers/plans/2026-11-13-gateway-e10b-contract-coverage.md`
- 架构现状：`docs/architecture/gateway.md` §「E10b 契约覆盖第二批」、
  `docs/architecture/desktop.md` §「Triage 渲染对齐真实 wire（E10b-3）」、
  `docs/architecture/tui.md` §「TUI」已知类型缺口
- TDD：每批先写失败测试 → 最小实现 → 一个 commit；批证据见
  `.superpowers/sdd/2026-11-13-gateway-e10b-contract/{progress.md,batch1-report.md,batch2-report.md,batch3-report.md}`

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `f2cfffd5` | E10b-1 | `schemas/goals.ts`（new）+ `pods.ts` 扩展：8 个 Goal / Pod Goal 读 op 的 200 response schema + catalog 挂载 + 生成物 + 8 项 `AssertEq` |
| `ace3fac2` | E10b-2 | `schemas/human-gate.ts`（new）：7 个 human-gate / 权限读 op schema + 5 个 override 删除（18 → 13）+ DTO 按 handler 修正 |
| `86233e9e` | E10b-3 | 桌面 `triage-model.ts`（new）+ `TriagePage` 改真实 wire 字段；preload `permissions.list()` canonical 类型 |
| E10b-4（本记录） | E10b-4 | 架构现状 + 本记录 + 全量门禁 + ledger（docs-only） |

## 交付项

- **E10b-1 Goal / Pod Goal 读接口 8 ops**（只加 OpenAPI 元数据，handler 零改动）：
  `goals.list` / `goals.plan` / `goals.sessions` / `goals.timeline` / `goals.source` →
  `gateway/src/routes/schemas/goals.ts`（new）；`pods.goals.techLead` / `pods.goals.probes` /
  `pods.goals.revisions` → `gateway/src/routes/schemas/pods.ts`（扩展）。`GoalSourceRef` 去重后
  从 `goals.ts` 复用（wire 形状不变）。
- **E10b-2 Human-gate / 权限读接口 7 ops**：`approvals.list` / `questions.list` / `triage.list` /
  `permissions.list` / `permissions.getMode` / `permissions.listAllowlist` / `permissions.listRules` →
  `gateway/src/routes/schemas/human-gate.ts`（new）。三条既有 `AssertEq`（`Approval` /
  `QuestionRequest` / `TriageItem`）保持，新增 4 条 permissions 断言（共 7 条本批锚点）。
- **E10b-2 override 转 code-first**：删除 `goals.list` / `goals.sessions` / `approvals.list` /
  `questions.list` / `triage.list` 的 `responseSchema` 条目（`contract/overrides.json` **18 → 13**），
  `$comment` 记录迁移原因。`merge-contract.mjs` 语义是 **catalog `RouteDef.response` 优先**，
  overrides 只在 catalog 缺失时兜底；这些 override 的 responseSchema 与 handler 长期漂移，
  代码优先后 catalog 成为单一来源（`gen:api` 仍打印 `session.list: catalog response schema wins
  over overrides`，属历史遗留元数据，非本批范围）。
- **E10b-3 桌面 triage 收口**：`renderer/mafw/triage-model.ts#triageCardModel` 把 wire 记录映射成
  `{title, meta, badge}`（title 回退链 `proposedGoal.title → summary.title → skillDraft/axiomDraft.name → id`；
  meta = `source` + 本地化 `discoveredAt` + 合法 `deadline`；badge = state + 最高优先级 llm 建议后缀）；
  `TriagePage` 去 `as any[]` / 删内联 hex，badge 走既有 token 类 `.mafw-tool-badge[data-tone]`；
  卡片菜单 target 只留 `{ id }`；preload `permissions.list()` 声明 canonical `MafwPermissionRequest[]`。

## 覆盖率数学

| 口径 | operations | 说明 |
|---|---|---|
| 基线 `946937f1` | **29 / 316** | E10 收口值（`schema:coverage` 脚本实测） |
| E10b-1 后 | 37 / 316 | +8（goal / pod goal 读） |
| E10b-2 后 | 44 / 316 | +7（human-gate / 权限读） |
| **终值** | **44 / 316（13.9%）** | by-tag 分区和 = 44；未覆盖 272 |

- 本波新增 15 op 分组：**goal 8**（E10b-1）+ **human-gate + permissions 7**（E10b-2）。
- by-tag（节选，`npm run schema:coverage`）：`goals 6/15`、`approvals 1/2`、`permissions 4/10`、
  `questions 1/3`、`session 11/50`。
- 生成链不变：catalog `RouteDef.response` → `npm run emit:openapi`（gateway）→ SDK `npm run gen:api`
  （`merge-contract.mjs` + `openapi-typescript`）→ `contract/gateway-paths.json` /
  `contract/openapi.json` / `src/api-schema.gen.ts` 入库。

## DTO 修正（以 handler 为准）

1. **`Goal.currentWave` / `totalWaves`：required → optional**。`goals.list` 的 activeGoals 投影只发
   `goalId/phase/loop/nextAction/error/updatedAt`，从不发波次计数；同一个 `Goal` DTO 服务
   `goals.list` 与 `goals.get`，故按 handler 放宽（`goals.get` 的 `GoalViewSchema` 同步放宽，
   `CHECK_goals_get` 保持精确等价）。消费面：TUI `goals-tab` 只做模板字符串展示，desktop / mobile /
   `src/` 无字段读取 → **0 破坏**。
2. **`GoalPlanInfo` 扩展为 handler 实际 wire**：新增 `revision` / `wavesPath` / `goalEval` /
   `goalEvalPath` / `goalEvalError` / `planHash` / `evalHash` / `stale`；`waves` 改
   `GoalPlanWave[] | null`；新增 `GoalEval*` 家族与 `GoalPlanApproval`。desktop 只 re-export 类型。
3. **`GoalTimeline` 对齐 wire**：`planReview` / `planApproval` 改 required，`planApproval` 带
   `revision` / `planHash` / `evalHash`；`artifacts.receipts` 改 `(string | null)[]`。
4. **`Approval`**：`goalId` / `createdAt` required → optional（flat legacy `user-questions` 可缺）；
   `status` 只 `pending | answered`（`expired` 无 writer）。
5. **`QuestionRequest`**：新增可选 `time?: { created?: number }`（投影在源带 `createdAt` 时补齐）。
6. **`TriageItem` 重塑为磁盘 wire**（consumer-relevant）：旧
   `{goalId, reason, severity, createdAt, state?}` 是无人产出的 phantom override 形状；新形状 =
   `automation-engine.TriageItem`：`{ id, automationId, discoveredAt, source, summary, state,
   userAction, deadline, proposedGoal?, llmSuggestions?, updatedAt? }`（`summary` 是草稿袋，
   axiom-distill writer 不写 `proposedGoal` → optional）。
7. **`permissions.list()`**：`PermissionRequest[]` → `MafwPermissionRequest[]`（client +
   `PermissionsNamespace`）；旧 `PermissionRequest` 保留导出并标 `@deprecated`。
8. 未改任何 handler 输出 / 路由集合，`TOTAL_OPS` 仍 316；生成物 diff 逐 op 比对后只有本批 15 op
   （+ `goals.get` 的 shared-DTO 放宽）变化。

## 行为变化 / Breaking

- **wire 零变化**：本波只新增 OpenAPI 元数据；上述 DTO 修正是 SDK 类型追平 handler 实际输出
  （`TriageItem` / `Approval` / `QuestionRequest` / `permissions.list` 的运行时 payload 一直是新形状）。
- **桌面 triage 渲染修正**：旧 `TriagePage` 读 phantom 字段（恒 `undefined`），标题 / 元信息 / 严重度
  实际为空；现在按真实 wire 渲染。属于纯 UI 修正，无 API 变化。
- **TUI triage tab 仍未对齐**：`ui/triage-tab.ts` 仍读 `reason` / `goalId` / `severity`（真实 wire 无
  这些字段），且 TUI 测试因缺 `@earendil-works/pi-tui` 处于 env-red，类型漂移无法用门禁验证。
  SDK `TriageItem` 现在有 `id`，该项的「id 缺口」已消除；渲染字段对齐留待后续 TUI 批次
  （记录于 `tui.md`）。

## 验证（worktree @ E10b-4）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `npx tsc --noEmit -p tsconfig.json`（`gateway/`，gateway-local TS **5.9.3**） | **0 errors** |
| gateway 全量 | `npx jest --runInBand --forceExit --no-coverage`（`gateway/`） | **7171 tests：7160 passed / 9 failed / 2 skipped**；**suites：3 failed / 911 passed / 1 skipped（914 of 915）**。9 条失败**恰好**是 3 个已知 env-red suite（`plugin-package-e2e` 4、`claude-adapter-acceptance` 4、`claude-adapter-coverage` 1），**零 E10b 红**；419s |
| 覆盖率台账 | `npm run schema:coverage` | **44/316 operations（13.9%）**，by-tag 分区和 = 44，未覆盖 272 |
| 路由分析 | `node scripts/analyze-routes.cjs` | **`TOTAL 0 (match 0, equals 0)`** |
| 契约产物新鲜度 | `npm run emit:openapi`（gateway） | **316 routes → 282 paths / 316 operations，无 diff** |
| kernel-split 守卫 | jest `tests/unit/architecture/kernel-split-guards.test.ts` | **7 / 7 passed** |
| SDK 类型 | `npx tsc --noEmit -p tsconfig.json` | **0 errors** |
| SDK 全量 | `npm test`（`src/*.test.ts`） | **225 / 225 passed（0 fail）** |
| SDK contract | `node --import tsx --require ../test-shim/require-hook.cjs --test src/contract.test.ts` | **4 / 4 passed**（0 dead ops，0 exemptions） |
| SDK 生成物 | `npm run gen:api` + `git status` | **无 drift**；`merge-contract` 报告 `282 paths / 316 operations（overrides 命中 13）` |
| desktop 全量 | `npm run test:desktop`（worktree root） | **3806 tests / 728 suites：3805 passed / 1 failed**。唯一红 = `src/main/mafw-gateway-resolver.test.ts` dev-path（worktree 未构建 `gateway/dist`，E5b/E6/E7/E8/E9/E10 同红） |
| desktop 类型 | `npx tsgo --noEmit -p tsconfig.json`（`packages/desktop`） | 只剩已知 `node:tls` **2 条**（`getCACertificates` / `setDefaultCACertificates`），0 新增 |
| mobile 定向 | `flutter test test/direction_question_test.dart test/lead_entry_test.dart test/pairing_page_test.dart --concurrency=1` | **84 / 84 passed**（全量 flake 命中的 3 个文件单独重跑全绿） |
| mobile 全量 | `flutter test --concurrency=1` | **526 passed / 1 failed + 32 条 `did not complete`**（Windows widget worker flake：`direction_question` / `lead_entry` / `pairing_page`；见「已知红」第 5 条） |
| mobile analyzer | `dart analyze lib test` | **No issues found（0）** |
| TUI | `npm run test:tui` | **env-red**：`ERR_MODULE_NOT_FOUND` — `@earendil-works/pi-tui` 未安装（主 checkout 同）；本波零 TUI 改动 |

## 新增测试（对基线 `946937f1` 的增量）

| 面 | 新增 | 依据 |
|---|---|---|
| gateway | **+11** | `tests/unit/api-contract.test.ts`：E10b-1 describe 6 条 + E10b-2 describe 5 条（文件 23 → 34）；`tests/unit/architecture/schema-coverage.test.ts` 3 条**断言更新**（清单 29 → 44、阈值 44、`total === 316`），用例数不变 |
| SDK | 0 | 无新增运行时用例；`contract-compat.checks.ts` 本波新增 7 个 `AssertEq`（编译期，不计入运行时计数） |
| desktop | **+5** | `renderer/mafw/triage-model.test.ts`（title 回退 / meta 非法日期 / 三种 state / llm 优先级 / 页面不读 phantom 字段）；`card.test.ts` 同步 target 形状（改写，不新增） |
| mobile | 0 | 无代码变更 |
| **合计** | **+16** | 可执行 test case 数（非断言数） |

## 已知红（非本波代码问题）

1. **gateway env-red 9 条 / 3 suites**：`tests/integration/plugin-package-e2e`（4）、
   `tests/unit/runtime/claude-adapter-acceptance`（4）、`tests/unit/runtime/claude-adapter-coverage`（1）——
   esbuild 在未预构建的 worktree 里解析不到 `@anthropic-ai/claude-agent-sdk` /
   `@mafw/plugin-contract` staging；与基线同集合，E10b 未触碰适配器 / 插件打包路径。
2. **desktop 1 条环境红**：worktree 未构建 `gateway/dist` → `mafw-gateway-resolver` dev-path 拿到
   `null`；`gateway npm run build` 后即全绿。
3. **desktop 类型 `node:tls` 2 条**：`@types/node` 比运行时 `node:tls` 旧，既有噪声。
4. **TUI env-red**：`@earendil-works/pi-tui` 未安装（全仓同），本波零 TUI 改动。
5. **mobile 全量 flutter widget worker flake**：`flutter test --concurrency=1` 在 Windows 上偶发
   worker 卡住，runner 把剩余用例标 `did not complete`；本轮命中 `direction_question_test.dart` /
   `lead_entry_test.dart` / `pairing_page_test.dart`，三个文件单独跑 **84 / 84 passed**，与 E10b 零
   关联（mobile 零代码改动）。
6. **desktop tsgo 环境步骤**：worktree `node_modules` 的 `@mafw/*` workspace junction 指向主仓库，
   主仓库 `packages/gateway-sdk/dist` 是旧 `TriageItem` 形状。需先在 worktree `packages/gateway-sdk`
   跑 `npx tsc -p tsconfig.json` 生成本分支 `dist/`，并让 `packages/desktop/node_modules/@mafw/sdk`
   junction 指向 worktree SDK（均 gitignore，不进入 commit）；否则 tsgo 会对新 `TriageItem` 报假红。

## Deferred（E10b 后仍保留）

- 剩余 **272** 个 op 的 response schema 覆盖（44/316 已覆盖；继续按同族读接口 7–8 ops/批推进，
  台账 `npm run schema:coverage` 固定口径）。
- POST/PUT/PATCH/DELETE 的请求 / 响应 schema（E10 / E10b 只建模读接口的 200 成功体，错误体不建模）。
- OS keychain / 进程签名、MCP human 工具。
- 强制版本协商 / SDK 全量 schema 类型化。
- 插件 / manager 会话的配额副作用（内部会话失败只 log）。
- 调度 / Pod Goal 的准入复检（admission re-check，归 E11）。
- **mobile 工作 tab 的任务 / 消息增量 patch**（E9-1 后 flat 帧已能触发 `goalId` 局部 patch，其余仍是
  整页快照）。
- `session.list` override 的 responseSchema 元数据仍保留（catalog 已优先，留待后续清理）。
- TUI triage tab 的 phantom 字段渲染（`reason` / `goalId` / `severity`）对齐。
- `proposedGoal.boundaries` / `estimatedLoops` 的桌面展示（需要产品口径）。
- **won't do**：`pod.updated` 记录级实体 payload（E9-3）；`PodGoal` 可选性收紧（E8 先例）。
