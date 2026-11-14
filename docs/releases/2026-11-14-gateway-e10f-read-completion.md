# Gateway E10f 全量读表面收口交付记录（2026-11-14）

- 版本：gateway 4.16.1 / SDK 5.1.0 / desktop 5.1.0（**无版本号变更**；mobile 1.1.0+2 不变）
- 性质：**补齐剩余 56 个 JSON GET 的 OpenAPI 200 response schema + 4 个工程尾巴**；
  handler 输出零改动（唯二例外：`memory.listSticky` 的 503 / 降级体补发 `perNoteCap`——200 体早已有；
  mobile triage 改读真实 wire），路由集合零变化（**318 ops / 284 paths**），
  override **12 → 10**，SDK DTO 只在 E10f-C / E10f-E 两批改动

## 波次

- 分支：`feat/gateway-e10f-read-completion`（worktree `.superpowers/e10f-worktree`），
  基线 `44aceda4`（E10f spec + plan），五个实现 commit + 本记录
- 范围：**56 个 JSON GET**（A 16 / B 16 / C 16 / D 8）+ **4 个工程尾巴**（E），无新增 / 删除路由
- spec：`docs/superpowers/specs/2026-11-14-gateway-e10f-read-completion-design.md`
- plan：`docs/superpowers/plans/2026-11-14-gateway-e10f-read-completion.md`
- 架构现状：`docs/architecture/gateway.md` §「E10f 全量读表面收口（2026-11-14）」
  （mobile / desktop 侧同步写入 `mobile.md` §7.12、`desktop.md` §「note-board 预算 `perNoteCap`」）
- 台账：`gateway/tests/unit/architecture/schema-coverage.test.ts`（69 → **125**，`TOTAL_OPS = 318`）
- TDD：每批先写 api-contract 失败用例 + 覆盖率台账 → 红 → 最小 schema 实现 → 一个 commit；
  批证据见 `.superpowers/sdd/2026-11-14-gateway-e10f-coverage/{progress.md,batchC-report.md,batchD-report.md,batchE-report.md}`

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `4c4ec18e` | E10f-A | `feat(contract)`: 会话 / 任务 / 终端 / usage 16 op 的 200 schema（6 个新模块）+ 18 条 `AssertEq` + api-contract +13 + 覆盖率 69 → 85 |
| `03ddd225` | E10f-B | `feat(contract)`: 项目 / manager / runtime / 元数据 16 op（3 个新模块）+ 23 条 `AssertEq` + api-contract +8 + 覆盖率 85 → 101 |
| `05e03793` | E10f-C | `feat(contract)`: Goal / Lead / Events / Standing / Automations / Pods 16 op + `automations.list` override → code-first（12 → 11）+ **SDK DTO 修正**（`AutomationRule` 家族 / `LeadBoundaryView.text`）+ api-contract +11 + 覆盖率 101 → 117 |
| `99ff25ec` | E10f-D | `feat(contract)`: 观测 / 设备 / A2A 8 op（3 个新模块）+ 2 条 gateway 侧 `AssertEq` + api-contract +9 + 覆盖率 117 → **125** |
| `ecc94ea0` | E10f-E | `fix(contract)`: 4 个工程尾巴（`perNoteCap` / `memory.get` 编译期桥 / `session.list` override 删除 11 → 10 / mobile triage 真实 wire）+ api-contract +1 + note-board +1 + mobile +12 |
| 本记录 | E10f-close | `docs(gateway)`: 架构台账 + 本记录 + 全量门禁（docs-only，零产品代码） |

## 交付项（56 ops）

### E10f-A（16）— 会话 / 任务 / 终端 / usage

| 文件 | ops |
|---|---|
| `gateway/src/routes/schemas/session-runtime.ts`（new） | `session.structured` · `session.trajectory` · `session.run` · `session.discovery` · `session.discoverySkill` |
| `gateway/src/routes/schemas/experience.ts`（new） | `experience.actions` · `cognition.rules` |
| `gateway/src/routes/schemas/tasks.ts`（new） | `tasks.list` · `tasks.get` · `tasks.output` |
| `gateway/src/routes/schemas/background.ts`（new） | `background.jobs.list` · `background.jobs.output` |
| `gateway/src/routes/schemas/terminal.ts`（new） | `terminal.list` |
| `gateway/src/routes/schemas/usage.ts`（new） | `session.usage` · `session.usagePluginsList` · `session.usagePluginSourceGet` |

