# Gateway E10g 写请求契约收口交付记录（2026-11-14）

- 版本：gateway 4.16.1 / SDK 5.1.0 / desktop 5.1.0（**无版本号变更**；mobile 1.1.0+2 不变）
- 性质：为 catalog 的**全部 188 个写 op**（非 GET）补请求契约 —— **182 个声明 `request` + 6 个显式排除**；
  路由集合零变化（**318 ops / 284 paths**），**handler 零改动**（唯二例外：`schemas/pods.ts` 的 5 个 const
  改为 export 供 W3 复用、`schemas/standing.ts` 的 3 个 const 改 export 供 W4 复用，形状零变化），
  **响应口径不变 125/318**，**没有运行时 body 校验**（声明式契约，handler 仍是事实源）
- spec：`docs/superpowers/specs/2026-11-14-gateway-e10g-request-contracts-design.md`
- plan：`docs/superpowers/plans/2026-11-14-gateway-e10g-request-contracts.md`
- 架构现状：`docs/architecture/gateway.md` §「E10g 请求契约」+§「台账口径（E10g）」+§「明确排除（E10g）」
- 证据：`.superpowers/sdd/2026-11-14-gateway-e10g-requests/{progress.md,P0-report.md,W1-report.md,
  W2W3-report.md,W4-report.md,W5-report.md,W6-report.md,W7-report.md,W8-report.md}`
- TDD：每批先写 api-contract 失败用例 + 覆盖率台账 → 红 → 最小 schema 实现 → 一个 commit

## 波次与提交

- 分支：`feat/gateway-e10g-request-contracts`（worktree `.superpowers/e10g-worktree`）
- 基线：`ca62ba13`（E10g spec + plan）

| commit | 任务 | 一句话 |
|---|---|---|
| `eacf055f` | E10g-P0 | `feat(contract)`: `RouteDef.request/requestContentType/requestRequired` + `toOpenApiPaths()` requestBody 投影 + `schema-coverage.cjs` 的 `requests` 台账 + 3 pilot；requests 3/188 |
| `f6abf789` | E10g-W1 | `feat(contract)`: session 写接口 35 个（20 JSON body + 15 空对象）+ api-contract +9 + coverage +2；38/188 |
| `881e2794` | E10g-W2/W3 | `feat(contract)`: tasks/terminal/background/fileHistory 8 个 + pod 写接口 25 个（18 JSON + 6 可选 + 9 空对象）+ api-contract +8 + coverage +3；71/188 |
| `aa1685c9` | E10g-W4 | `feat(contract)`: goals/decisions/lead/standing/goalRuns 29 个（10 JSON + 6 可选 + 13 空对象）+ api-contract +7 + coverage +3；100/188 |
| `ce162b10` | E10g-W5 | `feat(contract)`: events/automations/approvals/questions/triage/permissions 24 个（16 JSON + 1 协议边界 + 7 空对象）+ api-contract +8 + coverage +3；124/188 |
| `b1f53a3e` | E10g-W6 | `feat(contract)`: mcp/plugins/runtime/config/project/manager/commands 26 个（16 JSON + 2 所有权边界 + 2 可选 + 6 空对象）+ `plugins.install` 排除 + api-contract +9 + coverage +4；150/188 |
| `38283690` | E10g-W7 | `feat(contract)`: memory/media/tts/chat/python/obs/models/tools/eval/llm/mobile/devices 30 个（23 JSON + 1 可选 + 6 空对象）+ 5 排除 + api-contract +13 + coverage +5；180/188 |
| `16918551` | E10g-W8 | `feat(contract)`: cognition gate/rewrite 2 个 JSON body + api-contract +3 + coverage +2；**182/188（96.8%）**，写表面收口 |
| 本记录 | E10g-close | `docs(gateway)`: `request-coverage.test.ts` 收口守卫 + 架构台账 + 本记录 + 全量门禁 |

## requestBody 投影语义（P0）

`RouteDef` 新增三个声明位（`gateway/src/routes/registry.ts`）：

