# Agent Runtime 身份/系统提示词注入机制调研（Kimi Code / Zed / ZCode / dsh）

> 日期：2026-10-08
> 背景：为 MAFW 编排网关设计跨 runtime 的 agent 身份注入——网关以客户端/协议方式驱动 runtime 会话，会话需携带持久自定义身份（system prompt），compaction 免疫。
> 方法：全部结论来自官方文档 webfetch（code.kimi.com / kimi.com/code/docs、zed.dev/docs、agentclientprotocol.com、zcode.z.ai、github.com/zai-org/ZCode、deepseek.com/harness、deepseek-harness.github.io、github.com/deepseek-ai/deepseek-harness）。未查到处明确标注。

## 0. ACP 协议（横切层，适用于所有 ACP agent）

| 机制 | 层级 | 语义 | 编排网关可用性 | 来源 | 置信度 |
|---|---|---|---|---|---|
| `session/new` 参数 | wire | 仅 `cwd` + `mcpServers`（+能力协商后的 `additionalDirectories`）——**无任何 system prompt / 身份位** | 客户端不能注入身份 | https://agentclientprotocol.com/protocol/v1/session-setup | 高 |
| `session/prompt` 参数 | wire | `prompt: ContentBlock[]`（text/image/audio/resource/resource_link）——用户消息位 | 可作 per-turn 消息位注入（前缀块），非持久 system 位 | https://agentclientprotocol.com/protocol/v1/prompt-turn | 高 |
| Session Modes（v1） | wire | agent 自声明 `availableModes`（如 ask/architect/code），client 经 `session/set_mode` 选择；规范明言 "Modes often affect the system prompts used" | 值集由 agent 定义，client 只能选不能造 | https://agentclientprotocol.com/protocol/v1/session-modes | 高 |
| Session Config Options（v1 后期引入，v2 唯一） | wire | agent 自声明选项（`category`: mode/model/model_config/thought_level；select/boolean），client 经 `session/set_config_option` 设值 | 同上——身份类配置只能是 agent 预定义的枚举 | https://agentclientprotocol.com/protocol/v1/session-config-options | 高 |
| 权限 wire 形状 | wire | v1：`session/request_permission {toolCall, options:[{optionId,name,kind:allow_once\|allow_always\|reject_once\|reject_always}]}`，client 回 `{outcome, optionId}`；v2 重构为 `title`（必填）+ `description` + `subject`（tool_call/command 判别联合） | 网关可实现自动审批策略（allow_always/reject_always 语义现成） | https://agentclientprotocol.com/protocol/v1/session-modes（例）+ https://agentclientprotocol.com/protocol/v2/migration | 高 |
| 正规第三方注入通道（现状） | 规范 | **不存在** standardized system prompt 注入。扩展面 = `_meta`（任意自定义键）+ `_` 前缀自定义 JSON-RPC 方法 + capabilities `_meta` 广播自定义能力 | 双端私有扩展可用，但无互操作标准 | https://agentclientprotocol.com/protocol/v1/extensibility | 高 |
| 正规第三方注入通道（提案） | RFD | proxy-chains：conductor 编排 proxy 链（`proxy/initialize` / `proxy/successor`），proxy 可拦截/改写/前置消息、切 mode、经 MCP-over-ACP 供工具。**明确限制：proxies cannot directly modify an agent's system prompt — only switch between predefined session modes or prepend additional messages**。原型 sacp-conductor（Rust），未正式接受 | 未来通道；MAFW 类网关即天然 conductor 位置 | https://agentclientprotocol.com/rfds/proxy-chains | 高 |
| v2 相关变化 | 规范 | modes API 移除并入 configOptions；client `fs`/`terminal` 能力整体移除（改 MCP 供给）；prompt 生命周期改 `state_update` 通知。**v2 仍无 system prompt 位** | — | https://agentclientprotocol.com/protocol/v2/migration | 高 |
| compaction | RFD | session-compaction 仅为 RFD；协议层面压缩是 agent 内部行为，client 无感知/控制通道 | 注入物的压缩免疫只能在 agent 侧保证 | https://agentclientprotocol.com/llms.txt（RFD 列表） | 中（RFD 未细读） |

