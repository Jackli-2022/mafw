# 四家 Agent 事件模型调研：Codex SDK / Claude Agent SDK / Kimi Code / Zed(ACP)

> 日期：2026-10-08。目的：为 MAFW gateway「声明式事件映射注册接口」（纯数据表：原生事件类型 → canonical 类型 + 字段构造 path/const/template + when 条件；canonical 词汇表沿用 opencode 形状；facet 规则表 gateway 拥有）提供佐证与反例。
> 标注：[实证] = 本次从官方文档/源码读取；[知识] = 基于既有知识、本次未能直接核实。

---

## 1. Codex SDK / codex app-server / codex exec --json

来源：`openai/codex` 仓库 main 分支源码 [实证]：`codex-rs/exec/src/exec_events.rs`、`codex-rs/app-server-protocol/src/protocol/{event_mapping.rs, v2/item.rs, v2/turn.rs, v2/permissions.rs}`、app-server README。developers.openai.com 本次 403，app-server README 的协议基础章节未能取到（README 现以 API 变更注记为主），approval 方法名以源码为准。

### 1.1 事件面是双层的

- **exec --json（非交互，JSONL over stdout）**：顶层信封 `{"type": "<name>", ...}`，serde `tag = "type"` [实证]。事件清单（完整）：
  - `thread.started` `{thread_id}`
  - `turn.started`（空载荷）、`turn.completed` `{usage: {input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens}}`、`turn.failed` `{error: {message}}`
  - `item.started` / `item.updated` / `item.completed` `{item: ThreadItem}`
  - `error`（流级致命错误）
  - ThreadItem 变体（`type` 标签 + flatten 字段）：`agent_message`/`reasoning`/`command_execution`/`file_change`/`mcp_tool_call`/`collab_tool_call`/`web_search`/`todo_list`/`error`，各自带状态枚举（in_progress/completed/failed/declined）。
- **app-server（JSON-RPC 2.0，线程长驻）**：通知 + 服务端→客户端请求。通知（[实证]，v2 模块）：`thread/started`、`turn/started`/`turn/completed`（`{thread_id, turn: Turn}`，Turn 含 status 与 usage）、`turn/diff/updated`、`turn/plan/updated`、`thread/tokenUsage/updated`、`item/started`/`item/completed`、以及**按 part 类型分开的 delta 通知**：`item/agentMessage/delta`、`item/plan/delta`、`item/reasoning/summaryTextDelta`（带 `summaryIndex`）、`item/reasoning/textDelta`（带 `contentIndex`）、`item/reasoning/summaryPartAdded`、`item/commandExecution/outputDelta`、`item/fileChange/patchUpdated`、`item/terminalInteraction`。
- app-server 的 ThreadItem（v2，比 exec 宽）：UserMessage / HookPrompt / AgentMessage / FunctionCallOutput / Plan / Reasoning / CommandExecution / FileChange / McpToolCall / DynamicToolCall / CollabAgentToolCall / SubAgentActivity / WebSearch / ImageView / Sleep / ImageGeneration / EnteredReviewMode / ExitedReviewMode / **ContextCompaction**。

### 1.2 approval/permission 的表达 [实证]

**不是事件，而是 server→client 的 JSON-RPC request**（阻塞等待 response），且按被审批对象拆成三个不同方法：

- `item/commandExecution/requestApproval`：params 含 `kind: command|writeStdin`、`approvalId`（子审批消歧）、`reason`、`networkApprovalContext {host, protocol}`、`command/cwd/commandActions`、`proposedExecpolicyAmendment`（服务端直接给出"批准并沉淀规则"的规则文本）、`proposedNetworkPolicyAmendments[]`、`availableDecisions[]`（服务端声明客户端可呈现的决策集）；response = `{decision}`（accept / acceptForSession / acceptWithExecpolicyAmendment / decline / cancel 等 [知识：决策枚举具体成员]）。
- `item/fileChange/requestApproval`：`{threadId, turnId, itemId, reason, grantRoot}`。
- `item/permissions/requestApproval`：`{reason, permissions: RequestPermissionProfile{network, fileSystem}}`，response = `{permissions: GrantedPermissionProfile, scope: turn|session}`——**批准载荷是"授予的权限 profile"，不是布尔**。
- 另有 `item/tool/requestUserInput`（结构化问答：questions[{id, header, question, options[], isOther, isSecret}]，is_blocking）与 Guardian 自动审核通知 `item/autoApprovalReview/started|completed`（风险等级 + rationale，机器先审、人兜底）。

