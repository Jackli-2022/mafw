# 工具层身份与注册接口调研（跨 runtime 的 tool identity）

日期：2026-10-13 · 方法：两路并行勘察（MAFW 工具层消费面盘点 / 六平台工具模型与注册接口）+ 既有调研基线复用（事件词汇 v2 调研、agent-event-models、tool-call-rendering、tool-part-compat 四文档）· 后续：本文为工具层归一立项的工料表

## 0. 问题与一句话结论

**问题**：不同 runtime 的 tool（read/write/agent 等）名字与形状各异——基础工具是不是有开放接口来注册对应事件？

**一句话结论**：
- **事件侧：已经是开放接口，无需 per-tool 注册**——工具事件走统一信封（`part.updated` + `part.type='tool'` 的 ToolPart 快照；runtime 侧只需产出三原语 `tool.call/delta/result` 或直接发 ToolPart），工具名是透传的 opaque 字符串。事件注册接口（eventMappings）随 v2 已强制接线。
- **工具身份侧：没有任何契约**——runtime contract（`contract.ts`）没有 tools 面（无 `tools.install`、无工具元数据声明）；工具名/形状的知识以**隐式契约**散落在五层消费点（审批名单/身份类别表/渲染 switch/物化代码/形状假设），换 runtime 即漂移。
- **业界对齐参照已经存在**：ACP `ToolKind`（10 值）与 dsh `ToolCallKind`（8 值）——「工具名保持自由 + 语义类别字段」正是这一层的标准解法；MAFW 的 identity-registry 已有同构中立类别（file-edit/shell/subagent/web/readonly），只是没接到工具事件面。

## 1. 事件侧现状（已统一，v2 产物）

```
pi: tool_call 事件 {toolName, toolCallId, input}
  → PI_EVENT_MAPPINGS → tool.call/result 三原语
  → ToolPartAssembler → part.updated（part.tool 原样）
opencode: ToolPart 自带 part.tool
  → OPENCODE_EVENT_MAPPINGS（passProperties 整段透传）→ part.updated
```

全链路**零改名、零归一、零分类**（`pi-events.ts:19,21`、assembler `:100/:106`、`pi-message-normalize.ts:42`）。唯一的名字变异是 runtime 自己的 MCP 前缀（opencode `mafw_mafw_*`、claude `mcp__server__tool`），发生在事件到达 gateway 之前——desktop 靠 `aliasKeys` 事后补救（只覆盖 opencode 形态）。

## 2. 契约缺口：runtime contract 没有工具面

`gateway/src/runtime/contract.ts:23-54` 的 `RuntimeCapabilities` 全部字段里零工具项；`RuntimeClient`（:211-299）有 `agents.install`（:295-298）但工具连影子都没有。**gateway 对「runtime 有哪些工具、叫什么、形状如何」完全盲**——所有工具知识硬编码在消费点。

## 3. 工具名/形状的五层隐式契约（消费点 × 脆弱性）

| 层 | 消费点 | 依赖 | 跨 runtime 脆弱性 |
|---|---|---|---|
| **审批** | `READ_ONLY_TOOLS`（safety-classifier.ts:12）= {read,grep,glob,ls,find} | 工具名 | **混用 opencode 名（read/grep/glob）与 pi 名（ls/find），漏 opencode 的 `list`**——read-only 档该工具落 human；claude PascalCase 整表 miss |
| **身份** | `TOOL_CATEGORY_TABLES`（identity-registry.ts:43-58，per-runtime 手工表） | 工具名+runtime 名 | **pi 表缺 `find` → manager 身份 allowlist 未列出 → 误 auto-deny（真 bug）**；未知 runtime 整表 miss → allowlist 语义反转为 deny |
| **渲染** | session-ui 14 张内置卡 + `getToolInfo` switch + `parts-rules`（CONTEXT_GROUP_TOOLS/HIDDEN_TOOLS）（message-part.tsx:488-576, parts-rules.ts:12-13）；desktop TOOL_SPECS 30 + `aliasKeys` MCP 双前缀（registered-tools.ts:34-36）；TUI blocks 的 `input.command ?? input.description` | 工具名 + input/output key | 换名 → GenericTool 兜底（可用但不分组不隐藏）；pi 的 `find/ls` 不折叠上下文组；第三方 MCP 前缀名无别名 |
| **物化** | pi 权限 extension 生成代码硬编码 `'edit'/'write'/'bash'`（pi-agent-config.ts:179,189）；conformance 断言 `p.tool==='bash'`；memory-curator 白名单含 pi 名 `ls` 不含 opencode `list`（跨 runtime 不可移植） | 工具名 | 同一 agent 定义在不同 runtime 放行的工具集不同 |
| **形状** | toolCommand facet `$.part.state.input.command`（canonical-facets.ts:44，自更新定位）；危险命令检测 `commandTextOf` 取 `args.command`（safety-classifier.ts:32-39）；media-speak 严格等值 `=== 'mafw_media_speak'`（chat-stream.ts:117） | input key | **opencode 与 pi 的 bash 都用 `command` 键纯属巧合无契约**——新 runtime 换 key：危险命令检测失明（fail-open 方向错误）+ 自更新定位静默退化 |

其它按名依赖：TrajectoryCollector 落 `tool_name` 字符串（无分类，TUI `/status` 按名计数）；管线 prompt 文本引用 `mafw_add_memory` 等（LLM 语义匹配兜底，较韧）。

## 4. 六平台工具注册接口汇总

