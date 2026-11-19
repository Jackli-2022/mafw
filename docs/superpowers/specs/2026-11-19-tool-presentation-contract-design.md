# 工具呈现契约（ToolPresentation）— 设计文档

> 日期：2026-11-19
> 前置：`docs/research/2026-11-19-tool-card-refactor-survey.md`（三套渲染 / 四个标题构建器）、
> `docs/superpowers/specs/2026-10-11-tool-card-polish-design.md`（v8 方向 A）。
> 状态：设计稿；Phase 1（所有原生卡进抽屉 + 归一化）已落地 `ea92d374f` / `4971632bb`。

## 1. 问题

同一个工具在不同位置长得不一样，根因不是 CSS，而是**没有单一的呈现模型**：

| 路径 | 事实来源 | 覆盖 |
|---|---|---|
| A. session-ui 原生 `ToolRegistry.render` | 每个 renderer 自己拼 `BasicTool.trigger` | read/list/glob/grep/webfetch/websearch/task/bash/edit/write/apply_patch/question/skill |
| B. desktop MAFW family | `ToolCardSpec`（icon/title/subtitle/extract/badge） | 30 个 `mafw_*` + 8 个自绘卡 |
| C. 过程时间线 | Phase 1 后复用 A/B，但只靠作用域 CSS 压字号 | 所有工具 |

标题/副标题有四个构建器：`getToolInfo`、每个原生 renderer 的 trigger、`contextToolTrigger`、`ToolCardSpec`。
新增一个工具最多要改四处；路径、状态、badge、展开策略没有单一来源。

Phase 1 解决了“看得见”，但没有解决“模型分裂”：

- 普通聊天 14px、时间线 11px，靠 CSS 覆盖而不是 density 语义；
- MAFW family 的 badge/分节只能在 desktop 里生成，session-ui 不知道；
- `getToolInfo` 与 `contextToolTrigger` 仍然重复计算标题/路径；
- 没有一个测试能保证“每个注册工具都能产出合法呈现”。

## 2. 目标 / 非目标

**目标**

- 单一 `ToolPresentation` 契约：每个工具显式声明 **collapsed** 与 **expanded** 两个状态；未声明的字段走**显式默认**，不出现“没定义就不渲染”。
- 同一个 `ToolCard` 渲染整个 ChatView（过程时间线、`AssistantParts`、context 组），不再按“普通聊天 / 时间线”分两套。
- 默认态是契约的一部分：`DEFAULT_COLLAPSED` / `DEFAULT_EXPANDED` 有类型、有单测；任何工具至少能折叠成一行、展开成通用输入/输出。
- 保留逃生口：diff 卡、task 导航、question 回答、skill 详情、MAFW 自绘卡。
- 每个第一方 `ToolRegistry` 名称都有 conformance 测试；缺 title / 缺 status / 两个状态都缺失直接失败。
- 逐步删除 `getToolInfo` / `contextToolTrigger` 的重复字段，而不是一次性重写。

**非目标**

- 不重写审批卡 / flow-card / `renderAfterPart` 承重路径。
- 不改工具语义、不新增工具。
- 不把移动端 Flutter 卡纳入本次重构。
- 不追求 Claude 拟人微文案 / 家族色图标（v8 已否决）。

## 3. 契约

新增 `packages/session-ui/src/components/tool-presentation.ts`（纯逻辑，无 Solid 依赖，bun test 直接导入）：

```ts
export type ToolStatus = "pending" | "running" | "completed" | "error"

export interface ToolMeta {
  text: string
  tone?: "ok" | "warn" | "err" | "muted" | "accent"
}

export interface ToolAction {
  kind: "open-subagent" | "answer" | "link" | "custom"
  label?: string
  href?: string
  sessionID?: string
  questionID?: string
  run?: () => void
}

/** 折叠态：始终是一行。 */
export interface ToolCollapsedPresentation {
  title: string
  /** 相对路径 / 命令 / query / URL；一行省略。 */
  object?: string
  /** 右侧 badge / 计数 / 状态。 */
  meta?: ToolMeta[]
  status: ToolStatus
  /** 仅作为 fallback；v8 方向 A 默认不渲染前置图标。 */
  icon?: string
}

/** 展开态：正文。 */
export interface ToolExpandedPresentation {
  /**
   * default = 通用输入/输出（JSON input + text output）。
   * 未声明时永远走 default，保证任何工具都展开得出东西。
   */
  body?: "default" | "markdown" | "terminal" | "json" | "diff" | "custom"
  sections?: Section[]
  actions?: ToolAction[]
  defaultOpen?: boolean
}

/**
 * 工具呈现 = 两个状态。
 * 两个字段都可选；缺省由 resolvePresentation() 合并显式默认。
 */
export interface ToolPresentation {
  collapsed?: Partial<ToolCollapsedPresentation>
  expanded?: Partial<ToolExpandedPresentation>
}
```

