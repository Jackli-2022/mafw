# 01 · Claude Agent SDK（TypeScript）完整能力面盘点

> 契约缺口研究 · 子调研 1/1 · 调研日期 2026-10-22 · 调研代理：只读（网络+本地）
> 用途：为 MAFW gateway 多运行时契约（MafwMessage/MafwPart、canonical 事件词汇、RuntimeClient 动词面）寻找超出基线的前沿能力，判定 HAVE / PARTIAL / MISSING。

**证据缩写**（均为本地一手类型）：
- `sdk.d.ts:NNNN` = `C:\work\work-loop\opencode-plugin-mafw\adapters\claude\node_modules\@anthropic-ai\claude-agent-sdk\sdk.d.ts`（9589 物理行 / 10300+ 逻辑行）
- `beta-messages.d.ts:NNNN` = `...\node_modules\@anthropic-ai\sdk\resources\beta\messages\messages.d.ts`（peer dep，@anthropic-ai/sdk）
- `sdk-tools.d.ts` = 同目录内建工具输入/输出 JSON-Schema 生成类型
- `docs(ts-ref)` = https://docs.claude.com/en/api/agent-sdk/typescript（抓取于 2026-10-22）
- `changelog@0.3.x` = https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md

---

## ① 版本钉扎

| 项 | 值 | 证据 |
|---|---|---|
| 本地精确版本 | **0.3.306**（`claudeCodeVersion: "2.1.306"`） | package.json:3, :93 |
| npm 最新（2026-10-22） | **0.3.307**（`claudeCodeVersion: "2.1.307"`） | registry.npmjs.org/@anthropic-ai/claude-agent-sdk/latest |
| 差量 0.3.306→0.3.307 | 仅两点：`command_lifecycle` started 帧加 `wakeup_source`/`scheduled_for`（capability `lifecycle_wakeup_source_v1`）；browser SDK `query()` 加 `supportedDialogKinds` | changelog@0.3.307 |

**结论：本地 0.3.306 与最新仅差一个 patch，类型面等同最新。本文全部以本地 sdk.d.ts 为权威，无需用 web 文档补版本差量。** peer deps：`@anthropic-ai/sdk >=0.93.0`、`@modelcontextprotocol/sdk ^1.29.0`、`zod ^4.0.0`（package.json:58-61）。

顶层导出面（模块级动词）：`query` / `startup` / `prewarm` / `tool` / `createSdkMcpServer` / `listSessions` / `getSessionInfo` / `getSessionMessages` / `getSubagentMessages` / `listSubagents` / `renameSession` / `tagSession` / `deleteSession` / `forkSession` / `importSessionToStore` / `foldSessionSummary` / `resolveSettings` / `filterEscalatingDefaultMode` / `extractFromBunfs`（bun 单文件可执行提取）+ 常量 `HOOK_EVENTS`、`BUILTIN_TOOL_NAMES`（**54 个内建工具**，sdk.d.ts:216）、`LEGACY_TOOL_NAME_ALIASES`（:1102）、`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`（:9967）、`USAGE_LIMIT_ERROR_PREFIXES` 等。另有子入口 `/core`（bundle 瘦身）、`/browser`（SSE 传输）、`/bridge`、`/extract`（package.json:6-33；docs(ts-ref) "Compile to a single executable" / "Import the /core entry"）。

---

## ② Options 全字段表（sdk.d.ts:1553-2492，~65 字段）

判定对照 MAFW 基线：消息 DTO / 事件词汇 / RuntimeClient 动词（§前言）。