### 1.3 会话生命周期与 delta 双模

- 生命周期：thread/started → turn/started → item 事件流 → turn/completed（`TurnStatus = completed|interrupted|failed|inProgress`）。exec 侧无独立 idle 事件，turn.completed 即回合边界。
- **双模**：exec --json 只有 item 快照（无 token 级 delta）；app-server 同时有 `item/updated` 快照与 per-part delta 通知。delta 按 part 类型分发且带 `itemId` 关联。

### 1.4 对本设计最直接的证据

`codex-rs/app-server-protocol/src/protocol/event_mapping.rs` [实证] 是 codex 官方自己的"核心事件 → 对外通知"映射层，其 doc comment 原文：

> *"This only covers the stateless event-to-notification projections that have a one-to-one mapping. Callers remain responsible for any surrounding state checks or side effects before invoking this helper."*

即：codex 自己也把映射分成**无状态一对一投影**（可数据化）与**带状态检查/副作用的路径**（不可数据化）。且同文件显示 `ExecCommandBegin` → `item/started` 需要 `build_command_execution_begin_item()` 这种**有解析计算**的构造器（解析命令、生成 presentation），`CollabAgentSpawnEnd` 需要从嵌套 status 推导 CollabAgentToolCallStatus——纯 path/const/template 表表达不了"构造器函数"，必须有代码逃逸口。

---

## 2. Claude Agent SDK（TypeScript）

来源：code.claude.com 官方 Agent SDK TypeScript 参考文档 [实证]（2026-10 当前版，SDK v0.3.x / Claude Code v2.1.x）。

### 2.1 SDK message 类型清单（SDKMessage union，[实证]）

信封：`type` + 多数有 `subtype` + `session_id` + `uuid` + `parent_tool_use_id`（子代理归属）。

- `system` `subtype:"init"`：能力/模型/tools/plugins/账号快照（capabilities 数组驱动客户端特性开关，如 `interrupt_receipt_v1`）
- `assistant` / `user` / `user_replay`（外部注入 turn 的回放，带 `origin: {kind: human|peer|channel|task-notification}`）
- `result` `subtype: success | error_max_turns | error_during_execution | error_max_budget_usd | ...`——**回合结束与错误合并在同一类型，靠 subtype 区分**；带 usage/cost/permission_denials 汇总
- `stream_event`（SDKPartialAssistantMessage，`includePartialMessages` 才发）：**直接透传 Anthropic 原始 SSE**——`{type:"stream_event", event: {type:"message_start"|"content_block_delta"|...}}`，是嵌套枚举（二级 type）；`ping` 帧也走此通道当 liveness
- `system` 其他 subtype：`compact_boundary`、`informational`、`status`、`local_command_output`、`conversation_reset` 等
- hook 生命周期（`includeHookEvents` 才发，SessionStart/Setup 恒发）：`hook_started` / `hook_progress` / `hook_response`
- 任务/子代理：`task_started` / `task_progress` / `task_updated` / `task_notification` / `background_tasks_changed`
- 其他：`tool_use_summary`、`tool_progress`、`auth_status`、`permission_denied`（best-effort 事件；权威记录是 result 的 permission_denials 汇总）、`thinking_tokens`、`session_state_changed`、`files_persisted`、`rate_limit`、`commands_changed`、`prompt_suggestion`、`worker_shutting_down`、`plugin_install`

### 2.2 hooks 与 SDK message 是两套事件 [实证]

- **hooks**：宿主进程外扩展点，事件名 22 个：PreToolUse / UserPromptSubmit / UserPromptExpansion / SessionStart / Setup / PreModelSwitch / PostModelSwitch / SubagentStart / PostToolUse / PostToolUseFailure / PostToolBatch / Stop / SubagentStop / PermissionDenied / Notification / PermissionRequest / Elicitation / ElicitationResult / CwdChanged / FileChanged / WorktreeCreate / MessageDisplay。回调返回 JSON 决策（allow/deny/ask/改写输入/追加上下文）。
- **SDK message**：消息流。两者关系：hook 生命周期被**可选地**投影进消息流（hook_started/progress/response），Notification/SessionEnd/PreCompact 等永不产生 hook_started。即"同一物理事件，两套词汇表，可配置的投影"。

