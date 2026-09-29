# Desktop 布局开关重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (user chose inline execution). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dock 的 5 个 tab 回到 dock 内部；顶行两端各放一个统一的布局开关（左=侧边栏、右=面板），接管 rail 的折叠箭头与「轨迹」入口；加 `Ctrl+B` / `Ctrl+Alt+B`。

**Architecture:** 复用 `packages/ui` 内置的 `layout-left-full|partial` / `layout-right-full|partial` 图标（填充=开、描边=关，VS Code 语汇）。右开关调 `applyRightDock(!rightDockOpen())`（不带 tab → 沿用 `mafw-right-dock-tab` 记忆）。dock 内部恢复 `TabsV2` pill 五 tab（只切换不关闭）。

**Spec:** `docs/superpowers/specs/2026-09-29-desktop-layout-toggles-design.md`

## Global Constraints

- 禁止新增裸 `<button>`/裸 `title` 属性——按钮用 `ButtonV2`，提示用 `TooltipV2`（openDelay: 300）
- 测试：`cd packages/desktop && bun test`；typecheck：`bun run typecheck`（既有无关错误：tool-cards/automation.tsx marginBottom、tool-cards/python.tsx "rotate-ccw"、../ui/src/context/marked.tsx:535，勿修勿增）
- 构建：`npx electron-vite build` 必须通过
- **禁用 `git add -A`**：存在并发会话改同一工作树，每次只 `git add` 显式路径
- 拖拽区契约不变：`.mafw-topstrip` 是 drag 区，其内 `button` 已 no-drag（`.mafw-topstrip button`）
- 顶行双击守卫必须继续排除 `.mafw-session-tab`（不要改坏）
- 持久化键不得改：`mafw-rail-collapsed` / `mafw-rail-width` / `mafw-right-dock-open` / `mafw-right-dock-tab` / `mafw-right-dock-width`

---

### Task 1: dock tabs 归位（RightDock 恢复内部 tab 条，删除顶行图标组）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/RightDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Delete: `packages/desktop/src/renderer/mafw/components/DockTabButtons.tsx`
- Test: `packages/desktop/tests/design-contract.test.ts`

- [ ] **Step 1: 写失败测试**

在 design-contract.test.ts 的 `describe("topframe — 顶行框架")` 之后追加：

```ts
describe("layout-toggles — dock tabs 归位", () => {
  const read = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8")
  test("RightDock 内部恢复 TabsV2 五 tab + onTab", () => {
    const src = read("src/renderer/mafw/components/RightDock.tsx")
    expect(src).toContain("TabsV2")
    expect(src).toContain("onTab")
    for (const t of ["tasks", "trajectory", "usage", "notes", "changes"]) expect(src).toContain(`value="${t}"`)
    expect(src).toContain("mafw-right-dock-close")
  })
  test("DockTabButtons 组件删除且 MafwShell 不再引用", () => {
    expect(() => read("src/renderer/mafw/components/DockTabButtons.tsx")).toThrow()
    expect(read("src/renderer/mafw/MafwShell.tsx")).not.toContain("DockTabButtons")
  })
  test("CSS：恢复 dock 内 tabs-v2 规则，删除 .mafw-dock-button 规则", () => {
    expect(css).toContain('.mafw-right-dock [data-component="tabs-v2"]')
    expect(css).not.toContain(".mafw-dock-button")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop; bun test tests/design-contract.test.ts`
Expected: FAIL（RightDock 无 TabsV2、DockTabButtons.tsx 仍存在）

- [ ] **Step 3: 实现**

**3a. `RightDock.tsx`** 改为（从 `git show b3fc0c35^:packages/desktop/src/renderer/mafw/components/RightDock.tsx` 可取回原文，逐字恢复）：

