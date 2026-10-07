# Agent Runtime SDK 形态调研：插件承担太重怎么办

> 2026-10-03 · 起因：宿主插件（opencode v1 plugin）开发体验差、承担过重，调研业界 agent 核心的 **SDK 接入形态**（不是扩展机制表面），判断 gateway runtime 层是否需要重构。

## 0. TL;DR

1. **编排契约不需要重构**——`gateway/src/runtime/` 的 RuntimeClient（15 能力/~34 方法）映射得上所有家的 SDK 形态，是健康的"驱动层"。
2. **真正的问题：认知面（观察捕获/边界注入/系统注入/媒体摄取/工具/命令）不在契约里，全部压在 opencode v1 宿主插件上**——骑在 3 个 experimental API + 2 个未类型化 key 上，dev loop 全系统最差，30% 是死代码。pi runtime 完全合规却零记忆接入，即为契约缺口的实证。
3. **业界已在收敛**：opencode v2 把插件上下文定义为"server client + hooks"，我们的全部认知面在 v2 变成一等公民（`session.hook("context")` = messages.transform 的转正），且有热重载/原生 TS/包管理；Claude Agent SDK 与 Codex SDK 走"库 + 二进制子进程"；pi 是真进程内 SDK（我们已嵌）；DeepSeek Harness 走 Cordis 微内核"everything is a plugin"。
4. **判断：外科手术式重构，不是重写**。认知面从 v1 插件迁出到两个正式位置（opencode v2 插件 + pi extension 集合），形式化为一组 HostAdapter 动词；编排契约与 gateway 位置不动。

## 1. 问题定义

gateway 是 harness（philschmid 意义上的"操作系统"层），它需要 agent 核心提供两类接入面：

- **编排面**：session 创建/prompt/事件流/审批/分支/预算——已由 RuntimeClient 契约覆盖（`contract.ts` 349 行，15 能力，~30 个能力门回退分支），双实现（opencode 356 行 adapter + pi 家族 ~1,200 行）。
- **认知面**：per-LLM-call 的观察与注入——`perLlmCallTransform` 在契约中标注为 "informational — gateway does not directly consume it"，实际全部由宿主插件实现。

## 2. 现状诊断（2026-10-03 代码盘点）

### 2.1 宿主插件（root `src/`，~2,700 行，~800 行死代码）

| 块 | 内容 | 规模 | 状态 |
|---|---|---|---|
| plugin.ts | 注册 6 工具 + 10 个 hook key | 317 行 | 3 个 `experimental.*`（messages/system transform、text.complete）+ 2 个未在 pinned `@opencode-ai/plugin@1.17.11` 类型中的 key（command、session.end） |
| hooks/ | media-ingest 242 / session-recall 118 / voice-guide 93 / bash-python-guide 70 / memory-guide 48 / user-profile 25 + **8 个死桩文件 + 半死的 HookManager(111)** | ~1,030 行 | 认知面核心全在这里 |
| tools/ | 6 个纯 HTTP 薄封装（media×3/python×2/add-memory） | ~625 行 | 平凡可移植 |
| utils/ | self-wiring 61（MCP 配置注入 hack）/ ttl-map 60（**与 gateway 复制粘贴**，"插件不能 import gateway 代码"）/ state+status+config-loader ~550（legacy goal 环路） | ~1,045 行 | 大半 legacy |

### 2.2 Dev loop 是全系统最差（开发难的直接原因）

- `package.json` `files` 白名单**不含 root `dist/`**，且无 `main`/`exports`/opencode 入口字段——发布 tarball 里根本没有 plugin.js
- 实际加载的插件来自 opencode.jsonc 里一个 `file:` 引用的**陈旧仓库副本**；改一次 = `tsc` → 手动同步 → 重启会话
- 对比：gateway runtime 可 `POST /api/runtime/switch` 热切换、pi extension 随 gateway 生效、media/usage/runtime 插件全部热重扫——**只有 opencode 插件没有 reload 故事**
- 历史事故模式：experimental API 变更表现为**静默失效**（`mcpServers`→`mcp` 改名曾无声杀死全部 39 个工具）

### 2.3 pi 路线已是 SDK 形态（DX 反例中的正例）

