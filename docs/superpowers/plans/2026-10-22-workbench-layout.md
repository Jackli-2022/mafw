# 工作台布局重排（Agent Workbench Layout）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（inline，主会话逐 Task 推进，每 Task 一 commit，直接提交 main，无分支/PR）。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 MAFW Desktop 主窗口重排为「图标轨 46px ｜ chat 窄栏 ｜ 工作台默认打开」三列 IDE 式布局，左 dock 双模态（窗口化浮层 / 最大化推挤），五页面入口收进 Dashboard 枢纽页。

**Architecture:** 左栏由现 200px Rail 拆成两层——常驻 `IconRail`（6 图标三段）+ 按需 `LeftDock`（会话/搜索两面，mode 由纯函数按 winMaximized + 窄断点决策）。主区 chat 列定宽可拖，工作台（现 RightDock）吃剩余空间并默认打开。Dashboard 加「页面」链接卡承接 Goals/Memory/Approvals/Triage/Automation 五入口。

**Tech Stack:** Electron + SolidJS + `@mafw/ui` v2 组件；纯逻辑模块 + CSS 契约测试（house 风格）。

**Spec:** `docs/superpowers/specs/2026-10-22-workbench-layout-design.md`（D1-D7 + Builder check 已决项，plan 的参数值以 spec 为准）

## Global Constraints

- 不新增裸 `<button>`/`<input>`/裸 `title`——一律 `@mafw/ui/v2/*`（ButtonV2/TooltipV2 openDelay 300）
- 动效只用 v7 tokens：`--dur-fast`/`--dur-surface` + `--ease-standard`/`--ease-surface`
- 纯逻辑进独立 `.ts` + 同目录 `.test.ts`；样式断言走 CSS 契约测试（读 mafw.css 文本）
- 测试命令（cwd=`packages/desktop`）：`node --import tsx --import ../../packages/test-shim/register.mjs --test <file>`；全量 `npm test`；类型 `npx tsgo --noEmit -p tsconfig.json`；构建 `npx electron-vite build`
- 每 Task 一 commit，直接 main
- localStorage 键迁移必须一次性读旧键、写新键、不丢用户显式选择

## Review Focus

spec 未明说、最可能咬人的输入/条件（每条已分配到 Task 的测试）：

1. **老用户显式关过工作台**（`mafw-right-dock-open="0"`）升级后不得被强制重开；键缺失才默认开 → Task 5 测试钉扎
2. **最大化判定在 macOS/Linux**：fullscreen 事件与 maximize 事件平台差异，任一缺失时回退（fail-open 到 overlay 而非崩） → Task 2 测试钉扎
3. **浮层打开时选中会话**：overlay 必须自动关，push 不得关 → Task 4 测试钉扎
4. **<1200px 窄窗口**：push 永不触发（恒 overlay），工作台 overlay 化既有行为不变 → Task 1 + Task 5 测试钉扎
5. **Approvals 徽标搬家**：📊 徽标与旧 Rail `tabCounts.approvals` 同源（`pendingPermissionCount()`），不得双计数或漏更新 → Task 6 测试钉扎

---

### Task 1: 左 dock 纯状态模型

**Files:**
- Create: `packages/desktop/src/renderer/mafw/left-dock.ts`
- Test: `packages/desktop/src/renderer/mafw/left-dock.test.ts`

**Interfaces:**
- Produces（Task 4 消费）:
  ```ts
  export type LeftDockFace = "sessions" | "search"
  export type LeftDockMode = "closed" | "overlay" | "push"
  export interface LeftDockState { face: LeftDockFace; open: boolean }
  export function toggleFace(s: LeftDockState, face: LeftDockFace): LeftDockState
  export function resolveMode(open: boolean, maximized: boolean, narrow: boolean): LeftDockMode
  export function migrateLegacyRail(railCollapsed: string | null, railWidth: string | null): { open: boolean | null; width: number | null }
  ```

- [ ] **Step 1: 写失败测试** `left-dock.test.ts`
  - `toggleFace`：同 face 且 open → closed（VS Code toggle 语义）；不同 face → open 且换 face；closed → open 该 face
  - `resolveMode`：open+maximized+非窄 → `"push"`；open+非最大化 → `"overlay"`；open+窄 → `"overlay"`（Review Focus 4）；closed → `"closed"`
  - `migrateLegacyRail`：`("1","264")` → `{open:false, width:264}`（老用户收起过 → 尊重）；`(null,null)` → `{open:null,width:null}`（无历史 → 不表态）；`("0","300")` → `{open:true,width:300}`