```ts
request?: object;              // TypeBox / JSON Schema；缺省 = 未建模
requestContentType?: string;   // 默认 'application/json'
requestRequired?: boolean;     // 默认 true；无 body 动作用 false
```

`toOpenApiPaths()` 投影（只声明，不校验）：

```ts
if (def.request) op.requestBody = {
  required: def.requestRequired !== false,
  content: { [def.requestContentType ?? 'application/json']: { schema: def.request } },
};
```

- **没有 `request` 就没有 `requestBody`**：其余 op 在 `openapi.json` / `api-schema.gen.ts` 里仍是
  `requestBody?: never` → 排除项不会被「空壳 requestBody」伪装成已建模。
- `requestContentType` 本波**没有任何 op 使用**（二进制 / multipart 面全部排除）：它是管道位，
  留给未来真正需要 `application/octet-stream` 的 op；当前 182 个 requestBody 全是 `application/json`。
- **运行时校验有意缺席**（spec §4 非目标，与 response 同策略）：gateway 不解析 / 不拒绝 body；
  400 / 截断 / fail-open 的语义仍在 handler（schema 的 description 只做说明）。
- 台账口径：`gateway/scripts/schema-coverage.cjs` 用与 `response:` 相同的 brace-balanced 文本解析扫
  `request:`，分母 = 非 GET op（163 POST + 16 DELETE + 6 PATCH + 3 PUT = **188**）；`--json` 增
  `requests` / `requestCovered` / `requestTotal` / `requestUncovered`。response 输出不变（125/318）。

## 覆盖率数学

| 批次 | 新增 request | 累计 |
|---|---|---|
| 基线 `ca62ba13` | — | 0/188 |
| P0（3 pilot） | 3 | 3/188（1.6%） |
| W1 session | 35 | 38/188（20.2%） |
| W2/W3 task + pod | 33 | 71/188（37.8%） |
| W4 goal/decision/lead/standing | 29 | 100/188（53.2%） |
| W5 event/automation/human-gate | 24 | 124/188（66.0%） |
| W6 mcp/plugin/runtime/platform | 26 | 150/188（79.8%） |
| W7 memory/media/device/misc | 30 | 180/188（95.7%） |
| W8 cognition | 2 | **182/188（96.8%）** |
| 排除（W6 1 + W7 5） | 0 | **182 covered + 6 excluded = 188** |

最终分类（实测 `catalog` 扫描，和 = 188）：

| 类别 | 数量 | 判据 |
|---|---|---|
| JSON body（`requestRequired` 缺省 true） | **105** | handler 读 body；缺失 → 400 |
| 空对象动作（`Type.Object({})` + `requestRequired:false`） | **56** | 输入只在 path / query；语义是「无字段」 |
| 可选 body（有 `properties` + `requestRequired:false`） | **20** | 有缺省值，或字段只用于 actor 鉴权 / query 回退 |
| 协议透传边界（开放对象 + `requestRequired:false`） | **1** | `events.webhook.receive` |
| 显式排除（不入 `request`） | **6** | 见下表 |

- **响应覆盖不变**：`125/318（39.3%）`。E10g 只动请求侧；未覆盖的 193 = 187 个非 GET 的 200 体
  + 6 个非 JSON GET（二进制 / SSE）。两个分母独立：responses 318、requests 188。

### 6 个排除（原因入库，`request-coverage.test.ts` 的 `REQUEST_EXCLUDED`）