| 字段 | 行 | 作用 | 基线判定 |
|---|---|---|---|
| `abortController` | 1558 | 取消 query | **HAVE**（`abort`） |
| `additionalDirectories` | 1563 | 会话可访问的额外目录（`--add-dir`） | **MISSING**（无目录授权原语） |
| `projectConfigRoot` | 1573 | worktree cwd 的受信 checkout 根：hooks/permissions/.mcp.json/.claude 树从这里读 | **MISSING**（基线 worktree 无 config-root 分离） |
| `agent` | 1592 | 主线程 agent 名（system prompt/工具限制/模型全套生效） | **PARTIAL**（基线有 identity 绑定 `withIdentityPrompt`，但按注册表物化，非 per-query 参数） |
| `agents` | 1608 | `Record<string, AgentDefinition>` 进程内定义子代理 | **PARTIAL**（基线 `agents.install` 物化器；见 §⑥-3） |
| `allowedTools` | 1616 | 免审批工具白名单 | **PARTIAL**（approval allowlist 规则，粒度不同） |
| `canUseTool` | 1621 | 进程内权限回调（见 §⑥-8） | **PARTIAL**（permission.asked/replied 异步协议；无 suggestions 回写） |
| `continue` | 1626 | 续接当前目录最近会话 | **MISSING**（无 continue 语义） |
| `cwd` | 1630 | 会话工作目录 | **HAVE**（SessionCreateOpts.directory 契约） |
| `disallowedTools` | 1636 | 工具禁用（`Bash(rm *)` 可带参作用域） | **PARTIAL**（deny 规则） |
| `toolAliases` | 1662 | 内建工具名→MCP 工具名重定向（单跳，防环） | **MISSING** |
| `tools` | 1676 | 工具基面：`string[]` / `[]`（全禁）/ `{preset:'claude_code'}` | **PARTIAL**（nativeTools 声明 + 六件套注册，无 preset 概念） |
| `env` | 1693 | 子进程环境（**整体替换**不合并） | **MISSING** |
| `executable` / `executableArgs` | 1700/1704 | bun/deno/node 运行时选择 | **MISSING** |
| `extraArgs` | 1710 | 任意 CLI 旗标透传 | **MISSING** |
| `fallbackModel` | 1717 | 过载回退模型链（逗号分隔，每 turn 重试主模型） | **MISSING** |
| `enableFileCheckpointing` | 1726 | 文件检查点（见 §⑥-2） | **MISSING** |
| `toolConfig` | 1737 | 内建工具 per-tool 配置（如 askUserQuestion.previewFormat html） | **MISSING** |
| `forkSession` | 1742 | resume 时 fork 到新 sessionID | **PARTIAL**（fork(sessionID,messageID)） |
| `betas` | 1749 | `'context-1m-2025-08-07'` 1M 上下文 | **MISSING** |
| `hooks` | 1763 | 33 事件回调注册（见 §③） | **MISSING**（认知面四动词设计未实现） |
| `onElicitation` | 1784 | MCP elicitation 回调（form/url） | **MISSING** |
| `onUserDialog` + `supportedDialogKinds` | 1798/1820 | CLI 阻塞式对话框渲染回调 + 声明可渲染种类（fail-closed） | **MISSING** |
| `perTaskStopAffordance` | 1840 | 声明有 per-task 停止控件→interrupt 不杀后台任务 | **MISSING** |
| `persistSession` | 1850 | 关闭会话落盘 | **PARTIAL** |
| `sessionStore` / `sessionStoreFlush` / `loadTimeoutMs` | 1862/1870/1880 | **转录镜像 dual-write 到外部存储**（@alpha） | **MISSING**（见 §⑥-13） |
| `includeHookEvents` | 1890 | hook 生命周期进流（hook_started/progress/response） | **MISSING** |
| `includePartialMessages` | 1895 | 流式 stream_event（BetaRawMessageStreamEvent） | **PARTIAL**（part.delta；但基线无 message_start/stop 级事件） |
| `forwardSubagentText` | 1902 | 子代理 text/thinking 转发（parent_tool_use_id 标记） | **MISSING**（无子代理事件原语） |
| `verbatimPrompts` | 1926 | `client_composed:true` 逐字投递（跳过 @file 展开、slash 派发、turn 起始附件） | **MISSING** |
| `thinking` | 1939 | `{type:'adaptive'}` / `{type:'enabled',budgetTokens,display}` / `{type:'disabled'}` | **PARTIAL**（reasoning part 只读展示；无 budget/display 控制） |
| `effort` | 1946 | `'low'|'medium'|'high'|'xhigh'|'max'`（EffortLevel :708） | **MISSING** |
| `maxThinkingTokens`（deprecated） | 1955 | 旧式 thinking 预算 | **MISSING** |
| `maxTurns` | 1960 | 最大回合数 | **HAVE**（SessionPromptOpts.maxTurns） |
| `maxBudgetUsd` | 1965 | USD 预算硬停（`error_max_budget_usd`） | **HAVE**（maxCostUsd；语义等价） |
| `taskBudget` | 1975 | **API 侧 token 预算**（`task-budgets-2026-03-13` beta，模型自知余量自调节奏；@alpha） | **MISSING** |
| `mcpServers` | 1990 | MCP 服务器配置（stdio/sse/http/SDK in-process 四形态，:1246） | **MISSING**（基线仅工具注册，无 MCP 配置层） |
| `model` | 1995 | 模型选择 | **PARTIAL**（promptAsync body.model） |
| `outputFormat` | 2008 | `{type:'json_schema',schema}` 结构化输出（见 §⑥-4） | **PARTIAL**（CompletionRequest.responseFormat 是 gateway 无状态单次；非会话级 agent-loop） |
| `pathToClaudeCodeExecutable` | 2012 | 可执行文件路径 | **MISSING** |
| `permissionMode` | 2027 | **6 档**：default/acceptEdits/bypassPermissions/plan/dontAsk/**auto**（模型分类器审批） | **PARTIAL**（基线三档 read-only/auto/full-access；语义部分重叠但无 plan/dontAsk/auto-classifier） |
| `planModeInstructions` | 2034 | plan 模式自定义工作流指令 | **MISSING** |
| `allowDangerouslySkipPermissions` | 2039 | bypass 安全开关 | **MISSING** |
| `permissionPromptToolName` | 2044 | 用 MCP 工具作为审批界面 | **MISSING** |
| `permissionPrompts` | 2053 | `'host'|'none'`（无人审批面→该拒即拒） | **MISSING** |
| `plugins` / `pluginDelivery` | 2068/2083 | 本地插件加载 + argv/initialize 两种投递 | **PARTIAL**（gateway 自有插件系统，非 runtime 契约） |
| `promptSuggestions` | 2105 | 回合后预测下一 prompt（`prompt_suggestion` 消息） | **MISSING** |
| `agentProgressSummaries` | 2115 | 子代理 ~30s fork 出单行进度摘要（task_progress.summary） | **MISSING** |
| `resume` | 2120 | 会话恢复 | **PARTIAL** |
| `sessionId` | 2126 | 指定会话 UUID | **PARTIAL** |
| `resumeSessionAt` | 2134 | 从某消息 UUID 截断恢复 | **PARTIAL**（fork(messageID) 近似） |
| `resumeDropsTurn` | 2185 | **验证式截断**：丢弃段含非该 turn 内容则拒绝恢复 | **MISSING** |
| `sandbox` | 2241 | 沙箱全套（见 §⑥-7） | **MISSING** |
| `settings` / `managedSettings` / `settingSources` | 2259/2288/2299 | 内联设置 / 父进程策略层（restrictive-only 过滤）/ 设置源开关（`[]`=隔离模式） | **MISSING** |
| `skills` | 2322 | `'all'` 或名单（上下文过滤而非沙箱） | **PARTIAL**（gateway skill 物化是记忆管线产物，非会话选项） |
| `debug` / `debugFile` / `stderr` | 2330/2335/2340 | 调试可观测 | **MISSING**（契约层） |
| `strictMcpConfig` | 2348 | 只用 options.mcpServers，忽略一切文件配置 | **MISSING** |
| `systemPrompt` | 2460 | string/string[]（含 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 缓存分界）/preset+append/`excludeDynamicSections`（跨用户缓存）/`snapshot`（会话内冻结） | **PARTIAL**（injectSystem 注入有；无缓存分界/快照/preset 语义） |
| `title` | 2469 | 会话标题 | **PARTIAL**（session.rename） |
| `spawnClaudeCodeProcess` | 2491 | **自定义 spawn**（VM/容器/远程执行） | **MISSING** |

统计：HAVE 4 / PARTIAL 22 / MISSING ~39。**结构性发现：基线把"审批/预算/工具"做成了动词，Claude SDK 把同样的东西做成了 Options 字段 + Query 控制方法双面**（启动期声明 + 运行期可变）。

---

## ③ Hooks 全清单（33 个，sdk.d.ts:976-998）

`hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>`（:1763）；`HookCallback = (input, toolUseID, {signal, async, asyncTimeout?}) => Promise<HookJSONOutput|null>`（:981-987）。输出统一形（`SyncHookJSONOutput` :9942-9956）：`continue` / `suppressOutput` / `stopReason` / `decision:'approve'|'block'` / `systemMessage` / `terminalSequence`（OSC 9/777 桌面通知）/ `reason` + `hookSpecificOutput`。

**能力三分类**：🩹注入上下文（additionalContext）/ ✏️改写（updatedInput / updatedToolOutput / sessionTitle / watchPaths）/ 🚪门控（permissionDecision / decision:block / action）。

| # | Hook | 输入要点 | 能做什么（输出） | 行 |
|---|---|---|---|---|
| 1 | `PreToolUse` | tool_name/tool_input/tool_use_id/mcp_server | 🚪✏️🩹 permissionDecision(allow/deny/ask/**defer**)+reason、**updatedInput 改写工具入参**、additionalContext | 2787/2795 |
| 2 | `PostToolUse` | tool_input/tool_response/duration_ms | ✏️🩹 **updatedToolOutput 改写工具输出**（updatedMCPToolOutput 兼容）、classifierContext（喂 auto 模式审批分类器）、additionalContext | 2704/2717 |
| 3 | `PostToolUseFailure` | 同上+错误 | 🩹 additionalContext | 2685/2699 |
| 4 | `PostToolBatch` | PostToolBatchToolCall[] | 🩹 additionalContext（批量结算点） | 2668/2673 |
| 5 | `Notification` | message/title/notification_type | 🩹 additionalContext；terminalSequence 转发通知 | 1495/1502 |
| 6 | `UserPromptSubmit` | prompt/**source**（user/sdk/system/loop_wakeup/schedule_wakeup/poll_event）/session_title | 🚪✏️🩹 block 拦 prompt、**suppressOriginalPrompt**、additionalContext、**sessionTitle 改会话标题** | 10210/10220 |
| 7 | `UserPromptExpansion` | prompt | 🚪✏️ 同上（@file/slash 展开前） | 10192/10201 |
| 8 | `SessionStart` | source(resume/clear/fork…)/context_tokens | 🩹 additionalContext 注入会话开头 | 6768/6792 |
| 9 | `SessionEnd` | reason('clear'/'resume'/'logout'/…) | 终态观察 | 6707 |
| 10 | `Stop` | stop_hook_active/last_assistant_message/**background_tasks**/**session_crons** | 🚪🩹 block→强制继续、additionalContext 反馈（区分"会话结束"vs"等后台任务唤醒"） | 9874/9896 |
| 11 | `StopFailure` | 错误详情 | 失败终态观察 | 9867 |
| 12 | `SubagentStart` | agent_id/agent_type | 🩹 additionalContext | 9901/9907 |
| 13 | `SubagentStop` | agent_transcript_path/last_assistant_message | 🚪🩹 block 继续、additionalContext 反馈给子代理 | 9912/9937 |
| 14 | `PreCompact` | trigger(manual/auto)/custom_instructions | 🚪 压缩前拦截/改指令 | 2734 |
| 15 | `PostCompact` | compact 结果 | 压缩后观察 | 2610 |
| 16 | `PreModelSwitch` | from_model/to_model | 🚪 可拒切换 | 2740 |
| 17 | `PostModelSwitch` | from/to | 切换后观察 | 2619 |
| 18 | `PermissionRequest` | 工具请求 | 🚪✏️ allow/deny/ask/defer + updatedInput（与 canUseTool 同构） | 2533/2541 |
| 19 | `PermissionDenied` | 拒绝详情 | 拒绝后观察 | 2514/2523 |
| 20 | `Setup` | 安装期 | 🩹 一次性环境准备 | 9632/9637 |
| 21 | `TeammateIdle` | teammate_name | 队友空闲唤醒点 | 10001 |
| 22 | `TaskCreated` | 任务 | 任务生命周期观察 | 9989 |
| 23 | `TaskCompleted` | 任务 | 同上 | 9977 |
| 24 | `Elicitation` | mcp_server_name/message/mode(form/url)/requested_schema | 🚪✏️ accept/decline/cancel + **content 表单回填**（MCP elicitation 审批） | 713/726 |
| 25 | `ElicitationResult` | 结果 | 结果观察 | 765/777 |
| 26 | `ConfigChange` | source(user/project/local/policy/skills)/file_path | 设置热变更观察 | 383 |
| 27 | `WorktreeCreate` | worktree | worktree 生命周期 | 10249 |
| 28 | `WorktreeRemove` | worktree | 同上 | 10262 |
| 29 | `InstructionsLoaded` | 指令文件 | 🩹 追加指令 | 1080 |
| 30 | `CwdChanged` | old_cwd/new_cwd | ✏️ **watchPaths**（让 CLI 监听指定路径） | 664/670 |
| 31 | `FileChanged` | file_path/event(change/add/unlink) | ✏️ watchPaths | 797/803 |
| 32 | `DirectoryAdded` | directory/source | 目录注册观察 | 691 |
| 33 | `MessageDisplay` | 消息展示 | ✏️ 改 UI 展示不改模型上下文 | 1384/1411 |

