# 02 · OpenAI Codex（CLI/app-server）+ Google Gemini CLI 能力面盘点

> MAFW gateway 契约缺口研究 · 子报告 2/2 · 调查日期 2026-10-22
> 定位：只读网络调研。对照面 = MAFW 契约基线（消息 DTO / 事件 / Runtime 动词）。**只列超出 audit 已钉扎内容的能力面**，已钉扎事实（thread/* 与 item/* 事件族基础形态、审批四值、14 hooks 全集、结构化输出重试等）不重复展开，仅在新证据修正时标注。

---

## ① 版本钉扎（证据锚点）

| 对象 | 版本/commit | 日期 | 证据 |
|---|---|---|---|
| openai/codex `main` | commit `2a77e82f09212c9e1bbf02656afca5d8172c5f9e`（"Support configured credential providers in remote execution"） | 2026-10-22T01:54:51Z | api.github.com/repos/openai/codex/commits/main |
| npm `@openai/codex` | 0.163.0（latest） | 2026-10-15T21:37Z | registry.npmjs.org/@openai/codex |
| npm `@openai/codex-sdk` | 0.163.0（latest）；0.164.0-alpha.10（alpha） | 2026-10-15 / 2026-10-22 | registry.npmjs.org/@openai/codex-sdk |
| google-gemini/gemini-cli `main` | pushed_at 2026-10-22T01:23:52Z（branch 随调查日推进） | 2026-10-22 | api.github.com/repos/google-gemini/gemini-cli |
| npm `@google/gemini-cli` | 0.65.0（latest） | 2026-10-20T21:26Z | registry.npmjs.org/@google/gemini-cli |
| developers.openai.com/codex | 抓取时 403（反爬），产品面证据以仓库内 stub（docs/*.md 全部外链该站）+ 第三方报道补齐 | 2026-10-22 | 见 §③ |

**证据文件缩写**（下文表格引用；均指 openai/codex@2a77e82 / google-gemini/gemini-cli@main raw 文件）：

- **[P-CR]** `codex-rs/app-server-protocol/schema/typescript/ClientRequest.ts`（ts-rs 生成，客户端→服务端方法全集）
- **[P-SN]** `codex-rs/app-server-protocol/schema/typescript/ServerNotification.ts`（服务端通知全集）
- **[P-SR]** `codex-rs/app-server-protocol/schema/typescript/ServerRequest.ts`（服务端→客户端请求全集）
- **[P-V2]** `codex-rs/app-server-protocol/schema/typescript/v2/*.ts`（655 个类型文件；单项时直接写文件名）
- **[P-RS]** `codex-rs/app-server-protocol/src/protocol/common.rs`（方法字符串全集，含 experimental 网面；263 个 method 形态字符串）
- **[AS-RD]** `codex-rs/app-server/README.md`（618 行，现仅承载"协议增量"章节）
- **[SDK]** `sdk/typescript/README.md` + `sdk/typescript/src/{events,threadOptions,turnOptions}.ts`
- **[G-docs]** gemini-cli `docs/**`（文件路径逐条给出）
- **[G-code]** gemini-cli `packages/{cli,core}/src/**`

---

## ② Codex app-server 方法 + 事件全枚举 vs 基线

### ②.1 协议形态修正（超出 audit 钉扎的部分）

- 协议类型已从 app-server 内嵌拆为独立 crate `codex-rs/app-server-protocol`，并带**机器生成三语料**：`schema/json/*.json`（单类型 + 合并 `codex_app_server_protocol.schemas.json` / `.v2.schemas.json`）、`schema/typescript/*.ts`、`src/protocol/{common,thread_history}.rs`。协议有 **v1/v2 双版本**（`src/protocol/v1.rs` 与 `v2/`；v2 = 分页线程契约）。证据：crate 目录树 + [P-CR] import 混用 `./v2/`。
- **experimental 门控是一等协议概念**：`initialize.capabilities.experimentalApi`（bool）+ `optOutNotificationMethods`（按连接逐方法关通知）+ `extensions`（MCP 扩展协商 map）。方法级/字段级 experimental 用 derive 宏 `#[experimental("reason")]` 标注，运行时报 `"<method> requires experimentalApi capability"`。证据：`InitializeCapabilities.ts`、`src/experimental_api.rs`。
- `thread/rollback` **已删除**（未知方法路径拒绝），统一走 `thread/revert`；磁盘上历史 `ThreadRolledBack` 事件仍可重放迁移。证据：[AS-RD] "Thread rollback" 节 → 修正并确认 audit 钉扎。

### ②.2 客户端→服务端方法全枚举（按域分组，共 ~135 个；`*` = 需 experimentalApi）

**会话/线程生命周期**：initialize；thread/start、thread/resume（threadId | 内存 history | 路径 三选一，可**rejoin 运行中线程**）、thread/fork（`lastTurnId` 截断 + `excludeTurns` 分页水合）、thread/archive、thread/unarchive、thread/delete、thread/unsubscribe、thread/list（cursor/limit/excludedThreadIds≤100/sortKey/sortDirection/modelProviders/sourceKinds/originators/archived/sectionId/cwd 数组/useStateDbOnly/searchTerm）、thread/loaded/list、thread/read（含 readState 回执）、thread/turns/list（双向 cursor）、thread/items/list（cursor 或 **item anchor** `{"type":"item","itemId}` + turnId + asc/desc + backwardsCursor）、thread/items/read、thread/search、thread/searchOccurrences、thread/timeline/list、thread/inject_items（注入原始 Responses API items 进模型可见历史）、thread/shellCommand（**非沙箱**全权 shell，保留管道/重定向语义，timeoutMs 默认 1h）、thread/name/set、thread/metadata/update、thread/metadata/gitInfo/update、thread/settings/update、thread/approveGuardianDeniedAction、thread/revert、thread/sample *、thread/sample/cancel *、thread/prediction/request *、thread/memoryMode/set *、thread/compact/start（主动触发压缩）。

**分区/附件/项目**：threadSection/list|create|update|delete、thread/section/move；thread/attachment/add|list|remove、thread/attachmentOwner/list（反向按资源找线程，如 PR↔thread）；project/list|create|read|update|delete|move|import。

**turn**：turn/start（见 ②.6 参数面）、turn/steer（`expectedTurnId` 乐观并发前置条件）、turn/interrupt、turn/settings/update。

**队列**：thread/queue/add|list|update|delete|reorder|start（busy 线程的提交排队与重排）。

**goal**：thread/goal/set|get|clear（objective + status + `tokenBudget` + tokensUsed + timeUsedSeconds，带 mutation origin 溯源）。

**审批/权限**：permissionProfile/list（可用权限档位 + allowed 标志）。

**工具/MCP**：mcpServerStatus/list（返回 serverCapabilities 含 extensions map）、mcpServer/tool/call（**直调** MCP 工具）、mcpServer/resource/read（hosted app 直读 target{connectorId,linkId}）、mcpServer/oauth/login、mcpServer/event/stream/start|stop、config/mcpServer/reload、fuzzyFileSearch（+ sessionStart/sessionUpdate/sessionStop 客户端会话操作，配套 sessionUpdated/sessionCompleted 通知）。

**进程/文件系统**：command/exec、command/exec/write|terminate|resize（PTY/ConPTY/tty 流式进程控制）；process/spawn|writeStdin|kill|resizePty *（后台进程）；thread/backgroundTerminals/list|terminate|clean *；fs/readFile、fs/writeFile、fs/createDirectory、fs/getMetadata、fs/readDirectory、fs/remove、fs/copy、fs/watch、fs/unwatch（+ fs/changed 通知，按 watch_id 序列化作用域）。

**模型/账号/计量**：model/list、modelProvider/capabilities/read、account/read、account/login/start|cancel、account/logout、account/rateLimits/read、account/rateLimitResetCredit/consume、account/usage/read、account/workspaceMessages/read、account/sendAddCreditsNudgeEmail、account/gatewayOAuth/read|login|cancel、account/bedrock/setup|discover|checkGovCloudRequirements *、getAuthStatus、getConversationSummary、gitDiffToRemote（工作区 vs remote 的 diff）、currentTime/read、server/diagnostics。

**环境/远控/实时**：environment/add *（environmentId + execServerUrl `ws://` + authBearerToken + connectTimeoutMs + skills 需求）、environment/info *、environment/status *；remoteControl/enable|disable *、remoteControl/status/read *、remoteControl/pairing/start|status *、remoteControl/client/list|revoke *（配对/吊销远控客户端）；thread/realtime/start|stop|listVoices|appendAudio|appendSpeech|appendText *（实时语音会话，transport = websocket | webrtc(SDP) | existingCall）；collaborationMode/list *。

**生态**：skills/list、skills/extraRoots/set、skills/config/write；hooks/list；marketplace/add|remove|upgrade；plugin/list|installed|reconcile|read|skill/read|search|install|uninstall、plugin/share/save|updateTargets|list|checkout|delete（**插件分享给其他主体**，含 principal/role）；app/read|list|installed（Codex Apps 目录）；externalAgentConfig/detect|import *、externalAgentConfig/import/recordHistory|readHistories（**从 Claude Code 等外部代理导入配置与历史**）；experimentalFeature/list|enablement/set（运行时特性开关，含 stage 枚举）；feedback/save|upload；rollout/compress *（本地 rollout 存储后台压缩）；config/read、config/value/write、config/batchWrite、configRequirements/read；windowsSandbox/setupStart、windowsSandbox/readiness；review/start（inline 或 detached 复审线程，detached 已弃用）；userVerification/status|enroll|delete|verify|cancel *（本地生物特征 ECDSA P-256 签名证明）。

### ②.3 服务端→客户端通知全枚举（[P-SN]，共 89 个；分组）

- **线程生命周期**：thread/started（含 Thread 全量：forkedFromId、parentThreadId、agentNickname、agentRole、section、projectId、historyMode、gitInfo、originator、source…）、thread/status/changed（notLoaded|idle|systemError|active+activeFlags）、thread/closed、thread/archived、thread/unarchived、thread/deleted、thread/reverted、thread/unsubscribe（状态）。
- **线程元数据**：thread/name/updated、thread/goal/updated、thread/goal/cleared、thread/prediction/updated *、thread/queue/changed、thread/project/updated、thread/settings/updated、thread/readState/changed *（读/未读回执 + revision）、thread/attachment/updated、thread/section 相关（经 thread/settings 系列承载）。
- **环境/连接**：thread/environment/connected|disconnected、project/changed、fs/changed、remoteControl/status/changed、windows/worldWritableWarning、windowsSandbox/setupCompleted。
- **turn**：turn/started、turn/completed、turn/diff/updated（**turn 级统一 diff 聚合**）、turn/plan/updated（TurnPlanStep{step,status}）、turn/moderationMetadata。
- **item**：item/started、item/completed（带 completedAtMs）、item/agentMessage/delta、item/plan/delta（**plan 流式增量**）、item/reasoning/summaryTextDelta、item/reasoning/summaryPartAdded、item/reasoning/textDelta、item/commandExecution/outputDelta、item/commandExecution/terminalInteraction（终端交互事件）、item/fileChange/outputDelta、item/fileChange/patchUpdated、item/mcpToolCall/progress、item/autoApprovalReview/started|completed、autoApprovalReview/strictReviewRequired。
- **进程**：command/exec/outputDelta、process/outputDelta、process/exited。
- **原始响应**：rawResponseItem/completed、rawResponse/completed（**wire 级原始事件透传**，调试用）。
- **模型**：model/rerouted（含 reroute reason）、model/verification、model/safetyBuffering/updated、modelProvider/authRecoveryStarted|Completed。
- **用量/账号**：thread/tokenUsage/updated（total + last + modelContextWindow；breakdown = total/input/cachedInput/cacheWriteInput/output/reasoningOutput）、account/updated、account/login/completed、account/rateLimits/updated、account/gatewayOAuth/changed。
- **MCP**：mcpServer/startupStatus/updated、mcpServer/oauthLogin/completed、mcpServer/event/stream/notification。
- **hooks/生态**：hook/started、hook/completed、skills/changed、app/list/updated、externalAgentConfig/import/progress|completed。
- **实时语音（11 个）**：thread/realtime/started、thread/realtime/itemAdded、item/started、item/transcript/delta、item/completed、transcript/delta、transcript/done、outputAudio/delta、sdp、error、closed。
- **杂项**：error、warning、guardianWarning、deprecationNotice、configWarning、fuzzyFileSearch/sessionUpdated|sessionCompleted、serverRequest/resolved（**多客户端审批协同：他端已应答**）。

### ②.4 服务端→客户端请求（[P-SR]，10 个）

`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval`、`item/tool/requestUserInput`、`mcpServer/elicitation/request`、**`item/tool/call`（动态工具：服务端把工具执行委托回客户端，DynamicToolCallParams）**、`account/chatgptAuthTokens/refresh`、`attestation/generate`（上游 `x-oai-attestation` 头）、legacy `applyPatchApproval`、legacy `execCommandApproval`。

**审批决策枚举**（v2）：CommandExecution = `accept | acceptForSession | acceptWithExecpolicyAmendment{amendment} | applyNetworkPolicyAmendment{amendment} | decline | cancel`；FileChange = `accept | acceptForSession | decline | cancel`；权限档 `PermissionGrantScope = turn | session`；`RequestPermissionProfile = {network, fileSystem} 附加权限`。→ 超出基线 `once|always|reject`：多了 **policy amendment（批准时改策略）**、**cancel**、**turn 粒度授权**。

### ②.5 item 类型（线程内容部件）vs MafwPart

`ThreadItem`（v2/ThreadItem.ts）22 种：userMessage（含 text_elements 富文本 span、skill/mention 引用型输入）、hookPrompt、agentMessage（`questions: AsyncUserInputQuestion[]{title,options}` + `delivery:"async"` + `memoryCitation{entries,threadIds}`）、functionCallOutput、plan、reasoning、commandExecution（command、cwd、processId、source、status、**commandActions 解析动作列表**、aggregatedOutput、exitCode、durationMs）、fileChange（changes: FileUpdateChange[]、status: PatchApplyStatus）、mcpToolCall（server/tool/status/arguments/appContext/mcpAppUi{resourceUri, displayMode}/readOnlyHint/result/error/durationMs）、dynamicToolCall（namespace/tool/arguments/status/contentItems/success/durationMs）、**collabAgentToolCall**（spawnAgent|sendInput|resumeAgent|wait|closeAgent|sendMessage|followupTask|interruptAgent|listAgents；senderThreadId、receiverThreadIds、per-agent model/reasoningEffort、agentsStates）、**subAgentActivity**（started|interacted|interrupted|completed + agentThreadId/agentPath/model/effort）、webSearch（WebSearchItem：action/mode/contextSize/location）、imageView、sleep（SleepItem）、imageGeneration（成功/失败/输入图）、enteredReviewMode、exitedReviewMode、contextCompaction。

vs 基线 `text|reasoning|tool|image|file|step-start|step-finish`：**命令执行、文件变更、web 搜索、图像生成、sleep、hook 提示、协作代理调用、子代理活动均为一等 item**；step-start/finish ≈ item.started/completed（语义等价，命名不同）。

### ②.6 turn/start 参数面（per-turn override 契约）

`TurnStartParams`：threadId、input（UserInput[]：text+text_elements | image(url/fileId) | localImage(path) | audio | localAudio | **skill(name,path)** | **mention(name,path)**）、clientUserMessageId、`turnTrigger`、**`parentTurnId` + `rootTurnId`（委托工作链归属）**、toolOutput（附工具结果 + retain 保留进历史）、**cwd、approvalPolicy（untrusted|on-request|granular{sandbox_approval,rules,skill_approval,request_permissions,mcp_elicitations}|never）、approvalsReviewer（user|auto_review|guardian_subagent）、sandboxPolicy（dangerFullAccess|readOnly{networkAccess}|externalSandbox|workspaceWrite{writableRoots,networkAccess,excludeTmpdirEnvVar,excludeSlashTmp}）、model、serviceTier + serviceTierForTurn、effort、summary、outputSchema（JSON Schema 约束最终消息）**、disabledPluginIds、personality（已弃用）。→ **沙箱策略、审批策略、审批者、结构化输出都是 turn 级参数**，且"改变持续到后续 turn"。

---

## ③ Codex 产品 / 沙箱 / 云任务面

1. **沙箱矩阵**：`SandboxMode = read-only | workspace-write | danger-full-access`；`SandboxPolicy` 细化到 writableRoots/网络/excludeTmpdirEnvVar/excludeSlashTmp；平台实现 = macOS Seatbelt、Linux landlock/seccomp（`linux-sandbox` crate）、Windows **MXC** 新后端 + legacy elevated/unelevated（`windows-sandbox-rs`/`mxc-sandbox` crate；windowsSandbox/setupStart|readiness RPC；MXC 走标准 command/exec + ConPTY 路径）。另有 `execpolicy` crate（命令级裁决规则引擎，对应 `codex execpolicy`，docs/execpolicy.md → developers.openai.com/codex/exec-policy）与 **ExecPolicyAmendment**（审批时可修订 execpolicy）。证据：[P-V2] SandboxMode/SandboxPolicy/SandboxWorkspaceWrite/ExecPolicyAmendment.ts、codex-rs 目录树、[AS-RD] Windows sandbox 节。
2. **网络策略双平面**：agent-network（沙箱内）与应用层网络策略（managed TOML merge，domain allowlist，仅 HTTPS/WSS，fail-closed：加载失败阻断流量、策略变更撤销在途请求）。证据：[AS-RD] "Application network policy" 两节、application_network.rs。
3. **远程执行环境 / exec-server 协议**：`codex-rs/exec-server-protocol`（JSON-RPC over WebSocket）方法集：process/start|read|write|signal|terminate|output|exited|closed、fs/readFile|open|readBlock|writeBlock|close|writeFile|createDirectory|getMetadata|canonicalize|readDirectory|walk|remove|copy、**http/request(+bodyDelta)**（代理出站 HTTP）、environment/info|status、environmentConfig/read（远端 config/requirements 分层选择 + cloud 层插入点）。配套 app-server 侧 `environment/add{environmentId, execServerUrl(ws://), authBearerToken, connectTimeoutMs, skills 约束}` + `thread/environment/connected|disconnected` 通知 + TurnEnvironmentParams{environmentId, cwd, runtimeWorkspaceRoots}。这是**"把 agent 运行时挂到远端机器/云环境"的完整协议面**。证据：exec-server-protocol/src/{protocol,environment_config}.rs、[P-RS]、[P-V2]。
4. **云任务**：`codex cloud`（cloud-tasks crate：new_task、TaskStatus、TaskListPage、TurnAttempt、DiffSummary、**ApplyOutcome（把云任务 diff 应用回本地）**、scrollable_diff、env_detect；后端 chatgpt.com/backend-api，CODEX_CLOUD_TASKS_BASE_URL 可覆写）。产品面：Codex Web（chatgpt.com/codex）、**可复用云环境**（2026-09-29 TechCrunch：跨设备复用 cloud dev environments、新 /agents 视图）、IDE 扩展在云/本地间移动任务（openai.com/index/introducing-upgrades-to-codex）、ChatGPT 手机端可跟踪并 steer 云任务（X/OpenAIDevs 2026-10、agent37.com Codex Cloud 综述）。README（仓库根）确认三形态：本地 CLI / IDE 扩展（VS Code、Cursor、 Windsurf）/ Codex Web + `codex app` 桌面壳。证据：cloud-tasks/src/lib.rs、cloud-tasks-client/src/lib.rs、README.md、techcrunch.com/2026/09/29/…、developers.openai.com/blog/run-long-horizon-tasks-with-codex（URL 存在，正文 403）。
5. **Rollout / 会话持久化**：rollout JSONL（~/.codex/sessions）+ thread-store（**state DB + JSONL 扫描修复双路径**，useStateDbOnly 可切纯 DB 路径，cursor 异常报 -32603 提示重试）+ rollout/compress 后台压缩 + 共享 histories 必须支持压缩文件。thread/resume 支持**按路径加载**与**rejoin 运行中线程**（多客户端并发视图）。证据：[AS-RD] Thread list exclusions / Local rollout compression 节、thread-store/rollout crate、[P-V2] ThreadResumeParams。
6. **externalAgentConfig 迁移**：detect/import Claude Code 等外部代理的配置与历史（ExternalAgentConfigImportParams + progress/completed 通知 + import/recordHistory 链接回写）。证据：[P-CR]、external-agent-migration crate、[P-V2] ExternalAgent*。
7. **TS SDK（0.163.0）**：已从"仅 exec-JSONL"升级为 **Thread API**：`codex.startThread({workingDirectory, skipGitRepoCheck, model, sandboxMode, approvalPolicy(never|on-request|on-failure|untrusted), modelReasoningEffort(minimal…ultra|persistent), networkAccessEnabled, webSearchMode(disabled|cached|live), webSearchEnabled, additionalDirectories, threadSource})`、`thread.run()`（缓冲）或 `runStreamed()`（async generator）；事件 = thread.started/turn.started/turn.completed(usage)/turn.failed/item.started|updated|completed/error；`turnOptions = {outputSchema, signal: AbortSignal, cyberAccessProgram(standard|daybreak_blue|daybreak_red)}`；`resumeThread(threadId)`；`env` 全量环境控制；`--config` TOML 展开覆盖 + configOverrides 原样透传。证据：[SDK]。
8. **Guardian / 自动复审**：auto_review 审批者 = "经谨慎提示的 subagent 按风险框架裁决"；Guardian 告警（guardianWarning）、拒绝上限断路器（`auto_review.circuit_break_action="strict"` → TurnAborted 带 `tooManyDenials` codexErrorInfo）、strictReviewRequired、thread/approveGuardianDeniedAction（用户推翻 Guardian 拒绝）、item/autoApprovalReview/started|completed、Guardian reviewer 本身是"内部 worker 线程"（archive/delete 不能删）。证据：[AS-RD] Guardian circuit-breaker / Thread removal 节、[P-V2] ApprovalsReviewer/GuardianWarning/CodexErrorInfo。
9. **hooks（14）**：PreModelRequest、PostModelRequest、PreToolUse、PermissionRequest、PostToolUse、PreCompact、PostCompact、SessionStart、SessionEnd、UserPromptSubmit、SubagentStart、SubagentStop、Stop、Interrupt（9 个带 matcher）。hooks 引擎含 MCP handler、output spill、插件 hook 声明（PluginHookDeclaration）。证据：codex-rs/hooks/src/lib.rs（HOOK_EVENT_NAMES）——与 audit 钉扎一致，此处补 matcher 语义。
10. **结构化输出**：app-server `turn/start.outputSchema`（per-turn JSON Schema 约束最终 assistant 消息）+ SDK outputSchema。audit 只钉了 `max_structured_output_retries`（exec 面）；app-server 面是 **turn 参数**。证据：TurnStartParams.ts、[SDK]。

---

## ④ Gemini CLI 能力面（@google/gemini-cli 0.65.0 / main@2026-10-22）

1. **Checkpointing（文件状态快照）**：对修改文件的工具执行前自动建 checkpoint = 影子 git 仓库（`~/.gemini/history/<project_hash>`，不干扰项目 git）+ 完整会话历史 + 原 tool call；`/restore [file]` 列出/恢复（恢复后**重新提议原 tool call**）；`general.checkpointing.enabled`（--checkpointing 旗标 0.11.0 已移除）。证据：docs/cli/checkpointing.md、checkpointUtils.ts。
2. **Rewind（会话+文件三态回滚）**：`/rewind`（或双击 Esc）→ 选交互点（预览用户 prompt + 该步变更文件数）→ 四选一：回滚会话+代码 / 仅会话 / 仅代码 / 取消；**跨压缩点重建历史**；只回滚 AI 编辑工具产出，不回滚手动编辑与 `!` shell。证据：docs/cli/rewind.md、rewindFileOps.ts、RewindViewer.tsx。
3. **子代理**：内置 `codebase_investigator`、`cli_help`、`generalist`、`browser_agent`（捆绑 chrome-devtools-mcp，走 accessibility tree，需 Chrome ≥144，sessionMode persistent）；`@name` 前缀强制委派；`agents.overrides` 按子代理配 modelConfig/runConfig.maxTurns；定义文件 `.gemini/agents/*.md` / `~/.gemini/agents/*.md`；**remote subagents 走 A2A 协议**（agent_card_url 或内联 agent_card_json + A2A security scheme 鉴权，代理流量过 general.proxy）。证据：docs/core/subagents.md、docs/core/remote-agents.md。
4. **Extensions**：从 GitHub/本地安装的打包分发单元（prompts + MCP servers + 自定义命令 + 主题 + hooks + 子代理 + skills），`/extensions list` / `gemini extensions install <repo>`，扩展目录 gallery（geminicli.com/extensions/browse/）；安全面：blockGitExtensions、allowedExtensions 正则白名单、安装/迁移/技能变更需 consent 对话框。证据：docs/extensions/{index,reference,writing-extensions}.md、extension-manager.ts。
5. **MCP**：settings.json mcpServers（stdio/HTTP/SSE）+ OAuth；工具命名 `mcp_<server>_<tool>`；`list_mcp_resources`/`read_mcp_resource` 内建工具；ACP 模式下**客户端（IDE）可反向暴露 MCP 工具给 Gemini**；`gemini mcp` 命令组。证据：docs/reference/tools.md、docs/cli/acp-mode.md、docs/hooks/reference.md。
6. **记忆体系**：分层 GEMINI.md（全局 `~/.gemini/GEMINI.md` → workspace 及父目录 → **JIT：工具访问某目录时才扫描该目录及祖先链的 GEMINI.md**，至 trusted root）；`@file.md` 导入（memport：循环检测、深度上限 5、import tree 调试视图、代码区忽略）；`/memory show|reload|add`、`/memory inbox`；私有项目记忆目录 + 全局个人记忆；**Auto Memory（experimental）**：后台挖掘 idle≥3h 且 ≥10 条用户消息的历史会话，产出 memory `.patch` 与 SKILL.md 草案进项目内 inbox，人工 Apply/Discard 后生效。证据：docs/cli/gemini-md.md、docs/reference/memport.md、docs/cli/auto-memory.md、docs/tools/memory.md。
7. **Hooks（11 事件）**：BeforeTool、AfterTool、BeforeAgent、AfterAgent、BeforeModel、**BeforeToolSelection**、AfterModel、SessionStart、SessionEnd、Notification、PreCompress。机制：stdin JSON/stdout JSON，exit 0=成功、**2=System Block（阻断）**、其他=警告；输出字段 systemMessage/suppressOutput/**continue(false 即停整个 agent loop)**/stopReason/decision(allow|deny|block)+reason；matcher 支持正则与 MCP 命名；timeout 默认 60s。证据：docs/hooks/reference.md。
8. **Policy engine**：`~/.gemini/policies/*.toml` 规则（toolName 含 `*`/`mcp_server_*`/`mcp_*` 通配、argsPattern 正则、interactive 条件、**decision=allow|deny|ask_user**、priority 数值；User/Admin 两层，workspace 层暂不可用 issue #18186）；全局 deny 的工具**从模型可见工具集中完全移除**；`security.autoAddToPolicyByDefault` 把"永远允许"沉淀为策略。证据：docs/reference/policy-engine.md。
9. **Plan Mode**：`--approval-mode=plan`（default|auto_edit|yolo|plan 四档）、Shift+Tab 轮换、`/plan [goal]`、`enter_plan_mode`/`exit_plan_mode` 工具（计划完成后呈报审批）；Plan Mode 下 web_fetch 需显式确认。证据：docs/cli/plan-mode.md、docs/reference/tools.md。
10. **Model steering / routing / caching**：steering（experimental.modelSteering）= 执行中输入即注入提示，**由小模型生成一句确认**，主模型下一 turn 重估计划；ModelAvailabilityService 失败回退（默认需用户确认，内部调用静默回退链 flash-lite→flash→pro）；本地 Gemma 路由（`gemini gemma setup`）；token caching（API key/Vertex 自动，OAuth 不支持），`/stats` 展示缓存节省。证据：docs/cli/{model-steering,model-routing,token-caching}.md。
11. **上下文压缩**：`model.compressionThreshold`（默认 0.5）自动触发；`/compress` 手动；PreCompress hook 可备份/分析；压缩状态快照处理器（stateSnapshotProcessor）；rewind 跨压缩点工作。证据：docs/cli/settings.md Model 节、compressCommand.ts、chatCompressionService.ts、contextCompressionService.ts。
12. **沙箱**：`-s/--sandbox`、`GEMINI_SANDBOX=true|docker|podman|sandbox-exec|runsc|lxc`、`tools.sandbox`；macOS Seatbelt 6 档内置 profile（permissive-open 默认…strict-proxied）+ 项目自定义 `.gemini/sandbox-macos-custom.sb`/`sandbox.Dockerfile`；Docker/Podman 同路径挂载；**工具级沙箱**（security.toolSandboxing，逐工具隔离而非整进程）；tools.sandboxAllowedPaths / sandboxNetworkAccess。证据：docs/cli/sandbox.md、docs/cli/settings.md。
13. **Headless / 非交互**：`-p/--prompt`（追加 stdin、强制非交互）、`--prompt-interactive`、`--output-format json|streaming-json`（JSONL 事件：init{sessionId,model}、message、tool_use、tool_result、error、**result（聚合统计 + 每模型 token 分解）**）；退出码 0/1/**42 输入错误**/**53 turn 上限**；`--approval-mode`、`--yolo`（弃用）、`--worktree`、`--skip-trust`、`--experimental-acp`、`--experimental-zed-integration`。证据：docs/cli/headless.md、docs/cli/cli-reference.md。
14. **ACP 模式**：`--acp` 以 JSON-RPC 2.0 over stdio 暴露 Agent Client Protocol（开放协议，JetBrains/Zed 等 IDE 即插即用；ACP Agent Registry 收录）。证据：docs/cli/acp-mode.md、agentclientprotocol.com。
15. **会话管理**：自动转录（prompts/响应/工具输入输出/token 统计/思考摘要 → `~/.gemini/tmp/<project_hash>/chats/`，按项目隔离）；`--resume` latest/序号/UUID；Session Browser（预览/搜索/选定/导出）；手动 tagged checkpoint 命令组。证据：docs/cli/session-management.md。
16. **Git worktrees（experimental）**：`--worktree [name]`（随机名 worktree-a1b2c3d4），目录+分支落 `.gemini/worktrees/`，退出不清理。证据：docs/cli/git-worktrees.md。
17. **工具集**（docs/reference/tools.md 全量）：run_shell_command（node-pty 交互 shell）、glob、grep_search、list_directory、read_file（文本/图像/音频/PDF）、read_many_files（@ 触发）、replace、write_file、ask_user、write_todos、tracker_*×6（experimental.taskTracker：任务图 + 依赖 + ASCII 可视化）、list_mcp_resources、read_mcp_resource、activate_skill（+consent）、get_internal_docs、enter/exit_plan_mode、complete_task（子代理收尾）、update_topic、google_web_search（**Google 搜索**）、web_fetch（私网 IP 校验）。证据：docs/reference/tools.md。
18. **Skills**：SKILL.md 标准（agentskills.io），四层发现（built-in → extension → user `~/.gemini/skills` → workspace `.gemini/skills`，`.agents/skills` 别名优先）；发现时只注入 name/description，激活才载入正文并把技能目录加入允许路径；`gemini skills` 命令组。证据：docs/cli/skills.md。
19. **安全/企业**：folder trust（trusted folders 清单）、env var 脱敏（environmentVariableRedaction）、**Conseca 上下文感知安全**（experimental，LLM 动态生成并执行工具安全策略）、disableYoloMode/disableAlwaysAllow、五层配置（defaults→system-defaults→user→project→system override→env→args）+ settings 内 `$VAR` 环境变量插值 + .env 加载；企业部署文档。证据：docs/cli/settings.md Security 节、docs/reference/configuration.md、docs/cli/enterprise.md。
20. **鉴权/端点**：OAuth（Google 个人/企业）、Gemini API key（GEMINI_API_KEY/GOOGLE_API_KEY）、Vertex AI（GOOGLE_CLOUD_PROJECT/GOOGLE_APPLICATION_CREDENTIALS）、动态发现 authProviderType；**代理端点 `GOOGLE_GEMINI_BASE_URL` / `GOOGLE_VERTEX_BASE_URL`**；**无 OpenAI 兼容端点支持**（开放 FR：github.com/google-gemini/gemini-cli/issues/23385 "Support OpenAI-compatible API endpoints"）。证据：docs/reference/configuration.md env 节、issue #23385。
21. **遥测/计量**：OTel（OTLP/GCP/file exporter、GEMINI_TELEMETRY_ENABLED/TRACES）、Clearcut、billingEvents（overage 策略 ask|always|never）、`/stats`（会话 token/缓存节省/工具统计/模型统计/配额 QuotaStatsInfo）、MemoryUsageDisplay/ContextUsageDisplay。证据：packages/core/src/telemetry/*、docs/cli/settings.md Billing 节、statsCommand.ts。
22. **通知/语音**：OSC 9 终端通知（Action required / Session complete，BEL 兜底）；experimental.voiceMode（/voice、push-to-talk/space、Gemini Live 转写后端）。证据：docs/cli/notifications.md、settingsSchema.ts。

---

## ⑤ 超出基线的前沿能力清单

判定基准：**HAVE** = 基线契约已覆盖等价语义；**PARTIAL** = 基线有相邻概念但缺该能力的关键面；**MISSING** = 基线完全没有。

> **基线勘误（2026-10-22，依 repo AGENTS.md §5.19 runtime 契约）**：任务简报给的基线是文本摘要，实际代码基线更强——`sessionBranchApi`（session.fork/**revert/unrevert**）、`diffApi`（session.**diff**/**revertDiff** hunk 级反 patch 落工作区）、`PromptResultEnvelope.usage{input,output,cached,reasoning,costUsd}`、审批三档预设 + permission-rules 持久沉淀（`persist` 'tool'|'prefix'）、`CompletionRequest.responseFormat`（json_schema）、`questionApi`、session 媒体 file part 均已存在。受影响的行（A1/A9/A10/B3/B4/B6/D5/F1）已按实际基线修正判定，Codex/Gemini 的**差异点**在"意义"列重新聚焦。

