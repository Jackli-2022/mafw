# Desktop 顶框架构重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SessionStrip 升入顶行与窗口控制平齐，RightDock 的 tab 开关并入顶行图标组，Rail 通高并吸收品牌区（logo/状态点/主题切换），删除独立 titlebar 行。

**Architecture:** `.mafw-shell` 从「titlebar 行 + body 三列 grid」改为「两列 grid：rail 通高 | 右列（strip 行 38px + main|dock 行）」。SessionStrip 提取为独立组件并提升为全局恒显；RightDock 删除自身 tab 条，开关由 strip 行右侧图标按钮组驱动（点击=打开/切换，点当前高亮=关闭）；WindowControls 移到 strip 行最右端。

**Tech Stack:** SolidJS + Electron（frameless，win32 自绘窗口控制）+ bun test（设计契约为源码/CSS 断言风格）。

**Spec:** `docs/superpowers/specs/2026-09-29-desktop-topframe-design.md`

## Global Constraints

- 禁止新增裸 `<button>`/裸 `title` 属性——按钮用 `ButtonV2`，提示用 `TooltipV2`（openDelay: 300）
- 测试：`cd packages/desktop && bun test`；typecheck：`bun run typecheck`（既有 2 个无关错误：automation.tsx marginBottom、python.tsx "rotate-ccw"，勿修勿增）
- 构建：`npx electron-vite build` 必须通过
- **禁用 `git add -A`**：存在并发会话改同一工作树，每次只 `git add` 显式路径
- 拖拽区契约：strip 行/rail 品牌行 `-webkit-app-region: drag`；一切可交互子元素 `no-drag`
- ChatPane 会话级工具行（`.mafw-session-titlebar`，含并行/细节按钮）**不动**
- 非 chat 页顶行恒显会话 tab；点 tab 切回 chat（既有 onClick 语义原样）

---

### Task 1: SessionStrip 组件提取（原位渲染，无视觉变化）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/SessionStrip.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（chat 分支内联 JSX 替换为组件；renamingId/renameDraft 信号移入组件）
- Test: `packages/desktop/tests/design-contract.test.ts`

**Interfaces:**
- Produces（后续任务依赖）:
  ```ts
  export function SessionStrip(props: {
    sessions: () => { id: string; title: string; manager?: boolean }[]
    activeViewId: () => string | null
    onSelect: (id: string) => void
    onClose: (id: string) => void
    onRename: (id: string, title: string) => void   // 内部不做持久化，只回传
    onExport: (id: string) => void
    onCopyId: (id: string) => void
    onNew: () => void
  })
  ```

- [ ] **Step 1: 写失败测试**

`packages/desktop/tests/design-contract.test.ts` 末尾新 describe：

```ts
describe("topframe — SessionStrip 组件提取", () => {
  const read = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8")
  test("SessionStrip 组件文件存在且导出", () => {
    const src = read("src/renderer/mafw/components/SessionStrip.tsx")
    expect(src).toContain("export function SessionStrip")
  })
  test("MafwShell 以组件形式渲染（不再内联 session tab map）", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).toContain("<SessionStrip")
    expect(shell).not.toContain('class="mafw-session-tab"')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop; bun test tests/design-contract.test.ts`
Expected: FAIL（SessionStrip.tsx 不存在）

- [ ] **Step 3: 实现**

新建 `SessionStrip.tsx`——把 MafwShell 1624-1687 行的 `.mafw-sessionstrip` JSX 整体搬入，renamingId/renameDraft 用组件内 `createSignal`，rename 提交时调 `props.onRename(s.id, next)`：

