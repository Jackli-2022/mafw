# Gateway E10i 错误响应契约收口交付记录（2026-11-15）

- 版本：gateway 4.16.1 / SDK 5.1.0 / desktop 5.1.0（**无版本号变更**；mobile 1.1.0+2 不变）
- 性质：给全部 **327 op** 建立**非 2xx 错误体契约**。此前 catalog 只建模 200，客户端无法从 OpenAPI
  得知错误形状。采用「统一默认错误包 + 高价值路由显式状态码」：
  **`default` 327/327**（`ErrorEnvelope`）、**`/api/*` 的 401/403 各 318 个 op**、
  **显式状态码 157 op / 356 条状态条目**（400×124 / 404×78 / 409×54 / 413×6 / 429×3 / 503×91）。
  **handler 零改动、路由集合（327 ops / 293 paths）零变化、wire 字节零变化、无运行时响应校验**
  （声明式契约，handler 仍是错误形状的事实源）。
- spec：`docs/superpowers/specs/2026-11-15-gateway-e10i-error-contracts-design.md`
- plan：`docs/superpowers/plans/2026-11-15-gateway-e10i-error-contracts.md`
- 架构现状：`docs/architecture/gateway.md` §「E10i 错误响应契约（P0 + E1 + E2 + E3，2026-11-15）」；
  台账口径同节 + 「残余（E11 后仍 deferred）」的错误体条目
- 证据：`.superpowers/sdd/2026-11-15-gateway-e10i-errors/{progress.md,E2-report.md,E3-report.md}`
- TDD：每批先写 api-contract 失败断言 → 红 → 最小 catalog `errors:` 声明 → 一个 commit；
  收口先写覆盖守卫并确认 mutation 会红

## 波次与提交

- 分支：`feat/gateway-e10i-error-contracts`（worktree `.superpowers/e10i-worktree`）
- 基线：`85f5190b`（E10i spec + plan）

| commit | 任务 | 一句话 |
|---|---|---|
| `2ec84a29` | E10i-P0 | `feat(contract)`: `ErrorEnvelope` + `RouteDef.errors/errorSchemas/errorDescription` + `errorResponsesFor()` 投影（全局 `default`、`/api/*` 401+403）+ registry 单测 |
| `4f590698` | E10i-E1 | `feat(contract)`: session + pods **43 op / 98 条**（400×24 / 404×27 / 409×16 / 429×1 / 503×30） |
| `2231c836` | E10i-E2 | `feat(contract)`: goals/decisions/lead/standing + events/automations/approvals/questions/triage/permissions **51 op / 127 条**（400×50 / 404×32 / 409×20 / 503×25） |
| `6aa2fad6` | E10i-E3 | `feat(contract)`: plugins/runtime/config/mcp + memory/media/tts/mobile/devices/skills + chat/python/obs/tools/eval/llm **63 op / 131 条**（400×50 / 404×19 / 409×18 / 413×6 / 429×2 / 503×36） |
| 本记录 | E10i-close | `docs(gateway)`: `error-coverage.test.ts` 收口守卫 + `schema-coverage.cjs` 错误台账 + 架构现状 + 本记录 + 全量门禁 |

## 三层投影（P0，唯一管线）

```ts
// routes/schemas/errors.ts
ErrorEnvelope = { error: string, code?: string, message?: string, success?: false }  // required:['error'], open
// routes/registry.ts
errorResponsesFor(def): {
  default: { description:'Error',              schema: ErrorEnvelope },          // 所有 op
  401/403: { description:'Unauthorized'/…,     schema: ErrorEnvelope },          // 仅 path 以 '/api/' 开头
  [status]: { description: 按状态码或 errorDescription, schema: errorSchemas[status] ?? ErrorEnvelope },
}
```

- **`default` 是兜底而不是枚举**：未列出的 4xx/5xx 都按统一包描述（`default` 恒存在，永不被覆盖）。
- **401/403 挂在路径前缀而不是 tag 或权限语义**：`/api/*` 全部有 transport 鉴权层，`/a2a/*`、
  `/health`、`/.well-known/*`、`/control`、`/register` 没有。
- **显式状态码后写，可覆盖同名 401/403**（当前无 op 这么做，行为留作扩展位）。
- 只声明不校验：`emit:openapi` 只把 `RouteDef` 投影进 `responses`，网关运行时不读这些 schema。

