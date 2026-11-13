# Runtime 能力契约与适配层

> 迁移自根 `AGENTS.md`（2026-11-10），原文搬迁（未改写）；章节号沿用迁移前编号，
> 交叉引用以标题为准。后续变更记录写 `docs/releases/`，不再回填本文件。

### Agent 身份层 IdentityRegistry（v4.21.0）

所有 MAFW agent 身份（manager / memory-curator + 未来内置）收敛到 gateway 持有的
**`IdentityRegistry`**（`gateway/src/runtime/identity-registry.ts`）= 身份单一事实源：
`IdentitySpec { name, description, scope, systemPrompt, policy, nativePermissions?, nativeTools? }`
——`policy { deny, allowlist }` 用中立类别词汇（`file-edit`/`shell`/`subagent`/`web`/`readonly`）
+ 工具名（`mafw_*` 前缀通配）；物化侧 `toAgentDefinition(spec)` 从**同一 builder** 派生
（manager←`getManagerAgentDefinition`、curator←`buildMemoryCuratorDefinition`），原生产物零漂移。

设计文档：`docs/superpowers/specs/2026-10-08-runtime-neutral-agent-identity-design.md`；
调研：`docs/research/2026-10-08-agent-identity-injection-survey.md`（7 runtime 身份注入机制）。

**注入三车道**：
- **车道 1（默认·主通道）物化 + 绑定**：启动遍历注册表 `agents.install(name, toAgentDefinition(spec))`
  （= 物化——opencode 写 agent md / pi 写 prompts+extension，零重写）；`IdentityState`
  （`gateway/src/runtime/identity-state.ts`）记 `(runtime, identity)` 物化状态；
  `withIdentityPrompt` 包装 `runtime.session.promptAsync/prompt`：绑定+已物化 → 注入 `agent` 参数；
  注册表身份但未物化 → 剥离（防未知 agent 报错）；非注册表 agent（build/plan）原样透传。
  compaction 免疫由 runtime 自身保证（Codex strip+重建 / Kimi 重渲染 / dsh 重派生）。
- **车道 2/3（前瞻·未实现）**：无物化通道的 runtime 落 injectSystem（认知面）或消息位追加。

**绑定**：`registerInternalSession(sid, role, identity?)` 登记 session 级绑定（manager 全路径 +
worker `onSessionCreated` → memory-curator）；用户经桌面/TUI 选身份 = 回合级绑定
（`/api/session/:id/promptAsync` 路由登记，`turn.completed` 清除）；manager rotate 降级解绑。
`injectManagerIdentity`（旧一次性 `[SYSTEM]` 消息）**已删除**——身份经车道 1 到达，修复 compaction 稀释。

**网关策略层**（`ApprovalPolicyService.evaluate` 身份维度，**先于 internal blanket-deny**——
manager 本身即 internal 会话）：
- ∈ `policy.deny` 或（白名单存在且 ∉ allowlist）→ **auto-deny**（reason 带 `identity policy (<name>)`）
- ∈ allowlist 且会话 internal（gateway 驱动）→ **auto-approve**（无人值守）
- ∈ allowlist 且会话用户驱动 → 落三档评估（用户在场，档位决定问/不问）
- `applyApprovalPolicy`（`core/approval/hook.ts`）既有自动应答器**零改动生效**（opencode+pi 双 runtime）
- `GET /api/agents` 合并输出：注册表身份（`source:'mafw'`）在前 + runtime 原生（`source:'runtime'`）；**仅已物化身份可见**（未物化选了也会被 `withIdentityPrompt` 剥离，列出是 UX 谎言；被滤名字不占去重，runtime 同名条目以 `source:'runtime'` 落穿）

**manager 权限（仍成立，经 registry 物化）**：`edit` deny / `task.general` deny / bash 默认 allow /
38 个 `mafw_*` MCP 工具显式 allow（对齐内置 plan）；系统规则 `ensureManagerRules()`
（`gateway/src/core/manager/system-rule-templates.ts`）每次启动写 `~/.mafw/`。机制依据：
opencode `permission/index.ts` 的 `disabled()`——仅 `edit/write/apply_patch` 映射 `edit` key，
其余用工具名作 permission key。自更新影响：manager 不能 edit → SKILL.md 要求自更新全流程走 bash。

**runtime 插件职责**：实现 `agents.install` 即**物化器**（把 AgentDefinition 渲染成自家格式：
agent md / config 指令键 / patch）；物化成功后 gateway 自动走车道 1。见
`.opencode/skills/runtime-plugin-authoring/SKILL.md`。

### Runtime 能力契约（多 runtime 接缝）

gateway 与 agent runtime 之间是**能力自声明契约**（`gateway/src/runtime/`）：

- `contract.ts` — `RuntimeCapabilities`（sessionApi/promptWhileBusy/eventStream/
  nativeApprovals/providerConfigApi/perLlmCallTransform/sessionStorageApi/agentConfigApi/
  agentProcessApi）
  + `RuntimeClient` 接口面 + `AgentRuntime`。能力分级：Tier 0（协作协议 + per-turn 记忆）
  → Tier 1（+ 自治执行 + per-step 记忆）→ Tier 2（+ 桌面完整，opencode 形状 DTO 归一化输出）
