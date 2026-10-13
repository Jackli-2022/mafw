# 工具语义类别层（toolClass）设计 spec

日期：2026-10-13 · 状态：实施中 · 前置调研：`docs/research/2026-10-13-tool-identity-layer-research.md`（工具层身份五层隐式契约 + 四 bug + 六平台参照）· 用户已批准方案 A

## 1. 目标与非目标

**目标**：
1. 工具名 → 语义类别收敛为 **gateway 单一事实源**（`runtime/tool-classes.ts` 并集表），吃掉五层隐式契约中的审批层与身份层；
2. wire 上 tool part 获得 **additive 可选字段 `part.toolClass`**（gateway 单点 enrich），为 desktop/TUI 渲染层迁移铺路（对齐 ACP `ToolKind` / dsh `ToolCallKind` 业界形态）；
3. 修复调研发现的四个缺陷（read-only 漏 `list` / pi 缺 `find` 误 deny / `args.command` 形状巧合 / curator 白名单不可移植）。

**非目标**：desktop session-ui / TUI 渲染层的 toolClass 消费迁移（wire 字段就位后另行小步做）；`tools.install` 契约动词（方案 B，远期）；per-runtime 类别覆盖表。

## 2. 决策记录

| 决策点 | 结论 | 备选（否决理由） |
|---|---|---|
| D1 类别表结构 | **并集单表**（不按 runtime 分表）：名字空间跨平台几乎不冲突（`list`∈opencode、`ls`∈pi、`Read`∈claude、`command_execution`∈codex），缺省 `other` | per-runtime 分表（TOOL_CATEGORY_TABLES 现状——过度设计且已产生漏名 bug） |
| D2 类别词汇 | `readonly / file-edit / shell / search / subagent / web / plan / other` —— identity 中立类别 ⊇ + ACP kind 对齐（search/plan 补位） | ACP 10 值全集（switch_mode/delete/move 对 MAFW 消费面无意义，YAGNI） |
| D3 wire 形态 | `part.toolClass`（tool part 上 additive 可选字段，gateway 在 handleOpencodeEvent 单点 enrich，缺省不写 key） | gateway 侧只查不改 wire（desktop 无法单源消费）；独立 tool.classified 事件（噪声） |
| D4 形状兜底 | `commandTextOf` 加 key 候选链（`command ?? cmd ?? script ?? text`）；facet `toolCommand` 升多路径（对齐 approval.requestId 的 firstTruthy 模式） | 只修 opencode 形状（新 runtime 换 key 仍失明） |
| D5 curator 白名单 | 并集 `read/grep/glob/ls/list/find`（runtime 不认识的名字无副作用） | per-runtime 物化分表（物化层复杂化） |

## 3. 实施清单（TDD）

1. **`gateway/src/runtime/tool-classes.ts`**（新）：`TOOL_CLASS` 类型 + `TOOL_CLASS_TABLE`（opencode v1+v2 / pi / Claude PascalCase / codex 条目类型名并集）+ `toolClassOf(name)`（大小写敏感 + PascalCase 归一？→ 大小写不敏感匹配，`Read`/`read` 同类别）+ 测试。
2. **safety-classifier**：`READ_ONLY_TOOLS` 删除，`isReadOnlyTool` → `toolClassOf(name) === 'readonly'`（修 bug 1：`list` 归 readonly）；`commandTextOf` key 候选链（bug 3a）。
3. **identity-registry**：`TOOL_CATEGORY_TABLES` 双表删除，`resolveToolCategory` → 查并集表（修 bug 2：pi `find` 归 readonly；identity 类别词汇与 ToolClass 对齐映射）。
4. **canonical-facets**：`FacetRule.toolCommand: string | string[]`（firstTruthy；bug 3b）——规则改 `['$.part.state.input.command', '$.part.state.input.cmd', '$.part.state.input.script']`。
5. **memory-curator-agent**：白名单并集（bug 4）。
6. **index.ts 单点 enrich**：handleOpencodeEvent 在 facet 之后、collector 之前——`type === part.updated && props.part?.type === 'tool' && props.part.toolClass === undefined` 时 `props.part.toolClass = toolClassOf(props.part.tool)`（pi 路径 assembler 新建对象、opencode 路径 passProperties 深拷贝——改写安全无 aliasing）+ field-contract 提示更新。
7. **文档**：AGENTS.md 工具层段 + SKILL.md 3.1 契约表 toolClass 行。

## 4. 验收

- 全套件绿（gateway jest / desktop bun / TUI node --test）
- 新测试：toolClassOf 覆盖六平台名字样本；isReadOnlyTool('list')=true；resolveToolCategory('find', 'pi')='readonly'（manager 不再误 deny）；commandTextOf 多 key；facet toolCommand 多路径；enrich 后 part.toolClass 在 broadcast 载荷上可见（event-replay 断言）