### 2.3 permission：canUseTool 回调 [实证]

不是事件而是**入站回调**（control_request/control_response over transport）：

```ts
canUseTool(toolName, input, { signal, suggestions?: PermissionUpdate[],
  blockedPath, mcpServer, decisionReason, defaultToNo, suppressAlwaysAllowRule,
  toolUseID, agentID, requestId }) → PermissionResult
PermissionResult = { behavior:"allow", updatedInput?, updatedPermissions?: PermissionUpdate[] }
                 | { behavior:"deny", message, interrupt? }
```

值得注意的花样：①**allow 可携带 updatedInput 改写工具输入**（比"批准原样执行"强）；②`suggestions` 是服务端建议的持久化规则（可写回 settings.local.json，即"记此规则"由服务端起草）；③`defaultToNo`/`suppressAlwaysAllowRule` 是给 UI 的行为提示字段；④`permissionPrompts: 'none'` 时提示路径直接变成 deny 并走 `permission_denied` 事件报告——**approval 在配置下会退化为纯出站事件**。

### 2.4 会话生命周期等价物

无 idle 类型；`result`（subtype success/error_*）= 回合结束；`conversation_reset`、`compact_boundary` 覆盖压缩边界；中断经 `interrupt()` 控制方法 + `interrupt_receipt` 响应（列出 still_queued/cancelled）。

---

## 3. Kimi Code（moonshotai.github.io/kimi-code）

注意：旧 Python `kimi-cli` 已归档，现行产品是 `MoonshotAI/kimi-code`（TS，MIT，2026-09 换代）。它有**三个事件面**，正好是多宿主归一化的活样本。

### 3.1 ACP 面（`kimi acp`）[实证]