- `RuntimeClient.tools`（**Tier-0 必选**，无能力位，spec `2026-10-15-runtime-tool-registration-contract-design.md`）：
  `registerTools(factory)`——gateway 激活期推送六件套 factory（spec+execute 单源
  `runtime/mafw-tools.ts`，execute 闭包随 spec 走，runtime 只做 plumbing：按会话
  factory(sessionId) 取注册项、parameters JSON Schema 翻译为自家类型系统、execute 透传）；
  `nativeTools()`——runtime 原生工具声明（name + TOOL_CLASS），激活期经
  `tool-classes.ts` overlay（**声明优先于并集表**，热切换整体替换，坏条目 warning 跳过）
  生效，审批 `isReadOnlyTool`/身份 `resolveToolCategory`/事件 `enrichToolClass` 零改动受益。
  缺实现 = `validate.ts` hard 拒绝 → 插件回退 opencode。out-of-process 通道：
  `GET /api/tools`（spec 清单）+ `POST /api/tools/execute {name, params, sessionID}`
  （loopback 门；执行自动合成两帧 tool part（running→completed/error，`toolpart_<uuid>`）
  经 handleOpencodeEvent 同管线广播（enrich/trajectory/Mode A），spec 2026-10-20；
  in-process opt-in 合成 = `wrapRegistrationsWithEvents`）。opencode 实现 = adapter ack no-op（六件套由 v1 插件承载 + MCP 自接线）；
  pi 实现 = registry `setToolFactory` stash → host extension `T.Unsafe(jsonSchema)` 包
  JSON Schema（`~unsafe` 键 non-enumerable 不入 wire，spike 实证 typebox 1.3.7 +
  pi-ai openai-completions 原样透传）+ execute 桥接（`{text,isError}` → pi ToolResult）。
  已知文档债：六件套描述文本在 v1 插件（`src/tools/`）与 gateway 单源两处暂存（v2 迁移统一）
- `normalize.ts` — runtime 原生事件 → `EventFacets`（正交切面：step/chatSignal/
  broadcast/toolCommand）；opencode 版本知识（≥1.18 step-finish part 结算）只存在于
  本文件（step facet 喂 BudgetGuard 回合计数）
- **opencode 驱动 = workspace 包 `adapters/opencode`（`@mafw/adapter-opencode`）**（Plan 6）：
  驱动整体移出 gateway，包内分工 `adapter.ts`（恒等实现：session/PTY/checkpoint/diff/MCP
  通道）、`runtime.ts`（serve 生命周期 + SQLite session 存储 `sessionStorageApi` + auth.json
  凭据 + agent frontmatter 序列化）、`definition.ts` + `legacy-definition.ts`（legacy→neutral
  组装；bridge 的包内副本，gateway 保留通用版本）、`events.ts`/`events-21.ts`（方言事件表）、
  `canonical.ts`/`history.ts`/`snapshot.ts`/`mcp.ts`/`mcp-config.ts`/`mcp-jsonc.ts`/
  `dialect-probe.ts`/`form-question.ts`/`auth.ts`/`provider-settings.ts`/`serve-sidecar.ts`。
  gateway 只保留 `runtime/opencode-adapter.ts` 一个 fail-soft 包入口：缺包时一次性 warn、
  能力全 false + 空事件表回退，激活抛可诊断错误让组合根回退；**`gateway/src` 里没有任何
  第二处 `require('@mafw/adapter-opencode')`**（Task 7 删除了一个发布周期的 re-export shim，
  `neutral-runtime-boundaries` 守卫钉住）。包内只允许 import `@mafw/runtime-contract` /
  `@mafw/runtime-core` / `@opencode-ai/sdk` / `jsonc-parser` / `cross-spawn` / Node 内置 /
  本地模块，不得回指 `gateway/src`
- **host 接缝**（组合根 ↔ 驱动，Plan 6 Task 3/6）：`ctx.serve`（gateway 请求的 serve
  listener，adapter 缺省 `127.0.0.1:4096`）、`ctx.rootDir`（serve cwd = `~/.mafw/runtime-root`）、
  `ctx.credentials`（凭据快照）、`proxyHeaders`（adapter 产出 serve Basic-auth 头，反代优先用，
  `serveAuthHeaders()` 只作 fail-safe）、`resolveProviderTransport`（scan 路径 provider
  baseURL/key；gateway 用 `provider-transport.ts` 保持 credentials → driver → gateway 链的
  原优先级，judge 路径不变）
- `agent-definition.ts` — 运行时中立的 `AgentDefinition` 模型（description/mode/model/
  systemPrompt/permissions），各 runtime 翻译为自己的配置格式
- `loader.ts` — `~/.mafw/runtime-plugins/*.js` 插件加载（CJS `module.exports =
  { name, capabilities, createRuntime(ctx) }`，fail-open，`POST /api/runtime/reload`
  可热重扫插件文件；能力声明覆盖在 Tier-0 基线之上；`RuntimePluginContext` 携带
  `projectDir?`/`gatewayPort?`（2026-09-16，pi 消费，config 兜底）；包贡献经
  `setPackageEntries()` 注入，查找顺序 legacy 文件 > 包 > 内置）

**可选能力与接口扩展：**
- `external?: boolean` + `getBaseUrl(): string` — runtime 声明托管模式；`external=true`
  时 gateway 不 spawn/不 kill，watchdog 仅健康探测 + 事件流重连
- `credentials?: { getApiKey(provider): string | null }` — 凭据获取；media 服务优先走
  runtime credentials，回退直读 auth.json
- `sessionStorageApi?: boolean` + `session.listByDirectory?(dir, limit)` — 直读 runtime
  私有存储列出会话；缺失时回退 `session.list` + 客户端目录过滤
- `agentConfigApi?: boolean` + `agents?: { install(name, definition); remove?(name) }` —
  agent 定义安装；缺失时跳过 + warn 日志（manager 功能降级但不崩）
- `agentProcessApi?: boolean` + `agentProcess?: { restart() }` — agent 进程生命周期管理；
  opencode owned runtime 为 true（kill+respawn serve sidecar）；external/pi 为 false
- `discovery.invokeSkill?(opts)` — runtime 以自身原生方式调用 skill（opencode `@id`、
  pi `/skill:name`、claude `/name`）；三个内置 adapter 均已接线。gateway 只经
  `DiscoveryService.invokeSkill` 统一转发，surface 为 `discovery.invokeSkill`（presence）。
  缺省时 `/` 不显示技能、路由返回中性 503。