| 平台 | 注册接口 | 命名规则 | schema |
|---|---|---|---|
| opencode v1 | 插件 `tool:` hook（src/plugin.ts:83-91，MAFW 六件套走此）+ MCP | 自由名 / `mafw_mafw_*` | zod / MCP JSON Schema |
| opencode v2 | `ctx.tool.transform` + MCP | **bash→shell、task→subagent（改名！）** | 同上 |
| pi | `pi.registerTool`（TypeBox，须同实例）+ `customTools`/`setActiveTools` | 自由名 | TypeBox |
| Claude | **MCP-only**（`tool()`/`createSdkMcpServer` → `mcp__{server}__{tool}`） | PascalCase 内建 + `mcp__server__tool` | Zod |
| codex | **仅 MCP + config**（无进程内注册 API） | **无工具名——工具=ThreadItem 类型**（command_execution/file_change/mcp_tool_call） | MCP |
| kimi | MCP + agent 文件 frontmatter `tools` + hooks 拦截（无注册表） | WS tool_name 自由串 | MCP |
| dsh | `ctx.tools.register`（Cordis）——**最完整**：ToolSchema + **必填 output schema 契约** + `restrict`/`guard` + `ToolCallKind` 8 值呈现分类 | 自由名（`run_code` 保留） | 自有 JSON Schema DSL |
| ACP | **无注册面**（工具在 agent 侧，client 只供 mcpServers） | `name` opaque 自由串 + **`kind` 10 值分类**（read/edit/delete/move/search/execute/think/fetch/switch_mode/other） | rawInput 任意 JSON |

**关键事实**：没有任何一家在协议层传递工具元数据（描述/类别/形状声明）；codex 是唯一「平台归类」模型（工具名维度不存在）；ACP/dsh 的 `kind` 是现成的语义分类参照（两家几乎同集）。

## 5. 基础工具命名分歧矩阵（语义 × 平台）

| 语义 | opencode v1 | opencode v2 | pi | Claude | codex |
|---|---|---|---|---|---|
| read | `read` | read | `read` | `Read` | —（经 shell） |
| write | `write` | write | `write` | `Write` | `file_change` |
| edit | `edit`/`apply_patch`/`multiedit` | edit | `edit` | `Edit` | `file_change` |
| bash | `bash` | **`shell`** | `bash` | `Bash`/`PowerShell` | `command_execution` |
| 搜索 | `grep`+`glob`+`list` | 同 | `grep`+`find`+`ls` | `Grep`/`Glob`（macOS/Linux 默认缺席→Bash 内嵌） | — |
| subagent | `task` | **`subagent`** | 无内建 | `Agent` | `collab_tool_call` |
| web | `webfetch`/`websearch` | 同 | 无内建 | `WebFetch`/`WebSearch` | `web_search` |
| todo | `todowrite` | 同 | 无内建 | `TodoWrite`（被 Task* 四件套取代） | `todo_list`/Plan |

分歧度排序：bash（1 改名）< read < edit < **搜索/glob（最大分歧区）** < subagent < todo。**opencode 自己 v1→v2 就改了两个名**（bash→shell、task→subagent）——跨版本都会破，何况跨平台。

## 6. 设计选项（工具层归一立项的三个方案）

**方案 A（推荐）：ToolClass 语义类别字段（对齐 ACP kind）**
- 词汇/载荷加 `part.toolClass`（或 tool part 的 `kind`）：readonly / file-edit / shell / search / subagent / web / plan / other——对齐 ACP ToolKind + 既有 identity 中立类别
- 来源：runtime 插件声明（loader extras 扩展 `toolClasses` 表：`'bash' → 'shell'`）或 gateway 中央单表（把 TOOL_CATEGORY_TABLES 收敛）；未知工具默认 `other`
- 消费者全改读 class：审批 read-only 档、渲染分组/隐藏、TUI recap 分类、轨迹按类统计；形状假设（commandTextOf/toolCommand）可加 per-class 的 key 候选链
- 改动面：中（一个字段 + 五层消费者改读 + 单表维护）；不破 wire（可选字段）

**方案 B：tools.install 契约动词（像 agents.install）**
- runtime 声明工具集（名字+schema+类别），gateway 持有注册表——gateway 主动知道工具集（UI/统计/校验）
- 重（契约 + 各 runtime 插件实现 + 维护）；增量价值主要是「未调用前的知识」，事件流已被动携带实际调用
- 适合远期（若要做工具维度的用量统计/白名单 UI）

**方案 C：最小修补（不建类别层）**
- 修四个 bug（见 §7）+ 把五层清单收敛到单一常量模块（如 `runtime/tool-classes.ts`）
- 不解决跨 runtime 可移植性，只止血

## 7. 调研副产品：四个立即可修的缺陷

1. **`READ_ONLY_TOOLS` 漏 opencode `list`**（safety-classifier.ts:12）——read-only 档 `list` 落 human；与 identity-registry.ts:49 的 `list: 'readonly'` 两套清单已漂移
2. **`TOOL_CATEGORY_TABLES.pi` 缺 `find`**（identity-registry.ts:51-57）——pi 上 manager 身份调 `find` → 类别 null → allowlist 未列出 → **误 auto-deny**
3. **危险命令检测依赖 `args.command` 形状巧合**（safety-classifier.ts:32-39）——新 runtime 换 key 则检测失明（fail-open 方向错误）
4. **memory-curator 白名单跨 runtime 不可移植**（memory-curator-agent.ts:15-18）——含 pi 名 `ls` 不含 opencode `list`

## 8. 与既有工作的衔接

- 事件词汇 v2（2026-10-12）已把事件面统一——工具事件的信封/管道无需再动
- identity spec 的中立类别（file-edit/shell/subagent/web/readonly）是方案 A 的现成词汇起点
- `2026-10-12-tool-call-result-model-compat.md` §5 把 tool 三原语列为词汇表缺口待评审——本次调研即该评审的工具身份面输入
- 方案 A 落地时顺手吃掉 §7 的四个 bug（清单收敛为单表即修复 1/2/4）