**vs 基线**：基线认知面 HostAdapter 四动词（observe/injectContext/injectSystem/tools）只有"注入+观察"，**没有门控（gate）与改写（rewrite）两个动词**；Claude 的 PreToolUse/PostToolUse/UserPromptSubmit/Stop 四件套恰好补齐这两类。33 个 hook 里 MAFW 有直接对应的仅 SessionStart(injectSystem)、Notification(≈无)、FileChanged(观察捕获 obs/capture)。

---

## ④ 消息 / ContentBlock 全形态 vs MafwPart

### 4.1 SDKMessage 联合（39 形态，sdk.d.ts:5553）

`SDKMessage =` SDKAssistantMessage | SDKUserMessage | SDKUserMessageReplay | SDKResultMessage(Success/Error) | SDKSystemMessage(init) | **SDKPartialAssistantMessage**(stream_event) | SDKCompactBoundaryMessage | SDKStatusMessage('compacting'|'requesting') | SDKAPIRetryMessage | SDKControlRequestProgressMessage | SDKModelRefusalFallbackMessage | SDKModelRefusalNoFallbackMessage | SDKLocalCommandOutputMessage | SDKHookStarted/Progress/ResponseMessage | SDKPluginInstallMessage | SDKToolProgressMessage | SDKAuthStatusMessage | SDKTaskNotification/Started/Updated/ProgressMessage | SDKBackgroundTasksChangedMessage | SDKThinkingTokensMessage | SDKSessionStateChangedMessage | SDKWorkerShuttingDownMessage | SDKCommandsChangedMessage | SDKNotificationMessage | SDKFilesPersistedEvent | SDKToolUseSummaryMessage | **SDKMemoryRecallMessage** | SDKRateLimitEvent | SDKElicitationCompleteMessage | SDKPermissionDeniedMessage | SDKPromptSuggestionMessage | SDKMirrorErrorMessage | SDKInformationalMessage | SDKConversationResetMessage。

### 4.2 ContentBlock（Anthropic Messages API 形状）

- **入参**（`SDKUserMessage.message: MessageParam`，:6509）：`BetaContentBlockParam =` text | image | **document(PDF)** | search_result | **thinking / redacted_thinking**（回放签名） | tool_use | tool_result | server_tool_use | web_search/web_fetch/code_execution/bash_code_execution/text_editor/tool_search 结果 | advisor | **MCP tool_use/tool_result** | container_upload | **compaction** | **tool_addition / tool_removal**（会话中动态增删工具！） | MCP tool_listing | fallback（beta-messages.d.ts:3628）
- **出参**（`SDKAssistantMessage.message: BetaMessage`，:3674）：`BetaContentBlock =` text(**citations**) | thinking(**signature**) | **redacted_thinking** | tool_use | server_tool_use | web_search/web_fetch/advisor/code_execution/bash_code_execution/text_editor/tool_search 结果 | **MCPToolUse/MCPToolResult** | container_upload | **CompactionBlock** | FallbackBlock | **MCPToolListingBlock**（beta-messages.d.ts:3627）

### 4.3 逐块对照 MafwPart（text|reasoning|tool|image|file|step-start|step-finish）

| Claude 块 | MafwPart | 判定 | 缺口 |
|---|---|---|---|
| text（+citations 引用块） | text | **HAVE**（citations 缺失：MAFW 无来源引用结构） |
| thinking（signature）/ redacted_thinking | reasoning | **PARTIAL**：MafwReasoning 无签名（跨请求回放必需）、无 redacted、无 budget/display 元数据；`resumed_from_incomplete_thinking`（:3697，max-output-tokens 恢复链）基线无概念 |
| tool_use + tool_result + `tool_use_result` 结构化侧车（:6513）+ `tool_result_meta`（non_execution_kind/user_feedback，changelog@0.3.216） | tool（快照 callID/tool/state/input/output/error） | **PARTIAL**：MAFW 合帧快照更利于 UI，但**丢失了结构化 per-tool Output 类型**（sdk-tools.d.ts 的 AgentOutput/BashOutput 等 45 个 Input/Output 形态）与"非执行结果"分类（denied/interrupted/cancelled） |
| image（含 Read 工具 PDF 页转 image，changelog@0.3.243） | image | **HAVE** |
| document（PDF 直读） | file | **PARTIAL**（file part 为一等载体，但无 PDF 页级语义） |
| compaction 块（API 侧压缩标记） | — | **MISSING**（基线 compact 只有事件无消息块） |
| tool_addition / tool_removal（会话中途增删工具） | — | **MISSING** |
| step 语义：无对应块，回合结构靠 message.id 分帧 + `parent_tool_use_id`（子代理归属）+ `agent_id`/`subagent_type`/`task_description`（:3709-3717） | step-start/step-finish | **PARTIAL**：基线 step 件是 UI 友好发明；Claude 用"每块一消息共享 message.id"表达，且带子代理归属链 |

### 4.4 SDKUserMessage 的投递语义（基线 prompt 无对应物）

`priority: 'now'|'next'|'later'`（:6516，'now' 抢占并把运行中工具转后台）；`shouldQuery:false`（:6548，只落转录不触发回合——≈基线 noReply）；`isSynthetic`（:6511）；`client_composed`（:6556）；`pasted_content`/`inline_pastes`（:6579/6583）；`uuid`（客户端指定，回执对账 `user_message_uuid`/`user_message_uuids` :3685-3689）。

