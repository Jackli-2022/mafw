# 04 · pi（earendil-works/pi）+ dsh（DeepSeek Harness）契约缺口研究

> 调研日期 2026-10-22。只读网络调研；判定基线 = MAFW gateway 契约 v3（消息 DTO / 事件 / Runtime 动词）。
> 证据档位说明：pi 与 dsh 的全部能力点均直接取自两仓库 master/main 分支的官方文档与包 README（URL 逐条附注），未做源码级逐行验证；npm 版本与 HEAD commit 经 registry / GitHub API 钉扎。个别标注【推断】处为从文档措辞合理外推，未逐字见源码。

---

## ① 身份与版本钉扎

### pi

| 项 | 值 | 证据 |
|---|---|---|
| 身份 | **badlogic/pi-mono 已整体迁移为 `earendil-works/pi`**（GitHub 访问 badlogic/pi-mono 301 重定向至 earendil-works/pi；作者 Mario Zechner，现挂 earendil-works org） | https://github.com/badlogic/pi-mono → https://github.com/earendil-works/pi |
| 定位 | "AI agent toolkit: unified LLM API, agent loop, TUI, coding agent CLI"；117k stars / 7043 commits / MIT | repo README |
| npm 作用域 | **`@mariozechner/pi-*` 已死，全部改名 `@earendil-works/pi-*`**（旧方言表若引用旧包名需更新） | repo README 包表格 |
| HEAD | `58c0b02ce5`（2026-10-21T22:29:24Z，"Add [Unreleased] section for next cycle"） | GitHub API commits |
| npm 最新 | `@earendil-works/pi-coding-agent@1.4.0`（发布 2026-10-21T22:48:58Z） | registry.npmjs.org |
| Monorepo 包 | `@earendil-works/chord`（跨进程对象/热重载/RPC 宿主）、`pi-telemetry`（厂商中立遥测契约）、`pi-ai`（统一 LLM API）、**`pi-durable`（实验：durable agent harness）**、`pi-agent-core`（agent 循环）、`pi-coding-agent`（CLI）、`pi-tui`；另有独立仓库 `earendil-works/pi-chat`（Slack/聊天自动化） | repo README |
| 关键姿态 | 明确**不内建**权限系统（靠扩展 + 容器化：Gondolin micro-VM / Docker / OpenShell 三模式）；**默认不做子代理与 plan mode**（留给扩展/pi-durable 构建） | README "Permissions & Containerization"；README 首段 |
| ⚠️ BudgetGuard | **早期调研中的 BudgetGuard 在当前仓库已检索不到**（pi-ai / pi-agent-core / coding-agent 文档均无；token 预算仅剩 `thinkingBudgets`、compaction `reserveTokens/keepRecentTokens`、pi-durable `retry.maxRetries` / `stream.timeoutMs`）。即：**pi 当前没有每-run 成本/轮次上限**。我方基线的 `maxCostUsd/maxTurns` 反而领先两平台 | packages/ai/README.md、packages/agent/README.md、packages/durable/README.md 全文 |

**pi 证据源清单**（下文引用缩写）：
- PI-README: https://github.com/earendil-works/pi/blob/main/README.md
- PI-RPC: …/packages/coding-agent/docs/rpc.md；PI-RPCCMD: …/docs/rpc-commands.md；PI-JSON: …/docs/json.md
- PI-EXT: …/docs/extensions.md；PI-SDK: …/docs/sdk.md；PI-COMPACT: …/docs/compaction.md；PI-VM: …/docs/virtual-models.md
- PI-AI: …/packages/ai/README.md；PI-AGENT: …/packages/agent/README.md；PI-DURABLE: …/packages/durable/README.md；PI-CHORD: …/packages/chord/README.md
- PI-TOOLS: …/packages/coding-agent/src/core/tools/（bash/edit/find/grep/ls/powershell/read/write.ts）

### dsh

| 项 | 值 | 证据 |
|---|---|---|
| 身份确认 | **dsh = DeepSeek Harness，DeepSeek AI 官方开源 agent harness**：`github.com/deepseek-ai/deepseek-harness`，"everything-is-a-plugin" 架构，基于 **Cordis**（cordiverse/cordis；设计论文 arXiv:2608.25512《A Programming Paradigm for Spatiotemporal Composability》）。此前调研的身份结论成立，且 npm 包名确认为 `@deepseek-ai/dsh` | repo README；docs/cordis-primer.md |
| 阶段 | **developer preview，明示将有破坏性变更**；提供 Web UI（`dsh web` 默认 127.0.0.1:3080）、headless 一次性、REPL、profile 体系 | README "Developer preview" |
| HEAD | `687f282e86`（2026-10-17T07:22:43Z，merge "release-dsh-0.2.1-rc.2"） | GitHub API commits |
| npm 最新 | `@deepseek-ai/dsh@0.2.1-rc.2`（发布 2026-10-17T08:36:31Z） | registry.npmjs.org |
| 文档站 | https://deepseek-harness.github.io/deepseek-harness/（中英双语） | README |
| 生态 | 插件市场（`dsh plugin --profile web add "github:<owner>/<repo>#<commit>"` 钉 commit 安装）、`dsh-plugin` GitHub topic、Discord；社区 awesome 清单 | README；awesome-deepseek-harness |

**dsh 证据源清单**（缩写）：
- DSH-README: https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md
- DSH-LIFE: …/docs/agent-lifecycle.md（turn/step 时序图，生成维护）
- DSH-EVT: …/docs/event-producer-consumer.md（**事件×生产者×消费者全矩阵，脚本生成**）
- DSH-GW: …/docs/api-gateway.md（Typert 网关）；DSH-SEAMS: …/docs/capability-seams.md（全 seam 表，脚本生成）
- DSH-GLOSS: …/docs/glossary.md；DSH-TOOLCAT: …/docs/tool-catalog.md
- DSH-SESSION: …/docs/subsystems/session.md；DSH-TODO / DSH-APPROVAL / DSH-SUBAGENT / DSH-SPILL / DSH-GOAL / DSH-TOKENMETER / DSH-WORKTREES: …/docs/subsystems/<name>.md
- DSH-SDKPROTO: …/packages/sdk/protocol/README.md；DSH-SDK: …/packages/sdk/README.md

**dsh 官方词汇表钉扎**（DSH-GLOSS，判定"等价物"时的权威对照）：
- **turn**＝一次 admitted input 的排空（模型+工具停或终态策略介入）；**step**＝一次模型请求+其引发的工具执行（turn ⊃ steps）；**round**＝外层策略迭代（goal round / Ralph round）；**exchange**＝从首个 admit 人类输入的 step 起到下一个此类 turn 的连续 turns（chat 折叠单位）
- **seam**＝可替换能力（Service Definition + Providers + Consumers 三角色）
- **scope/shadowing**＝按 agent 的注册作用域，scoped 同名工具/段落覆盖全局（most-specific-wins，per-agent 工具变体机制）；restriction（`tools.restrict`）过滤全局集
- **goal / goal round / goal activation**（armed/disarmed，刻意不入持久层，resume/fork 后需人工再授权）
- **Ralph loop**＝前台 fresh-agent 工作流（不可变目标、每轮全新子会话、共享 workspace + 有界结构化 handoff 报告）

---

## ② pi 能力面全枚举 vs 基线

### 2.1 消息与内容块模型（pi-ai / pi-agent-core）

- **Context = `{ systemPrompt, messages, tools }`，纯 JSON 可序列化**；Model 对象也是纯数据（无函数），"哪个模型在用"可 `JSON.stringify` 持久化（PI-AI "Context Serialization"）。
- 消息角色：`system / user / assistant / toolResult` + **AgentMessage 声明合并自定义角色**（`CustomAgentMessages`，由 `convertToLlm` 决定如何投影进 LLM 消息）（PI-AGENT）。
- assistant 内容块：`text / thinking / toolCall`，消息级 `stopReason`（pending/stop/length/toolUse/error/aborted）、`usage`（含 cacheRead/Write 与 cost）、`responseId`（provider 上游 id，可选）（PI-AI "Stop Reasons"）。
- **中途 system 消息**：`content`（追加指令）+ `sections`（命名段落替换，null 删除）+ `toolsAdded / toolsRemoved`；重放规则 `getCurrentSystemPrompt/getCurrentTools`；对支持 mid-conversation 的模型原位发送以**保住 prompt cache**（Anthropic `inline-tools-2026-09-15` beta 的 tool_addition/tool_removal 块、OpenAI Responses `additional_tools`、Kimi 风格 tools 消息）（PI-AI "System Messages"）。
- **跨 provider 上下文交接**：换模型自动变换（异模 assistant 的 thinking 块被丢弃——签名/加密推理只对原模型有效；tool call/text 原样保留；aborted 部分消息可入上下文继续）（PI-AI "Cross-Provider Handoffs"、"Continuing After Abort"）。

