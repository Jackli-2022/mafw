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

- 单一 `ToolPresentation` 契约：标题、对象（相对路径/命令/query）、meta、状态、sections、actions、默认展开。
- 同一个 `ToolCard` 渲染普通聊天与时间线，只切 `density`（comfortable / compact）。
- 保留逃生口：diff 卡、task 导航、question 回答、skill 详情、MAFW 自绘卡。
- 每个 `ToolRegistry` 名称都有 conformance 测试；缺 title / 缺 status 直接失败。
- 逐步删除 `getToolInfo` / `contextToolTrigger` 的重复字段，而不是一次性重写。

**非目标**

- 不重写审批卡 / flow-card / `renderAfterPart` 承重路径。
- 不改工具语义、不新增工具。
- 不把移动端 Flutter 卡纳入本次重构。
- 不追求 Claude 拟人微文案 / 家族色图标（v8 已否决）。

## 3. 契约

新增 `packages/session-ui/src/components/tool-presentation.ts`（纯逻辑，无 Solid 依赖，bun test 直接导入）：

```ts
export type ToolKind = "row" | "diff" | "rich"
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

export interface ToolPresentation {
  kind: ToolKind
  /** 仅作为 fallback；v8 方向 A 默认不渲染前置图标。 */
  icon?: string
  title: string
  /** 相对路径 / 命令 / query / URL；一行省略。 */
  object?: string
  /** 右侧 badge / 计数 / 状态。 */
  meta?: ToolMeta[]
  status: ToolStatus
  /** rich 卡正文；row 卡通常为空。 */
  sections?: Section[]
  /** 富交互：打开子代理 / 回答 / 外链。 */
  actions?: ToolAction[]
  /** diff / terminal / markdown / json / custom；决定 body 渲染器。 */
  body?: "diff" | "terminal" | "markdown" | "json" | "custom"
  defaultOpen?: boolean
  animated?: boolean
  defer?: boolean
}
```

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
  /** body-only escape hatch，渲染在 ToolCard 的壳内 */
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
2. `present(ctx)` → `ToolCard`；body 用 `renderBody` 或 `presentation.body` 内置渲染器
3. `render`（无 `present`）→ legacy 完整卡（过渡期 adapter 只用于 conformance）
4. `ToolCardSpec` adapter（desktop 注册时注入）
5. `GenericTool` 的 presentation（`title = called <tool>`，`object = 首个可读字段`）

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

新增 `ToolCard`（session-ui）：

```tsx
<ToolCard
  presentation={presentation()}
  density={density}          // "comfortable" | "compact"
  open={...} onOpenChange={...}
  renderSections={...}       // 富卡 sections 的渲染器（desktop 注入 ToolSections）
  renderBody={...}           // 逃生口：diff / custom
/>
```

- `density` 写到 `data-density`，尺寸只由 token 控制：
  - comfortable：标题 14px（普通聊天现状）
  - compact：标题 11px / 目标 10.5px（过程抽屉现状）
- `kind: "row"`：`BasicTool` + `object` + meta + chevron；有 `sections` 时 body 用 markdown/terminal/json。
- `kind: "diff"`：保留现有 `edit`/`write`/`apply_patch` 组件作为 `renderBody`，`ToolCard` 只负责标题/路径/状态与展开壳。
- `kind: "rich"`：sections（kv/tags/text/code/list）+ actions；MAFW family 走这一档。
- **富卡正文渲染器留在 desktop**：`renderSections` 由 desktop 注入现有 `ToolSections`，`mafw-tool-box` / `mafw-tool-*` CSS 不搬家；session-ui 只拥有壳、row 与 density。这样避免把 30 个卡片的富内容排版一次性搬进 session-ui。
- error：`ToolErrorCard` 仍是独立短路，`handlesError` 语义不变。

### 4.1 密度决策（本稿的调用）

- **普通聊天保持 comfortable 14px**；时间线用 compact 11px。不把聊天整体压小，避免改变现有阅读节奏。
- `kind` 由工具显式声明，不做“按信息量猜”的启发式；猜错比多写一行更贵。
- `object` 统一用相对路径（`DataProvider.directory`）；context 组用文件名（`mode: "context"`），命令/query 原样，URL 原样。
- 图标默认不渲染；`icon` 只留给未来可选的家族标识，不在本阶段使用。