---

## ⑤ 动词面 vs RuntimeClient

### 5.1 Query 实例方法（流式模式，sdk.d.ts:2898-3301）

| SDK 动词 | 行 | 作用 | 基线 RuntimeClient 对应 | 判定 |
|---|---|---|---|---|
| `interrupt()` | 2912 | 中止，返回 receipt（still_queued，`interrupt_receipt_v1`） | `abort` | PARTIAL（无回执、无排队消息清单） |
| `setPermissionMode(mode)` | 2919 | 6 档运行期切换 | permission-mode 路由 | PARTIAL |
| `setMcpPermissionModeOverride(server,mode)` | 2936 | per-MCP-server 权限覆盖（tighten-only） | — | MISSING |
| `setModel(model?)` | 2948 | 运行期换模型 | promptAsync body.model | PARTIAL（非动词） |
| `setMaxThinkingTokens(n,display?)` | 2975 | 运行期 thinking 预算+展示 | — | MISSING |
| `applyFlagSettings(settings)` | 3003 | 运行期合并 flag 设置层（含 ultracode/effortLevel） | — | MISSING |
| `updateSettings(source,settings)` | 3018 | 写设置**文件**并 live-apply | — | MISSING |
| `initializationResult()` / `reinitialize()` | 3027/3053 | init 快照 / 断线重握手（重投 pending 权限） | — | MISSING |
| `supportedCommands/Models/Agents()` | 3059/3065/3071 | 能力枚举 | `/api/agents`、providers | PARTIAL |
| `mcpServerStatus()` | 3077 | MCP 服务器健康（connected/failed/needs-auth/pending） | — | MISSING |
| `getContextUsage({detail})` | 3088 | **上下文逐类 token 分解** | — | MISSING |
| `usage_EXPERIMENTAL…()` | 3108 | 会话成本+套餐限额窗口 | usage 配额插件（gateway 侧） | PARTIAL（非契约） |
| `readFile(path,{maxBytes,encoding})` | 3129 | 会话文件读取（同 Read 权限门） | — | MISSING |
| `reloadPlugins({holdOnCacheImpact,addPlugins})` | 3152 | 插件热载（防缓存失效挂起） | `POST /api/runtime/reload`（gateway 自有） | PARTIAL（概念对应物在 gateway 侧） |
| `reloadSkills()` / `reloadOutputStyles()` | 3161/3171 | 热载 | — | MISSING |
| `accountInfo()` | 3177 | 账户/组织/订阅 | credentials.getApiKey | PARTIAL |
| `rewindFiles(userMessageId,{dryRun})` | 3186 | 文件回滚 | — | MISSING |
| `seedReadState(path,mtime)` | 3199 | 预置 Read 缓存（配 snip 上下文编辑） | — | MISSING |
| `reconnectMcpServer` / `toggleMcpServer` | 3214/3222 | MCP 生命周期 | — | MISSING |
| `readMcpResource(server,'ui://…')` | 3235 | MCP Apps UI 资源（SEP-1865，@alpha） | — | MISSING |
| `setMcpServers(servers)` | 3264 | **运行期整体替换动态 MCP 集** | — | MISSING |
| `streamInput(AsyncIterable<SDKUserMessage>)` | 3271 | 多轮流式输入 | prompt(delivery:'steer') | PARTIAL |
| `stopTask(taskId)` | 3276 | 停止单个后台任务 | — | MISSING |
| `backgroundTasks(toolUseId?)` | 3291 | 把运行中工具转后台（≈Ctrl+B） | — | MISSING |
| `close()` | 3300 | 终止进程 | agentProcess.restart（反向操作） | PARTIAL |

### 5.2 模块级会话动词

`listSessions`(:1123，含 `includeWorktrees`)、`getSessionInfo`(:889)、`getSessionMessages`(:919，**含跨会话吸收消息**，changelog@0.3.275)、`getSubagentMessages`(:956)、`listSubagents`(:1178)、`renameSession`(:3314)、`tagSession`(:9975)、`deleteSession`(:689)、`forkSession({upToMessageId,title})`(:855)、`importSessionToStore`(:1017)、`foldSessionSummary`(:837)、`resolveSettings`(:3370，不 spawn 就算出设置合并结果+provenance)、`filterEscalatingDefaultMode`(:816)、`startup()→WarmQuery`(:9849/:10236)、`prewarm()→SpareProcess.claim()`(:2873/:9675)。

**vs 基线 RuntimeClient**：session 增删查 HAVE；rename/tag PARTIAL（rename 有 tag 无）；fork PARTIAL（有 upToMessageId 精确分支 vs 基线 fork(sessionID,messageID) 等价）；**normalize 在 SDK 无对应**（SDK 消息即 API 形状，MAFW 的恒 flat 归一是自家发明）；**getSubagentMessages/listSubagents 基线全缺**。

---

## ⑥ 超出基线的前沿能力清单（主交付）

> 每条：能力 | SDK 表面 | 基线判定 | 对多运行时网关契约的意义 | 证据

### A. 认知/控制面（与 HostAdapter 认知契约直接竞争）

**A1. 33-hook 门控/改写/注入生命周期**
- SDK 表面：`Options.hooks`（:1763）、`HookEvent` 33 值（:995）、`PreToolUseHookSpecificOutput.updatedInput`（:2799）、`PostToolUseHookSpecificOutput.updatedToolOutput/classifierContext`（:2723-2731）、`UserPromptSubmitHookSpecificOutput.{suppressOriginalPrompt,sessionTitle}`（:10220-10228）、`StopHookSpecificOutput.additionalContext`+block（:9896）
- 判定：**MISSING**（基线认知面四动词只有注入+观察）
- 意义：MAFW 认知契约需扩到 **六动词**：observe / injectContext / injectSystem / tools + **gate**（PreToolUse 拦截改参）/ **rewrite**（PostToolUse 改输出）。tool.delta 语义扩展（已审计未实现）之外，最大的结构性缺口。
- 证据：sdk.d.ts:976-998, 2795-2802, 2717-2732

**A2. 文件检查点 + rewind + 验证式截断恢复（checkpoint/rewind 语义）**
- SDK 表面：`enableFileCheckpointing`（:1726）、`Query.rewindFiles(userMessageId,{dryRun})`（:3186）、`RewindFilesResult`（:3409，含 skippedLinks）、`resumeSessionAt`+`resumeDropsTurn`（:2134/:2185，丢弃段含外物→`Resume rejected by --resume-drops-turn:` 确定性拒绝，消费者必须走 rewind-recovery 不得重试）、`forkSession({upToMessageId})`（:860）；限制：仅 Write/Edit/NotebookEdit 追踪、子代理编辑不追踪、fork 不继承检查点
- 判定：**MISSING**（基线 fork 只是转录分支；opencode diffApi revertDiff 只覆盖 opencode）
- 意义：基线 `session.diff/revertDiff` 是"读+手贴 patch"，Claude 是"检查点+一键 rewind+dryRun 预览"。多运行时契约可加 `session.rewind(files|conversation)` 能力位，`conversation rewind`（rewind_conversation，changelog@0.3.285/300）与 files rewind 分离。
- 证据：sdk.d.ts:1719-1726, 3186-3188, 2136-2185；docs https://docs.claude.com/en/api/agent-sdk/file-checkpointing

