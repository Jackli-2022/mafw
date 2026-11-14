# Gateway E10h 写响应契约收口交付记录（2026-11-15）

- 版本：gateway 4.16.1 / SDK 5.1.0 / desktop 5.1.0（**无版本号变更**；mobile 1.1.0+2 不变）
- 性质：给 catalog 的**写 op（非 GET，195 个）补 200 响应契约**：**194 声明 `response` + 1 显式排除**
  （`tts.speakStream`，PCM16 分块流）。total response 台账 **127/327 → 320/327（97.9%）**。
  **请求契约（E10g，189/195）与路由集合（327 ops / 293 paths）零变化，handler 零改动，
  无运行时响应校验**（声明式契约，handler 仍是事实源）。新增响应 schema **193 个**（320 − 127）。
- spec：`docs/superpowers/specs/2026-11-15-gateway-e10h-write-responses-design.md`
- plan：`docs/superpowers/plans/2026-11-15-gateway-e10h-write-responses.md`
- 架构现状：`docs/architecture/gateway.md` §「E10h 写响应契约」+ §「E10h-P0 … R6」+ §「残余」
- 证据：`.superpowers/sdd/2026-11-15-gateway-e10h-responses/{progress.md,P0-report.md,R1-report.md,
  R2-report.md,R3-report.md,R4-report.md,R5-report.md,R6-report.md}`
- TDD：每批先写 api-contract 失败用例 + 覆盖率台账下界 → 红 → 最小 schema 实现 → 一个 commit

## 波次与提交

- 分支：`feat/gateway-e10h-write-responses`（worktree `.superpowers/e10h-worktree`）
- 基线：`b68478af`（E10h spec + plan）

| commit | 任务 | 一句话 |
|---|---|---|
| `44b9a33b` | E10h-P0 | `feat(contract)`: `schema-coverage.cjs` 切 `writeResponses` 台账 + pilot `session.create` / `tasks.submit`；写响应 3/195、total 129/327 |
| `65cc8066` | E10h-R1 | `feat(contract)`: session 写响应 35 个（含 `promptAsync` 三态、4 个空体、`session.command` 协议边界）；38/195、164/327 |
| `f4c75318` | E10h-R2 | `feat(contract)`: pod / task / terminal / background / fileHistory 35 个（`pods.a2a` 按协议边界开放）；73/195、199/327 |
| `7d6e2500` | E10h-R3 | `feat(contract)`: goal / decision / lead / standing / cognition 31 个（常量回执 + `cognition.gate` 联合）；104/195、230/327 |
| `dfc4b769` | E10h-R4 | `feat(contract)`: event / automation / approvals / questions / triage / permissions 24 个（`not_found` 也是 200）；128/195、254/327 |
| `05db48cb` | E10h-R5 | `feat(contract)`: mcp / plugins（Phase 6 自愈面）/ runtime / config / project / manager / commands / models 35 个（plugin 双分支、`plugins.invoke.output`、`dryEvent` 三分支）；163/195、289/327 |
| `86a4ba5a` | E10h-R6 | `feat(contract)`: memory / media / tts / chat / python / obs / tools / eval / llm / mobile / devices / skills 31 个 + `tts.speakStream` 排除；**194/195、320/327** |
| 本记录 | E10h-close | `docs(gateway)`: `write-response-coverage.test.ts` 收口守卫 + 架构现状 + 本记录 + 全量门禁 |

## 响应建模规则（三选一，handler 是事实源）

1. **复用读侧 DTO**：写后读回或本就是同一投影时，直接指向既有 schema 对象，不写第二份转写。
   为此只给内部 schema 加 `export`（**无 wire 变化**），例如 `tasks.submit` ≡ `tasks.get`、
   `session.config.set` ≡ `SessionConfigResponse`、`pods.create|update|wake|sleep` ≡ `PodDetailResponse`、
   `permissions.setMode` ≡ `permissions.getMode`、`models.update` 的 `recall|media|goal` ≡ `models.get`、
   `embedding.update` 的 `current|runtime` ≡ `embedding.get`、`devices.register` 的 `device` ≡
   `devices.list` item、`decisions.*` ≡ 列表 item（`DecisionRecordSchema`）、
   `plugins.install` ≡ `plugins.list` item（同一个 `statEntry()`）。
2. **按 handler wire 新写**：`routes/schemas/*-write-responses.ts` 按域拆（session / pod / goal /
   decision / lead / standing / cognition / event / automation / approval / triage / permission /
   mcp / plugin / runtime / platform / memory / media / tts / internal / devices / skills）。
   **常量回执用 `Type.Literal` 声明 handler 的唯一写出值**，不放宽到 SDK 的宽类型。
