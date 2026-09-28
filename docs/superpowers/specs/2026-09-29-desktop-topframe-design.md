# Desktop 顶框架构重构设计（Topframe：strip 入标题行 + dock 并入 + rail 通高）

日期：2026-09-29 · 状态：已获用户批准（设计层面）· 调研依据：`docs/research/2026-09-29-desktop-topframe-layout-research.md`

## 1. 目标

把窗口框架从「独立 titlebar 行 + body 三列」重构为「rail 通高 + 顶行 strip」：

```
┌──────────┬──────────────────────────────────────────────┐
│ Rail 头:  │ SessionStrip(会话tab) · dock图标组 · [窗口控制] │ ← 38px 顶行
│ MAFW品牌  ├────────────────────────────────┬─────────────┤
│ +主题切换  │ main（chat / 各页面）           │ RightDock   │
│ 项目切换行 │                                │ 内容面板     │
│ Rail 体   │                                │             │
└──────────┴────────────────────────────────┴─────────────┘
```

业界先例：Windows Terminal `showTabsInTitlebar`（tab 入标题行）+ VS Code 标题栏右端 layout controls（面板开关入顶行）。

## 2. 已确认决策

| # | 问题 | 决策 |
|---|------|------|
| Q1 | 非 chat 页（Goals/Memory/…）顶行会话 tab | **恒显会话 tab**，点击切回 chat；页面身份由 Rail 导航高亮表达 |
| Q2 | dock 5 tab 并入顶行的开关语义 | **图标按钮组**（strip 行右侧、窗口控制左边），点击=打开/切换，**再点当前高亮=关闭 dock**；面板上的 ✕ 关闭保留 |
| Q3 | Rail 头部构成 | **品牌区独占一行**：logo+MAFW+gateway 状态点+主题切换（从旧 titlebar 搬入）；第二行才是现有项目切换器+搜索+折叠 |

## 3. 架构

### 3.1 Grid

`.mafw-shell` 从「flex column（titlebar + body）」改为：

```css
.mafw-shell { display: grid; grid-template-columns: auto 1fr; grid-template-rows: 38px 1fr; }
```

- 左列 = rail 容器（跨两行，`grid-row: 1 / -1`），折叠时 32px 宽不变
- 右上 = **strip 行**（38px，与 rail 品牌行同高，视觉一体）
- 右下 = main 区，内部仍是 `chat | dock` 两列（dock 宽来自既有统一宽度信号）

### 3.2 元素迁移

| 旧位置（.mafw-titlebar） | 新位置 |
|---|---|
| logo + "MAFW" + gateway 状态点 + Tooltip | Rail 品牌行 |
| 主题切换按钮 | Rail 品牌行（右端） |
| WindowControls（win32 自绘 3×46px） | strip 行最右端 |
| 拖拽区（-webkit-app-region: drag） | rail 品牌行 + strip 行空隙 |

| 旧位置 | 新位置 |
|---|---|
| SessionStrip（chat 分支内，仅 chat 页渲染） | 提升为 MafwShell 顶层全局组件，恒显 |
| RightDock 的 tab 条（`.mafw-right-dock-tabs`） | strip 行右侧图标按钮组；dock 面板本身不再渲染 tab 条 |

### 3.3 组件改动

- **MafwShell**：删除 `.mafw-titlebar` JSX；新增 strip 行容器，内含 SessionStrip + DockTabButtons + WindowControls；SessionStrip 从 chat 分支提取（sessions/activeViewId/rename/contextmenu/createSession 逻辑原样上移，状态不动）
- **Rail**：头部加品牌行（38px，logo+名+状态点+主题切换）；其余不动
- **RightDock**：移除自身 tab 条渲染，接收的 `tab`/`onTab` 改由 strip 行按钮组驱动；面板 ✕ 关闭保留
- **WindowControls**：从 titlebar 移到 strip 行右端，样式不变

### 3.4 拖拽工学（`-webkit-app-region`）

- drag：rail 品牌行整体、strip 行的空隙（strip 容器自身 drag，子元素 no-drag）
- no-drag：所有 tab / 按钮 / 重命名输入框 / dock 图标 / 窗口控制（WindowControls 已有 no-drag）
- dbl-click 最大化保持只在 drag 区生效（现有 `closest("button")` 守卫逻辑随之搬到新容器）

### 3.5 溢出与压缩

- 会话 tab 区 `overflow-x: auto` 横向滚动（沿用现有），tab 本身 `flex-shrink: 0`
- 压缩顺序：会话 tab 区先压缩（滚动）→ dock 图标组与窗口控制永不压缩
- tab 收缩契约沿用既有「标题过长只压缩 text」测试语义

## 4. 保留不动的行为

- rail 折叠 32px（品牌行收成单个 logo 图标按钮）与拖拽调宽（180–400，折叠阈值 120）
- 窄屏 <1200px dock 转 overlay + Esc/外点关闭
- dock 统一宽度（320 默认、拖拽记忆 `mafw-right-dock-width`）、ResizeHandle（240–480，折叠阈值 140）
- 会话 tab：双击重命名、右键菜单（Close/导出/Copy ID）、「+」新建、manager 绿点
- 最大化时 `.mafw-shell.maximized { padding: 8px }` 补偿
- 主题切换、gateway 状态点 tooltip 文案

## 5. 测试

- 设计契约（`tests/design-contract.test.ts`）新增/修改：
  - `.mafw-titlebar` 不再存在于 MafwShell（源码断言）
  - strip 行容器存在且含 WindowControls、dock 图标组、SessionStrip
  - Rail 源码含品牌行（logo + 主题切换迁入）
  - drag/no-drag 契约：strip 容器 drag、按钮 no-drag
- 既有受影响的断言更新（titlebar 相关、rail 头部相关）
- dock-tab 纯逻辑不变（DOCK_TABS/normalizeDockTab/宽度统一均已覆盖）
- 全量 `bun test` + typecheck + `electron-vite build`；CDP 实测：strip 在顶行、点 dock 图标开合、窗口拖拽可用

## 6. 非目标（YAGNI）

- 不做 tab 的 `tabWidthMode: compact`（图标化压缩）——溢出滚动已够，需要时再上
- 不做面板拖放重排 / 弹出独立窗口（Claude Code 式自由 pane）
- 不动 ChatPane 内部 titlebar（会话级工具行：并行/细节/审批模式等按钮）——那是另一行，保留
- 不做 macOS traffic lights 适配（当前 win32 自绘为主，mac 走原生隐藏既有逻辑不变）