- `tasks.list` item ≡ `TaskEntity`：`publicTask()` 额外下发的旁路快照（`outputCursor` / `outputSize` /
  `outputTruncated`）不在 SDK DTO 面 → `Omit` 后等值，三个字段各自单独断言类型；`tasks.output` 是
  runtime shell 透传边界（四字段 optional + 开放索引），只锁 SDK 认的四个字段类型。
- `session.trajectory` 的 SDK `TrajectoryTurn` 是缺 `sessionID` / `provider` 的 legacy 子集 → schema 按
  handler 全量建模，DTO 不追平（`session.run` 则与 client 返回类型逐字段等价，run 可为 null）。
- `experience.actions`：响应键集 ≡ SDK `ExperienceActionsResponse`、`actions` 键集 ≡ `EXPERIENCE_ACTION_IDS`；
  描述符除 gateway 侧 E3-4 新增的 `operationId` 外与 DTO 等值（`minClientVersion` handler 恒发、DTO
  optional → 两侧分别锁）。
- 三个 usage op **schema-only**：SDK `usage()` 把 summary/memory/providers 声明成 `any`、
  `usagePlugins()` 仍是 `{plugins:[{overridden}]}` 旧形状、`usagePluginSource()` 把 200/403/404 混成一个类型
  → 无可信生成类型可对齐，属性 / 线样由 api-contract 钉住。

### E10f-B（16）— 项目 / manager / runtime / 元数据

| 文件 | ops |
|---|---|
| `gateway/src/routes/schemas/project-meta.ts`（new） | `mafwCommands.list` · `manager.session` · `project.current` · `fileHistory.list` |
| `gateway/src/routes/schemas/runtime-surface.ts`（new） | `runtime.get` · `runtime.contract` · `runtime.config.get` · `plugins.client` |
| `gateway/src/routes/schemas/media-voice.ts`（new） | `models.get` · `media.plugins` · `tts.voices` · `voice.status` · `python.status` · `agent.capabilities` · `media.resolveTask` · `embedding.get` |

- `manager.session` 是**双形态 200**（带 `?projectDir=` 单对象 / 无过滤数组）：只建模单对象分支，
  `ArrayBranch<T>` 从联合里取条目，键集 ≡ `ManagerSessionInfo` + `createdAt ≡ string | null`。
- `project.current` 比 SDK `Project` 多带注册根 `mafwDir` → `Omit` 后等值 + `mafwDir` 单独断言。
- `runtime.get` 的 `capabilities` / `unknownEvents` 是 runtime 拥有的开放键集（只锁 `Record<string, boolean>` /
  `Record<string, Record<string, number>>` 形状）；`plugins.client` 的描述符内部归 `@mafw/plugin-contract`
  → 边界对象，契约只承诺外层快照键集 + `revision`。
- `models.get` 五段分别锁（recall / media / available / `goal.nodeModel` / `goal.techLeadModel`——最后一段
  handler 发、SDK 只声明 nodeModel）；`tts.voices` 按 SDK 返回子集锁 voices / models / defaultVoice /
  defaultModel；`voice.status` / `embedding.get` 整响应等价。
- `fileHistory.list` / `runtime.config.get` / `python.status` / `agent.capabilities` / `media.resolveTask`
  schema-only（internal tag 或 handler 直接回 `any`）。

### E10f-C（16）— Goal / Lead / Events / Standing / Automations / Pods

| 文件 | ops |
|---|---|
| `gateway/src/routes/schemas/lead.ts`（扩展） | `lead.topics.list` · `lead.topics.get` · `lead.boundaries.list` |
| `gateway/src/routes/schemas/events.ts`（new） | `events.sources.list` · `events.threads.list` · `events.threads.triggers` · `events.threads.subscriptions.list` · `events.deliveries.list` |
| `gateway/src/routes/schemas/standing.ts`（new） | `standingGoals.list` · `standingGoals.runs` |
| `gateway/src/routes/schemas/automations.ts`（new） | `automations.list` · `automations.get` · `automations.history` |
| `gateway/src/routes/schemas/pods.ts`（扩展） | `pods.ensure` · `pods.memory.get` |
| `gateway/src/routes/schemas/read-models.ts`（扩展） | `orchestration.outcomes` |