**A3. canUseTool 富审批回调**
- SDK 表面：`CanUseTool`（:228-320）：`suggestions: PermissionUpdate[]`（可回写 `updatedPermissions` 持久化规则，`PermissionUpdateDestination` 五层：userSettings/projectSettings/localSettings/session/cliArg :2602）、`blockedPath`、`mcpServer:{name,source}`（信任键在 source 而非名字）、`matchedAskRule`（规则强制的 ask 不许宿主自动批）、`defaultToNo`/`suppressAlwaysAllowRule`（UI 安全提示）、`title/displayName/description`（桥接渲染文案）、`agentID`（子代理审批路由）、`decisionReason`；返回 `{behavior:'allow'|'deny'|'ask', updatedInput?, updatedPermissions?, permissions?}`（`PermissionResult` :2554）
- 判定：**PARTIAL**（permission.asked/replied 有；载荷刚加 options[]/suggestedRule；缺 updatedPermissions 回写、缺 ask 决策（三值只有 once/always/reject）、缺子代理路由 agentID）
- 意义：基线 permissionReply 的 'always' 沉淀规则已在做；缺 **'ask' 回退**（宿主判不了扔回 runtime）与**审批时改写 updatedInput**（脱敏/参数钳制）。
- 证据：sdk.d.ts:228-320, 2554-2602

**A4. PermissionMode 六档 + auto 模式分类器 + per-MCP-server 覆盖**
- SDK 表面：`PermissionMode = 'default'|'acceptEdits'|'bypassPermissions'|'plan'|'dontAsk'|'auto'`（:2531）；auto=模型分类器逐调用批/拒，批不了走 canUseTool；`planModeInstructions`（:2034）；`setMcpPermissionModeOverride` tighten-only（:2936）
- 判定：**PARTIAL**（三档 read-only/auto/full-access 与之部分同构；无 plan/dontAsk、无 per-server 覆盖）
- 意义：基线审批三档预设可吸收 **plan 档**（只读规划模式，MAFW 有 plan agent 但非权限档）与 **dontAsk**（无人值守 fail-closed）两个语义。
- 证据：sdk.d.ts:2013-2053, 2531

**A5. MCP elicitation + 用户对话框（阻塞式双向 UI 通道）**
- SDK 表面：`onElicitation`（:1784）、`ElicitationRequest{mode:'form'|'url',requested_schema,property_order}`（:735，property_order changelog@0.3.299）、`Elicitation/ElicitationResult` hooks（:713/:765）、`SDKElicitationCompleteMessage`（:5368）；`onUserDialog`+`supportedDialogKinds`（:1798/:1820，dialog_kind 如 refusal_fallback_prompt，fail-closed：未声明种类永不发）
- 判定：**MISSING**（question.asked/replied 是纯文本问答，无 schema 表单、无 URL 授权流、无对话框种类协商）
- 意义：基线 question 通道可扩 `question.asked{schema}`（结构化表单）——与 MAFW askUser 轮询 JSON 的差异是**宿主渲染 vs 模型自由文本**。
- 证据：sdk.d.ts:713-783, 1517-1552, 1785-1820

### B. 子代理 / 任务面

**B1. 子代理定义全景（AgentDefinition）**
- SDK 表面：`AgentDefinition`（:38-108）：`model`（含 'inherit'）/ `effort` / `permissionMode` / `maxTurns` / **`autoCompactWindow`**（子代理自紧凑阈值）/ `background`（fire-and-forget）/ `omitClaudeMd` / **`memory:'user'|'project'|'local'`**（agent-memory 目录自动加载）/ **`observer`+`observerMessage`**（自动后台观察者代理，只读活动摘要经 ObserverReport 回报）/ `skills` / `mcpServers` / `initialPrompt` / `criticalSystemReminder_EXPERIMENTAL`
- 判定：**PARTIAL**（基线 AgentDefinition：description/mode/model/systemPrompt/permissions——身份子集；无 background/observer/memory/effort/自紧凑）
- 意义：MAFW IdentityRegistry 的 AgentDefinition 是**身份级**，Claude 的是**行为级**。契约可扩可选字段（background、maxTurns、autoCompactWindow）。
- 证据：sdk.d.ts:38-108

**B2. 子代理事件流与消息回读**
- SDK 表面：`forwardSubagentText`（:1902）、`SDKTaskStarted/Updated/Progress/NotificationMessage`（:6315/6360/6286/6250，含 `parent_task_id`、`run_id`、`is_backgrounded`、`spawn_depth`、`ambient`）、`agentProgressSummaries`（:2115）、`getSubagentMessages`/`listSubagents`（:956/:1178）、`SDKAssistantMessage.agent_id/subagent_type/task_description`（:3709-3717）；嵌套默认深度 1（`CLAUDE_CODE_MAX_SUBAGENT_DEPTH`），并发上限 20（changelog@0.3.217）
- 判定：**MISSING**（基线无子代理原语——但仓库已有 `2026-10-21-subagent-lifecycle-panel-design.md`，正在路上）
- 意义：canonical 词汇需预留 `task.*` 事件族（started/updated/progress/notification）+ 消息 part 的 `parent_tool_use_id`/`agent_id` 附加字段。**基线消息 DTO 的 flat 设计需要决定子代理消息是独立 session 还是 part 附加归属**——Claude 选择了"同流+归属标记"。
- 证据：sdk.d.ts:1896-1902, 6250-6385, 956-1193

**B3. 后台任务控制**
- SDK 表面：`backgroundTasks(toolUseId?)`（:3291，运行中 Bash/子代理转后台）、`stopTask(taskId)`（:3276）、`perTaskStopAffordance`（:1840）、`SDKBackgroundTasksChangedMessage`（:3772）、`BackgroundTaskSummary`（:142）；Stop hook 可见 `background_tasks`+`session_crons`（:9884-9888）
- 判定：**MISSING**
- 意义：基线 turn 生命周期没有"回合内工具转后台继续跑"的概念；BudgetGuard 的 step 计数会被长工具卡死。
- 证据：sdk.d.ts:3276-3291, 1840-1840

**B4. 会话内调度（cron / wakeup / monitor）**
- SDK 表面：内建工具 `CronCreate/CronList/CronDelete`、`ScheduleWakeup`、`Monitor`、`RemoteTrigger`（sdk.d.ts:216）、`SessionCronSummary`（:6691）、UserPromptSubmit hook 的 source 含 `loop_wakeup`/`schedule_wakeup`（:10216）
- 判定：**MISSING**（契约层；gateway 侧 scheduler/goals 是非契约能力，语义不同——这是**会话自己持有**的调度）
- 意义：区别于 MAFW gateway 持有的 automation rules：Claude 把 cron 做成会话内工具，唤醒即 prompt。多运行时契约若吸收，应作为 `session.schedule` 能力位而非全局规则。
- 证据：sdk.d.ts:216, 6691-6706

### C. 模型/推理面

**C1. Thinking 全景（budget/interleaved/redacted）**
- SDK 表面：`ThinkingConfig = adaptive{display?} | enabled{budgetTokens,display?} | disabled`（:10018-10042）；`display:'summarized'|'omitted'|'highlights'`（highlights 仅官方托管远端会话）；`effort: 'low'|'medium'|'high'|'xhigh'|'max'`（:708/:1946，与 adaptive 配合）；`setMaxThinkingTokens(n,display?)` 运行期（:2975）；`SDKThinkingTokensMessage`（:6386）；`resumed_from_incomplete_thinking`（:3697，截断恢复链签名保持）；thinking 签名块在 ContentBlock（beta-messages.d.ts:3627-3628）
- 判定：**PARTIAL**（reasoning part 展示有；预算/档位/展示模式/签名全缺）
- 意义：若 Claude 形 runtime 接入 MAFW，reasoning part 需要**原样保留 signature**（否则多轮 thinking 回放被 API 拒）；`display` 元数据可作 part 附加字段。
- 证据：sdk.d.ts:10013-10042, 1940-1955, 2950-2975