### 2.2 原始流事件面（pi-ai）

- 10 种流事件：`start / text_start|delta|end / thinking_start|delta|end / toolcall_start|delta|end / done / error`；每个非终态事件带 `partial`（共享的"至今为止"助手消息，故意非快照）；`contentIndex` 关联块；**块间事件可交错**（同一上游 chunk 可能产出 text+toolcall 交错 delta）（PI-AI "Complete Event Reference"）。
- `toolcall_delta` 内嵌**部分 JSON 渐进解析**（arguments 至少 `{}`）；Google 不支持函数调用流（单发全量）。
- `onPayload`（provider 请求载荷观测）、`onProviderStreamEvent`（provider 原始解析事件，规范化前，只读）（PI-AI）。
- 思考等级：`off/minimal/low/medium/high/xhigh/max`（xhigh/max 模型专属 opt-in，`getSupportedThinkingLevels` 探测）；`thinkingBudgets` 自定义每级 token 预算；模型级 `thinkingLevelMap`；provider 侧 `thinkingEnabled/thinkingBudgetTokens/reasoningEffort/reasoningSummary`（PI-AI "Thinking/Reasoning"）。

### 2.3 agent 循环（pi-agent-core）

- 事件：`agent_start / turn_start / message_start|update|end / tool_execution_start|update|end / turn_end(message, toolResults) / agent_end(messages, willRetry)`；`agent_end` 上还有 awaited subscriber 结算屏障（PI-AGENT）。
- **steer / followUp 双队列**：`steeringMode/followUpMode = one-at-a-time | all`；`peekQueuedMessages()` 不消费预读；`clearSteeringQueue/clearFollowUpQueue/clearAllQueues`；steer 注入点 = 当前 assistant turn 的工具执行完之后、下一次 LLM 调用之前（PI-AGENT "Steering and Follow-up"）。
- 钩子：`beforeToolCall`（block + `terminate:true`）、`afterToolCall`（改写结果/terminate）、`prepareRequest`（每次 provider 请求前重建上下文）、`finishTurn`（返回 `{action:'end'|'continue'}` 控制 run 终止/续一轮；error/aborted 硬退出忽略）（PI-AGENT）。
- **`terminate:true` 批共识早停**：仅当一批内所有已完成工具结果都 terminate 才跳过自动 follow-up。
- 工具执行模式：全局 `parallel`（默认，完成序发事件、assistant 源序持久化）/`sequential`，且可**每工具 `executionMode` 覆盖**（任一 sequential 工具被调则整批串行）（PI-AGENT）。
- 低层 `agentLoop / agentLoopContinue` 观察性流（不做事件处理屏障）。

### 2.4 coding-agent：RPC / JSON / SDK / 扩展（我方网关的最直接对照物）

**四种宿主形态**：interactive TUI、print、`--mode json`（一次性 JSONL）、`--mode rpc`（长驻子进程，stdin 命令/stdout 事件 JSONL，严格 LF 帧、Unicode 分隔符警告、背压、ID 关联、`disposition` 语义 started/queued/handled）（PI-RPC）。