## 逐批落点

### E1（session + pods，43 op / 98 条）

- session：`create`（400/409/429 quota）、`fork` / `checkpoint` / `restoreCheckpoint`（404/409）、
  `prompt` / `promptAsync`（400/404/409/429/503）、queue 三件（404）、`config.set`（400/503）、
  `delete` / `rename` / `summarize` / `revert` / `unrevert` / `abandon` / `resume` / `suspend`
  （400/404/503 按 handler 有的分支）、subagents 四件（400/404）。
- pods：`create` / `update` / `wake` / `sleep`（400/404/409）、tasks（400/404/409）、messages（400/404）、
  goals（400/403/404/409，accept 面 403 = human-only 业务 403）、reviewItems（400/404/409）。
- 503 集中出现在 session 写接口的 runtime 缺失面（30 条），对应 handler 的
  `Runtime unavailable` 分支。

### E2（goals/decisions/lead/standing + events/automations/approvals/questions/triage/permissions，51 op / 127 条）

- goals：`pause` / `resume` / `stop` / `control` / `retryNode` / `plan` / `planApproval` /
  `respondQuestion`（唯一特殊形状，见下）/ `validate`（400）。
- decisions / lead（topics / boundaries）/ standing：400/403/404/409，403 均为 human-only 业务面
  （accept / merge / undo / confirm）。
- events / automations / approvals / questions / triage / permissions：400/403/404/409；
  「未命中也是 200」的分支（`automations.remove` / `triage.reject|dismiss`）不声明 404——
  handler 确实回 200，错误体不能比 wire 更严。
- 跳过 4 个 handler 无非 2xx 分支的 op（`lead.boundaries.observe`、`automations.remove`、
  `triage.reject`、`triage.dismiss`）与 2 个当前不可达分支（`goals.validate` 409、
  `events.webhook.receive` 429——`ingest` throw 走 `default`）。

### E3（plugins/runtime/config/mcp + memory/media/tts/mobile/devices/skills + chat/python/obs/tools/eval/llm，63 op / 131 条）

- mcp：`configPreview|configApply|configRestore|configPreviewRemove|configRemove` 跟
  `mcp-config.ts statusFor()`（`invalid|exists|type_mismatch|too_large`=400、`not_found`=404、
  `etag_mismatch`=409）；`connect` / `disconnect` 只声明 surface gate 的 503。
- plugins：`PluginActionError` 分档（`invalid-input`=400、`unknown-package|unknown-action`=404、
  `aborted|unloaded|stale-revision`=409）；`enable|disable|reload` 的 `assertInstalled` 404 /
  `assertNotBlocked` 409；`installPackage` 的 413 与 409（`already installed` / `safe_mode_active`）。
- memory / media / tts / mobile / devices / skills：413 集中在媒体帽（image 20MB / audio 25MB /
  video 50MB / pairing body 55MB）；429 两处 quota（项目数帽 / 内核并发帽）。
- 跳过 4 个恒 200 的 op（`runtime.conformance`、`media.pluginsReload`、`memory.add`、
  `memory.setSticky`——后两者的错误放在 **200 body** 的 `{success:false,error}`，E10h 已建模）。

## 特殊形状与豁免

- **`QuestionLedgerErrorSchema`（唯一没有 `error` 的错误体）**：`goals.respondQuestion` 的 404/409
  由 handler 直接写 `{status:'not_found'}` / `{status:'conflict', currentState}`——这是 question
  ledger 的状态体，**没有 `error` 字段**。套 `ErrorEnvelope` 会宣称一个 handler 永不写出的字段，
  故 catalog 如实建模为 `{status: 'not_found'|'conflict', currentState?}`（`required:['status']`）。
  守卫里是一条**具名豁免**（带原因），且双向校验：豁免列出的状态必须正好投影该 schema，
  任何缺 `error` 的错误体必须有豁免。
- **quota 429 不是豁免**：`QuotaExceededErrorSchema` 仍要求 `error`
  （`{error, code:'quota_exceeded', resource, limit, current}`），三处：
  `session.create`（会话数帽）、`project.setCurrent`（项目数帽）、`python.execute`（内核并发帽）。