### 3.0 显式默认（契约的一部分）

```ts
export function statusOf(props: ToolProps): ToolStatus {
  if (props.status === "pending" || props.status === "running" || props.status === "error") return props.status
  return "completed"
}

export function defaultCollapsed(ctx: ToolPresentationContext): ToolCollapsedPresentation {
  return { title: ctx.props.tool, status: statusOf(ctx.props) }
}

export const DEFAULT_EXPANDED: ToolExpandedPresentation = { body: "default" }

export function resolvePresentation(
  raw: ToolPresentation | undefined,
  ctx: ToolPresentationContext,
): { collapsed: ToolCollapsedPresentation; expanded: ToolExpandedPresentation } {
  return {
    collapsed: { ...defaultCollapsed(ctx), ...raw?.collapsed },
    expanded: { ...DEFAULT_EXPANDED, ...raw?.expanded },
  }
}
```

- 默认 `collapsed.title` 用 canonical 工具名；`present` 必须覆盖成人类可读标题。
- 默认 `expanded.body = "default"` 是**真实渲染器**：输入 JSON + 输出文本，可滚动，不是“空”。
- `body: "default"` 与 `body: "custom"` 互斥；`custom` 必须有 `renderBody`，否则 conformance 失败。
- `sections` 与 `body` 可以同时存在：`sections` 优先，`body` 作为无 sections 时的正文。

### 3.1 构建上下文

`present` 不直接调用 Solid hooks，也不返回闭包 action。它接收：

```ts
export interface ToolPresentationContext {
  props: ToolProps
  directory?: string
  mode: "chat" | "context" | "timeline"
  t: (key: string, params?: Record<string, unknown>) => string
  sessionHref?: (sessionID: string) => string | undefined
  agent?: (name?: string) => { name: string; color?: string; v2Color?: string } | undefined
}
export type ToolPresenter = (ctx: ToolPresentationContext) => ToolPresentation
```

- `t` / `sessionHref` / `agent` 由调用方注入；单测传 fake。
- `mode: "context"` 用于普通聊天的上下文组：read 显示文件名而非完整相对路径，与现状对齐。
- `ToolAction` 只存声明（`open-subagent` + `sessionID`，`link` + `href`）；`run` 仅保留给 `custom` 逃生口，不参与纯函数测试。
- MAFW family 的中文标题暂时保持硬编码；i18n 化不在本阶段。

`Section` / `ListItem` / `ToolBadge` 从 desktop `tool-cards/extract.ts` 迁到 session-ui 的 `tool-presentation.ts`，
desktop `extract.ts` 改为 re-export，避免循环依赖（desktop → session-ui 单向）。

### 3.2 注册面

`ToolRegistry` 条目扩展为：

```ts
interface ToolRegistryEntry {
  name: string
  present?: ToolPresenter
  /** 折叠态整行自定义（header-only，不含 Collapsible 壳） */
  renderCollapsed?: (props: ToolProps) => JSX.Element
  /** 展开态正文自定义（body-only，渲染在 ToolCard 的壳内） */
  renderBody?: ToolComponent
  /** legacy full-card renderer；也是插件覆盖面 */
  render?: ToolComponent
  /** 插件覆盖：render 优先于 present */
  override?: boolean
  handlesError?: boolean
}
```

解析顺序（新）：

1. `override && render` → 完整 legacy 卡（插件覆盖，最高优先）
2. `present(ctx)` → `ToolCard`：
   - 折叠行：`renderCollapsed` 优先，否则用 `collapsed` 字段渲染默认一行；
   - 展开正文：`renderBody` 优先，否则 `expanded.sections` → `expanded.body` → `DEFAULT_EXPANDED`。
3. `render`（无 `present`）→ legacy 完整卡（过渡期 adapter 只用于 conformance）
4. `ToolCardSpec` adapter（desktop 注册时注入）
5. `GenericTool` 的 presentation（`title = called <tool>`，`object = 首个可读字段`）

自定义粒度：

