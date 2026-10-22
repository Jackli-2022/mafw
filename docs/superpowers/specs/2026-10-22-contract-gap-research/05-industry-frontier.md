# 05 · 业界前沿能力横扫（Industry Frontier Capability Scan）

- **日期**：2026-10-22
- **任务**：超越单一 SDK 的跨行业能力趋势扫描，判定 MAFW gateway 契约相对业界前沿的缺口
- **对照基线**：MAFW gateway 契约（消息 DTO / 事件 / Runtime 动词，见研究总纲）
- **判定档位**：`已成标准`（进入稳定规范或多供应商稳定实现）/ `主流采用`（头部产品普遍落地但未进中立规范）/ `早期探索`（草案、beta、RFD）
- **判定值**：HAVE（契约已覆盖）/ PARTIAL（部分覆盖或仅设计未实现）/ MISSING（完全缺失）
- **价值**：高/中/低 —— 对 MAFW "多 runtime 统一契约" 使命的前沿价值

> 来源均为 2026-10-22 实测抓取。规范类标注版本号/日期，产品类标注 changelog/发布日期。

---

## 1. ACP（Agent Client Protocol）

### 现状（谁、什么版本）

- 治理：已从 `zed-industries/agent-client-protocol` 迁出到独立组织 `agentclientprotocol`，设 RFD（Requests for Dialog）流程、Working/Interest Groups、Lead Maintainer（Sergey Ignatov）；Rust/TS SDK 达 1.0（来源：https://agentclientprotocol.com/announcements/sdk-1-0-releases.md 、https://agentclientprotocol.com/community/governance.md）
- **v1 稳定面**：session CRUD（new/load/resume/list/delete/close）、prompt、cancel、set_mode、set_config_option、request_permission；大量特性经公告"stabilized"：elicitation、message ID、session usage、session list/delete/close/resume、session config options、boolean config options、request cancellation、tool call name、session info update、additional directories、ACP Agent Registry（来源：https://agentclientprotocol.com/llms.txt 各 announcement 条目）
- **v2 草案**（2026 内发布 draft）：prompt 生命周期重设计、upsert 语义、客户端 fs/terminal 移除、枚举前向兼容（来源：https://agentclientprotocol.com/protocol/v2/migration.md ，公告 "ACP v2 is available in Draft"）
- 生态：Zed 之外，Claude Code（`--acp`）、Copilot CLI（`copilot --acp`）、Gemini CLI、Goose 等均已实现或适配 ACP（佐证：github.com/github/copilot-cli issue #1218 提及 `copilot --acp`，2026-01；ACP Registry 已 stabilized）

### 关键概念