## 1. Kimi Code（Moonshot，code.kimi.com / kimi.com/code/docs）

产品矩阵：Desktop + CLI（Node.js 重写版）+ VS Code 扩展 + API（OpenAI/Anthropic 兼容端点，供 Claude Code/OpenCode/Codex 等第三方工具消费）。CLI 是身份机制最全的一层。

| 机制 | 层级 | 语义 | 编排网关可用性 | 来源 | 置信度 |
|---|---|---|---|---|---|
| **Custom Agent 文件**（`.md` + YAML frontmatter：name/description/whenToUse/override/tools/disallowedTools/subagents；**body 即 system prompt**） | 磁盘文件（作用域：`--agent-file` 显式 > 项目 `.kimi-code/agents/`、`.agents/agents/` > `extra_agent_dirs`（config.toml）> 用户 `~/.kimi-code/agents/`、`~/.agents/agents/` > 插件 > 内置） | **替换**（body 不含 `${base_prompt}`）或**包装**（含 `${base_prompt}` 时嵌入默认提示词）；模板变量 `${agents_md}`/`${skills}`/`${plugin_sections}`/`${cwd}`/`${os}`/`${shell}`/`${now}` 每次构建时插值 | **可用**：网关把身份写为 agent 文件 → `kimi --agent <name>` / `kimi -p --agent-file <path>` 驱动；系统提示词每次 prompt 构建重渲染 → **compaction 免疫** | https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents.html | 高 |
| `--agent <name>` / `--agent-file <path>` 旗标 | 进程启动（TUI + print 模式） | 会话身份在创建时绑定，resume 自动恢复绑定，**不可中途切换**；`--session`/`--continue` 互斥 | **可用**：一次性会话 = `kimi -p --agent x` | https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html | 高 |
| **SYSTEM.md**（`$KIMI_CODE_HOME/SYSTEM.md`） | 用户级文件 | **替换**默认主 agent 的 system prompt（仅 prompt；description/工具/委派白名单继承内置默认）；支持同套模板变量 | **可用**：`KIMI_CODE_HOME` 环境变量重定位数据根 → 网关可完全隔离一套身份 | 同 agents.html | 高 |
| `[identity]` config 表（name/slug；env `KIMI_CODE_IDENTITY_NAME`/`KIMI_CODE_IDENTITY_SLUG`） | config.toml / 环境变量 | **替换身份名槽位** `${product_name}`（出现在 system prompt、SYSTEM.md、agent 文件中）；slug 进 User-Agent/MCP client name；进程启动时解析一次，会话期不可变 | **可用**：容器/CI 场景官方推荐的 env 注入 | https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/config-files.html | 高 |
| AGENTS.md 指令文件 | 磁盘（全局 `~/.kimi-code/AGENTS.md`、跨工具 `~/.agents/AGENTS.md`、项目 `.kimi-code/AGENTS.md`/`AGENTS.md`） | **追加**（"injected into the prompt as reference data"——文档刻意区分：override 文件*就是* system prompt，AGENTS.md 是参考数据）；经 `${agents_md}` 进 system 位 → 压缩免疫 | **可用**（写文件） | 同 agents.html | 高 |
| **Server API**（`kimi web`：REST `/api/v1`+`/api/v2` + WS `/api/v1/ws`；默认 127.0.0.1:58627，bearer token，`/openapi.json`+`/asyncapi.json`） | HTTP/WS | 会话 CRUD、prompts、fork/compact/undo/abort/btw/archive/restore、WS 事件流。`POST /api/v1/sessions/{id}/profile` 的 `agent_config` **生效字段**：model/thinking/permission_mode/plan_mode/swarm_mode/goal_objective/goal_control；**schema 接受 `system_prompt`/`tools`/`mcp_servers` 但当前不应用**（占位） | **核心驱动通道**；但身份仍须落磁盘（agent 文件/SYSTEM.md），API 只管会话驱动；experimental 稳定性警告 | https://www.kimi.com/code/docs/en/kimi-code-cli/reference/server-api.html | 高 |
| `kimi acp`（ACP 模式，**无旗标**） | wire（stdio JSON-RPC） | core 3/3 + session 11/11 + `session/set_model` 扩展；`session/new` 返回 configOptions+modes（model/thinking/mode）；**无 agent/身份选择入口** | 走 ACP 时身份只能靠磁盘文件（进程级 SYSTEM.md / 已发现的 agent 文件） | https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html | 高 |
| Agent Skills（`SKILL.md` + frontmatter：name/description/type:prompt\|inline\|flow/whenToUse/disableModelInvocation/arguments；目录形/平铺形） | 磁盘（Project > User > Extra > Built-in） | **消息位/按需注入**（`/skill:<name>` 手动或模型按 description/whenToUse 自动调用；`$ARGUMENTS`/`$0`/`${KIMI_SKILL_DIR}` 展开；3 层嵌套上限） | 可用（写文件 + prompt 里引导调用） | https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html | 高 |
| Hooks（`[[hooks]]`：event/matcher/command/timeout；18 事件） | config.toml + 本地脚本（stdin JSON / stdout JSON / exit code 0=allow 2=block） | **消息位追加 + 拦截**：UserPromptSubmit（返回文本追加进上下文、可 block）、PreToolUse（deny/allow/换输入）、Stop（追加反馈续跑）、SessionStart、PostToolUse、PreCompact/PostCompact（观察）等；fail-open | 可用（写 config）——适合网关做每 turn 上下文补充 | https://www.kimi.com/code/docs/en/kimi-code-cli/customization/hooks.html | 高 |
| Plugins（可打包 agents/skills/themes/MCP） | 磁盘 | 复合分发载体（manifest `agents` 字段声明 agent 目录） | 可用 | https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html | 中（未细查） |