**C2. 结构化输出（agent-loop 级 + retry 语义）**
- SDK 表面：`outputFormat:{type:'json_schema',schema}`（:2008/:1090）；机制：CLI 注入 `StructuredOutput` 工具，模型调用它交卷；校验失败→`is_error:true` tool_result→**模型自动重试**；耗尽→result `error_max_structured_output_retries`（含最后校验错误、定位到 key/枚举/长度，changelog@0.3.260）；成功读 `result.structured_output`（:6049）；end-turn MCP 工具（`_meta['claude/endTurn']`）同机制；`structured_output_retry_exhausted` TerminalReason（:10013）
- 判定：**PARTIAL**（CompletionRequest.responseFormat 是 gateway 无状态单次补全的 json_schema；**会话级 agent-loop 结构化输出+自动重试+终态分类**全缺）
- 意义：goal 编排的 plan/execute/review 产物解析（waves.json/receipts/reviews）正需要这个——现在靠"产物文件存在且可解析"双门判定，StructuredOutput 可让节点输出直接带 schema。
- 证据：sdk.d.ts:1090-1101, 6049-6050; docs https://docs.claude.com/en/api/agent-sdk/structured-outputs

**C3. 模型链与自动回退**
- SDK 表面：`fallbackModel`（:1717，逗号链，每 turn 重试主模型）；`SDKModelRefusalFallbackMessage`+`supersedes: UUID[]`（:5645/:3701，refusal 后换模型重写、旧消息逐 uuid 撤回）；`switchModelsOnFlag` 设置（:9546，safeguard 触发自动换模型）；`betas:['context-1m-2025-08-07']`（:3804）
- 判定：**MISSING**
- 意义：多运行时网关的模型故障面目前只有 turn.failed；`supersedes` 撤回语义（消息级替换）是事件词汇没有的形态——**message.superseded 事件**值得预留。
- 证据：sdk.d.ts:1711-1717, 5645-5697, 3701

**C4. API 侧 token 预算（taskBudget）**
- SDK 表面：`taskBudget:{total}`（:1973，`task-budgets-2026-03-13` beta，模型感知剩余预算自调节奏；`budget_exhausted` TerminalReason）
- 判定：**MISSING**（maxCostUsd 是客户端硬停；这是模型自我节流）
- 意义：与 BudgetGuard 形成三层预算：模型自节流（taskBudget）→ 客户端硬停（maxBudgetUsd≈maxCostUsd）→ 网关兜底（BudgetGuard）。
- 证据：sdk.d.ts:1966-1975, 10013

### D. 上下文/记忆面