### A. 会话/线程生命周期

| # | 能力 | 平台表面 | 判定 | 对多运行时网关契约的意义 | 证据 |
|---|---|---|---|---|---|
| A1 | 历史回滚（删 turn 而非 fork） | Codex `thread/revert{threadId,beforeTurnId}`：持久化历史替换为该 turn 之前的前缀，**不回滚文件**；返回 turns/items backwardsCursor；thread/reverted 通知 | PARTIAL（MAFW `session.revert/unrevert` 已有 message 级；pi 语义弱） | 差异点：**turn 粒度前缀替换**、revert 后 **backwardsCursor 双向水合**、thread/reverted 事件族、跨 runtime 语义统一（pi revert 不可逆不可 unrevert） | [P-CR] ThreadRevertParams、ThreadRevertResponse.ts、[AS-RD] |
| A2 | 归档/取消归档生命周期 | Codex thread/archive、thread/unarchive、thread/list{archived} | MISSING | 软删除分层：deleted 不可逆 vs archived 可查；基线 session.deleted 单态 | [P-CR]、ThreadListParams.ts |
| A3 | 多客户端 rejoin 运行中会话 | Codex thread/resume 对运行中线程 = **rejoin**（path 仅作一致性校验）；serverRequest/resolved 通知他端审批已应答 | MISSING | 网关重启/多前端场景的会话接管；基线"agent 进程管理(restart)"不含 rejoin 语义 | ThreadResumeParams.ts、ServerRequestResolvedNotification.ts |
| A4 | 读/未读回执 + revision 乐观并发 | Codex thread/readState/update{expectedRevision, read|unread}、thread/readState/changed、-32600 readStateConflict | MISSING | 多设备/多窗口同步的会话状态；revision 是"会话元数据 CAS"范本 | [AS-RD] Thread read state 节 |
| A5 | 会话分区（sections）与手动排序 | Codex threadSection/create|update|delete|list、thread/section/move；thread/list{sectionId} | MISSING | 长会话组织的持久化结构；对应 GUI 侧"项目分组" | [P-CR] |
| A6 | 线程↔资源附件（PR 链接） | Codex thread/attachment/add|list|remove、thread/attachmentOwner/list（identityKey 反查）、attachment/updated、fork 时复制附件 | MISSING | 会话与外部资源的稳定关联索引（如 issue/PR↔session） | [AS-RD] Stored thread attachments |
| A7 | 会话全文搜索与时间线 | Codex thread/search、thread/searchOccurrences、thread/timeline/list、thread/list{searchTerm,cwd[],modelProviders,sourceKinds,sortKey} | MISSING | 基线"session 查"需扩展为可检索目录服务 | [P-CR]、ThreadListParams.ts |
| A8 | 双向分页历史（turns/items） | Codex thread/turns/list、thread/items/list{cursor 或 item anchor, sortDirection, backwardsCursor} | MISSING（基线 history normalize 恒 flat 一次性） | 大会话的增量水合契约；item anchor 支持"从某条消息往后/往前翻" | ThreadItemsListParams.ts、[AS-RD] Item history anchors |
| A9 | 影子 git 文件快照 + 恢复 | Gemini checkpointing（影子仓库 + 会话 + tool call 三件套）、/restore、恢复后重新提议 tool call | PARTIAL（MAFW `revertDiff` 可反 patch 落工作区，但需已有 diff） | 差异点：**修改前自动快照**（无需预先 diff）+ 会话/工具调用一并还原 + 恢复后**重新提议原 tool call**；网关可统一为 `session.checkpoint/restore` 抽象 | docs/cli/checkpointing.md |
| A10 | 三态 rewind（会话/文件/两者） | Gemini /rewind：仅会话、仅代码、两者；跨压缩点重建 | PARTIAL（MAFW revert（会话）与 revertDiff（代码）两个动词分立） | 差异点：**单次交互内组合选择** + 跨压缩点重建历史（MAFW 两动词未组合、压缩交互未验证） | docs/cli/rewind.md |