- `completionApi?: boolean` + `completion?: { complete(req) }` — 无状态单次补全通道
  （index-scan 与 media 无状态路径优先走契约，fail-open 回退直连 HTTP，
  共享实现在 `runtime/completion-http.ts`）；`cacheable` 是 prompt-cache 提示非承诺
  （直连传输映射为 DashScope `cache_control: ephemeral`，其他 runtime 可忽略）；
  usage 由消费侧记账，runtime 只负责返回
- `sessionBranchApi?: boolean` + `session.fork/revert/unrevert` — 会话分支原语（fork=新会话携带历史副本；  revert=消息级回退）。pi 不实现 unrevert（HTTP 404），且 pi revert 不回滚文件（SessionManager.branch
  原地移 leaf、不可逆——语义弱于 opencode，契约注释为准）；HTTP 薄代理 `routes/session-branch.ts`
  （能力门 503），SDK `session.fork/revert/unrevert`
- `diffApi?: boolean` + `session.diff` / `session.vcs.{diff,apply}` — 会话 diff 与工作区 patch 原语
  （切片 2；opencode v2 独有，pi 缺席即能力门 503）。HTTP 面：`GET /api/sessions/:id/diff?messageID=`
  与 `POST /api/sessions/:id/diff/revert`（body 传原 patch + hunkIndices，gateway `core/diff/hunk-patch.ts`
  纯函数反转选中 hunk 后 `vcs.apply` 落工作区；校验 400 / apply 502 / 能力门 503）。registry dispatch
  （wave1-handlers `session.diff`/`session.revertDiff`），SDK `session.diff/revertDiff`；desktop 审阅面板
  `DiffReviewPanel`（composer ⇄ 按钮 + SessionTurn「审阅改动」双入口），SSE `session.diff` 经
  dispatcher diff handler 实时填充 `session_diff` store
- `turnBudgetApi?: boolean` + `SessionPromptOpts.maxTurns/maxCostUsd` — 回合预算；两个内置 runtime 均无
  原生强制，gateway 侧 `BudgetGuard`（`core/budget-guard.ts`）兜底：按 step 切面计数 + TrajectoryStore
  成本，超限 abort + noReply 通知；goal 会话经 `onSessionCreated` 挂载，预算读 goal state
  `policySnapshot.{maxTurns,maxCostUsd}`（缺省不启用）
- `PromptResultEnvelope` — `session.prompt()` 返回超集：`parts` + `finish/usage{input,output,cached,
  reasoning,costUsd}/error`（字段缺失 = undefined 非错误；opencode 从 AssistantMessage.cost/tokens 映射）
- EventFacets 新增 `compaction: 'start'|'end'|null` — opencode `session.compacted` → end；pi 经注入的
  `mafw-compaction` extension 上报 `session_before_compact`/`session_compact`（翻译为
  `session.compacting`/`session.compacted`）。gateway 收到后对该会话触发 turnCompress flush
  （`TurnPipeline.runSession`，fail-open，与 hourly cron 互斥）
- `permissionReply(sessionID, requestId, 'once'|'always'|'reject', message?)` — 三值签名（P1 破坏性变更，
  原 boolean approved）；pi `'always'` = session 级动态 allowlist（运行时 push `policy.autoApprove`，
  不落盘）；`/api/sessions/:id/permissions/:requestId` body 接受 `{reply, message?}` 兼容旧 `{approved}`；
  **切片 1 起 'always' 在两条 reply 路由都自动沉淀持久规则**（`persist` 参数 `'tool'|'prefix'|true` 控制
  粒度，缺省 true=prefix 优先自动推导；fail-open）

#### 审批三档预设（2026-09-20，切片 1）

`ApprovalPolicyService` mode 从 manual/auto 二档升级为三档预设（spec `2026-09-20-desktop-ux-refactor-design.md` §3）：

- **三档语义**：`read-only`（只读工具 `isReadOnlyTool` 自动放行，任何变更 human）→ `auto`（安全命令免审、
  危险正则 human、25 次预算耗尽**回落 read-only** 并广播）→ `full-access`（一律 auto-approve，不计数，
  内部会话 auto-deny 仍最高优先）
- **legacy 兼容**：kv 存量 `'manual'` 由 `normalizeMode` 读归一化 `'read-only'`；`POST permission-mode`
  仍接受 `'manual'`；未知值一律 read-only（fail 保守）
- **规则存储**：`~/.mafw/permission-rules.json`（`PermissionRulesStore`，条目 `{tool, pattern?, action:'allow'}`，
  原子写、损坏 fail-open 空表）；evaluate 双读 `rules.matches || allowlistStore.matches`（config.yaml
  `approval.allowlist` 为 legacy 过渡）；pattern 尾 `*` = 前缀匹配（对 commandText 与 patterns）
- **规则沉淀**：`deriveAlwaysRule(found, scope)` 纯函数（scope true=prefix 优先/'tool'/'prefix'）；reply 路由
  always 分支 fail-open 写规则；`/api/approvals/rules` GET/POST/DELETE CRUD（契约已登记，SDK
  `permissions.listRules/addRule/removeRule`）
- **三端**：desktop 🛡 按钮三档循环 + PermissionCard「记此前缀(P)/记此工具(T)」双按钮 +
  ApprovalsSection 切 rules API；TUI `/permissions` 三档循环 + 状态栏 `permLabel`（`🛡 全开`）+ overlay
  五项（once/always/persist/persist-tool/reject）
- ~~pi 扩展内置 `autoApprove` 旁路~~（**2026-10-08 已修**：pi tool_call 先经 `evaluatePermission` 同步直评，ask→政策环兜底，见 §5.19 mafw-host）；opencode 原生 agent permission 配置与 MAFW 层正交保留
- `questionApi?: boolean` + `session.question.{list,reply,reject}` — 原生 question 通道（opencode v2 SDK
  `session.question.*` 直连；pi 无 question API 不实现）；`/api/questions*` 能力门按
  `questionApi ?? nativeApprovals` 向后兼容