| op | transport | 原因 | JSON 替代面 |
|---|---|---|---|
| `plugins.install` | `POST /api/plugins/install` | 原始 `.js` 字节流（`readBodyBuffer`）+ query `filename` / `type` / `overwrite` | `plugins.installPackage`（`{path}`） |
| `media.upload` | `POST /api/media/upload` | 原始媒体字节流（`for await (const chunk of req)`）+ query `type` | `media.createTaskApi` / `media.analyzeAudio` |
| `media.uploadAndCreate` | `POST /api/media/upload-and-create` | 原始字节流 + query `type` / `question` | 同上 |
| `media.createTask` | `POST /a2a` | A2A JSON-RPC 透传（`agent.handleJsonRpc`，响应 `application/a2a+json`），信封归协议 | `media.createTaskApi` |
| `mobile.mediaTaskUpload` | `POST /api/mobile/media/tasks` | `multipart/form-data` 文件部（boundary 在 `mobile/media-proxy.ts` 手解） | `mobile.mediaTaskAsk` |
| `pods.a2a` | `POST /a2a/pods/:podId` | A2A JSON-RPC 透传（raw body → `PodA2AAgent.handleJsonRpc`），信封归协议 | `pods.a2aCard` + pod 写接口 |

- 六项都**不**声明 `request`：给一个 gateway 从不解析的形状建模（例如 `Type.String()`）只会把
  「未声明形状」伪装成已覆盖。multipart schema 建模与 A2A 信封的机器可读产物不在本波（spec §4）。

## 交付项（逐批）

### P0（管线 + 3 pilot）

| 文件 | 内容 |
|---|---|
| `gateway/src/routes/registry.ts` | `RouteDef.request/requestContentType/requestRequired` + `toOpenApiPaths()` requestBody 投影 |
| `gateway/scripts/schema-coverage.cjs` | `requests: X/188` + `--json` 四个新字段 |
| `gateway/src/routes/schemas/session.ts` | `SessionCreateRequest`（`directory` 必填绝对路径：`minLength:1` + 跨平台绝对路径 pattern；`worktree?: boolean\|string`；`metadata?: Record`） |
| `gateway/src/routes/schemas/tasks.ts` | `TaskSubmitRequest`（`kind` / `parentSessionID` 必填；shell→`command`、subagent→`prompt` 条件必填由 `TaskService.submit` 校验） |
| `gateway/src/routes/schemas/pods.ts` | `PodTaskCreateRequest`（`title` 必填；plan 模式 `goalId` 必填） |

### W1（session，35）

- `gateway/src/routes/schemas/session-write.ts`（new）：`EmptyRequest`（全波复用）+ 20 个 body schema。
- **20 JSON body**：`session.config.set`（`category` + 多态 `value`）、`session.switchAgent` / `switchModel`、
  `session.structured`（`structured.submit`）、`fork`、`revert`、`revertDiff`（`patches` + `hunkIndices`）、
  `checkpoint`、`restoreCheckpoint`（`scope` + `confirm:true`）、`data`、`discoverySkillInvoke`、`summarize`、
  `prompt` / `promptAsync`（`parts` / `delivery` / budget）、`command`、`rename`、`usagePluginsCreate`、
  `usagePluginSourcePut`、`subagents.spawn` / `subagents.message`。
- **15 空对象**（`requestRequired:false`）：`abort` / `suspend` / `resume` / `discardRun` / `unrevert` /
  `delete` / `deleteLegacy` / `queue.clear` / `queue.cancel` / `subagents.cancel` / `discoveryRefresh` /
  `background` / `usagePluginsReload` / `usagePluginsDelete` / `usagePluginTest`。
- `session.command` 无 gateway handler（尾部反代 runtime serve）→ schema 按 `@opencode-ai/sdk`
  `SessionCommandData.body` 声明（body 可缺省，`command` / `arguments` 必填）。

### W2/W3（task / terminal / background / fileHistory 8 + pod 25）

- `gateway/src/routes/schemas/task-write.ts`（W2）、`pod-write.ts`（W3，复用 `schemas/pods.ts` 的
  status / probe 子 schema）。
- **18 JSON body**：`tasks.message`、`terminal.create`、`fileHistory.snapshot` / `restore`、`pods.update`
  （status-only PATCH）、`pods.tasks.update`、`pods.messages.create`、`pods.messages.delivery.dismiss`、
  `pods.goals.create` / `handoff` / `reviewItems.create` / `accept` / `reject` / `direction` /
  `techLead.messages` / `probes.create`、`pods.memory.write`、`pod.events.seenAll`。
