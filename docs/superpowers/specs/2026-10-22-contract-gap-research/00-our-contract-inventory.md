# 00 — 我们自己的契约盘点（runtime 契约 + 路由面全能力清单）

> 契约缺口研究的基线文档：先精确回答"我们有什么"，再谈"业界有什么而我们没有"。
> 事实源：`gateway/src/runtime/`（canonical v3 刚完成）+ `gateway/src/routes/route-catalog.ts` + `adapters/claude/`。
> 文档面补充：仓库根 `AGENTS.md` §5.19（Runtime 能力契约）——本文与其一致并以代码行为准。
> 所有行号基于 2026-10-22 工作区快照。

---

## ① RuntimeClient 全动词 + 选项表（TypeScript 保真）

### ①.1 能力位 `RuntimeCapabilities`（contract.ts:26-57）

| 能力位 | 类型 | opencode（fullCapabilities :59-80） | pi（pi-runtime.ts:14-25） | 语义 |
|---|---|---|---|---|
| `sessionApi` | bool 必填 | true | true | session.create/prompt/promptAsync/messages/... 全套 |
| `promptWhileBusy` | bool 必填 | true | true | busy 会话可追加消息（recall 投递通道） |
| `eventStream` | bool 必填 | true | true | global.event() 全局事件流 |
| `nativeApprovals` | bool 必填 | true | true | 原生 question/permission API |
| `providerConfigApi` | bool 必填 | true | true | provider.list / app.agents / config.get/update |
| `perLlmCallTransform` | bool 必填 | true | true | per-LLM-call messages transform（信息性声明） |
| `sessionStorageApi` | bool? | true | true | session.listByDirectory 直读私有存储 |
| `agentConfigApi` | bool? | true | true | agent 定义安装（agents.install） |
| `agentProcessApi` | bool? | true（external 时 false，opencode-runtime.ts:263-269） | false | agentProcess.restart/spawnServe/killServe |
| `completionApi` | bool? | true | true | 无状态单次补全 completion.complete |
| `sessionBranchApi` | bool? | true | true | session.fork/revert（unrevert 视实现） |
| `turnBudgetApi` | bool? | **false**（:77——opencode SDK 无对应字段，预算由 BudgetGuard 承担） | false | 原生强制 maxTurns/maxCostUsd |
| `questionApi` | bool? | true | false | session.question.{list,reply,reject} |
| `diffApi` | bool? | true（opencode v2 独有） | false | session.diff / vcs.{diff,apply} |
| `worktreeApi` | bool? | true | false | 按 directory 创建会话（worktree 并行） |

Tier 分级（契约文件头 :4-9）：Tier 0 = sessionApi+promptWhileBusy+tools → 协作协议+per-turn 记忆；Tier 1 = +eventStream → 自治执行；Tier 2 = +DTO 归一化 → 桌面完整。

### ①.2 `SessionPromptOpts`（contract.ts:110-133）——prompt 的全部选项

```ts
export interface SessionPromptOpts {
  sessionID: string;                                    // :111
  parts?: Array<{ type: string; text?: string; [k: string]: any }>;  // :115
    // {type:'file', url, mime?, filename?} 为一等媒体附件（image/video/audio
    // dataURL 或工件引用）——必须作为多模态输入递给模型，不得文本拍平
  message?: string;                                     // :116（自动转 parts）
  agent?: string;                                       // :117 per-prompt agent 覆盖
  model?: { providerID: string; modelID: string };      // :118 per-prompt 模型覆盖
  variant?: string;                                     // :119
  system?: string;                                      // :120 system 覆盖
  delivery?: 'steer' | 'followup';                      // :123 busy 投递时机：
    // 'steer'=当前工具批后送达（纠偏）；'followup'=全部完成后。
    // opencode 忽略（无原生概念）；pi 映射 streamingBehavior（pi-session.ts:169-171）
  expectReply?: boolean;                                // :126 false=落历史免回复（opencode noReply）
    // pi 无原生等价——全路径降级普通消息+每会话 warn 一次（pi-session.ts:173-178）
  noReply?: boolean;                                    // :128 @deprecated → expectReply:false
  maxTurns?: number;                                    // :130 回合数上限；原生支持见 turnBudgetApi
  maxCostUsd?: number;                                  // :132 本条 prompt 美元成本上限
}
```

**实测边界**：opencode adapter（opencode-adapter.ts:110-121）实际只透传 `parts/agent/model/variant/system/noReply(由 expectReply 映射)`——`delivery/maxTurns/maxCostUsd` 在 opencode 侧静默丢弃（SDK 无字段），预算由 gateway 侧 BudgetGuard 承担。HTTP 面 `POST /api/session/:id/promptAsync`（index.ts:5738-5760）body 只解构 `{message, parts, agent, model}`——delivery/expectReply/maxTurns/maxCostUsd **不在 HTTP 暴露面**（仅 gateway 内部消费方使用，如 BudgetGuard notify 的 expectReply:false、milestone-push 的 noReply）。

### ①.3 `RuntimeClient.session` 全动词（contract.ts:250-318）