1. **SessionUpdate 全集**（v1）：`user_message_chunk` / `agent_message_chunk` / `agent_thought_chunk`（均带可选 messageId）/ `tool_call` / `tool_call_update` / `plan` / `available_commands_update`（slash 命令发现）/ `current_mode_update` / `config_option_update` / `session_info_update`（标题/时间戳/元数据）/ `usage_update`（used/size + cost{amount,currency ISO-4217}）/ `notice`（非历史、severity info|warning|error 的瞬态通知）/ `compaction_update` + `compaction_summary_chunk`（**ID 寻址的持久压缩实体**：status in_progress|completed|failed|cancelled，summary/error 三态 patch）（来源：https://agentclientprotocol.com/protocol/v1/prompt-turn.md ）
2. **ToolCall 模型**：`toolCallId / title / kind / status(pending|in_progress|completed|failed) / content / locations / rawInput / rawOutput`；**ToolKind 分类学**：`read|edit|delete|move|search|execute|think|fetch|switch_mode|other`，用于客户端选图标与进度呈现（来源：https://agentclientprotocol.com/protocol/v1/tool-calls.md ）
3. **StopReason 分类**：`end_turn | max_tokens | max_turn_requests | refusal | cancelled`（v2 增加 `error`）（来源：prompt-turn.md）
4. **Permission 模型**：`session/request_permission` 携带 options[]（optionId/name/**kind: allow_once|allow_always|reject_once|reject_always**）；取消时必须以 `cancelled` outcome 应答（来源：tool-calls.md）
5. **Session Config Options**（取代 modes）：动态配置选项，`category = mode | model | model_config | thought_level`，select/boolean 两型，`session/set_config_option` 返回**完整**配置状态（联动变化），Agent 可经 `config_option_update` 主动变更（如限流降级换模型）（来源：https://agentclientprotocol.com/protocol/v1/session-config-options.md ）
6. **Elicitation**（已 stabilized）：form mode（受限 JSON Schema：扁平对象+原始类型+单/多选枚举+默认值）+ **url mode**（敏感数据/出站 OAuth，客户端必须展示完整 URL 并获同意，accept/decline/cancel 三态，elicitationId + `elicitation/complete` 完成通知）（来源：https://agentclientprotocol.com/protocol/v1/elicitation.md ）
7. **v2 语义升级**：① `session/prompt` 响应只确认**插入**（返回 messageId），turn 完成/失败/取消全部移入 `state_update` 通知（`running|idle|requires_action` + stopReason + error）；② 一切更新为 **upsert**（省略=不变 / null=清除 / 值=替换，chunk 追加）；③ `tool_call` 与 `tool_call_update` 合并为单一 upsert + `tool_call_content_chunk`；④ 新 diff 内容块（`changes[]` 操作级 + `patch{format:git_patch}`）；⑤ Agent 自有终端显示流（`terminal_update` + base64 `terminal_output_chunk` + 权威快照）；⑥ 客户端 fs/terminal 执行面删除，改由**客户端提供 MCP server** 承载；⑦ 枚举/带标签联合前向兼容（`_` 前缀自留）；⑧ 后台工作与前台生命周期分离（idle 后后台活动可继续发通知）；⑨ `session/resume` 带 `replayFrom` 游标（start | 未来 from-point 变体）（来源：migration.md）
8. **RFD 管道**（正在成型的面）：session fork、**subagent sessions**（agent 创建的子代理暴露为受限 ACP 会话 + 会话定向消息 + per-child cancel）、MCP-over-ACP、客户端注入 system prompt、自定义 LLM provider（`providers` 能力）、Streamable HTTP/WebSocket 传输、end-turn token usage（来源：https://agentclientprotocol.com/rfds/ 列表）

### 对 MAFW 契约的判定

| # | ACP 能力 | MAFW 判定 | 说明 |
|---|---|---|---|
| 1 | 消息分块流（chunk + messageId） | **HAVE** | part.delta/updated/complete + message.updated 语义等价 |
| 2 | ToolKind/title/locations 工具呈现元数据 | **MISSING** | MafwToolPart 快照有 state/input/output/error，无 kind/title/locations |
| 3 | Permission 四值（含 reject_always） | **PARTIAL** | permissionReply(once\|always\|reject) 缺 reject_always（"永久拒绝"） |
| 4 | StopReason 分类 | **PARTIAL** | turn.completed/failed/aborted 有，但无 end_turn/max_tokens/max_turn_requests/refusal 细分，上层无法区分"模型拒答"与"配额截断" |
| 5 | Session Config Options（model/thought_level/model_config） | **PARTIAL** | 仅 permission_mode 一项；模型选择、思考深度等级均不在契约 |
| 6 | Elicitation url mode | **MISSING** | question.asked 仅 in-band 表单，无出站 URL 交互 |
| 7 | Slash 命令发现（available_commands_update） | **MISSING** | 无命令广播面 |
| 8 | Compaction 实体（ID 寻址 + summary 内容 + failed/cancelled） | **PARTIAL** | 有 compacting/compacted 两事件，无 summary 内容回传与终态分类 |
| 9 | usage 含 cost/currency | **PARTIAL** | usage.updated 存在，cost 语义未定义（对照 maxCostUsd 入参只有单向） |
| 10 | notice（瞬态非历史通知） | **MISSING** | 无独立通知通道；只能占用 assistant 消息 |
| 11 | resume replay 游标 | **PARTIAL** | 历史 normalize 恒 flat 是全量回放；无 replayFrom 增量游标 |
| 12 | 前台状态机 state_update（requires_action 聚合态） | **MISSING** | turn.* 是请求级事件，无会话级聚合"等待用户"状态，多并发交互时上层需自行推导 |
| 13 | fork | **HAVE（领先）** | fork(sessionID,messageID) 已是动词；ACP 仍处 RFD |
| 14 | steer（排队注入） | **HAVE（领先）** | prompt(delivery:'steer')；ACP v2 明言 queued-work 是"未来流程" |

### 若要支持需要的契约面（一句话草案）

- 工具呈现元数据：`registerTool` DTO 增加 `annotations{readOnlyHint,destructiveHint,idempotentHint,openWorldHint}`、`kind`、`title`、`icons`，tool part 快照透传
- 配置选项：新增 `session.config` 事件族 + `setConfigOption(sessionID, configId, value)` 动词，configId 按 `mode|model|model_config|thought_level` 分类
- StopReason：`turn.completed` 增加 `stopReason` 枚举字段（保持向后兼容：缺省 end_turn）
- URL elicitation：`question.asked` 载荷增加 `mode:'form'|'url'` + url/elicitationId，`question.rejected` 扩展 decline/cancel 语义
- 瞬态通知：新增 `notice` 事件（severity+title+description，不入历史）
- Compaction 实体：`session.compacted` 载荷带 `compactionId + status + summary:MafwPart[]`

### 前沿价值

**高** —— ACP 是与 MAFW 定位最接近的中立协议（client↔agent 网关层），其 v1 稳定面即"多客户端互操作最低集"，v2 草案是 12-18 个月内的演进方向标。

---

## 2. MCP 规范（最新版 2026-07-28）

### 现状（谁、什么版本）

- 版本线：`2025-06-18` → `2025-11-25`（一周年版）→ **`2026-07-28`（当前 stable，2026-07-28 发布）**；Tier 1 SDK（TS/Python/Go/C#）当日同步 v2.0+（来源：https://modelcontextprotocol.io/specification/2026-07-28/changelog 、https://blog.modelcontextprotocol.io/posts/2026-07-28/ 、.NET 博客 2026-07-28）
- 规模：Tier 1 SDK 月下载近 5 亿，TS/Python 各破 10 亿总量（官方博客，2026-07-28）
- Registry：官方 MCP Registry 2025-09-08 preview、2025-10-24 API freeze（v0.1）、`server.json` 标准格式 + DNS 命名空间 + 子注册表 OpenAPI 规范；2026-08 社区全量遍历约 **22,636 个 active server**（来源：https://modelcontextprotocol.io/registry/about 、https://github.com/modelcontextprotocol/registry discussion #1548）

### 关键概念

1. **结构化工具结果**（2025-06-18 stable）：`structuredContent`（JSON 对象）+ `outputSchema`（JSON Schema 2020-12），客户端 SHOULD 校验；text 内容块仍保留向后兼容（来源：https://modelcontextprotocol.io/specification/2025-11-25/server/tools ）
2. **工具注解**：`readOnlyHint / destructiveHint / idempotentHint / openWorldHint`（2025-03-26 引入，沿用至今；"客户端必须视为不可信除非来自可信服务器"）；2025-11-25 增 `icons`、`title`（来源：同上 + 2025-11-25 changelog SEP-973）
3. **Elicitation**：form mode（受限 JSON Schema，含默认值、单/多选枚举）+ **URL mode**（SEP-1036，2025-11-25）——敏感凭据/第三方 OAuth/支付出站完成，凭据不过客户端（来源：https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation 、一周年博客）
4. **Tasks**（2025-11-25 experimental → 2026-07-28 转正为 `io.modelcontextprotocol/tasks` 扩展）：durable 状态机 `working | input_required | completed | failed | cancelled`，`tasks/get` 轮询 + `tasks/update` + `subscriptions/listen` 单流订阅；`execution.taskSupport: forbidden|optional|required` 挂在工具上（来源：https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks 、2026-07-28 changelog SEP-2663）
5. **Sampling with tools**（2025-11-25，SEP-1577）：服务端代理循环可用 `tools`/`toolChoice` 发起带工具的采样——"agentic servers"（已被 2026-07-28 标记 deprecated，随 Roots/Sampling/Logging 一起，12 个月落日）（来源：2025-11-25 changelog、2026-07-28 博客 "Deprecations"）
6. **2026-07-28 无状态核心**：删除 initialize 握手与 `Mcp-Session-Id`；每请求自带 `_meta`（protocolVersion/clientCapabilities/clientInfo）；新增 `server/discover` 可选发现；跨调用状态改用**服务端铸造的显式 handle 作为工具参数**回传（来源：2026-07-28 changelog SEP-2575/SEP-2567）
7. **MRTR（Multi Round-Trip Requests，SEP-2322）**：服务端返回 `resultType:"input_required"` + 待答请求，客户端带 `inputResponses` 重试原调用——取代需长连接的服务端发起 elicitation/sampling/roots（来源：2026-07-28 博客）
8. **网关友好**：`Mcp-Method`/`Mcp-Name` HTTP 头路由（SEP-2243）；list 结果带 `ttlMs`/`cacheScope` 缓存提示（SEP-2549）——**为网关/限流器/WAF 设计的协议面**（来源：2026-07-28 changelog）
9. **授权强化**：RFC 9207 `iss` 校验、凭据绑定 issuer、DCR 弃用转向 CIMD（客户端元数据文档）（SEP-2468/SEP-2352/SEP-991）
10. **正式扩展框架**：Tasks、MCP Apps、EMA（Enterprise Managed Authorization）并列；**12 个月最低弃用窗口**的正式弃用政策（来源：2026-07-28 博客）
11. 错误语义：输入校验错误应作为 **Tool Execution Error**（而非协议错误）返回以利模型自纠（2025-11-25 changelog SEP-1303）

### 对 MAFW 契约的判定

| # | MCP 能力 | MAFW 判定 | 说明 |
|---|---|---|---|
| 1 | 工具 JSON Schema 入参 | **HAVE** | 工具注册已用 JSON Schema parameters |
| 2 | `outputSchema` + 结构化输出 | **MISSING** | MafwToolPart.output 无 schema 约定，上层只能当不透明负载 |
| 3 | 工具注解（readOnly/destructive/idempotent/openWorld） | **MISSING** | 无任何风险提示元数据——而这恰是 permission 决策与 UI 呈现的输入 |
| 4 | 工具 icons/title | **MISSING** | 无呈现元数据 |
| 5 | input_required → 带答案重试（MRTR） | **PARTIAL** | permission.asked/question.asked 是独立回调通道，语义近似但无"重试原调用"显式模型 |
| 6 | Durable task（轮询/延迟取果/取消） | **MISSING** | 契约无任务实体；scheduler/goals 在 gateway 侧非契约 |
| 7 | 工具执行错误 vs 协议错误二分 | **PARTIAL** | tool part 有 error 字段，但未区分"模型可自纠"与"系统故障" |
| 8 | 缓存提示/网关路由头 | N/A（借鉴） | MAFW 本身是网关，可借鉴其对上层 desktop/TUI 暴露缓存与路由提示 |

### 若要支持需要的契约面（一句话草案）

- `registerTool` 入参扩展 `annotations` + `outputSchema` + `title/icons`；`tool.result` 事件载荷允诺 `structuredOutput`（经 outputSchema 校验的 JSON）与 `error.kind:'execution'|'protocol'`
- 任务实体：`tool.call` 可声明 `taskSupport`，新增 `task.get/update/cancel` 动词 + `task.updated` 事件（status 五态）

### 前沿价值

**高** —— MCP 是事实上的工具层标准；annotations/outputSchema 已是 stable spec，Tasks 是 2026 年新转正面。MAFW 工具注册面若不补齐，接入 MCP server 时注解信息将被丢弃。

---

## 3. Vercel AI SDK v6（2025-12-22 发布）

### 现状（谁、什么版本）

- AI SDK 6 于 2025-12-22 发布（v3 语言模型规范）；v6 文档线 ai-sdk.dev/v6；月下载 2000 万+（来源：https://vercel.com/blog/ai-sdk-6 ）
- `@ai-sdk/mcp` 全量 MCP 支持（OAuth/resources/prompts/elicitation）转正

### 关键概念

1. **UIMessage parts 全集**：`text`（state: streaming|done）、`reasoning`（含 id/state/providerMetadata）、`tool-${NAME}`（generative UI 绑定：按工具名生成 part 类型）、`source-url` / `source-document`（引用）、`file`、`data-${NAME}`（**自定义类型化数据 part**）、`step-start`（来源：https://ai-sdk.dev/v6/docs/reference/ai-sdk-core/ui-message 、github.com/vercel/ai packages/ai/src/ui/ui-messages.ts）
2. **工具状态机**（ToolUIPart 六态）：`input-streaming → input-available → approval-requested → approval-responded → output-available | output-error`，另有 `providerExecuted` 标记；approval 载荷 `{id, approved, descriptor, reason, signature}`（**签名**防篡改）（来源：同上）
3. **partial JSON 工具输入流**：流协议含 `tool-input-start / tool-input-delta(inputTextDelta) / tool-input-available`——工具入参 JSON 以文本增量流式呈现（来源：https://ai-sdk.dev/v6/docs/ai-sdk-ui/stream-protocol ）
4. **Data part 调和（reconciliation）与瞬态（transient）**：同 id 重写 = 更新同一 part（loading→success 渐进 UI）；`transient:true` 不入历史、仅 onData 回调可见（来源：https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data ）
5. **流协议**：SSE 类型化分块（start / text-start|delta|end / reasoning-* / source-* / file / data-* / error / tool-* / start-step / finish-step / finish / abort / [DONE]），`x-vercel-ai-ui-message-stream: v1` 头
6. **Agent 抽象**：`ToolLoopAgent`（stopWhen: stepCountIs(20)）、`callOptionsSchema` + `prepareCall`（调用期注入 RAG 文档/按复杂度选模型）、`InferAgentUIMessage`（agent 定义即 UI 类型）、`createAgentUIStreamResponse`；社区 `DurableAgent`（Workflow DevKit，工具执行变 retryable/resumable step）（来源：AI SDK 6 博客）
7. **HITL**：`needsApproval: true | (input)=>boolean`（按入参判定，如 `command.includes("rm -rf")`）；客户端 `addToolApprovalResponse({id, approved})`（来源：博客 "Tool Execution Approval"）
8. 工具面强化：per-tool `strict` 模式、`inputExamples`（Anthropic 原生）、`toModelOutput`（执行结果与回传模型的 token 分离——大输出/二进制不进上下文）
9. DevTools middleware（全链路 step 检查：输入/输出/token/时序/原始载荷）

### 对 MAFW 契约的判定

| # | AI SDK 能力 | MAFW 判定 | 说明 |
|---|---|---|---|
| 1 | 消息 parts（text/reasoning/file/step-start） | **HAVE** | MafwPart 同构（step-start/step-finish 对应） |
| 2 | 工具输入流（partial JSON） | **PARTIAL** | tool.delta 已设计未实现（总纲自认）；业界两种模式：AI SDK 流入参文本 / ACP v2 只流 content 不流入参 |
| 3 | 审批状态机挂载在 tool part 上（approval-requested/responded + id/signature） | **PARTIAL** | permission.asked 是独立事件；无 approvalId、无防篡改签名、无 approve/deny 后回写 tool part 状态的显式路径 |
| 4 | data-* 类型化自定义 part + 同 id 调和 | **MISSING** | MafwPart 封闭枚举，上层应用无法附带自有结构化数据并渐进更新（MAFW 的 usage/plan 是特权内置，无通用机制） |
| 5 | source-url / source-document 引用 part | **MISSING** | 无引用/溯源 part |
| 6 | generative UI（tool-${NAME} 类型化绑定） | **PARTIAL** | tool part 有 tool 名可绑定，但无 per-tool 类型契约（input/output 泛型无法静态推导） |
| 7 | transient 瞬态数据 | **MISSING** | 无不入历史的旁路数据通道 |
| 8 | providerExecuted（区分模型侧/本地侧执行工具） | **MISSING** | tool part 无执行方标记 |

### 若要支持需要的契约面（一句话草案）

- MafwPart 增加开放式 `data-{name}` part（`{type:'data', name, id?, data}`，同 id 调和、可标 transient）；tool part 增加 `approval{id,approved?,reason?}` 状态与 `providerExecuted` 位；`source` part `{type:'source', sourceType:'url'|'document', sourceId, url?, title?}`

### 前沿价值

**高** —— AI SDK 是"上层 UI 契约"的事实标准（ACP 亦复用其思路）；data part 调和与工具状态机是 desktop/TUI 体验的直接杠杆。

---

## 4. OpenAI Agents SDK / Agents API

### 现状（谁、什么版本）

- 三层：Responses API（裸模型）/ **Agents SDK**（自托管编排）/ **Agents API**（OpenAI 托管 Codex harness，beta）——官方明确"长时任务、OpenAI 管理代理与进度保存"归 Agents API（来源：https://developers.openai.com/api/docs/guides/agents ，2026-10 抓取）
- Agents API 内建：自动上下文压缩、多代理编排、程序化工具调用、MCP、托管/自托管沙箱、流 + 签名 webhook（来源：同上 + omnara.com 云代理 API 对比，2026-10-10）

### 关键概念

1. **Agent loop 与四种停止点**：模型回复 / 工具调用 / **handoff（切换专家代理）** / 最终答案（来源：developers.openai.com "Running agents"）
2. **Handoffs**：`handoffs=[booking_agent, refund_agent]`，被移交代理继承对话历史并接管——模块化多代理的一等公民（来源：https://openai.github.io/openai-agents-python/agents/ ）
3. **Guardrails**：input / output / **tool** 三类守卫，并行于主循环；`preApprovalInputGuardrails`（审批前先校验入参，拒绝则直接以守卫消息回给模型，不产生审批中断）（来源：developers.openai.com "Guardrails and human review"）
4. **HITL = 中断 + 可恢复 RunState**：`needsApproval` 工具触发 → `result.interruptions[]` + `state` → `state.approve()/reject({message})`（拒绝理由回传模型）→ 从 state 续跑；**state 可序列化入库，数小时后恢复仍是"同一 run"**；sticky 决策（alwaysApprove 按代理+工具身份记存）；`state` 恢复同样适用于**流式中断续传**（"cancel a stream mid-turn, resume the unfinished turn from state"）（来源：openai.github.io/openai-agents-python/human_in_the_loop/ 、JS 版同名指南）
5. **会话状态四策略**：history 重放 / SDK session / Conversations API conversationId / previousResponseId——官方明确"一个会话选一种，混用会重复上下文"（来源：developers.openai.com "Running agents"）
6. **Tracing 默认开启**：run/模型调用/工具调用/handoff/guardrail/自定义 span，Traces 面板可视化（来源：developers.openai.com "Integrations and observability"）

### 对 MAFW 契约的判定

| # | OpenAI 能力 | MAFW 判定 | 说明 |
|---|---|---|---|
| 1 | agent 循环（多步工具调用直至停止） | **HAVE** | runtime adapter 内含；turn 语义对齐 |
| 2 | Handoffs（代理间移交） | **MISSING** | 无跨代理/子代理移交动词或事件 |
| 3 | Guardrails（输入/输出/工具守卫） | **PARTIAL** | 即总纲"认知面 hooks 四动词"——已审计设计未实现；且业界已从"钩子"演进为"守卫+审批前置校验"复合形态 |
| 4 | 可序列化 RunState + 中断续传 | **MISSING** | abort 是终态；fork 是历史分叉，均非"暂停-恢复同一 run" |
| 5 | 会话状态策略显式化 | **PARTIAL** | history normalize 恒 flat 隐含"全量重放"策略，但策略未成为契约概念 |
| 6 | Tracing/观测面 | **MISSING** | 契约无 trace/span 语义（usage.updated 只有计量） |

### 若要支持需要的契约面（一句话草案）

- 新增 `turn.suspend/resume` 动词族：`suspend` 返回可持久化 `runState`（token），`resume(runState)` 续跑；hooks 四动词落地时增加 `guardrail` 变体（input/output/tool 三挂点 + block/reason 返回）

### 前沿价值

**高** —— handoff 与 durable RunState 是多 runtime 网关最能增值的两块（runtime 差异大、恰需统一语义）。

---

## 5. Anthropic API 前沿

### 现状（谁、什么版本）

- 发布线（platform.claude.com/docs/en/release-notes/overview，2026-09/10 条目）：Claude Opus 5.5（2026-09-22，1M 上下文默认、128k 输出、**思考不可关闭的 always-on adaptive thinking + effort 参数**）；computer_toolset_20260801 与 browser_toolset_20260801 GA（2026-08-19）；Files API GA；**Agent Skills + Skills API（/v1/skills）GA**；inline-tools-2026-09-15 beta（会话中追加工具不破缓存）；Claude Managed Agents（agent_toolset_20260401：托管会话 + 沙箱 + memory store + permission_policy + 流/签名 webhook）
- 模型线：Fable 5.1 / Mythos 5 / Opus 5(.5) / Sonnet 5(.5) / Haiku 5.5

### 关键概念

1. **Context editing**（beta `context-management-2025-06-27`）：`clear_tool_uses_20250919`（trigger=10 万 token 默认 / keep=3 对工具调用 / clear_at_least / **exclude_tools** / clear_tool_inputs）+ `clear_thinking_20251015`（keep 策略按模型分级）；**服务端压缩（server-side compaction）已是主推策略**，客户端 SDK compaction 为备选；编辑不回写客户端——客户端保留完整历史（来源：https://platform.claude.com/docs/en/build-with-claude/context-editing ）
2. **Memory tool**（`memory_20250818`，client 工具）：文件式记忆目录（view/create/str_replace/insert/delete/rename），与 context editing 联动——清除前自动警告 Claude 先写记忆（来源：claude.com/resources/articles/context-management 2025-09-29 + tool-reference）
3. **Prompt caching 控制面**：顶层 `cache_control` 自动断点（多轮对话自动前移）或显式断点；5 分钟默认 + 1 小时档；inline tool 定义保持缓存有效；`defer_loading` 工具延迟展开（发现时才内联进对话体）（来源：platform.claude.com/docs/en/build-with-claude/prompt-caching ）
4. **Server tools**：web_search（20260318）/ web_fetch / code_execution（20260521）/ advisor / tool_search（regex/BM25）；**Client toolset**：bash / text_editor / computer_toolset（批量动作）/ browser_toolset（无障碍树级浏览器操控）/ memory（来源：platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference ）
5. **引用结构**：web_search 结果随响应携带 citations（搜索引文块），与 Gemini 的行内 annotation 是两种引用形态
6. **文件与文档**：Files API GA（expires_in_seconds/expires_at、分页、按 id 过滤）；PDF/多模态输入
7. **Skills**：/v1/skills + Messages API `container` 参数加载 Skill——"可安装能力包"成为平台级 API 面
8. 程序化工具调用（programmatic tool calling）：工具可标记 `allowedCallers:["code_execution_..."]`，在沙箱代码内被调用，中间结果不进上下文（AI SDK 6 已透传该能力）

### 对 MAFW 契约的判定

| # | Anthropic 能力 | MAFW 判定 | 说明 |
|---|---|---|---|
| 1 | reasoning part（思考内容） | **HAVE** | MafwPart.reasoning |
| 2 | 思考深度控制（effort/thought_level） | **MISSING** | 契约无思考等级动词（ACP 已有 thought_level category，双佐证） |
| 3 | 上下文压缩事件（compacting/compacted） | **HAVE** | 领先于多数 SDK；但比 ACP 的 compaction 实体少 summary 内容回传 |
| 4 | 清除策略参数化（trigger/keep/exclude） | **MISSING** | 压缩是黑盒事件，上层无法感知/配置策略 |
| 5 | 记忆工具/记忆系统 | N/A→**PARTIAL** | MAFW 记忆系统在 gateway 侧非契约；但"压缩前写记忆"的联动语义在契约层无体现 |
| 6 | 文件引用生命周期（上传/过期/按引用附入） | **PARTIAL** | MafwPart.file 存在，但无上传/过期/引用句柄动词 |
| 7 | 会话中工具变更（inline tool_addition） | **MISSING** | 工具注册是会话前动作 |
| 8 | citations（搜索引文） | **MISSING** | 无引用 part（与 AI SDK/Gemini 判定合并） |

### 若要支持需要的契约面（一句话草案）

- `prompt` 动词增加 `contextPolicy{compaction:{trigger,keep,excludeTools}}` 可选参；`session.compacted` 附 `summary:MafwPart[]`；MafwPart 增加 `source` part 承载 citations

### 前沿价值

**中-高** —— Anthropic 是 MAFW 各 runtime（claude/codex 均其下游）的能力上限来源；context policy 参数化与 citations 是上层体验的直接缺口。

---

## 6. Google Gemini API

### 现状（谁、什么版本）

- 模型线（2026-10 文档）：Gemini 4 Argon / 3.8 Flash / 3.6 Flash / 3.5 Flash-Lite / 3.1 Pro Preview；**Interactions API**（Gemini 3 起的新 API 面，steps 化响应）（来源：https://ai.google.dev/gemini-api/docs/gemini-3 ，2026-10-09 更新）
- 工具文档最后更新 2026-10-14（ai.google.dev/gemini-api/docs/tools）

### 关键概念

1. **Interactions API steps 模型**：`thought`（含 signature）/ `google_search_call` / `google_search_result` / `model_output`——每步显式类型化，与 MAFW step-start/step-finish 同思路但更细（来源：https://ai.google.dev/gemini-api/docs/google-search ，2026-10-13）
2. **行内引用注解**：text block 直接挂 `annotations:[{type:'url_citation', url, title, start_index, end_index}]`——引用锚定到文本区间（与 AI SDK 独立 source part 是**两种竞争模式**）（来源：同上 + url-context 页）
3. **内置工具族**：Google Search / Maps / **URL Context**（两级取回：索引缓存→live fetch，url_context_result 步骤带状态与 unsafe 标记）/ Code Execution / **Computer Use（preview，客户端执行）** / File Search（托管 RAG）（来源：ai.google.dev/gemini-api/docs/tools）
4. **工具组合**（Gemini 3/4）：内置+自定义工具同轮组合，靠 **encrypted thought signatures** 保持跨环境上下文（函数调用严格校验 signature，缺失 400）（来源：docs/tools + developers.googleblog Gemini 3 更新，2025-11-25）
5. **结构化输出与工具合流**：Structured Outputs 可与 grounding/URL context/code execution 并用（Gemini 3/4 preview）；JSON Schema 支持 anyOf/$ref/prefixItems，Pydantic/Zod 开箱（来源：blog.google 2025-11-05 + docs/tools）
6. 媒体生成：Gemini 3 Pro Image / 3.1 Flash Image（图像生成编辑）、Veo（视频）——生成型多模态在 API 一等公民

### 对 MAFW 契约的判定

| # | Gemini 能力 | MAFW 判定 | 说明 |
|---|---|---|---|
| 1 | steps 化响应（每步类型化） | **HAVE** | step-start/step-finish + tool/text/reasoning parts 组合可达 |
| 2 | 行内引用注解（start/end_index） | **MISSING** | 见统一 citations 判定 |
| 3 | thought signature（加密推理连续性令牌） | **MISSING** | 跨轮/跨工具推理上下文完整性无契约承载——多 runtime 归一化时会丢签名（严格校验模型将 400） |
| 4 | 生成型媒体 part（图像/视频输出） | **PARTIAL** | image/file part 可装结果，但无"生成中→完成"的流式语义与 mediaType 约定 |

### 若要支持需要的契约面（一句话草案）

- MafwPart.source 统一引用（可选 `spans:[{startIndex,endIndex}]` 支持 Gemini 行内式）；tool part / reasoning part 增加可选 `signature` 透传位（normalize 时必须保真）

### 前沿价值

**中** —— Interactions API 与 MAFW 模型同构（印证方向正确）；signature 透传是多 runtime 归一化的隐性正确性风险。

---

## 7. 产品级前沿（Claude Code / Codex / Cursor / Copilot / Devin / Spec-Kit）

### 现状（谁、什么版本）

**云代理已成独立品类**（2026-10 综述，agentatlas.dev "Cloud coding agents compared"，2026-10-20 复核）：Codex Cloud、Copilot cloud agent、Cursor Cloud Agents、Claude Code cloud sessions/GitHub Actions、Jules、Devin、Factory、OpenHands、Amp、Kiro、Warp、Augment、Tembo、Cline、GitLab Duo 等十余家。API 形态对比（omnara.com，2026-10-10）：OpenAI Agents API / Claude Managed Agents / Gemini 均为"流 + 签名 webhook"；Cursor 为可重连流；Copilot/Devin 为轮询。

**Claude Code**（code.claude.com/docs，2026-10）：
- **Hooks 事件目录已达 31 个**，分五档：会话级（SessionStart/SessionEnd/Setup）、turn 级（UserPromptSubmit/UserPromptExpansion/Stop/StopFailure/MessageDisplay/TeammateIdle）、工具级（PreToolUse/PostToolUse/PostToolUseFailure/**PostToolBatch**/PermissionRequest/PermissionDenied）、子代理与任务级（SubagentStart/SubagentStop/TaskCreated/TaskCompleted）、环境级（PreCompact/PostCompact/InstructionsLoaded/ConfigChange/CwdChanged/FileChanged/WorktreeCreate/WorktreeRemove/PreModelSwitch/PostModelSwitch/Elicitation/ElicitationResult/Notification）；hook 类型五种：command/HTTP/MCP tool/prompt/subagent；PreToolUse 可返回 `permissionDecision: allow|deny|ask|defer` + **updatedInput（改写入参后放行）**；Stop 可拒绝结束并注入继续指令（来源：code.claude.com/docs/en/hooks，2026-10）
- Checkpoints：自动保存代码状态，`/rewind` 回滚代码/对话/两者（2025-09-29 发布，anthropic.com/news）
- 云会话：`--cloud`/`--teleport`/`/remote-control`，移动端/Slack/Desktop 多端续接；云定时任务（`/schedule` + RemoteTrigger 工具，前称 routines）；会话级 cron（CronCreate/List/Delete + ScheduleWakeup 自 pacing `/loop`）
- 多代理：subagents、**dynamic workflows**（脚本编排 N 个 subagent）、**cross-session messaging**（SendMessage/ListAgents：给队友/其他本地会话/云会话发消息）、agent teams（实验）
- 其他：`/btw`（旁路提问不入历史）、`/fork`（复制为后台会话）、`/branch`、`/batch`（worktree 并行）、Monitor 工具（后台命令逐行回投/WebSocket 事件）、Artifact 工具（发布 HTML/MD 为可分享页）、ReportFindings（结构化 code-review 发现：file/summary/failure-scenario/category）、PushNotification、`/effort`、`/fast`、plugins + marketplace、沙箱

