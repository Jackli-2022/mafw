# 工具名 canonical 翻译层调研（gateway↔runtime 名字归一）

> 日期：2026-10-20。背景：v4.30 注册链 + 显示链（两帧合成）已闭环，但渲染层按**字面名精确匹配**——runtime 工具名与 opencode 命名不一致（`Bash`/`command_execution`/`ls`/`find`）时落到通用兜底卡；用户提出「历史展示也要翻译」「gateway 与 runtime 之间需要一层翻译层」。本文为该翻译层立项提供依据。
> 标注：[实证] = 当日实读；[实证-既有] = 引用本仓库既有调研未重验；[知识] = 未当日核实。

## 0. 一句话结论

**name→name 别名在业界无先例**——业界的"翻译层"是 codex 式**边界投影为语义类型**（ThreadItem：名字维度在 wire 上不存在）或 ACP/dsh 式 kind 类别 + 名字 opaque。MAFW 的正确形态是**混合两级**：`toolClass`（已有，粗粒度保底）+ **canonical 别名**（细粒度精确复用卡片，仅对形状兼容对子开放）+ **消费侧多 key 形状链**（解决 path/filePath/file_path 分歧，`commandTextOf` 既有先例）。翻译住 **gateway 双出口**（live enrich + 历史路由出口 enrich，additive 字段），不改写原名。

## 1. 业界翻译层先例

| 平台 | 跨名工具的翻译机制 | 粒度 |
|---|---|---|
| **codex** | **边界投影**：wire 的 function_call 经 app-server `event_mapping.rs` + item 构造器投影为 ThreadItem **类型**（command_execution/file_change/mcp_tool_call…）——名字维度在对外协议上不存在，渲染按类型 + 类型化 payload schema | 类型（最强） |
| **ACP** | `kind` 10 值（read/edit/delete/move/search/execute/think/fetch/switch_mode/other）；名字 opaque，client 渲染 generic by kind | 类别 |
| **dsh** | `ToolCallKind` 8 值，同构 | 类别 |
| **Claude 系 hosts** | 自家名精确（Read/Bash…）+ MCP 工具一律 generic（`mcp__server__tool` 名无归一） | 无翻译 |
| **opencode / pi** | 自家名精确 + generic 兜底；pi 工具自渲染（renderCall/renderResult） | 无翻译 |

**判定**：没有任何一家做 name→name alias。原因：要么协议层就消灭名字维度（codex），要么接受 generic（其余）。MAFW 的特殊约束是**渲染资产（30 家族卡 + session-ui 内建卡）按 opencode 名键控**——复用这些资产的唯一路径就是 canonical 别名，这属于合理自创，但**别名的准入必须带形状兼容检查**（§3）。

## 2. 自家消费面全景（当日实读）

### 2.1 名字消费点清单

| 消费点 | 位置（file:line） | 键 | 现状 |
|---|---|---|---|
| live 卡片查找 | session-ui `ToolRegistry.render`（message-part.tsx:1564 exact；:1641 `?? GenericTool`） | `part.tool` | miss→通用卡 |
| 内建卡/信息 | `getToolInfo` switch（:482-551，read/list/glob/grep/webfetch/websearch/task/bash/edit/write）+ `contextToolTrigger`（:890） | 名字 switch | miss→默认 |
| 上下文折叠组 | `CONTEXT_GROUP_TOOLS.has(part.tool)`（:863） | 名字集合 | miss→不折叠 |
| 步骤摘要计数 | `part.tool === "read"` 等（:934-936） | 名字 | miss→计数零 |
| 默认展开 | `toolDefaultOpen(part.tool,…)`（:746） | 名字 | miss→默认态 |
| desktop MAFW 卡 | tool-cards `registerAliased`（index.ts:16-31，TOOL_SPECS 30 家族 + `mafw_` 前缀别名） | 名字 + 前缀 | miss→GenericTool |
| TUI recap 聚合 | session-recap.ts:37 `p.toolName ?? 'tool'` 计数 | 原名 | 碎片化 |
| TUI 工具块 | blocks.ts ToolBlock | 原名 | 折叠/展开正常（内容 generic） |
| trajectory 统计 | collector.ts:202/213 `toolName: part.tool` | 原名 | 碎片化 |
| 审批/身份 | safety-classifier / identity-registry → `toolClassOf` | **类别** | **已解决**（10-13） |
| obs/T1 | `[toolName]` 原名入观察 | 原名 | **不译**（溯源语义） |

### 2.2 别名对形状兼容矩阵（当日实读各平台工具 schema）

| 别名对 | input 键对照 | 兼容判定 |
|---|---|---|
| pi `bash`→`bash` | pi bash.js:30 `command` = opencode 卡读 `input.command`（:540） | ✓ 完全 |
| Claude `Bash`/`PowerShell`、v2 `shell`、codex `command_execution` → `bash` | `command` 键全系收敛（command_execution 的 exit_code/output 在 item 级，assembler/映射到 state.output 可解） | ✓（输出侧需映射） |
| pi `ls`→`list` | pi ls.js:11 `path` = 卡读 `input.path`（:499） | ✓ |
| pi `find`→`glob` | pi find.js:20/23 `pattern`+`path` = glob 卡读 `pattern`+`path`（:906-911） | ✓ |
| pi `grep`→`grep` | `pattern`+`path` = 卡读 `pattern`（:511） | ✓ |
| pi `read`→`read` | **pi read.js:17 `path` vs 卡读 `input.filePath`（:493）** | ✗ 键分歧 |
| Claude `Read`→`read` | **`file_path`（snake_case）** | ✗ 键分歧 |
| codex `file_change`→`edit`、`collab_tool_call`→`task` | 输出侧形状（patch/结构）差异大 | 部分（卡片降级可接受） |