- [ ] **Step 2: 跑测试确认 FAIL**（`left-dock` 模块不存在）
- [ ] **Step 3: 实现** `left-dock.ts`（纯函数，无 Solid 依赖；narrow 判定消费 Task 既有 `isNarrowViewport` 的布尔，不重复定义断点）
- [ ] **Step 4: 跑测试确认 PASS**
- [ ] **Step 5: Commit** `feat(desktop): left-dock state model (toggle semantics + dual-mode resolve + legacy migration)`

### Task 2: 窗口「最大化/全屏」信号跨平台化

**Files:**
- Create: `packages/desktop/src/renderer/mafw/window-expanded.ts`
- Test: `packages/desktop/src/renderer/mafw/window-expanded.test.ts`
- Modify: `packages/desktop/src/main/windows.ts:243-248`（maximize 通知块）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:1362-1366`（win32 门）

**Interfaces:**
- Consumes: 既有 preload `window.api.windowControls.isMaximized()` / `onMaximizedChange(cb)`
- Produces: `export function windowExpanded(maximized: boolean, fullscreen: boolean): boolean`；main 侧 `window-maximized-changed` 载荷语义变为 `win.isMaximized() || win.isFullScreen()`

- [ ] **Step 1: 写失败测试**：`windowExpanded(true,false)===true`、`(false,true)===true`、`(false,false)===false`
- [ ] **Step 2: 确认 FAIL**
- [ ] **Step 3: 实现**
  - `window-expanded.ts` 纯函数
  - `windows.ts`：加 `win.on("enter-full-screen"/"leave-full-screen", notifyMaximized)`；`notifyMaximized` 载荷改 `win.isMaximized() || win.isFullScreen()`（fail-open：事件不发的平台自然停在 false=overlay，Review Focus 2）
  - `MafwShell.tsx`：删除 `if (window.api.platform !== "win32") return` 门，`winMaximized` 语义即 `windowExpanded`
- [ ] **Step 4: 测试 PASS + `npx tsgo --noEmit -p tsconfig.json` rc=0**
- [ ] **Step 5: Commit** `feat(desktop): cross-platform window expanded signal for left-dock push mode`

### Task 3: IconRail 组件（6 图标三段 + 徽标）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/IconRail.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/tests/icon-rail-css.test.ts`

**Interfaces:**
- Consumes: Task 1 `LeftDockFace`；既有 `pendingPermissionCount()` 与 connPhase（MafwShell 已有）
- Produces:
  ```ts
  export function IconRail(props: {
    face: LeftDockFace | null
    onToggleFace: (face: LeftDockFace) => void
    onNewSession: () => void
    onDashboard: () => void
    onConfig: () => void
    onToggleTheme: () => void
    approvals: number
    connPhase: string   // "connected" | "reconnecting" | "down" | "initial"
    theme: string
  }): JSX.Element
  ```
  CSS 类：`.mafw-icon-rail` / `-icon` / `-icon.active` / `-badge` / `-conn-dot`（三态）

- [ ] **Step 1: 写失败 CSS 契约测试**（读 mafw.css 文本断言）：`.mafw-icon-rail` 宽度 46px + flex column；`.mafw-icon-rail-icon.active` 有左侧 accent（`box-shadow: inset 2px 0 0` 或 border-left）；`.mafw-icon-rail-badge` 存在；`.mafw-icon-rail-conn-dot` 三态（ready/reconnecting/failed 类名）存在
- [ ] **Step 2: 确认 FAIL**
- [ ] **Step 3: 实现** `IconRail.tsx` + mafw.css 规则
  - 三段：顶部 💬会话+＋新建｜中部 🔍搜索｜底部 📊+⚙+🌙（`flex:1`  spacer 推开）
  - 图标用既有 `@mafw/ui` Icon 集名字（会话=`bubble-5`，搜索/新建/Dashboard/Config/主题 选图标集已有名；主题沿用现 Rail 的 ☀/月亮 SVG）
  - 每个图标 TooltipV2 openDelay 300；激活 face 的图标加 `.active`
  - 📊 图标：`props.approvals > 0` 时显示 `.badge`（数字=approvals）
  - ⚙ 图标：`.conn-dot` 小圆点，类名随 connPhase（复用现 Rail 品牌块的 classList 映射）
- [ ] **Step 4: 测试 PASS**
- [ ] **Step 5: Commit** `feat(desktop): IconRail component (6-icon three-zone rail with badges)`