3. **排除**：200 不是单个 JSON 文档 → `WRITE_RESPONSE_EXCLUDED`（唯一项 `tts.speakStream`）。

## 逐批落点

### P0（台账 + 2 pilot）

- `schema-coverage.cjs` 增 `writeResponses` / `writeResponseCovered` / `writeResponseTotal` /
  `writeResponseUncovered`（human 行 `write responses: X/195`），分母 = 非 GET op，与 E10g 请求台账同一集合。
- `session.create` → `SessionCreateResponse` = `SessionSchema` + 可选 `worktree{dir,branch}`
  （普通创建没有该键，`JSON.stringify` 丢 `undefined`）；`tasks.submit` → `TaskEntitySchema`
  （`TaskService.submit` 返回 `publicTask(task)`，与 `tasks.get` 同形无信封）。

### R1（session 写接口 35）

- 新文件 `session-write-responses.ts`；35 个 catalog entry 只加 `response:`。
- 空体 4：`session.revert` / `unrevert` / `summarize` / `background`（handler 逐字 `json(200, {})`）。
- 开放 1：`session.command` 无 gateway handler（尾部反代 runtime serve）→ `additionalProperties:true`。
- `session.promptAsync` 三态联合（直发 / 队列短路 / 幂等 duplicate）；`session.checkpoint` 回实体本体
  （`Type.Omit` 去掉列表专属 `actions`）；`session.fork` 只承诺 `id`。

### R2（pod / task / terminal / background / fileHistory 35）

- 新文件 `pod-write-responses.ts`（25 个 pod op）；其余 10 个就落在各读侧 schema 文件。
- 开放 1：`pods.a2a` 是 A2A JSON-RPC 信封——**不排除**，`additionalProperties:true` + owner 注释。
- 三处「schema 比 SDK 类型更贴 handler」（故意）：`pods.goals.cancel` 的 `goal` 是 `PodGoalRow` 行、
  `pods.messages.delivery.retry` 透传 `skipped`、`terminal.remove` 的 `ok` 是字面量 `true`。
- `PodLeadEnsureResponse` 用小写 `sessionId`（与 goals 面的 `sessionID` 不同）。

### R3（goal / decision / lead / standing / cognition 31）

- 五个按域拆的文件；`DecisionRecordSchema` 加 `export` 供四个 decision 写响应复用。
- 常量回执：`{status:'paused'|'resumed'|'stopped'|'retried'}`、`{success:true,nextAction:'SCHEDULED'}`、
  `{success:true,goalId,nextAction:'GRAPH_INVOKED'}`、`lead.boundaries.accept` 的
  `{status:'accepted',toTopicId}`、`merge` / `undo` 只回 status。
- `cognition.gate` 判别联合（allow / deny / ask / rewrite / transform）；`cognition.rewrite`
  `{content: Part[]}`，部件只承诺 `type` + runtime 其余字段（字段级开放）。
- 本批无排除、无空体、无顶层开放对象。

### R4（event / automation / approvals / questions / triage / permissions 24）

- 五个按域拆的文件；`EventSourceViewSchema` / `EventSubscriptionRowSchema` / `AllowlistEntrySchema` /
  `PermissionRuleSchema` 加 `export`（无 wire 变化）。
- 「未命中也是 200」→ status 联合：`automations.toggle` `{status:'toggled'|'not_found'}`、
  `automations.remove` `{status:'deleted'|'not_found'}`、`triage.dismiss|reject` 含 `not_found`。
- `triage.confirm` 三条成功分支判别联合（`installed` / `axioms` / `goalId`）。
- `permissions.reply` `{status:'ok'}` 与 `permissions.replyRuntime` `{success:true}` **刻意不同形**。
- `events.webhook.receive` 的开放边界在**请求**侧（E10g）；200 是网关回执 `{accepted:true,duplicate}`，闭合。

### R5（mcp / plugins / runtime / config / project / manager / commands / models 35）

- 四个按域拆的文件（plugin 17 个含 Phase 6 自愈面 8 个）。
- mcp 面全部是 runtime 适配器已类型化 DTO（`RuntimeMcpConfigPreview` / `RuntimeMcpConfigResult`）；
  `applied` 与 `runtimeApplied` 是两个独立布尔（写盘成功但热载失败是合法组合）。