## 2. Zed（编辑器 agent）

Zed 在本问题中是 **ACP 客户端**（驱动方），不是可被网关驱动的 runtime；其 agent 配置面如下：

| 机制 | 层级 | 语义 | 编排网关可用性 | 来源 | 置信度 |
|---|---|---|---|---|---|
| Agent Profiles（settings.json `agent.profiles`：name/tools/enable_all_context_servers/context_servers/default_model；内置 Write/Ask/Minimal） | settings.json | 工具/模型选择——**无 system prompt 字段** | 不适用（Zed 是客户端） | https://zed.dev/docs/ai/agent-profiles | 高 |
| Instructions（个人 `~/.config/zed/AGENTS.md`；项目取 `.rules`/`.cursorrules`/`.windsurfrules`/`.clinerules`/`.github/copilot-instructions.md`/`AGENT.md`/`AGENTS.md`/`CLAUDE.md`/`GEMINI.md` **首个命中**） | 磁盘 | **追加**（always-on 上下文；项目覆盖个人） | 不适用（作用于 Zed Agent 本体） | https://zed.dev/docs/ai/instructions | 高 |
| OpenAI-compatible 自定义 provider（`language_models.openai_compatible.<id>`：api_url/available_models/capabilities{tools,images,parallel_tool_calls,prompt_cache_key,chat_completions,interleaved_reasoning,max_tokens_parameter}/custom_headers/reasoning_effort） | settings.json | **无 system prompt 覆盖位**——Zed Agent 的 system prompt 由 Zed 控制（docs 明言评分用于改进 "Zed's system prompt"） | **不可用**：文档化配置面不存在该能力 | https://zed.dev/docs/ai/use-api-access | 高（否定性结论，基于完整文档） |
| External Agents（`agent_servers {type:custom, command, args, env}`；ACP Registry 安装） | settings.json | 仅声明 agent 进程；"Native agent skills/instructions: Depends on the agent"——身份配置归 agent 本体；Zed profiles/skills 不外溢 | 反向：MAFW 若想被 Zed 用户使用，需实现 ACP agent 侧 | https://zed.dev/docs/ai/external-agents | 高 |
| `agents.toml` | — | **不存在此文件**（Zed 配置全在 settings.json 的 agent 段） | — | https://zed.dev/docs/llms.txt（全索引无此项） | 高（否定性） |
| Skills（.md 按需加载，`@` 引用） | 磁盘 | 消息位/按需 | 不适用 | https://zed.dev/docs/ai/skills.md | 中（未细读） |
| compaction（auto_compact + `/compact`；New From Summary） | 内部 | Zed Agent 自动压缩 | instructions 每轮注入（"always-on"）→ 免疫（推断） | https://zed.dev/docs/ai/agent-panel | 中 |