### B. Turn 与流

| # | 能力 | 平台表面 | 判定 | 对网关契约的意义 | 证据 |
|---|---|---|---|---|---|
| B1 | steer 乐观并发前置条件 | Codex turn/steer{expectedTurnId}（不匹配即失败）；turn/start 对活跃 turn 自动并入 | PARTIAL（基线 prompt 有 delivery:'steer'，无并发防护） | 多客户端同时 steer 的竞态防护；基线应加 expectedTurn/消息 ID 前置条件 | TurnSteerParams.ts |
| B2 | 忙时提交排队 + 重排 | Codex thread/queue/add|list|update|delete|reorder|start、thread/queue/changed、QueuedSubmission | MISSING | 基线 prompt 对 busy runtime 的行为未定义；队列化是 codex/gemini(隐式)/claude 通用需求 | [P-RS]、QueuedSubmission.ts |
| B3 | turn 级沙箱/审批/模型覆盖 | Codex turn/start{sandboxPolicy, approvalPolicy, approvalsReviewer, model, effort, summary, serviceTier(+ForTurn), cwd, outputSchema}，"持续到后续 turn" | PARTIAL（MAFW prompt 已有 model/agent/maxTurns/maxCostUsd；审批模式是会话级三档） | 差异点：**沙箱策略与审批策略作为 per-turn 参数** + 粘滞语义（turn 后持续生效）+ effort/serviceTier | TurnStartParams.ts |
| B4 | per-turn 结构化输出 | Codex turn/start.outputSchema（JSON Schema 约束最终 assistant 消息）；SDK turnOptions.outputSchema | PARTIAL（MAFW `CompletionRequest.responseFormat` 已有 json_schema，仅 completion 通道） | 差异点：**会话回合级** outputSchema（对 agent 最终消息生效），而非单次补全通道 | TurnStartParams.ts、[SDK] |
| B5 | 委托工作链归属 | Codex turn/start{parentTurnId, rootTurnId}、Turn.rootTurnId、turnTrigger | MISSING | 跨线程/子代理任务的因果链归因（谁的活）；对 usage/审计/树状 UI 都关键 | TurnStartParams.ts、Turn.ts |
| B6 | turn 级统一 diff 流 | Codex turn/diff/updated{threadId,turnId,diff}（聚合该 turn 全部文件变更） | PARTIAL（MAFW `diffApi` 已有拉取式 session.diff(messageID)） | 差异点：**事件推送式** turn 聚合 diff（turn/diff/updated 通知），客户端免轮询免拼装 | TurnDiffUpdatedNotification.ts |
| B7 | plan 流式增量 | Codex item/plan/delta、turn/plan/updated{TurnPlanStep{step,status}} | PARTIAL（基线 plan.updated(todo) 只有整包） | todo 逐步 delta 流；基线 plan.updated 可升级为 delta+snapshot 双形态 | [P-SN]、TurnPlanStep.ts |
| B8 | 不可 steer 的 turn 类型 | Codex NonSteerableTurnKind = review\|compact → activeTurnNotSteerable 错误 | MISSING | steer 语义需显式例外集（复审/压缩中不可打断注入） | CodexErrorInfo.ts、NonSteerableTurnKind.ts |
| B9 | mid-turn steering 带确认 | Gemini model steering：执行中输入 → 小模型 ack → 注入下一 turn 重估计划 | PARTIAL | delivery:'steer' 的 UX 参照：确认 + 计划重估语义 | docs/cli/model-steering.md |
| B10 | 模型失败回退/重路由 | Codex model/rerouted + ModelRerouteReason、modelProvider/authRecovery*；Gemini ModelAvailabilityService fallback（需用户确认）+ 本地 Gemma 路由 | MISSING | 网关多 runtime 必备的模型容错事件与决策流 | [P-SN]、docs/cli/model-routing.md |