| 动词 | 签名要点 | opencode 实现 | 证据 |
|---|---|---|---|
| `create(opts: SessionCreateOpts)` | directory **必填绝对路径**（:103-108，spec 2026-10-20 目录契约） | client.session.create | adapter:103-108 |
| `promptAsync(opts)` | fire-and-forget，返回 `{error?, response?} | void` | 透传（见 ①.2 边界） | adapter:110-121 / 契约:253 |
| `prompt(opts)` | 同步，返回 `PromptResultEnvelope` 超集 | 从 info.tokens/cost/error 组装 envelope | adapter:123-157 / 契约:254 |
| `messages(opts)` | `{limit?, before?}` 分页游标 + nextCursor | client.session.messages | adapter:159-168 / 契约:255 |
| `normalizeMessages?(raw)` | 原生历史 → `MafwMessage[]`（flat，canonical v3） | opencode 走默认 wire→flat（opencode-history.ts:17-26）；pi 有专实现（pi/pi-message-normalize.ts） | 契约:256-258 |
| `get / delete` | | | adapter:170-184 / 契约:259-260 |
| `update?(opts)` | rename：flat `{sessionID, title}` | v2 SDK flat 签名 | adapter:186-195 / 契约:262 |
| `abort(opts)` | 中止在途回合 | client.session.abort | adapter:197-201 / 契约:263 |
| `list(opts?)` / `listByDirectory?(dir, limit?)` | 后者直读 SQLite（sessionStorageApi） | listSessionsFromDb | opencode-runtime.ts:315-317 / 契约:264-265 |
| `todo(opts)` | 会话 todo 列表（runtime 原生形状） | client.session.todo | adapter:210-215 / 契约:266 |
| `children(opts)` | subagent 子会话列表（Task tool 派生） | client.session.children | adapter:217-222 / 契约:267 / 路由 index.ts:6089-6109 |
| `summarize(opts)` | `{providerID?, modelID?}`（compaction） | client.session.summarize | adapter:224-231 / 契约:268 |
| `permissionReply?(sessionID, requestId, reply, message?)` | **三值 `'once' \| 'always' \| 'reject'`**（P1 破坏性变更，原 boolean）；'always'=放行并持久化（范围由 runtime 决定，F4 注释）；返回 boolean（404=false） | client.session.permission.reply | adapter:280-296 / 契约:269-277 / 路由 permission.ts:21-77 |
| `permissionList?(opts?)` | 待审批列表（ApprovalCard 轮询） | directNative GET /permission（workspace directory） | adapter:332-335 / 契约:278-281 |
| `question?{list,reply,reject}` | answers: string[][]（每组一组选项）；directory=workspace 路由 | client.question.* + directNative | adapter:298-330 / 契约:282-289 |
| `fork?(opts)` | `{sessionID, messageID?}`（缺省=当前末尾）→ `{id}` | client.session.fork | adapter:233-240 / 契约:290-294 |
| `revert?(opts)` | `{sessionID, messageID, partID?}` 消息级回退；**pi 语义弱**（branch 移 leaf，不回滚文件、不可逆——契约注释 :295-299 明示调用方不得假设文件回滚） | client.session.revert | adapter:242-251 / 契约:300 |
| `unrevert?(opts)` | 撤销 revert（opencode-only；pi 缺席） | client.session.unrevert | adapter:253-260 / 契约:301-302 |
| `diff?(opts)` | `{sessionID, messageID?}` → 文件变更快照数组 `{file?, patch?, additions?, deletions?, status?}[]` | client.session.diff | adapter:262-268 / 契约:303-309 |
| `vcs?{diff?, apply?}` | 工作区 git 原语：diff(mode:'git'\|'branch') / apply(patch) | client.vcs.* | adapter:270-278 / 契约:310-317 |

### ①.4 `RuntimeClient` 其余命名空间（契约:319-341）

| 命名空间 | 动词 | 证据 |
|---|---|---|
| `global` | `event(): Promise<any>`（SSE 流） | 契约:319-321 |
| `provider` | `list()` → `{all, connected, default}` | 契约:322-324 |
| `app` | `agents()` | 契约:325-327 |
| `config` | `get()` / `update(config)`（全量配置透传，含 MCP 段） | 契约:328-331 |
| `tools` | `registerTools(factory: (sessionId) => MafwToolRegistration[])`（Tier-0 必选，缺=hard 拒绝）+ `nativeTools(): NativeToolDeclaration[]` | 契约:332-333 / mafw-tools.ts:256-276 |
| `completion?` | `complete(req: CompletionRequest)`（completionApi=true 必须提供） | 契约:334-335 / opencode-runtime.ts:333-357 |
| `credentials?` | `getApiKey(provider): string \| null` | 契约:336 / opencode-runtime.ts:293-297（auth.json） |
| `agents?` | `install(name, definition)` / `remove?(name)`（agent 物化器） | 契约:337-340 / opencode-runtime.ts:318-325 |

### ①.5 `AgentRuntime` 扩展（契约:343-387）

`name` / `capabilities` / `external?`（托管模式：watchdog 只探测不 kill）/ `getBaseUrl()` / `healthCheck?()`（健康检测唯一真相源）/ `agentProcess?{restart(), spawnServe?(opts), killServe?()}`（契约:364-377）/ `resolveEventEntry?()`（方言探测入口，契约:384）/ `activeDialect?`（契约:386）。`ServeSpawnOpts{host?, port?, timeoutMs?, onOutput?, onExit?}`（:390-396）。

### ①.6 `PromptResultEnvelope`（契约:139-152）

```ts
{ parts: any[]; finish?: string;
  usage?: { input: number; output: number; cached?: number; reasoning?: number; costUsd?: number };
  error?: { name: string; message: string } }
```
字段取不到 = undefined（非错误）；error 存在时 parts 原样返回。opencode 从 AssistantMessage.finish/cost/tokens 映射（adapter:135-156）。

### ①.7 工具注册通道（契约:181-212 + mafw-tools.ts）