## 3. ZCode 查证（智谱 Z.ai）

**存在性：确认。** ZCode 是智谱 Z.ai 的官方 coding agent harness / Agentic Development Environment（ADE），GLM-5.3 官方调优载体。产品站 zcode.z.ai，开源仓库 github.com/zai-org/ZCode（Apache-2.0，7.5k stars，2026-09 开源，v3.14.x），形态 = Electron 桌面 + Web + TUI + Agent CLI（apps/zcode-cli，`zcode` 命令统一入口：无参 TUI / `--web` Web / 其余参数交 Agent CLI）。

| 机制 | 层级 | 语义 | 编排网关可用性 | 来源 | 置信度 |
|---|---|---|---|---|---|
| AGENTS.md（用户全局 `~/.zcode/AGENTS.md` + workspace `AGENTS.md`，两源**拼接**：全局先、workspace 后；启动任务时读取；`CLAUDE.md` 仅 onboarding 一次性迁移；不扫子目录/不支持 @import） | 磁盘 | **追加**（项目指令注入；主 Agent 唯一的长效指令通道） | 可用（写文件）；压缩后是否重注入**未查到** | https://zcode.z.ai/cn/docs/agents | 高 |
| **自定义子智能体**（Beta：设置页创建 → 写 `~/.zcode/agents/<name>.md`；frontmatter：name/description/model（inherit\|具体）/thoughtLevel/color/tools/disallowedTools/maxTurns/**injectAgentsMd**/mcpServers；**正文即系统提示词**；仅用户级；修改后需新建会话生效；不可嵌套委派） | 磁盘（用户级） | **替换**（该 subagent 的 system prompt）；主 Agent 经 Agent 工具自动选用或 `@` 引用 | 可用（写文件）；但只影响 subagent——**主 Agent 无自定义 system prompt 机制** | https://zcode.z.ai/cn/docs/subagents | 高 |
| Hooks（`~/.zcode/cli/config.json` `hooks.events`：SessionStart/UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/PostToolUseFailure/Stop；process 型，stdin JSON/stdout JSON/exit 2=block） | config | **消息位追加**（SessionStart/UserPromptSubmit/PostToolUse/Stop 可 `additionalContext`）+ 拦截 | 可用（CLI 侧） | https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/README.md | 高 |
| Plugins（`.zcode-plugin/plugin.json`：skills/commands/mcpServers/userConfig；`${ZCODE_PLUGIN_ROOT}` 等变量；官方 marketplace） | 磁盘 | 复合载体（skills=SKILL.md、commands=markdown 命令、MCP） | 可用 | 同上 | 高 |
| 执行模式（变更前确认/自动编辑/计划模式/完全访问）+ 推理强度（低/高/最高） | UI/会话 | 权限与推理档位（类比 ACP mode/thought_level） | 未见 wire/API 面 | https://zcode.z.ai/cn/docs/agents | 高 |
| 项目记忆 Memory（agent 自动积累，本机存储，默认关） | 内部 | 自动上下文 | 不可控（暂无查看/清除入口） | 同上 | 高 |
| 第三方程序化驱动 | — | `zcode --web` 起本地服务（`ZCODE_SERVER_AUTH_TOKEN` 配 API/WS 认证）但 **REST 契约未公开文档化**；Remote Control（手机扫码）/Bot Channel（飞书/微信）是面向人的通道；Agent CLI 的 headless/print 参数面未在本次确认 | **未查到**文档化驱动契约 | https://github.com/zai-org/ZCode（README） | 低（存在 server，契约不明） |

## 4. dsh（DeepSeek Harness，developer preview）