- **只自定义折叠**：注册 `renderCollapsed`，展开仍走默认/`present.expanded`。
- **只自定义展开**：注册 `renderBody`（或 `expanded.body = "custom"`），折叠仍走默认一行。
- **两边都自定义**：两个字段都注册；`ToolCard` 只负责 `Collapsible` 的开合与 `data-state`。
- `renderCollapsed` 只返回 header 内容，不包含自己的 `<Collapsible>`；`renderBody` 只返回正文，不包含 `BasicTool` 壳。

注册表 API 增补：

```ts
ToolRegistry.register(entry)              // 现状：整条替换
ToolRegistry.override(name, render)       // 快照 + 设置 { ...prev, render, override: true }，返回 restore
ToolRegistry.has(name)                    // present || render，插件槽位检测用它替代 render() !== undefined
ToolRegistry.names(): string[]            // conformance 枚举
ToolRegistry.entry(name)                  // 只读快照，调试/测试用
```

- 插件卡继续用 `render` + `override`，不要求迁移到 `present`；`override` 保证不会被第一方 `present` 抢走。
- `override` 的 restore 必须恢复**完整 entry**（含 `present`），不能只写回 `{ name, render }`。
- `resolveToolRender` 保留给旧调用方；新渲染走 `resolveToolPresentation`。


## 4. 渲染

新增 `ToolCard`（session-ui）。整个 ChatView 只有一个卡组件、一套字号，状态只有折叠/展开：

```tsx
<ToolCard
  presentation={presentation()}   // resolvePresentation() 的结果：{ collapsed, expanded }
  open={open()} onOpenChange={...}
  renderSections={...}            // 富卡 sections 的渲染器（desktop 注入 ToolSections）
  renderBody={...}                // 逃生口：diff / custom
/>
```

- **折叠态**：一行，始终显示 `collapsed.title` + `collapsed.object` + `collapsed.meta` + chevron；无前置图标。
- **展开态**：折叠行不变，下面挂 `expanded` 正文。
- **两个样式是显式的**：`ToolCard` 根节点写 `data-state="collapsed" | "expanded"`；CSS 只按这两个状态写，不再靠位置（时间线 / 聊天）覆盖。默认 `collapsed`，`expanded.defaultOpen === true` 才初始展开。
- **正文选择顺序**：
  1. `expanded.sections` → `renderSections`
  2. `expanded.body` 对应的内置渲染器（`default` / `markdown` / `terminal` / `json`）
  3. `expanded.body === "diff"` 或 `"custom"` → `renderBody` 逃生口
  4. 全缺 → `DEFAULT_EXPANDED.body = "default"`（通用输入/输出）
- **默认展开态必须真实可渲染**：`default` 不是“空”，而是输入 JSON + 输出文本；没有显式展开体的工具也能展开。
- **富卡正文渲染器留在 desktop**：`renderSections` 由 desktop 注入现有 `ToolSections`，`mafw-tool-box` / `mafw-tool-*` CSS 不搬家；session-ui 只拥有壳与状态。
- error：`ToolErrorCard` 仍是独立短路，`handlesError` 语义不变。

### 4.1 状态与尺寸（本稿的调用）

- 不再有“普通聊天 vs 时间线”两套：涉及 ChatView 的三条路径（过程时间线、`AssistantParts`、context 组）都用同一个 `ToolCard`，只有 `open` 一个状态开关。
- **折叠态固定一行**：占满可用宽度，`min-height` / `max-height` 都是 28px，`white-space: nowrap`，不换行、不撑高；默认行和 `renderCollapsed` 自定义行都遵守这个外框。
- 字号**统一为 11px / 550**（折叠行标题），目标/路径 **10.5px**，meta/args **10.5px**；整个 ChatView 共用同一套 token，不再按位置覆盖。
- `collapsed` / `expanded` 由工具显式声明；缺省走 `defaultCollapsed` / `DEFAULT_EXPANDED`，不做“按信息量猜”。
- `object` 统一用相对路径（`DataProvider.directory`）；context 组用文件名（`mode: "context"`），命令/query 原样，URL 原样。
- 图标默认不渲染；`icon` 只留给未来可选的家族标识，不在本阶段使用。

### 4.2 折叠行长文本

- 折叠行只有一行：`title` 不收缩，`object` 占剩余空间。
- `object` 超长时**只在箭头前渐隐**，不用 `text-overflow: ellipsis` 硬切：
  ```css
  .tc-object {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    mask-image: linear-gradient(to right, #000 calc(100% - 8px), transparent);
  }
  ```
- chevron（`chevron-down`）在 mask 之外，固定右侧；`meta` badge 也在 mask 之外，`object` 渐隐到 meta 前。
- 展开态仍保留同一行；完整对象在展开体里，不给 `object` 加裸 `title`（AGENTS.md 禁止裸 `title`）。
- 渐隐区默认 **8px**，紧贴 chevron；不要提前渐隐（20px 会吃掉可读字符）。窄窗下 object 可以继续缩，chevron 不缩。