- **`CapabilityUnavailableErrorSchema` 仍未被引用**：唯一走 `capGuard` 的写接口
  `runtime.config.update` 的 503 有两个 body（capability code / 纯 `{error}`），只有可选 `code`
  的信封对两者都为真；用 capability 字面量会宣称缺失分支不存在。

## 非 `/api` 的 9 个 op（不带 401/403）

`health.root`（`/health`）、`a2a.agentCard`（`/.well-known/agent-card.json`）、
`project.setCurrent`（`/register`）、`media.createTask`（`/a2a`）、`media.artifact`（`/a2a/artifacts/:id`）、
`pods.a2a`（`/a2a/pods/:podId`）、`pods.a2aCard`（`/a2a/pods/:podId/.well-known/agent-card.json`）、
`pods.a2aArtifact`（`/a2a/pods/:podId/artifacts/:artifactId`）、`goals.controlLegacy`（`/control`）。

这些入口没有 transport 鉴权层（loopback / A2A 协议 / CLI 专用），声明 401/403 等于广告一扇不存在的门；
它们的业务错误（`/a2a` 的 loopback 403、`/register` 的参数校验）落 `default` 或显式 400/429。

## 为什么 500 / 502 / 405 留在 `default`

错误体契约承诺的是**客户端可分支处理的状态**，不是实现故障。`mcp.connect|disconnect` 502、
`tts.*` / `media.*` 502、`plugins.invoke` 408/502、`media.upload|uploadAndCreate` 415、
各 handler 的 500 catch-all 都是「本轮实现出问题」而非「这条 API 会这样回你」；
逐个建模会把网关崩溃写成 API 契约的一部分，并制造必须维护的假分支。
`default`（`ErrorEnvelope`）已保证「任何未列出状态至少带 `error: string`」。
`405` 属路由层（方法未注册），不在 op 契约内。

## 收口守卫（本波唯一新增代码）

`gateway/tests/unit/architecture/error-coverage.test.ts`（**8 tests / 1 suite**）：

1. 327/327 op 投影 `default` `ErrorEnvelope`（`required:['error']`；`code`/`message`/`success` additive；开放体）；
2. 全量 `toOpenApiPaths()` 与 `errorResponsesFor()` 逐 op 一致（327 个唯一 method+path，无 op 被同名覆盖），
   证明守卫审计的是真实 emit 路径而不是旁路；
3. `/api/*` 的 **318** 个 op 全部有 401 + 403（`Unauthorized` / `Forbidden` 描述 + 信封 schema），
   非 `/api` 的 **9** 个一个都没有；
4. 9 个非 `/api` op 的 id + method + path **逐个钉死**（新增第十个非 `/api` 路由是 transport 决策，
   必须显式改这张表）；
5. `errors` 中每个状态都必须被投影，且 schema 恰为 `errorSchemas[status] ?? ErrorEnvelope`
   ——没有「有状态码无 schema」，没有计划外状态出现在 `responses` 里，也没有 `errorSchemas`
   为未列入 `errors` 的状态声明的死配置；
6. 账目 **157 op / 356 条** + 逐状态分布（400×124 / 404×78 / 409×54 / 413×6 / 429×3 / 503×91）
   与「每个 op 内状态不重复」钉死；空 `errors` 的 op 数量也参与 327 的闭合算术；
7. 特殊形状清单：非信封形状恰为 3 处 quota 429 + `respondQuestion` 404/409；缺 `error` 的体恰为
   那两条；豁免表键集为 `['goals.respondQuestion']`、原因非空、schema 是 `QuestionLedgerErrorSchema`
   且该 schema 确实没有 `error`、`required:['status']`；
8. **mutation test**：抽掉一个 `default`、抽掉一个 401、给 `health.root` 加 401 → 审计各按
   operationId 报错；恢复后归零（审计是纯函数，catalog 源文件未被修改）。

台账脚本 `gateway/scripts/schema-coverage.cjs` 同步扩了错误切片（既有输出逐字保留）：

```
errors: default 327/327 operations declare a default error envelope; explicit ops 157
        (356 status entries: 400x124 / 404x78 / 409x54 / 413x6 / 429x3 / 503x91)
```