```tsx
// @ts-nocheck
import { Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { TabsV2 } from "@mafw/ui/v2/tabs-v2"
import { type DockTab } from "./dock-tab"

export function RightDock(props: {
  open: boolean
  tab: DockTab
  width: number
  onClose: () => void
  onTab: (tab: DockTab) => void
  children: any
}) {
  return (
    <Show when={props.open}>
      <div class="mafw-right-dock" style={{ width: `${props.width}px` }}>
        <div class="mafw-right-dock-head">
          <TabsV2 value={props.tab} onChange={props.onTab} variant="pill">
            <TabsV2.List class="mafw-right-dock-tab-list">
              <TabsV2.Trigger value="tasks">📋 任务</TabsV2.Trigger>
              <TabsV2.Trigger value="trajectory">📊 轨迹</TabsV2.Trigger>
              <TabsV2.Trigger value="usage">📈 用量</TabsV2.Trigger>
              <TabsV2.Trigger value="notes">📝 便签</TabsV2.Trigger>
              <TabsV2.Trigger value="changes">🗒 改动</TabsV2.Trigger>
            </TabsV2.List>
          </TabsV2>
          <div class="mafw-right-dock-spacer" />
          <TooltipV2 value="关闭面板" openDelay={300}>
            <ButtonV2 variant="ghost" size="small" class="mafw-right-dock-close" onClick={props.onClose} aria-label="关闭面板">✕</ButtonV2>
          </TooltipV2>
        </div>
        <div class="mafw-right-dock-body">{props.children}</div>
      </div>
    </Show>
  )
}
```

**3b. `MafwShell.tsx`**：
- 删除 `import { DockTabButtons } from "./components/DockTabButtons"`（第 18 行附近）
- 顶行里删除 `<DockTabButtons … />` 那一行（保留 `SessionStrip`、`.mafw-topstrip-spacer`、`<WindowControls />`）
- `<RightDock …>` 调用恢复 `tab` 与 `onTab`：

```tsx
            <RightDock
              open={rightDockOpen()}
              tab={rightDockTab()}
              width={rightDockWidth()}
              onClose={() => applyRightDock(false)}
              onTab={(t) => applyRightDock(true, t)}
            >
```

**3c. `mafw.css`**：
- 恢复三条被删规则（原文见 `git show b3fc0c35^:packages/desktop/src/renderer/mafw/mafw.css`，形如 `.mafw-right-dock [data-component="tabs-v2"][data-variant="pill"][data-orientation="horizontal"] [data-slot="tabs-v2-trigger-wrapper"] { … }` 及 `:hover…`/`:has([data-selected])` 两条），插到 `.mafw-right-dock-head` 规则之后
- 删除 `.mafw-dock-buttons { … }` 与 `.mafw-dock-button.active { … }` 两条规则

**3d. 删除** `packages/desktop/src/renderer/mafw/components/DockTabButtons.tsx`

- [ ] **Step 4: 验证**

Run: `bun test tests/design-contract.test.ts; if ($?) { bun test }; if ($?) { npx electron-vite build }`
Expected: 新 3 条 PASS；全量 0 fail；build 通过

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/RightDock.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/design-contract.test.ts packages/desktop/src/renderer/mafw/components/DockTabButtons.tsx
git commit -m "refactor(desktop): dock 五 tab 归位到 dock 内部，退役顶行图标组"
```

---

### Task 2: 顶行两端布局开关 + 快捷键

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/tests/design-contract.test.ts`

**Interfaces:**
- Consumes: `railCollapsed()`/`applyRailCollapsed(c)`、`rightDockOpen()`/`applyRightDock(open, tab?)`（均为 MafwShell 既有）、`Icon`/`ButtonV2`/`TooltipV2` 已 import

- [ ] **Step 1: 写失败测试**