- 进程内嵌（ESM 桥），extension 以 **factory 在会话创建时注入**——是我们自己 repo 里的 typed 代码，随 gateway 热切换，无打包/发布/静默失效问题
- 已有 3 个手写 extension（~116 行）证明难点：mafw-approval（tool_call 拦截+事件翻译）、mafw-compaction、mafw-media（before_provider_request wire 注入）
- **故意只做最小集**：`context`（≈messages.transform）、`before_agent_start`（≈system.transform）、`message_end`/`tool_result`（≈观察捕获）、`registerTool`/`registerCommand` 全部未用——认知面在 pi 上为零

## 3. 业界 SDK 形态全景

### 3.1 形态光谱

| 形态 | 代表 | 进程模型 | harness 视角 |
|---|---|---|---|
| **真进程内 SDK** | pi（`@earendil-works/pi-coding-agent`） | agent 核心是库，你的进程是宿主 | extension=factory 注入，全部代码自有 |
| **库 + 二进制子进程** | Claude Agent SDK（TS/Python）、Codex SDK（`@openai/codex-sdk`） | SDK 库 spawn 官方二进制，结构化事件（Claude：进程内 hooks 回调；Codex：stdin/stdout JSONL） | 库 API 即接入面 |
| **服务器 + typed client + in-process 插件** | opencode v2（`@opencode/client` + Plugin API） | serve --service 常驻；插件在服务进程内，ctx=client+hooks | client 与插件同一契约；`Service.ensure()` 官方管进程 |
| **产品 + 协议/钩子（无 SDK）** | Kimi Code（ACP + shell hooks + MCP + skills）、Claude Code CLI（五类 hook handler：command/**http**/mcp_tool/prompt/agent） | 外部进程扩展，语言中立 | 只能外挂，不能内嵌 |
| **微内核 everything-is-a-plugin** | DeepSeek Harness（Cordis） | harness 本身是微内核，一切能力（含 UI、kits）是进程内插件 | harness 即产品，插件是一等公民 |

### 3.2 各家明细

**opencode v2（2.0.6，与最相关）**
- 三件套：`@opencode/client`（typed HTTP client，与 API reference 同契约生成；event.subscribe 异步迭代，无回放/自动重连）+ `Service.discover/ensure/stop`（官方 sidecar 管理：注册文件、版本兼容谓词、`opencode serve --service`）+ Plugin API
- 插件：`Plugin.define({id, setup(ctx)})`；**"plugin context is essentially an OpenCode server client"**——插件与外部客户端同一 API，另加 transforms/hooks/registrations
- **Transforms**（注册表级，replay 语义，可热重载）：provider/model/agent/command/integration/**mcp**/reference/skill/**tool**/vcs/worktree/websearch
- **Hooks**（运行时拦截）：`session.hook("prompt")`（准入改写 text/files/delivery）、**`"context"`（agent loop 模型派发前改 system/messages/tools/options，含工具驱动的续跑）**、`"compaction"`（可自产摘要跳过模型调用）、`"generate"`/`"title"`、`"model.request"`、`"http.request"`/`"http.response"`、`"experimental.ws.*"`、`"retry"`；`permission.hook("evaluate")`；`shell.hook("create.before")`；`tool.hook("execute.before"/"execute.after")`
- **DX**：`.opencode/plugins/*.ts` 原生 TS 自动加载；监视目录**自动热重载**；`opencode plugin add/list/check/update/remove` 包管理；插件 options；`ctx.storage`（插件级持久 KV）；**Plugin RPC**（插件向外部 client 暴露 typed 方法与事件）
- 有官方 **V1 插件迁移指南**（`/build/plugins/migrate-v1`）——v1→v2 是破坏性重写
- 注意：Windows 包管理器暂不支持（有 zip 二进制）；v2 尚年轻

**Claude Agent SDK**
- 定位原话："Claude Code as a library"；TS/Python，库运行 Claude Code 二进制
- 可编程：内置工具、**进程内 hooks**、subagents、MCP、permissions、sessions、skills/commands、**system prompt 修改**、插件加载
- 边界注入的最近似物：UserPromptSubmit 加 context + 改 system prompt——**没有 mid-loop 消息数组变换**（比 opencode v2 的 context hook 弱）