### C. 消息部件（item）与流事件

| # | 能力 | 平台表面 | 判定 | 对网关契约的意义 | 证据 |
|---|---|---|---|---|---|
| C1 | 命令执行一等部件 | Codex commandExecution item：commandActions（管道级动作解析）、exitCode、durationMs、processId、status；配套 outputDelta/terminalInteraction 事件 | MISSING（基线 tool 快照笼统） | shell 执行的**结构化快照**（parsed actions/duration/exit code）是 UI 与审计刚需 | ThreadItem.ts、CommandAction.ts |
| C2 | 文件变更一等部件 | Codex fileChange item{changes, PatchApplyStatus} + item/fileChange/outputDelta + patchUpdated；item/fileChange/requestApproval | MISSING（基线只有 file part） | patch 状态机（applied/failed/…）+ 增量 patch 流 | ThreadItem.ts、PatchApplyStatus.ts |
| C3 | web 搜索一等部件 | Codex webSearch item（action/mode/contextSize/location）+ ToolsV2.web_search 配置（mode: disabled/cached/live）；Gemini google_web_search 工具 | MISSING | 基线无 web search 概念；网关应定义 search item 或工具快照扩展 | WebSearchItem.ts、ToolsV2.ts、docs/reference/tools.md |
| C4 | 图像生成一等部件 | Codex imageGeneration item（成功/失败/输入图） | MISSING | 生成型媒体进消息流（与 gateway 的 media executor 对齐点） | ImageGenerationItem.ts |
| C5 | reasoning 三态流 | Codex item/reasoning/textDelta、summaryTextDelta、summaryPartAdded（正文/摘要分开流） | PARTIAL（基线 reasoning part + part.delta） | 摘要与正文分离的 delta 通道 | [P-SN] |
| C6 | 异步问题附着在消息上 | Codex agentMessage.questions: AsyncUserInputQuestion{title,options}[] + delivery:"async"；item/tool/requestUserInput{questions, isBlocking, autoResolutionMs} | PARTIAL（基线 question.asked/replied 独立事件；无 options/非阻塞/auto-resolve） | 问题可**带选项、非阻塞、自动超时**；基线 question 协议应扩展 | ThreadItem.ts、ToolRequestUserInputParams.ts |
| C7 | wire 级原始事件透传 | Codex rawResponseItem/completed、rawResponse/completed | MISSING | 调试/评测面：原始模型响应可订阅 | [P-SN] |
| C8 | MCP 工具进度事件 | Codex item/mcpToolCall/progress + mcpToolCall item{durationMs, readOnlyHint, appContext, mcpAppUi{resourceUri, displayMode}} | PARTIAL（基线 tool.delta 语义扩展已设计未实现） | 长工具的 progress 通知 + UI 渲染元数据 | [P-SN]、McpAppUi.ts |
| C9 | sleep 等待部件 | Codex sleep item（ScheduledTask 配套） | MISSING | "agent 在等定时器"的可视化状态 | ThreadItem.ts、SleepItem.ts |
| C10 | 富文本输入 span + skill/mention 引用 | Codex UserInput{text_elements} 与 {type:"skill"|"mention", name, path}；Gemini @ 文件引用（read_many_files 触发） | MISSING（基线输入是纯 part 数组） | 用户输入的结构化标记（@引用、技能引用）需进输入契约 | UserInput.ts |