```tsx
import { createSignal, Show } from "solid-js"
import { ContextMenu } from "@mafw/ui/context-menu"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"

export function SessionStrip(props: {
  sessions: () => { id: string; title: string; manager?: boolean }[]
  activeViewId: () => string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, title: string) => void
  onExport: (id: string) => void
  onCopyId: (id: string) => void
  onNew: () => void
}) {
  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal("")
  return (
    <div class="mafw-sessionstrip">
      {props.sessions().map(s => (
        <ContextMenu>
          <ContextMenu.Trigger
            as="div"
            class="mafw-session-tab"
            classList={{ active: props.activeViewId() === s.id }}
            onClick={() => props.onSelect(s.id)}
          >
            <span class="mafw-agent-dot" style={{ background: s.manager ? "var(--accent)" : "var(--text-4)" }} />
            <span
              class="mafw-session-title"
              onDblClick={e => { e.stopPropagation(); setRenamingId(s.id); setRenameDraft(s.title || "") }}
            >
              <Show when={renamingId() !== s.id} fallback={
                <TextInputV2
                  value={renameDraft()}
                  onInput={e => setRenameDraft(e.currentTarget.value)}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === "Enter") {
                      const next = renameDraft().trim()
                      if (next && next !== s.title) props.onRename(s.id, next)
                      setRenamingId(null)
                    }
                    if (e.key === "Escape") setRenamingId(null)
                  }}
                  onBlur={() => setRenamingId(null)}
                  style={{ width: 120, height: 22, fontSize: 12 }}
                />
              }>{s.title}</Show>
            </span>
            <ButtonV2 variant="ghost" size="small" class="mafw-session-close" onClick={e => { e.stopPropagation(); props.onClose(s.id) }}>✕</ButtonV2>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content>
              <ContextMenu.Item onSelect={() => props.onClose(s.id)}>
                <ContextMenu.ItemLabel>Close</ContextMenu.ItemLabel>
              </ContextMenu.Item>
              <ContextMenu.Item onSelect={() => props.onExport(s.id)}>
                <ContextMenu.ItemLabel>导出 Markdown…</ContextMenu.ItemLabel>
              </ContextMenu.Item>
              <ContextMenu.Item onSelect={() => props.onCopyId(s.id)}>
                <ContextMenu.ItemLabel>Copy session ID</ContextMenu.ItemLabel>
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu>
      ))}
      <ButtonV2 variant="ghost" size="small" class="mafw-session-new" onClick={() => props.onNew()}>+</ButtonV2>
    </div>
  )
}
```

注意：原 JSX 中 `title="双击重命名"` 裸 title 属性按约束移除。

MafwShell：
- import `SessionStrip`，替换 1623-1687 内联块为：

```tsx
<SessionStrip
  sessions={sessions}
  activeViewId={activeViewId}
  onSelect={(id) => { setShowConfig(false); setActiveTab("chat"); setShowWelcome(false); setActiveSessionId(id); setActiveViewId(id) }}
  onClose={closeSession}
  onRename={(id, next) => {
    setSessions(prev => prev.map(x => x.id === id ? { ...x, title: next } : x))
    setStore(prev => ({ ...prev, session: prev.session.map((x: any) => x.id === id ? { ...x, title: next } : x) }))
    window.api.mafw.sessions.rename(id, next)
      .catch((err: any) => showToastV2({ description: `重命名失败: ${err?.message || err}`, duration: 3000 }))
  }}
  onExport={(id) => void exportSession(id)}
  onCopyId={copyText}
  onNew={createSession}
/>
```

- 删除 MafwShell 中 `renamingId`/`setRenamingId`/`renameDraft`/`setRenameDraft` 信号声明（grep 确认无其他使用点）。

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `bun test tests/design-contract.test.ts && bun test`
Expected: 新 2 条 PASS；全量 0 fail（总数与基线一致：822+2）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/SessionStrip.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/design-contract.test.ts
git commit -m "refactor(desktop): SessionStrip 提取为独立组件（topframe 前置）"
```

---

### Task 2: 顶行框架重构（topstrip 行 + WindowControls 迁入 + 旧 titlebar 删除 + dock 图标组）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/DockTabButtons.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（grid/JSX 重构）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（新增 .mafw-topstrip 等；删 .mafw-titlebar 规则）
- Modify: `packages/desktop/src/renderer/mafw/components/RightDock.tsx`（删 tab 条，保留 ✕ 头行）
- Test: `packages/desktop/tests/design-contract.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `SessionStrip`；`dock-tab.ts` 的 `DockTab`/`DOCK_TABS`；MafwShell 既有 `rightDockTab()`/`applyRightDock(open, tab)`/`rightDockOpen()`
- Produces:
  ```ts
  export function DockTabButtons(props: {
    tab: () => DockTab
    open: () => boolean
    onToggle: (tab: DockTab) => void   // 点当前高亮=关闭
  })
  ```
  MafwShell 布局契约：`.mafw-shell` grid 两行两列；左列 `.mafw-rail-col`（grid-row 1/-1）；右上 `.mafw-topstrip`；右下 `.mafw-body`（仅 `1fr | dock` 两列）