**Codex SDK（`@openai/codex-sdk`）**
- "Embed the Codex agent in your workflows and apps"：spawn `codex` CLI，stdin/stdout JSONL
- Thread/Turn 模型：`run()`/`runStreamed()`（结构化事件流）、`outputSchema`（JSON schema/Zod）、local_image 附件、`resumeThread`、workingDirectory/env/config 覆盖
- **纯编排**：无消息变换、无注入点——工具与上下文只能靠 MCP + config

**Kimi Code（MoonshotAI/kimi-code，换代自 Python kimi-cli）**
- 单二进制产品（Node≥24 源码、Bun 编译）；TUI 建在 **pi-tui** 上（pi 生态成为别家 agent 的底座）
- 程序化接入 = **ACP**（`kimi acp`，Zed/JetBrains over stdio）+ shell hooks + MCP + skills + sub-agents；**无嵌入 SDK**
- AI 原生 MCP 配置（`/mcp-config` 对话式管理）

**DeepSeek Harness（`dsh`，deepseek-ai/deepseek-harness）**
- 2026-08-13 创建，7 周 242k stars，TypeScript，MIT，**developer preview（明示会有破坏性变更）**
- **"Everything is a Plugin"**：基于 Cordis（cordiverse/cordis，Koishi 生态的 DI+插件框架，设计论文 arXiv:2608.25512 "A Programming Paradigm for Spatiotemporal Composability"）——插件 = 收 ctx 的工厂，DI 服务注入、作用域生命周期、组合隔离
- `npx @deepseek-ai/dsh web`（:3080 Web UI）/ Desktop；能力皆插件（连 LibreOffice kit 都是插件组件 dsh-libreoffice-kit）；`dsh-plugin` topic 生态
- 文档：deepseek-harness.github.io/deepseek-harness/

**pi（本地事实，非网络资料）**
- 26 种 extension 事件（`context` = 每次 LLM 调用前改消息数组；`before_agent_start` = system prompt 链式改写；`tool_call`/`tool_result`/`message_end`；`before_provider_request` = wire 级）；ExtensionAPI：registerTool（typebox）/registerCommand/registerShortcut/sendMessage/appendEntry/自定义 provider
- 我们已进程内嵌入并以 factory 注入 extension——**这就是 SDK 形态的全部含义，且已跑在生产**

### 3.3 harness 工程哲学（philschmid，作为设计对照）

- harness = OS（模型=CPU，上下文=RAM，agent=应用）；harness 负责上下文工程：compaction、卸载、subagent 隔离
- Bitter Lesson：Manus 半年重构 harness 五次、LangChain 一年三次、Vercel 删掉 80% 工具反而更好——**harness 必须轻、必须 build-to-delete**
- "The harness is the dataset"：竞争优势不是 prompt 而是 harness 捕获的轨迹——**这正是 MAFW 记忆系统的论点**，我们已经是这个方向的极端实践者
- 2026-09 实测：前沿模型 bash 超人化，"smaller interface, larger action space"——微工具在退潮，网关型重工具（记忆检索正是）保留价值

## 4. 关键发现

### 4.1 opencode v2 把 MAFW 认知面全部"转正"

| MAFW 认知面（现 v1 插件） | opencode v2 对应 | 备注 |
|---|---|---|
| `experimental.chat.messages.transform`（边界 recall） | `ctx.session.hook("context")` | 一等公民、typed、含工具驱动续跑（语义更准） |
| `experimental.chat.system.transform`（memory-guide/user-profile/voice-guide） | `session.hook("context")` 的 `event.system.push` | 同一 hook |
| 观察捕获（chat.message / tool.execute.after / event / text.complete） | `tool.hook("execute.after")` + `ctx.event.subscribe` + `session.hook("prompt")` | 全部 typed |
| media-ingest | `session.hook("prompt")`（改写 files/text）或 context hook | |
| 6 个插件工具 | `ctx.tool.transform`（含 namespace） | |
| 6 条 slash 命令 | `ctx.command.transform` | |
| self-wiring.ts（patch opencode.jsonc 注 MCP） | **`ctx.mcp.transform`——可编程注册 MCP，self-wiring 整个消亡** | |
| 审批三档 | `permission.hook("evaluate")` | |
| turnCompress 的 compaction 感知 | `session.hook("compaction")`（可自产摘要） | |
| worker session（serve 无 MCP 连接才做的 HTTP add-memory 工具） | Plugin RPC / 仍走 client | 待迁移时定 |
| serve-sidecar.ts（手写 spawn/watchdog） | `Service.ensure()`（官方） | 编排面也简化 |

