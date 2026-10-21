# Runtime Canonical v3 —— 跨平台事件映射全量表与审计（v2，审查已并入）

- 日期：2026-10-21
- 状态：v2 —— 双子代理对抗审查完成（库内 A + 外部 B），修正与新发现已全部并入；可作为设计文档 `2026-10-21-runtime-canonical-v3-design.md`（待写）的上游输入
- 上游决策（brainstorm 已定）：gateway 经 runtime 层与底层 SDK 彻底解耦；方案 A（形状兼容中立类型）+ v2同构（canonical 为 flat `{role, content[]}`）；**分段实现**；**opencode 拆 @v1/@v2 两个方言**
- 审查记录：Reviewer A（库内，对照 gateway/src + node_modules SDK 逐条核验，判定"方向 sound、事实层需修"——修正已应用）；Reviewer B（外部，code.claude.com + openai/codex main 源码/schema + dsh master 源码核验，判定"高度可靠，无凭空捏造"，12/15 逐字确认——修正已应用）
- 证据档位：opencode/pi 为库内验证；claude/codex/dsh 已二次验证（2026-10-21，一手源）
- 版本钉扎警告：①Codex v2 面 = `codex-rs/app-server` JSON-RPC 协议；npm `@openai/codex-sdk` 0.163.0 只有旧 exec-JSONL（snake_case `turn.started`/`item.completed`），**adapter 勿接错面**；`thread/revert` 已改名（schema 文件名仍是 ThreadRollback*，勿照抄）②dsh 词汇匹配 **repo master（2026-10）**；npm rc 版（2026-07~10）滞后：无 `system/message`/`assistant/attempt`/`session/resume`/`session/wait`，有旧词 `assistant/chunk`/`todo/write`——adapter 须钉 master 或等 release

## 1. v3 规范模型要点

1. **词汇增量：仅新增 `turn.started`**。原生证据：Codex `turn/started`、dsh `turn/start`、opencode@v2 `session.next.prompted/admitted`、**pi `agent_start`（审查已裁决：每 prompt 触发，源码证据 agent-loop.js:43-56、_turnIndex 重置）**。`tool.delta` 原语语义扩展为"工具输入或输出增量流"（吸收 opencode@v2 `tool.input.*` 与 Claude `input_json_delta`），非新词。
2. **DTO（v2同构，行业形状）**：`MafwMessage = { id?, role: 'user'|'assistant', content: MafwPart[] }`；`MafwPart = text | reasoning | tool(统一快照: callID/tool/state/input/output/error) | image | file | step-start | step-finish`。Claude/pi/dsh 原生同族，ACP 用 MCP ContentBlock（同族），Codex items 一一映射，opencode 历史端点是唯一需要真翻译的（`{info,parts}`↔flat 一层）。
3. **方言寻址**：adapter 按 `platform@dialect` 注册与切换（`opencode@v1` / `opencode@v2` / `pi` / `claude` / `codex` / `dsh`）。opencode 2.x 对 legacy 与 next/sync 双发——每方言只消费自己的族，另一族显式 drop 行（default-deny 机制天然支持，两表互斥）。**@v1 列口径**：以安装 SDK v2 union 中的 legacy 家族为准（v1 SDK 自身的 32 事件 union 不含 `permission.asked`/`question.*`/`message.part.delta`——这些是 2.x serve 的 legacy 双发成员）。
4. **工具事件两组模型**：
   - **原语组**（call/result 分离 → `tool.call/delta/result` 三原语 → assembler 合帧）：opencode@v2、claude、dsh、pi（⚠ pi 现状映射行在 live 流不可达，见 N1——v3 须先桥接）
   - **快照组**（统一状态实体 → `part.updated` 直通）：opencode@v1、codex
   - 合帧机制 = **gateway 侧 assembler**（`tool-part-assembler.ts` 的 `applyCall/applyDelta/applyResult` 统一包装插件与 builtin 事件流——2026-10-12 tool-part-compat spec 既定的方案 B，拒绝插件各自手写 join）；canonical-facets 无 tool **合帧**规则（有 toolCommand 提取规则，读 `$.part.state.input.command`）。