架构：Cordis "一切皆插件"；运行时 = profile（web/headless/sdk/sdk-minimal/**acp**）× bundle × patch（`cordis.patch.yml`：profile 级 + home 级 + `--patch` overlay，按 id 定位替换或插入）。注：用户先前线索中的 "kits" 术语在当前文档已不见——现为 bundle/profile/patch。

| 机制 | 层级 | 语义 | 编排网关可用性 | 来源 | 置信度 |
|---|---|---|---|---|---|
| **system-prompt 插件配置**（`@deepseek-ai/dsh-system-prompt` config）：`includeHarnessIdentity`（默认 true，order -1000 "You are an AI agent powered by DeepSeek Harness."）/ `includeRuntimeContext` / **`personaPrefix`**（order 0，第一方指导之前，含模型名介绍）/ **`personaSuffix`**（order 10200，含环境信息后缀）/ `toolOrder` | profile patch（YAML） | **追加**（persona 前后缀包裹第一方指导）；`includeHarnessIdentity:false` 可去掉固定开场白；官方明言"部署方编写的提示词文本只来自配置/组合，**不存在终端用户提示词编辑 API**" | **可用**：网关生成 patch 文件 + `--patch` 或写 home patch；进程级（acp profile 禁 HMR，改配置需重启） | https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/system-prompt/README.zh.md | 高 |
| **PromptSection 注册**（`ctx.systemPrompt.section({name, order, text\|provider, interpolate, complete})`） | 插件 API | `complete: true` 段 = **替换**整 prompt（有效 complete 段 >1 时组装失败）；普通段按 order 拼接 | 可用（需写插件包） | https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/system-prompt | 高 |
| 作用域遮蔽（`agent.ctx` 注册 agent-scoped section/variable/tool provider 遮蔽同名全局） | 插件 API | **per-agent 身份**（"让某个会话拥有不同的能力集合 → 组装一个 agent preset"） | 可用（插件内按 agent 切换 persona） | 同上 + 架构页 | 高（机制存在）/ 中（preset 细节未展开） |
| **PromptContext**（`ctx.systemPrompt.context`：动态运行时上下文） | 插件 API | **user-role 持久快照**（消息位，带来源）；agent loop 在快照变化或被 compaction 移除时**重新记录** → 抗压缩 | 可用——MAFW recall 注入的对位机制 | 同 system-prompt 子系统页 | 高 |
| **acp profile**（`dsh --profile acp` = dsh-acp-app bundle：纯自动化 ACP stdio server） | wire（stdio） | 内置 persona："You are a coding agent powered by the {{model}} model." + "Your working directory is {{cwd}}."；client 可选 `model`/`reasoning_effort` config options；支持 session/list/resume/close；**不增加私有方法/能力/_meta**；persona 可经 patch 完全替换 | **可用**：网关作 ACP client 驱动；身份经 profile patch（进程级） | https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/acp-app/README.zh.md | 高 |
| **Python SDK**（`DeepSeekHarness(provider, model, max_tokens, cwd, dsh_home, profile, patches=(...))` + `run(prompt, session_id)`） | SDK（JSON-RPC over `dsh --profile sdk`） | sdk-minimal profile 的系统提示词 = env **`DSH_SYSTEM_PROMPT`**（默认 "You are a helpful software engineer assistant."）→ **替换位**；minimal 无 compaction/无 runtime context/`danger-full-access` | **可用**：第三方驱动的正道之一 | https://deepseek-harness.github.io/deepseek-harness/guide/python-sdk | 高 |
| compaction 语义 | seam（`ctx.compaction`，后端可换：dsh-compaction-basic 等） | 摘要以 `user/message` + `surfaceOp: replace` 落地（唯一 surface 变更）；**系统提示词 = 派生 history 的 system surface 节点（第 0 号），每步组装重派生、变化时原地替换**（或 `systemPromptUpdate:'in-history'` 时追加到缓存历史后） | persona 配置压缩免疫（派生物）；PromptContext 被压缩移除后重记录 | https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/compaction + system-prompt | 高 |

## 5. Claude（Code CLI + Agent SDK，官方文档实证）

| 机制 | 层级 | 语义 | 编排网关可用性 | 置信度 |
|---|---|---|---|---|
| **Agent SDK `systemPrompt`**（query 选项） | per-query | **替换**（默认 minimal）或 preset+`append` 追加；**session 级快照**非 per-turn | 可用（SDK 驱动一等公民） | 高 |
| **Agent SDK `options.agents`**（程序化 AgentDefinition，15 字段：description/prompt/tools/model/permissionMode/skills/memory/mcpServers/maxTurns/effort…） | per-query | 动态工厂（官方推荐）；**主 agent 也可这样定义**（`options.agent` 选为主线程，prompt 替换默认 system prompt） | 可用 | 高 |
| CLI `--append-system-prompt` / `--system-prompt` | 旗标 | 追加/替换；**compaction 免疫**（system prompt 不入压缩历史，compact 后按旗标重建——官方文档明确） | 可用（进程级） | 高 |
| Output Styles（settings.json `outputStyle` 键 + 样式文件） | 配置 | 替换"Claude Code 给 Claude 的内置工程指令段" | 可用（弱于旗标，改的是内置段） | 高 |
| `.claude/agents/*.md` subagents | 磁盘 | frontmatter（name/description/tools/model）+ body=system prompt | 可用（subagent 维度） | 高 |
| **Hooks**：**无任何 hook 能改 system prompt**；`UserPromptSubmit`→`additionalContext`（消息位）；`SessionStart` 含 `compact` matcher（压缩后重注入 hook 上下文） | hook | 消息位追加 | 消息位兜底可用 | 高 |
| 官方推荐口径 | — | SDK 用 `systemPrompt`+`agents`/`agent`；CLI 用 `--append-system-prompt`；脚本场景 `--bare` | — | 高 |

## 6. Codex（CLI + SDK，源码实证 2026-10-08；developers.openai.com 反爬 403）

**前提修正**：①"Codex 无 agent 概念"已过时——main 分支存在完整多 agent 系统（`codex-rs/agent-roles` crate + config `[agents.<name>]` + `agents/` 目录 TOML + `spawn_agent/send_message` 协作工具）；②npm `@openai/codex-sdk` 实为每 turn spawn `codex exec --experimental-json` 进程（JSONL stdio，续 turn 用 resume）；app-server JSON-RPC v2 是另一条面（IDE 用），**该面有 per-thread 指令参数**。

| 机制 | 层级 | 语义 | compaction 免疫 | 置信度 |
|---|---|---|---|---|
| `instructions`（config.toml，全局/项目/层叠） | config | **整替**内置 base instructions | ✅（strip+重建注入，resume/fork 继承） | 高 |
| **`developer_instructions`**（config / `-c` 覆盖） | config | **追加**为独立 developer 角色消息 | ✅（同上） | 高 |
| `model_instructions_file`（路径） | config | 文件版整替（官方 STRONGLY DISCOURAGED） | ✅ | 高 |
| AGENTS.md（全局 > thread > 项目根→cwd 拼接） | 磁盘 | **user 角色消息位**（`<INSTRUCTIONS>` 包裹） | ✅（strip+重建；未信任项目只保留全局段） | 高 |
| profiles：v1 `[profiles.*]`（无 instructions 键）；**v2 `--profile` = 整层 config 文件** `$CODEX_HOME/<name>.config.toml`（可含任意键） | config | 组合档 | ✅ | 高 |
| **TS SDK**：`ThreadOptions` 无指令字段；`new Codex({config, configOverrides})` 为 client 级 → **每身份一个 Codex 实例**实现 per-thread 身份；exec 路径 config/`-c` 是唯一通道 | SDK | per-instance | ✅ | 高 |
| **app-server v2 JSON-RPC**：`thread/start/resume/fork` 直接收 **`base_instructions` / `developer_instructions` / `config`（任意键） / `permissions`**；`turn/start` 实验性 `additionalContext`（1000 token 截断，**非压缩免疫**） | wire | **per-thread 一等指令通道** | instructions ✅ / additionalContext ✗ | 高 |
| CLI 旗标 | — | **无** `--system-prompt`/`--instructions` 类旗标；唯一 `-c key=value` / `--profile` | — | 高 |
| compaction 机制 | 架构 | 压缩前剥掉 canonical context 只送摘要，压缩后 `build_initial_context_with_world_state` 从当前 config/磁盘**重建插回**——所有指令键免疫且外置变更会传播 | — | 高 |

## 7. opencode / pi（本地实证，最高置信）

| 机制 | 层级 | 语义 | compaction 免疫 |
|---|---|---|---|
| opencode agent 文件（`~/.config/opencode/agent/*.md` frontmatter：description/mode/model/permissions/tools；body=system） | 磁盘 | 替换（mode: primary 时整替默认 agent） | ✅（agent system 不入压缩历史） |
| opencode per-prompt `system` 参数（适配器 `opencode-adapter.ts:94` 直传 SDK） | per-query | append/replace 语义**未验证**（实现期确认） | ✅（若 per-turn 生效） |
| opencode 插件 `experimental.chat.system.transform` | hook（每次 LLM 调用） | 追加 system 块（memory-guide/pinned 现役通道） | ✅（每轮重组） |
| pi `~/.pi/agent/prompts/*.md` + 权限 extension（`pi-agent-config.ts`） | 磁盘 | 替换 | ✅ |
| pi `before_agent_start` extension 钩子 | hook（会话启动） | system prompt 链式改写（mafw-host 现役） | ✅ |
| pi `session.hook("context")` | hook（每次模型派发，含工具续跑） | `event.system.push` / messages / options 全改 | ✅ |

## 8. 综合：对 MAFW 身份层的设计含义

1. **身份注入的业界事实标准 = 物化（materialization）+ 创建时绑定**，无一例外走消息位做持久身份：
   - 物化目标形态 A（多数派）：**磁盘 Markdown + frontmatter，body = system prompt**——Kimi agents/*.md、ZCode ~/.zcode/agents/*.md、opencode agent/*.md、pi prompts/*.md、Claude .claude/agents/*.md（CLI）/SDK per-query agents（程序化等价物）
   - 物化目标形态 B：**config 指令键/补丁**——Codex `developer_instructions`（追加 developer 位）/app-server v2 per-thread 指令、dsh personaPrefix/Suffix patch、Kimi SYSTEM.md
   - 绑定机制：`--agent`/agent 参数（opencode/Kimi/ZCode/Claude SDK `options.agent`）、per-identity 实例（Codex TS SDK）、per-thread 参数（Codex app-server v2）
2. **compaction 免疫普遍由 runtime 自己保证**（strip+rebuild：Codex；每次构建重渲染：Kimi；每步组装重派生：dsh；旗标重建：Claude CLI；SessionStart compact matcher：Claude hooks）——MAFW 无需自建重注入机制，选对通道即免疫。
3. **消息位（hooks additionalContext / ACP prompt 前缀）是各家一致的"追加上下文"位，不是身份位**；ACP 协议 v1/v2 永无 system 位（proxy-chains RFD 也明言不能改 system prompt）。
4. **驱动通道与身份通道解耦**：Kimi = Server API 驱动 + 身份落盘（API 的 `system_prompt` 是占位不生效）；dsh = acp profile 驱动 + persona patch；Codex = TS SDK（per-identity 实例）或 app-server v2（per-thread 指令一等）；Claude = Agent SDK（systemPrompt+agents per-query 一等）。
5. **Zed 不是可驱动 runtime（ACP 客户端）**；zcode = 智谱 Z.ai ZCode——主 Agent 无自定义 system 机制（仅 subagent + AGENTS.md 追加），且第三方驱动契约未公开。
6. **对 MAFW 的落地**：车道 1（物化+绑定）应从"优化通道"升为**默认/主通道**（业界同构，compaction 免疫由 runtime 承担）；injectSystem 宿主扩展降为**兜底车道 2**（无物化通道的 runtime）；消息位追加为车道 3（最弱，声明式）。`agents.install` 契约动词保留，语义扩展为"物化"——各 runtime 插件实现各自格式。