- [ ] **Step 1: 写失败测试**

design-contract.test.ts 追加：

```ts
describe("topframe — 顶行框架", () => {
  const read = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8")
  test("旧 .mafw-titlebar 移除，WindowControls 入顶行", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).not.toContain('class="mafw-titlebar"')
    const stripIdx = shell.indexOf('class="mafw-topstrip"')
    expect(stripIdx).toBeGreaterThan(-1)
    expect(shell.indexOf("<WindowControls", stripIdx)).toBeGreaterThan(stripIdx)
  })
  test("顶行含 SessionStrip 与 DockTabButtons", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    const stripIdx = shell.indexOf('class="mafw-topstrip"')
    expect(shell.indexOf("<SessionStrip", stripIdx)).toBeGreaterThan(stripIdx)
    expect(shell.indexOf("<DockTabButtons", stripIdx)).toBeGreaterThan(stripIdx)
  })
  test("DockTabButtons 组件：五 tab 图标组 + 点当前关闭语义", () => {
    const src = read("src/renderer/mafw/components/DockTabButtons.tsx")
    for (const t of ["tasks", "trajectory", "usage", "notes", "changes"]) expect(src).toContain(`"${t}"`)
    expect(src).toContain("props.open() && props.tab() === t")
  })
  test("RightDock 不再渲染 tab 条，保留关闭按钮", () => {
    const src = read("src/renderer/mafw/components/RightDock.tsx")
    expect(src).not.toContain("TabsV2")
    expect(src).toContain("mafw-right-dock-close")
  })
  test("CSS：topstrip 拖拽区契约", () => {
    expect(css).toMatch(/\.mafw-topstrip\s*\{[^}]*-webkit-app-region:\s*drag/)
    expect(css).toMatch(/\.mafw-topstrip\s+button[^{]*\{[^}]*-webkit-app-region:\s*no-drag/)
  })
  test("CSS：旧 titlebar 规则删除", () => {
    expect(css).not.toMatch(/\.mafw-titlebar\s*\{/)
  })
})
```

（`css` 是文件顶部已读入的 mafw.css 全文常量，复用即可。）

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/design-contract.test.ts`
Expected: FAIL（mafw-topstrip / DockTabButtons 不存在，.mafw-titlebar 仍在）

- [ ] **Step 3: 实现**

**3a. 新建 `DockTabButtons.tsx`：**

```tsx
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { type DockTab } from "./dock-tab"

const ITEMS: { tab: DockTab; icon: string; label: string }[] = [
  { tab: "tasks", icon: "📋", label: "任务" },
  { tab: "trajectory", icon: "📊", label: "轨迹" },
  { tab: "usage", icon: "📈", label: "用量" },
  { tab: "notes", icon: "📝", label: "便签" },
  { tab: "changes", icon: "🗒", label: "改动" },
]

export function DockTabButtons(props: {
  tab: () => DockTab
  open: () => boolean
  onToggle: (tab: DockTab) => void
}) {
  return (
    <div class="mafw-dock-buttons">
      {ITEMS.map(({ tab: t, icon, label }) => (
        <TooltipV2 value={label} openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-dock-button"
            classList={{ active: props.open() && props.tab() === t }}
            aria-label={label}
            onClick={() => props.onToggle(t)}
          >
            {icon}
          </ButtonV2>
        </TooltipV2>
      ))}
    </div>
  )
}
```

**3b. `RightDock.tsx`**：删 TabsV2 import 与 tab 条块，props 删 `onTab`，头行改为：

```tsx
<div class="mafw-right-dock-head">
  <div class="mafw-right-dock-spacer" />
  <TooltipV2 value="关闭面板" openDelay={300}>
    <ButtonV2 variant="ghost" size="small" class="mafw-right-dock-close" onClick={props.onClose} aria-label="关闭面板">✕</ButtonV2>
  </TooltipV2>