**D1. 上下文用量逐类分解**
- SDK 表面：`getContextUsage({detail:'summary'|'full'})`（:3088）；`SDKContextUsage`（:3857-3918）：total/percentage/over_limit{kind}+categories（used/free/buffer/**deferred**）+**mcp_tools 逐工具 token**+**memory_files 逐文件**+**agents 逐定义**+**skills 逐技能**；`/context` 结果的 `context_usage` 结构孪生（:3731）
- 判定：**MISSING**（usage.updated 只有总量 tokens/cost）
- 意义：MAFW 的 `<recall>` 注入预算、memory-guide 注入占用都靠拍脑袋；逐类分解让注入预算可核算。对 desktop UsageDock 是直接升级。
- 证据：sdk.d.ts:3088-3110, 3857-3933

**D2. auto-memory 系统（select/synthesize 双模 + 三 scope）**
- SDK 表面：`SDKMemoryRecallMessage`（:5528-5548）：`mode:'select'`（并行选择器挑全文）| `'synthesize'`（Sonnet 从大量碎片蒸馏成段）；scope `'personal'|'team'|'organization'`；设置 `autoMemoryEnabled`/`autoMemoryDirectory`（:9441-9445）、`autoDreamEnabled`（:9449，后台记忆巩固"做梦"）；`AgentDefinition.memory`（:91）
- 判定：**HAVE（gateway 非契约侧）**——MAFW 谐波记忆系统远比它复杂（BM25/dense/能量/巩固），**这不是缺口是设计分歧**；但 `memory_recall` **事件**（让 UI 显示"本轮想起了什么"）基线没有——recall 注入是 transform 静默注入，UI 不可见
- 意义：可借鉴的是**召回可观测事件**（`memory.recalled`）而非机制本身。
- 证据：sdk.d.ts:5528-5548, 9438-9449

**D3. 压缩控制面**
- SDK 表面：`autoCompactEnabled`/`precomputeCompactionEnabled`（后台预计算压缩摘要）/`idleCompaction`（:9534-9542）、`autoCompactWindow`+per-model（:9298/:9287）、`PreCompact{trigger,custom_instructions}`/`PostCompact` hooks（:2734/:2610）、`SDKCompactBoundaryMessage`（:3817）、CompactionBlock（beta-messages.d.ts:3627）
- 判定：**PARTIAL**（session.compacting/compacted 事件有；压缩策略参数、预计算、自定义压缩指令全缺）
- 意义：MAFW 的 turnCompress flush 挂在 compacted 事件上；`PreCompact.custom_instructions` 可让谐波记忆系统**参与压缩提示词**（哪些记忆要保留）——认知面 injectVerb 的天然挂点。
- 证据：sdk.d.ts:2734-2738, 9534-9542

**D4. 会话转录镜像（SessionStore dual-write）**
- SDK 表面：`sessionStore: SessionStore`（:1862，:6817 接口 load/save/listSubkeys…）+`sessionStoreFlush:'batched'|'eager'`（:1870）+`importSessionToStore`（:1017）+`foldSessionSummary`（:837）+`InMemorySessionStore`（:1054）；子进程本地照写 + 镜像侧双写
- 判定：**MISSING**
- 意义：MAFW 各 runtime 会话存储私有（opencode SQLite/pi 自有），gateway 靠 sessionStorageApi 直读。**统一 SessionStore 镜像契约**可实现跨 runtime 的会话可移植/可恢复（worker 重启、gateway 迁移），比逐 runtime 适配器更根本。
- 证据：sdk.d.ts:1851-1880, 6817-6940

### E. 工具/MCP 面

**E1. 动态 MCP 服务器管理 + per-tool 策略**
- SDK 表面：`setMcpServers(servers)` 运行期整体替换（:3264，`McpSetServersResult{added,removed,errors}` :1333）；`McpServerConfig` 四形态（stdio/sse/http/SDK in-process，:1246）；`McpServerToolPolicy{name,permission_policy:'always_allow'|'always_ask'|'always_deny',org_max_permission}`（:1321，changelog@0.3.301）；`mcpServerStatus()`（:3077，含 `source` 信任标记）；`reconnectMcpServer/toggleMcpServer`（:3214/:3222）；`readMcpResource('ui://…')`（:3235，MCP Apps SEP-1865）；per-server `timeout`/`alwaysLoad`（:1354-1361）
- 判定：**MISSING**（基线 tools.registerTools 是单工具粒度，无服务器概念、无 per-tool 权限策略、无生命周期）
- 意义：MAFW 六件套经 MCP 自接线（opencode）或 typebox（pi）——**工具注册契约可吸收"注册组=服务器"语义**：per-group enable/disable、per-tool 权限档、超时。这是 tool-classes 层的下一步。
- 证据：sdk.d.ts:1194-1362, 3209-3264

**E2. 工具搜索（deferred loading）+ alwaysLoad**
- SDK 表面：内建 `ToolSearch` 工具（:216）；`tool(name,desc,schema,handler,{searchHint,alwaysLoad})`（:10044）；`createSdkMcpServer({alwaysLoad})`（:632）；deferred 行=上下文分类 kind:'deferred'（:3932）；搜索态工具描述截断 16384（changelog@0.3.295）
- 判定：**MISSING**
- 意义：MAFW 44 个 MCP 工具全量常驻 prompt；工具多时 deferred+search 是上下文经济性方案。多运行时契约可加 `NativeToolDeclaration.deferred?`。
- 证据：sdk.d.ts:216, 10044-10048, 632-663

**E3. 会话中动态增删工具**
- SDK 表面：ContentBlock 层 `BetaRequestToolAdditionBlock/BetaRequestToolRemovalBlock`（beta-messages.d.ts:3628）；`SDKMCPToolListingBlock`（:3627）；`WaitForMcpServers` 工具（:216）
- 判定：**MISSING**
- 意义：goal 编排按节点换工具面（plan 节点只读、execute 全开）目前靠身份物化；消息级 tool_addition/removal 是更细的粒度。
- 证据：beta-messages.d.ts:3628

**E4. 工具别名重定向（toolAliases）**
- SDK 表面：`toolAliases:{Bash:'mcp__workspace__bash'}`（:1662，单跳防环；与 disallowedTools 互补：别名只影响模型发射的 tool_use 名解析）
- 判定：**MISSING**
- 意义：MAFW tool-classes canonical 翻译层（`canonicalToolOf`）是**读方向**归一；toolAliases 是**写方向**重定向——沙箱化执行（Bash→远程沙箱 MCP）的关键配套。
- 证据：sdk.d.ts:1637-1662

### F. 输入/流式面

**F1. 流式输入优先级队列**
- SDK 表面：`streamInput(AsyncIterable<SDKUserMessage>)`（:3271）；`priority:'now'|'next'|'later'`（:6516，'now' 抢占运行中 turn 并把工具转后台合并，changelog@0.3.286）；`queued_turn_count`（:6048）；`interrupt()` receipt `still_queued`（:2912）；`cancel_queued`（changelog@0.3.219）
- 判定：**PARTIAL**（delivery:'steer' 是二值排队语义；无优先级车道、无回执、无取消排队）
- 意义：基线 prompt 的 `delivery` 可升三值 `delivery:'now'|'steer'|'later'`；interrupt 回执让"中止后哪些消息还会跑"可判定（现在 abort 后 queued 消息行为未定义）。
- 证据：sdk.d.ts:6516, 3271, 2912

**F2. 逐字投递（verbatimPrompts/client_composed）**
- SDK 表面：`verbatimPrompts`（:1926）；`SDKUserMessage.client_composed`（:6556）——跳过 @path 展开、slash 派发、`@server:resource`、turn 起始附件（CLAUDE.md/技能列表/提醒）
- 判定：**MISSING**（MAFW transform 注入的内容若含 @或/slash 会被 runtime 二次解释——已靠 synthetic 标记部分防回流，但无逐字语义）
- 意义：injectContext 注入的 `<recall>` 指针块若被 runtime 展开语义污染是隐患；契约可加 `prompt.verbatim` 位。
- 证据：sdk.d.ts:1893-1926, 6556-6558

**F3. 多媒体输入（image/PDF/document 块）**
- SDK 表面：`MessageParam` content 数组直收 image/document 块（beta-messages.d.ts:3628）；Read 工具 PDF→页 image 块入 tool_result（changelog@0.3.243）；`pasted_content`（:6579）
- 判定：**PARTIAL**（基线 file part 一等载体 + pi fixMediaPayload wire 改写；无 PDF 页级、无 document 块语义）
- 意义：媒体 executor 是 gateway 非契约能力，但**主模型直接吃媒体**的契约语义（SessionPromptOpts.parts）已对齐；document 块是增量。
- 证据：beta-messages.d.ts:3628; changelog@0.3.243

### G. 安全/企业面

**G1. 沙箱（sandboxing）**
- SDK 表面：`SandboxSettings`（:3526-3626 zod schema）：`enabled/failIfUnavailable/autoAllowBashIfSandboxed/allowUnsandboxedCommands`；network（allowedDomains/deniedDomains/strictAllowlist/unix sockets/Mach lookup/proxy ports/tlsTerminate）；filesystem（allow/denyRead/denyWrite）；**credentials**（files/envVars 的 deny/**mask**、JWT decode+maskClaims、extract、awsPairs、sigv4 streaming/presigned 重签）；`ignoreViolations`/`excludedCommands`/`ripgrep`/`bwrapPath`；与 inline settings 合并规则（:2203-2218）；`CLAUDE_CODE_DISABLE_WORKFLOWS` 等
- 判定：**MISSING**（MAFW python 内核"无沙箱（本机可信场景）"自认）
- 意义：这是**子进程级 OS 沙箱**（bubblewrap 等），超出 gateway 契约能做的（网关只能审批门控）。多运行时契约可加 `runtime.capabilities.sandbox` 能力位声明，供审批三档的 auto 档参考"沙箱内自动放行"。
- 证据：sdk.d.ts:2186-2241, 3421-3626

**G2. 策略设置层（managedSettings/政策链）**
- SDK 表面：`managedSettings`（:2288，restrictive-only 过滤合并）；`policyHelper`（:6996）；`allowedProviders/availableModels/deniedModels/availableModelsMatch`（:7136-7148）；`disableAllHooks/allowManagedHooksOnly`；Windows HKLM/WSL 策略链（:7043）
- 判定：**MISSING**（MAFW 无组织策略概念——个人工具合理，多用户部署缺位）
- 意义：低优先；若 MAFW 走团队化才需要。
- 证据：sdk.d.ts:2260-2288, 6993-7003, 7134-7148

**G3. 云会话/团队/远程控制**
- SDK 表面：`Settings.remote.defaultEnvironmentId`（:9367，cloud sessions 环境）；`forceLoginMethod:'claudeai'|'console'|'gateway'`（:8889）；`autoUploadSessions`（:9603，本地会话镜像到 claude.ai 只读）；`crossSessionInbound:'accept'|'hold'|'refuse'`（:9599，跨会话消息准入）；teammates：`teammateMode:'auto'|'tmux'|'iterm2'|'in-process'`（:9582）+ SendMessage/TeammateIdle hook + `isolatePeerMachines`（:9591）；channels（:9414，MCP 服务器推入站消息）；organization memory scope（:5540）；`inputNeededNotifEnabled`/`agentPushNotifEnabled` 移动推送（:9607-9611）
- 判定：**MISSING**（全缺；MAFW 是单机单用户架构）
- 意义：跨会话消息传递（SendMessage/peer messages + command_lifecycle 状态机 queued/started/completed/cancelled/discarded，changelog@0.3.206）是 MAFW milestone-push/btw 通道的官方同构物；command_lifecycle 的**终态机语义**（dup-over-loss）值得吸收进 turn 词汇。
- 证据：sdk.d.ts:9367-9372, 9582-9611, 8889

### H. 性能/生命周期面

**H1. 进程预热（prewarm/SpareProcess + startup/WarmQuery）**
- SDK 表面：`startup()→WarmQuery`（:9849/:10236，spawn+init 握手提前，prompt 即写）；`prewarm()→SpareProcess.claim()`（:2873/:332-381/:9675，**会话未定先起进程**：parked 230-260MB，claim 绑定 cwd/model/permissionMode/settings overlay/agents；fail-closed 拒绝语义分类）；`warm_spare_claimed`/`time_to_request_from_spawn_ms` 时延字段（:6019）
- 判定：**MISSING**（opencode serve sidecar 是常驻复用，语义近似 startup；但 SpareProcess 的"延迟绑定会话参数"没有）
- 意义：gateway 管理的 worker/media 会话冷启动是实测痛点（pi 进程内嵌入无此问题；Claude 形 runtime 有）。
- 证据：sdk.d.ts:2804-2880, 9675-9756, 9849-9866

**H2. 系统提示缓存分界与快照**
- SDK 表面：`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`（:9967）分隔静态前缀（跨会话缓存）/动态后缀；`excludeDynamicSections`（:2359，动态段挪到首条 user message，跨机器/用户共享缓存前缀）；`snapshot:true`（:2406，会话内冻结系统提示，改提示等 compaction 才生效——防前缀缓存失效+thinking 丢弃）
- 判定：**PARTIAL**（injectSystem 有"半稳定内容靠后"意识；无分界标记/快照语义）
- 意义：MAFW 每轮注入 memory-guide/user-profile/agent-priors 三个块——**边界 recall 是 per-turn 动态注入，天然破坏前缀缓存**；boundary 快照语义（注入内容会话内冻结+变更打版本）可显著提缓存命中。
- 证据：sdk.d.ts:9958-9975, 2350-2460

**H3. 断线重握手（reinitialize）**
- SDK 表面：`reinitialize()`（:3053）：重发 init；响应携带在途 `can_use_tool`/`request_user_dialog` 控制请求并重投；SDK 侧 request_id 去重；stdio 下重新注册 hooks（`hooks_applied`）
- 判定：**MISSING**（SSE 重连有了，但**重连后在途审批的恢复**没有）
- 意义：MAFW desktop SSE 断连重订阅后，pending permission.asked 是否还可见未定义——正好对应此能力。
- 证据：sdk.d.ts:3029-3053, 409-437

**H4. 挂起结果与命令生命周期可观测**
- SDK 表面：`result_index`（:6056）；`command_lifecycle` 帧（changelog@0.3.206/307）；`SDKControlRequestProgressMessage`（:5213，side_question 进度）；`SDKPromptSuggestionMessage`（:5857）；`ttft_ms`/first_content_frame_ms 等时延族（:5974-6018）
- 判定：**PARTIAL**（turn.completed 有；消息级终态机与 TTFT 无）
- 意义：turn 词汇可扩 `turn.index`；TTFT 对 usage/性能面板有直接价值。
- 证据：sdk.d.ts:5969-6060, 5213-5227

### I. 使用量面

**I1. 逐模型使用账本（modelUsage）**
- SDK 表面：`SDKResultSuccess.modelUsage: Record<string, ModelUsage>`（:6041）；`ModelUsage`（:1464-1489）：input/output/**thinkingTokens**/cacheRead/cacheCreation/webSearchRequests/costUSD/**contextWindow**/**maxOutputTokens**/**canonicalModel**/**provider**/**costBasis:'list'|'managed'|'unknown'**（价目基准审计）；`usage`（主循环 per-turn）vs `modelUsage`（累计、含子代理/sidechain/compaction/Workflow 内部调用）双口径文档化（:6031-6041）
- 判定：**PARTIAL**（usage.updated 合成自 TrajectoryTurn tokens/cost；无 cache 命中分解、无 per-model 累计口径、无价目基准）
- 意义：MAFW usage 配额插件 + UsageDock 的分模型统计可直接吸收字段级形态（cacheRead/cacheCreation/thinkingTokens/costBasis）。
- 证据：sdk.d.ts:1464-1489, 5969-6062

**I2. 限额事件与自动续跑**
- SDK 表面：`SDKRateLimitEvent`（:5867，allowed/rejected/allowed_warning + resetsAt/overage 族）；`SDKRateLimitInfo.overageEnabled`（changelog@0.3.295）；`autoContinueAtUsageLimit`（:9550，限额到→等待自动续跑）；`SDKAuthStatusMessage`（:3760）
- 判定：**MISSING**（契约层）
- 意义：长跑 goal（watchdog 重试）对 provider 限额的可观测与等待策略，现在只有 turn.failed 单一信号。
- 证据：sdk.d.ts:5867-5905, 9548-9550

---

## Top 10 缺口（按价值排序）

| # | 能力 | SDK 表面 | 判定 | 价值 |
|---|---|---|---|---|
| 1 | 认知面门控/改写 hooks（拦工具调用、改工具输入/输出、拦 prompt、拦 Stop） | `Options.hooks` 33 事件 + PreToolUse.updatedInput + PostToolUse.updatedToolOutput | MISSING | **高** |
| 2 | 子代理/sidechain 全栈（定义+事件+消息回读+后台任务控制） | `AgentDefinition`/`forwardSubagentText`/`task_*` 消息/`getSubagentMessages`/`backgroundTasks`/`stopTask` | MISSING | **高** |
| 3 | 检查点/rewind（文件回滚 dryRun + 验证式截断恢复 + 消息级 rewind_conversation） | `enableFileCheckpointing`/`rewindFiles`/`resumeSessionAt`+`resumeDropsTurn` | MISSING | **高** |
| 4 | 会话级结构化输出（StructuredOutput 工具 + 自动重试 + 终态分类） | `outputFormat`+`result.structured_output`+`error_max_structured_output_retries` | PARTIAL | **高** |
| 5 | 动态 MCP 管理 + per-tool 权限策略 + elicitation 表单 | `setMcpServers`/`McpServerToolPolicy`/`onElicitation` | MISSING | **高** |
| 6 | 流式输入优先级车道 + 中止回执（now/next/later + still_queued） | `priority`/`queued_turn_count`/`interrupt()` receipt | PARTIAL | **高** |
| 7 | 审批回调富化（'ask' 回退 + updatedInput 改写 + updatedPermissions 回写 + 子代理路由） | `CanUseTool`/`PermissionResult` | PARTIAL | **高** |
| 8 | 上下文逐类 token 分解（mcp_tools/memory_files/agents/skills 逐项） | `getContextUsage`/`SDKContextUsage` | MISSING | **中** |
| 9 | thinking/effort 控制面（budget/adaptive/display/signature 保全） | `ThinkingConfig`/`effort`/`setMaxThinkingTokens` | PARTIAL | **中** |
| 10 | 会话转录镜像 + 断线重握手（SessionStore dual-write + reinitialize 在途审批恢复） | `sessionStore`/`importSessionToStore`/`reinitialize()` | MISSING | **中** |

（次级：沙箱 sandbox、进程预热 prewarm、工具搜索 deferred、toolAliases、系统提示缓存分界、auto-memory 召回事件、云会话/团队、命令生命周期终态机、逐模型使用账本、taskBudget——详见 §⑥。）

---

## 方法论附注

- 本地类型枚举法：`grep ^export declare (type|interface|class|const|function)` 全量 350+ 导出 → 按行号精读 Options/Query/Hooks/SDKMessage/Settings/Sandbox 六大块；Settings 接口（:6964-9625，~2660 行）只精读了能力相关键（memory/compact/context/effort/ultracode/fastMode/remote/voice/teammate/channels/workflows），UI 键（theme/editorMode/vim 等）略过。
- web 侧仅用于版本钉扎与两份功能页语义核对（structured-outputs / file-checkpointing）+ CHANGELOG 差量；0.3.306↔0.3.307 无能力面变化，**未发现任何仅存在于 web 文档而不在本地类型的能力**。
- 未验证项（诚实披露）：`SDKControlInitializeResponse` 内部能力清单字段（:4740 起 600+ 行）未逐行精读；beta-messages.d.ts 的 server tool 块（web_search/code_execution 等）仅枚举未展开——这两块与 MAFW 契约相关度低（前者是握手细节，后者是 API 侧工具）。