5. **契约验证**：RuntimeClient 动词全部有原生对应——`delivery:'steer'`（Codex `turn/steer`）、`fork(sessionID, messageID)`（Claude `forkSession upToMessageId` 精确匹配）、`maxTurns/maxCostUsd`（Claude `maxTurns/maxBudgetUsd`）、`abort`（五家全有）、`permissionReply once|always|reject`（Claude canUseTool / Codex `accept|acceptForSession|decline|cancel` / ACP options / **dsh 除外——无 'always'，见 F4**）。改动点：`normalizeMessages` 目标改 flat；`MafwToolRegistration.parameters` JSON Schema 已被五家（MCP 或等价物）支持。
6. **认知面四动词五家可实现**：Claude 33 hooks（审查确认精确 33 个；`additionalContext` 注入点十余处、`updatedInput`/`updatedToolOutput` 重写、门控；UserPromptSubmit 不能改写 prompt 本身只能注入）；Codex 14 hooks（审查逐一确认：interrupt/model-request(含 Pre+Post)/permission-request/post-compact/post-tool-use/pre-compact/pre-tool-use/session-end/session-start/stop/subagent-start/subagent-stop/user-prompt-submit）；dsh `agent/pre-step`（`PreStepDecision = {kind:'reject'} | {kind:'enter', messages}`——可拒绝或替换入步消息）+ `tools/pre|post-execute` + `llm/stream`；pi 扩展；opencode 插件。**dsh 官方桥接包 `dsh-hooks-codex`/`dsh-hooks-claude-code` 的映射表（SessionStart→agent/session-start、UserPromptSubmit→agent/pre-step、PreToolUse→tools/pre-execute、PostToolUse→tools/post-execute、Stop→agent/turn-stopping）是跨平台认知面对照的现成佐证与测试向量（N9）。**

## 2. 全量映射表（canonical v3 × 六方言）

图例：**●** 原生事件映射 ｜ **◐** 合成（路径确定）｜ **○** 直通/恒等 ｜ **—** 缺失 ｜ **▲** 双发须防重（该方言须显式 drop）｜ **⚠** 防御行/死代码等注意事项