- `automations.list` 的 override 手写 schema 长期漂移（`name` 无 writer、`trigger` 实为必填 cron/event 联合）
  → **转 code-first**：删 override 条目（12 → 11），schema 以 `automation-engine.ts` 为事实源。
- 事件四读面 **schema-only**：handler 原样下发存储列（`projectDir` / `createdAt` / `idempotencyKey` /
  `readAt`…），SDK `Event*View` 是手写收窄声明而非投影函数，等价断言会说谎。
- `pods.ensure` 与 `pods.get` 共用 `PodDetailResponse`（同一 `enrichPodDetail()` 出口，API contract 断言
  `schemaOf('pods.ensure') toEqual schemaOf('pods.get')`）。

### E10f-D（8）— 观测 / 设备 / A2A

| 文件 | ops |
|---|---|
| `gateway/src/routes/schemas/observability.ts`（new） | `dashboard.stats` · `health.root` · `session.subagents.result` |
| `gateway/src/routes/schemas/devices.ts`（new） | `mobile.devicesList` · `devices.list` · `mobile.pairingCode` |
| `gateway/src/routes/schemas/a2a.ts`（new） | `a2a.agentCard` · `pods.a2aCard` |

- 八 op 全是 `internal`（无 SDK client）→ 两条 **gateway 侧** `AssertEq`（tsc 即门禁）：
  `PublicDeviceEntrySchema` ↔ `PublicDeviceEntry`、`SubagentStatusSchema` ↔ `SubagentStatus`。
- **A2A card 是协议文档**（owner = A2A protocol，`@a2a-js/sdk` `AgentCard`）：顶层必填信封钉死，
  嵌套 skill / capability / interface 条目保留稳定键 + `additionalProperties: true`；v0.3 card 级
  `protocolVersion` 与 v1.0 `supportedInterfaces` optional（只有 Pod card 发）。
- `devices.list` == `mobile.devicesList`（同一 `listPublicDevices()`，同一 schema 对象）；
  `health.root` 只描述 transport arm（`http/transport.ts`）；`dashboard.stats` 的
  `eventAppendFailures` / `tokens` 在 fail-open 路径缺席 → optional（`tokens` 复用 `usage.summary` 的
  `TokenSummarySchema`，不复制投影）。

### E10f-E（4 个尾巴）

| # | 事项 | 落点 |
|---|---|---|
| 1 | note-board budget 补 required `perNoteCap` | `schemas/note-board` 侧 `memory.listSticky` 200 schema；`emptyNoteBoardBudget()` 同步（503 shell 同形）；SDK `StickyNoteBudget` + desktop preload 内联返回类型 |
| 2 | `memory.get` HarmonicUnit 编译期桥 | `schemas/memory.ts`：对称 `Omit<'created_at'>` 双向 `AssertEq` + `created_at?: string` 单独断言（`npx tsc` 即门禁） |
| 3 | `session.list` override 清理 | `contract/overrides.json` 删 inert 条目（11 → 10）+ `$comment` 更新 |
| 4 | mobile triage 真实 wire | `mobile/lib/src/models/triage_card_model.dart`（new）+ `pages/triage_page.dart` 改写 + `test/triage_card_model_test.dart`（12 例） |

**有意 deviation（spec 与实现的差异，已确认）**：spec 写「`recall.pinned` / `memory.listSticky` 的 budget 补
`perNoteCap`」，但两者不是同一个 budget——`recall.pinned` 渲染 `<user-profile>` 走
`PINNED_BUDGET = { max: 20, maxChars: 2000 }`，`formatPinnedProfile` **没有**按条截断（身份陈述必须完整）。
加 required 字段会让 `RecallPinnedResponse` 拒绝 handler 自己的体，所以 **`recall.pinned` 有意不加**，
理由写进 `schemas/recall.ts` 并用 api-contract 双断言钉住（note-board 有 / pinned 没有）。
若要「补全」需先改披露层行为（把身份文本截到 240 字符），不在契约层解决。同理，spec 的
「overrides 12 → 11」在 C 批已达成，E 批再删 `session.list` 后终值 **10**（ledger 已按实测记 10）。