**RPC 命令全集**（PI-RPCCMD，33 个）：
- 提示类：`prompt`（`streamingBehavior: steer|followUp`；`images`；extension 命令即时执行）、`steer`、`follow_up`、`abort`、**`clear_queue`（撤销排队并返回文本）**、`new_session`（可带 `parentSession`，可被扩展取消）
- 状态：`get_state`（model/thinkingLevel/isStreaming/isCompacting/steeringMode/followUpMode/sessionId/sessionName/autoCompactionEnabled/messageCount/pendingMessageCount）、`get_messages`
- 模型：`set_model / cycle_model / get_available_models`（完整 Model 对象含 cost 表）
- 思考：`set_thinking_level / cycle_thinking_level / get_available_thinking_levels`
- 队列模式：`set_steering_mode / set_follow_up_mode`
- 压缩：`compact`（customInstructions；返回 summary/firstKeptEntryId/tokensBefore/estimatedTokensAfter/usage）、`set_auto_compaction`
- 重试：`set_auto_retry / abort_retry`
- **Bash 直执行**：`bash`（流式 `bash_execution_update`、`excludeFromContext`、截断 `fullOutputPath`；输出在下一次 prompt 才进模型上下文）、`abort_bash`
- 会话：`get_session_stats`（tokens/cost/**contextUsage {tokens, contextWindow, percent}**）、`export_html`、`switch_session`、**`fork`（entryId）、`clone`（复制当前分支）**、`get_fork_messages`、**`get_entries`（`since` 游标 + `leafId`，含压缩前历史与废弃分支）**、**`get_tree`（会话条目树）**、`get_last_assistant_text`、`set_session_name`
- 发现：`get_commands`（extension 命令/prompt 模板/skills，含 source/scope/origin 元数据）

**JSON/RPC 事件全集**（PI-JSON）：`agent_start`、`agent_end(messages, willRetry)`、**`agent_settled(aborted)`**（无自动延续的终极信号）、`turn_start/turn_end`、`message_start/message_update(usage+assistantMessageEvent，线上 delta-only)/message_end`、`tool_execution_start/update(partialResult)/end(durationMs)`、**`queue_update(steering, followUp 全量队列)`**、`entry_appended`（扩展自定义条目）、`session_info_changed`、`thinking_level_changed`、`compaction_start(reason: manual|threshold|overflow)/compaction_end(result, willRetry)`、**`auto_retry_start(attempt,maxAttempts,delayMs,errorMessage)/auto_retry_end(success,finalError)`**、`summarization_retry_scheduled/attempt_start/finished`、`bash_execution_update`、`extension_error`；另有 **RPC 扩展 UI 子协议**（把扩展的对话框/通知转发给 RPC 客户端）。

**扩展系统**（PI-EXT，我方网关"能力注入"对照）：
- **25+ 生命周期事件**：input、before_agent_start、agent_start/end、turn_start/end、**context / context_with_system**（单次请求的上下文变换）、**before_provider_headers / before_provider_request（链式变换）/ after_provider_response / provider_stream_event**、message_start/update/end（可替换最终消息）、tool_call（拦截/改参/阻止）、tool_execution_*、tool_result（链式脱敏/替换）、**agent_before_settle（追加条目 + `continue:true` 请求最后一次延续）**、agent_settled、session_start/shutdown、session_before_switch、session_before_fork、**session_before_compact（取消或自定义摘要）/ session_compact_failed**、session_before_tree、resources_discover、**project_trust**、user_bash、**cache_warming_decision**（覆盖空闲 prompt-cache 预热）、mcp_servers_change。
- 组合语义分类表：notification / in-place mutation / chained transformation / gate / actionable boundary / last override —— **钩子返回类型的效应契约**（比"事件"更进一步）。
- ExtensionAPI：`registerTool`、`registerCommand`、`registerShortcut/registerFlag`、`sendUserMessage/sendMessage(triggerTurn)`、**`appendEntry`（持久化非上下文会话条目）**、会话控制、`registerProvider`、**`registerMcpServer/unregisterMcpServer`**、**`registerVirtualModel`**、`registerToolRenderer`；`ctx.executeTool`（嵌套工具调用，`parentToolCallId`，id 由 pi 分配 `<parent>/<n>`，transcript 保留有界 nestedCalls 记录：8KiB/调用、32KiB/结果、≤256 条上限 + `complete:false` 丢失标记）。
- **工具暴露等级**：`direct / model-only / codemode / deferred / hidden` + `namespace{name,aliases,description,instructions}` + **`annotations`（MCP 语义 hints：readOnlyHint/destructiveHint/idempotentHint/openWorldHint，权限扩展据此决策）** + `reachesTools(input)` 声明 + `prepareLoadout(loadout)`（编排工具动态改写模型可见声明集）；`pi.setActiveTools/getAllTools` 动态激活。
- 工具结果三通道：`content`（模型）+ `details`（UI/状态重建）+ **`outputSchema/structuredContent`（程序化调用方）**；`isError:true` 仍可带结构化数据。

**内建工具**（PI-TOOLS 源目录）：`read / write / edit / ls / find / grep / bash / powershell`（+ file-mutation-queue 读改写串行化）；内建扩展：**codemode**（模型写 JS 在 QuickJS 沙箱内调用工具）、**tool_search**（deferred 工具检索激活）、**MCP**（mcp.json stdio/http+oauth，exposure 控制）；资源体系：extensions / skills / prompt templates / themes / **Pi packages（npm 或 git 分发扩展+技能+模板+主题包）**，user/project/temporary 三作用域 + project_trust 信任门（PI-README、PI-SDK）。

**压缩与分支摘要**（PI-COMPACT）：阈值 `contextWindow - reserveTokens(16384)` 触发、`keepRecentTokens(20000)` 保留；**每模型 override**（`compaction.modelOverrides`）；**溢出恢复顺序**（turn_end→agent_end→context_edit 省略→压缩→全新 run 重试）；split user-message span 双摘要合并；**BranchSummaryEntry**（/tree 导航时对被弃分支做摘要注入新分支，readFiles/modifiedFiles 跨压缩/跨分支摘要累积）；结构化摘要格式（Goal/Constraints/Progress/Key Decisions/Next Steps/Critical Context + 文件清单）。

**Virtual Models**（PI-VM）：扩展注册"可选但每次请求路由到物理模型"的虚拟模型；`route(request, ctx)` 理由 `user/continuation/retry/direct`；**sticky 上一成功模型保 cache/签名**；**路由状态 JSON 随会话分支持久化、跨压缩存活**；jev-router 示例（classify 选模型）。

**SDK**（PI-SDK）：`createAgentSession`（modelRuntime/settingsManager/sessionManager/resourceLoader/tools 全部可替换）；`prompt/steer/followUp/abort/waitForIdle`；**`AgentSessionRuntime.newSession/switchSession/fork/importFromJsonl`**；内联扩展工厂（`builtin:<name>`）；内存 SessionManager 选项。

### 2.5 pi-durable（实验包，但能力面巨大）

Durable agent harness：**commit 先于展示**，进程死亡后重开 storage 从检查点续跑（PI-DURABLE）：

- **任务模型**：一切皆 durable 任务（`pi.generation` 拥有 `pi.tool` 子任务）；状态机每步存检查点；`waiting {on, policy: failFast|allSettled}`、`completing`（结果已定但等归属工作收尾）、**自底向上 abort**；`harness.taskGraph()/watchTaskGraph()` 任务图观测。
- **崩溃环停车**：每个任务被崩溃/逐出切断计数，达 `settings.restartLimit`(默认5) 后 **parked**（inspect 显示 blocked: restart_limit，`retryTask(id)` 手动重放；`onReport` 收 `task_parked`）。
- **幂等提交**：`submit({..., requestId})` 重试同 ID 返回既有 submission；`harness.submission(id)` 重取。
- **睡眠/唤醒**：`runtime.sleepUntil` 存储型睡眠（无存活 invocation、跨重启）；**`onWake` 协议适配可逐出宿主**（Cloudflare Durable Object alarm 示例代码在 README 内）。
- **inbox 语义**：busy 时提交排队 `pi.inbox`；`whenBusy: steer|followUp|reject`；**write 条目永不排队**（reset 除外）即时入 transcript；`submission.abort()` 撤回排队项；`afterFailedRun: continue|withdraw` 失败后队列处置。
- **reset/handoff**：`root.reset(handoffNote)` 重置上下文（旧条目保留在 storage）；工具可 `control:{handoff:"..."}`。
- **工具**：read/write/edit/bash（CodingTools）；**三通道结果 + `structuredOutputSchema` 校验**；`callers: model|tools`（谁能调）；`modelTools` 收窄模型可见集；`deferred:true` + tool_search；**`replay:"safe"` 工具崩溃后重放**（否则模型收到 `interrupted` 错误结果+已提交输出）；**嵌套调用按键重挂**（崩溃重放同序调用 reattach）；`api.executeTool`；工具可用 `models.classify()/generateImages()`。
- **Code Mode**：QuickJS 沙箱脚本，**确定性重放日志（虚拟时钟/种子随机/UTC）**：重启后重跑脚本并按 journal 回放结果，路径变化即报错。
- **环境抽象**：`env({conversation cwd})` 每会话一个执行环境（可一会话一容器）；argv 直接 exec（无 shell）；`listFiles()` 可选；环境一致性 conformance 套件。
- **per-conversation agent**：`pi.agent` 文档存 model/thinkingLevel/extensions/tools/modelTools/instructions/cwd，`configure()` 单 commit 修改；fork 继承 fork 点 agent。
- **背景压缩**：`backgroundTokens`（距阈值还远时后台先压缩）；手动 `compact()`、溢出压缩重试一次；压缩失败时 generation 直接失败（inputs settle unanswered: model_error）。
- **watching**：`viewState()`（Chord 只读状态：entries + pi.live 流式部分/重试/嵌套工具 + inbox/usage/agent/provider）；`watch()` 交付**精确 commit ops 增量**（慢消费者 100 帧后折叠为最新全量）；**`watchEvents()` 从 commit 派生 coding-agent 风格事件**（snapshot + 事件批）。
- **存储后端**：Memory / IndexedDB（浏览器）/ SQLite（Node WAL）/ JSONL（fsync 选项）/ **Cloudflare Durable Object SQLite**；`registerStorageConformance` 后端一致性套件；表前缀命名空间。
- **usage**：每会话 `pi.usage` 按 provider/model 与**按工具名**（工具回报 usage）累计，含失败/aborted 尝试。
- **子代理**：task-owned 子会话（ownership 索引使 replay-safe 工具重放时复用既有 child）；前台子代理 + **后台持久子代理**（spawn/steer/stop/list，reporter 任务把答案作为 follow-up 回投父会话，requestId 防重启重复投递）。
- **遥测**：`DURABLE_TELEMETRY_SCHEMA`（pi.durable.submit/phase spans、entry/submission/checkpoint/replay 事件、phase.duration/tasks.active 指标；**OTel trace carrier 存进 submission/task JSON**）。

### 2.6 chord（底座）

跨进程对象运行时：**contract（TypeBox）+ local/remote/method/opaque**；**principal（owner vs guest 得到不同对象与方法集）**；state = 可观察 JSON（快照+delta）；**热重载**（in-flight 工作在旧代码上完成、不兼容变更在安全点迁移）；links：memory / Node IPC / WebSocket；Node 子宿主进程（createHostManager/forkDriver）；delta 追踪（string append/front-truncate/splice/permutation/set/delete）；有界输出（OutputBuffer 头/尾窗口）与自适应进度提交；SQLite 遥测存储（7 天保留）（PI-CHORD）。

### 2.7 pi vs 我方基线逐项判定

| 我方基线项 | pi 等价物 | 判定 |
|---|---|---|
| MafwMessage flat（text/reasoning/tool快照/image/file/step-* parts） | Context 消息 + 内容块；**自定义角色声明合并**、system sections、三通道工具结果 | PARTIAL（pi 无 file part；但自定义角色/sections/结构化输出超出我们） |
| turn.started/completed/failed/aborted | turn_start/turn_end + stopReason 词汇 + TurnEnd 细分在 dsh | PARTIAL |
| part.delta/updated/complete | text/thinking/toolcall start-delta-end（contentIndex） | HAVE（粒度等价） |
| tool.call/delta/result | tool_execution_start/update(partialResult)/end + tool_call/tool_result 扩展钩子 | HAVE（pi 另有部分 JSON 渐进解析） |
| prompt delivery:'steer' | prompt.streamingBehavior steer/followUp + **独立 steer/follow_up 命令 + 队列模式 + queue_update + clear_queue** | PARTIAL（我们只有 steer 单语义） |
| maxTurns / maxCostUsd | **无（BudgetGuard 已不存在）**；仅 thinkingBudgets / compaction 预算 | **我们领先**（pi 缺失） |
| fork(sessionID,messageID) | fork(entryId) + clone + get_tree/get_fork_messages | HAVE（且 pi 有分支摘要/树导航超出） |
| permissionReply(once/always/reject) | 无内建权限；扩展 tool_call 拦截 + RPC Extension UI 对话框转发 | PARTIAL（机制在但非契约） |
| questionReply | 扩展 ctx.ui（RPC 转发）；durable 无 | PARTIAL |
| 工具注册(JSON Schema) | TypeBox + annotations + exposure + outputSchema | PARTIAL（类型系统不同 + pi 超出部分多） |
| credentials | CredentialStore（modify 序列化 OAuth 刷新）+ getAuth/checkAuth + OAuth 流 + transformHeaders | PARTIAL（pi 更全） |
| 历史 normalize(恒 flat) | get_messages / get_entries / deriveMessages(dsh) | HAVE |
| agent 进程管理 restart | 扩展 reload（运行时替换）+ SDK dispose；无 RPC 级 restart | PARTIAL |
| session.compacting/compacted | compaction_start/end(reason, willRetry) + session_before_compact 钩子 | PARTIAL（pi 多出 reason/willRetry/钩子） |
| usage.updated | message_update.usage 累计 + get_session_stats + pi.usage 文档 | HAVE |
| plan.updated(todo) | 无内建（README 明示不做 plan mode；todo.ts 是扩展示例；durable 例 27 是只读 plan mode 扩展） | MISSING（有意缺失） |

---

## ③ dsh 能力面全枚举 vs 基线

### 3.1 会话 = 追加式事件日志（核心哲学差异）

`Session` 是 **append-only 的类型化 SessionEvent 日志，单一事实源**；LLM 消息历史是**派生投影**（`deriveMessages()`，缓存+深冻结）；replay = 重放派生（DSH-SESSION）。事件词汇（`SessionEventMap`，**声明合并可扩展**——插件可加事件类型，switch 不得 assertNever）：

- 结构：`turn/start {turn}`、`turn/end {turn, reason}`（**TurnEndReasonMap：completed | aborted(AgentCancelCause) | blocked | error(结构化 LlmFailure) | max-tokens | interrupted(崩溃恢复合成) | forked(fork 种子合成)**）、`step/start|end`
- 消息面（**SurfaceEventType**）：`user/message`（source 区分 人类prompt / `agent.inject()` 注入上下文（文件变更、AGENTS.md、技能内容、cron 通知…）/ goal 续轮）、`developer/message`、`system/message`（surface node 0；in-history 路由可追加/替换后续节点）、`assistant/message`（**内嵌精确压缩的 timed stream + usage + interrupted 标记**；空内容不进派生历史）、`tool/result`（isError + `error {name, code, reason}` 失败身份 + **`meta` 工具私有呈现载荷**）
- **`assistant/attempt`**：提交了内容但未产出 surface 消息的失败/重试/取消尝试，**内嵌原始流**（重试可见性的持久化）
- `tool/call`（arguments 为模型原样未解析 JSON 串）
- **`request/header`**（EpochHeader = LlmCallConfig + adapterDefaults + 组装 ToolSchema；reason: initial/resume/change/**series**；**每次请求是日志的纯函数**——可重构性契约）；`request/context`（路由元数据：provider/model/contextWindow/systemPromptUpdate）
- `session/end-seed`（fork 继承前缀切分标记，仅构造器/buildForkSeed 可写）
- **前向兼容契约**：未知事件带 `ignorable:true` 才可跳过，否则读取方**必须拒绝重构**（fail-closed 前向兼容）
- **Surface 语义**：`surfaceOp: append | {replace, startSeq, endSeq}`（压缩用替换区间遮蔽）；`sourceEventSeqs` 溯源引用；`replaceGeneration/contentGeneration` 代数；**插件消息投影**（`@messageProjection` 事件改写既有消息内容，如 image-offload）
- 插件记录：`plugin:*` 命名空间（ignorable）；hook 桥接的 `hook/invoked / hook/result`（按 handlerId 关联）
- `SessionStore.fork(source, boundary?, childSessionId?)`：**必须切在 turn 边界之间**（开着 turn 的前缀拒绝而非静默裁剪）；开尾 fork 种子合成 tool result/step/turn 关闭器

### 3.2 Cordis 事件族全枚举（DSH-EVT 生成矩阵，~60 事件）

**派发模式四类**：`emit`（通知）、`serial`（串行终态检查点）、`waterfall`（瀑布可变换/否决）、`parallel`（并行全等待）；**scope 过滤派发**（agent 作用域监听者只收本 agent 事件）。

- **agent/\***（live 协调面）：`created`(serial)、`disposed`、`error`、`status`(running/idle)、`assistant-stream`（瞬态流块；replay 读 durable settlement）、**`inbox/inserted / inbox/claimed {message,turn} / inbox/discarded / inbox/spliced`**（结构化收件箱）、**`pre-step`（waterfall；返回 reject 或 enter(messages)，权威）**、`request`（waterfall）、**`request-error`（waterfall；返回重试动作或保留原错误）**、`turn-stopping`（serial 终端检查点）
- **tools/\***：`change`、`execute`（waterfall）、**`pre-execute` / `post-execute`**（waterfall）、`result`、**`ptc-dispatch-log`**（run_code 桥接子调用）
- **system-prompt/assemble**（waterfall 段落组装）、`system-prompt/change`
- **llm/stream**（waterfall——LLM 原始流 seam）、`llm/adapters-updated`
- **session/\***：`created`（同步 throw 否决+回滚）、`disposed`、**`session/event`（post-commit fire-and-forget 追加 feed）**、**`session/flush`（parallel 持久化检查点屏障）**
- **approval/request**（waterfall answerer 链）、**`user-questions/request`**（waterfall）
- **subagent/start | end | provider-added | provider-removed**
- **api-session/added | removed | status | activity | error**（客户端列表投影）
- **workflow/start | phase | log | agent-start | agent-end | end**
- **goal/changed | goal/activation-changed**
- 周边状态：`schedule/changed`、`plugin-manager/changed|install-log|install-state`、`plugin-market/changed`、`commands/change`、`skills/change`、`settings/document-updated`、`credentials/record-updated|reference-updated`、`deepseek-account/*`（3）、`authorization/settled`、`fs/write-intent | edit-intent | observed`、`workspace/session-activity | session-stop`、`compaction/summary-error`（waterfall）、`feedback/committed`、`session-telemetry/record`（waterfall）、`hmr/change|reload`、`agent-preset/selected`、`app-boot/config-reload`、`connection/request`、`webserver/index-inject`、`cordis/dynamic-package|dynamic-retract|request-run*|inspect-query*`、`domain/changed`、`agent-loop/config-start-failed`

### 3.3 Typert API Gateway（DSH-GW）——"网关"的另一种解法

- `@Remote` / `@RemoteScope` 装饰器声明宿主方法；**构建期从 ts.Program 严格分析生成 Host+Client 双面契约**（invocation descriptor、zod schema、declaration map：编辑器可从客户端调用跳回宿主源码）
- **`RemoteStream<Out, In>` 双向流**：Host→Client 项流 + Client→Host uplink（`ctx.invocation.uplink()`，每项经生成 codec 校验），走多路复用 `/api/remote.mux` WebSocket 或进程内载体
- **二进制远程传输**（Uint8Array 含嵌套字段→multipart 响应）；RPC 信封外的精确 Fetch 路由
- **每次调用点名 Peer**；`ctx.remoteAccess` 基于**角色的访问策略**决定非 owner Peer 可调哪些方法、过滤列表结果、流式推送各 Peer 的访问快照
- **agent/session lookup 冷恢复策略**：复用活 Agent、自动恢复冷会话、**并发恢复去重**、subagent 所有权栅栏；错误码 `session/not-found`、`session/agent-busy`、`gateway/peer-disposed`、`gateway/lookup-unavailable`、`gateway/bad-request|cancelled|internal`
- 业务层组织 `remotes → gateway → connection → webserver`；插件热卸载会中止 in-flight 调用

### 3.4 SessionController 远程面（客户端 API，我方 Runtime 动词的超集方向）

`resolveAgent`、**`inspect`（不激活 Agent 的冷读）**、**`list`（不恢复 Agent 的行读）**、**`search`（按消息内容字面查询，ACL 过滤）**、`create`（可复用空白会话；location；**Agent preset**）、`selectModel`、`initializeDefaultModel`、`modelCatalog`（provider 分组+部署默认+隔离失败）、`rename`、**`fork`（冷可读前缀 + 精确边界 + 迁移预检）**、`prompt`（source 元数据 + 交付模式）、**`attachment`（带授权的持久附件读取）**、**`updateQueue`（变更仍排队的队列项！）**、**`cancel`（取消活动 turn 但不丢 pending inbox）**、**`page`（冷安全、消息对齐、向后游标分页）**、**`follow`（STREAM：打开快照 + 无缺口 durable 事件帧 + 可选无游标 assistant-stream 帧；以"调用方持有的最后已提交 seq"为续传游标）**、`projections`（精确投影读 + 迁移缓存提示）、**`control`（STREAM：完整 live-control 基线 + 替换帧）**、桌面交接 `canOpenWorkspacePath/workspaceDesktop/openWorkspacePath/workspacePathApplications`（DSH-SESSION Cordis API 节）。

### 3.5 SDK（stdio JSON-RPC，DSH-SDKPROTO）

- 7 个 client→server 请求：`initialize`（**`reasoningEffort`；`maxTokens` 为 SDK 创建的 agent 及其进程内后代设置每次输出上限**；路由在初始化期解析，失败则拒绝 session/prompt）、**`session/prompt`（durable enqueue 回执，messageId 标识排队用户消息）**、**`session/resume`（恢复持久会话；不发新输入；拒绝 missing/unreadable/incompatible/occupied）**、**`session/wait`**（等待 root 空闲**且进行中的受管后代工作完成**；带 parked 输入的空闲后代驻留不阻塞等待；wait 期间提交通知先于响应到达；未知 id / 无更新终态的活动失败→拒绝）、`session/working-directory/get|set`、`shutdown`
- 4 个 server→client 通知：`session.event`（**运行时全部会话、不过滤**）、`session.status`（整 agent running/idle）、`subagent.started`、`subagent.finished`（lastAssistantMessage；仅进程内）
- 明示限制：**无 cancel / 无 session-close**（放弃=杀进程）；无协议版本协商（serverInfo 0.0.1）；server→client 请求是"死能力"（为未来 approval 流预留）
- TypeScript 客户端 spawn `dsh --profile sdk`（带 profile 与有序 patch）；**Python SDK 镜像同一协议**（python/ 目录，捆绑运行时）

### 3.6 子代理与团队（DSH-SUBAGENT）

- **六种 provider**：`spawn`、`fork`（进程内 continuable，种子=父已完成 turn 前缀）、`acp`（Agent Client Protocol）、`codex`、`claude-code`、`dsh-sdk`（外部一次性执行）；能力旗标 `agentOptions/agentPreset/outputSchema/depthLimit`；`inheritsParentContext` 描述性声明
- `SubagentResult { output, structured?(outputSchema 校验通过的结构化结果), diagnostic(≤4096B 安全细节), stopReason: completed|aborted|error|max-tokens|refusal }`
- `delivery: parent | caller`；**`sendMessage`（相邻 agent 间模型 authored 消息；运行中目标在最近 step 边界注入，空闲目标开新 turn，缺席 continuable 子代冷恢复）**；**`interrupt`（authority: user 父地址 | ancestor 活体；fire-and-return；保留 inbox 与后代）**；`drainDescendants/drainChildren`；`waitForChildren`；`listChildren/listDescendants`（**父目录持久枚举**，external 为叶子，depth，unknown→unsupported 诊断）
- **归属区分**：`AgentMessageSource{kind:'agent-message'}` vs `SubagentSettledMessageSource{kind:'subagent-settled'}`（管理者陈述与子代自述不混同）
- **Ralph**（DSH-TOOLCAT / DSH-GLOSS）：`ralph` 工具 = 前台 fresh-agent 工作流，每轮全新子会话 + 共享 workspace + **Ralph handoff（状态/摘要/证据/下一步/阻塞的有界结构化报告）**，模型只选不可变目标与轮数上限
- **Agent Teams**（实验）：`spawn_teammate / team_task_create|get|list|update / wait_agent / send_message / interrupt_agent / list_agents` 九工具，Team Lead 隐式作用域

### 3.7 工具目录（DSH-TOOLCAT 全枚举，模型可见名）

`plugin_manager`、`plugin_market`；MCP 资源三工具（list templates/list/read）；**`run_code`（PTC 模式：工具注册表在该模式下唯一 wire 贡献，其余能力以生成 SDK 绑定暴露给程序，绑定按"提交序启动 + 策略 + 并发安全体重叠至 maxParallelSubCalls"调度，每个桥接子调用重入完整受保护管道并产 `tool/ptc-dispatch` 事件对；runtime 有 node/python 两实现）**；`exit_plan_mode`（经 user-questions 呈现计划审批，批准在 step 边界记 plan mode inactive；**非 plan 模式也保留 schema 以避免工具目录抖动**）；`bash`（+ `run_in_background` 走 jobs）、`pwsh`（Windows 方言）、**持久 `bash`/`pwsh`（PTY 会话、owner 隔离）**；`terminal_open/read/send/signal/close/list` 六 PTY 工具；`str_replace_editor`；`edit/read/read_image/write`（read_image 走持久附件 + 图片路由校验）；`glob/grep`（打包 ripgrep，超限经 spill 存全量）；`ask_user_question`（**`mode: timed` 可选：前台超时返回 pending 结果而问题仍可回答，答案以 late user/message 到达**）；`job_kill/job_list/job_output`（**类型无关后台作业控制**；后台完成经 agent.inject() 通知注入）；`schedule_create/update/list/delete`（after_seconds/绝对时间/固定率/每日每周 IANA 时区/**五字段 cron**；到期消息恢复原会话）；`create_goal/get_goal/update_goal`（complete/blocked 也可由模型发起）；`session_event_read/search/trace + session_search/trace`（五只读跨会话查询工具，游标隐藏、以调用 agent 会话授权）；`list_subagent_models/subagent/subagent_fork`；`interrupt_agent/list_agents/send_message`；`team_*`；`todo_write`；`working_directory`；`create_worktree`；`workflow`；`load_workspace_dependencies`；`web_fetch/web_search`；`lsp`（provider 隐藏在 seam 后，schema 稳定，缺 provider 报结构化 `LSP_UNAVAILABLE`）；`present`（deliverables 呈现）；`cordis_inspect_list/query`（creator 模式运行时检查）；浏览器 `stagehand_*` 六件（另有 playwright-mcp / chrome-devtools-mcp 变体）与 computer-use（CUA 驱动）；office-to-pdf 子系统。

### 3.8 关键 seam 语义（DSH-SEAMS + 各子系统文档）

- **approval**（DSH-APPROVAL）：结果封闭 `allowed-once | rejected | cancelled | unavailable`（**无 always**；缺答/抛错/越权→unavailable，fail-closed）；策略 `ask | never`（**durable：`approval/policy` 事件，replay 重建**；`never` 在 waterfall 之前强制，后注册 answerer 也绕不过）；`approval/asked + approval/decided` **审计对（log-only，不入模型 transcript）**；要求开 turn 内（审计对须被 commit/replay 边界包围）；answerer waterfall 首答占位；策略变化对模型经 runtime-context 快照可见
- **permission-presets**：目录化预设（`permission-presets/catalog-changed`）
- **plan-mode**：`plan/mode` 状态折叠、用户选择在 turn 边界 flush、`/plan`、plan-exit schema 跨转换稳定
- **todo**（DSH-TODO）：`TodoItem {content, status: pending|in_progress|completed}`，`todo/write` 全量替换（last-write-wins，无 id/priority/activeForm），log-only 事件 + replay 投影；`allowParallelInProgress` 无默认值、**目录必须声明选择**（true/false 得到不同工具描述）
- **goals**（DSH-GOAL）：`GoalSnapshot {objective, phase: active|paused|blocked|complete, blockedReason{code,message}, maxGoalRounds}` + CAS revision；`goal/change` durable 事件（全量快照或清除墓碑）；**goal round = 一次续轮（同会话 driver 物化为一个 goal-sourced turn）**，`roundsStarted` 只计 admitted user/message；**activation armed/disarmed 刻意不持久**（resume/fork 后需人工授权 resume）；`disarm`（卸 driver 前收回续跑权）；Remote 面 get/edit/pause/resume/complete/clear
- **compaction**：compaction-basic 用 `agent/pre-step`（压力）+ `agent/request-error`（溢出）；**工具结果先修剪（toolResultPruner：model-free、可重放单节点 surface 替换）再摘要**；image-offload（消息投影把图像替换为引用）；**step 内恢复重试**（不重复 assembly/pre-step/user admit；只有修剪或摘要推进了 surface 替换代数才重试）；`compaction/summary-error` waterfall
- **token-meter**（DSH-TOKENMETER）：**重放式测量**（`logRevision` 一致性）；按路由定价的表面节点（`TokenSurfaceNode.tokens`：图像按路由声明的视觉 token 定价 + 模型可见文本；`heuristicTokens` 影子价保 O(1) 折叠一致）；**usage 锚定**（最近成功调用同规范请求包络时复用其总量且不低于锚）；`totalTokens`（请求+响应压力）/`surfaceTokens`/`surfaceDeltaTokens`（带符号增减）
- **spill**（DSH-SPILL）：`saveText → {locator(不透明), bytes, retrievalHint}`；策略把超 `maxInlineTokens` 的文本/图像结果替换为**头/尾内容 + spill 地址**（best-effort，保存失败保留原内联结果）；会话域 0700 私有存储；**fork 继承既有 locator 不复制**
- **session-query**：接口（精确读/过滤/trace）+ sqlite 后端（全文对账、排序、摘要、游标代）；`session-projection(-cache)`：状态驱动折叠单元 + 持久投影缓存（controller 发基线+变更推送）
- **credentials**：配置持**引用**、provider 持值；**每操作解析**（轮换的凭据下一次请求即生效）；settings controller 暴露**无值视图 + 只写存储**；authorization 流程注册表（每 key 单次尝试生命周期）
- **sandbox / ssh / fs / shell / subprocess / terminals**：全部 seam 化多后端（local/ssh/windows-acl；fs-local/sandbox/ssh；bash/pwsh 本地与沙箱；持久 PTY 注册表）
- **hooks 桥接生态**：`hooks-claude-code` / `hooks-codex`（`@deepseek-ai/dsh-hook-protocol`：UserPromptSubmit/PreToolUse/PostToolUse/Stop 在开 turn 内触发→ `hook/invoked`+`hook/result` 日志对；SessionStart 在 turn 1 前无 hook 记录、上下文挂 inbox 等唤醒投递）；`claude-code-mods` 桥
- **LLM 适配器三件套**：`llm-deepseek`（+ `deepseek-llm-api-wire-extensions`：插件准备独立顶层字段、官方适配器合并并在 HTTP 接受后提交交付状态）、**`llm-pi-ai`（dsh 直接把 pi-ai 当 LLM 后端——两平台事实互通）**、`llm-replay`（测试回放）
- **插件运行时**：plugin-manager（profile、install state/log）、plugin-market（可配置索引源）、**HMR（序列化模块+配置重载）**、**cordis-host-runner（运行时动态挂载 Cordis 包：request-run/dynamic-package/dynamic-retract/inspect-query）**、inspector（跨 realm 运行时检查）
- **agent-preset-registry**：YAML 声明 preset 版本、agent 与冷读者绑定 scoped 贡献、退役版本保留至最后用户释放
- 其他：attachments（持久二进制附件，provider 适配器解析授权引用为 provider 原生内容；图像在会话事件前提交）、fileUploads（分段上传暂存）、message-feedback（逐 assistant 消息反馈 CAS + 会话级 feedback/record）、session-title（first-prompt-llm / all-prompts-llm）、session-reference（跨会话快照注入为 durable 不可信上下文）、speech-to-text（SenseVoice）、cot-translation（推理翻译）、otel/telemetry、storage（json/sqlite/domain）、workspace（workspace-changes 每 turn 变更文件摘要、tool-present deliverables）、office-to-pdf。

### 3.9 dsh vs 我方基线逐项判定

| 我方基线项 | dsh 等价物 | 判定 |
|---|---|---|
| MafwMessage flat | 派生消息 + Surface 事件模型（surfaceOp/sourceEventSeqs） | PARTIAL（模型不同：日志为源，消息为投影） |
| session.created/updated/deleted | session/created/disposed + api-session/added/removed/status | HAVE |
| turn.started/completed/failed/aborted | turn/start/end + **TurnEndReason 七分**（含 blocked/max-tokens/interrupted/forked） | HAVE（dsh 词汇更细） |
| message.updated / part.delta | agent/assistant-stream（瞬态）+ assistant/message 内嵌流 + session/event durable 帧 | HAVE（双通道：瞬态流+持久帧） |
| tool.call/delta/result | tool/call + tool/result（durable）+ tools/* waterfall + ptc-dispatch | HAVE（dsh 另有 pre/post 瀑布超出） |
| permission.asked/replied | approval/asked+decided 审计对 + approval/request waterfall + ask/never 持久策略 | PARTIAL（**无 always 授权**；但审计日志/策略持久化/answerer 链超出我们） |
| question.asked/replied/rejected | user-questions/request waterfall + ask_user_question（timed 模式 pending result + late user/message） | PARTIAL（timed 模式超出） |
| plan.updated(todo) | todo/write 事件 + plan/mode 状态 | HAVE（词汇更贫：3 态无 id） |
| prompt(delivery steer) | SessionPromptRequest（delivery 模式）+ inbox 事件族 + updateQueue + agent/inbox/claimed | PARTIAL（队列可观测/可变更超出） |
| maxTurns/maxCostUsd | 仅 SDK initialize `maxTokens`（含后代）；token-meter 测量但**无每 run 成本上限** | **我们领先**（dsh 亦缺 maxCostUsd） |
| abort | SessionController.cancel（不丢 inbox） | HAVE（语义更细） |
| fork(sessionID,messageID) | SessionStore.fork(boundary) / Remote fork（冷前缀+迁移预检）+ end-seed 血统 | HAVE（边界校验/血统标记超出） |
| permissionReply(once/always/reject) | allowed-once/rejected/cancelled/unavailable | PARTIAL（无 always） |
| 工具注册(JSON Schema) | ToolSchema 组装进 request/header；PTC 模式生成 SDK 绑定 | PARTIAL |
| credentials | credentials seam（引用/值分离、每请求解析、只写存储） | HAVE |
| 历史 normalize(恒 flat) | deriveMessages() 投影 + page/follow 游标读 | HAVE |
| agent 进程管理 restart | HMR（模块+配置序列化重载）+ agent/disposed | PARTIAL |
| session.compacting/compacted | compaction/*（merge 扩展事件）+ summary-error + 工具结果修剪 + image-offload | PARTIAL（dsh 管线更深） |
| usage.updated | assistant/message.usage 携带 + token-meter | HAVE |

---

## ④ 超出基线的前沿能力清单

判定：HAVE=基线已覆盖等价物；PARTIAL=有近似物但语义/覆盖不足；MISSING=基线无对应物。**仅列超出或值得吸收的能力**；两平台反向缺失（我方领先）附于表尾。

### A. 交付与队列语义

| # | 能力 | 平台表面 | 判定 | 对多运行时网关契约的意义 | 证据 |
|---|---|---|---|---|---|
| A1 | **steer / followUp 双队列 + 每类队列模式（one-at-a-time/all）+ queue_update 事件 + clear_queue/updateQueue 变更** | pi RPC（steer/follow_up/set_*_mode/clear_queue/queue_update）；dsh（agent/inbox/*、SessionController.updateQueue、pi-durable whenBusy: steer/followUp/reject） | MISSING | 我方 `delivery:'steer'` 只有单语义。双队列把"turn 边界改向"与"run 结束后排程"分离，且队列本身可观测、可撤销、可远程变更——多运行时网关需定义队列动词与事件 | PI-RPCCMD；PI-JSON；DSH-SESSION；PI-DURABLE "Busy Conversations" |
| A2 | **settled 二段终止：agent_end(willRetry) ≠ agent_settled；session/wait 等待语义（root idle + 受管后代完成；parked 后代不阻塞；通知先于响应）** | pi（agent_settled）；dsh（session/wait、TurnEndReason、durable completing 状态） | MISSING | "回复完成"在重试/压缩/排队/子代理下是分布式的。网关需一个权威"无自动延续"信号与可组合的 wait 原语（否则客户端要么轮询要么误判） | PI-JSON；DSH-SDKPROTO；PI-DURABLE |
| A3 | **步前拦截瀑布：agent/pre-step 权威 reject/enter(messages)（可换消息）；agent/request；agent/request-error 返回重试动作** | dsh waterfall | MISSING | 步级（step）输入准入是比 turn 级 permission 更细的控制面：拒绝、替换、注入消息都在 LLM 调用前；request-error 让插件接管重试策略 | DSH-LIFE；DSH-EVT；DSH-SESSION |
| A4 | **重试可见性：assistant/attempt（失败尝试内嵌原始流持久化）+ auto_retry_*（attempt/maxAttempts/delayMs/finalError）+ set_auto_retry/abort_retry** | dsh（assistant/attempt）；pi（auto_retry 事件族、RPC 命令） | MISSING | 我方 turn.failed 只见终态。多运行时网关要能呈现"第几次尝试、退避多久、最终错误"，且失败尝试不进模型历史但可审计 | DSH-SESSION；PI-JSON；PI-RPCCMD |
| A5 | **ask_user timed 模式：超时返回 pending 结果、问题仍可回答、答案以 late user/message 到达** | dsh tool-ask-user | MISSING | 我方 question.asked/replied 是阻塞语义；timed 模式支撑"无人值守优先、有人在线补充"的混合交互 | DSH-TOOLCAT |

### B. 会话持久化与读取

| # | 能力 | 平台表面 | 判定 | 意义 | 证据 |
|---|---|---|---|---|---|
| B1 | **事件溯源会话日志：消息为派生投影；surfaceOp replace{startSeq,endSeq}；sourceEventSeqs 溯源；ignorable 前向兼容（未知必须拒绝）；request/header 使每次请求为日志纯函数** | dsh SessionEventMap | MISSING | 多运行时统一持久层的最强解：压缩/投影/重放/审计全部一个日志；"请求可从日志重构"意味着任何运行时都能接管任何会话 | DSH-SESSION |
| B2 | **follow 游标流（打开快照 + 无缺口 durable 帧 + assistant-stream 瞬态帧；断线以最后已提交 seq 续传）+ page 向后游标分页 + projections 精确读** | dsh SessionController | MISSING | 我方事件流无断线续读契约。客户端持有的"最后 seq"即可恢复，是弱网/多端网关的刚需 | DSH-SESSION Cordis API 节 |
| B3 | **会话树与分支摘要：get_tree/get_entries(since, leafId) 游标、fork(entryId)/clone、BranchSummaryEntry（弃支摘要注入新支，文件清单跨代累积）** | pi coding-agent | PARTIAL（我们有 fork，无树导航/分支摘要/游标） | 分支是试验隔离的一等公民；"从任何 user message 再生一条历史"需要树与摘要配套 | PI-RPCCMD；PI-COMPACT |
| B4 | **durable 任务运行时：每步检查点、崩溃环停车（restartLimit→parked→retryTask）、requestId 幂等提交、sleepUntil 存储型睡眠 + onWake 逐出宿主协议（Cloudflare DO）** | pi-durable | MISSING | 我方 agent 进程管理只有 restart；pi-durable 证明"对话本身可崩溃恢复且防死循环"可成契约（parked 状态 + 人工 retry 是安全阀） | PI-DURABLE |
| B5 | **压缩管线深化：reason(manual/threshold/overflow)+willRetry；先 model-free 工具结果修剪再摘要；image-offload 消息投影；step 内恢复重试不重复 pre-step；session_before_compact 自定义摘要钩子；背景压缩（backgroundTokens）+ 每模型 override** | dsh compaction-basic/pruner/image-offload；pi compaction/PI-COMPACT | PARTIAL（我们有 compacting/compacted 两事件，无原因/管线/钩子） | 压缩是长会话的常态操作而非异常：原因码、修剪先行、自定义摘要、后台化都应进入契约 | DSH-SESSION/DSH-SEAMS；PI-COMPACT |

### C. 工具面

| # | 能力 | 平台表面 | 判定 | 意义 | 证据 |
|---|---|---|---|---|---|
| C1 | **工具暴露分级 + 治理：direct/model-only/codemode/deferred/hidden、namespace、MCP annotations（readOnly/destructive/idempotent/openWorld）、reachesTools、prepareLoadout 动态改写声明集、tool_search 延迟激活** | pi 扩展系统 | MISSING | 大工具集（MCP 时代）下"全部声明给模型"不可持续；annotations 是权限决策的标准元数据。我方工具注册只有 JSON Schema parameters | PI-EXT |
| C2 | **结构化工具结果：outputSchema/structuredContent（模型看 content、程序看 structuredContent、UI 看 details）；isError 仍带数据；子代理 outputSchema 校验的 structured 结果** | pi（工具+subagent）；dsh（SubagentResult.structured） | MISSING | 我方 tool.result 是快照 part；三通道 + 结构化校验让工具结果可被程序消费（跨运行时桥接的前提） | PI-EXT；DSH-SUBAGENT |
| C3 | **嵌套工具调用契约：ctx.executeTool（parentToolCallId、id=<parent>/<n>、有界 nestedCalls 记录带丢失标记）、dsh run_code PTC 模式（生成语言绑定、提交序+并发上限、每桥接调用重入受保护管道并产 ptc-dispatch 事件）** | pi；dsh | MISSING | "工具调工具/代码调工具"是子代理之外的另一种委派轴；parent 链与事件必须进契约否则网关无法呈现 | PI-EXT；PI-DURABLE；DSH-TOOLCAT |
| C4 | **工具结果外溢（spill）：超限内容存 artifact，返回头/尾 + 不透明 locator + retrievalHint；fork 继承 locator** | dsh spill | MISSING | 我方 tool.result 快照无溢出策略；大输出（日志/搜索）需要"地址化"而非截断丢失 | DSH-SPILL |
| C5 | **后台作业一等公民：jobs 注册表 + job_kill/list/output 三工具 + 后台完成经 agent.inject() 通知注入；bash run_in_background** | dsh | MISSING（我们 scheduler 是网关侧非契约） | 运行时内的后台作业需要与对话回合解耦的生命周期与通知回流 | DSH-TOOLCAT；DSH-SEAMS |
| C6 | **持久终端：PTY 注册表 + terminal_* 六工具 + 持久 bash/pwsh（owner 隔离）** | dsh | MISSING | 交互式终端是有状态工具的代表；网关若代理此类工具需会话亲和 | DSH-TOOLCAT |

### D. 模型与预算面

| # | 能力 | 平台表面 | 判定 | 意义 | 证据 |
|---|---|---|---|---|---|
| D1 | **虚拟模型/路由：每次请求 route（reason: user/continuation/retry/direct、sticky 保 cache、failed 可换模）；路由状态 JSON 随分支持久化跨压缩存活；分类器驱动路由** | pi virtual-models | MISSING | 多模型网关的选路可下沉为"模型"本身；我方 per-session 模型选择之外缺 per-request 路由契约 | PI-VM |
| D2 | **思考等级契约：off..max 七级 + thinkingBudgets 每级 token 预算 + thinkingLevelMap 模型映射 + set/cycle/get_available + thinking_level_changed 事件** | pi | PARTIAL（我们有 reasoning part，无等级/预算控制面） | reasoning 的"深度"是可调参数而非只读内容；网关应暴露等级枚举与预算 | PI-RPCCMD；PI-AI |
| D3 | **token-meter：重放式按路由定价（图像视觉 token 定价）、usage 锚定复用、surfaceDeltaTokens 带符号增量、logRevision 一致快照** | dsh | MISSING | 我方 usage.updated 是报数；token-meter 是"预测下一次请求多贵"的测量服务——预算/压缩触发/成本预估的地基 | DSH-TOKENMETER |
| D4 | **分类器/图像模型一等公民：classify(choice/score/bool)（TypeSafe Jev/Clef/GPT-6 Luna/OpenAI Decisions/llama.cpp 本地 logprob 分类）、generateImages；models.classify 进 codemode 脚本与路由器** | pi-ai | MISSING | LLM API 契约不止 chat：结构化判定与图像生成已是可枚举模型类型 | PI-AI "Classification/Image Generation"；PI-VM |
| D5 | **约束采样：constrainedSampling strict json_schema prefer/require + OpenAI Lark/regex 语法工具** | pi-ai | MISSING | 工具参数正确性的 provider 侧保证；工具注册契约的进阶字段 | PI-AI "Constrained Sampling" |
| D6 | **系统提示词增量协议：mid-conversation system 消息 sections 命名替换 + toolsAdded/Removed；Anthropic inline-tools / OpenAI additional_tools 原位变更保 prompt cache** | pi-ai SystemMessage；dsh system-prompt/assemble waterfall + request/context systemPromptUpdate | MISSING | 我方 system prompt 隐含静态；"改提示词不炸缓存"需要分段/增量契约 | PI-AI；DSH-EVT |

### E. 权限/交互/编排

| # | 能力 | 平台表面 | 判定 | 意义 | 证据 |
|---|---|---|---|---|---|
| E1 | **审批模型深化：封闭结果集（无 always）+ ask/never 持久策略事件（replay 重建）+ approval/asked/decided 审计对（log-only）+ answerer waterfall + fail-closed** | dsh | PARTIAL（我们有 once/always/reject；缺审计持久化与策略事件） | "always"在 dsh 被有意删除（一次性授权+策略档位替代）；审计对入会话日志=审批历史随会话可回放 | DSH-APPROVAL |
| E2 | **扩展/钩子注入模型：25+ 生命周期钩子（含 before_provider_request 链式变换、provider_stream_event 原始观测、agent_before_settle 续跑请求）；组合语义六分类（notification/in-place/chained/gate/boundary/last-override）；pi.sendMessage/appendEntry 注入** | pi extensions | MISSING | 我方网关的"能力注入"仅有工具注册；pi 证明钩子面可以成为宿主契约（且明确每类钩子的返回值效应） | PI-EXT |
| E3 | **子代理 provider 生态：spawn/fork 进程内 continuable + acp/codex/claude-code/dsh-sdk 外部一次性；maxDepth；sendMessage/interrupt(authority)/drain；父目录持久枚举（listDescendants 带 depth/diagnostics）；归属区分（agent-message vs subagent-settled）** | dsh | MISSING | 多运行时网关的子代理不只是"再开一个会话"：血缘目录、深度上限、相邻通信、归属消息类型都是契约点 | DSH-SUBAGENT |
| E4 | **Ralph 循环（fresh-agent 每轮全新子会话 + 共享 workspace + 有界结构化 handoff 报告）与 Agent Teams（teammate + team_task 看板工具）** | dsh | MISSING | "同目标多轮全新 agent"与"团队任务板"两种编排原语，皆由工具+子代理组合而成——网关可借鉴为编排词汇 | DSH-GLOSS；DSH-TOOLCAT |
| E5 | **goals：maxGoalRounds 轮次上限、blockedReason{code,message}、CAS revision、goal round 只计 admitted 轮、activation armed/disarmed 刻意不持久（重启后需人工再授权）** | dsh | MISSING（我方 goal loop 在网关侧，语义可对照吸收） | "目标驱动的自动续跑"需要轮上限+失败原因+人工再武装三件套防失控——与我们 RSI/goal loop 设计直接互鉴 | DSH-GOAL；DSH-GLOSS |
| E6 | **todo 词汇极简化：全量替换事件（无 id）、3 态、目录声明 allowParallelInProgress** | dsh | PARTIAL（我方 plan.updated todo 更富） | 反向参考：todo 可以只是 log-only 事件+投影，不需要独立 API | DSH-TODO |

### F. 平台与互操作

| # | 能力 | 平台表面 | 判定 | 意义 | 证据 |
|---|---|---|---|---|---|
| F1 | **类型化网关生成管线：@Remote 装饰器→ts.Program 严格分析→Host/Client 双面生成（descriptor+zod codec+declaration map）；RemoteStream 双向流（uplink codec 校验）；二进制远程传输；Peer 角色访问控制（remoteAccess 流式推送访问快照）；agent/session lookup 冷恢复+并发去重** | dsh Typert | MISSING | 我方网关手写契约；dsh 用编译期生成保证宿主/客户端不漂移，且访问控制与冷恢复在网关层统一——多运行时网关演进的直接参照 | DSH-GW |
| F2 | **llm 适配器 seam 三后端：llm-deepseek（官方 wire extensions 插件可加顶层字段）、llm-pi-ai（dsh 用 pi-ai）、llm-replay（回放测试）** | dsh | MISSING | 运行时与 LLM 后端解耦为 seam；**dsh 可直接吃 pi 的 provider 面**——两平台互通事实 | DSH-SEAMS；DSH-EVT |
| F3 | **hooks 桥接协议：Claude Code / Codex hooks（UserPromptSubmit/PreToolUse/PostToolUse/Stop）→ hook/invoked+result 日志对（handlerId 关联）；SessionStart 挂 inbox 等唤醒** | dsh hooks-claude-code/hooks-codex | MISSING | 第三方 hook 生态适配层的日志化方案：桥接副作用可审计 | DSH-SESSION "Plugin-owned log-only events" |
| F4 | **跨进程对象底座：chord contract/principal（owner vs guest 异视图）/热重载（in-flight 旧代码完成+安全点迁移）/links(memory/IPC/WS)；dsh HMR 序列化重载 + cordis-host-runner 运行时动态挂包 + inspector** | pi chord；dsh | MISSING | 网关若做多宿主插件进程，这是现成模型（尤其 principal 的"同一对象不同主体不同方法"） | PI-CHORD；DSH-SEAMS |
| F5 | **凭据面：CredentialStore（modify 为唯一串行写路径、OAuth 刷新防双发）、getAuth/checkAuth 探测、每请求解析（轮换立即生效）、无值视图+只写存储、transformHeaders/ClientIdentity** | pi；dsh credentials seam | PARTIAL（我们有 credentials 动词） | 多 provider 网关的凭据生命周期契约参照 | PI-AI "Auth"；DSH-SEAMS |
| F6 | **资源发现与信任：扩展/skills/prompt 模板/themes 打包为 Pi packages（npm/git 分发）；user/project/temporary 作用域；project_trust 信任门；get_commands 发现** | pi | MISSING | 我方插件体系（plugin-hub）可对照的"包分发 + 信任决策 + 作用域"三件套 | PI-README；PI-EXT；PI-SDK |
| F7 | **遥测契约化：pi-telemetry 类型化 schema（AI_TELEMETRY_SCHEMA/DURABLE_TELEMETRY_SCHEMA、span 词汇、metrics、trace carrier 持久化进任务 JSON）+ dsh session-telemetry/otel seam + conformance 测试** | pi；dsh | MISSING（我们 usage 插件是网关侧非契约） | 遥测作为跨运行时契约（含 trace 跨进程续链）而非实现细节 | PI-AI "Telemetry"；PI-DURABLE；DSH-SEAMS |
| F8 | **会话搜索/引用：session-query（全文/排序/摘要/游标代）五工具 + session-reference（跨会话快照注入 durable 不可信上下文）+ api-session search（ACL）** | dsh | MISSING | 历史不只是回放，还是模型可查询的语料；引用注入是"跨会话记忆"的会话内形态 | DSH-SEAMS；DSH-TOOLCAT |
| F9 | **消息级反馈与呈现：per-assistant-message feedback（CAS）+ 会话级 feedback/record + present（deliverables 呈现工具）** | dsh | MISSING | 用户侧信号（点赞/纠偏）与交付物呈现可作为网关事件词汇 | DSH-SEAMS；DSH-TOOLCAT |

### G. 反向发现（我方基线领先项，供契约谈判筹码）

| # | 能力 | 状况 | 证据 |
|---|---|---|---|
| G1 | **prompt 级 maxCostUsd / maxTurns 预算** | 两平台均无：pi 的 BudgetGuard 已从当前仓库消失（仅存 thinkingBudgets/压缩预算）；dsh 仅 SDK initialize `maxTokens`（输出 token 上限，含后代），无成本/轮次上限 | PI-AI/PI-AGENT/PI-DURABLE 全文；DSH-SDKPROTO |
| G2 | **permissionReply 的 always 档** | dsh 有意删除（allowed-once 封闭集 + ask/never 策略替代）；pi 无内建权限 | DSH-APPROVAL |
| G3 | **todo 的富结构（我方 plan.updated）** | dsh todo 刻意极简（无 id/优先级） | DSH-TODO |

---

## 附：与 05-industry-frontier 的衔接

本文档聚焦 pi + dsh 两个"可整体借鉴的运行时平台"；ACP/MCP/Vercel AI SDK/OpenAI Agents/Anthropic/Gemini 及产品面（Claude Code/Codex 等）见 `05-industry-frontier.md`。交叉点：dsh 的 `acp` 包与 `subagent-acp` 是 ACP 在子代理层的实现（见 05 §1）；pi-ai 的 provider 面覆盖 OpenAI Decisions / Anthropic inline-tools 等平台前沿 API（见 05 §4-6）。

## 附：证据 URL 索引（全文引用一次汇总）

- pi：github.com/earendil-works/pi（HEAD 58c0b02ce5，2026-10-21）；npmjs.com/package/@earendil-works/pi-coding-agent（1.4.0，2026-10-21）；docs：`/blob/main/packages/coding-agent/docs/{rpc,rpc-commands,json,extensions,sdk,compaction,virtual-models}.md`；`/blob/main/packages/{ai,agent,durable,chord}/README.md`；工具源 `/tree/main/packages/coding-agent/src/core/tools`
- dsh：github.com/deepseek-ai/deepseek-harness（HEAD 687f282e86，2026-10-17）；npmjs.com/package/@deepseek-ai/dsh（0.2.1-rc.2，2026-10-17）；docs：`/blob/master/docs/{agent-lifecycle,event-producer-consumer,api-gateway,capability-seams,glossary,tool-catalog}.md`、`/blob/master/docs/subsystems/{session,todo,approval,subagent,spill,goal,token-meter,worktrees}.md`、`/blob/master/packages/sdk/{README.md,protocol/README.md}`；deepseek-harness.github.io/deepseek-harness/；Cordis：github.com/cordiverse/cordis、arxiv.org/abs/2608.25512