- **6 可选 body**：`terminal.connectTicket`、`pods.tasks.delete`、`pods.goals.cancel`、
  `pods.messages.delivery.retry`、`pods.goals.reviewItems.resolve` / `reopen`。
- **9 空对象**：`tasks.cancel`、`terminal.remove`、`background.jobs.cancel`、`pods.create`、
  `pods.lead.ensure`、`pods.messages.read`、`pods.wake`、`pods.sleep`、`pod.events.seen`。

### W4（goal / decision / lead / standing / goalRun，29）

- `routes/schemas/{goal-write,decision-write,lead-write,standing-write}.ts`（new）。
- **10 JSON body**：`goals.planApproval`（批准/驳回联合体 + `planHash`/`evalHash` 内容绑定）、
  `goals.respondQuestion`（`type` 闭集，answer 分支必填 `answer`）、`goals.control` / `controlLegacy`
  （共用 `GoalControlRequest`）、`decisions.draft`（`kind` 八类闭集）/ `shelve`、`lead.boundaries.observe`、
  `lead.compact`、`standingGoals.create`（`triggers` ≥1 必填）/ `update`（PATCH 全 optional）。
- **6 可选 body**：`goals.retry` / `retryNode` / `validate`、`decisions.confirm` / `reopen`、`lead.topics.fork`。
- **13 空对象**：`goals.pause` / `resume` / `stop` / `complete`、`lead.boundaries.accept` / `merge` / `undo`、
  `lead.topics.resume`、`standingGoals.pause` / `resume` / `stop` / `run`、`goalRuns.approve`。

### W5（event / automation / human-gate，24）

- `routes/schemas/{event-write,automation-write,human-gate-write}.ts`（new）。
- **16 JSON body**：`event.publish`、`events.sources.create` / `sources.patch`（PATCH 只支持 `enabled`）、
  `events.threads.subscriptions.create`、`automations.toggle` / `draft`、`approvals.respond`、
  `questions.reply`、`triage.propose`、`permissions.reply` / `replyRuntime` / `setMode` /
  `addAllowlist` / `removeAllowlist` / `addRule` / `removeRule`。
- **1 协议边界**：`events.webhook.receive`（`additionalProperties:true` + `requestRequired:false`）。
- **7 空对象**：`events.threads.close`、`events.subscriptions.delete`、`automations.remove`、
  `questions.reject`、`triage.confirm` / `reject` / `dismiss`。
- human-only 路由（`approvals.respond`、`questions.reply|reject`、`triage.*`、`lead.boundaries.*`、
  `goalRuns.approve`）**不声明 `actorSessionID`**：携带即 403 的禁止字段不是可选字段。

### W6（mcp / plugin / runtime / platform，26）

- `routes/schemas/{mcp-write,plugin-write,runtime-write,platform-write}.ts`（new）。
- **16 JSON body**：`mcp.config*`（5，`token` + `confirm:true` + 409 `etag_mismatch`）、
  `plugins.installPackage` / `check` / `enable` / `disable` / `delete`（后三者共用 `{package}` 或
  `{type,filename}` 变体，字段全 optional 但 body 必填）/ `webTicket`、`runtime.switch`、`config.set`、
  `project.setCurrent`、`manager.rotate`、`mafwCommands.run`。
- **2 所有权边界**（开放对象、body **必填**）：`runtime.config.update`（runtime 原生 Config merge）、
  `runtime.dryEvent`（`event` / `plugin` 信封 + 顶层 `additionalProperties:true`）。
- **2 可选 body**：`plugins.invoke`（`input` 是插件定义开放对象）、`runtime.conformance`。
- **6 空对象**：`mcp.connect` / `disconnect`、`plugins.apply` / `reload`、`runtime.restartAgent` / `reload`。
- **排除 1**：`plugins.install`。

### W7（memory / media / tts / chat / python / obs / models / tools / eval / llm / mobile / device，30 + 5 排除）