</div>
```

**3c. `MafwShell.tsx`**：
- 删除 1529-1570 的 `.mafw-titlebar` 整块（logo/品牌/状态点/主题切换迁往 Rail——Task 3 接线；本任务先从 shell 移除，WindowControls 移入 topstrip）
- `.mafw-shell` 根 div 改为 grid 容器；body 只留 main+dock 两列。新骨架：

```tsx
<div class="mafw-shell" classList={{ maximized: ... }}>
  {/* 左列：rail 通高（grid-row 1/-1），折叠态 32px 不变 */}
  <div class="mafw-rail-col">
    {railCollapsed() ? ( /* 既有 .mafw-rail-collapsed 块原样 */ ) : ( /* 既有 .mafw-rail-wrap 块原样 */ )}
  </div>
  {/* 顶行：strip（会话 tab 恒显）+ dock 图标组 + 窗口控制 */}
  <div
    class="mafw-topstrip"
    onDblClick={(e) => {
      if (window.api.platform !== "win32") return
      if ((e.target as HTMLElement).closest("button,input,[data-component],a")) return
      void window.api.windowControls.toggleMaximize()
    }}
  >
    <SessionStrip ...同 Task 1 props... />
    <div class="mafw-topstrip-spacer" />
    <DockTabButtons
      tab={rightDockTab}
      open={rightDockOpen}
      onToggle={(t) => applyRightDock(!(rightDockOpen() && rightDockTab() === t), t)}
    />
    <WindowControls />
  </div>
  {/* 右下：main | dock */}
  <div class="mafw-body" style={{ "grid-template-columns": `1fr ${rightDockOpen() && !viewportNarrow() ? `${rightDockWidth()}px` : "0px"}` }}>
    {/* 既有 .mafw-main 原样（内部 chat 分支不再重复渲染 SessionStrip——Task 1 原位渲染处本任务删除） */}
    {/* 既有 .mafw-dock-slot 原样 */}
  </div>