- `SessionPromptOpts.delivery/expectReply` — busy 投递时机（pi 映射 `streamingBehavior`；opencode 忽略）
  与免回复（opencode `noReply` 等价；**pi 无原生等价——全路径降级为普通消息 + 每会话 warn 一次**）；
  `noReply` 已 @deprecated（gateway 内部消费方已迁移，字段保留一个清理周期）
- `CompletionRequest.responseFormat` — json_schema 约束输出（opencode 直连传输映射 OpenAI
  `response_format.json_schema`；pi 无顶层支持，fail-open 忽略）
- session 媒体附件：file part（image/video/audio）一等载体语义（契约 `SessionPromptOpts.parts` 注释）；
  pi image 经 `partsToPromptInput` → ImageContent（既有）；pi video/audio 经 `mafw-media` extension 在
  `before_provider_request` 注入小米 wire 格式（registry pendingMedia 队列，注入即清空）
- Goal 预算面：`mafw_create_goal`/`mafw_set_goal` 接受 `budget.{maxTurns,maxCostUsd}` → request.json →
  policySnapshot（`core/goal-budget.ts` `mergeBudgetIntoSnapshot`，fail-open）→ BudgetGuard 硬停闭环
- 桌面 ChatView fork/revert：ChatPane 经 `window.api.mafw.sessions.fork/revert/unrevert`（preload →
  通用 IPC 派发 → SDK）接 session-ui `SessionTurn` actions 位；revert 内联确认 + 清 store 触发重拉
  （MafwShell 空消息 effect 自动 loadSessionHistory）；fork 成功 toast + `onOpenForkedSession`
  （openSessionTab）打开新 tab；unrevert 按 session.revert 态显示

激活插件：`config.yaml` 的 `runtime.plugin: <name>`（或 `MAFW_RUNTIME_PLUGIN`）；
未配置/加载失败一律回退内置 opencode。可观测：`GET /api/runtime` 返回当前
runtime 能力集 + 插件扫描状态。能力门：缺能力的 runtime 对应端点 503、
事件订阅跳过，不崩溃。

**会话目录契约（2026-10-20）**：`SessionCreateOpts.directory`（**必填、绝对路径**）是会话工作目录的唯一权威来源，
由 gateway 每次显式传入（内部会话/worker/media 经 `MafwScheduler.resolvedProjectDir()` =
UI 当前项目 ?? config 项目根）；runtime 侧用 `requireSessionDir(opts.directory, ctx.projectDir)`
（缺则抛错，不静默兜底）。`ctx.projectDir` 降级为**启动期信息**（绝对化快照），仅兜底。
死通道已清理（`sdkConfig.directory` / `OpencodeRuntimeConfig.directory` 0 读取）。
依据：`docs/superpowers/specs/2026-10-20-session-directory-contract-design.md`

> **插件开发协助四件套（2026-09-18）**：①未知事件遥测（`event-telemetry.ts`，已知集=EVENT_FLOW_MATRIX keys ∪ `plugin:`/`session.next.` 前缀族，全量启用；首次出现 warn + `GET /api/runtime` 暴露 `unknownEvents`；`POST /api/events` 扁平非命名空间发布同样采集）；②事件试衣间 `POST /api/runtime/dry-event`（normalize facets + 矩阵每跳处置 + 字段契约警告 `event-field-contract.ts`，纯函数零 deps）；③`ctx.events.make/check` 构造期助手（loader ctx，未知 type 构造点即 warn，fail-open）；④场景一致性 `POST /api/runtime/conformance` + `mafw plugin-test`（S1 chat-roundtrip 事件序 / S2 session-lifecycle API 往返，`handleOpencodeEvent` 的 per-session event tap 收集观测，驱动真实会话消耗 LLM 往返）。评估器纯函数在 `conformance-scenarios.ts`。

#### Runtime 热切换（无需重启）

运行时切换有两种触发路径，均**不重启 gateway 进程**：

| 触发方式 | 入口 | 流程 |
|----------|------|------|
| **HTTP API** | `POST /api/runtime/switch { plugin }` | 校验插件存在（未知 400 + available 列表）→ `config.persistOverrides` 持久化到 `~/.mafw/config.yaml` → `createRuntime()` 重建 → 接线 client/consumers → `resubscribeEvents` 重订阅事件流（AbortController 取消旧订阅，防孤儿迭代）→ dispose 旧 runtime |
| **Config hot-reload** | `config.yaml` 文件变更 watcher（2s 防抖） | `config.reload()` 检测 `runtime` 段变更 → 自动执行同上 createRuntime + resubscribe 流程；`envOverride` 指示 `MAFW_RUNTIME_PLUGIN` 环境变量覆盖 |

辅助端点：
- `GET /api/runtime` — 当前 runtime name/capabilities + envOverride + 插件扫描状态
- `POST /api/runtime/reload` — 重扫 `~/.mafw/runtime-plugins/*.js`（清 `require.cache` 后重新 require），不切换，仅刷新插件列表

热切换安全约束：
- `server`/`paths` 配置段变更仍需重启（`config.reload()` 返回 `restartRequired`）
- `apiToken` 变更即时生效，无需重启
- 插件 `createRuntime()` 抛异常 → 回退内置 opencode，不崩 gateway
- 旧 runtime dispose 由 `onSwitched` 回调统一处理（pi: registry 清空 + event stream 终止）

宿主插件侧（runtime 进程内的 transform/工具注册）是每个 runtime 单独交付物，
不在本契约内；gateway 侧 HTTP（/api/obs/capture、/api/recall/context、/a2a）
对宿主插件保持 runtime 中立。

#### HostAdapter 认知面契约（2026-10-08，Phase 3 形式化）

编排面（RuntimeClient）管 gateway→runtime；**认知面（HostAdapter）管宿主适配器→gateway**，协议 = loopback HTTP（宿主语言/进程无关），实现核心在 `gateway/src/runtime/host-adapter.ts`（`COGNITION_CONTRACT` 时序常量 + `createCognitionClient` + `createRecallCursor` + 工具 HTTP 核心）。四动词：