### Task 4: LeftDock 容器（双模态）+ 会话/搜索面提取

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/LeftDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:1679-1753`（rail 列替换）、`:1360-1366`（状态接线）、`:1763-1774`（顶行左开关删除）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/tests/left-dock-css.test.ts`

**Interfaces:**
- Consumes: Task 1 `LeftDockState/toggleFace/resolveMode/migrateLegacyRail`；Task 2 `winMaximized`；Task 3 `IconRail`；现 Rail.tsx 的会话树（`buildSessionTree/pageGroups`）、项目切换器、搜索 UI、`ManagerCard`
- Produces:
  ```ts
  export function LeftDock(props: {
    mode: LeftDockMode; face: LeftDockFace; width: number
    onClose: () => void; onResize: (w: number) => void
    activeSessionId: string | null; managerSessionId?: string | null
    projectsRev?: () => number
    onSelectSession: (id: string, title?: string, manager?: boolean) => void
    onSessionDeleted?: (id: string) => void
  }): JSX.Element
  ```
  CSS 类：`.mafw-left-dock` / `.overlay` / `.push`

- [ ] **Step 1: 写失败 CSS 契约测试**：`.mafw-left-dock.overlay` = `position:absolute` + 有阴影 + z-index ≥ 60；`.mafw-left-dock.push` = 无 position（在 grid 流内）；`.mafw-shell` grid 含左 dock 列变量（如 `--left-dock-w`）
- [ ] **Step 2: 确认 FAIL**
- [ ] **Step 3: 实现**
  - 从 Rail.tsx 提取会话列表（项目切换器 + `buildSessionTree` 渲染 + 右键菜单 + 改名）与搜索（`query/searchOpen` 块）为 `LeftDock` 的两个 face；ManagerCard 保留在会话面顶部
  - MafwShell：新增 `leftDock` state（`LeftDockState`，持久化 `mafw-left-dock-face`/`mafw-left-dock-open`，mount 时 `migrateLegacyRail` 读旧键只迁一次）；`resolveMode(open, winMaximized(), viewportNarrow())` 驱动渲染
  - push 模式：`.mafw-shell` grid 增加左 dock 列（复用 `--rail-w` 过渡模式换名 `--left-dock-w`，沿用 ResizeHandle min 180 max 400 collapseThreshold 120，宽度存 `mafw-left-dock-width`）
  - overlay 模式：`.mafw-left-dock.overlay` 绝对定位盖住 chat 列；点外关闭 + **选中会话后仅 overlay 模式自动关**（Review Focus 3，push 不关）
  - 顶行左侧 rail 折叠按钮删除；Ctrl+B 改映射为 `toggleFace(s,"sessions")`；IconRail 接入 `.mafw-rail-col`（46px 常驻，`--rail-w` 退役）
- [ ] **Step 4: 契约测试 PASS + `npm test` 全绿 + tsgo rc=0**
- [ ] **Step 5: Commit** `feat(desktop): LeftDock dual-mode container + IconRail wiring, retire 200px Rail column`