- 实现 ACP v1 的 agent 侧全量：core 3/3、session 11/11（含 session/fork/resume/list/delete 扩展面）；client 反向 RPC 10/11（session/update、session/request_permission、fs/*、terminal/*、elicitation/create；elicitation/complete 未实现）。
- `session/update` 的 update 变体（ACP schema）：`user_message_chunk` / `agent_message_chunk`（可带 messageId 归并）/ `agent_thought_chunk` / `tool_call` / `tool_call_update`（status: pending→in_progress→completed）/ `plan`（entries: content/priority/status）/ `available_commands_update` / `current_mode_update` / `config_option_update` / `session_info_update` / `usage_update`（used/size/cost）。
- 回合边界不靠事件：`session/prompt` 的 **JSON-RPC 响应**携带 `stopReason`（end_turn/max_tokens/max_turn_requests/refusal/cancelled）——**turn 结束是请求响应而非通知**。
- permission：`session/request_permission` 反向 RPC，options[] 由 agent 自定义（allow once/always/reject 只是惯例标签）。

### 3.2 Server API 面（`kimi web` 的 WebSocket `/api/v1/ws`）[实证]

比 ACP 丰富得多，词汇接近 MAFW SSE：

- 回合/步：`turn.started` / `turn.ended` / `turn.step.started|completed|interrupted|retrying`
- 流式：`assistant.delta` / `thinking.delta`（**带 `offset` 累积字符偏移**，消费方据此去重/检测缺口）；`tool.call.started` / `tool.call.delta` / `tool.progress` / `tool.result`
- 审批/问答（一等交互类型，双形态）：`event.approval.requested|resolved`、`event.question.requested|answered|dismissed`；同时有 REST 拉取 pending 列表。approval item 形状 `{approval_id, session_id, agent_id, turn_id?, tool_call_id, tool_name, action, tool_input_display, created_at, expires_at}`——**审批会过期（24h → 41001）**；resolve 时 scope=session 会把规则记入本会话。
- 全局事件：`session.meta.updated` / `event.session.created|archived|work_changed|status_changed` / `event.workspace.*` / `event.config.changed`（带 changedFields + 全量投影）/ `event.model_catalog.changed`。
- **durable vs volatile 分级**：durable 事件带严格递增 `seq`、可日志回放；volatile（`*.delta`、`tool.progress`、`shell.*`）标记 `volatile: true` 永不回放。**subscribe_v2 分级订阅**：per-agent `off/turn/block/delta` 粒度，改走 `transcript.reset`（基线快照）+ `transcript.ops`（增量 op 批，per-agent seq），断线用 `transcript_since` 续传，覆盖不了就全量刷新。

### 3.3 hooks 面（与 ACP 事件并存）[实证]

Claude Code 形状：`[[hooks]]`（event + matcher 正则 + command + timeout），stdin 传 JSON（hook_event_name/session_id/cwd/工具字段），exit 0=allow / 2=block / 其他 fail-open。事件：UserPromptSubmit、UserPromptQueued、PreToolUse、Stop、TurnStarted（带 origin_kind）、PostToolUse、PostToolUseFailure、PermissionRequest、PermissionResult、SessionStart、SessionEnd、SessionHeartbeat、SubagentStart、SubagentStop、TaskStarted、StopFailure、Interrupt、PreCompact、PostCompact、Notification。仅 PreToolUse/Stop/UserPromptSubmit 可阻塞，其余纯观察。

---

## 4. "zcode" = Zed 编辑器（确认为 Zed；ACP client 视角）[实证]

来源：zed.dev/docs/ai/external-agents。Zed 自己不定义 agent 事件词汇，而是 **ACP client**：agent 以子进程 stdio 运行，Zed 消费 `session/update` 通知、应答 `session/request_permission`、提供 `fs/read_text_file|write_text_file` 与 `terminal/*` 反向能力。调试面：`dev: open acp logs` 看原始 JSON-RPC。要点：

- **能力协商驱动 UI**：`initialize` 交换 clientCapabilities（fs/terminal/terminal-auth）与 agentCapabilities（loadSession/promptCapabilities.image/audio/embeddedContext/session 扩展面），客户端按能力裁剪 UI——事件词汇表之外，**能力位是归一化契约的一部分**。
- **ACP 的归一化哲学**：JSON-RPC 2.0；`sessionUpdate` snake_case 判别字段；扩展走 `_meta` 字段 + `_` 前缀方法 + 能力协商；新增 update 变体要进官方 schema。Kimi 的 ACP 实现（3.1）证明这套中立词汇表足够承载真实 agent，但 Kimi 自己的 Server API（3.2）远比 ACP 丰富——**中立化 = 最小公分母，必然有损**。

---

## 5. 对本设计（声明式事件映射表）的校验

### 5.1 能纯数据映射的（表足够表达）

| 原生形状 | canonical | 说明 |
|---|---|---|
| codex `thread.started` / kimi 会话创建 / ACP session/new 响应 | session.created 类 | path 提取 id 即可 |
| codex `item/agentMessage/delta` / kimi `assistant.delta` / ACP `agent_message_chunk` | message.part.delta | 字段构造 path+const；kimi 的 offset、codex 的 itemId、ACP 的 messageId 都是 part 关联字段的直接来源 |
| codex `turn.completed` / claude `result` / kimi `turn.ended` / ACP session/prompt 响应 stopReason | session.idle（+usage 载荷） | ACP 的 turn 结束在请求响应里——**提示映射表输入源不能只有"事件流"，请求响应也要能走同一张表** |
| codex `turn.failed`/`error` / claude `result.subtype=error_*` / kimi StopFailure | session.error | claude 需要 when 条件按 subtype 区分 success vs error——**同一原生类型按子字段路由到不同 canonical，when 已覆盖** |
| codex `item.commandExecution` 生命周期 / kimi `tool.call.*` / ACP `tool_call`+`tool_call_update` | message.part.updated（tool part） | status 枚举值映射用 const 表 |
| claude `compact_boundary` / codex `ContextCompaction` item / kimi PreCompact/PostCompact | compaction start/end | codex 是 item 变体（when on $.item.type），claude 是 subtype |
| kimi `event.config.changed` / codex `account/updated` / claude `session_state_changed` | 配置/状态类广播 | 简单 |

### 5.2 需要逃逸口的（表表达不了，佐证"必须留代码路径"）

1. **构造器函数型**：codex `ExecCommandBegin` → item 需要解析命令、组装 presentation（`build_command_execution_begin_item`）；`CollabAgent*End` 要从嵌套 status 推导聚合状态。codex 官方 event_mapping.rs 自己声明"只覆盖无状态一对一投影，状态检查与副作用由调用方负责"——**这是四家调研里对本设计最强的佐证：连 codex 都无法把映射层做成纯数据，逃逸口不是设计缺陷而是行业共识**。
2. **状态机/聚合型**：claude `permission_denied` 是 best-effort 事件、权威在 result 汇总——映射需"事件 + 终态汇总对账"；kimi approval 的 pending 列表（REST）与 requested/resolved 事件双通道对账；ACP `session/load` 历史回放复用 session/update——回放与实时同一事件类型，需要 when 区分或消费侧幂等。
3. **ID 物化/关联型**：claude `stream_event` 里 `content_block_delta.index` 到 part id 的物化（index → id 需要会话内状态表）；ACP messageId 可选（缺省时客户端要自己归并 chunk）。
4. **嵌套枚举二级分发**：claude `stream_event.event.type`（Anthropic SSE 类型藏在第二层）。映射表的 when 必须支持嵌套路径判别（`when: $.event.type = 'content_block_delta'`），这对"一层 type 标签"的假设是个修正。
5. **入站请求型事件**：codex 的 approval 是 server→client JSON-RPC **request**（要回 response），claude canUseTool 是入站回调，ACP request_permission 是反向 RPC——approval 事件天然是"请求-响应"对，纯"通知映射"表需要表达 pending 登记 + 应答回写两步。

### 5.3 canonical 词汇表缺口（opencode 词汇表没覆盖的语义）

| 缺口 | 证据 |
|---|---|
| **usage/cost 更新事件** | ACP `usage_update`（used/size/cost 一等变体）；codex `thread/tokenUsage/updated`；kimi turn.ended 携带。我们只有 message.updated 内嵌 tokens，独立类型值得加 |
| **plan 更新事件** | ACP `plan`；codex `turn/plan/updated` + `Plan` item + exec `todo_list` item；三家都有 |
| **question/elicitation 一等事件**（区别于 permission） | kimi `event.question.*`（与 approval 并列的 pending-interaction）；ACP `elicitation/create`；codex `item/tool/requestUserInput`；claude `Elicitation` hook + onElicitation。**四家都把"问用户结构化问题"与"批准工具"分成两种交互**，我们的 permission.asked 单一通道可能过窄 |
| **subagent / 后台任务生命周期** | claude task_started/progress/updated/notification/background_tasks_changed；codex CollabAgentToolCall/SubAgentActivity；kimi TaskStarted/SubagentStart hooks |
| **子项 part 类型的 status 事件与 delta 的区分** | codex 每类 part 一个 delta 通知（reasoning summary vs raw text 还分开带 index）——message.part.delta 需要 part 子类型字段承接 |
| **config/workspace/account 域广播** | kimi `event.config.*`/`event.workspace.*`、codex `account/updated`——gateway 级事件，非 session 域 |

### 5.4 approval 形状的新花样（超出已处理的"双形状对齐"）

1. **批准载荷不是布尔**：codex `permissions/requestApproval` 的响应是"授予的权限 profile + scope(turn/session)"；`commandExecution` 的响应决策可以是 `acceptWithExecpolicyAmendment`——**服务端起草持久化规则文本**（比我们 reply 侧 persist 推导粒度更准，值得借鉴：让 runtime 在 asked 事件里携带"建议规则"，reply 直接采纳）。
2. **服务端声明决策集**：codex `availableDecisions[]`（客户端按列表渲染按钮，而不是客户端硬编码 approve/decline）；ACP `session/request_permission` 的 options[] 同理。**permission.asked 载荷应有可选的 options 数组**。
3. **批准可改写输入**：claude `PermissionResult.allow.updatedInput`——审批响应能修改工具参数。
4. **审批会过期**：kimi approval `expires_at`（24h，过期 41001）+ `event.approval.resolved` 对账事件。
5. **审批可被配置短路成事件**：claude `permissionPrompts:'none'` 时提示路径消失、只发 `permission_denied` 出站事件——映射表需容忍"同一语义，有时是会话内请求、有时是事后事件"。
6. **机器预审双阶段**：codex Guardian `item/autoApprovalReview/started|completed`（risk level + rationale）在人审批之前/并行——approval 生命周期不止 asked/replied 两步。

### 5.5 delta 事件的形状差异与承接能力

| 来源 | delta 形状 | 承接 |
|---|---|---|
| codex app-server | 每 part 类型一个通知类型（agentMessage/plan/reasoning summary/reasoning raw/commandOutput/filePatch），带 threadId+turnId+itemId | message.part.delta + part 子类型字段，纯表可映射 |
| kimi WS | `assistant.delta`/`thinking.delta` + **offset 累积偏移**（去重/缺口检测靠它）+ volatile 标记 | 可映射；offset/volatile 建议进 canonical 载荷 |
| ACP | `agent_message_chunk`/`agent_thought_chunk` + 可选 messageId | 可映射；messageId 缺省时需逃逸口做归并 |
| claude | `stream_event` 嵌套 Anthropic SSE（message_start/content_block_start/delta/stop，index 关联） | 需嵌套 when + index→partId 物化逃逸口；或映射为粗粒度"忽略 token 级、只取 message_stop 后快照"的降级策略 |
| codex exec --json | **无 delta**（只有 item 快照） | 天然适配快照型消费；说明映射表要容忍"该 runtime 无 delta 能力"（能力位） |

### 5.6 值得借鉴的归一化机制（超出事件表本身）

1. **Kimi 的 durable/volatile 分级 + seq**：durable 事件严格递增 seq 可回放补漏，delta 类 volatile 不回放——直接对应我们 SSE 三端（desktop/TUI/plugin）消费的可靠性问题；`subscribe_v2` 的 per-agent 分级订阅（off/turn/block/delta）更进一步：**让消费方声明要的事件粒度，网关按粒度裁剪**，省带宽且降复杂度。
2. **Kimi 的 offset 对齐协议**：volatile 文本流带累积 offset，消费方比对本地长度检测缺口并触发快照恢复——比"尽力送达"严谨。
3. **ACP 的能力协商**：事件词汇表之外用 capability 位声明"我支持 session/fork 吗、terminal 吗"——我们的 RuntimeCapabilities 已是同构设计，ACP 证明这是行业标准做法；其 `_meta`/`_` 前缀扩展机制可借鉴为我们 canonical 载荷的 `experimental` 字段约定。
4. **Claude 的"hook 生命周期可选投影进消息流"**（includeHookEvents）：观测面与控制面合一但默认可关——我们的 obs/capture 与事件流可以考虑同样的可开关投影。
5. **ACP 的反面教训**：中立词汇表 = 最小公分母（Kimi Server API 远比其 ACP 面丰富）。**佐证我们"canonical 沿用 opencode 形状而非新造中立词汇"的决策**：opencode 词汇信息量更高，代价是别家 runtime 映射时部分字段为空——用可选字段 + 能力位表达，而不是削足适履。

### 5.7 结论

- **设计方向被佐证**：四家中没有任何一家能把事件归一化做成纯配置——codex 官方的 event_mapping.rs 明确把"无状态一对一投影"与"带状态/副作用的路径"分层，我们的"纯数据表 + facet 规则表 gateway 拥有 + 代码逃逸口"三层结构与之同构。
- **表的能力下限**（从反例推出）：必须支持 ①嵌套路径 when（claude 二级 type）；②同一原生类型按子字段路由到不同 canonical（claude result subtype、codex item.type）；③输入源含"请求响应"（ACP stopReason、approval 应答）；④能力位门控（该 runtime 无 delta / 无原生 approval 时整组规则关闭）。
- **canonical 词汇表建议新增**：usage 更新、plan 更新、question（与 permission 并列）、subagent/task 生命周期四类；permission.asked 载荷建议加 `options[]`（服务端声明决策集）与 `suggestedRule`（服务端起草的持久化规则）。
- **超出事件表的借鉴**：Kimi 的 durable seq / volatile / offset / 分级订阅，是三家（含我们）多客户端消费的公共痛点的最完整答案。