### 4.2 SDK 形态收敛：plugin API ≡ client API + hooks

opencode v2 的关键句子："The plugin context is essentially an OpenCode server client"。插件与外部 harness 客户端共享同一契约，插件只是"跑在服务进程内、多出 hooks 与注册权"的客户端。这意味着**"写插件"和"写 harness 客户端"的边界在消失**——我们抱怨的"插件形态"之苦，业界解法不是放弃插件，而是让插件 API 与 client API 合一并转正 hook。

### 4.3 DeepSeek 的极端立场与我们的取舍

dsh 证明"插件"可以是**唯一**的组合单位（微内核+DI+生命周期）。但 MAFW 的复杂度在记忆系统而非组合性——gateway 本身插件化的收益低、迁移成本高（developer preview、破坏性变更期）。**吸收思想，不做迁移**：runtime-plugin 体系（loader + 能力契约 + conformance）已经是我们的"插件层"，缺的是认知面契约。

### 4.4 pi 生态的隐性地位

Kimi Code 的 TUI 建在 pi-tui 上；我们嵌入 pi-coding-agent。pi-mono 正在成为"别人家 agent 的底座"——这既是 pi 路线的生态验证，也提示单维护者风险（路线 B 的对冲因素）。

## 5. 判断与路线

**要重构，但外科手术式：只动认知面的宿主位置，不动编排契约与 gateway 位置。**

### 5.1 路线选择

- **路线 A（跟随 opencode v2，插件薄适配）**：gateway 保持 harness，插件缩为 ~300-500 行 typed 薄适配器，全面使用 v2 client/Service/hooks。成本：v1→v2 是真迁移（adapter、sidecar、事件 normalize、插件全重写）；风险：v2 年轻（2.0.6）、Windows 包管理缺失、后续仍可能有破坏性变更。
- **路线 B（pi 优先）**：认知面全部做成 gateway 内的 pi extension（SDK 形态，DX 最好，代码全自有）。成本：pi 能力缺口（无 diff/question/worktree/turnBudget API）；风险：单维护者生态。
- **路线 C（dsh 式微内核）**：不推荐——组合性不是我们的痛点。

**建议组合拳（A/B 对冲）**：P0+P2 必做，P1 spike 后定 A 的深度。

### 5.2 优先级

- **P0（立即，v1 上止血）**：① 删 ~800 行死代码（8 个桩 hook、HookManager 空转、state/status/config-loader legacy）② 修打包（files 加 `dist/`、补入口字段）③ 本地开发直连 `.opencode/plugins/`（v1 原生支持 TS 自动加载，绕开 tsc+同步）
- **P1（spike，1-2 天）**：opencode v2 原型——验证 context hook 的 recall 注入、tool.hook 观察捕获、mcp.transform 替代 self-wiring、`Service.ensure()` 替代手写 sidecar；产出迁移成本估算，决定路线 A 的排期
- **P2（pi 认知面补齐）**：一个 mafw-host extension（~300 行）接上四动词（observe/injectContext/injectSystem/ingestMedia）+ registerTool/registerCommand——既是路线 B 的保险，也是 HostAdapter 抽象的第二个实现点
- **P3（形式化）**：把认知面写进 runtime 契约（HostAdapter：observe / injectContext / injectSystem / ingestMedia / tools / commands），三宿主（v2 插件、pi extension、未来 Claude Agent SDK runtime）共享；v1 插件降级为兼容 shim

## 6. 引用