**Cursor**（cursor.com，2026-08/10）：
- Cloud Agents（前 Background Agents）：每代理独立 VM + 桌面 + 浏览器；`.cursor/environment.json`/Dockerfile/快照构建；**自托管 GA**（worker 出站 HTTPS 连云、Helm/K8s operator，2026-03-25）；多仓环境
- **Subscriptions**（2026-08-19 changelog）：代理订阅事件源（PR/Slack 线程/定时）被唤醒——"事件驱动常驻代理"；`/goal` 长目标；custom modes（skill 钉住为模式）；**steering：跟进消息排队到下一个工具边界**而非打断
- 多代理协作：子代理跑在各自 VM；**父代理内实时流式呈现子代理进度**（2026-10-05 周 note）；**@-mention 代理间消息**（Project coordinator 读取/回复被提及代理的 transcript，2026-10-05 周 note）
- 工作证明（proof-of-work）：PR 附视频/截图/日志；远端桌面接管
- **Cloud Agents API v1**（public beta）：durable `agent`（ACTIVE/IDLE/ARCHIVED）+ per-prompt `runs`，可重连流（cursor.com/docs/cloud-agent/api/endpoints）
- Composer 2 自研模型 + 自研 harness

**Codex cloud tasks**（OpenAI）：隔离云环境（依赖/工具/变量/安装步骤一次配置）、任务保留文件含未提交变更、**7 天任务状态恢复**、summary+diff 交付（continuumcode.ai/boxes.dev 综述，2026）。GPT-5.3-Codex 领跑 SWE-Bench Pro（tembo.io，2026-04）。

