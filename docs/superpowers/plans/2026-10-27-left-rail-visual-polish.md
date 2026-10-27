# Left Rail Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 左侧 rail 收起态/展开态视觉与功能整理——六钮一图标家族、新建常驻、主题迁 Config、标题/项目名零泄漏、Manager 置顶单行、左 dock 推挤改为默认档 50:50 预算。

**Architecture:** 纯函数先行（rail-display / left-dock budget / workbench-detents 常量），再动组件（IconRail/LeftDock/ManagerCard/WelcomeHome/Config），每步 TDD + 全量绿。所有 UI 走 @mafw/ui 组件，新图标进 `packages/ui` icon 表。

**Tech Stack:** SolidJS + Electron（packages/desktop）、@mafw/ui、node --test + @mafw/test-shim、tsgo、electron-vite。

**Spec:** `docs/superpowers/specs/2026-10-27-left-rail-visual-polish-design.md`（含前置调研 `docs/research/2026-10-27-left-rail-visual-polish-research.md`；视觉定稿 mockup `.superpowers/brainstorm/leftrail-20261027/content/options-4.html`）

## Global Constraints

- UI 组件一律 @mafw/ui：ButtonV2 / TooltipV2 / ContextMenu / TextInputV2；禁新增 raw `<button>`/`<input>`/裸 `title`
- 图标只进 `packages/ui/src/components/icon.tsx` 的 name→path 表；rail 内不放内联 SVG（现有 ☀/moon 内联随主题钮一起删）
- 测试约定：纯函数 test 与源码同目录 `.test.ts`；source contract / CSS 契约进 `packages/desktop/tests/`；运行 `node --import tsx --import ../../packages/test-shim/register.mjs --test <file>`（cwd=packages/desktop），全量 `npm test`
- 质量门：`npx tsgo -b` rc=0、`npx electron-vite build` rc=0、desktop 全量绿；交付报告新增测试数 + 全量通过数（用户惯例）
- Windows dev CSS 坑：`mafw.css` 整文件编辑后 Vite 可能漏变更事件——GUI 验证前 touch 该文件或重启 `npm run dev`（AGENTS.md 2026-10-26 实证）
- IA 冻结：faces 三面（工作/搜索/便签）不动；不触碰右工作台结构；faces IA 相关决定见 spec §3 非目标
- `mafw-breathe` keyframes **保留**（titlebar/agent-row 等仍有消费者），只删 conn-dot 上的引用

## Review Focus

（spec 隐含、易踩、无任务测试覆盖的输入类——每条已钉进所属任务）

1. **SSE `session.updated` 会把标签页标题写回原始 ISO** → Task 8 钉 `openSessionTab` 与 updated 双写两处都过 `formatRailTitle`
2. **重命名草稿污染**：改名框 seed 了格式化标题会把「未命名 · 10月13日」持久化 → Task 6 source contract 钉 `startRename` 绑原始 `node.title`
3. **worktree 能力关闭时右键菜单仍两项** → Task 5 source contract 钉 `Show` 门（`worktreeEnabled()`）
4. **chat 拉到 760 档在预算内窗口应被钳回 640**（只保默认档）→ Task 2 测试 `chatPxForDetent(760, 1280) === 640`
5. **push 态拖 dock 宽越过预算点导致模式翻转、手柄消失** → Task 3 测试 `leftDockPushDragMax(1600) === 264`

---

### Task 1: rail-display 纯函数三件套

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/rail-display.ts`
- Test: `packages/desktop/src/renderer/mafw/components/rail-display.test.ts`

**Interfaces:**
- Produces（后续任务全靠这三个名字）:
  - `formatRailTitle(title: string | null | undefined): string`
  - `railProjectName(raw: string | null | undefined, isCurrent: boolean): string`
  - `managerPhaseLabel(phase: string | null | undefined): string`

- [ ] **Step 1: 写失败测试**

```ts
import test from "node:test"; import assert from "node:assert/strict"
import { formatRailTitle, railProjectName, managerPhaseLabel } from "./rail-display"