```ts
interface MafwToolRegistration {
  name: string; label?: string; description: string;
  parameters: Record<string, any>;        // JSON Schema（object 形态），runtime 翻译为自家类型系统
  execute(params, signal?): Promise<{ text: string; isError?: boolean }>;
}
interface NativeToolDeclaration { name: string; toolClass: TOOL_CLASS; canonical?: string }
```
- 六件套 factory 单源：`buildMafwToolFactory`（mafw-tools.ts:244-248）——mafw_add_memory / mafw_python / mafw_python_restart / mafw_media_speak / mafw_media_upload / mafw_media_ask（:38-240），执行走 loopback HTTP（/api/memory/add、/api/python/*、/api/tts、/a2a）。
- opencode 实现 = ack no-op（六件套由 v1 插件承载 + MCP 自接线，adapter:372-379）；OPENCODE_NATIVE_TOOLS 11 条（adapter:32-44）。
- out-of-process 通道：`GET /api/tools`（spec 清单）+ `POST /api/tools/execute`（loopback 门；执行合成两帧 tool part `toolpart_<uuid>` running→completed/error 经 handleRuntimeEvent 同管线广播，routes/tools.ts + mafw-tools.ts:313-350）。

### ①.8 无状态补全通道（契约:214-248）

```ts
interface CompletionRequest {
  model: { providerID: string; modelID: string };
  system?: Array<{ text: string; cacheable?: boolean }>;   // cacheable=提示非承诺（DashScope cache_control）
  user: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  maxTokens?: number; temperature?: number; timeoutMs?: number;
  responseFormat?: { type: 'json_schema'; name: string; schema: Record<string, unknown>; strict?: boolean };
    // 映射不了则 fail-open 忽略——结果仍可能非 JSON
}
interface CompletionResult { text: string; usage?: { input: number; cached: number; output: number } }
```
语义：无状态（不携 sessionID）；媒体只有 image carrier；共享直连实现 `runtime/completion-http.ts`。

### ①.9 认知面 HostAdapter 四动词（host-adapter.ts，编排面之外的第二个契约）

协议 = loopback HTTP（宿主语言/进程无关），时序常量 `COGNITION_CONTRACT`（:28-34）：obsTimeout 5s / recallTimeout **100ms** / pinnedTimeout 150ms / shortIncrementMin 50 / assistantTailMax 300。

| 动词 | 协议 | 语义 |
|---|---|---|
| `observe` | POST /api/obs/capture | source ∈ user_input/assistant_reply/tool_result/reasoning；fire-and-forget fail-open |
| `injectContext` | GET /api/recall/context?sessionID=&query= | 游标增量（id 优先/count 回退，createRecallCursor :109-129）+ 短增量并入 assistant 尾部；注入物带 synthetic 标记防回流 |
| `injectSystem` | GET /api/recall/pinned + 静态 MEMORY_GUIDE（:36-66） | 追加 system 尾部 |
| `tools` | /api/memory/add、/api/python/*、/api/tts、/a2a | 六件套 |

实现：pi = pi-mafw-host-extension.ts；v1 opencode 插件 = 原生同语义（刻意不重构）；v2 = 待迁移。一致性验证：`POST /api/runtime/conformance {scenarios:["cognition-observe","cognition-inject"]}`。

---
## ② canonical 事件词汇全清单（24 runtime + 15 flat + 信封 + 内部类型）

单源：`packages/gateway-sdk/src/events.ts`（客户端契约）↔ `gateway/src/runtime/mafw-vocabulary.ts`（gateway 常量），`vocabulary-sync.test.ts` 双向钉扎；每事件每一跳的处置在 `event-flow-matrix.ts`（EVENT_FLOW_MATRIX）。

### ②.1 runtime 事件（mafw_event 信封内层，24 个）

| 域 | 事件 | facet | modeA | desktop | tui | 备注 |
|---|---|---|---|---|---|---|
| 会话生命周期 | `session.created` | — | passthrough | handled | ignore | desktop 走 planSessionEvent invalidate |
| | `session.updated` | — | passthrough | handled | ignore | patch 标题/时间 |
| | `session.deleted` | — | passthrough | handled | ignore | remove + closeSession |
| 回合生命周期 | `turn.started` | — | passthrough | **ignore** | **ignore** | v3 新增（opencode@v2 session.next.prompted / pi agent_start / codex turn/started / dsh turn/start）；**无消费方**（接线下再升 handled） |
| | `turn.completed` | chatSignal | passthrough | handled | handled | trajectory turn 聚合 + usage 合成挂此 |
| | `turn.failed` | chatSignal | passthrough | handled | handled | 广播带 error 字段提取 |
| | `turn.aborted` | — | passthrough | handled | ignore | 原 message.aborted |
| 压缩 | `session.compacting` | compaction:start | passthrough | ignore | ignore | 仅 pi 发；gateway 触发 turnCompress flush |
| | `session.compacted` | compaction:end | passthrough | handled | ignore | desktop 记录 compactionMarks |
| 消息/part 流 | `message.updated` | step, chatSignal | passthrough | handled | ignore | 载荷 flat `{message}`（canonical v3）；wire 出口还原 {info} |
| | `part.updated` | step, chatSignal, toolCommand | passthrough | handled | handled | 最高频；toolCommand 载体（tool part state.input.command 多 key 链 command/cmd/script） |
| | `part.delta` | — | passthrough | handled | ignore | 载荷 `{partID, messageID, field, delta}` |
| | `part.complete` | — | passthrough | handled | ignore | |
| 问答/审批 | `question.asked` / `question.replied` / `question.rejected` | — | passthrough | handled | ignore | desktop flow card |
| | `permission.asked` | —（approval facet 在 canonical-facets.ts:53-54） | passthrough | handled | handled | v2 载荷可选 `options[]`（服务端决策集）/ `suggestedRule`（服务端起草规则） |
| | `permission.replied` | — | passthrough | handled | ignore | |
| 数据面 | `plan.updated` | — | passthrough | handled | ignore | 原 todo.updated；ACP plan / codex todo_list 同域；载荷=runtime 原生形状透传 |
| | `usage.updated` | — | passthrough | ignore | ignore | v2 新增：gateway 在 turn.completed 后从 TrajectoryTurn 合成 `{tokens, cost, model, provider, turnID}`（index.ts:1296-1310） |
| | `trajectory.event` / `trajectory.turn` | — | passthrough | handled | ignore | desktop 滚动窗口 200 |
| 能力面 | `permission_mode` | — | passthrough | handled | handled | gateway 自发（审批三档变更） |
| | `session.diff` | — | passthrough | handled | ignore | opencode v2 会话文件变更（diffApi），desktop 实时填充 |

### ②.2 顶层扁平广播（15 个，无信封）

`user_question` / `user_feedback` / `goal_created` / `state_change` / `phase_transition` / `memory_written` / `memory_energy_changed` / `memory_distillation_complete` / `automation_triggered` / `automation_completed` / `project_registered` / `runtime_switched` / `mafw_commands_changed` / `goal_node` / `connected`（SSE 建连问候帧，gateway 直发）。registry 化发射：`runtime/flat-emit-registry.ts`。

### ②.3 wire 信封 + 内部类型

- 信封：`mafw_event`（原 opencode_event，v2 改名）；wire 契约 = 顶层广播扁平无 `data` 键。
- **内部类型（不进公开词汇/矩阵/广播）**：`tool.call` / `tool.delta` / `tool.result` 三原语（tool-part-assembler.ts:10 TOOL_PRIMITIVE_TYPES）——进 CANONICAL_TYPE_SET 校验、经 assembler 合帧为 part.updated 快照。`tool.delta` 语义扩展（v3）：`kind: 'input' | 'output'`（:17）——output delta 目前只推进状态不广播（:128 能力位预留）。
- runtime 原生丢弃：`sync`（opencode 事件溯源信封，event-flow-matrix.ts:101 RUNTIME_NATIVE_DROPPED）。

### ②.4 方言表（opencode-events.ts）

- **@v1 表**（:36-90）：8 改名行（session.idle/error→turn.completed/failed、message.error/aborted→turn.failed/aborted、message.part.*→part.*、todo.updated→plan.updated）+ next 族 32 显式 drop + v2 专有名 5 drop + 遥测族 41 drop + sync drop + canonicalIdentity 恒等行。
- **@v2 表**（:104-205，混合消费）：session.next.prompted→turn.started；tool.called/input.delta/progress/success/failed→三原语；text.delta/reasoning.delta→part.delta；compaction.started/ended→session.compacting/compacted；permission.v2.*/question.v2.*→收编；session.error 按 MessageAbortedError 判别 aborted/failed；重叠 legacy 显式 drop（防双计）；孤儿族 drop。
- **transformEvent**（:214-229）：message.updated 载荷 `{info}` → flat `{message}`（零换名信封搬移）。
- 自适应：裸 `opencode` 经 `resolveEventEntry()`（契约:384）SSE 探测选 @v1/@v2（opencode-runtime.ts:280-290；fail-safe 恒 @v1）。