**GitHub Copilot**：cloud agent 跑在 GitHub Actions 临时环境（`copilot-setup-steps.yml`，59 分钟会话），issue/PR 指派、`@copilot` mention、draft PR 渐进提交、会话日志实时可见；API preview 轮询制；agent mode 本地化已全面铺开。

**Devin / Manus**：Devin——每会话独立 Linux VM（组织快照）、30 分钟休眠、**可接管终端/VS Code/浏览器**、coordinating Devin 派发 managed Devins、Devin Review 大 diff 审查；2026 降价至 $20/月。Manus——通用云电脑代理、并行代理群、开放 API。

**Spec-driven development**：
- **GitHub Spec Kit**：142k+ stars（2026-10），v1.0（2026-10 OSF 直播），29 个代理集成；核心流 `/speckit-constitution → specify → plan → tasks → implement → converge`（收敛循环）；extensions（近 100）+ presets + workflow engine；Thoughtworks 技术雷达 Vol.34 "Assess"（2026-04-15）——**SDD 首次入雷达**（来源：github.com/github/spec-kit + newsletters/2026-April.md + visualstudiomagazine 2026-05-12）
- **AGENTS.md**：OpenAI 2025-08 发起，数周内 2 万仓库、现 6 万+ 开源项目采用；Codex/Cursor/Copilot/Amp/Jules/Factory 全支持；**2025-12 捐赠给 Linux Foundation 旗下 Agentic AI Foundation**——中立化完成；评估显示 28.64% 运行时缩短（来源：daviddaniel.tech/research/articles/specification-layer/ 2026-02-13 + yigitkonur.com atlas 对比）
- 竞品：OpenSpec（v1.0 已迁往更新的 **SKILL.md** 标准）、BMAD-METHOD、Amazon Kiro；"Specification Layer"成为 2026 企业规模化代理开发的主题词