- `routes/schemas/{memory-write,media-write,misc-write}.ts`（new）。
- **23 JSON body**：`memory.add`（`content` trim 后为空 → 400；`cueAnchors` / `sourceTraceIds` 超限截断
  而非拒绝）、`memory.setSticky`、`memory.merge`、`embedding.update`（**不声明** `baseUrl`——handler 显式
  拒绝；llama.cpp 数值区间逐项对齐）、`media.switch` / `createTaskApi` / `analyzeAudio`、`tts.speak` /
  `speakStream`（请求是 JSON，响应才是流）/ `interrupt`、`chat.send` / `sendEnriched`、
  `python.execute` / `restart`、`obs.capture`（JSON chunked，不是原始二进制）、`models.update`、
  `tools.execute`、`eval.chatCompletions`、`llm.compress`、`mobile.mediaTaskAsk` / `devicesRegister` /
  `pairingVerify`、`devices.register`。
- **1 可选 body**：`skills.deopt`（body 缺失/非法 → 默认 reason `manual`）。
- **6 空对象**：`memory.delete`、`memory.embeddingsBackfill`、`media.pluginsReload`、`devices.delete`、
  `mobile.devicesDelete`、`humanToken.rotate`（凭据在 `Authorization` 头，body 为空）。
- **排除 5**：`media.upload` / `uploadAndCreate` / `createTask`、`mobile.mediaTaskUpload`、`pods.a2a`。

### W8（cognition，2，写表面收口）

- `routes/schemas/cognition-write.ts`（new），两个 op 都是 **JSON body（`requestRequired` 缺省 true）**——
  handler 在 body 缺失时直接 400，没有可省缺的信封。

## DTO / schema 决策（以 handler 为事实源）

| # | 决策 | 理由 |
|---|---|---|
| 1 | **`pods.create` 是空对象动作** | handler 是 `POST /api/projects/:projectId/pod` → `pods.ensure(projectId)`，body 完全不读（`actorSessionID` 走 query）；透传 pod 配置需要先改 handler |
| 2 | **`pods.messages.delivery.dismiss` 是 required body** | handler 要求 `memberId`（缺 → 400）；批次说明把它当「无 body」，以 handler 为准 |
| 3 | **`pod.events.seen` 空 body vs `pod.events.seenAll` JSON body** | `seenAll` 要求 `goalId` + `revision`（缺一 400），不按「seen 类一律空对象」硬套 |
| 4 | **条件必填一律 optional + description，不伪造 `oneOf`** | `tasks.submit`（shell/subagent）、`pods.tasks.create`（plan/manual goalId）、`goals.planApproval`（approve/reject）、`cognition.gate`（`tool` 仅 tool_call 分支）、`approvals.respond`（decision/answer 二选一）——根级 `oneOf` 会让客户端类型分裂，且比 handler 更严 |
| 5 | **`cognition.rewrite.input` / `output.isError` optional** | 属宿主信封（`contract-cognition` 的 requiredFields 列了 `input`），但 `handleCognitionRewrite` 不读；设必填会比 handler 更严 |
| 6 | **`cognition.rewrite.output.content` 不设 `minItems`** | 空数组合法（200 `{content: []}`）；部件只钉 `type` + `additionalProperties:true`，不复制 runtime part 词表 |
| 7 | **开放边界而非结构**：`runtime.config.update`、`runtime.dryEvent`、`events.webhook.receive`、`plugins.invoke.input`、`tools.execute.params`、`chat.sendEnriched.parts`、`config.set` 顶层分区 | 形状归 runtime / 插件作者 / 上游 webhook 源；写死会在下次升级时立刻过期 |
| 8 | **human-only 路由不声明 `actorSessionID`** | 携带即 403（E7 不变量）；把它写成可选字段会鼓励客户端发送被拒字段 |
| 9 | **`pods.tasks.update` 全字段 optional** | 计划面（title/acceptance）与状态面（status/ownerMemberId）互斥由 handler 400 决定；空 patch 是 no-op，契约不表达「至少一个字段」 |
| 10 | **`pods.goals.probes.create` 双形态** | 单条 body 或 `{probes:[...]}`：顶层全 optional 才能让批量形态不被单条必填项绑架 |
| 11 | **`embedding.update` 反向收窄** | `baseUrl` 被 handler 显式拒绝（防 DashScope key 外发）→ 不写进契约 |