### ②.5 工具分类学（tool-classes.ts）

`TOOL_CLASS` 8 类（:14-22）：readonly / search / file-edit / shell / subagent / web / plan / other。并集单表 ~30 名（:25-41）；canonical 别名表（:48-61）：command_execution/powershell→bash、ls→list、find→glob、file_change→edit、collab_tool_call→task、web_search→websearch、todo_list→todowrite。查询链：runtime overlay 声明 → 静态表 → 已是 opencode 名 → undefined（不硬猜）。enrich 双出口（live `enrichToolIdentity` :95 / 历史 `enrichHistoryParts` :105）给 tool part 补 `toolClass` + `canonicalTool`（additive）。

### ②.6 工具合帧模型（tool-part-assembler.ts）

per-session、callID 键控状态机；三原语 → opencode 形状 ToolPart 快照（part.id = `toolpart_<callID>`，live/历史同 id 去重）；锚点缺失时合成 assistant 消息 `asst_<sid>_synth`（:80-91）。接线：`wrapToolPartAssembly` 在 wrapGlobalEventStream 之后（:173-192）；opencode 无三原语恒等直通。历史路径：契约可选 `session.normalizeMessages` 缺省恒等 + gateway 侧 `applyNormalizeMessages` 统一过。

---

## ③ MafwPart / MafwMessage 全形态（canonical-types.ts）