### 对 MAFW 契约的判定

| # | 产品能力 | MAFW 判定 | 说明 |
|---|---|---|---|
| 1 | 后台/云任务（durable run + 跨端续接 + 恢复） | **MISSING** | 契约只有前台 turn；scheduler/goals 是 gateway 内部件，runtime 层无 detached task 语义 |
| 2 | Checkpoint / rewind（代码+对话状态快照） | **PARTIAL** | fork 是历史分叉，无"回滚到检查点"语义 |
| 3 | 认知面 hooks（31 事件 vs MAFW 四动词） | **PARTIAL（设计未实现）** | 总纲自认；且业界已扩展到 PermissionRequest/PostToolBatch/PreCompact/Elicitation 等远超四动词的面 |
| 4 | 子代理/跨会话消息（handoff、SendMessage、@-mention、teams） | **MISSING** | 契约无子会话/代理间通信面（ACP 亦在 RFD 中——可同步占位） |
| 5 | AGENTS.md / skills / 命令发现 | **PARTIAL** | 工具注册有；无 AGENTS.md/skills/斜杠命令的发现与加载契约 |
| 6 | 结构化发现物（ReportFindings 式结构化结果） | **MISSING** | 无"发现/工件"专用 part（可用 data part 解决——与 §3 合并） |
| 7 | 工作证明工件（视频/截图/日志附 PR） | **MISSING** | file part 可承载但无"证据"语义 |
| 8 | 环境/沙箱契约（environment.json 式） | **MISSING** | agent 进程管理仅 restart；无环境配置面（worktree 在 gateway 非契约，可视为已占位） |