```ts
describe("layout-toggles — 顶行两端开关", () => {
  const read = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8")
  test("顶行左端=侧边栏开关，右端=面板开关（填充/描边成对图标）", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).toContain("layout-left-full")
    expect(shell).toContain("layout-left-partial")
    expect(shell).toContain("layout-right-full")
    expect(shell).toContain("layout-right-partial")
    expect(shell).toMatch(/applyRailCollapsed\(!railCollapsed\(\)\)/)
    expect(shell).toMatch(/applyRightDock\(!rightDockOpen\(\)\)/)
  })
  test("两个开关都带 aria-pressed 与 tooltip 快捷键提示", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect((shell.match(/aria-pressed/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(shell).toContain("Ctrl+B")
    expect(shell).toContain("Ctrl+Alt+B")
  })
  test("快捷键分支：Ctrl+B 切侧边栏、Ctrl+Alt+B 切面板（跳过输入框）", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).toMatch(/e\.altKey[\s\S]{0,200}applyRightDock/)
    expect(shell).toContain("isContentEditable")
  })
  test("CSS：布局开关为 no-drag 的 ghost 按钮（复用 topstrip button 规则）", () => {
    expect(css).toMatch(/\.mafw-topstrip\s+button[^{]*\{[^}]*-webkit-app-region:\s*no-drag/)
    expect(css).toContain(".mafw-layout-toggle")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

**3a. 顶行 JSX**（左开关在 `SessionStrip` 之前，右开关在 `WindowControls` 之前）：

```tsx
        <TooltipV2 value={`${railCollapsed() ? "显示" : "隐藏"}侧边栏 (Ctrl+B)`} openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-layout-toggle"
            aria-label="切换侧边栏"
            aria-pressed={!railCollapsed()}
            onClick={() => applyRailCollapsed(!railCollapsed())}
          >
            <Icon name={railCollapsed() ? "layout-left-partial" : "layout-left-full"} size="small" />
          </ButtonV2>
        </TooltipV2>
        <SessionStrip … 既有 props 原样 … />
        <div class="mafw-topstrip-spacer" />
        <TooltipV2 value={`${rightDockOpen() ? "隐藏" : "显示"}面板 (Ctrl+Alt+B)`} openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-layout-toggle"
            aria-label="切换面板"
            aria-pressed={rightDockOpen()}
            onClick={() => applyRightDock(!rightDockOpen())}
          >
            <Icon name={rightDockOpen() ? "layout-right-full" : "layout-right-partial"} size="small" />
          </ButtonV2>
        </TooltipV2>
        <WindowControls />
```

**3b. 快捷键 effect**（放在 MafwShell 其他 `createEffect` 附近，与既有 Ctrl+O 守卫同款）：

```tsx
  // 布局开关快捷键（VS Code 惯例）：Ctrl+B 侧边栏、Ctrl+Alt+B 面板
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
      if (e.key !== "b" && e.key !== "B") return
      e.preventDefault()
      if (e.altKey) applyRightDock(!rightDockOpen())
      else applyRailCollapsed(!railCollapsed())
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })
```

**3c. `mafw.css`**：

```css
.mafw-layout-toggle { color: var(--text-3); flex-shrink: 0; }
.mafw-layout-toggle:hover { color: var(--text-1); }
.mafw-layout-toggle[aria-pressed="true"] { color: var(--text-2); }
```

- [ ] **Step 4: 验证**

Run: `bun test tests/design-contract.test.ts; if ($?) { bun test }; if ($?) { npx electron-vite build }`
Expected: 新 4 条 PASS；全量 0 fail；build 通过

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/design-contract.test.ts
git commit -m "feat(desktop): 顶行两端布局开关（侧边栏/面板，填充-描边成对图标）+ Ctrl+B / Ctrl+Alt+B"
```

---

