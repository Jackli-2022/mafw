# 工具调用（tool call）渲染对标调研（2026-10-11）

> 目的：为 MAFW Desktop 工具卡「美化到各家原生工具程度」提供对标。
> 对象：Claude（Code/Desktop）、OpenAI Codex、pi（pi-coding-agent）、opencode desktop、dsh（DeepSeek Harness Desktop）、Kimi Code Desktop。
> 方法：**本地源码优先**——opencode 在 `packages/session-ui`、pi 在 `gateway/node_modules/@earendil-works/pi-coding-agent`；Claude/Codex/Kimi/dsh 取自本仓库既有调研（`2026-09-28-desktop-aesthetics-competitor-research.md`、`2026-09-28-turn-metadata-placement-research.md`）+ 已知交互模型。**注意：非官方截图二次取色，视觉数值为近似。**

## 一、逐家做法

### opencode desktop（在库参照，最完整）
- **壳**：`BasicTool`（collapsible）。结构化触发行：`[icon] 标题(base) · 文件名(regular) · 目录(muted, rtl 截断) · args "key=value"(muted) · 右侧 actions`。
- **右侧 action**：`edit`/`write` 显示 **DiffChanges `+N −N`**。
- **内容体**：
  - `data-component="tool-output"`：Markdown/`<pre>`，可滚动（`max-height:240px`），无边框；
  - `data-component="bash-output"`：**0.5px 边框 + 圆角 6px + hover 复制按钮 + mono 13px**；
  - `edit-content`/`write-content`：hairline 上边 + diff/code；带 **sticky 文件头**（`ToolFileAccordion`）+ diagnostics。
- **进行中**：`TextShimmer`（标题微光）。**重内容 `defer`**。
- 图标（`icon` prop）在 v1 壳**不渲染**（知识性遗留）。
- 来源：`packages/session-ui/src/components/message-part.tsx:1876-2680`、`message-part.css:325-549`。

### pi（pi-coding-agent，本地依赖）
- **每个工具自带渲染器**：`renderCall(args, theme, ctx)` + `renderResult(result, options, theme, ctx)`，返回 TUI `Text` 组件（工具自渲染，非中央注册表）。
- **默认紧凑 + 展开提示**：`read` 折叠为 `read <path> :range (⌘O to expand)`；识别 skill/docs/resource 折叠成 `[skill] <name>` / `read docs <label>`。
- **结果仅展开时渲染**：按语言**语法高亮**，默认最多 10 行 + `... (N more lines, ⌘O to expand)`；超限给**显式截断警告**。
- `bash`：结果组件带**实时计时**（startedAt/endedAt，1s invalidate）。
- 主题色**角色化**：`toolTitle`/`accent`/`dim`/`warning`/`muted`/`toolOutput`。
- 来源：`.../pi-coding-agent/dist/core/tools/read.js:38-130`（+bash/grep/find/ls 同构）、`core/export-html/tool-renderer.js`。

### Claude（Code + Desktop）
- **工具调用 = 绿点 + 加粗动词 + 等宽参数**；完成后**折叠成一行摘要**（`Read 3 files` / `Called slack 3 times` / `Ran 2 commands`）。
- **全局视图档**：Normal / Thinking / Verbose；`Ctrl+O` 展开。
- 审批**内联在触发的工具调用处**（Allow once / Always allow / Deny）。
- 拟人状态动词（`✳ Pondering…`）。
- 来源：`2026-09-28-turn-metadata-placement-research.md:11`、`...competitor-research.md:33`。

### OpenAI Codex
- **内联按发生序的元数据行**：`Thought for 7s` → `Viewed 2 files` → `Edited hero.tsx +16 −6` → 正文。
- **无进度条**（进度=流式文本）。完成→底部浮动 **Review 操作条**（`Changed 8 files +23 −16 → Review`）。
- 来源：`turn-metadata-placement-research.md:10`、`competitor-research.md:18-21`。

### Kimi Code Desktop
- **内联工具输出卡**；**长输出自动折叠**；`Ctrl-O` 全局折叠切换。
- 辅助面板在**右侧 tab**（Changes/Thinking/子代理/Side chat/内置浏览器）。
- 审批流程内 panel（`Approve for session`）。
- 来源：`turn-metadata-placement-research.md:15`、`competitor-research.md:9-14`。

### dsh（DeepSeek Harness Desktop）
- **Trajectory 视图**：全部模型输入输出 / 工具调用 / 子代理调度的 **append-only 日志**，可查看/回放/分叉；工具调用**嵌套 call tree**；thinking 紧凑 Markdown 三级色。
- 0.5px 发丝线 + superellipse + 三级 elevation；一切皆插件。
- 哲学：**可回放性即设计**（过程全显形）——与 Zed「out-of-your-face」对立。
- 来源：`competitor-research.md:45-51`。

## 二、跨产品收敛（共性 = 该够到的 bar）

1. **默认折叠成一行 + 显式展开**（Claude/Codex/pi/opencode/Kimi 一致；dsh 是唯一"常显轨迹"异类）。
2. **结构化一行摘要**：动词/标题 + 目标 + **量化增量**（`+16 −6`、`3 files`、`:range`）——即"元数据行"。
3. **内容体是一个独立 surface**：描边/圆角盒 + **数据/代码走 mono** + 可滚动 + 可复制；pi/opencode 还做**语法高亮**。
4. **状态用 shimmer/点 + 耗时**（`Thought for 8s`）——**无进度条**。
5. **截断必须显式**（`... N more lines`），绝不静默截断。
6. **审批内联在调用处**，固定三档 + 决策留痕。
7. **颜色/尺寸走主题 token**，禁字面值（opencode/dsh）。

## 三、对 MAFW 工具卡的启示（差距与方向）

- MAFW 现状是**比谁都更紧凑**：22px 无框行 + 左竖线内容缩进（dsh 式刻意压缩，2026-09-28 决策），内容**全扁平无盒**，无展开动效、无右侧状态位、无截断提示。
- 要够到各家 bar，至少：
  1. **触发行**：标题 + 上下文 chip（目标/文件名/查询）+ `key=value` args(muted) + **右侧状态徽标**（verdict PASS/FAIL、valid、enabled、count）——对应各家"量化增量"位。
  2. **内容体**：套描边+圆角 surface 盒；数据/代码走 `--font-data`；代码可复制；**显式截断**（"… 还有 N 行"）。
  3. **进行中**：状态 shimmer/dot（MAFW 已有 streaming 光标，可复用到卡头）。
  4. **展开动效**：`BasicTool animated` 高度过渡（对齐 pi/opencode/v2）。
  5. 保留「默认折叠 + 一行摘要」的主线（各家共识）。
- 差异化取舍：不追 dsh 的常显轨迹（违背 MAFW 克制），不追 Claude 拟人微文案（可选点睛）。

## 四、待选设计方向

- **A. 对齐原生壳（推荐）**：触发行结构化 + 右侧状态徽标；内容套 surface 盒 + mono + 截断提示；开高度动效。用 MAFW v5/v6 token。
- **B. 轻量**：只加内容盒 + 动效，不动触发行。
- **C. 重做**：每工具自定义触发行 + 家族色图标 + 更贴近 opencode 的 file-accordion/diff 视觉。

（本文件为调研蒸馏，非设计决策；方向选定后进入 spec。）