## 5. 迁移波次

严格 TDD：每波先写失败测试，再迁移，再删旧路径。

### Wave 1 · 契约 + 行工具

- 新建 `tool-presentation.ts` + `ToolCard` + `resolveToolPresentation` + conformance harness。
- 迁移 `read/list/glob/grep/webfetch/websearch/bash` + `GenericTool`。
- 时间线切到 `ToolCard density="compact"`；普通聊天切到 `ToolCard density="comfortable"`（行为不变）。
- 删除 `getToolInfo` 在时间线的使用。

### Wave 1b · context 组

- `ContextToolGroup`（read/list/glob/grep）改用 `resolveToolPresentation(ctx.mode = "context")` + `ToolCard`；删除 `contextToolTrigger` / `contextToolDetail`。
- 这是关闭时间线开关时的默认聊天路径；不迁移的话 `getToolInfo` 永远删不掉，同一个工具仍会两套长相。


### Wave 2 · diff

- `edit/write/apply_patch`：`present()` 只产出标题/路径/status/meta（+/-），body 继续用现有组件。
- 验证 `deferContent`、`virtualizeDiff`、`ToolFileAccordion` 不被破坏。

### Wave 3 · 富卡

- `task/question/skill`：`present()` 产出 title/object/actions/sections；task 的 `open-subagent`、question 的 `answer`、skill 的详情保留。
- 删除 task 的自绘 trigger 与 `task-tool-icon` 分支（如果 `ToolCard` 已覆盖）。

### Wave 4 · MAFW family

- desktop `ToolCardSpec` 实现 `present(ctx)`：`extract` → `sections`，`badge` → `meta`，`subtitle` → `object`。
- `renderSections` 继续由 desktop 注入现有 `ToolSections`；session-ui 不接管 `mafw-tool-*` CSS。
- 8 个自绘卡（search/add/deltas/rule/python/execute/goal-created）保留 `render` 完整卡；它们没有 `present` 时走 legacy 路径。
- 30 个 spec 全部接 `present` 后，删除 `familyCard` 的重复 trigger 构建。

### Wave 5 · 清理

- 删除 `getToolInfo` / `contextToolTrigger` / `contextToolDetail` 的重复字段；保留必要兼容导出。
- 删除时间线 `ToolRow` 遗留 CSS / 注释。
- conformance 覆盖全部第一方注册名（含 alias；`todowrite` 等 `HIDDEN_TOOLS` 显式豁免）。

## 6. 测试

- **纯函数**：`buildToolPresentation` 对每个工具 fixture 产出合法 title/status/kind；空 output / 错误 output 不崩。
- **注册面 conformance**：`ToolRegistry.names()` 遍历第一方注册名（含 alias）；有 `present` 的必须返回合法 presentation；legacy-only 条目由 adapter 用 `getToolInfo` 合成 title/status，因此 `getToolInfo` 在 Wave 5 前不能删。插件动态注册的卡不进入 session-ui conformance，由 desktop 插件测试覆盖。
- **DOM / 视觉**：不引入 jsdom/happy-dom。density 字号、路径、chevron、无图标继续用**CSS 源断言 + presentation 单测**；真实交互与视觉走每波真机检查。
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

1. 普通聊天保持 comfortable；compact 只给时间线。
2. `Section` / `ListItem` / `ToolBadge` 迁到 session-ui，desktop `extract.ts` re-export；`ToolCardSpec` 仍是 desktop 侧的适配层。
3. 富卡 sections 与 `mafw-tool-*` CSS 留在 desktop，通过 `renderSections` 注入；不把 30 个卡片的排版搬进 session-ui。
4. context 组（Wave 1b）在范围内；否则 `getToolInfo` 无法真正删除。
5. 插件卡继续用 `render` + `override`，不要求迁移到 `present`。
6. 不加 `localStorage` 回退开关；legacy `render` 就是逃生口。

**待决（需要你拍板）**

1. 先只做 Wave 1 + 1b（契约 + 行工具 + context 组），还是一次性排完 Wave 1–5？前者能最快验证契约，后者改动面大。
2. 普通聊天最终是否也要 compact？本稿默认不切；如果切，需要先做一轮视觉对比。