test("formatRailTitle：ISO 兜底 → 未命名 · 本地日期段", () => {
  assert.equal(formatRailTitle("New session - 2026-10-13T06:28:19.923Z"), "未命名 · 10月13日")
  assert.equal(formatRailTitle("New session - 2026-09-03T02:54:36.009Z"), "未命名 · 9月3日")
})
test("formatRailTitle：空 → 未命名；普通标题原样；幂等", () => {
  assert.equal(formatRailTitle(""), "未命名"); assert.equal(formatRailTitle("  "), "未命名")
  assert.equal(formatRailTitle("大脑视觉符号与LLM视觉眼调研"), "大脑视觉符号与LLM视觉眼调研")
  const once = formatRailTitle("New session - 2026-10-13T06:28:19.923Z")
  assert.equal(formatRailTitle(once), once) // 幂等：choke 点可重复包
})
test("railProjectName：basename；退化名按 isCurrent 分流", () => {
  assert.equal(railProjectName("C:\\work\\opencode-plugin-mafw", true), "opencode-plugin-mafw")
  assert.equal(railProjectName(".", true), "当前项目")
  assert.equal(railProjectName(".", false), "未命名项目")
  assert.equal(railProjectName("", true), "当前项目")
  assert.equal(railProjectName("C:\\work\\look\\", true), "当前项目") // 尾分隔符 → pop 为空
})
test("managerPhaseLabel：四映射 + 空闲 + 英文回退", () => {
  assert.equal(managerPhaseLabel("PLANNING"), "规划中")
  assert.equal(managerPhaseLabel("EXECUTING"), "执行中")
  assert.equal(managerPhaseLabel("REVIEWING"), "审阅中")
  assert.equal(managerPhaseLabel("ASKING_USER"), "待提问")
  assert.equal(managerPhaseLabel(null), "空闲"); assert.equal(managerPhaseLabel(undefined), "空闲")
  assert.equal(managerPhaseLabel("SOMETHING_ELSE"), "SOMETHING_ELSE")
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/rail-display.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 rail-display.ts**

- `formatRailTitle`：`/^New session - (\d{4})-(\d{2})-(\d{2})T/` 捕获日期段 → `未命名 · ${+M}月${+D}日`（**不做时区换算**，取字面日期）；trim 后空 → `"未命名"`；其余原样。null/undefined 按 `"未命名"`。
- `railProjectName`：`raw.split(/[/\\]/).pop()` 为空 / `"."` → `isCurrent ? "当前项目" : "未命名项目"`；否则返回 pop。
- `managerPhaseLabel`：四条映射表 + null/undefined → `"空闲"`，未知 → 原样。

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2。Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/rail-display.ts packages/desktop/src/renderer/mafw/components/rail-display.test.ts
git commit -m "feat(desktop): rail display pure helpers (title/project/phase)"
```

---

### Task 2: 工作台下限 520 → 640

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/workbench-detents.ts:12`（`WORKBENCH_MIN_WIDTH`）+ 首行注释护栏公式
- Test: `packages/desktop/src/renderer/mafw/workbench-detents.test.ts`

**Interfaces:**
- Produces: `WORKBENCH_MIN_WIDTH = 640`（chatPxForDetent 护栏随动；Task 3 的 budget 数字 1280 依赖此语义但为独立常量）
- Consumes: 无

- [ ] **Step 1: 改测试期望（先失败）**

在 workbench-detents.test.ts 增/改用例：
- `chatPxForDetent(760, 1280) === 640`（Review Focus #4：760 档在预算内钳回 640）
- `chatPxForDetent(640, 1344) === 640`（可用宽减 640 后仍容 640）
- `chatPxForDetent(640, 1154) === 514`（1200 窗：chat 让位保工作台 640）
- 全局 grep `520` 里所有引用工作台下限语义的断言改为 640（注意别误改 520 **档位**的断言——档位不变）

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/workbench-detents.test.ts`
Expected: FAIL（旧 520 护栏）

- [ ] **Step 3: 实现**

`WORKBENCH_MIN_WIDTH: 520 → 640`；文件头注释「护栏：chat = clamp(detent, 320, min(760, availableWidth − 640 工作台下限))」；grep 全包确认无其他 520 按工作台下限语义的硬编码（`left-dock.ts` 的 `RIGHT_WORKBENCH_MIN_WIDTH = 520` 是纵深防御夹紧，**不动**，加一行注释说明）。

- [ ] **Step 4: 跑测试确认通过**（同 Step 2，Expected: PASS）

- [ ] **Step 5: 全量回归**：`npm test` 全绿（snapDetent 等既有用例不因 640 崩——若有用例依赖 520 边界，按新语义修正断言）

- [ ] **Step 6: Commit** `git add -A packages/desktop/src/renderer/mafw && git commit -m "feat(desktop): workbench min width 640 (50:50 baseline)"`

---

### Task 3: 左 dock 50:50 推挤预算（纯函数 + 接线）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/left-dock.ts`（budget 函数 + 三个签名）
- Modify: `packages/desktop/src/renderer/mafw/left-dock.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（grep `resolveMode` / `restoreLeftDockOpen` / `shouldAutoRestoreLeftDock` 三个调用点）
- Modify: `packages/desktop/src/renderer/mafw/components/LeftDock.tsx:398-408`（ResizeHandle max）
- Test: `packages/desktop/tests/left-dock-width-wiring.test.ts`（扩展）

**Interfaces:**
- Produces:
  - `leftDockPushBudget(dockWidth: number): number` = `46 + dockWidth + 1280`
  - `leftDockPushDragMax(viewportWidth: number): number` = `clamp(min(400, W − 46 − 1280), 180, 400)`
  - `resolveMode(open: boolean, width: number, dockWidth: number): LeftDockMode`（push ⟺ `width >= leftDockPushBudget(dockWidth)`）
  - `restoreLeftDockOpen(stored: string | null, width: number, dockWidth: number): boolean`
  - `shouldAutoRestoreLeftDock(stored: string | null, open: boolean, width: number, dockWidth: number): boolean`
  - `LeftDockProps` 新增 `resizeMax?: number`（默认 400）
- 删除: `LEFT_DOCK_PUSH_MIN_WIDTH`（旧 1366 常量）
- Consumes: Task 2 的语义（1280 = 640 + 640；数字独立成常量 `PUSH_PAIR_BUDGET = 1280`，注释指向 spec §6.5）

- [ ] **Step 1: 改 left-dock.test.ts 用例（先失败）**

- `leftDockPushBudget(264) === 1590`、`(400) === 1726`、`(180) === 1506`
- `resolveMode(true, 1589, 264) === "overlay"`；`resolveMode(true, 1590, 264) === "push"`；`resolveMode(true, 1725, 400) === "overlay"`；`resolveMode(false, 2048, 264) === "closed"`
- `restoreLeftDockOpen("1", 1390, 264) === false`；`("1", 1590, 264) === true`
- `shouldAutoRestoreLeftDock("1", false, 1589, 264) === false`；`("1", false, 1590, 264) === true`
- `leftDockPushDragMax(1600) === 264`（Review Focus #5）；`leftDockPushDragMax(2048) === 400`
- 删除引用 `LEFT_DOCK_PUSH_MIN_WIDTH`/1366 的旧用例；`effectiveLeftDockWidth` 用例保留（纵深防御语义不变）

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/left-dock.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 left-dock.ts**

新常量 + 两个导出函数 + 三函数签名改造；`leftDockMode`/restore/auto-restore 全部以 budget 为单一真相；`effectiveLeftDockWidth` 不动（加注释「纵深防御：push 恒满足预算后实际不再触发」）。

- [ ] **Step 4: 跑测试确认通过**（同 Step 2，PASS）

- [ ] **Step 5: MafwShell/LeftDock 接线**

- 三个调用点补传 `leftDockWidth()`（boot restore 用启动时解析出的 dock 宽，与 leftDockWidth signal 初值同源）
- MafwShell 计算 `railResizeMax = () => leftDockPushDragMax(viewportWidth())`，传 `resizeMax={railResizeMax()}` 给 `<LeftDock>`
- LeftDock ResizeHandle `max={props.resizeMax ?? 400}`
- 扩展 `tests/left-dock-width-wiring.test.ts`：MafwShell 源含 `leftDockPushBudget(`、`leftDockPushDragMax(`、`resizeMax`；LeftDock 源含 `props.resizeMax`；不再含 `LEFT_DOCK_PUSH_MIN_WIDTH`

- [ ] **Step 6: 全量回归 + tsgo**：`npm test` 绿；`npx tsgo -b` rc=0

- [ ] **Step 7: Commit** `git commit -m "feat(desktop): left dock 50:50 push budget (default-detent guarantee)"`

---

### Task 4: ui icon 表三条新图标

**Files:**
- Modify: `packages/ui/src/components/icon.tsx`（新增 `chat` / `sticky-note` / `layout-grid` 三条）
- Test: `packages/desktop/tests/ui-icon-entries.test.ts`（新建，source contract）

**Interfaces:**
- Produces: Icon name `"chat"`、`"sticky-note"`、`"layout-grid"`（Task 5 IconRail 直接引用）
- 形状参照（视觉定稿）：`.superpowers/brainstorm/leftrail-20261027/content/options-4.html` 里最终版的三个 SVG——`chat`=圆角气泡+尾巴**无内部横线**；`sticky-note`=便利贴折角；`layout-grid`=2×2 圆角方块。路径按 icon.tsx 既有条目的 viewBox/坐标习惯适配（表内条目约 20 单位网格、stroke currentColor）；三件笔重/留白密度必须一致（spec §6.1）。

- [ ] **Step 1: 写失败测试**

`packages/desktop/tests/ui-icon-entries.test.ts`：读 `../../ui/src/components/icon.tsx`（fs），断言含 `"chat"`、`"sticky-note"`、`"layout-grid"` 三个键且各含至少一条 `stroke="currentColor"` 的 path。

- [ ] **Step 2: 跑测试确认失败**（cwd=packages/desktop）`node --import tsx --import ../../packages/test-shim/register.mjs --test tests/ui-icon-entries.test.ts`

- [ ] **Step 3: 实现三条图标条目**（沿用表内格式；不自造新结构）

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: Commit** `git commit -m "feat(ui): chat/sticky-note/layout-grid icons for left rail"`

---

### Task 5: IconRail 六钮重构 + MafwShell rail 接线 + CSS

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/IconRail.tsx`（props + 分组 + ContextMenu）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（IconRail 调用 ~1835：grep `<IconRail`）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:2906-2972`（rail 样式块）
- Test: `packages/desktop/tests/icon-rail-wiring.test.ts`（新建）
- Test: `packages/desktop/tests/design-contract.test.ts`（grep「IconRail 承接主题切换」旧契约，重写）

**Interfaces:**
- IconRailProps 变更: **删** `theme` / `onToggleTheme`；**增** `onNewSession: () => void`、`onNewWorktreeSession?: () => void`、`worktreeEnabled?: boolean`
- Consumes: Task 4 的 `chat` / `sticky-note` / `layout-grid`；MafwShell 现有 `worktreeEnabled()` / `createWorktreeSession`（~832-854）与传给 LeftDock 的 `onNewSession` 同款 handler

- [ ] **Step 1: 写失败测试**

`tests/icon-rail-wiring.test.ts`（fs 读两个源文件）：
- IconRail.tsx：含 `onNewSession`、`onNewWorktreeSession`、`worktreeEnabled`、`ContextMenu`、`icon: "chat"`、`icon: "sticky-note"`、`icon: "layout-grid"`；**不含** `onToggleTheme`、`☀`、`<svg`（内联 SVG 全退役）
- 分组结构：`topItems` 消失，改为 action / destination（工作+搜索+便签三连）/ 单 spacer / meta（Dashboard+Config）——断言源码顺序（destination 三项之间无 spacer）
- MafwShell.tsx：`<IconRail` 调用含 `onNewSession={`、`onNewWorktreeSession=`、`worktreeEnabled={`；不含 `onToggleTheme={toggleTheme}` 传给 IconRail 的用法（ChatPane 的保留）
- design-contract.test.ts：删除「IconRail 承接主题切换」断言，新增「IconRail 不再承接主题；新建/并行菜单在 rail」契约

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test tests/icon-rail-wiring.test.ts tests/design-contract.test.ts`

- [ ] **Step 3: 重写 IconRail.tsx**

- 三组：`actionItems`（＋：`plus-small` 图标、dashed action 样式类 `mafw-icon-rail-icon new-action`）；`destinationItems`（sessions=`chat` / search=`magnifying-glass` / notes=`sticky-note` 连排）；spacer 一个；`metaItems`（dashboard=`layout-grid` + badge / config=`settings-gear` + connDot）
- ＋ 用 `ContextMenu` 包 ButtonV2（同 LeftDock 会话行用法）：Content 两项——「新建会话」`onSelect={onNewSession}`；「⎇ 并行 worktree」`<Show when={worktreeEnabled() && onNewWorktreeSession}>`（Review Focus #3）
- 删 theme item + ☀/moon 内联 SVG + `theme` prop

- [ ] **Step 4: MafwShell 接线**（grep `<IconRail`，删 theme 两 prop，增三个新 prop；worktree 门内联 `worktreeEnabled() ? () => void createWorktreeSession() : undefined`）

- [ ] **Step 5: CSS（mafw.css rail 块）**

- `.mafw-icon-rail` gap 4→5px；`.mafw-icon-rail-icon` 32→34（含 ButtonV2 钉死选择器 `min-height: 34px`）、radius 8→9
- `.active`：`background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent)`；**删** `box-shadow: inset 2px 0 0`
- 新增 `.mafw-icon-rail-icon.new-action { border: 1px dashed color-mix(in srgb, var(--accent) 45%, transparent); background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--accent); }`
- conn-dot：5px；`.ready/.reconnecting/.starting` 删 `box-shadow` 与 `animation: mafw-breathe`（颜色保留）；**keyframes 本体不动**
- CSS 契约测试（并入 icon-rail-wiring.test.ts 或新增 `tests/rail-visual-css.test.ts`）：断言 mafw.css 含 `new-action`、`12%, transparent`（active 填充块）、不含 `.ready` 后的 `mafw-breathe` 引用（全局 keyframes 仍存在——用「conn-dot 行不引用」的断言写法）

- [ ] **Step 6: 全量 + tsgo + build**（改了 mafw.css：GUI 看效果前先 touch/重启 dev——见 Global Constraints）

- [ ] **Step 7: Commit** `git commit -m "feat(desktop): six-button icon rail with pinned new-session action"`

---

### Task 6: LeftDock 列表视觉收口

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/LeftDock.tsx`（renderNode 216 / switcher 274-299 / project head 356-362 / date group 364-374）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:465-480`
- Test: `packages/desktop/tests/left-dock-wiring.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 三函数
- 不动: `startRename`（168 行，seed `node.title` 原始值——数据层保持 raw，Review Focus #2）

- [ ] **Step 1: 写失败测试**

`tests/left-dock-wiring.test.ts`（fs 读 LeftDock.tsx + mafw.css）：
- 含 `formatRailTitle(`（renderNode 显示用）、`railProjectName(`（≥3 处：switcher 触发条、下拉项、project head）
- switcher 源码顺序：`switcher-name` 在 `switcher-caret` **之前**（chevron 后置）
- `startRename` 仍绑 `node.title`（不绑 `formatRailTitle`）
- date group：不含 `mafw-rail-date-count` 渲染；mafw.css 不含 `.mafw-rail-date-group::after` 规则、`.mafw-rail-date-group` 色值为 `var(--text-4)`

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

- renderNode 标题 span：`{formatRailTitle(node.title)}`（tooltip/改名输入不动）
- switcher：`{railProjectName(currentProject()?.worktree, true)}` + chevron 移到名字后；下拉项 `railProjectName(p.worktree || p.id, (p.worktree || p.id) === projectID())`
- project head：`railProjectName(projectNode()!.name || projectNode()!.projectID, true)`
- date group 删 count span；CSS 删 `::after` 与 `.mafw-rail-date-count` 规则，分组头色 → `var(--text-4)`

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

- [ ] **Step 5: Commit** `git commit -m "feat(desktop): left dock list polish (quiet groups, clean titles, name fallback)"`

---

### Task 7: ManagerCard 置顶单行

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ManagerCard.tsx`（重写渲染）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css:482-495`（card 块 → row 块）
- Test: `packages/desktop/tests/manager-row-wiring.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 `managerPhaseLabel`；props 签名不变
- 渲染目标：单行 32px——`● Manager · <managerPhaseLabel(goal().phase)> · <relTime>` + 红色 pill（pending>0）+ 行底 2px accent 进度细线；idle 态 `● Manager · 空闲 · <relTime>`；点击/badge 交互保持

- [ ] **Step 1: 写失败测试**

`tests/manager-row-wiring.test.ts`：ManagerCard.tsx 含 `managerPhaseLabel(`、单行容器类 `mafw-manager-row`、进度细线元素；**不含** `mafw-manager-card-goal` / `mafw-manager-card-meta` 三行结构；mafw.css 含 `.mafw-manager-row` 且 `height: 32px`、无 `.mafw-manager-card {` 块。

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现单行结构**（CSS：row 32px、margin 2px 6px、radius 4、`box-shadow: inset 2px 0 0 var(--accent)`、bg `color-mix(accent 7%)`；badge/dot 类名沿用）

- [ ] **Step 4: 跑测试通过 + 全量**

- [ ] **Step 5: Commit** `git commit -m "feat(desktop): manager pinned row replaces card"`

---

### Task 8: WelcomeHome + 标签页标题 choke points

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/WelcomeHome.tsx:87/93/241`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（grep `openSessionTab` + session.updated 的 tab 标题双写处——grep `session.updated` / `sessions(` 双写）
- Test: `packages/desktop/tests/title-leak-wiring.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 `formatRailTitle`（幂等，choke 点可重复包裹）

- [ ] **Step 1: 写失败测试**

`tests/title-leak-wiring.test.ts`：
- WelcomeHome.tsx 含 `formatRailTitle(`（merged 列表构建处）
- MafwShell.tsx：`openSessionTab` 定义处标题写入过 `formatRailTitle(`；session.updated 分支的 tab 标题双写处过 `formatRailTitle(`（Review Focus #1）
- 两文件均不再直接渲染 `s.title` 进 tab 标题（源断言按实际 grep 结果写）

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

- WelcomeHome merged 构建：`title: formatRailTitle(s.title || "")`（`|| s.id` 兜底改统一「未命名」，渲染点 241 随动）
- openSessionTab：写 tab 标题前 `formatRailTitle(title)`
- updated 双写：两处写入同样包裹
- LeftDock openNode **不改动**（继续传原始 `node.title`，choke 点统一在 MafwShell）

- [ ] **Step 4: 跑测试通过 + 全量**

- [ ] **Step 5: Commit** `git commit -m "feat(desktop): session title leak sealed at all render surfaces"`

---

### Task 9: 主题迁 Config（Desktop · 外观）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pages/Config.tsx`（Desktop 页新增「外观」内联小节）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（`<ConfigPage` 增传 theme props；grep `initialSection`）
- Test: `packages/desktop/tests/theme-config-wiring.test.ts`（新建）

**Interfaces:**
- ConfigPage props 增：`theme?: string`、`onToggleTheme?: () => void`（复用 MafwShell `toggleTheme` 与 `theme.ts` 纯函数；**不加 NavKey**——Desktop 页内联小节）
- Consumes: theme.ts `readSavedTheme/nextTheme/applyTheme`（只读展示当前，切换走 onToggleTheme）

- [ ] **Step 1: 写失败测试**

`tests/theme-config-wiring.test.ts`：
- Config.tsx 含「外观」小节 + `onToggleTheme` 按钮（ButtonV2）；**不含**新 NavKey（config-nav.ts 无 `appearance` 键）
- MafwShell：`<ConfigPage` 调用传 `theme=`、`onToggleTheme={toggleTheme}`；IconRail 调用不含 `onToggleTheme`（Task 5 已保证，此处回归钉扎）
- ChatPane.tsx 含 `/theme` 命令与 `onToggleTheme`（Review Focus：命令兜底存活）

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**（Config Desktop 页加 `.mafw-config-section` 内联块：当前主题名 + 切换按钮；MafwShell 传 props）

- [ ] **Step 4: 跑测试通过 + 全量**

- [ ] **Step 5: Commit** `git commit -m "feat(desktop): theme toggle moves into Config appearance section"`

---

### Task 10: 全量门 + GUI 冒烟 + 交付记录

**Files:**
- Modify: `AGENTS.md`（Desktop 段交付记录）

**Interfaces:** 无代码——验收与记录

- [ ] **Step 1: 全量门**

`npm test`（报告新增测试数 + 全量通过数）；`npx tsgo -b` rc=0；`npx electron-vite build` rc=0

- [ ] **Step 2: GUI 冒烟（dev app，touch mafw.css 或重启 dev 后）**

- rail 六钮一屏（＋/工作/搜索/便签/Dashboard/Config）；＋单击建会话；右键两项（desktop 走 opencode runtime，worktreeApi=true 应两项全显）
- 激活为填充块；连接点无辉光无动画；主题在 Config Desktop「外观」可切、`/theme` 命令仍可切
- dock 列表无 ISO 串/无 `.` 项目名；Manager 单行；分组头无横线无计数
- 1390 窗开 dock = 浮层（chat 宽一像素不变）；拉到 ≥1590 开 dock = 推挤且工作台 ≥640；push 态拖 dock 宽上限钳在预算内；reload 后偏好保留

- [ ] **Step 3: AGENTS.md 交付记录**（版本号 + commit 哈希 + 新增/全量测试数——用户惯例）

- [ ] **Step 4: Commit** `git commit -m "docs: left rail visual polish delivery record"`