## DTO 修正（只发生在 C / E）

| 批次 | 改动 | 消费面 |
|---|---|---|
| E10f-C | `AutomationRule` 重写为 wire 真形（`trigger` 必填 cron/event 判别联合、`name` 删除——无 writer）；新增 `AutomationTrigger` / `AutomationGoalDefaults` / `AutomationLedgerEntry` / `AutomationRuleListItem`；`AutomationsNamespace.list()` 返回 `AutomationRuleListItem[]` | desktop `Automations.tsx` 以 `any[]` 消费、标题 `rule.name \|\| rule.id` 本就在 `name === undefined` 时回退 `id` → **0 破坏**；SDK 内无其它 `AutomationRule` 消费者 |
| E10f-C | `LeadBoundaryView` 补 `text: string`（wire 恒发） | desktop / mobile 只读展示，**0 破坏** |
| E10f-E | `StickyNoteBudget` 补 required `perNoteCap: number`（200 体与 503 shell 都发） | desktop preload 内联返回类型同步；`NotesDock` 只用 `used/max`，**0 运行时变化** |

A / B / D 三批**零 DTO 改动**（生成物 + 编译期断言即可对齐）。

## 生成物 diff 审计

`emit:openapi` → `318 routes → 284 paths / 318 operations`；`gen:api` → `284 paths / 318 operations`。

| 产物 | ops | paths | added | removed | changed |
|---|---|---|---|---|---|
| `contract/gateway-paths.json` | 318 → 318 | 284 → 284 | **0** | **0** | 逐批恰好 A 16 / B 16 / C 16 / D 8 / E 1（`memory.listSticky`） |
| `contract/openapi.json` | 318 → 318 | 284 → 284 | **0** | **0** | 同上 |
| `src/api-schema.gen.ts` | — | — | — | — | 同上（每批 op 块重生成） |
| `contract/overrides.json` | — | — | — | — | C 删 `automations.list`（−59/+0 行级）、E 删 `session.list`（−133/+1 `$comment`） |

- 每批 `emit:openapi` + `gen:api` 二次运行幂等：C / D / E 用 blob hash 比对
  （C：`04b15ac6` / `e4baee64` / `853bea78`；D：`27e80df8` / `01f037c6` / `b1789b7e`；
  E：`648A014C…` / `39A64493…`），工作树零新增变化。
- 收口时 `emit:openapi` 重跑 → `git status` 无生成物改动（契约产物与 catalog 同步）。

## 覆盖率数学

| 口径 | operations | 说明 |
|---|---|---|
| 基线 `44aceda4`（E10e 终值） | **69 / 318（21.7%）** | 未覆盖 249 = 62 GET + 162 POST + 16 DELETE + 6 PATCH + 3 PUT |
| E10f-A | 85 / 318 | +16（session / task / terminal / usage） |
| E10f-B | 101 / 318 | +16（project / runtime / metadata） |
| E10f-C | 117 / 318 | +16（goal / lead / events / standing / automations / pods）；override 12 → 11 |
| E10f-D | **125 / 318（39.3%）** | +8（observability / device / A2A）；**未覆盖 193** |
| E10f-E | 125 / 318 | 4 个尾巴，0 新 op；override 11 → **10** |

- **未覆盖 193 = 187 个非 GET（162 POST + 16 DELETE + 6 PATCH + 3 PUT）+ 6 个非 JSON GET**。
  即 **56 个 JSON GET 全部覆盖 → JSON GET 125/131 = 100%**；分母不变（318 ops / 284 paths）。
- by-tag 终值（`npm run schema:coverage` 实测，分区和 = 125）：`internal 30/73`、`session 19/51`、
  `pods 15/39`、`goals 6/15`、`lead 5/11`、`events 5/10`、`standing 2/9`、`permissions 4/10`、
  `task 3/6`、`runtime 3/6`、`project 2/3`、`background 2/3`、`plugins 2/12`、`automations 1/4`、
  `terminal 1/4`、`tts 1/4`、`media 1/6`、`memory 5/7`、其余单 op tag 见脚本输出；
  仍为 0 的只有 `chat 0/2` 与 `event 0/2`（全是写面 / SSE）。