```ts
interface MafwMessage {                      // :23-39
  id?: string; sessionID?: string;
  role: 'user' | 'assistant';
  content?: MafwPart[];                      // 事件形态可缺省（parts 经 part.updated 单独流）
  time?: { created?: number; updated?: number; completed?: number };
  finish?: string;                           // runtime 原生 finish reason
  providerID?: string;                       // 平台特有字段全量同名透传（modelID/model 对象/agent/mode/summary 等不枚举）
  tokens?: Record<string, unknown>;          // trajectory/usage 主干
  cost?: number | Record<string, unknown>;
  parentID?: string;
}

interface MafwPartBase { id: string; sessionID?: string; messageID?: string }  // :41-45

type MafwPart =                              // :47-74
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; callID: string; tool: string;
      state: { status: 'pending' | 'running' | 'completed' | 'error';
               input?: unknown; raw?: string; output?: string; error?: string;
               title?: string; metadata?: Record<string, unknown>;
               time?: { start?: number; end?: number } } }
  | { type: 'file'; mime?: string; url?: string; filename?: string; [k: string]: unknown }
      // image 无独立变体：image/* mime 的 file（对齐 opencode FilePart 现实）
  | { type: 'step-start' }
  | { type: 'step-finish'; reason?: string; cost?: Record<string, unknown>; tokens?: Record<string, unknown> }
  | { type: string; [k: string]: unknown }   // 透传变体：subtask/snapshot/patch/agent/retry/compaction 等原样保留
```
守卫刻意宽松（结构校验非语义校验）：`isMafwPart` = id+type 均 string（:77-81）；`isMafwMessage` = role 合法 + content（若存在）为部件数组（:84-93）。内部管线一律 flat；wire 形状 `{info, parts[]}` 仅在 egress 出口经 `wire-compat.ts` 还原（toWireInfo/toWireHistory/toWireEventPayload——零换名、parts 引用直通、不造 id）。

---

## ④ 路由领域统计（route-catalog.ts，共 164 条）

> SDK_FACING_ROUTES 110 条（openapi.json 机械转录，:23-134）+ NON_SDK_ROUTES 54 条（:137-205）。文件头注释"94 条 operation"已过时（P5 Wave 2 反向审计补齐后为 110）。

| tag | 条数 | 覆盖 |
|---|---|---|
| internal | 54 | python 内核 3 / obs+recall 3 / memory 补充 5 / goal 编排 5 / media 补充 4 / dashboard 7 / gateway 控制（pause/resume/cancel/checkpoint/rollback）5 / mobile 8 / devices 3 / Wave2 补遗 8（agentCard、automations.history、goals.loopsAt、runtime.reload/dry-event/conformance、permissions.replyRuntime、session.deleteLegacy）/ eval+llm 2 / merge-memory 1 / health 1 |
| session | 29 | create/list/get/delete/rename/messages/todo/children/trajectory/token-summary/fork/revert/unrevert/diff/diff-revert/abort/summarize/prompt/promptAsync/command + usage 族 9 |
| permissions | 10 | list/reply/getMode/setMode/allowlist CRUD/rules CRUD |
| goals | 8 | list/get/sessions/timeline/retryNode/respondQuestion/validate/control |
| memory | 7 | search/mergedSearch/energy-distribution/L5 axioms/delete/sticky list/pin |
| media | 6 | plugins/switch/upload/uploadAndCreate/a2a createTask/artifact |
| plugins | 5 | list/install/enable/disable/delete |
| triage | 5 | list/dismiss/confirm/reject/propose |
| runtime | 5 | get/switch/restartAgent/config.get/config.update |
| tts | 4 | speak/voices/speakStream/interrupt |
| questions | 3 | list/reply/reject |
| automations | 3 | list/toggle/draft |
| project | 3 | list/current/setCurrent |
| chat / models / event / config / mafwCommands / manager / approvals / embedding / opencodeConfig | 各 2 | chat(send/enriched)、event(subscribe/publish)、config(get/set)、opencodeConfig(runtime-config 别名) 等 |
| skill / command / providers / agents | 各 1 | |

另：`session.command`（POST /api/session/:id/command，catalog :42）为 openapi 转录的悬空登记——gateway src 无 handler、SDK 未暴露方法（shadow 登记 Phase 3 前不参与 dispatch 的已知状态）。未登记（刻意）：/mcp（双传输端点）、/api/ws、dashboard SPA 静态资源、dashboard 内部子路由委托、/api/events?stream=true。

---
## ⑤ 14 项重点核查判定表

判定口径：HAVE = 契约字段/动词 + 至少一个 runtime 实现 + 消费面接通；PARTIAL = 契约存在但实现/暴露面/语义有缺口；ABSENT = 契约与实现均不存在。