- plugin 双分支联合：`enable|disable` → `UpdateResult`｜`PluginEntry`，`delete` → `UpdateResult`｜`{ok:true}`；
  `plugins.apply` 在 `UpdateResult` 上补 `runtimeSwitch:'required'|'applied'|'failed'`。
- `plugins.invoke.output` 是**字段级**开放边界（owner = 包的 `outputSchema`），不枚举业务字段；
  `plugins.doctor` / `check` 的 `{ok:false}` 仍是 200 诊断结果。
- `runtime.dryEvent` 一个 schema 覆盖三条成功分支；`runtime.config.update` 的 `config` owner = runtime（可 `null`）。
- `mafwCommands.run` 是**本批唯一开放顶层对象**（命令注册表可追加任意键）。
- 与 E10g 请求台账的两处具名例外：`plugins.install`（请求是原始 `.js` 字节流，响应仍是 JSON）、`pods.a2a`。

### R6（memory / media / tts / chat / python / obs / tools / eval / llm / mobile / devices / skills 31 + 1 排除）

- 六个按域拆的文件；`EmbeddingConfigStateSchema` / `EmbeddingRuntimeStateSchema` 加 `export`。
- **排除 1**：`tts.speakStream` —— 200 是 `text/event-stream` 的 PCM16 分块流
  （`data: {data,voice}` … `{"done":true}`），不是单个 JSON 文档；请求体已由 E10g 覆盖。
- 「失败也是 200」→ 多支联合：`memory.add`（dedup 回执 / `code:'disk_low'`）、
  `memory.setSticky`（便签 / pin / 失败）、`memory.merge`（MCP handler `{success:false}`）、
  `obs.capture`（fail-open `{ok:false}`）。
- 顶层开放 1：`media.createTask`（`POST /a2a`，与 `pods.a2a` 同形）。
- 三个请求是原始字节 / multipart 的 op（`media.upload` / `uploadAndCreate` / `mobile.mediaTaskUpload`）
  仍补了闭合 JSON 200。

## 关键边界与联合（收口守卫钉住的形状）

- **空体 200（`Type.Object({})`）恰好 4 个**：`session.revert` / `unrevert` / `summarize` / `background`。
- **顶层开放对象恰好 4 个**：`pods.a2a` / `media.createTask`（A2A 协议信封）、`session.command`
  （runtime serve 反代）、`mafwCommands.run`（用户命令注册表）。
- **联合体恰好 10 个**：`cognition.gate`、`session.promptAsync`、`plugins.enable|disable|delete`、
  `memory.setSticky|add|merge`、`triage.confirm`、`obs.capture`。
- **A2A 不排除**：`pods.a2a` / `media.createTask` 仍是 JSON 200（`additionalProperties:true`），
  与 E10g 请求侧把 `/a2a` 排除的口径**不对称是刻意的**——请求信封由协议拥有、响应也是，但响应确实是 JSON 文档。
- 非 JSON GET（6 个）与 `tts.speakStream`（1 个）合计 7 个缺口，其余按 tag 全部 100%
  （`internal` 69/73、`media` 5/6、`tts` 3/4、`event` 1/2 即这 7 个）。

## 生成物 diff 审计

- 每批 `npm run emit:openapi` + SDK `npm run gen:api` 后逐 op 比对：**worker 端恰好该批的 operationId
  从 `content?: never` 变为 200 JSON schema，其余 327 - N 个 op 不变**；重跑幂等。
- 收口时 `emit:openapi` = **327 routes → 293 paths / 327 operations**，`merge-contract` overrides 命中 **10**，
  工作树无生成物 diff。
- SDK `contract-compat.checks.ts` 累计 **+95 条编译期等价**（`const CHECK_*` 110 → 205），
  对「契约比 SDK 更精确」的 op 不做整对象 `AssertEq`，只锁字段级（见各批 concerns）。

## 收口守卫（本波唯一新增代码）

`gateway/tests/unit/architecture/write-response-coverage.test.ts`（**7 tests / 1 suite**）：

1. 每个非 GET op **恰好**「声明 `response`」或「在 `WRITE_RESPONSE_EXCLUDED`」其一（按 operationId 点名）；
2. 排除项是 catalog 写 op、带原因、且不声明 `response`；键集恰为 `['tts.speakStream']`；
3. **195 = 194 covered + 1 excluded**（含去重与「无未记账 op」）；
4. 全量算术 **327 = 320 + 7**，7 个缺口逐个对账（6 个具名非 JSON GET + 1 个写排除）；
5. **不重复断言 GET**：写分母里不得混入任何 GET，GET 也不得出现在排除表（GET 读表面由
   `schema-coverage.test.ts#E10_COVERED_OPS` 独立锁定）；