- **6 个非 JSON GET（明确排除，不建模）**：`media.artifact`（二进制）、`pods.a2aArtifact`（二进制）、
  `mobile.ttsArtifact`（音频）、`plugins.webAsset`（HTML / 静态）、`plugins.webEvents`（SSE）、
  `event.subscribe`（SSE）。**全部非 GET 的请求 / 响应也排除**（本波只做读表面）。

## 行为变化 / Breaking

- **wire 字节**：只有 `memory.listSticky` 的 **503 / 降级体**新增 `perNoteCap`（200 体早已是
  `{...NOTE_BOARD_BUDGET, used}`）→ additive，旧客户端忽略即可。
- **SDK 类型面**：`AutomationRule` 家族以 handler 为准重写（`name` 删除、`trigger` 收紧）、
  `LeadBoundaryView.text` 必填、`StickyNoteBudget.perNoteCap` 必填 → 编译期可见；仓库内 0 破坏性消费者
  （desktop automations 页用 `any[]`，标题已在 `name` 缺失时回退 `id`）。
- **用户可见**：mobile triage 卡片从占位文本变成真实标题 / `source · 时间 · 截止` / 状态 badge
  （含最高优先级 `llmSuggestions`），不再显示空白的 phantom `type` chip。
- handler 逻辑、路由集合、SSE / 二进制读面、错误体：**零变化**。

## 验证（worktree @ E10f-close）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `npx tsc --noEmit -p tsconfig.json`（`gateway/`） | **0 errors**（`memory.get` 桥激活） |
| gateway 全量 | `npx jest --runInBand --forceExit --no-coverage`（`gateway/`） | **7311 tests：7299 passed / 9 failed / 3 skipped**；suites **3 failed / 1 skipped / 919 passed（922 of 923）**；**9 条失败恰好是 3 个已知 env-red suite，零 E10f 红**；657.3s（明细见下） |
| 覆盖率台账 | `npm run schema:coverage` | **125/318 operations（39.3%）**，未覆盖 193，by-tag 分区和 = 125 |
| 路由分析 | `node scripts/analyze-routes.cjs` | **`TOTAL 0 (match 0, equals 0)`** |
| 契约产物新鲜度 | `npm run emit:openapi`（gateway） | **318 routes → 284 paths / 318 operations，无 diff**（`git status` 无生成物改动） |
| 定向契约测试 | jest `api-contract` + `note-board` + `architecture/schema-coverage` | **112 passed**（96 + 13 + 3） |
| kernel-split 守卫 | jest `tests/unit/architecture/kernel-split-guards.test.ts` | **7 / 7 passed** |
| SDK 类型 | `npx tsc --noEmit -p tsconfig.json` | **0 errors** |
| SDK 全量 | `npm test`（`src/*.test.ts`） | **226 / 226 passed（0 fail）**（基线 226，本波 0 运行时新增） |
| SDK contract | `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test src/contract.test.ts` | **4 / 4 passed** |
| SDK 生成幂等 | `npm run gen:api`（二次） | **幂等**（工作树无生成物 diff） |
| desktop 全量 | `npm run test:desktop`（worktree root） | **3862 tests / 735 suites：3861 passed / 1 failed**。唯一红 = `src/main/mafw-gateway-resolver.test.ts` dev-path（worktree 未构建 `gateway/dist`） |
| desktop 类型 | `npx tsgo --noEmit -p tsconfig.json`（`packages/desktop`） | 只剩已知 `node:tls` **2 条**（`getCACertificates` / `setDefaultCACertificates`），0 新增 |
| mobile 定向 | `flutter test test/triage_card_model_test.dart` | **12 / 12 passed** |
| mobile triage 相关 | `flutter test test/triage_card_model_test.dart test/sessions_page_test.dart test/widget_test.dart test/tab_shell_test.dart --concurrency=1` | **32 / 32 passed** |
| mobile analyzer | `dart analyze lib test` | **No issues found（0）** |
| TUI | `npm run test:tui` | **env-red**：`ERR_MODULE_NOT_FOUND` — `@earendil-works/pi-tui` 未安装（全仓同；本波零 TUI 代码改动） |

### gateway 全量明细