### Task 3: Rail 瘦身（删折叠箭头 + 折叠态展开按钮 + 轨迹入口）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/Rail.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（删无用规则，若有）
- Test: `packages/desktop/tests/design-contract.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe("layout-toggles — Rail 瘦身", () => {
  const read = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8")
  test("Rail 不再有折叠箭头与轨迹入口", () => {
    const rail = read("src/renderer/mafw/components/Rail.tsx")
    expect(rail).not.toContain("mafw-rail-collapse")
    expect(rail).not.toContain("onOpenTrajectory")
    expect(rail).not.toContain("onToggleCollapsed")
  })
  test("MafwShell 不再传 onOpenTrajectory / onToggleCollapsed，且折叠态无展开按钮", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).not.toContain("onOpenTrajectory")
    expect(shell).not.toContain("onToggleCollapsed")
    expect(shell).not.toContain("mafw-rail-expand")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

- `Rail.tsx`：删除 `.mafw-rail-collapse` 那个 `ButtonV2`（约 330 行）、删除轨迹导航项（约 373 行的 `<button … onClick={() => props.onOpenTrajectory?.()}>` 整块）、从 props 类型删除 `onOpenTrajectory?: () => void` 与 `onToggleCollapsed?: () => void`
- `MafwShell.tsx`：`<Rail …>` 调用里删除 `onToggleCollapsed` 与 `onOpenTrajectory` 两个 prop；删除折叠态块里的展开按钮（`.mafw-rail-expand` + `Icon chevron-right`，保留 `.mafw-rail-collapsed` 容器与品牌 logo）
- `mafw.css`：grep `mafw-rail-collapse` / `mafw-rail-expand` 确认无残留规则，有则删

- [ ] **Step 4: 验证**

Run: `bun test tests/design-contract.test.ts; if ($?) { bun test }; if ($?) { bun run typecheck }`
Expected: 新 2 条 PASS；全量 0 fail；typecheck 无新增错误

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/Rail.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/design-contract.test.ts
git commit -m "refactor(desktop): Rail 瘦身——折叠箭头/展开按钮/轨迹入口统一并入顶行开关"
```

---

### Task 4: CDP 端到端实测

- [ ] **Step 1: reload 后断言顶行结构**

```js
// 经 C:\Users\15524\AppData\Local\Temp\opencode\cdp-eval.mjs（或写脚本规避引号问题）
JSON.stringify({
  leftToggle: !!document.querySelector('.mafw-topstrip .mafw-layout-toggle'),
  toggleCount: document.querySelectorAll('.mafw-topstrip .mafw-layout-toggle').length,
  leftIsFirst: document.querySelector('.mafw-topstrip').firstElementChild?.classList.contains('mafw-layout-toggle'),
  railArrowGone: !document.querySelector('.mafw-rail-collapse'),
  railTrajectoryGone: !document.querySelector('.mafw-rail-nav-item[aria-label="轨迹"]')
})
```
Expected: toggleCount=2、leftIsFirst=true、railArrowGone/railTrajectoryGone=true

- [ ] **Step 2: 交互实测**（逐个点击 + 量测）
  - 点左开关：rail 从 264 → 32（折叠）→ 再点回 264；`.mafw-rail-collapsed` 存在
  - 点右开关：dock 打开（宽度=记忆值）且**停在记忆 tab**；再点关闭
  - 打开 dock 后点 dock 内第 2 个 tab：内容切换、dock 保持打开
  - 键盘 `Ctrl+B` / `Ctrl+Alt+B`：等效切栏；在输入框聚焦时不触发
- [ ] **Step 3: 截图存档**（`cdp-shot.cjs`），交给用户目视确认
- [ ] **Step 4: 发现问题回到对应 Task 修复并重跑验证；全通过结束（验证任务无 commit）**

---

## Self-Review 记录

- Spec 覆盖：§3 四决策 → Task1(Q3)、Task2(Q1/Q2/Q4)、Task3(Q1 补充/轨迹迁移)；§4.1-4.7 → Task1/2/3；§5 保留行为 → Task1 恢复 `onTab`、Task2 不改持久化键、Task3 保留容器；§6 测试 → 各 Task Step1 + Task4；§7 非目标未引入 ✓
- 类型一致性：`RightDock` props 恢复 `tab: DockTab`/`onTab: (tab: DockTab) => void`，与 Task1 Step3b 调用一致；`applyRightDock(open, tab?)` 既有签名兼容「不带 tab」调用 ✓
- 已知中间态：Task2 完成后 Task3 前，rail 内旧折叠箭头与轨迹项仍在（重复入口），功能不冲突；Task3 清理 ✓