| canonical | opencode@v1 | opencode@v2 | pi | claude | codex | dsh |
|---|---|---|---|---|---|---|
| session.created | ● session.created | ● session.created | — | ◐ system/init | ● thread/started | ◐ agent/created |
| session.updated | ● | ●（▲ session.status 溢出） | ⚠ agent_start 现映此（v3 改映 turn.started，撤 per-turn 壳） | ◐ session_state_changed | ● thread/status/changed | ● session.status |
| session.deleted | ● | ● | — | — | ● thread/deleted | — |
| **turn.started（新增）** | ◐ 首条 user 回显 | ● session.next.prompted / prompt.admitted | **● agent_start（F8 已裁决：per-prompt）** | ◐ user 回显 | ● turn/started | ● turn/start |
| turn.completed | ● session.idle | ● session.idle | ● agent_end / agent_settled | ● result(success) | ● turn/completed | ● turn/end |
| turn.failed | ● session.error / ⚠ message.error（防御行，不在 union） | ● session.error（8 成员错误 union 判别，含 MessageAbortedError——N5） | **⚠（F1 重写：错误有终态但现被误分类为 turn.completed；修为 agent_end/message_end 按 stopReason 分类）** | ● result(error_*×4：max_turns/during_execution/max_budget_usd/max_structured_output_retries；terminal_reason 19 值) | ● error 通知（v2 无 turn/failed——N3；turn/completed 内 TurnAborted） | ◐ turn/end 按 TurnEndReason 判别（N7） |
| turn.aborted | ⚠ message.aborted（防御行，不在 union） | ⚠ message.aborted（防御行，不在 v2 union） | ◐ stopReason=aborted 分类（F1） | ◐ aborted_streaming/tools | ● turn/interrupt | ◐ turn/end(aborted{cause}) |
| message.updated | ● | ● | ⚠ message_end（info.role 恒标 assistant——N2：用户消息被误标，trajectory turn_start 对 pi 从不触发） | ● assistant | ◐ item/started+completed(agentMessage) | ● user/message · assistant/message |
| part.delta | ⚠ message.part.delta（@v1 列口径：v2 union legacy 家族） | ● text.delta / reasoning.delta | ◐（现状发 part.updated 带 delta 文本——v3 变更点） | ● stream_event | ● item/*/delta（agentMessage/plan/reasoning/commandExecution/fileChange） | ● agent/assistant-stream |
| part.updated | ● message.part.updated | ▲（legacy 族，@v2 方言 drop） | ◐ 聚合合成（含 turn_start/turn_end→step-start/step-finish 部件——pi 的 BudgetGuard step 载体） | ◐ 块序列合成 | ○ item/started 快照 | ◐ 内嵌展开 |
| part.complete | ⚠ message.part.complete（防御行，不在 union） | ◐ text.ended / reasoning.ended（现状 code 已 drop 这两个——v3 反转为映射，标记为变更） | — | ◐ content_block_stop | ◐ item/completed | ◐ stream end |
| tool.call（原语） | —（快照组） | ● tool.called | ⚠ 映射行存在但 live 流不可达（N1：extension 钩子事件；live 是未映射的 tool_execution_*） | ◐ tool_use 块 | ○ item/started | ● tool/call |
| tool.delta（原语） | — | ● tool.progress + tool.input.delta | —（tool_execution_update 未映射） | ◐ input_json_delta | ◐ outputDelta / mcpToolCall/progress | — |
| tool.result（原语） | — | ● tool.success / tool.failed | ⚠ 同 N1 | ◐ tool_result 块 | ○ item/completed | ● tool/result |
| part.updated(tool 快照) | ● 原生融合直通 | ◐ assembler 合帧 | ◐（现状仅历史 normalize 路径；live 见 N1） | ◐ assembler 合帧 | ○ 统一 item 直通（commandExecution/fileChange/mcpToolCall 带 status：inProgress/completed/failed/declined；额外 ThreadItem 类型透传——N12） | ◐ assembler 合帧 |
| permission.asked | ● | ● permission.v2.asked（▲ v1 名 drop） | ◐ 审批桥扩展 | ◐ PermissionRequest / canUseTool | ● item/*/requestApproval | ◐ approval/asked（F10 已结案）+ approval/request waterfall |
| permission.replied | ● | ● permission.v2.replied | ◐ | ◐ canUseTool 回复 | ● `accept \| acceptForSession \| decline \| cancel`（v2；v1 ReviewDecision 为 approved/approved_for_session——审查修正） | ◐ approval/decided（outcome: allowed-once/rejected/cancelled/unavailable） |
| question.asked | ● | ● question.v2.asked | — | ◐ AskUserQuestion 工具名合成（F5；Elicitation hook 双路可行） | ● item/tool/requestUserInput + mcpServer/elicitation/request | — |
| question.replied | ● | ● question.v2.replied | — | ◐ 工具结果 | ● | — |
| question.rejected | ● | ● question.v2.rejected | — | ◐ decline/cancel | — | — |
| plan.updated | ● todo.updated | ● todo.updated | — | ◐ plan mode / ExitPlanMode | ● turn/plan/updated + item/plan/delta 流式 | — |
| usage.updated | ◐ gateway 合成 | ◐ gateway 合成 | ⚠（合成机制 runtime 无关；pi 数据缺口——message_end 只映 assistant 角色，tokens 不达 trajectory，N2 关联） | ● result.usage / modelUsage | ● thread/tokenUsage/updated | — |
| session.compacting | — | ● compaction.started | ◐ 扩展 | ◐ status(compacting) | — | — |
| session.compacted | ● | ● compaction.ended | ◐ 扩展 | ● compact_boundary | ● thread/compacted（优于 ContextCompaction item——审查建议） | — |
| permission_mode | ◐ | ◐ | ◐ gateway 侧广播（runtime 无关——审查修正） | ◐ setPermissionMode 控制面 | ◐ approvalPolicy 参数面 | ◐ approval/policy（ask\|never） |
| session.diff | ● session.diff | ●（revert.* 本期 drop） | — | — | ◐ turn/diff/updated | — |
| trajectory.event/turn | gateway 自有（六方相同，不进映射表） | | | | | |