6. 200 形状清单钉死：空体 4 / 顶层开放 4 / 联合 10（其余闭合，`Type.Object({})` 不得被新 op 滥用）；
7. **mutation test**：抽掉一个 `response` → 按 operationId 报错；临时删掉唯一排除项 → 同样报错；
   恢复后审计归零（审计函数是纯函数，源文件未被修改）。

## 行为变化 / Breaking

- **wire 字节：零变化**（无 handler / 路由 / 响应体改动）。
- **SDK 类型面：零变化**（无 DTO 改动，SDK `npm test` 仍 226）。
- **客户端可见**：`openapi.json` / `api-schema.gen.ts` 多了 **193 个 200 JSON schema**
  （此前写 op 的 200 是 `never`）——对代码生成消费者是 additive。
- **未改变**：运行时响应校验、错误体（4xx/5xx）、SSE / 二进制面、override 表、请求契约口径。

## 验证（worktree @ `86a4ba5a` + E10h-close）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `npx tsc --noEmit -p tsconfig.json`（`gateway/`） | **0 errors** |
| gateway 全量 | `npx jest --runInBand --forceExit --no-coverage`（`gateway/`） | **7624 tests（7612 passed / 9 failed / 3 skipped）**；suites **3 failed / 1 skipped / 944 passed（947 of 948）**；9 条红全部落在 3 个已知 env-red suite，零契约红；357.3s |
| 覆盖率台账 | `npm run schema:coverage` | **responses 320/327（97.9%）**；**write responses 194/195（99.5%）**；**requests 189/195（96.9%）** |
| 路由分析 | `node scripts/analyze-routes.cjs` | **`TOTAL 0 (match 0, equals 0)`** |
| 契约产物新鲜度 | `npm run emit:openapi`（gateway）→ `npm run gen:api`（SDK） | **327 routes → 293 paths / 327 operations**，overrides 命中 **10**；二次运行 `git status` 无生成物 diff |
| 定向契约 + 守卫 | jest `api-contract` + `architecture/{schema-coverage,write-response-coverage,kernel-split-guards}` | **297 passed / 4 suites**（231 + 52 + 7 + 7） |
| kernel-split 守卫 | 同上（单独含在定向里） | **7 / 7 passed** |
| SDK 类型 | `npx tsc --noEmit -p tsconfig.json`（`packages/gateway-sdk`） | **0 errors** |
| SDK 全量 | `npm test`（`src/*.test.ts`） | **226 / 226 passed（0 fail）**（本波 0 运行时新增） |
| SDK contract | `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test src/contract.test.ts` | **4 / 4 passed** |
| desktop 全量 | `npm run test:desktop`（worktree root） | **3868 tests / 736 suites（3867 passed / 1 failed）**。唯一红 = `src/main/mafw-gateway-resolver.test.ts` dev-path（worktree 未构建 `gateway/dist`） |
| desktop 类型 | `npx tsgo --noEmit -p tsconfig.json`（`packages/desktop`） | 只剩已知 `node:tls` **2 条**（`getCACertificates` / `setDefaultCACertificates`） |
| mobile 定向 | `flutter test test/pod_models_test.dart test/triage_card_model_test.dart` | **31 / 31 passed** |
| mobile analyzer | `flutter analyze`（`mobile/`） | **No issues found（0）** |
| TUI | `npm run test:tui` | **env-red**：`ERR_MODULE_NOT_FOUND` — `@earendil-works/pi-tui` 未安装（本波零 TUI 代码改动） |

### gateway 全量明细

```
Test Suites: 3 failed, 1 skipped, 944 passed, 947 of 948 total
Tests:       9 failed, 3 skipped, 7612 passed, 7624 total
Snapshots:   0 total
Time:        357.294 s
```

失败 suite 与 E10e / E10f / E10g 同一集合：`tests/integration/plugin-package-e2e.test.ts`（npm staging /
`@mafw/plugin-contract` 解析）、`tests/unit/runtime/claude-adapter-acceptance.test.ts`、
`tests/unit/runtime/claude-adapter-coverage.test.ts`（esbuild 解析不到
`@anthropic-ai/claude-agent-sdk`），共 9 条；**零契约红**（api-contract / coverage / write-response / registry
全绿）。


## 新增测试（对基线 `b68478af` 的增量）