### 若要支持需要的契约面（一句话草案）

- 后台任务：`task.submit(prompt, environment?) → taskId` + `task.list/get/cancel/message(follow-up)` + `task.updated` 事件（status 对齐 MCP tasks 五态 + IDLE/ACTIVE 门控）；checkpoint：`session.checkpoint() → checkpointId` + `rewind(checkpointId, scope:'code'|'conversation'|'both')`

### 前沿价值

**高** —— 云代理是 2026 最大增量赛道；MAFW 的 runtime adapter 恰位于"本地 CLI 代理 ↔ 云端任务"的桥点，缺后台任务契约则 desktop/TUI 无法统一调度五种 runtime 的云面。

---

## 8. 流式 / 交互语义

### 现状与关键概念（跨源汇总）

1. **token 级 vs block 级流**：AI SDK v6 以"块生命周期"流（text-start/delta/end 各带 id，块边界一等公民）；ACP v1 纯 chunk、v2 增加整消息 upsert（重放/纠错/已完成输出三用途）；Gemini Interactions 以 step 为单位。→ **块/步生命周期 + 增量 delta 的混合模型是收敛方向**。
2. **thinking 可见性控制**：AI SDK `sendReasoning` 开关；ACP `agent_thought_chunk` 直流；Anthropic 已到 **always-on adaptive thinking + effort 参数**（Opus 5.5 思考不可关闭，深度分级）；Claude Code `/effort`。→ 思考从"有无"演进为"深度等级 + 可见性策略"。
3. **citation/sources 数据结构**：两种竞争形态——AI SDK 独立 part（source-url/source-document）vs Gemini 行内 annotation（url_citation + start/end_index）。均已是稳定产品面。
4. **partial JSON 工具输入流**：AI SDK `tool-input-delta`（inputTextDelta 文本增量）；ACP v2 明确只流 content 不流入参；MCP 无此面。→ 单一主流实现（AI SDK），早期标准。
5. **中断续传（resume mid-turn）**：OpenAI Agents SDK RunState（流中断后从 state 续跑同一 turn）；MCP tasks（input_required + 延迟取果）；Cursor 云代理 follow-up 排队 + 环境迁移保持文件。→ "暂停-恢复"正在取代"打断-重来"。
6. **多 turn 交叉注入（steer）**：MAFW `delivery:'steer'` 已有；Cursor 2026-08 明确"steering 改进：跟进排队至下一工具边界而非打断动作"；ACP v2 将 queued-work 列为未来流程。→ **MAFW 领先，但缺"排队边界策略"参数（立即/下一工具边界/下一 turn）**。
7. **取消语义**：ACP 规定 cancel 后仍须接受尾部 tool 更新、permission 挂起须以 cancelled 应答、代理必须捕错误返回 cancelled 而非 error（prompt-turn.md Cancellation 节）——取消是**协议级纪律**而非动词。