- 15 个 flat 事件与 `mafw_event` 信封为 gateway 自有面，非 runtime 映射目标。
- ACP（Agent Client Protocol）列为潜在第七方言（dsh 有 acp profile、Gemini CLI/goose/Cursor 族）：`session/update` 分类学与 canonical 高度同构，若接入走独立 `acp@v1` 方言。

## 3. 审计发现 F1–F12（v2 修订版）

**F1 ·（重写）pi 错误终态误分类——不是缺失，是错误归因**：pi-agent-core `handleRunFailure`（agent.js:349-365）在引擎错误/中止时发**合成失败 assistant 消息**（stopReason error|aborted + errorMessage），经 message_start→message_end→turn_end→agent_end——gateway 把 `agent_end` 映为 `turn.completed`，导致 goalDriver 走 `onSessionIdle` 而非 `onSessionError`，失败节点被错误归因为 `artifact_missing`。处置：**agent_end/message_end 按最后消息 stopReason 分类**（error→turn.failed，aborted→turn.aborted）；孤儿事件 `auto_retry_start/end`、`compaction_end{errorMessage}`、`summarization_retry_*` 决定 drop 或接观测；`tool_execution_start/update/end` 未映射（见 N1）。

**F2 · Codex 无 step 边界（降级，维持）**：审查结构性确认——v2 项与通知只带 {threadId, turnId, itemId}，ThreadItem 无 step/model-cycle 字段，回合是唯一循环边界。处置：Codex 方言降级为 turn 计数 + 契约注明。**对照：dsh 的 step 是原生 model-cycle 边界（"one model call plus the tool executions it requested"——N6），BudgetGuard 在 dsh 无需降级。**

**F3 · usage.updated 双源竞态（定所有权，标注为 spec 修订）**：现状 gateway 在 turn.completed 上**无条件**合成（index.ts:1273-1287），10-12 spec 定义 usage.updated 为 gateway 合成——F3 的"adapter 原生优先，gateway 兜底"是对该 spec 的修订（需显式标注）。去重检查逻辑尚不存在，须新建。

**F4 · 'always' 持久化范围漂移（契约声明，补 dsh）**：opencode=跨会话规则、pi=session 级 allowlist、Claude=四档 destination（session/local/project/user）、**Codex v2=acceptForSession（session 级）**、**dsh 无 'always'——仅 allowed-once，fail-closed（无 answerer/抛错/越界返回一律 unavailable），请求仅在开放回合内有效**。处置：契约定义 'always' = "runtime 尽力持久，范围由 runtime 决定"；**dsh 方言显式降级为逐次询问**；桌面文案不得承诺"永久"。

**F5 · Claude question 靠工具名合成（维持，双路确认）**：AskUserQuestion 是工具（headless 模式文档明示）。Elicitation/ElicitationResult hook 现已存在——双路合成（hook + 工具名拦截）可行，PreToolUse 的 updatedInput 还能程序化作答。