</div>
```

- 原 titlebar 的 `toggleTheme`/`theme()`/connPhase 状态点 JSX 暂存不用删信号（Task 3 接线到 Rail；本任务中未引用的 `toggleTheme`/`theme` 若 typecheck 报 unused 则先保留——它们仍在 ChatPane props `onToggleTheme` 等处使用）。
- ChatPane 分支里 Task 1 放置的 `<SessionStrip ... />` 删除（提升为全局恒显）。
- `applyRightDock` 不动。

**3d. `mafw.css`**：

```css
/* ── Topframe 顶行（38px）：strip + dock 图标 + 窗口控制 ── */
.mafw-topstrip {
  display: flex; align-items: center; gap: 4px;
  height: 38px; padding: 0 0 0 8px;
  background: var(--bg-base);
  border-bottom: 1px solid var(--border-subtle);
  -webkit-app-region: drag;
  user-select: none;
}
.mafw-topstrip button, .mafw-topstrip input, .mafw-topstrip .mafw-session-tab { -webkit-app-region: no-drag; }
.mafw-topstrip-spacer { flex: 1; }
.mafw-dock-buttons { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.mafw-dock-button.active { background: var(--bg-overlay); color: var(--text-1); }
```

- `.mafw-sessionstrip` 规则改为 `flex: 1 1 auto; min-width: 0;`（在顶行内可压缩滚动，原为独立一行），保留 `overflow-x: auto; height: 38px;`（原 36px 对齐顶行）。
- `.mafw-shell` 改 grid：

```css
.mafw-shell { display: grid; grid-template-columns: auto 1fr; grid-template-rows: 38px 1fr; height: 100vh; }
.mafw-rail-col { grid-row: 1 / -1; display: flex; min-height: 0; }
.mafw-body { display: grid; grid-template-columns: 1fr; overflow: hidden; min-height: 0; }
```

（`.mafw-shell` 现有 display/flex 声明以实际为准做最小改写；`.mafw-body` 原 264px 1fr 两列定义删除，列宽由 inline style 接管。）
- 删除 `.mafw-titlebar { … }` 与 `.mafw-titlebar button, …` 两条规则；`.mafw-titlebar-dot` 规则保留（Task 3 Rail 品牌行复用该类名）。
- `.mafw-right-dock-tabs` 改名 `.mafw-right-dock-head`（规则同步）。

- [ ] **Step 4: 验证**

Run: `bun test tests/design-contract.test.ts && bun test && bun run typecheck && npx electron-vite build`
Expected: 新 6 条 PASS；全量 0 fail；typecheck 无新增错误；build 通过

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/DockTabButtons.tsx packages/desktop/src/renderer/mafw/components/RightDock.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/design-contract.test.ts
git commit -m "feat(desktop): 顶行框架——SessionStrip 升入标题行，dock 开关并入，WindowControls 右置"
```

---

### Task 3: Rail 品牌行（吸收 logo/状态点/主题切换）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/Rail.tsx`（新增 brand slot 渲染）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（向 Rail 传 brand JSX）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（.mafw-rail-brand 样式）
- Test: `packages/desktop/tests/design-contract.test.ts`

**Interfaces:**
- Consumes: MafwShell 既有 `theme()`/`toggleTheme`/`connPhase()`/`conn.attempts()`/`gwStatus()`；Task 2 的 `.mafw-topstrip` 行高（38px 对齐）
- Produces: `Rail` 新可选 prop `brand?: any`（JSX.Element），渲染于 `.mafw-rail-head` 之上的 `.mafw-rail-brand` 行

- [ ] **Step 1: 写失败测试**

```ts
describe("topframe — Rail 品牌行", () => {
  const read = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8")
  test("Rail 渲染 brand slot（项目切换行之上）", () => {
    const rail = read("src/renderer/mafw/components/Rail.tsx")
    expect(rail).toContain("mafw-rail-brand")
    expect(rail.indexOf("mafw-rail-brand")).toBeLessThan(rail.indexOf("mafw-rail-head"))
  })
  test("MafwShell 传入品牌内容（logo+状态点+主题切换）", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).toContain("brand=")
    expect(shell).toContain("mafw-theme-toggle")
  })
  test("CSS：品牌行 38px 与顶行同高且可拖拽", () => {
    expect(css).toMatch(/\.mafw-rail-brand\s*\{[^}]*height:\s*38px/)
    expect(css).toMatch(/\.mafw-rail-brand\s*\{[^}]*-webkit-app-region:\s*drag/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

**3a. Rail.tsx**：props 类型加 `brand?: any`，`.mafw-rail` 内最顶部渲染：

```tsx
<Show when={props.brand}>
  <div class="mafw-rail-brand">{props.brand}</div>
</Show>
```

**3b. MafwShell.tsx**：Rail 调用处传 brand（内容 = 旧 titlebar 左段原样）：

```tsx
<Rail
  brand={
    <>
      <Icon name="logo" size="small" />
      <span class="mafw-rail-brand-name">MAFW</span>
      <TooltipV2 value={/* 原 gwStatus tooltip 三元链，逐字保留 */} openDelay={300}>
        <div class="mafw-titlebar-dot" classList={{ /* 原样 */ }} style={{ "margin-left": 4 }} />
      </TooltipV2>
      <div style={{ flex: 1 }} />
      <TooltipV2 value="切换主题" openDelay={300}>
        <ButtonV2 variant="ghost" size="small" class="mafw-theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
          {/* 原样 ☀ / 月亮 svg */}
        </ButtonV2>
      </TooltipV2>
    </>
  }
  ...既有 props...
/>
```

**3c. mafw.css**：

```css
.mafw-rail-brand {
  display: flex; align-items: center; gap: 8px;
  height: 38px; padding: 0 8px 0 12px; flex-shrink: 0;
  border-bottom: 1px solid var(--border-subtle);
  -webkit-app-region: drag; user-select: none;
}
.mafw-rail-brand button { -webkit-app-region: no-drag; }
.mafw-rail-brand-name { font-size: 13px; font-weight: 600; color: var(--text-2); }
```

**3d. 折叠态**：`.mafw-rail-collapsed` 块顶部加 logo 图标（`Icon name="logo"`，38px 高、drag 区域对齐顶行视觉）；既有 expand 按钮保留在其下。CSS：`.mafw-rail-collapsed { padding-top: 0; }` 视现状微调（现状 32px 宽竖条，仅保证不破坏既有布局即可，不做像素级对齐追求）。

- [ ] **Step 4: 验证**

Run: `bun test tests/design-contract.test.ts && bun test && bun run typecheck && npx electron-vite build`
Expected: 新 3 条 PASS；全量 0 fail；build 通过

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/Rail.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/design-contract.test.ts
git commit -m "feat(desktop): Rail 通高吸收品牌行（logo/状态点/主题切换），旧 titlebar 退役完成"
```

---

### Task 4: 端到端实测（CDP）

**Files:** 无新增（验证任务）

- [ ] **Step 1: CDP 连 dev app（127.0.0.1:9222，url 含 localhost:5173 的目标），reload 后断言**

```js
// 经 cdp-eval.mjs 执行：
JSON.stringify({
  topstrip: !!document.querySelector('.mafw-topstrip'),
  titlebarGone: !document.querySelector('.mafw-titlebar'),
  stripInTop: !!document.querySelector('.mafw-topstrip .mafw-sessionstrip'),
  dockBtns: document.querySelectorAll('.mafw-dock-button').length,
  winControlsInTop: !!document.querySelector('.mafw-topstrip .mafw-window-controls'),
  brand: !!document.querySelector('.mafw-rail-brand'),
  brandText: document.querySelector('.mafw-rail-brand')?.textContent,
  topY: document.querySelector('.mafw-topstrip')?.getBoundingClientRect().top,
  brandY: document.querySelector('.mafw-rail-brand')?.getBoundingClientRect().top
})
```

Expected: topstrip/stripInTop/winControlsInTop/brand 均 true；titlebarGone true；dockBtns=5；topY===brandY（同一行高）。

- [ ] **Step 2: 点 dock 图标组五个按钮逐一开合，量 .mafw-right-dock offsetWidth（开=320，点当前=关 0/absent）**

- [ ] **Step 3: 截图存档**（`cdp-shot.cjs`），人工核对：顶行=会话 tab+图标+窗口控制一行；rail 顶部品牌行与顶行同高；双击顶行空隙最大化正常

- [ ] **Step 4: 如发现问题，回到对应 Task 修复并重跑该任务验证命令；全部通过后无需 commit（验证任务）**

---

## Self-Review 记录

- Spec 覆盖：§2 三决策→Task1-3；§3.1 grid→Task2；§3.2 迁移表→Task2/3；§3.4 拖拽→Task2 CSS+测试；§3.5 溢出→Task2 `.mafw-sessionstrip` 改写；§4 保留行为→各任务「原样」约束；§5 测试→各任务 Step1 + Task4；§6 非目标未引入任务 ✓
- 类型一致性：`SessionStrip`/`DockTabButtons` props 在 Task 定义与使用处一致；`applyRightDock(open, tab)` 既有签名 `(open: boolean, tab?: DockTab)` 与 Task2 onToggle 调用兼容 ✓
- 已知遗留：Task2 完成后到 Task3 前的中间态没有品牌区（titlebar 已删、Rail 未接）——属计划内中间态，Task3 紧接着补齐；两次 commit 之间应用可运行但无主题切换入口，可接受（如需严格中间态完整，可手工先跑 Task3 再跑 Task2，顺序无依赖冲突）