### D. 审批与权限

| # | 能力 | 平台表面 | 判定 | 对网关契约的意义 | 证据 |
|---|---|---|---|---|---|
| D1 | 策略修订式批准 | Codex acceptWithExecpolicyAmendment / applyNetworkPolicyAmendment（批准同时改 execpolicy/网络策略） | MISSING（基线 once\|always\|reject） | "有条件放行"：批一次并沉淀为规则，降低后续 ask 噪声 | CommandExecutionApprovalDecision.ts |
| D2 | 审批者路由（AI 审批） | Codex approvalsReviewer = user \| auto_review \| guardian_subagent（subagent 风险框架裁决）+ thread/approveGuardianDeniedAction（人工推翻）+ circuit breaker tooManyDenials | MISSING | 审批面本身可编程（审批代理）；网关可定义 reviewer 抽象 | ApprovalsReviewer.ts、[AS-RD] Guardian 节 |
| D3 | 粒度化审批策略 | Codex AskForApproval = untrusted\|on-request\|granular{sandbox,rules,skill,request_permissions,mcp_elicitations}\|never；Gemini --approval-mode 四档 + policy engine allow/deny/ask_user + deny 即从模型工具集移除 | PARTIAL（基线 permission_mode 单值） | 审批模式应按**风险类别**分通道 | AskForApproval.ts、docs/reference/policy-engine.md |
| D4 | turn 粒度授权 + 权限档位 | Codex PermissionGrantScope=turn\|session、permissionProfile/list、RequestPermissionProfile{network,fileSystem} | MISSING | 权限提升请求的规范化（要什么、给多久） | PermissionGrantScope.ts、RequestPermissionProfile.ts |
| D5 | TOML 策略引擎（前置裁决） | Gemini policy engine：toolName 通配 + argsPattern 正则 + interactive 条件 + priority 分层；Codex execpolicy（命令级裁决）+ ExecPolicyAmendment | PARTIAL（MAFW 已有 permission-rules.json：tool/prefix 匹配 + always 自动沉淀） | 差异点：**argsPattern 正则**（按参数裁决）、priority 冲突分层、interactive/headless 条件、全局 deny 把工具**从模型可见集移除** | docs/reference/policy-engine.md、docs/execpolicy.md |
| D6 | MCP elicitation 表单 | Codex mcpServer/elicitation/request（McpElicitationSchema：单选/多选/数字/布尔/枚举等丰富表单） | MISSING（基线 question 只有 asked/replied） | 结构化表单式人机交互（比 options 更全的 schema） | McpElicitationSchema.ts 系 |