### 4.3 展开正文与折叠行同一条左边缘

- 展开正文的第一行必须和 `collapsed.title` 同一条左边缘；卡片边框/背景可以从行首开始。
- 统一 token：`--mafw-tool-content-left: 6px`（等于折叠 trigger 的左右 padding）。
- diff 卡头默认 `12px` padding 在抽屉内改为 `6px`；bash `bash-pre`、`tool-output`、`mafw-tool-box` 同样用这个 token。
- 内部组件自己的 gutter（行号、文件图标、缩进代码）不算“退格”；只要求第一个可读字符对齐。
- 测试：折叠标题 left 与展开正文第一行 left 差 ≤1px。

### 4.4 CodeMode（`execute`）的渲染

**数据边界**：`metadata.toolCalls[]` 只有 `tool / status / input`；没有 per-call output。只有 `state.output`（history 还要走 `partOutputText`）。所以 **不渲染“每个子调用的结果卡”**，只渲染子调用列表 + 最终输出。

- 折叠态（一行）：
  - 标题：`Code Mode 执行`
  - object：失败调用优先，否则最近一次子调用的 `label(args)`（如 `mafw_python [code=…]`）
  - meta：`N 次调用`；有失败时追加 `有失败`（err tone）
  - status：`pending/running/completed/error`
- 展开态（`renderBody`，保留现有 `MafwExecuteCard` 正文）：
  - 子调用行：状态字形 + 工具图标/名称 + 参数摘要；点击仅展开 **input JSON**（不是结果）；
  - 最终输出：`ToolSections`（KV/code/list），8KB / 200 行限幅，超出显示“展开全部”；
  - 运行中：`defaultOpen: true`，子调用行实时更新；不解析最终输出；
  - 空态：运行中“等待脚本调用工具…”，完成“脚本未调用工具”；
  - 失败：失败行红色；最终错误文本按 `state.output`/`error` 展示。
- `present`：`collapsed` 由 `executeCalls` / `executeHeaderSubtitle` 生成；`expanded = { body: "custom", defaultOpen: true }`；`renderBody` 指向 `ExecuteBody`。
- **不**为子调用行伪造结果；如果产品必须逐个子调用结果，使用 `codemode: false`（直连 tool part）或等 upstream callID。
- 脚本代码不内联到折叠行；需要时后续加“查看脚本”动作，默认不展开 `input.code`。

## 5. 迁移波次




严格 TDD：每波先写失败测试，再迁移，再删旧路径。

### Wave 1 · 契约 + 行工具

- 新建 `tool-presentation.ts` + `ToolCard` + `resolveToolPresentation` + conformance harness。
- 迁移 `read/list/glob/grep/webfetch/websearch/bash` + `GenericTool`。
- 过程时间线与 `AssistantParts` 同时切到 `ToolCard`；两处共用同一套字号与状态。
- 删除 `getToolInfo` 在时间线的使用。


### Wave 1b · context 组

- `ContextToolGroup`（read/list/glob/grep）改用 `resolveToolPresentation(ctx.mode = "context")` + `ToolCard`；删除 `contextToolTrigger` / `contextToolDetail`。
- 这是 `AssistantParts` 路径里的工具组；不迁移的话 `getToolInfo` 永远删不掉，同一个工具仍会两套长相。

### Wave 2 · diff

- `edit/write/apply_patch`：`present()` 产出 `collapsed`（标题/路径/status/meta ±）与 `expanded.body = "diff"`；body 继续用现有组件。
- 验证 `deferContent`、`virtualizeDiff`、`ToolFileAccordion` 不被破坏。

### Wave 3 · 富卡

- `task/question/skill`：`present()` 产出 `collapsed` 与 `expanded.sections/actions`；task 的 `open-subagent`、question 的 `answer`、skill 的详情保留。
- 删除 task 的自绘 trigger 与 `task-tool-icon` 分支（如果 `ToolCard` 已覆盖）。

### Wave 4 · MAFW family

- desktop `ToolCardSpec` 实现 `present(ctx)`：`extract` → `expanded.sections`，`badge` → `collapsed.meta`，`subtitle` → `collapsed.object`。
- `renderSections` 继续由 desktop 注入现有 `ToolSections`；session-ui 不接管 `mafw-tool-*` CSS。
- 8 个自绘卡（search/add/deltas/rule/python/execute/goal-created）保留 `render` 完整卡；它们没有 `present` 时走 legacy 路径。
- 30 个 spec 全部接 `present` 后，删除 `familyCard` 的重复 trigger 构建。