- opencode v2 docs: opencode.ai/v2/docs（/plugins、/build/plugins、/build/client）；v1: opencode.ai/docs/plugins
- Claude: code.claude.com/docs/en/agent-sdk、/hooks、/plugins
- Codex: github.com/openai/codex（sdk/typescript README）
- Kimi: github.com/MoonshotAI/kimi-code、moonshotai.github.io/kimi-code（kimi-cli 已归档）
- DeepSeek Harness: github.com/deepseek-ai/deepseek-harness、deepseek-harness.github.io/deepseek-harness/、Cordis arXiv:2608.25512
- philschmid: philschmid.de/agent-harness-2026（2026-01）、/superhuman-bash（2026-09）
- Anthropic《Agent Harness Design: 3 Patterns》(2026-04): claude.com/blog/harnessing-claudes-intelligence；动态工作流 (2026-06): claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code
- 本仓库现状盘点：2026-10-03 explore 代理报告（runtime/ ≈3,400 行 15 能力；插件 ~2,700 行含 ~800 死代码；pi extension 3 个 ~116 行）

## 7. 能力定界：runtime 与 gateway 怎么分家

### 7.1 业界的两种平衡与官方教义

光谱两端：
- **胖 core 派**（Claude Code、opencode v2）：机制持续下沉进 core——worktree（Claude 原生+hooks；opencode v2 可插拔策略）、agent teams/teammates、后台会话、org 政策（opencode v2 `opencode.config.policy` 插件不可禁用）、静态记忆文件制（CLAUDE.md / AGENTS.md / rules / references）。逻辑：消费级开箱即用。
- **瘦 core 派**（pi、Codex）：core 只管执行。pi = "一个会话的库"，全部编排/政策/认知归嵌入方；Codex CLI/SDK 极简（无 hooks/插件），harness 卖云（Codex cloud）。

**Anthropic 官方教义**（Agent Harness Design, 2026-04，三条模式）：
1. **Lean on the model**：用模型熟知的少数通用工具（bash + text editor）；skills、程序化工具调用、memory tool 全是它们的组合物
2. **Strip your harness down**："harness 编码的是模型做不到什么的假设，假设会过期"——每个模型代际重问 **"what can I stop doing?"**（例：为 Sonnet 4.5 加的 context reset 到 Opus 4.5 成了死重）。让模型自己编排（code execution：BrowseComp 45.3%→61.6%）、自己管上下文（skills 渐进披露）、自己持久化（compaction：Opus 4.6 达 84%；memory folder：60.4%→67.2%）
3. **Set boundaries carefully**：harness 只保留三类边界——①typed 工具=安全/UX/审计拦截点（"提升为工具"的决定本身要持续重估；auto-mode LLM 裁判反而能减少专用工具）②缓存经济学（static-first、system-reminder 追加、别中途换模型）③无可逆性判据

**编排权也在下放**：Claude Code 动态工作流（2026-06）——模型现场写自己的 harness（`agent()/parallel()/pipeline()`，isolation 可选 worktree/remote），六模式（classify-and-act / fan-out-and-synthesize / adversarial verification / generate-and-filter / tournament / loop-until-done）；Anthropic 自家的 Research/安全审查/Code Review 产品定位都是"core 之上的 harness"。官方还提示配 `/goal` `/loop` 用。

**记忆的业界位置**：无一家 core 内建动态记忆——Claude=CLAUDE.md+memory folder（文件制）、opencode=AGENTS.md/rules/references（文件制）、Codex=AGENTS.md；动态跨会话记忆全部在扩展生态（MCP memory 服务器是最大品类）。Anthropic 明确把"记忆依赖模型外检索设施"列为**待检验的假设**（教义 2 的"let Claude persist its own context"），但其替代物 compaction/memory folder 是**会话内/长任务内**持久化——跨会话、跨 runtime、跨项目的个人记忆没有被 core 吸收的迹象；其动态工作流的记忆用例（"挖最近 50 个会话的纠错 → 蒸馏成 CLAUDE.md 规则"）恰是 MAFW turnCompress/consolidation 管线的同构物（他们一次性工作流 vs 我们持续管线）。

### 7.2 定界五问

1. **生命周期**：无会话运行时还需要存在吗？（记忆/自动化/goal/轨迹）→ gateway
2. **一致性面**：需要跨客户端/跨 runtime 一致吗？（审批政策/预算/用量/事件口径）→ gateway
3. **机制 vs 政策**："怎么执行"优先 runtime 原生（能力门控回退），"做什么决定"归 gateway
4. **模型能力假设**（Anthropic 之问）：这段代码的存在是因为"模型做不到"吗？每个模型代际重测，过期即删
5. **谁选择**：认知注入优先"模型主动"（工具/渐进披露/指针）而非"harness 自动"（每轮塞内容）