### Task 5: 主区三列（chat 定宽 + 工作台默认开 + WelcomeHome 整页）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/workbench-defaults.ts`
- Test: `packages/desktop/src/renderer/mafw/workbench-defaults.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:1806+`（`.mafw-body` 网格与 WelcomeHome 渲染位）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/tests/workbench-layout-css.test.ts`

**Interfaces:**
- Consumes: 既有 `rightDockOpen/rightDockWidth/applyRightDock`、`ResizeHandle`、`viewportNarrow`
- Produces:
  ```ts
  export function defaultDockOpen(stored: string | null): boolean  // null → true
  export function defaultDockTab(stored: string | null): string    // null → "files"
  export const CHAT_WIDTH = { default: 340, min: 280, max: 480 }
  export function clampChatWidth(w: number): number
  ```

- [ ] **Step 1: 写失败测试**：`defaultDockOpen(null)===true`、`("0")===false`、`("1")===true`（Review Focus 1）；`defaultDockTab(null)==="files"`、存值透传；`clampChatWidth(200)===280`、`(340)===340`、`(999)===480`
- [ ] **Step 2: 确认 FAIL**
- [ ] **Step 3: 实现**
  - `rightDockOpen` 初始值改 `defaultDockOpen(localStorage.getItem("mafw-right-dock-open"))`；`rightDockTab` 同理改 `defaultDockTab(...)`
  - `.mafw-body` grid：chat 激活时 `chatWidth px | 1fr`（工作台吃剩余，`dock-width.ts` 的 per-tab clamp 在正常模式退役；<1200px 窄窗口沿用既有 overlay 化，overlay 宽度沿用 rightDockWidth）；chat 列右缘 ResizeHandle（min/max 用 `CHAT_WIDTH`，存 `mafw-chat-width`）
  - WelcomeHome：`showWelcome() || !activeSessionId()` 时**整页**渲染（grid 两列合并），不再塞进 chat 窄栏；选中会话回三列
- [ ] **Step 4: 测试 PASS + CSS 契约（grid 模板含 chat 宽度变量）PASS + 全量 `npm test`**
- [ ] **Step 5: Commit** `feat(desktop): chat column fixed width + workbench default-open + WelcomeHome full-page`

### Task 6: Dashboard 枢纽卡 + 五页面入口迁移

**Files:**
- Create: `packages/desktop/src/renderer/mafw/page-links.ts`
- Test: `packages/desktop/src/renderer/mafw/page-links.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/pages/Dashboard.tsx`（加「页面」链接卡）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（DashboardPage 调用点 ~1947 传 onNavigate；旧 Rail 的 NAV_TABS 渲染随 Rail 删除——确认 activeTab 页渲染逻辑保留）

**Interfaces:**
- Consumes: `components/nav-tab.ts` 的 `NAV_TABS`；`setActiveTab`
- Produces:
  ```ts
  export interface PageLink { id: Exclude<NavTab, "chat">; icon: string; label: string }
  export const PAGE_LINKS: PageLink[]  // NAV_TABS 减 chat
  ```
  `DashboardPage` 新 prop：`onNavigate: (tab: NavTab) => void`

- [ ] **Step 1: 写失败测试**：`PAGE_LINKS.length === 5`；id 集 = `{goals,memory,approvals,triage,automation}`；每项 icon/label 与 NAV_TABS 同源
- [ ] **Step 2: 确认 FAIL**
- [ ] **Step 3: 实现**：`page-links.ts`；Dashboard 顶部加「页面」卡（五个链接行，点击 `onNavigate(id)`；样式复用 Dashboard 既有卡）；MafwShell 接线 `onNavigate={(t) => { setActiveTab(t); setShowConfig(false) }}`；IconRail 📊 徽标确认接 `pendingPermissionCount()`（Review Focus 5，Task 3 已接则此处验证）
- [ ] **Step 4: 测试 PASS + 全量 `npm test`**
- [ ] **Step 5: Commit** `feat(desktop): Dashboard page-hub card for goals/memory/approvals/triage/automation`

### Task 7: 旧 Rail 拆除 + 死样式清理 + 终审前全量验证

**Files:**
- Delete: `packages/desktop/src/renderer/mafw/components/Rail.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（删 `.mafw-rail-*` 中死规则；保留被复用的）

- [ ] **Step 1: 验证 Rail 零引用**：`grep -r "from \"./Rail\"\|components/Rail" src/` 应无结果；`UsagePill` 的新家 = IconRail 底部或工作台「用量」tab（builder 定，倾向：用量入口本来就在右 dock tab，Rail 的 UsagePill 直接退役）
- [ ] **Step 2: 删 Rail.tsx + 清理 mafw.css 死规则**（保留 session-tree/ManagerCard 等被 LeftDock 复用的类）
- [ ] **Step 3: `npm test` 全绿 + `npx tsgo --noEmit` rc=0 + `npx electron-vite build` rc=0**
- [ ] **Step 4: Commit** `refactor(desktop): remove legacy Rail component and dead styles`
- [ ] **Step 5: 冒烟**：重启 dev，验证 ①默认开工作台且默认文件 tab ②窗口化点 💬=浮层 ③最大化点 💬=推挤 ④Ctrl+B 开关左 dock ⑤📊 徽标=待审批数 ⑥WelcomeHome 整页

---

## Self-Review 记录

- Spec 覆盖：D1→Task5；D2→Task1/2/4；D3→Task3/4；D4→无改动（spec 明确不变）；D5→Task4（会话面提取保留层级/徽标）；D6→Task6；D7→Task5；Builder 已决项→各 Task 内注明
- 类型一致性：`LeftDockFace/LeftDockMode/LeftDockState`（T1）↔ `IconRail.face`（T3）↔ `LeftDock.mode/face`（T4）一致；`PAGE_LINKS`（T6）↔ `NavTab`（nav-tab.ts）一致
- 比例：plan ≈ spec 1.3×，无代码本体转录