**F6 · opencode 孤儿族逐项处置（v2 扩充——审查补 ~20 个）**：
- `tool.input.started/delta/ended` → 并入 `tool.delta`（语义扩展，非新词）
- **现状已 drop 但表未携带**：`session.next.step.ended`、`session.next.reasoning.ended`（opencode-events.ts:38-39 现有 drop 行）——v3 中 reasoning.ended 反转为 part.complete 映射（标记为变更），step.ended 维持 drop
- `retried` / `moved` / `agent.switched` / `model.switched` / `context.updated` / `synthetic` / `shell.*` / `text.started` / `reasoning.started` / `compaction.delta` / `step.started` → drop
- `revert.staged/cleared/committed` → 本期 drop，Phase 2 随 session.diff 域评估
- `message.removed` / `message.part.removed` → 真实缺口（桌面 upsert 渲染无法删陈旧部件），本期 drop + 已知限制
- **@v1 族新增**：`permission.updated`（v1 union 独有，permission.asked 的语义表亲——需显式处置：drop）、`command.executed`、`tui.*`×4、`server.connected`/`server.instance.disposed`、`session.status`（携带 idle/retry/busy 态，chatSignal 邻接——评估接观测或 drop）
- **@v2 族新增**：`worktree.ready/failed`、`models-dev.refreshed`、`integration.*`、`catalog.updated`、`global.disposed` → drop
- `pty.*` / `file.watcher.*` / `lsp.*` / `vcs.*` / `project.*` / `workspace.*` / `installation.*` / `mcp.*` / `plugin.added` / `file.edited` / `reference.updated` → drop（无消费方）
- **▲ 补全**：@v2 方言对 legacy 家族成员（`message.part.delta`、`permission.asked/replied`、`question.*`、`session.compacted`）须显式 drop 行

**F7 · SDK 词表口径（修正）**：v2 Event union = **89**（两种独立计数法验证；调研报 86、作者数 84 都错）。conformance 加"SDK 词表快照测试"以 `dist/v2/gen/types.gen.d.ts:4` 为基线。

**F8 ·（已裁决）pi agent_start 每 prompt 触发**：agent-loop.js:43-56 每次 prompt() 调用发 agent_start + turn_start；agent-session.js:441-443 在 agent_start 重置 _turnIndex（per-run 计数器）。**定案：agent_start → turn.started**，撤掉 per-turn session.updated 壳（桌面本就忽略它）。

**F9 · Claude 回合双终态源（维持）**：result + session_state_changed(idle) 都标志回合结束。@claude 只映 result（富载荷），后者 drop。

**F10 ·（已结案）dsh 审批面已核实**：服务 = `ctx.approval.request(ApprovalRequest)` → `allowed-once | rejected | cancelled | unavailable`（fail-closed，仅一次性授权）；事件 = session 日志 `approval/asked {id, toolName, callId?, reason?}` + `approval/decided {id, outcome}` 成对审计 + `approval/policy {policy}`（ask|never）；waterfall = `approval/request` answerer 链（gateway 可挂 answerer）。**注意：请求不带工具参数（toolName+callId），permission.asked 载荷须按 callId join tool/call（N8）。**

**F11 ·（措辞修正）合帧机制**：canonical-facets 无 tool **合帧**规则（有 toolCommand 提取）；合帧 = **gateway 侧 assembler**（tool-part-assembler.ts 的 applyCall/applyDelta/applyResult 经 wrapToolPartAssembly 统一包装插件与 builtin 流）——2026-10-12 tool-part-compat spec 既定方案 B，拒绝插件各自手写 join。工具 part 以 `part.updated`（v2 名）透传，桌面按 part.id upsert。

**F12 · 词汇增量定案（维持 + guard chain）**：仅 +`turn.started`。**5 点联动 guard chain**（vocabulary-sync 测试强制）：① packages/gateway-sdk `RUNTIME_EVENT_TYPES` ② gateway `mafw-vocabulary.ts` ③ `EVENT_FLOW_MATRIX` 行（event-flow-matrix.ts:9 强制）④ desktop `assertShellEventCoverage` ⑤ TUI `KNOWN_EVENTS`。

## 4. 审查新发现 N1–N12