JSON 字段：`errorDefaults` / `errorDefaultTotal` / `explicitErrorOps` / `errorOps`（id 列表）/
`errorEntries` / `errorStatusSplit`。

## 行为变化 / Breaking

- **wire 字节：零变化**（无 handler / 路由 / 错误体改动）。
- **SDK 手写类型面：零变化**（SDK `npm test` 仍 226）。
- **客户端可见**：`gateway-paths.json` / `openapi.json` / `api-schema.gen.ts` 每个 op 多了 `default`
  （`/api` op 另有 401/403，157 op 另有显式状态码）——对代码生成消费者是 **additive**；
  此前这些位置的 `responses` 只有 `200`。
- **未改变**：运行时响应校验、200 响应契约（E10f / E10h）、请求契约（E10g）、SSE / 二进制面。

## 验证（worktree @ `6aa2fad6` + E10i-close）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `npx tsc --noEmit -p tsconfig.json`（`gateway/`） | **0 errors** |
| gateway 全量 | `npx jest --runInBand --forceExit --no-coverage`（`gateway/`） | **7669 tests（7657 passed / 9 failed / 3 skipped）**；suites **3 failed / 1 skipped / 945 passed（948 of 949）**；9 条红全部落在 3 个已知 env-red suite，零契约红；202.5s |
| 覆盖率台账 | `npm run schema:coverage` | **responses 320/327（97.9%）**；**write responses 194/195（99.5%）**；**requests 189/195（96.9%）**；**errors: default 327/327 + explicit ops 157（356 entries）** |
| 路由分析 | `node scripts/analyze-routes.cjs` | **`TOTAL 0 (match 0, equals 0)`** |
| 契约产物新鲜度 | `npm run emit:openapi`（gateway）→ `npm run gen:api`（SDK） | **327 routes → 293 paths / 327 operations**，overrides 命中 **10**；二次运行 `git status` 无生成物 diff |
| 定向契约 + 守卫 | jest `api-contract` + `registry` + `architecture/`（11 suites） | **381 passed / 13 suites**（api-contract **261** + registry **21** + architecture **99** = error-coverage 8 + schema-coverage 52 + write-response 7 + kernel-split 7 + 其余 25） |
| kernel-split 守卫 | 同上（单独含在定向里） | **7 / 7 passed** |
| SDK 类型 | `npx tsc --noEmit -p tsconfig.json`（`packages/gateway-sdk`） | **0 errors** |
| SDK 全量 | `npm test`（`src/*.test.ts`） | **226 / 226 passed（0 fail）**（本波 0 运行时新增） |
| SDK contract | `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test src/contract.test.ts` | **4 / 4 passed** |
| desktop 全量 | `npm run test:desktop`（worktree root） | **3868 tests / 736 suites（3867 passed / 1 failed / 0 skipped）**。唯一红 = `src/main/mafw-gateway-resolver.test.ts` dev-path（worktree 未构建 `gateway/dist`） |
| desktop 类型 | `npx tsgo --noEmit -p tsconfig.json`（`packages/desktop`） | 只剩已知 `node:tls` **2 条**（`getCACertificates` / `setDefaultCACertificates`） |
| mobile 定向 | `flutter test test/pod_models_test.dart test/triage_card_model_test.dart` | **31 / 31 passed** |
| mobile analyzer | `flutter analyze`（`mobile/`） | **No issues found（0）** |
| TUI | `npm run test:tui` | **env-red**：`ERR_MODULE_NOT_FOUND` — `@earendil-works/pi-tui` 未安装（本波零 TUI 代码改动） |

## 新增测试（对基线 `85f5190b` 的增量）

| 文件 | 基线 → 终值 | 增量 | 依据 |
|---|---|---|---|
| `gateway/tests/unit/api-contract.test.ts` | 231 → **261** | **+30** | P0 +4 / E1 +5 / E2 +9 / E3 +12（逐批错误状态投影 + 特殊形状 + quota 三元组） |
| `gateway/tests/unit/registry.test.ts` | — → 含 **7** 条 E10i 断言 | **+7** | P0：default / 401-403 / 非 `/api` 反向 / `errorSchemas` 覆盖 / capability / 只声明不校验 / 200 不变 |
| `gateway/tests/unit/architecture/error-coverage.test.ts` | 0 → **8**（**new suite**） | **+8** | E10i-close 收口守卫（见上 8 条） |
| SDK / desktop / mobile | — | **0** | 本波无 SDK 手写类型、无 desktop、无 mobile 代码改动 |