### 对 MAFW 契约的判定

| # | 语义 | MAFW 判定 | 说明 |
|---|---|---|---|
| 1 | part 生命周期流（delta/updated/complete） | **HAVE** | 契约原生 |
| 2 | 思考深度/可见性控制 | **MISSING** | 有 reasoning part，无 effort/thought_level 控制面（ACP+Anthropic+Claude Code 三重佐证） |
| 3 | citations/sources | **MISSING** | 见 §3/§5/§6 |
| 4 | partial JSON 工具输入流 | **PARTIAL** | tool.delta 已设计未实现（总纲自认）；实现时建议对齐 AI SDK 文本增量式 |
| 5 | resume mid-turn | **MISSING** | abort 终态；无 run state |
| 6 | steer | **HAVE（领先）** | 建议补 `boundary:'immediate'|'next-tool'|'next-turn'` 参数对齐 Cursor 实践 |
| 7 | 取消纪律（挂起应答 cancelled、尾部更新容忍） | **PARTIAL** | abort 事件存在；挂起 permission/question 与 abort 的竞态语义未在契约言明 |

### 前沿价值

**中-高** —— 流式/交互语义是 MAFW 契约的核心地带；thought_level 与 resume 是两个可快速跟进的高杠杆点。

---

## 9. 跨领域综合

### 9.1 "业界已成标准而我们缺失" Top 清单（按价值排序）

| # | 能力 | 谁有（档位） | MAFW 判定 | 价值 | 契约面一句话 |
|---|---|---|---|---|---|
| 1 | **工具注解与结构化输出**（readOnly/destructive/idempotent/openWorld + outputSchema + title/icons） | MCP 2025-06-18/11-25 stable（已成标准） | MISSING | 高 | registerTool 扩展 annotations/outputSchema/title，tool.result 带 structuredOutput |
| 2 | **会话配置选项**（mode/model/model_config/thought_level 分类） | ACP v1 stable（已成标准） | PARTIAL（仅 permission_mode） | 高 | session.config 事件族 + setConfigOption 动词，category 四分类 |
| 3 | **StopReason 分类学**（end_turn/max_tokens/max_turn_requests/refusal/cancelled/error） | ACP v1 stable（已成标准） | PARTIAL | 高 | turn.completed/failed 增 stopReason 枚举 |
| 4 | **工具呈现元数据**（kind 分类学 + title + locations） | ACP v1 stable（已成标准） | MISSING | 高 | tool part 快照增 kind/title/locations |
| 5 | **认知面 hooks/guardrails**（含审批前置校验、改写入参放行） | Claude Code 31 事件 + OpenAI guardrails（主流采用） | PARTIAL（四动词设计未实现） | 高 | hooks 四动词落地 + guardrail 挂点（input/output/tool）+ block/reason/updatedInput 返回 |
| 6 | **后台 durable 任务**（状态机 + 轮询/订阅 + 跨端续接） | MCP tasks 扩展 + ACP v2 后台语义 + 全部头部产品云代理（已成标准+主流采用） | MISSING | 高 | task.submit/list/get/cancel/message + task.updated |
| 7 | **Slash 命令/能力发现**（available_commands_update、skills、AGENTS.md） | ACP stable + AGENTS.md 60k 仓库/Linux Foundation（已成标准+主流采用） | MISSING | 中-高 | session.commands 事件 + AGENTS.md/skills 发现动词 |
| 8 | **data part（类型化自定义数据 + 同 id 调和 + transient）** | AI SDK 6（主流采用的事实标准） | MISSING | 中-高 | MafwPart 开放 data-{name} 形态 |
| 9 | **citations/sources part**（两种形态：独立 part vs 行内 span 注解） | AI SDK 6 + Gemini Interactions（主流采用） | MISSING | 中 | MafwPart.source（含可选 spans） |
| 10 | **审批状态机挂载工具调用**（approvalId/signature/descriptor + approve/deny 回写） | AI SDK 6 + OpenAI interruptions（主流采用） | PARTIAL | 中 | tool part 增 approval 状态 + permissionReply 带 approvalId/reason |
| 11 | **瞬态通知通道**（notice，非历史） | ACP stable（已成标准） | MISSING | 中 | notice 事件（severity/title/description） |
| 12 | **usage 完整语义**（cost+currency ISO-4217 + used/size） | ACP stable（已成标准） | PARTIAL | 中 | usage.updated 载荷对齐 used/size/cost |
| 13 | **compaction 实体化**（compactionId + summary 内容 + failed/cancelled 终态） | ACP stable（已成标准） | PARTIAL | 中 | session.compacted 载荷扩展 |
| 14 | **Elicitation URL mode**（出站敏感交互） | MCP 2025-11-25 + ACP stable（已成标准） | MISSING | 中 | question.asked 增 mode:url + elicitationId |
| 15 | **handoffs / 子代理会话** | OpenAI Agents SDK + Claude Code + Cursor（主流采用；ACP RFD 早期探索） | MISSING | 中 | subagent session（受限会话）+ handoff 动词 |
| 16 | **可恢复 run 状态**（序列化 RunState、中断续传） | OpenAI Agents SDK（主流采用） | MISSING | 中 | turn.suspend/resume + runState token |
| 17 | **会话级聚合状态**（running/idle/requires_action） | ACP v2（草案，早期探索→快速成型） | MISSING | 中 | state.updated 事件 |
| 18 | **思考签名透传**（thought signature 保真） | Gemini 3（主流采用） | MISSING | 中 | part 增 signature 透传位，normalize 保真 |