**结论**：shell/search 域 input 键高度收敛（command/path/pattern 系）——alias 即可完整复用卡片；**read 域三套键**（`filePath`/`path`/`file_path`）——alias 之外还需消费侧**多 key 候选链**（`input.filePath ?? input.path ?? input.file_path`，`commandTextOf` 的 firstTruthy 既有先例，10-13 spec D4 已为 toolCommand facet 做过同型改造）。

### 2.3 历史路径（用户核心关切）

- `wrapRuntimeMessages`（normalize-messages.ts:21-34）**只包装声明了 `normalizeMessages` 的 runtime**（pi）；opencode 不包（历史本就是 opencode 形状）——历史 parts **不经过任何 enrich**（canonical/toolClass 都缺）
- 历史出口有三类消费者：desktop `loadSessionHistory`、TUI `historyItemsToTurns`、waitwhat/trajectory——全部经 gateway 的 session.messages 链路（`wrapRuntimeIdentity` 的 `wrapRuntimeMessages` 出口）[实证]
- **挂点判定**：历史 enrich 不能复用 wrapRuntimeMessages（opencode 不走）；应在 gateway messages 路由出口对**所有 runtime** 的历史 parts 统一补 `canonicalTool`/`toolClass` 两 additive 字段（幂等：已有不覆写）

## 3. 设计空间分析

### 3.1 粒度三选

| 方案 | 内容 | 判定 |
|---|---|---|
| A. 只 class | 渲染按 class 家族卡（shell 家族卡兜底全部 shell 类） | 零 alias 表但丢精确卡（bash 卡的命令流/退出码展示、glob 的 pattern 展示全无） |
| **B. class + canonical（推荐）** | 静态别名表 + runtime 声明 canonical + 消费侧多 key 形状链 | 精确卡复用 + 形状分歧在消费侧按既有模式解 |
| C. + per-alias keyMap | alias 表带 input 字段映射（codex 式类型化投影完全体） | 重；消费侧多 key 链已覆盖已知分歧，YAGNI |

### 3.2 翻译位置

- **gateway 双出口 + additive 字段**（推荐）：live = enrich 点（index.ts:1127 旁，与 toolClass 同点）；历史 = messages 路由出口（全 runtime）。`part.tool` 永不改写（审批卡/权限请求带原生名——改写即名实不符；obs 溯源保留原名）。
- 前端内置静态表：否决——runtime 声明（overlay）进不了前端包，双源漂移。
- 改写原名：否决（10-13 spec 已定 additive 模式；且 Claude Read 的 `file_path` 改成 `filePath` 会破坏与 runtime 侧的对账）。

### 3.3 数据源与准入

- **静态表**（gateway 单源）：10-13 §5 命名矩阵（今日重验 §2.2 形状）——`Bash/PowerShell/shell/command_execution→bash`、`ls→list`、`find→glob`、`file_change→edit`、`collab_tool_call→task`、`Read→read`…；**大小写归一顺带解决**（toLowerCase 后同名即 canonical，`Read→read` 属此类）
- **runtime 声明**（权威，覆盖自造名）：`NativeToolDeclaration` 增可选 `canonical?: string`，经既有 overlay 机制生效（v4.30 基建零新增）
- **准入规则**：形状兼容（经消费侧多 key 链验证）才进表；策展进表注明依据——防「别名了但卡片渲染错位」的隐性劣化

### 3.4 聚合键与边界

- TUI recap / trajectory 统计：`canonicalTool ?? tool`（collector 落库时解析，历史行回填不做）
- 不动面：审批/身份（类别层已覆盖）、obs/T1（原名溯源）、`part.tool` 本体

## 4. 结论

1. **推荐方案 B**：静态 canonical 表 + `NativeToolDeclaration.canonical` 声明 + gateway 双出口 enrich（`part.canonicalTool` additive）+ 渲染四级查找链（精确名 → canonical → class 家族 → generic）+ 消费侧多 key 形状链（read 域 `filePath ?? path ?? file_path`）
2. 历史 enrich 挂 messages 路由出口（全 runtime），与 live enrich 同一解析函数单源
3. 聚合键 `canonicalTool ?? tool`（TUI recap 一行 + collector 落库点）
4. 工作量预估：gateway 别名表/overlay 扩展/双出口 enrich ~120 行 + session-ui 查找链与多 key ~80 行 + 测试（gateway ~10 + desktop ~8）
5. 本设计不 reopen 10-13 spec 的 additive 决策，是其「渲染层 toolClass 消费迁移」非目标项的落地路径（canonical 是比 class 更细的同一 additive 谱系）