| # | 领域 | 判定 | 证据（file:line） |
|---|---|---|---|
| 1 | 检查点/回滚（checkpoint/revert/rewind/undo/diff） | **HAVE** | 契约：`session.fork`（contract.ts:290-294）/ `revert`（:295-300，pi 语义弱=branch 移 leaf 不回滚文件）/ `unrevert`（:301-302，opencode-only）/ `diff`（:303-309）/ `vcs.{diff,apply}`（:310-317）。实现：opencode-adapter.ts:233-278。路由：session-branch.ts:33-66（sessionBranchApi 能力门 503）+ session-diff.ts:31-101（hunk 级反向回退 buildRevertPatch→vcs.apply）。另有 goal 层 checkpoint/rollback（dashboard/api.ts:223-235、recovery.ts——goal state 快照，非 runtime 契约）。TUI /undo /redo 消费 revert/unrevert |
| 2 | 子代理（subagent spawn/完成事件、agent 选择） | **PARTIAL** | 有：`session.children`（contract.ts:267，路由 index.ts:6089-6109）+ `SessionInfo.parentID`（contract.ts:171-172，"Task tool dispatches"）+ subagent 工具类（tool-classes.ts:36：task/subagent/agent/collab_tool_call）+ per-prompt `agent` 参数（contract.ts:117）+ identity turn 绑定（index.ts:5749-5751）+ `/api/agents` identity 合并。缺：无 subagent 生命周期 canonical 事件词汇（设计 §1 非目标——"子代理树 canonical 词汇 F6 已定 drop/延期"；dsh `subagent.*` 也是 drop 行）——派生会话仅经 session.created 广播 + parentID 事后识别；无 gateway 侧 subagent spawn 动词（派发是 runtime 内 Task tool 行为）；desktop P0-1 子代理生命周期面板已交付（subagent-tracker + sse/handlers/subagents.ts——纯 desktop 侧从既有事件推导，零词汇改动，pi 下恒空为合法态） |
| 3 | hooks/认知面（pre/post tool、prompt submit、注入上下文、改写输入） | **PARTIAL** | 有：HostAdapter 认知面四动词 observe/injectContext/injectSystem/tools（host-adapter.ts:9-17,28-34,137-198，loopback HTTP + 100ms/150ms fail-open 时序契约）——pi 经 pi-mafw-host-extension.ts、v1 opencode 插件原生实现（experimental.chat.messages/system.transform：注入 recall 指针 + memory-guide + pinned + agent-priors）。缺：RuntimeClient 契约**无** pre/post tool hook、prompt submit hook、输入改写动词——认知面动词全集就这四个，且全部是宿主→gateway 方向；gateway→runtime 方向无 hook 通知面。审批钩子（applyApprovalPolicy，hook.ts:11-45）是事件驱动 facet 而非 hook 动词 |
| 4 | 结构化输出（per-turn JSON Schema / outputSchema） | **PARTIAL** | 有：`CompletionRequest.responseFormat: {type:'json_schema', name, schema, strict?}`（contract.ts:230-238）——仅**无状态补全通道**；opencode 直连传输映射 OpenAI response_format，pi fail-open 忽略。缺：`SessionPromptOpts` **无** per-turn outputSchema（回合级 agentic 输出无结构化约束）；无 output_format/response_format 事件回传词汇 |
| 5 | per-prompt 模型/agent 切换 | **HAVE** | `SessionPromptOpts.agent` + `model:{providerID,modelID}`（contract.ts:117-118）；opencode 透传（adapter:110-121）；HTTP promptAsync 路由接收 agent/model（index.ts:5744）；identity 绑定（index.ts:5749）；desktop modelPicks/agentPicks + TUI /model；plan/build 三态切换（AGENTS.md §5.6 plan/build 切片）。模型切换事件 `session.next.model.switched`/`agent.switched` 被 drop（opencode-events.ts:53,176）——但切换本身随 part/消息持久化 |
| 6 | MCP 配置透传 | **PARTIAL** | 有：`config.get/update` 全量配置透传（contract.ts:328-331）——`/api/runtime-config` GET/PATCH（runtime-config-route.ts:12-47，旧名 /api/opencode-config 别名）可读写 opencode 的 mcp 段；claude adapter prompt 时 mcpServers 透传（adapters/claude/src/runtime.ts:96）；v1 插件 MCP 自接线（self-wiring）。缺：无一等 MCP 动词（无 per-session MCP server 注入、无 MCP server 生命周期/健康查询）；`mcp.tools.changed` 事件被 drop（opencode-events.ts:79） |
| 7 | 会话分享/导出/导入 | **ABSENT** | RuntimeClient 无 share/export/import 动词；route-catalog.ts 全表无对应端点。TUI `/export`（ui/export-chat.ts）是客户端本地 markdown 导出，非 gateway 契约能力 |
| 8 | 文件历史/diff 快照 | **HAVE** | `session.diff`（按 messageID 锚定的会话文件变更快照，contract.ts:303-309）+ `vcs.diff`（工作区/分支级）+ `session.diff` SSE 事件实时推送（event-flow-matrix.ts:66，desktop diff handler 填充 session_diff store）+ hunk 级选择性反向回退（session-diff.ts:72-101）。opencode v2 独有（diffApi 能力门，pi 503） |
| 9 | token 预算中途控制 / prompt caching 提示 | **PARTIAL** | 有：`maxTurns/maxCostUsd` 契约字段（contract.ts:129-132）+ `turnBudgetApi` 能力位（:49-50）+ gateway 侧 BudgetGuard（core/budget-guard.ts:16-51：step 切面计数 + TrajectoryStore 成本 → abort + noReply 通知）挂 goal 会话（index.ts:2229-2253 attachBudgetGuardForGoal，读 policySnapshot）+ `mafw_create_goal/set_goal` budget 参数。缺：① opencode adapter **不透传** maxTurns/maxCostUsd（adapter:110-121 无此二字段；SDK 无对应，contract.ts:74-77 注释确认 turnBudgetApi=false）；② HTTP promptAsync 面不接收预算字段（index.ts:5744）——**非 goal 的普通会话无预算控制**；③ prompt caching 提示仅 completion 通道 `system[].cacheable`（contract.ts:222，映射 DashScope cache_control ephemeral）+ xiaomi `setCacheKey` 配置（AGENTS.md §5.11）——session.prompt 通道无 caching 提示 |
| 10 | 来源引用（citation/source part） | **ABSENT** | MafwPart 无 source/citation 变体（canonical-types.ts:47-74）——仅有透传变体兜底（未知 type 原样保留）；websearch 结果经 tool part 呈现，无结构化引用 part |
| 11 | 多模态输出（TTS/图片生成 part） | **PARTIAL** | 有（工具协议层）：TTS 经 `mafw_media_speak` 返回文本标记 `[语音回复 art:<id> 音色:<v> h:<hash>]`（mafw-tools.ts:117-138，djb2 指纹供桌面去重播放）+ `/api/tts{,/stream,/interrupt}` 路由 + 打断传播；matplotlib 图经 mafw_python 附件（输出文本标注 `[生成 N 张图片]`，mafw-tools.ts:96）。媒体**输入**一等（file part image/video/audio，contract.ts:112-115 + pi mafw-media extension wire 注入）。缺：**输出侧**无原生 audio/image 生成 part 变体——语音/图片以文本标记协议或工件 URL 表达，非 canonical part 类型 |
| 12 | 后台任务/异步 turn（fire-and-forget + 事后查询） | **HAVE** | `promptAsync`（contract.ts:253，fire-and-forget）+ SSE 事件流事后跟踪（part.delta/message.updated 流式）+ `session.messages` 历史查询（分页游标 :154-158）+ busy 会话排队（promptWhileBusy 能力；pi followUp 队列；TUI queuedTurns/flushQueue）+ delivery steer/followup 投递时机。形态说明：无独立 task-handle 查询面（异步单元=会话回合而非 task id）。注：opencode v2.1.0 runtime 已有一等后台原语（shell/subagent 工具 `background?: boolean` + `GET /api/shell*` REST + `POST /api/session/:id/background` 全量转后台）——MAFW 契约未收编（无对应 RuntimeClient 动词），desktop P0-3 面板设计（2026-10-22-background-task-panel-design.md，待确认）从既有 part 元数据 + synthetic 消息推导，零契约改动 |
| 13 | usage/cost 事件粒度 | **HAVE** | `usage.updated` 事件（turn 粒度：tokens/cost/model/provider/turnID，index.ts:1296-1310 gateway 从 TrajectoryTurn 合成）+ `PromptResultEnvelope.usage {input,output,cached,reasoning,costUsd}`（contract.ts:144-150）+ step-finish part 携带 cost/tokens（canonical-types.ts:67-72，BudgetGuard/trajectory 主干）+ trajectory.event/trajectory.turn 广播 + `/api/usage` 分模型窗口统计（modelStats）。F3 修订（adapter 原生优先、gateway 兜底去重）：设计已定，claude adapter result.usage 已映射（adapters/claude/src/events.ts:105,184）；opencode 仍走 gateway 合成 |
| 14 | todo/plan 词汇的载荷形状 | **PARTIAL** | 有：`plan.updated` 词汇（原 todo.updated，event-flow-matrix.ts:60；@v1/@v2 表均透传 opencode-events.ts:49,163）+ `session.todo` 动词（contract.ts:266）+ plan 工具类（todowrite/todo_list→plan）+ ACP plan / codex todo_list 同域注释。缺：**载荷无 canonical schema**——properties 为 opencode todo.updated 原生形状原样透传（宽透传语义）；session-ui 渲染 todowrite 工具卡读 `input.todos`（Todo[]），plan.updated 事件载荷与工具卡数据不同源（事件面 vs part 面），无统一 Todo 载荷契约；SDK Todo 形状 = {id, content, status, priority}（packages/gateway-sdk/src/types.ts:231-236） |