- **SDK DTO 零改动**：请求契约不进 `@mafw/sdk` 的 DTO 面（SDK 只消费响应类型与 Experience Action）；
  182 个 request 只体现在生成物 `openapi.json` / `api-schema.gen.ts` 的 `requestBody` 类型上。
  因此本波 **0 DTO 破坏**、`npm test` 恒为 226。

## 生成物 diff 审计

`emit:openapi` → `318 routes → 284 paths / 318 operations`；`gen:api` → 318 ops（overrides 命中 10）。

| 产物 | ops | paths | added | removed | changed |
|---|---|---|---|---|---|
| `contract/gateway-paths.json` | 318 → 318 | 284 → 284 | 0 | 0 | 逐批恰好该批 op 的 `requestBody` 新增（剥掉 requestBody 后逐 path 深比较相等） |
| `contract/openapi.json` | 318 → 318 | 284 → 284 | 0 | 0 | 同上 |
| `src/api-schema.gen.ts` | — | — | — | — | 同上（每批 op 块从 `requestBody?: never` 变为请求体类型） |
| `contract/overrides.json` | — | — | — | — | 未改动（仍 10 条命中） |

- 每批 `emit:openapi` + `gen:api` 二次运行幂等（W6 / W8 用 `openapi.json` 哈希比对，其余用工作树零 diff）；
  收口时重跑 → `git status` 无生成物改动。

## 收口守卫（本波唯一新增测试文件）

`gateway/tests/unit/architecture/request-coverage.test.ts`（5 个 test）：

1. 每个非 GET op **恰好**满足 `request` 或 `REQUEST_EXCLUDED` 之一（覆盖又排除 / 两者皆无都按
   operationId 报错）；
2. 排除项必须是 catalog 写 op、理由非空、且**不得**声明 `request`；清单恰好 6 条；
3. 算术闭合：`catalog 写 op 188`、`covered 182`、`182 + 6 = 188`、无未归属项；
4. 空对象动作必须 `requestRequired:false`（**56** 个；`additionalProperties:true` 的开放对象边界不计入），
   数量钉死，防止新的 fieldless 动作以「required body」形态落地；
5. GET 不得声明 request（否则会广告一个 HTTP 层从不读取的 body）。

逐批台账仍在 `schema-coverage.test.ts`（`E10G_*_REQUEST_OPS` / `E10G_*_EMPTY_OPS` / `E10G_*_OPTIONAL_OPS`
/ `E10G_*_BOUNDARY_OPS` / `E10G_W*_EXCLUDED_OPS`）：按 op 命名失败，并交叉校验
`scripts/schema-coverage.cjs` 的 `requests` 数字与 catalog 一致（parser 与源码不能漂移）。

## 行为变化 / Breaking

- **wire 字节：零变化**（没有 handler / 路由 / 响应体改动）。
- **SDK 类型面：零变化**（无 DTO 改动，`npm test` 226 不变）。
- **客户端可见**：只有 `openapi.json` / `api-schema.gen.ts` 多了 182 个 `requestBody` —— 对代码生成消费者
  是 additive（此前是 `never`）。
- **未改变**：运行时 body 校验、错误体、SSE / 二进制面、override 表。