| 动词 | 协议 | 时序/语义 |
|---|---|---|
| observe | POST /api/obs/capture | 5s fail-open；source ∈ user_input/assistant_reply/tool_result/reasoning |
| injectContext | GET /api/recall/context | **100ms fail-open**；游标增量（id 优先/count 回退）+ 短增量（<50 字符）并入 assistant 尾部 300；注入物带 `synthetic:true` 部件标记防回流 |
| injectSystem | GET /api/recall/pinned + 静态 MEMORY_GUIDE | 150ms fail-open；追加 system 尾部 |
| tools | /api/memory/add、/api/python/*、/api/tts、/a2a | 六件套；add_memory 走 HTTP 因 serve worker 无 MCP |

宿主实现：pi = `adapters/pi/src/pi-mafw-host-extension.ts`（薄事件映射，消费 host-adapter 核心）；v1 opencode 插件 = 原生实现同语义（**刻意不重构**——生产宿主，v2 迁移时统一）；v2 = 待迁移（以 host-adapter 为核，spike 原型见调研文档 §8）。**一致性验证**：`POST /api/runtime/conformance {scenarios:["cognition-observe","cognition-inject"]}` —— S3 验证 T1 三类观察行、S4 验证 recall 触达 + memory-guide 端到端到达模型（复述法，宿主无关）。

**内置插件：pi-coding-agent runtime（`adapters/pi/src/runtime.ts`）**
- `config.runtime.plugin: pi` 激活；进程内 SDK 嵌入（ESM 桥 `new Function('spec','return import(spec)')`）
- 能力：sessionApi/promptWhileBusy/eventStream/nativeApprovals/providerConfigApi/sessionStorageApi/agentConfigApi true
- 认证链：`ctx.credentials.getApiKey` → auth.json 回退 → ModelRuntime.setRuntimeApiKey（单例共享）
- 会话：`PiSessionRegistry`（Map<sessionID, AgentSession>，忙时 followUp 队列）
- 存储：`pi-session-storage.ts`（调用 pi SessionManager.list(cwd) 列出持久化会话，映射为 gateway SessionInfo 格式）
- 事件：`PiEventStream`（subscribe → RawRuntimeEvent → normalize.ts 四信号 turn.completed/turn.failed/part.updated/message.updated；v2 词汇）
- external=true：gateway 不 spawn；外部 runtime 的事件订阅与 serveReady 解耦（不等 opencode serve）
- 媒体 agent 消费 AgentRuntime（Phase 2，见 `docs/superpowers/specs/2026-08-27-pi-runtime-design.md`）

**认知面宿主扩展 mafw-host（2026-10-08，Phase 2）**：`adapters/pi/src/pi-mafw-host-extension.ts`，随会话 factory 注入（create/fork 双路径，`runtime.pluginConfig.pi.hostExtension !== false` 默认开）。四动词：observe（message_end user/assistant+thinking + tool_result → loopback `/api/obs/capture`）、injectContext（context 事件，双模游标=id 优先/count 回退，短增量并入 assistant 尾部，100ms fail-open，synthetic part 标记防回流）、injectSystem（before_agent_start 链式追加 `<memory-guide>` + pinned `<user-profile>`）、tools（六件套 registerTool，typebox 经 ESM 桥 import `@earendil-works/pi-coding-agent/node_modules/typebox` 取同实例）。与 v1 插件完全同出口（loopback HTTP）——ACT-R 结算/FOK 采样/内部会话过滤零漂移。**approval 旁路已修（2026-10-08）**：静态 autoApprove 五件套删除，改为 `evaluatePermission`（ApprovalPolicyService.evaluate 同步直评，index.ts 三处 runtime 赋值点注入）+ ask→政策环（applyApprovalPolicy）兜底；`ApprovalPolicy.autoApprove` 语义 = 会话动态 allowlist + config 显式预置。

#### 事件映射注册（2026-10-08，v4.20.0）

runtime 插件用**纯数据表**把原生事件接入 canonical 管线，不再手写翻译层（spec：`docs/superpowers/specs/2026-10-08-event-mapping-registration-design.md`）：

- **插件声明**（`module.exports`）：`eventSource { typePath, sessionIdPath?, directoryPath? }` + `eventMappings: [{ from, to, when?, fields? }]` + `transformEvent(raw)` 逃逸口。
  - `from` = 原生类型（string|string[]）；`to` = canonical 类型或 `'drop'`；`when` 为纯数据条件（`{path, equals?|exists?}`，`typePath` 可指嵌套判别字段如 Claude `$.event.type`）
  - `fields` 值三选一：`{path,default?}` / `{const}` / `{template}`（`'pi_step_{$.sessionID}'` 式插值，覆盖 ID 物化）；路径 = 裁剪 JSONPath 子集（点号+下标，**无 eval**）
  - **匹配优先级（B1 default-deny，2026-10-20 rev2）**：eventMappings（数组序，含 drop 行与 `canonicalIdentity()` 词汇单源派生的恒等行）→ transformEvent（B2 守卫：try/catch + 输出形状校验）→ **拦截 + 计数**。canonical 直发分支已删除——同名收编词经 identity 行注册（恒等翻译也是翻译）；信封形态（pi 已翻译流）按 canonical 词汇判定放行/拦截；畸形（无可解析类型）透传给下游诊断。无声明 runtime = eventStream 加载期降级
- **gateway 侧**：`CANONICAL_FACET_RULES`（`runtime/canonical-facets.ts`）把 canonical type → EventFacets 表化（原 `normalizeOpencodeEvent` if 链；`normalize-oracle.test.ts` 逐事件钉扎表驱动 ≡ v2 手写参照）；v2 起 `toolCommand` 升为规则行（tool part 快照载体），仅 approval metadata 构造为执行器内置特例
- **执行器**：`runtime/path-expr.ts`（安全路径求值）+ `runtime/event-mapper.ts`（applyEventMappings / validateEventMappings / wrapGlobalEventStream / canonicalIdentity / hasEventDeclarations；`TranslationHooks { onUnmatched, onSuppressed, onTranslationError }`）
- **加载期校验**（`loader.ts`）：未知 canonical `to` / 坏路径 / **声明 eventStream 却无翻译声明** → 插件 `eventStream` 能力降级 + error 状态（fail-open，仍注册；包贡献 runtime 由 index.ts activatePluginRuntime 兜底降级）
- **B2/B3 可观测**：`GET /api/runtime` 暴露 `translationErrors`（transformEvent/normalizeMessages 守卫失败，限频 ERROR + 计数）与 `translationDrops`（per-type **unmatched**=未命中翻译【监控信号，turn 终态类每次 loud warn】 / **suppressed**=drop 行或 transformEvent 显式 null【作者意图】）；conformance 断言 unmatched===0（升级 runtime 后跑一遍即抓词汇漂移）+ session-lifecycle 历史形状断言（`{info,parts[]}`）
- **dry-event 试衣间**：`POST /api/runtime/dry-event { plugin, event }` 输出 映射→facet→矩阵→字段契约 每跳（含 approval facet 回显 + 工具三原语的 assembler 跳回显 `assembled`）
- **已迁入**：pi（`PI_EVENT_MAPPINGS`，`translatePiEvent` 由 switch 表化——**turn_end 改 `part.messageID`，修复 BudgetGuard step facet 在 pi 上从未触发的 bug**）；opencode 原生事件即 canonical（不包装，映射表仍显式声明）；~~词汇表沿用 opencode 形状~~（**2026-10-12 v2 已反转**，见下）
- **翻译归属 = self-vs-declared（Plan 6）**：驱动自报 `eventMappings`/`transformEvent`/`eventSource`（声明式、纯数据），gateway 只做声明校验 + 映射执行 + canonical passthrough，不认识任何原生 payload 字段名。opencode 的表随驱动进包（`adapters/opencode/src/events.ts` / `events-21.ts`），`dry-event` 的 tooling entry 由 shim 的 bridge provider 镜像回 gateway 映射表（`setBridgeEventEntryProvider`）
- **词汇 v2（2026-10-12，`docs/superpowers/specs/2026-10-12-native-event-vocabulary-design.md`）**：canonical 词汇所有权归 MAFW——`turn.completed/failed/aborted` 三元组统一回合终态（原 session.idle/message.complete/message.error/message.aborted 五终态双轨 + Mode A 改写 hack 全部删除，广播统一 passthrough）；`message.part.*` → `part.*`；`todo.updated` → `plan.updated`；新增 `usage.updated`（gateway 从 TrajectoryTurn tokens/cost 合成）与 permission.asked 载荷可选 `options[]`/`suggestedRule`；`session.next.*` 六条除名（唯一消费者 v1 宿主插件在进程内吃原生事件）；信封 `opencode_event` → `mafw_event`（SDK 类型 `MafwEventEnvelope`）。**强制翻译接线**：opencode 经 `registerBuiltinDefinition` 携包内 `OPENCODE_EVENT_MAPPINGS`（`adapters/opencode/src/events.ts`：差异行 + session.next.*/sync 显式 drop 行 + `canonicalIdentity('$.payload.properties')` 恒等行——transformEvent 已退役）接入，与文件插件同一注册接口；三分支（plugin/builtin/direct）共用 `wrapGlobalEventStream`（强制）→ `wrapToolPartAssembly` 序列。**词汇单源**：SDK `events.ts`（客户端契约）↔ `runtime/mafw-vocabulary.ts`（gateway 常量 `MAFW`，交叉测试 `vocabulary-sync.test.ts` 钉扎）；三层守卫链不变（SDK union ↔ 矩阵测试 ↔ desktop `assertShellEventCoverage`）+ TUI 第四道弱守卫（KNOWN_EVENTS ⊆ union，`tests/event-coverage.test.ts`）。**toolCommand facet 载体迁移**：原 `session.next.tool.*`（`type.includes('tool')` 特例）→ `part.updated` + `part.type='tool'` 规则行（`$.part.state.input.command`），自更新调用者定位行为保持。**eventBus 扁平发射注册表化**：`runtime/flat-emit-registry.ts`（10 类型）替换 setupEventBus if 链；goal_node 已正式登记 SDK union/矩阵/穷尽守卫。oracle 重立为 v2 手写参照（`normalize-oracle.test.ts`）；replay 升级为全链路 golden（opencode raw → 翻译 → normalize，`event-replay.test.ts`）
- **工具身份 canonical 翻译层（A 切片，2026-10-20 rev2）**：`runtime/tool-classes.ts` 增 `TOOL_CANONICAL_TABLE`（形状兼容别名：command_execution/ls/find/file_change/collab_tool_call/web_search/todo_list/powershell → opencode 名）+ `canonicalToolOf(name)` 解析链（overlay 声明 → 静态表 → 已是 opencode 名 → undefined 不硬猜）；`NativeToolDeclaration.canonical?` 声明进 overlay。enrich 双出口：live = `enrichToolIdentity`（handleOpencodeEvent 单点，补 `part.toolClass` + `part.canonicalTool` additive）；历史 = `enrichHistoryParts`（messages 路由出口，全 runtime）。消费面：session-ui 四级查找链 `原生名 > canonicalTool > CLASS_FAMILY[toolClass] > GenericTool`（`tool-canonical.ts`，注册表拆 `tool-registry.ts` 轻依赖模块）+ read 域多 key（`filePath ?? path ?? file_path`）+ 上下文组成员资格 canonical 感知；TUI chat-store 与 trajectory collector 聚合键改 `canonicalTool ?? tool`（recap 不再按别名碎片化）
- **工具 part 合帧（2026-10-12）**：`runtime/tool-part-assembler.ts` 的 `ToolPartAssembler`（per-session、callID 键控状态机）把「call/result 分离」runtime 的三原语（`tool.call`/`tool.delta`/`tool.result`，**内部类型**：进 `CANONICAL_TYPE_SET` 校验但不进公开词汇表/矩阵、不广播）合帧为 opencode 形状 ToolPart 快照（part.id = `toolpart_<callID>`，live 与历史同 id 去重）。`wrapToolPartAssembly` 在 `wrapGlobalEventStream` 之后接线（plugin + builtin 两分支；opencode 无三原语 → 恒等直通），`handleOpencodeEvent` 有三原语防漏底线。历史路径：契约可选 `session.normalizeMessages`（缺省恒等），gateway messages 路由经 `applyNormalizeMessages` 统一过；pi 实现 `adapters/pi/src/pi-message-normalize.ts`（ToolCall block + toolResult 按 toolCallId 归并）——修复「pi 工具卡桌面从不渲染 + 历史空」。spec：`docs/superpowers/specs/2026-10-12-tool-part-compat-design.md`
- **`queue.updated` 快照语义（2026-11-10）**：`queue.updated` 只有在 `items` 为数组时才是全量快照；2.1 inbox 的 item 级事件只带 `action`/`item`/`id`，必须缺省 `items` 键——伪造空数组会让客户端把队列清空。