### 7.3 MAFW 能力定界表（建议）

| 能力 | 定界 | 业界对齐/依据 | 动作 |
|---|---|---|---|
| 谐波记忆全系统 | **gateway** | 动态跨会话记忆=扩展生态领地（无一 core 内建）；风格须"模型自选"（已对齐：mafw_add_memory 主动写 / `<recall>` 指针+兑现=渐进披露同构 / sticky 极小常驻） | 保持，差异化核心 |
| recall/obs/guides 逻辑 | gateway 逻辑 + runtime 薄适配挂载 | 认知 hook=core 让渡的官方控制点（v2 已转正） | HostAdapter 化（§5 P3） |
| Goal 编排 | gateway，**向"边界提供者"演化** | 跨会话编排是 harness 领地；但动态工作流趋势=模型自己组合——goal 引擎长期应从"阶段状态机"退向预算/审批/结果记录的边界提供者，组合权还给模型 | 方向性（远期） |
| 审批 | 政策 gateway / 机制 runtime | 已正确分层（nativeApprovals 能力门）；Claude Code 亦分层（org policy>settings>session） | 修 pi autoApprove 旁路泄漏 |
| worktree | 机制 runtime / 政策 gateway（何时开/命名/清理联动） | v2 原生可插拔策略、Claude 原生+WorktreeCreate hooks | v1 保持自实现；v2 迁移时委托 |
| compaction | 机制 runtime / 触发 gateway | 已正确分层（compaction facet→turnCompress flush） | 不动 |
| BudgetGuard/用量/轨迹 | gateway | 观测+成本=harness 三边界之一；runtime 无原生预算 | 不动 |
| 自动化引擎 | gateway | 五问之 Q1 | 不动 |
| media/python/tts | gateway 域服务（loopback+工具面） | typed 工具=安全/审计边界（教义 3 同构） | 不动 |
| MCP 40 工具 | gateway 能力面 | 业界标准接缝 | 不动 |
| 事件归一化/SSE 广播 | gateway | Q2 多客户端单一事实源 | 不动 |
| 桌面/TUI/CLI 客户端 | **只连 gateway，不直连 runtime** | harness 单一视窗（对标 Agent SDK 应用/Managed Agents 形态） | 写成硬不变量 |
| 会话原始转录 | runtime 机制 | 各家 core 自带存储（opencode SQLite / pi SessionManager / Codex `~/.codex/sessions` / Claude `~/.claude/projects`）；Kimi 换代做迁移工具搬 `~/.kimi` 会话=历史归 runtime 的实证。gateway 只存三个派生层：t1 观察（脱敏，兼作 runtime 中立存档）/ TrajectoryStore 记账 / 谐波记忆蒸馏产物 | 不复制全文；v2 迁移时评估历史导出（opt-in） |
| 会话内 subagent 编排 | runtime | task 工具/动态工作流/agent teams；manager `task:deny`+goal 委派已强制分工 | 不动 |
| 静态规则（AGENTS.md/rules） | runtime | 文件制共识 | 不复制进记忆（已有"记指针"约定） |

### 7.4 两个平面、四条接缝

- **编排面**（gateway→runtime）：RuntimeClient 契约（session/prompt/event/approval/branch/completion）
- **认知面**（runtime→gateway）：HostAdapter 薄适配（observe / injectContext / injectSystem / ingestMedia + tools / commands）
- **能力面**（runtime→gateway）：MCP（40 工具）
- **客户端面**（clients→gateway）：HTTP + SSE

### 7.5 "可以停止做"清单（Anthropic 之问的应用）

已删（正确方向）：step-inject（2026-09-19，"已确认，无需行动"式噪音）、heuristic reranker（session 粒度零增益）、L1/L4/L5 检索层级、旧三条 manager-report 自动化——全是"harness 假设过期"的案例。

待重估（每代模型重测）：
- Goal 阶段状态机的硬编码度（对照动态工作流的模型自组合模式）
- boundary recall 注入量（已指针化；按 FOK/命中率数据持续收紧）
- BudgetGuard（若 runtime 出原生预算 API → 退化为纯记账）
- manager charter/state 文件协议 vs 直接给模型工作流原语