### E. 工具与执行面

| # | 能力 | 平台表面 | 判定 | 对网关契约的意义 | 证据 |
|---|---|---|---|---|---|
| E1 | 客户端执行的工具（反向工具） | Codex item/tool/call：**服务端把注册的动态工具（DynamicToolSpec{function\|namespace, deferLoading}）委托回客户端执行** | MISSING（基线工具注册是 gateway→agent 单向） | 网关可作为工具提供方（宿主工具）；双向工具面 | ServerRequest.ts、DynamicToolSpec.ts |
| E2 | 宿主侧模糊文件搜索会话 | Codex fuzzyFileSearch + sessionStart/sessionUpdate/sessionStop + sessionUpdated/sessionCompleted | MISSING | @ 文件补全的协议级支持（长会话增量索引） | [P-RS]、FuzzyFileSearch*.ts |
| E3 | 协议级文件系统 API + watch | Codex fs/readFile\|writeFile\|readDirectory\|getMetadata\|remove\|copy\|createDirectory\|watch\|unwatch + fs/changed | MISSING | 网关/IDE 不经 shell 直接操作工作区并订阅变更 | [P-CR]、FsChangedNotification.ts |
| E4 | PTY 进程控制 | Codex command/exec + write/terminate/resize、process/spawn\|writeStdin\|kill\|resizePty、thread/backgroundTerminals/*、process/outputDelta、process/exited | PARTIAL（基线 agent 进程管理 restart 一个动词） | 长驻终端/后台任务的一等生命周期（resize/writeStdin 是交互 shell 必需） | [P-CR]、CommandExecParams.ts |
| E5 | 非沙箱 shell 逃生门 | Codex thread/shellCommand（保留 shell 语法、全权、timeoutMs） | MISSING | 显式的"特权命令"通道，与沙箱化 command/exec 区分 | ThreadShellCommandParams.ts |
| E6 | 直调 MCP 工具/资源 | Codex mcpServer/tool/call、mcpServer/resource/read（不经模型） | MISSING | 网关直接利用 agent 挂载的 MCP 生态（诊断/旁路） | [P-CR] |
| E7 | MCP 服务器管理面 | Codex mcpServerStatus/list（serverCapabilities）、mcpServer/oauth/login + oauthLogin/completed、config/mcpServer/reload、mcpServer/event/stream/start|stop；Gemini mcpServers 配置 + `gemini mcp` 命令组 | MISSING | MCP 生命周期（健康、OAuth、热重载、事件流）纳入网关运维契约 | [P-CR]、docs/reference/tools.md |

### F. 用量、账号与可观测

| # | 能力 | 平台表面 | 判定 | 对网关契约的意义 | 证据 |
|---|---|---|---|---|---|
| F1 | token 用量分解粒度 | Codex thread/tokenUsage/updated{total, last, modelContextWindow; breakdown: input/cachedInput/cacheWriteInput/output/reasoningOutput}；Gemini /stats + result 事件每模型分解 | PARTIAL（MAFW `PromptResultEnvelope.usage` 已含 input/output/cached/reasoning/costUsd） | 差异点：**cacheWriteInputTokens**、total/last 双值（累计 vs 上一回合）、modelContextWindow、**事件化** thread/tokenUsage/updated（当前 envelope 是回合返回值） | ThreadTokenUsage.ts、TokenUsageBreakdown.ts、docs/cli/headless.md |
| F2 | 账号级配额与限流 | Codex account/rateLimits/read + rateLimits/updated + rateLimitResetCredit/consume、account/usage/read（日桶）、CreditsSnapshot、SpendControlLimitSnapshot | MISSING | 多会话共享配额的可见性与"消耗重置额度"操作 | [P-CR]、RateLimitSnapshot.ts |
| F3 | 线程级成本估算 | Codex ThreadUsage{estimatedUsageCreditsMicros, estimatedUsageUsdMicros, groups} | PARTIAL（基线 maxCostUsd 是预算输入，无成本输出） | 预算闭环：input 上限 + 输出实际/估算 | ThreadUsage.ts |
| F4 | goal 预算对象 | Codex thread/goal/set{objective, tokenBudget, status} + tokensUsed/timeUsedSeconds + updated/cleared 通知 | MISSING | 比 maxTurns/maxCostUsd 更完整的"任务级预算"对象（目标+预算+实耗+状态机） | ThreadGoal.ts、ThreadGoalSetParams.ts |
| F5 | 错误码枚举面 | Codex CodexErrorInfo：contextWindowExceeded、sessionBudgetExceeded、usageLimitExceeded、rateLimitExceeded、misalignmentPolicyViolation、tooManyDenials、threadRollbackFailed、sandboxError、httpStatusCode 透传等 | PARTIAL（基线 turn.failed 无错误码契约） | 错误码是跨 runtime 重试/降级决策的依据 | CodexErrorInfo.ts |
| F6 | moderation/安全元数据 | Codex turn/moderationMetadata、model/safetyBuffering/updated、guardianWarning、TurnError.misalignment（含续行指令） | MISSING | 内容安全与"模型失准"事件面 | [P-SN]、TurnError.ts |

### G. 记忆、技能与认知面

| # | 能力 | 平台表面 | 判定 | 对网关契约的意义 | 证据 |
|---|---|---|---|---|---|
| G1 | 线程记忆模式 + 引用 | Codex thread/memoryMode/set、memory/status、memory/reset；agentMessage.memoryCitation{entries, threadIds}；memories crate | MISSING（基线记忆是 gateway 侧非契约） | 记忆进 agent 协议：模式开关 + 消息级引用（哪条回复用了哪条记忆） | [P-RS]、MemoryCitation.ts |
| G2 | JIT 分层上下文注入 | Gemini GEMINI.md 三层（全局/工作区/**按工具访问目录即时加载**）+ @file.md 导入树 | MISSING | 上下文装配策略（何时注入什么）可作为 runtime 契约面 | docs/cli/gemini-md.md、docs/reference/memport.md |
| G3 | 记忆自动挖掘 inbox | Gemini Auto Memory：后台扫描历史会话→产出 patch/SKILL 草案→人工审批 | MISSING（gateway 记忆系统无此产物审批流） | 记忆写入的"提案-审批"模式可借鉴进 mafw_add_memory | docs/cli/auto-memory.md |
| G4 | 技能（SKILL.md）生命周期 | Codex skills/list、skills/config/write、skills/extraRoots/set、skills/changed、plugin/skill/read；Gemini activate_skill + consent + 四层发现；UserInput{type:"skill"} | MISSING | 技能发现/激活/同意是跨平台共识面，网关应有对应动词或工具快照 | [P-CR]、docs/cli/skills.md |
| G5 | hooks 事件对比 | Codex 14（Pre/PostModelRequest、Pre/PostToolUse、PermissionRequest、Pre/PostCompact、SessionStart/End、UserPromptSubmit、SubagentStart/Stop、Stop、Interrupt）；Gemini 11（含 **BeforeToolSelection**、Before/AfterAgent、Notification、PreCompress） | MISSING（基线 hooks 四动词已设计未实现） | 两家并集 ≈ 17 个事件；**BeforeToolSelection（工具集过滤）与 Notification 是 Codex 也没有的**；设计时应取并集 | codex-rs/hooks/src/lib.rs、docs/hooks/reference.md |
| G6 | hook 阻断语义 | Gemini exit 2 = System Block、continue:false 停全 loop、decision allow/deny+reason；Codex hooks engine + output_spill | MISSING | hooks 的**决策回写**（而非仅观察）是基线设计未覆盖的半边 | docs/hooks/reference.md |

### H. 多代理与协作

| # | 能力 | 平台表面 | 判定 | 对网关契约的意义 | 证据 |
|---|---|---|---|---|---|
| H1 | 协作代理工具调用 | Codex collabAgentToolCall item：spawnAgent/sendInput/resumeAgent/wait/closeAgent/sendMessage/followupTask/interruptAgent/listAgents，sender/receiverThreadIds、per-agent model+effort、agentsStates | MISSING | 子代理编排的**消息流形态**（而非仅进程形态）；基线 tool 快照可承载但需语义定义 | ThreadItem.ts、CollabAgentTool.ts |
| H2 | 子代理活动 + 血统 | Codex subAgentActivity item、Thread.parentThreadId/agentNickname/agentRole、collaborationMode/list、multi_agent_instructions、AgentControl | MISSING | 网关多 runtime 树状拓扑（父会话/子代理）需血缘字段 | Thread.ts、SubAgentActivityKind.ts |
| H3 | 远程子代理（A2A） | Gemini remote subagents：A2A agent card + 鉴权方案；Codex 环境则走 exec-server | MISSING | 跨进程/跨机代理互操作的标准协议选择 | docs/core/remote-agents.md |

### I. 云、环境与接入

| # | 能力 | 平台表面 | 判定 | 对网关契约的意义 | 证据 |
|---|---|---|---|---|---|
| I1 | 远程环境注册与连接 | Codex environment/add{environmentId, execServerUrl(ws), authBearerToken, connectTimeoutMs, skills}、environment/info、thread/environment/connected\|disconnected、TurnEnvironmentParams{environmentId, cwd, runtimeWorkspaceRoots} | MISSING | "会话跑在哪台机器"成为一等参数；本地/远程统一 turn 语义 | [P-RS]、EnvironmentConnectionNotification.ts |
| I2 | exec-server 远端执行协议 | Codex exec-server-protocol：process/*、fs/*、http/request(+bodyDelta)、environmentConfig/read（远端配置分层）、网络策略（managedNetwork/loopbackPorts/Unix socket/proxy） | MISSING | 远端沙箱执行的完整分协议（进程+文件+出站 HTTP） | exec-server-protocol/src/protocol.rs |
| I3 | 云任务（后台代理） | Codex `codex cloud`：TaskStatus/ListPage/TurnAttempt/DiffSummary/ApplyOutcome（云 diff 应用回本地）；Codex Web 可复用云环境、手机 steer；chatgpt.com/backend-api 后端 | MISSING | 后台/异步任务是网关 scheduler 的对应面，但 codex 把**任务生命周期+diff 应用**做成了一等公民 | cloud-tasks/src/lib.rs、cloud-tasks-client/src/lib.rs、techcrunch.com 2026-09-29 |
| I4 | 定时任务 | Codex ScheduledTaskSummary{key,name,prompt,schedule(weekday 等)} | MISSING（gateway scheduler 非契约） | scheduled prompt 的协议形态（对应 mafw scheduler） | ScheduledTaskSummary.ts |
| I5 | 远程控制配对 | Codex remoteControl/enable\|disable\|pairing/start\|pairing/status\|status/read\|client/list\|client/revoke | MISSING | 手机/第二设备控制本机 agent 的配对与吊销模型 | [P-RS] |
| I6 | 实时语音会话 | Codex thread/realtime/start|stop|listVoices|appendAudio\|appendSpeech\|appendText + 11 个 realtime 通知（WebRTC SDP/转写 delta/输出音频 delta）；Gemini experimental.voiceMode（Gemini Live 后端） | MISSING（gateway TTS 是非契约单向合成） | 双向实时语音（输入音频流+转写+输出音频流）是另一条传输通道的会话形态 | [P-RS]、settingsSchema.ts |
| I7 | ACP 接入模式 | Gemini --acp：Agent Client Protocol over stdio JSON-RPC；客户端可反向暴露 MCP 工具 | MISSING | 网关若说 ACP 可直接被 JetBrains/Zed 等 IDE 复用 | docs/cli/acp-mode.md |
| I8 | 外部代理配置/历史迁移 | Codex externalAgentConfig/detect\|import + recordHistory/readHistories | MISSING | 网关吸纳存量 Claude/Gemini/Codex 配置与历史的入口 | [P-CR] |

### J. 平台工程面

| # | 能力 | 平台表面 | 判定 | 对网关契约的意义 | 证据 |
|---|---|---|---|---|---|
| J1 | 插件市场与分享 | Codex marketplace/add\|remove\|upgrade、plugin/install\|uninstall\|reconcile、plugin/share/*（principal/role/discoverability）；Gemini extensions（GitHub 安装 + gallery + consent） | MISSING | 能力分发生态：安装/卸载/对账/分享权限 | [P-CR]、docs/extensions/index.md |
| J2 | 运行时特性开关协商 | Codex experimentalFeature/list（stage/displayName/announcement/enabled/defaultEnabled）+ enablement/set | MISSING | 网关多 runtime 的特性灰度协商面 | ExperimentalFeature.ts |
| J3 | 按连接通知过滤 | Codex initialize.capabilities.optOutNotificationMethods + 每通知过滤 | PARTIAL | 多客户端各自订阅不同事件子集 | InitializeCapabilities.ts |
| J4 | 配置读写 + 分层要求 | Codex config/read、config/value/write、config/batchWrite、configRequirements/read；Gemini 五层配置 + $VAR 插值 + schema JSON | PARTIAL（基线 credentials 单点） | 配置面作为动词（读/写/批量/要求校验） | [P-CR]、docs/reference/configuration.md |
| J5 | 用户验证（设备签名） | Codex userVerification/status\|enroll\|delete\|verify\|cancel（ECDSA P-256，挑战-签名证明，GUI 配套） | MISSING | 高敏操作的本机生物特征证明通道 | [AS-RD] User verification 节 |
| J6 | 历史会话采样/预测 | Codex thread/sample（在继承的 ephemeral fork 上**捕获一次模型响应而不执行**，工具调用→null 样本）、thread/prediction/request\|updated | MISSING | 投机预取/下一步预测的原语（网关预测式 UI 可用） | thread_sample.rs、ThreadPredictionResult.ts |
| J7 | OpenAI 兼容端点缺席（Gemini） | Gemini 仅 Google 端点 + 代理 BASE_URL（GOOGLE_GEMINI_BASE_URL/GOOGLE_VERTEX_BASE_URL）；OpenAI 兼容为开放 FR | n/a（负结果） | Gemini runtime 接入网关需走代理 URL 或原生 API，不能假设 OpenAI 协议 | issue #23385、docs/reference/configuration.md |

---

## ⑥ Top 10 缺口（一行一条）

1. **turn 级持久化 revert + backwards 水合**——Codex thread/revert{beforeTurnId}（前缀替换 + backwardsCursor + thread/reverted 事件）；MAFW 已有 message 级 revert/unrevert，缺 turn 粒度、revert 后双向分页水合与跨 runtime 语义统一（pi 不可逆）。
2. **turn 级 override 参数族（sandboxPolicy/approvalPolicy/approvalsReviewer/effort/serviceTier/outputSchema）**——沙箱与审批策略是 prompt 参数且粘滞后续 turn；基线 prompt 仅 model/agent/maxTurns/maxCostUsd（结构化输出仅 completion 通道）。
3. **双向工具面（item/tool/call 客户端执行 DynamicToolSpec + fuzzyFileSearch 会话）**——网关可作工具宿主；基线工具注册单向。
4. **远端环境与 exec-server 协议（environment/add + process/fs/http 远端执行 + 网络策略）**——本地/云统一 turn 语义的执行平面；基线仅本地 agent 进程管理。
5. **命令执行/文件变更一等 item（commandActions 解析、exitCode、durationMs、PatchApplyStatus）+ turn/diff/updated 事件流**——基线 tool 快照无结构化 shell/patch 状态机；diff 已有拉取式 diffApi，缺事件推送式 turn 聚合。
6. **turn 队列与 steer 并发（thread/queue/* + expectedTurnId 前置条件 + NonSteerableTurnKind）**——busy 会话的服务端排队/重排与竞态防护；基线 steer 无并发契约（排队目前只在 TUI 客户端）。
7. **审批升级（amendment 式批准、cancel、turn/session 授权粒度、approvalsReviewer=AI 审批、elicitation 表单）**——基线 once/always/reject + 规则沉淀已覆盖沉淀语义，缺"批即改策略"的 amendment、AI 审批者路由与结构化表单。
8. **用量与预算闭环（token 六字段 + modelContextWindow + account/rateLimits + thread/goal{tokenBudget,tokensUsed,timeUsedSeconds} + CodexErrorInfo 错误码）**——envelope 已有五字段，缺 cacheWrite/total-last/窗口、账号配额可见性与错误码枚举。
9. **认知面 hooks 事件并集（Codex 14 ∪ Gemini 11 ≈ 17，含 BeforeToolSelection、Notification、System Block 阻断回写）**——基线 hooks 四动词需按并集 + 决策回写语义设计。
10. **文件状态时间旅行（Gemini 影子 git checkpoint + /restore 重提议 + 三态 rewind）**——基线 revertDiff 需已有 diff；缺修改前自动快照、会话+文件组合回滚与恢复后重提议。

---

## 附：本次调研未覆盖/受阻项

- developers.openai.com/codex 全站 403（Cloudflare 类防护，webfetch 与 fetch 均被拒），config-reference、security、cloud 文档正文未取到；产品面以仓库 stub、crate 源码与第三方报道（TechCrunch/openai.com 博客索引）交叉佐证。
- GitHub REST API 在调研后半段触发未认证限流（60/h），openai/codex HEAD 之后的增量与部分目录树未再展开；raw.githubusercontent.com 不受限。
- Gemini CLI 未发现 fileHistoryService 命名的服务（与任务提示的命名不符）；同等能力由 checkpointUtils + rewindFileOps + 影子 git 构成，已按实际命名记录。