### ⑤附 审批链路语义（manual/auto、预算、always）——判定表外补充

三档预设（policy-service.ts:15-17,63-131）：`read-only`（只读工具 readonly+search 自动放行，其余 human）→ `auto`（dangerous 正则 human；**25 次** auto-approve 预算（AUTO_APPROVE_BUDGET:16）耗尽自动回落 read-only + 广播 permission_mode）→ `full-access`（一律放行不计数）；legacy 'manual' 归一化 read-only（:20-23）。评估顺序：身份策略（identity policy deny/allow+internal，:64-88，先于 internal blanket-deny）→ 内部会话 auto-deny（:89-97）→ 持久规则/白名单（:99-102，`~/.mafw/permission-rules.json` + config allowlist 双读）→ 三档。`'always'` 语义（F4）：runtime 尽力持久，范围由 runtime 决定（opencode 原生规则 / pi session 级动态 allowlist / dsh 方言降级逐次——设计 §3.5）；两条 reply 路由 always 均自动沉淀持久规则（permission.ts:58-69，`persist: 'tool'|'prefix'|true` 粒度 + deriveAlwaysRule）。auto 应答器 applyApprovalPolicy（hook.ts:11-45）同步评估 → props.mafwPolicy 富化 → fire-and-forget permissionReply + 决策日志 jsonl（decision-log.ts，P1.5 校准数据）。

---

## ⑥ 设计-已审计 vs 实现 delta（对照 2026-10-21-runtime-canonical-v3-design.md）

### ⑥.1 设计要求 → 已实现（Phase 1 验收线全数落地）

| 设计目标 | 状态 | 证据 |
|---|---|---|
| G1 canonical v3 flat DTO + 24 词汇（+turn.started）+ tool.delta kind 扩展 | ✅ | canonical-types.ts 全文；mafw-vocabulary.ts:12-46；SDK events.ts:15-25；tool-part-assembler.ts:16-18 kind:'input'\|'output' |
| G2 platform@dialect 寻址（@v1/@v2 表 + 自适应探测 + config 钉死） | ✅ | opencode-events.ts:36/104 双表；opencode-runtime.ts:274-292 resolveEventEntry；opencode-dialect-probe.ts |
| G3 四方言落地（@v1 刷新/@v2 新建/pi 修复/claude 最小验收） | ✅ | pi-events.ts（F8 agent_start→turn.started :26-28；F1 stopReason 三分类 :81-97；N1 tool_execution 三原语 :44-48）；adapters/claude/{runtime,events,history}.ts（turn 三终态 :135-141、turn.started 合成 :214-223） |
| G4 内部 flat + egress shim 单点 | ✅ | wire-compat.ts（toWireInfo/toWireHistory/toWireEventPayload，唯一 {info,parts} 产地）；opencode-history.ts:17-26 默认 wire→flat |
| G5 核心清洗（去 opencode 化） | ✅ | handleRuntimeEvent 改名（index.ts:1148）；/api/runtime-config 新名+旧名别名（runtime-config-route.ts:42）；SQLite 直读挪进 opencode-runtime（:315-317）；auth 收编 credentials 动词（注入式 seam：media/plugin-context.ts:11-15、usage/plugin-context.ts:48-51） |
| G6 conformance 门禁（SDK 词表快照 + 方言套件 + file-plugin CLI） | ✅ | opencode-vocabulary-snapshot.test.ts（89 成员基线）；/api/runtime/conformance + dry-event（route-catalog.ts:194-195） |
| G7 pi 修复（F1/F8/N1/N2） | ✅ | pi-events.ts（见上）；N2 角色修复 :38-43 message.finish←stopReason |
| §3.5 契约修订：normalizeMessages 签名 + F3 所有权 + F4 always 注释 | ✅ | contract.ts:256-258 / :283-289 question / :269-277 三值注释 |