- **N1**：pi `tool_call/tool_result` 映射行是 **live 死代码**——它们是 extension 钩子事件（agent-session.js:223-272 只路由给扩展），从不进 `session.subscribe` 监听流；live 真流是未映射的 `tool_execution_start/update/end`（pi-agent-core AgentEvent 成员，gateway 源码零引用）。pi live 工具卡只经历史 normalize 渲染。**v3 pi 原语组方案须先桥 tool_execution_*（或扩展内推原语，同审批桥模式）。**
- **N2**：pi 用户消息被误标——`message_end→message.updated` 的 info.role 恒为 const 'assistant'（pi-events.ts:29），用户 prompt 也走此路径 → trajectory turn_start（要求 role=user）对 pi 从不触发；tokens 也不达 trajectory（collector 要求 info.finish&&info.tokens）。
- **N3**：现有 opencode drop 行对 SDK 1.18.21 过时——`session.next.tool.started/updated/ended` 不存在于任何 union；真名是 `tool.called/progress/success`。若 2.x serve 今日双发 next 族，这些会落 unmatched（default-deny 拦截）。
- **N4**：pi 引擎错误产生合成 assistant 失败消息 → 桌面看到空 assistant 消息而非错误面（F1 修复的 UI 侧症状）。
- **N5**：`session.error` 的 v2 payload 是 8 成员错误 union（含 MessageAbortedError）——@v2 方言 turn.failed vs turn.aborted 的判别源。
- **N6**：dsh `step` = 原生 model-cycle 边界（官方定义"one model call plus the tool executions it requested"）——canonical step 词汇在 dsh 有直接原生锚点。
- **N7**：dsh `turn/end` 的 TurnEndReason 枚举：`completed | aborted{cause: user|parent|hook|disposed|legacy} | blocked | error{LlmFailure} | max-tokens | interrupted`——turn.failed/aborted 合成的现成判别字段。
- **N8**：dsh 审批请求不带工具参数（toolName+callId 关联已流出的 tool/call）——permission.asked 载荷按 callId join。
- **N9**：dsh 官方桥接包 `dsh-hooks-codex`/`dsh-hooks-claude-code` 映射表（SessionStart→agent/session-start、UserPromptSubmit→agent/pre-step、PreToolUse→tools/pre-execute、PostToolUse→tools/post-execute、Stop→agent/turn-stopping）= 认知面跨平台对照的现成测试向量。
- **N10**：Codex 双面警告——v2 = `codex-rs/app-server` JSON-RPC（camelCase）；npm `@openai/codex-sdk` 0.163.0 = exec-JSONL（snake_case，无审批无 steer）。adapter 面选择：app-server v2。
- **N11**：dsh 版本钉扎——词汇匹配 master；npm rc 版滞后（无 system/message、assistant/attempt、session/resume、session/wait；有旧词 assistant/chunk、todo/write）。adapter 锁 master 提交或等 release。
- **N12**：Codex v2 更多可映射通知：`thread/compacted`（比 ContextCompaction item 更贴 session.compacted）、`thread/name/updated`、`thread/queue/changed`、`item/plan/delta`、`item/reasoning/summaryTextDelta`、`hook/started|completed`；额外 ThreadItem 类型（hookPrompt、functionCallOutput、dynamicToolCall、collabAgentToolCall、subAgentActivity、webSearch、entered/exitedReviewMode）可经 part.updated 透传。

## 5. 待裁决清单（设计文档需覆盖）

1. ~~F8 pi turn.started~~（已裁决：agent_start → turn.started）
2. ~~F10 dsh 审批面~~（已结案：approval/asked+decided + ctx.approval waterfall）
3. **pi live 工具事件桥接方案**（N1）：tool_execution_* 直接映射 vs 扩展内推原语（同审批桥）
4. **Codex adapter 面选择**：app-server v2（JSON-RPC spawn）——确认，npm SDK 不用
5. **dsh 钉扎策略**：master commit 锁定 vs 等 npm release
6. opencode@v2 历史：新扁平端点 `/api/session/{id}/message` 在 2.1.0 服务端可用性实测；不可用则走 legacy 端点 + egress 翻译
7. F3 usage 所有权修订对 10-12 spec 的显式修订流程
8. +turn.started 的 5 点 guard chain（F12）
9. egress shim（flat→`{info,parts}` 单点转换，SSE 广播 + 历史服务出口）与 Phase 2 拆除
10. 依赖下沉（@opencode-ai/sdk、@earendil-works/pi-coding-agent 挪出 gateway package.json）与核心清洗（/api/opencode-config、MAFW_OPENCODE_PASSWORD、SQLite 直读、auth.json）
11. conformance 门禁：tests/unit/runtime/ 套件扩展为"任何 adapter 必过"，支持对 file plugin 跑