### 9.2 "正在成型、可提前占位"清单

| # | 能力 | 现状（档位） | 占位建议 |
|---|---|---|---|
| 1 | **ACP v2 prompt 生命周期**（prompt 响应=插入确认 + state_update 通知） | v2 draft（早期探索） | MAFW turn.* 事件已具雏形；新增 turn.accepted(messageId) 与 state.updated 即可平移，避免未来二次破坏 |
| 2 | **upsert 三态 patch 语义**（省略/null/值） | ACP v2 draft | part.updated/complete 载荷设计时预留 null=清除 语义，历史 normalize 管道先支持 |
| 3 | **MCP MRTR**（input_required → inputResponses 重试） | 2026-07-28 已发布、SDK 跟进中（已成标准→扩散中） | permission.asked/question.asked 可统一为"待答请求"抽象，为 MRTR 式重试留位 |
| 4 | **MCP 无状态核心 + 网关头路由**（Mcp-Method/Mcp-Name、缓存提示） | 2026-07-28 stable | MAFW 自身即网关：对上层暴露方法/名称头与 list 缓存提示是对齐方向 |
| 5 | **子代理受限会话 + 代理间消息** | ACP RFD + Cursor Projects/Claude teams 产品化（早期探索↔主流采用之间） | session DTO 预留 parentSessionId/depth 字段；消息 DTO 预留 fromAgent 标记 |
| 6 | **SKILL.md / Agent Skills 标准化**（OpenSpec v1.0 已迁移，Anthropic Skills API GA） | 早期探索→快速成型 | 能力发现动词（§9.1 #7）预留 skills 载荷而非硬编码命令列表 |
| 7 | **行内引用注解 vs 独立 source part 之争** | 两种形态并行（主流采用） | source part 设计为"独立 part + 可选 spans"，同时兼容两种模式 |
| 8 | **环境/沙箱契约化**（Cursor environment.json、Codex environments、Cloud Agents API 的 environment 资源） | 主流采用（各家私有）、尚未中立标准化 | task.submit 预留 environment 引用参数，不内嵌配置细节 |
| 9 | **工作证明工件**（视频/截图/日志附交付） | 主流采用（Cursor/Devin） | data part + file part 组合可承载，先不设专用 part |
| 10 | **steering 边界策略**（排队至工具边界） | Cursor 产品化（主流采用）、ACP v2 排队流（早期探索） | prompt 动词 delivery:'steer' 增加 boundary 参数 |

### 9.3 结构性观察（供决策参考）

1. **两个中立协议在"分层"**：MCP 管工具/资源（且 2026-07 起自我定位为无状态数据与交互基座），ACP 管客户端↔代理会话。MAFW 的定位恰是 ACP 层（+ 自有 gateway 件），工具契约应尽量**透传 MCP 语义**而非自造。
2. **"暂停-恢复"正在取代"打断-重来"**：OpenAI RunState、MCP tasks input_required、ACP v2 requires_action、Cursor 排队 steering——四个独立来源同一方向。MAFW 的 abort/fork 二元组不足以表达。
3. **认知面（hooks/guardrails）从插件机制升格为安全边界**：Claude Code 把"规则必须落成 hook 而非 prompt 指令"写进文档（"An instruction like 'never edit .env' in CLAUDE.md is a request, not a guarantee"），OpenAI 的 preApprovalInputGuardrails 把守卫插进审批流之前。MAFW 四动词的审计结论需要按此提级。
4. **AGENTS.md 已完成中立化**（Linux Foundation），是 MAFW 各 runtime 共享的既成事实层——契约若提供发现/加载动词可零成本收割生态。
5. **金丝雀指标**：ACP v2 转正（当前 draft）与 MCP 2026-07-28 SDK 扩散完成是未来 12 个月内最可能触发 MAFW 契约破坏性变更的两个外部事件，建议在契约版本策略中预留两者映射层。

---

## 附：来源索引（主要）

| 领域 | 关键来源 |
|---|---|
| ACP | agentclientprotocol.com（llms.txt、protocol/v1/{prompt-turn,content,tool-calls,session-config-options,session-modes,elicitation}.md、protocol/v2/migration.md、rfds/、announcements/）；github.com/zed-industries/zed PR #37632（2025-09-09 合并） |
| MCP | modelcontextprotocol.io/specification/{2025-06-18,2025-11-25,2026-07-28}（changelog、server/tools、client/elicitation、basic/utilities/tasks、registry/*）；blog.modelcontextprotocol.io（2025-11-25 一周年、2026-07-28 发布文）；github.com/modelcontextprotocol/registry（discussion #1548，2026-08-19） |
| Vercel AI SDK | vercel.com/blog/ai-sdk-6（2025-12-22）；ai-sdk.dev/v6/docs（stream-protocol、ui-message、streaming-data、chatbot） |
| OpenAI | developers.openai.com/api/docs/guides/agents（agents、running-agents、guardrails-approvals、integrations-observability）；openai.github.io/openai-agents-{python,js}（agents、human_in_the_loop） |
| Anthropic | platform.claude.com/docs/en/release-notes/overview（2026-08-19/2026-09-22 条目）、build-with-claude/{context-editing,prompt-caching}、agents-and-tools/tool-use/tool-reference；claude.com/resources/articles/context-management（2025-09-29） |
| Gemini | ai.google.dev/gemini-api/docs/{tools,url-context,google-search,gemini-3}（2026-10-09/13/14 更新）；developers.googleblog.com（2025-11-25）；blog.google（2025-11-05） |
| Claude Code | code.claude.com/docs/en/{features-overview,claude-code-on-the-web,commands,tools-reference,hooks,hooks-guide,feature-availability}；anthropic.com/news/enabling-claude-code-to-work-more-autonomously（2025-09-29） |
| Cursor | cursor.com/docs/{cloud-agent,release-notes/cloud-agents}（2026-10-05 周条目）；cursor.com/changelog/08-19-26；cursor.com/blog/{cloud-agents,self-hosted-cloud-agents}（2025-10-30/2026-03-25）；cursor.com/docs/cloud-agent/api/endpoints |
| 云代理横向 | agentatlas.dev/cloud-agents（2026-10-20 复核）；omnara.com/guides/cloud-agent-apis（2026-10-10）；boxes.dev、continuumcode.ai、tembo.io（2026 年各月） |
| SDD/AGENTS.md | github.com/github/spec-kit（142k stars，2026-10；newsletters/2026-April.md）；github.blog（2025-09-02）；daviddaniel.tech/research/articles/specification-layer/（2026-02-13）；visualstudiomagazine.com（2026-05-12）；yigitkonur.com/atlas |