## 验证（worktree @ E10g-close）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `npx tsc --noEmit -p tsconfig.json`（`gateway/`） | **0 errors** |
| gateway 全量 | `npx jest --runInBand --forceExit --no-coverage`（`gateway/`） | **7410 tests：7398 passed / 9 failed / 3 skipped**；suites **3 failed / 1 skipped / 921 passed（924 of 925）**；**9 条失败恰好是 3 个已知 env-red suite，零 E10g 红**；377.9s |
| 覆盖率台账 | `npm run schema:coverage` | **responses 125/318（39.3%）不变**；**requests 182/188（96.8%）** |
| 路由分析 | `node scripts/analyze-routes.cjs` | **`TOTAL 0 (match 0, equals 0)`** |
| 契约产物新鲜度 | `npm run emit:openapi`（gateway） | **318 routes → 284 paths / 318 operations，无 diff**（`git status` 无生成物改动） |
| 定向契约 + 收口守卫 | jest `api-contract` + `architecture/{schema-coverage,request-coverage}` + `registry` | **202 passed / 4 suites**（155 + 28 + 5 + 14） |
| kernel-split 守卫 | jest `tests/unit/architecture/kernel-split-guards.test.ts` | **7 / 7 passed** |
| SDK 类型 | `npx tsc --noEmit -p tsconfig.json` | **0 errors** |
| SDK 全量 | `npm test`（`src/*.test.ts`） | **226 / 226 passed（0 fail）**（本波 0 运行时新增） |
| SDK contract | `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test src/contract.test.ts` | **4 / 4 passed** |
| SDK 生成幂等 | `npm run gen:api`（二次） | **幂等**（`284 paths / 318 operations`，overrides 命中 **10**，工作树无生成物 diff） |
| desktop 全量 | `npm run test:desktop`（worktree root） | **3866 tests / 736 suites：3865 passed / 1 failed**。唯一红 = `src/main/mafw-gateway-resolver.test.ts` dev-path（worktree 未构建 `gateway/dist`） |
| desktop 类型 | `npx tsgo --noEmit -p tsconfig.json`（`packages/desktop`） | 只剩已知 `node:tls` **2 条**（`getCACertificates` / `setDefaultCACertificates`），0 新增 |
| mobile 定向 | `flutter test test/triage_card_model_test.dart test/sessions_page_test.dart test/widget_test.dart test/tab_shell_test.dart --concurrency=1` | **32 / 32 passed**（`triage_card_model_test.dart` 单独 **12 / 12**） |
| mobile analyzer | `dart analyze lib test` | **No issues found（0）** |
| TUI | `npm run test:tui` | **env-red**：`ERR_MODULE_NOT_FOUND` — `@earendil-works/pi-tui` 未安装（本波零 TUI 代码改动） |

### gateway 全量明细

```
Test Suites: 3 failed, 1 skipped, 921 passed, 924 of 925 total
Tests:       9 failed, 3 skipped, 7398 passed, 7410 total
Snapshots:   0 total
Time:        377.9 s
```

失败 suite 恰好三个已知 env-red：`tests/integration/plugin-package-e2e.test.ts`（npm staging /
`@mafw/plugin-contract` 解析）、`tests/unit/runtime/claude-adapter-acceptance.test.ts`、
`tests/unit/runtime/claude-adapter-coverage.test.ts`（esbuild 解析不到
`@anthropic-ai/claude-agent-sdk`）——与 E10e / E10f 同一集合，**零 E10g 红**（无需 isolated rerun）。
总数 `7410` 相对 E10f-close（7311）的增量 = 本波 **+93** + 基线带入的 `e717bd16`（plugin manifest v2
parser，+6 / +1 suite）；suite 总数 925 = 基线 923 + `e717bd16` 1 + 本波 `request-coverage` 1。

## 新增测试（对基线 `ca62ba13` 的增量）

| 文件 | 基线 → 终值 | 增量 | 依据 |
|---|---|---|---|
| `gateway/tests/unit/api-contract.test.ts` | 96 → **155** | **+59** | W1 +9 / W2W3 +8 / W4 +7 / W5 +8 / W6 +11 / W7 +13 / W8 +3（计数锚 + 逐 op body 形状 + 空对象/边界/排除分类） |
| `gateway/tests/unit/architecture/schema-coverage.test.ts` | 3 → **28** | **+25** | P0 2（188 分母 / pilot）+ 每批逐 op + 空对象/可选/边界/排除 + W8 最终算术 |
| `gateway/tests/unit/registry.test.ts` | 10 → **14** | **+4** | P0 管线：JSON / `application/octet-stream` / `required:false` / 无 request 无 requestBody |
| `gateway/tests/unit/architecture/request-coverage.test.ts` | 0 → **5** | **+5** | 收口守卫（恰好其一 / 排除台账 / 188 算术 / 56 空对象 optional / GET 无 request） |
| **gateway 合计** | — | **+93** | 可执行 test case 数（非断言数） |
| SDK / desktop / mobile | — | **0** | 本波无 SDK DTO、无 desktop、无 mobile 代码改动（`npm test` 仍 226、desktop 3866、mobile 32 定向不变） |