```
Test Suites: 3 failed, 1 skipped, 919 passed, 922 of 923 total
Tests:       9 failed, 3 skipped, 7299 passed, 7311 total
Snapshots:   0 total
Time:        657.3 s
```

失败 suite 恰好三个已知 env-red：`tests/integration/plugin-package-e2e.test.ts`、
`tests/unit/runtime/claude-adapter-acceptance.test.ts`、`tests/unit/runtime/claude-adapter-coverage.test.ts`
（同一根因：esbuild 解析不到 `@anthropic-ai/claude-agent-sdk`），零 E10f 红。
总数 `7311` 相对基线 `44aceda4` 的增量 = 本波 **+43**（api-contract 54 → 96、note-board 12 → 13）+
基线分支 merge（`7eb3a191` 带入 `memory/route-write` / `routes/dashboard-wiring` 的新用例）。

## 新增测试（对基线 `44aceda4` 的增量）

| 面 | 新增 | 依据 |
|---|---|---|
| gateway | **+43** | `api-contract.test.ts` 54 → **96**（A +13 / B +8 / C +11 / D +9 / E +1）；`note-board.test.ts` 12 → **13**（E：新增 non-empty board 的 budget 精确形状用例 `{...NOTE_BOARD_BUDGET, used: 1}`；`emptyNoteBoardBudget()` 的 503 / 降级体在既有用例里随 `perNoteCap` 一并断言） |
| SDK | **0 运行时 / +52 编译期** | `contract-compat.checks.ts` 新增 52 个 `CHECK_*`（A 18 / B 23 / C 11）；另 4 条 gateway 侧 `AssertEq`（D 2 / E 3，tsc 门禁）——`npm test` 仍 226 |
| desktop | 0 | 无代码变更（preload 仅类型） |
| mobile | **+12** | `test/triage_card_model_test.dart`（12 例） |
| **合计** | **+55** | 可执行 test case 数（非断言数） |

## 已知红（非本波代码问题）

1. **gateway env-red**：`tests/integration/plugin-package-e2e.test.ts`、
   `tests/unit/runtime/claude-adapter-acceptance.test.ts`、`tests/unit/runtime/claude-adapter-coverage.test.ts`
   ——esbuild 在未预构建的 worktree 里解析不到 `@anthropic-ai/claude-agent-sdk`（9 条 / 3 suites，与 E10e 同集合）。
2. **desktop 1 条环境红**：worktree 未构建 `gateway/dist` → `src/main/mafw-gateway-resolver.test.ts` 的 dev-path 拿到 `null`。
3. **desktop 类型 `node:tls` 2 条**：hoisted `@types/node` 比运行时旧，缺 `getCACertificates` /
   `setDefaultCACertificates`（既有噪声）。
4. **TUI env-red**：`@earendil-works/pi-tui` 未安装。

## Deferred（E10f 后仍保留）

- **187 个写面 op**（POST / PUT / PATCH / DELETE）的请求 / 响应 schema。
- **6 个非 JSON GET** 的 transport 级契约（content-type / SSE 帧）——不进 JSON schema。
- 错误体不建模（`memory.get` 404 / `scheduler.status` 404 / `usagePluginSource` 403/404 只在测试里反向断言）。
- 强制版本协商 / SDK 全量 schema 类型化。
- **TUI triage phantom**（`reason` / `goalId` / `severity`）：`pi-tui` 缺失，改不了门禁验证；
  mobile 已在 E10f-E 收口，desktop 是 E10b-3。
- **note-board 与 pinned 预算的差异是有意保留的**（`perNoteCap` 只在 note-board；pinned 不按条截断）。
- mobile 工作 tab 的其余增量 patch（任务 / 消息仍是整页快照）。

## 与历史记录的差异（订正）

- E10e release / §E10e 台账的「`recall.pinned` / `memory.listSticky` 是同一 budget 选择」是**错误前提**：
  两者是不同的 budget（见上 deviation）。`gateway.md` 已在 E10f 节 + E10c/E10d/E10e 的 deferred 列表
  就地订正；本文是这四条 residual 的最终关闭记录。
- spec / plan 的「overrides 12 → 11」在 E10f-C 达成，E10f-E 再删 inert 的 `session.list` → 终值 **10**。