### ⑥.2 设计已审计但未实现（Phase 2 / 明确延期）

| 项 | 设计出处 | 现状 |
|---|---|---|
| codex adapter（app-server v2 JSON-RPC 面） | §3.3 定稿 spec 表；Phase 2 | ABSENT（代码）——审计文档 §2 有完整 from→to 表，npm @openai/codex-sdk 不可用已记 |
| dsh adapter（SDK stdio JSON-RPC，钉 master 提交） | §3.3；Phase 2 | ABSENT（代码）；'always' 降级逐次（F4）随 adapter |
| F2 codex BudgetGuard turn 计数模式（方言元数据声明） | §3.3 | ABSENT——codex 无 step 边界，需方言元数据声明降级模式 |
| N8 dsh approval callId join | §3.3 | ABSENT——随 dsh adapter |
| claude 完整版（认知面/审批：canUseTool/PermissionRequest/AskUserQuestion 合成、Elicitation 双路） | §4 Phase 2 | ABSENT——最小 adapter 只有事件+会话+工具注册 |
| Phase 2 egress shim 拆除（desktop/session-ui/gateway-sdk 切 flat + 版本化 wire 协商） | §4 | ABSENT——桌面仍消费 {info,parts}，shim 在位（wire-compat.ts） |
| opencode@v2 历史端点实测（新扁平端点可用则近恒等） | §4 Phase 2 | 未做——历史仍走 wire→flat 翻译 |
| opencode/pi demote 为 package plugin | §4 Phase 2 评估 | 未做——仍为内置（registerBuiltin） |
| @v1 方言 turn.started 合成 | §7⑥ 决议不做 | ABSENT（by design）——无消费方，待出现再议；@v2/pi/claude/dsh 均有原生源 |
| turn.started 消费方接线 | 矩阵 :42 | PARTIAL——词汇已在 union/矩阵/guard chain，desktop/tui 均 ignore |
| 子代理树 canonical 词汇 + revert.* canonical | §1 非目标（F6 定 drop/延期） | ABSENT——session.next.revert.* 事件族当前为 drop 行（opencode-events.ts:62,184）；子代理仅 parentID/children |
| 能力位新增 | §1 反目标 | 已遵守——v3 未加任何 RuntimeCapabilities 位 |

### ⑥.3 能力矩阵速览（两内置 runtime + claude 最小）

| 能力 | opencode | pi | claude(最小) |
|---|---|---|---|
| 事件流+方言翻译 | @v1/@v2 自适应 | PI_EVENT_MAPPINGS | translateClaudeEvent |
| 会话分支 fork/revert | ✅/✅(文件回滚) | ✅/✅(语义弱) | — |
| unrevert | ✅ | ❌（404） | — |
| diff/vcs | ✅ | ❌（503） | — |
| question API | ✅ | ❌ | —（Elicitation Phase 2） |
| turnBudget 原生 | ❌（BudgetGuard 兜底） | ❌（同左） | —（error_max_budget_usd 终态存在） |
| delivery steer | 忽略 | ✅ streamingBehavior | —（busy 排队） |
| expectReply:false | ✅ noReply | 降级+warn | — |
| 媒体输入 | file part 透传 | image 转换 + mafw-media wire 注入 | —（text-only prompt） |
| credentials | auth.json | auth.json 回退 | —（SDK 登录前置） |
| normalizeMessages | 默认恒等（wire→flat） | pi-message-normalize | normalizeClaudeHistory |

---

## 附：本次盘点的事实源文件清单

- 契约：`gateway/src/runtime/contract.ts`（402 行）、`canonical-types.ts`、`host-adapter.ts`
- 词汇/映射：`mafw-vocabulary.ts`、`event-flow-matrix.ts`、`opencode-events.ts`、`event-mapper.ts`、`canonical-facets.ts`、`normalize.ts`、`packages/gateway-sdk/src/events.ts`
- 工具面：`tool-classes.ts`、`tool-part-assembler.ts`、`mafw-tools.ts`、`routes/tools.ts`
- 实现：`opencode-adapter.ts`、`opencode-runtime.ts`、`opencode-history.ts`、`wire-compat.ts`、`runtime/pi/*`、`runtime/plugins/pi-runtime.ts`、`adapters/claude/src/*`
- 审批：`core/approval/{policy-service,hook,rules-store,safety-classifier,decision-log}.ts`、`routes/permission.ts`、`routes/permission-mode.ts`
- 路由：`routes/route-catalog.ts`（164 条）、`routes/{session-branch,session-diff,session-worktree,wave1-handlers}.ts`
- 预算：`core/budget-guard.ts`、`index.ts:2227-2253`（attachBudgetGuardForGoal）
- 插件上下文：`media/plugin-context.ts`、`usage/plugin-context.ts`
- 设计：`docs/superpowers/specs/2026-10-21-runtime-canonical-v3-design.md` + AGENTS.md §5.19