### Wave 5 · 清理

- 删除 `getToolInfo` / `contextToolTrigger` / `contextToolDetail` 的重复字段；保留必要兼容导出。
- 删除时间线 `ToolRow` 遗留 CSS / 注释。
- conformance 覆盖全部第一方注册名（含 alias；`todowrite` 等 `HIDDEN_TOOLS` 显式豁免）。

## 6. 测试

- **默认态**：`resolvePresentation(undefined, ctx)` 必须得到非空 `collapsed.title` / `status` 和 `expanded.body === "default"`；每个工具至少能折叠成一行、展开成通用输入/输出。
- **纯函数**：每个工具 fixture 的 `collapsed` / `expanded` 合并结果合法；空 output / 错误 output 不崩；`body: "custom"` 缺 `renderBody` 直接失败。
- **注册面 conformance**：`ToolRegistry.names()` 遍历第一方注册名（含 alias）；有 `present` 的必须返回合法 presentation；legacy-only 条目由 adapter 用 `getToolInfo` 合成 `collapsed`，因此 `getToolInfo` 在 Wave 5 前不能删。插件动态注册的卡不进入 session-ui conformance，由 desktop 插件测试覆盖。
- **状态**：折叠态只有一行（28px 高、占满可用宽度、不换行）；展开态正文按 `sections → body → default` 选择；diff/rich/row 三种正文都能展开。
- **自定义**：`renderCollapsed` 替换折叠行但仍受一行外框；`renderBody` 替换展开正文；只自定义一边时另一边走默认；两边都自定义时 `ToolCard` 只负责开合与 `data-state`。
- **DOM / 视觉**：不引入 jsdom/happy-dom。字号、路径、chevron、无图标继续用**CSS 源断言 + presentation 单测**；真实交互与视觉走每波真机检查。
- **迁移回归**：edit/write diff、task 导航、question 答案、MAFW search 结果列表、GenericTool JSON 兜底、插件 `override` restore。
- **门禁**：session-ui 全量（排除既有 `architecture.test.ts`）、desktop 全量 + `tsgo`、`electron-vite build`；每波都跑。


## 7. 风险

- **defer / animated / virtualizeDiff**：diff 卡沿用现有组件，`ToolCard` 只包壳，不改内部生命周期。
- **task 导航**：`triggerAsLink` / `navigateToSession` 由 `actions` 驱动，保留 `href` 与键盘行为。
- **question pending**：pending/running 隐藏逻辑留在 `ToolPartDisplay`，presentation 不参与。
- **MAFW 输出解析**：`extract` 可能抛错；adapter 必须 try/catch + `genericSections` 兜底（现状已有）。
- **插件覆盖**：`override` 必须快照/恢复完整 entry；`ToolRegistry.has()` 替代旧的 `render() !== undefined` 槽位检测，避免第一方 `present` 卡被插件误判为空槽。
- **兼容**：旧 `render` 不删除；外部插件注册的 `render` 继续工作。

## 8. 本稿的调用 / 待决

**本稿的调用（可按需推翻）**

1. 整个 ChatView 用同一套 `ToolCard` 与同一套字号：**11px / 550** 标题、10.5px 目标/路径；不再有“普通聊天 / 时间线”两套。
2. 每个工具显式声明 `collapsed` / `expanded`；缺省由 `defaultCollapsed` / `DEFAULT_EXPANDED` 合并，默认展开体是通用输入/输出。
3. `ToolCard` 根节点用 `data-state="collapsed" | "expanded"`；CSS 只按两个状态写，默认 `collapsed`。
4. `Section` / `ListItem` / `ToolBadge` 迁到 session-ui，desktop `extract.ts` re-export；`ToolCardSpec` 仍是 desktop 侧的适配层。
5. 富卡 sections 与 `mafw-tool-*` CSS 留在 desktop，通过 `renderSections` 注入；不把 30 个卡片的排版搬进 session-ui。
6. context 组（Wave 1b）在范围内；否则 `getToolInfo` 无法真正删除。
7. 插件卡继续用 `render` + `override`，不要求迁移到 `present`。
8. 不加 `localStorage` 回退开关；legacy `render` 就是逃生口。

**待决（需要你拍板）**

1. 先只做 Wave 1 + 1b（契约 + 行工具 + context 组），还是一次性排完 Wave 1–5？前者能最快验证契约，后者改动面大。