## 已知红（非本波代码问题）

1. **gateway env-red（9 条 / 3 suites）**：`tests/integration/plugin-package-e2e.test.ts`（3 例：npm staging
   解析 `@mafw/plugin-contract` 失败）、`tests/unit/runtime/claude-adapter-acceptance.test.ts` /
   `claude-adapter-coverage.test.ts`（esbuild 在未预构建的 worktree 里解析不到
   `@anthropic-ai/claude-agent-sdk`）——与 E10e / E10f 同集合。
2. **desktop 1 条环境红**：worktree 未构建 `gateway/dist` → `src/main/mafw-gateway-resolver.test.ts` 的
   dev-path 拿到 `null`。
3. **desktop 类型 `node:tls` 2 条**：hoisted `@types/node` 比运行时旧，缺 `getCACertificates` /
   `setDefaultCACertificates`（既有噪声）。
4. **TUI env-red**：`@earendil-works/pi-tui` 未安装（全仓同）。
5. 说明：mobile 定向首跑在 gateway 全量并行时出现 `sessions_page_test` 的 "did not complete" 超时；
   gateway 跑完后同一命令 **32/32 通过**（纯资源争用，非代码问题）。


## Deferred（E10g 后仍保留）

- **写面 182 个 op 的 200 response schema**（请求侧已收口；`responses` 仍 125/318）。
- **6 个二进制 / multipart / A2A 透传 op 的 transport 级契约**（content-type / SSE 帧 / multipart 部件）：
  只排除并记录，不建 JSON schema。
- **运行时 body 校验**（有意不做：声明式契约，handler 是事实源）。
- **强制版本协商 / SDK 全量 schema 类型化**（`minClientVersion` 已暴露但无拒绝旧客户端的策略）。
- **TUI triage phantom**（`reason` / `goalId` / `severity`）：`@earendil-works/pi-tui` 未安装，改不了门禁验证
  （mobile 已在 E10f-E 收口，desktop 是 E10b-3）。
- **mobile 工作 tab 的其余增量 patch**（任务 / 消息仍是整页快照，E9-1 后 flat 帧只能触发 `goalId` 局部 patch）。
- 错误体不建模（与 E10f 同口径）。

## 与 spec / plan 的差异（有意 deviation）

1. spec §2 的批次表是「约数」：实际落点 W1 35 / W2W3 33 / W4 29 / W5 24 / W6 26 / W7 30 / W8 2；
   `usage plugins` 与 `subagents` 在 W1 收口（spec 列在 W2），`cognition.*` 2 个不在 spec 批次表，
   由 W8 补齐。
2. spec §3 提出「台账文件 `request-ledger.ts`（或测试内常量）」：实际用测试内常量 + 逐批清单
   （`schema-coverage.test.ts`），收口清单集中在 `request-coverage.test.ts` 的 `REQUEST_EXCLUDED`/常量。
3. spec 未预言 `events.webhook.receive` 的处理归属：实现按「协议透传边界」**计入覆盖**
   （`additionalProperties:true` + `requestRequired:false`），而不是排除——签名头不是 body 字段，
   排除会让它看起来无归属。
4. spec §1.3 提到的 `obs.capture` 排除：实现**不排除**——它虽然手写 chunked reader，但 body 是 JSON
   （`JSON.parse`，1MB 上限），因此按 JSON body 建模（`content` 不设必填，fail-open 200 写在描述里）。