| 文件 | 基线 → 终值 | 增量 | 依据 |
|---|---|---|---|
| `gateway/tests/unit/api-contract.test.ts` | 159 → **231** | **+72** | P0 +4 / R1 +9 / R2 +13 / R3 +11 / R4 +8 / R5 +16 / R6 +11（逐批 200 形状 + 复用等价 + 常量回执 + 台账锚） |
| `gateway/tests/unit/architecture/schema-coverage.test.ts` | 31 → **52** | **+21** | P0 +2 / R1 +2 / R2 +2 / R3 +3 / R4 +3 / R5 +5 / R6 +4（逐批更新下界与逐 op 清单；无 `test.each`） |
| `gateway/tests/unit/architecture/write-response-coverage.test.ts` | 0 → **7**（**new suite**） | **+7** | E10h-close 收口守卫（恰好其一 / 排除台账 / 195 算术 / 320-327 对账 / 无 GET / 形状清单 / mutation） |
| **gateway 合计** | — | **+100** | 可执行 test case：93（P0–R6）+ 7（closeout） |
| SDK / desktop / mobile | — | **0** | 本波无 SDK 手写类型、无 desktop、无 mobile 代码改动（SDK 226、mobile 定向测试不变） |

## 已知红（非本波代码问题）

1. **gateway env-red 9 条 / 3 suites**：`tests/integration/plugin-package-e2e.test.ts`（npm staging 解析
   `@mafw/plugin-contract`）、`tests/unit/runtime/claude-adapter-acceptance.test.ts` /
   `claude-adapter-coverage.test.ts`（esbuild 在未预构建 worktree 解析不到
   `@anthropic-ai/claude-agent-sdk`）——与 E10e / E10f / E10g 同一集合。
2. **desktop 1 条环境红**：worktree 未构建 `gateway/dist` → `src/main/mafw-gateway-resolver.test.ts` dev-path。
3. **desktop 类型 `node:tls` 2 条**：hoisted `@types/node` 缺 `getCACertificates` /
   `setDefaultCACertificates`（既有噪声）。
4. **TUI env-red**：`@earendil-works/pi-tui` 未安装（`ERR_MODULE_NOT_FOUND`，本波零 TUI 代码改动）。
5. **`npm run test:contract`（`packages/runtime-contract`）** 本机红于 `TS5023
   rewriteRelativeImportExtensions`（根 `typescript` 5.6.3 vs 5.7+ 选项），该包零改动。

## Deferred（E10h 后仍保留）

- **`tts.speakStream` 的流式响应契约**：要建模只能换 `text/event-stream` 帧 schema；当前 OpenAPI 3.1
  投影只描述 JSON content，硬塞会产出错误的 `application/json` 声明。
- **6 个非 JSON GET 的 transport 级契约**（content-type / SSE 帧格式）：只记录，不建 JSON schema。
- **错误体（4xx/5xx）不建模**（读写两面同口径：只声明 200 成功体，无运行时校验）。
- **强制版本协商 / SDK 全量 schema 类型化**。
- **TUI triage phantom**（`reason` / `goalId` / `severity`）：`@earendil-works/pi-tui` 未安装，
  门禁无法验证（mobile 已在 E10f-E 收口，desktop 是 E10b-3）。
- **mobile 工作 tab 的其余增量 patch**（任务 / 消息仍是整页快照）。

## 与 spec / plan 的差异（有意 deviation）

1. spec §2 的批次是「约数」：实际落点 P0 2 / R1 35 / R2 35 / R3 31 / R4 24 / R5 35 / R6 31 = **193**
   （+ 存量 `humanToken.rotate` = 194）。R2 把 task / terminal / background / fileHistory 与 pod 合并为一批
   （spec 列在 R1/R2 混排），R5 含 Phase 6 自愈面 8 个（spec 未单列）。
2. spec §1 提到「若 chat/command 实际是 SSE 也加入排除」：实测 `session.command` 是 runtime 反代
   的 JSON 200（按协议边界开放，不排除）；唯一流式排除仍是 `tts.speakStream`。
3. spec §3 的「历史/共享 schema 不得空壳」：收口按「空体 200 恰好 4 个 + 其余全部闭合」实现并钉住，
   未额外引入 `OkResponse` 重命名（`{ok:true}` 复用 R1 引入的共享信封，`{status:'ok'}` 复用
   `StatusOkResponse`）。
4. spec §5 的收口门禁含「全量 gateway / SDK / desktop / mobile / kernel-split」：全部执行，
   结果见上表与「已知红」，无契约红。