#### nativeApprovals 翻译层（pi runtime）

pi runtime 声明 `nativeApprovals: true`，通过 MafwApprovalExtension 拦截 tool_call 事件：

1. **ApprovalBridge**（`pi-approval-bridge.ts`）：每个 session 独立的 Promise map，5 分钟超时自动拒绝
2. **MafwApprovalExtension**（`pi-approval-extension.ts`）：pi extension，拦截 tool_call，发射 permission.asked/replied 事件
3. **事件翻译**（`pi-events.ts`）：`translatePiEvent` 将 permission.asked/permission.replied 翻译为 opencode 形状，经 `normalizeOpencodeEvent` 归一化为 EventFacets
4. **HTTP API**：`POST /api/sessions/:sessionID/permissions/:requestId` 转发到 `runtime.session.permissionReply`
5. **配置**：`runtime.pluginConfig.pi.approvalPolicy` 自定义 autoApprove/autoDeny 列表

默认策略：read/grep/ls/find/glob 自动放行，其余需审批。

#### 插件切换端点（runtime / media，桌面 Config 页「插件 Plugins」卡片）

- `GET /api/runtime` — active runtime（name/capabilities/**envOverride**）+ 插件扫描状态；`POST /api/runtime/switch { plugin }` — **热切换**（进程内重建 runtime，无需重启）：校验插件存在（未知 400 + available）→ `config.persistOverrides` 持久化 → `createRuntime` 重建 → 接线 client/consumers → **`resubscribeEvents` 重订阅事件流**（AbortController 取消旧订阅，防孤儿迭代）→ dispose 旧 runtime（pi 的 registry + event stream）；`envOverride` 指示 `MAFW_RUNTIME_PLUGIN` 环境变量覆盖；`POST /api/runtime/reload` 重扫插件文件
- `POST /api/media/switch { engine?, image?: {engine?}, video?: {engine?}, audio?: {engine?} }` — 校验引擎名（未知 400 + available；pi 恒可用）→ 持久化 + `mediaPluginLoader.reload()` **热生效**；返回 `{ success, media: {engine, image, video, audio} }`
- `GET /api/model-config` / `POST /api/model-config` — 记忆 worker 模型 + 媒体每模态模型（`recall.workerModel`、`media.provider/model`、`media.{image,video,audio}`）：provider 列表来自 `GET /api/provider`（不可用 fail-open）；POST 严格校验（空字符串=清空回退，跳过校验）→ `config.persistOverrides` 落盘 → 仅 recall 变更时置空 `scanService` 单例（TurnPipeline/ReflectionPipeline 每次新建本就热生效；媒体 per-request 读 config 天然实时）；路由 `routes/model-config.ts`，deps 注入可单测；SDK `models` 命名空间 + 桌面 Config 页「模型 Models」卡片
- `GET /api/memory/embedding-config` / `POST /api/memory/embedding-config` — 记忆嵌入引擎设置（provider/engine/model/threads + llamacpp.gpu/threads/contextSize）：POST 校验枚举 → `persistOverrides` → **热切换**（kill 旧 llama-server sidecar → 重建 EmbeddingRuntime → 后台 backfill）；写路径 `onMemoryWritten` 监听已改为懒解析 `getEmbeddingRuntime()`，热换不留 stale provider。**路由必须注册在 `/api/memory/*` dashboard 兜底委托（index.ts ~2970 行）之前**。向量文件按 provider.name 打标签，gpu 变体间共享（同模型嵌入空间一致）；路由 `routes/embedding-config.ts`；SDK `embedding` 命名空间 + 桌面 Config 页「Memory」区块
- 切换逻辑在 `gateway/src/routes/{runtime-switch,media-switch,model-config,embedding-config}.ts`（deps 注入，可单测），index.ts 仅薄接线
- 桌面 Config 页：Runtime 下拉（`SelectV2`，选择后 `confirm()` 二次确认 → switch → toast；`envOverride` 显示警告条）+ Media 每模态下拉（热生效）+ 模型 Models 卡片（级联双 `SelectV2`，provider 变更时重置 model 下拉并过滤）；SDK `MafwClient.runtime/media/models` 命名空间 + preload 对应方法

### Runtime Experience 全量迁移与架构守卫（2026-11-02 第二批）

第二批收口：gateway 业务核心与**全部客户端**只消费 MAFW View DTO + Experience Contract，
客户端兼容层物理删除；守卫、作者文档与契约产物同批硬化。spec
`docs/superpowers/specs/2026-11-02-runtime-experience-full-migration-design.md`（§16 实现偏差），
操作手册 `docs/guides/runtime-plugin-authoring.md` §9.7。

- **历史出口只有 flat**：`GET /api/sessions/:id/messages` 唯一响应 `{ data: MafwMessage[], nextCursor }`；
  `wire-compat.ts`（`toWireHistory/toWireInfo/toWireEventPayload`）、`?format=` 分支、facade 的
  wire→flat 二次翻译全部删除；adapter 必须直接交付 flat，违例 fail-closed
  （`normalizeMessages produced a non-flat member - dropped`）。SDK/preload 的 `session.history`
  别名删除，desktop/TUI/mobile 一律 `session.messages`。
- **SSE 出口 canonical**：`message.updated` 只带 `properties.message`；gateway 启动时对 `event_log`
  做一次性幂等迁移（`events/event-log-migrate.ts`，备份 `~/.mafw/logs/event-log-message-migration-<ts>.jsonl`，
  备份失败则中止迁移）。`session.created/updated/deleted` 仍是 wire `properties.info`
  （desktop 仅这 3 类读取；`event-field-contract` 对其余 info 载荷告警）。
- **Experience 与中性门**：业务 UI 只消费 `GET /api/experience/actions`
  （`supported` = 面存在、`enabled` = 上下文可用、`reason` 为中性词汇）；业务核心只经
  `RuntimeAccess.can(surface)`，缺能力回中性 503（`runtime does not support <surface>`，不含
  runtime 名与 capability flag 名）；`branch.unrevert` 用 404、worktree 目录不支持用 409。
  前端 `runtimeCaps`/`runtimeName` props 全删（desktop Config 是唯一 Diagnostics 名称例外）。
- **中性 facade**：background 三源统一（`/api/background/jobs*` + `background.job.updated`，
  `POST /api/session/:id/background` 表达「转后台」动作，Task 16 补登记进 route catalog）；
  terminal 走 `mafw-terminal/1`（`/api/terminal/*` + connect-ticket，原生帧只在 adapter 翻译）；
  worktree 归 gateway git + session directory 契约（能力位退役）。
- **删除面（破坏性）**：SDK `session.history`/`shells`/`requestRuntime`/`command`/`skill`/
  `opencodeConfig`；HTTP `GET /command`、`GET /skill`、`GET /api/skill/content`、
  `GET|PATCH /api/opencode-config`；preload 通用 `invoke(ns, method, ...)`。旧 desktop/TUI/mobile
  无法连新 gateway，需协调发布。
- **架构守卫（反向 fixture 全绿才通过）**：`gateway/tests/unit/runtime/architecture-boundaries.test.ts`
  （routes/core/media/trajectory + 抽出的 `experience/events/terminal` + 顶层业务文件；组合根
  `index.ts` 的诊断例外按「规则 + 访问形态」登记 8 条，并有反向断言防死豁免）、
  `route-surface-catalog.test.ts`（31 个 gated op：manifest surface + catalog operation + 中性
  503/404）、`history-exit-golden.test.ts`（opencode/pi/claude 三种 native 输入 → 同一 flat 出口 +
  同一 canonical `message.updated`；工具 part id 与 live assembler 同方案 `toolpart_<callID>`）、
  `wire-deletion-guards.test.ts`；desktop `experience-boundaries.test.ts`（`src/` 全域，Config
  名称例外，`properties.info` 仅 3 个 session 生命周期文件）、TUI `tests/experience-boundaries.test.ts`、
  session-ui `src/architecture.test.ts`。
- **契约补洞**：`POST /api/session/:id/background`（SDK `sessions.background` 一直在调）此前漏登记
  catalog，导致不在 openapi/契约产物里；本批补登记并重生成（`emit:openapi` 241 operations /
  215 paths）。
- **登记缺口**：claude 历史无时间戳（`time` 可选缺失）；
  adapter 内部 native 翻译（opencode `/command`、`/skill`、history normalize）按 spec §9.2 保留。
  pi 的 live 消息身份缺口已闭合（2026-11-03）：`message_start`（仅 assistant，骨架让
  `part.delta` 有承载）/`message_end`（user+assistant）→ `message.updated` 带 `message.id`
  （`piu_<timestamp>` / `pia_<timestamp>`，与 `normalizePiMessages` 同一套），
  `message_update`（`text_delta`/`thinking_delta`）→ `part.delta`（partID
  `<msgId>_t<n>`/`_r<n>` 跟 contentIndex；facet 侧同样出 `chatSignal: delta`）；
  无 timestamp 的 live 消息丢弃；user 的 `message_start` 刻意不发（`message_end` 已完整落一次）。
- **验证**：gateway **4002/4002（534 suites，含并行 user 测试）**、SDK **180/180**、session-ui **133/133**、TUI
  **284 pass/1 skip（285）**、desktop **2253/2253**、mobile **86/86**、adapters/claude **21/21**；
  `tsc`/`tsgo -p tsconfig.json`/`electron-vite build`/根 build/`flutter analyze`+`flutter test` rc=0。
  契约产物新鲜度由 `api-contract.test.ts` 与 `contract-manifest-freshness.test.ts` 把守。
  状态：**v5.0.0 已发布**（2026-11-03，tag `v5.0.0`，release commit `49a63ca2`，main/tag 已推送）。
## Phase 4 现状（2026-11-11）

- opencode 由 `adapters/opencode` 通过原生 `defineRuntime` 装配：`transport.ts`（含断流重订阅/重探）、`host.ts`、`channels.ts`（v1 + channelsV2）、`emit.ts`（raw → canonical → 校验后的 `AdapterEvent`）。
- `legacy-definition.ts` 已删除；gateway 只保留 `runtime/legacy-plugin-bridge.ts` 作为旧文件插件的一次性 shim（`adapter-bridge.ts` 为 deprecated re-export）。
- gateway 侧不再持有 opencode 凭据解析、serve Basic-auth fallback、`~/.config/opencode` 路径或 external env 判定：凭据来自 active host，skills/instruction roots 来自 `discovery.roots()`，external 来自 adapter 的 `opencodeExternalMode()`。
- 注册名/方言由 adapter 的 `OPENCODE_REGISTRATIONS` 描述符驱动；gateway `builtin-adapters.ts` 聚合，`index.ts` 不再硬编码 runtime 名。