**本波新增可执行 test case：45**（P0–E3 的 37 + 收口守卫 8）。

## 已知红（非本波代码问题）

1. **gateway env-red 9 条 / 3 suites**：`tests/integration/plugin-package-e2e.test.ts`（npm staging 解析
   `@mafw/plugin-contract`）、`tests/unit/runtime/claude-adapter-acceptance.test.ts` /
   `claude-adapter-coverage.test.ts`（esbuild 在未预构建 worktree 解析不到
   `@anthropic-ai/claude-agent-sdk`）——与 E10e / E10f / E10g / E10h 同一集合。
2. **desktop 1 条环境红**：worktree 未构建 `gateway/dist` → `src/main/mafw-gateway-resolver.test.ts` dev-path。
3. **desktop 类型 `node:tls` 2 条**：hoisted `@types/node` 缺 `getCACertificates` /
   `setDefaultCACertificates`（既有噪声）。
4. **TUI env-red**：`@earendil-works/pi-tui` 未安装（`ERR_MODULE_NOT_FOUND`，本波零 TUI 代码改动）。
5. **`npm run test:contract`（`packages/runtime-contract`）** 本机红于 `TS5023
   rewriteRelativeImportExtensions`（根 `typescript` 5.6.3 vs 5.7+ 选项），该包零改动。
6. **首轮全量多出的 5 条 `pod-worktree-service` 5s 超时（第二轮的 9 条已不含它们）**：首轮与 desktop
   全量并发跑，5 个 git worktree 用例撞 5000ms 默认超时；隔离重跑仍 2–6 条（同一 5s 超时、断言零失败）。
   证据表明是环境抖动而非回归：① `tests/unit/pod/pod-worktree-service.test.ts` 与
   `src/services/**` 对基线 `85f5190b` **逐字节相同**（本波只动 `routes/` 三文件）；
   ② 同套件加 `--testTimeout=60000` → **16/16 passed**；③ 主 checkout 同套件 → **16/16 passed**；
   ④ 第二轮全量（无并发负载）→ 恰好 **9 条**已知 env-red。

## Deferred（E10i 后仍保留）

- **`tts.speakStream` 的流式响应契约**：要建模只能换 `text/event-stream` 帧 schema；当前 OpenAPI 3.1
  投影只描述 JSON content，硬塞会产出错误的 `application/json` 声明；其错误面已由 E10i 覆盖（400 + `default`）。
- **6 个非 JSON GET 的 transport 级响应契约**（content-type / SSE 帧格式）：只记录，不建 JSON schema。
- **强制版本协商 / SDK 全量 schema 类型化**。
- **TUI triage phantom**（`reason` / `goalId` / `severity`）：`@earendil-works/pi-tui` 未安装，
  门禁无法验证（mobile 已在 E10f-E 收口，desktop 是 E10b-3）。
- **mobile 工作 tab 的其余增量 patch**（任务 / 消息仍是整页快照）。
- **实现故障面不建模**：500 catch-all / 502 / 408 / 415 / 405 留在 `default`（理由见上）。

## 与 spec / plan 的差异（有意 deviation）

1. spec §2 的状态调色板按域给出「可能值」：实际只声明**handler 真有的分支**——例如 `plugins.delete`
   无 409（不走 `assertNotBlocked`）、`plugins.apply` 无 404（不走 `assertInstalled`）、
   `automations.remove` / `triage.reject|dismiss` 无 404（未命中也是 200）。
2. spec §1 的「401/403 给所有 `/api/*`」按路径前缀实现（不是 tag），因为 `/a2a`、`/register`、`/control`
   确实没有 transport 鉴权层；这条反向约束也进了守卫。
3. spec §4 的「显式状态至少 N 个 op」由收口实测固定为 **157**；另加 356 条目与逐状态分布，防「只留
   少数状态保平安」。
4. spec §1 提到 `503 capability` 用特殊包：实测唯一 capGuard 写接口 `runtime.config.update` 的 503 有
   两个 body，故仍用信封（`CapabilityUnavailableErrorSchema` 保留但未引用）。
