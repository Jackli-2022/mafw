# Tasks 迁入聊天头部行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Tasks 从 Composer 上方独立面板重构为嵌入聊天头部行（ChatHeader 内含 TaskBar 指示条）+ TaskList 单例（popover/dock/overlay 三态），常态成本 = 0。

**Architecture:** 拆分 TaskPanel 为两个组件：TaskBar（头部行内 flex-1 单行指示条，无任务返回 null）与 TaskList（placement 驱动的列表单例，含 §9.1 密度模型）。ChatHeader 为 MafwShell 内 `.mafw-session-titlebar` 结构改造（Agent 头像 + 标题 + 分隔线 + TaskBar + 状态点 + 下缘细线 + done/total 徽章）。placement 状态机（localStorage + Ctrl+J + Pin/关闭 + overlay resize 判定）在 MafwShell 内协调。PopoverShell 扩展 `below-center` 锚定供 popover 使用。

**Tech Stack:** SolidJS + `@opencode-ai/ui/v2`（ButtonV2/TooltipV2），CSS 变量 tokens，electron-vite build。

**设计文档（权威）:** `docs/superpowers/specs/2026-08-05-tasks-chat-header-design.md`

## Global Constraints

- 全部颜色走 CSS 变量（v3 tokens），禁止硬编码 hex（除语义色 `#E5484D`/`#E7A13D`）
- AGENTS.md §5.10：禁止裸 `<button>`/`<input>`/裸 `title`，用 `@opencode-ai/ui/v2/*`（ButtonV2/TooltipV2）
- 动效 ≤300ms；密度/折叠动画 200ms
- `// @ts-nocheck` 在 MafwShell/Rail/TaskPanel 等既有文件顶部保留
- 构建验证：`cd opencode-dev/packages/desktop && npm run build`（预期 `built in ~8-16s`，无 error）
- 所有新增 JSX 无裸 button/input；aria-label 必填
- 数据源不变：`todos[sid]`（SSE todo.updated）+ `taskMetrics()`（tokens/started）

---

### Task 1: PopoverShell 扩展 below-center 锚定

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/pickers/PopoverShell.tsx`

**Interfaces:**
- Consumes: 现有 PopoverShell（`anchor: "tr" | "bl"`，fixed 定位、视口翻转、外部点击/Esc 关闭、Portal 到 body、自带主题变量）
- Produces: `anchor: "tr" | "bl" | "below-center"` —— below-center = 触发器下方 2px、水平居中；下方空间不足翻到上方

- [ ] **Step 1: 扩展 anchor 类型与 compute() 定位分支**

在 `PopoverShell.tsx` 中：

```tsx
export function PopoverShell(props: {
  open: boolean
  trigger: HTMLElement | null
  anchor: "tr" | "bl" | "below-center"
  onClose: () => void
  children: JSX.Element
  class?: string
}) {
```

`compute()` 内 `let top`/`let left` 逻辑改为（在既有 spaceAbove/spaceBelow 计算后）：

```tsx
    const rect = t.getBoundingClientRect()
    const W = 288
    const GAP = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    const h = Math.min(selfRef()?.offsetHeight || 320, 380)
    const spaceAbove = rect.top - GAP
    const spaceBelow = vh - rect.bottom - GAP
    let top: number
    let left: number
    if (props.anchor === "below-center") {
      // Below the trigger, centered; flip above when not enough room below.
      if (spaceBelow >= h) {
        top = rect.bottom + 2
      } else {
        top = Math.max(8, rect.top - GAP - h)
      }
      left = rect.left + rect.width / 2 - W / 2
    } else {
      // Three-state placement: fully above → fully below → clamp on the larger side.
      if (spaceAbove >= h) {
        top = rect.top - GAP - h
      } else if (spaceBelow >= h) {
        top = rect.bottom + GAP
      } else if (spaceAbove >= spaceBelow) {
        top = Math.max(8, rect.top - GAP - h)
      } else {
        top = Math.min(vh - 8 - h, rect.bottom + GAP)
      }
      left = props.anchor === "tr" ? rect.right - W : rect.left
    }
    if (left < 8) left = 8
    if (left + W > vw - 8) left = vw - 8 - W
    setPos({ top, left })
```

- [ ] **Step 2: 构建验证**

Run: `cd opencode-dev/packages/desktop && npm run build`
Expected: `✓ built in ...`（无 error）

- [ ] **Step 3: 提交**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/pickers/PopoverShell.tsx
git commit -m "feat(desktop): PopoverShell below-center anchor"
```

---

### Task 2: TaskBar 组件

**Files:**
- Create: `opencode-dev/packages/desktop/src/renderer/mafw/components/TaskBar.tsx`

**Interfaces:**
- Consumes: `todos: any[]`（task 对象含 `status: 'pending'|'in_progress'|'completed'|'cancelled'`、`content`、`priority?`）、`tokens: number`、`started: number`、`open: boolean`（列表是否打开）
- Produces: `TaskBar({ todos, tokens, started, open, onToggle })` —— 单行指示条；**无任务时返回 `null`**；全部完成显示 `✔ 全部完成（N/N）` 3-5s 后自动隐藏（内部定时器）

- [ ] **Step 1: 创建 TaskBar.tsx**

```tsx
// @ts-nocheck
import { createSignal, createEffect, createMemo, onCleanup, Show } from "solid-js"

const formatDuration = (ms: number): string => {
  if (!ms || ms < 0) return "0s"
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

const formatTokens = (n: number): string =>
  n >= 10000 ? `${(n / 1000).toFixed(1)}k tokens` : `${n} tokens`

export function TaskBar(props: {
  todos: any[]
  tokens: number
  started: number
  open: boolean
  onToggle: () => void
}) {
  const total = () => props.todos.length
  const done = () => props.todos.filter(t => t.status === "completed").length
  const running = () => props.todos.filter(t => t.status === "in_progress")
  const [now, setNow] = createSignal(Date.now())
  const [allDoneHidden, setAllDoneHidden] = createSignal(false)

  const allDone = () => total() > 0 && done() === total()

  // Elapsed ticker: only while a task is running (freezes on complete/interrupt).
  let tickTimer: ReturnType<typeof setInterval> | null = null
  createEffect(() => {
    const active = running().length > 0
    if (active && !tickTimer) tickTimer = setInterval(() => setNow(Date.now()), 1000)
    else if (!active && tickTimer) { clearInterval(tickTimer); tickTimer = null }
  })
  onCleanup(() => { if (tickTimer) clearInterval(tickTimer) })

  // "✔ 全部完成" shown 3.5s, then auto-hide (delayed hide per design Q4).
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  createEffect(() => {
    if (allDone()) {
      setAllDoneHidden(false)
      if (!hideTimer) hideTimer = setTimeout(() => setAllDoneHidden(true), 3500)
    } else if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  })
  onCleanup(() => { if (hideTimer) clearTimeout(hideTimer) })

  // No tasks → zero footprint. NOTE: this must be REACTIVE (Show, not early
  // return) — SolidJS component bodies run once; early returns never re-run
  // when todos arrive later or allDoneHidden flips.
  const visible = () => total() > 0 && !(allDone() && allDoneHidden())

  const current = () => running()[0] || [...props.todos].reverse().find(t => t.status === "completed")
  const elapsedMs = createMemo(() => (props.started ? Math.max(0, now() - props.started) : 0))
  const pct = () => (total() > 0 ? Math.round((done() / total()) * 100) : 0)

  return (
    <Show when={visible()}>
    <button
      type="button"
      class="mafw-taskbar"
      classList={{ open: props.open }}
      onClick={props.onToggle}
      aria-label="任务列表"
    >
      <Show when={!allDone()} fallback={<span class="mafw-taskbar-check">✔ 全部完成（{done()}/{total()}）</span>}>
        <Show when={running().length > 0} fallback={<span class="mafw-taskbar-spinner" />}>
          <span class="mafw-taskbar-spinner running" />
        </Show>
        <span class="mafw-taskbar-text">{current()?.content || ""}</span>
        <Show when={current()?.priority === "high"}>
          <span class="mafw-taskbar-priority">HIGH</span>
        </Show>
        <span class="mafw-taskbar-num">{done()}/{total()}</span>
        <span class="mafw-taskbar-progress"><span style={{ width: `${pct()}%` }} /></span>
        <span class="mafw-taskbar-time">{formatDuration(elapsedMs())}</span>
      </Show>
      <span class="mafw-taskbar-chevron" classList={{ open: props.open }}>▾</span>
    </button>
    </Show>
  )
}
```

- [ ] **Step 2: 构建验证**

Run: `cd opencode-dev/packages/desktop && npm run build`
Expected: `✓ built in ...`（无 error）

- [ ] **Step 3: 提交**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/TaskBar.tsx
git commit -m "feat(desktop): TaskBar indicator component"
```

---

### Task 3: ChatHeader 改造（嵌入 TaskBar + 状态点 + 细线 + 徽章）

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx`（session-titlebar 区，约 1272-1283 行）
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- Consumes: TaskBar（Task 2）、`todos`/`taskMetrics`（现有）、`store.session_status`（busy 判定）
- Produces: ChatHeader JSX（Avatar + Title + Divider + TaskBar + 状态点 + done/total 徽章）；CSS class：`.mafw-chat-header-divider`、`.mafw-chat-header-done`、`.mafw-taskbar*`、`.mafw-session-titlebar.tasks-active`（下缘细线）

- [ ] **Step 1: 改造 session-titlebar JSX**

在 `MafwShell.tsx` 中，将 1272-1283 行的 titlebar 块替换为：

```tsx
                              <div
                                class="mafw-session-titlebar"
                                classList={{ "tasks-active": (todos[currentSessionID()] || []).length > 0 }}
                              >
                                <div class="mafw-session-titlebar-inner">
                                  <span class="mafw-agent-avatar">{(active()?.title || "A").charAt(0)}</span>
                                  <span class="mafw-session-titlebar-text">{active()?.title || "Chat"}</span>
                                  <Show when={(todos[currentSessionID()] || []).length > 0}>
                                    <span class="mafw-chat-header-divider" />
                                  </Show>
                                  <TaskBar
                                    todos={todos[currentSessionID()] || []}
                                    tokens={taskMetrics().tokens}
                                    started={taskMetrics().started}
                                    open={taskListOpen() && tasksPlacement() === "bar"}
                                    onToggle={() => setTaskListOpen(!taskListOpen())}
                                  />
                                  <Show when={(todos[currentSessionID()] || []).length > 0}>
                                    <span class="mafw-chat-header-done">
                                      {(todos[currentSessionID()] || []).filter(t => t.status === "completed").length}/
                                      {(todos[currentSessionID()] || []).length}
                                    </span>
                                  </Show>
                                  <Show when={store.session_status[currentSessionID()]?.type === "busy" &&
                                    ((todos[currentSessionID()] || []).length === 0 || tasksPlacement() === "dock")}>
                                    <span class="mafw-session-status">
                                      <span class="mafw-session-status-dot" />
                                      Running
                                    </span>
                                  </Show>
                                </div>
                              </div>
```

> 注意：`taskListOpen`/`tasksPlacement`/`setTaskListOpen` 状态与 `TaskBar` import 在 Task 5 定义——Task 3 先加 `import { TaskBar } from "./components/TaskBar"`，状态字段在 Task 5 补（本步 JSX 引用的名字 Task 5 会定义，期间 build 会报未定义——为保持每步可 build，在 Step 1 同时添加占位状态定义，Task 5 完善）：

在 `MafwShell.tsx` 的状态区（`const [switchLogs, ...]` 附近）添加：

```tsx
  const [taskListOpen, setTaskListOpen] = createSignal(false)
  const [tasksPlacement, setTasksPlacement] = createSignal<"bar" | "dock">(
    (localStorage.getItem("mafw-tasks-placement") as "bar" | "dock") || "bar"
  )
```

- [ ] **Step 2: CSS（ChatHeader 结构 + TaskBar 样式）**

在 `mafw.css` 中修改 `.mafw-session-titlebar`（现有 499-506 行区域），并新增样式：

```css
.mafw-session-titlebar {
  position: sticky;
  top: 0;
  z-index: 30;
  margin: 0 -32px;
  padding: 10px 32px 14px;
  background: linear-gradient(to bottom, var(--bg-raised) calc(100% - 12px), transparent);
  border-bottom: 1px solid var(--border-subtle);
}
.mafw-session-titlebar.tasks-active {
  border-bottom: none;
  box-shadow: inset 0 -2px 0 0 var(--accent);
  border-bottom-left-radius: 2px;
  border-bottom-right-radius: 2px;
}
.mafw-session-titlebar-inner {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: var(--msg-col-width);
  margin-inline: auto;
}
.mafw-chat-header-divider {
  width: 1px;
  height: 14px;
  background: var(--border-subtle);
  flex-shrink: 0;
}
.mafw-chat-header-done {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--bg-overlay);
  color: var(--text-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* TaskBar */
.mafw-taskbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: var(--text-2);
  font-size: 13px;
  transition: background 0.12s;
}
.mafw-taskbar:hover { background: var(--hover); }
.mafw-taskbar.open { background: var(--hover); }
.mafw-taskbar-spinner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--text-5);
  border-top-color: var(--accent);
  flex-shrink: 0;
  animation: mafw-spin 1s linear infinite;
}
.mafw-taskbar-spinner.running { border-top-color: var(--accent); }
.mafw-taskbar-check { color: var(--accent-text); font-size: 13px; white-space: nowrap; }
.mafw-taskbar-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.mafw-taskbar-priority {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--warning);
}
.mafw-taskbar-num {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.mafw-taskbar-progress {
  width: 48px;
  height: 3px;
  border-radius: 999px;
  background: var(--pill);
  overflow: hidden;
  flex-shrink: 0;
}
.mafw-taskbar-progress span {
  display: block;
  height: 100%;
  background: var(--accent);
}
.mafw-taskbar-time {
  font-size: 11px;
  color: var(--text-4);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.mafw-taskbar-chevron {
  font-size: 9px;
  color: var(--text-4);
  flex-shrink: 0;
  transition: transform 0.12s;
}
.mafw-taskbar-chevron.open { transform: rotate(180deg); }
@media (max-width: 640px) {
  .mafw-taskbar-progress { display: none; }
}
@keyframes mafw-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
```

- [ ] **Step 3: 构建验证**

Run: `cd opencode-dev/packages/desktop && npm run build`
Expected: `✓ built in ...`（无 error）

- [ ] **Step 4: 提交**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx opencode-dev/packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): chat header embeds TaskBar + status dot + done badge"
```

---

### Task 4: TaskList 组件（重构 TaskPanel → placement 三态 + 密度模型）

**Files:**
- Create: `opencode-dev/packages/desktop/src/renderer/mafw/components/TaskList.tsx`
- Delete: `opencode-dev/packages/desktop/src/renderer/mafw/components/TaskPanel.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx`（删除 TaskPanel import 与 mafw-tasks-float 渲染块）
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- Consumes: `todos`/`tokens`/`started`（现有）、TaskBar 数据同源
- Produces: `TaskList({ todos, tokens, started, placement: 'popover'|'dock'|'overlay', onClose, onPin })` —— 密度模型列表（completed 折叠/running+failed 全显/pending 窗口/底部"还有 N 个"）、行渲染（pending 空心圆/running spinner/completed 绿勾+删除线/failed ✗/priority 小图标/ToolChip）、计时器冻结

- [ ] **Step 1: 创建 TaskList.tsx**

```tsx
// @ts-nocheck
import { createSignal, createMemo, createEffect, onCleanup, For, Show } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"

const formatDuration = (ms: number): string => {
  if (!ms || ms < 0) return "0s"
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

const formatTokens = (n: number): string =>
  n >= 10000 ? `${(n / 1000).toFixed(1)}k tokens` : `${n} tokens`

function StatusSlot(props: { status: string }) {
  if (props.status === "completed") {
    return (
      <span class="mafw-task-status done">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2.5 6.5L4.8 8.8L9.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    )
  }
  if (props.status === "in_progress") {
    return <span class="mafw-task-status running" />
  }
  if (props.status === "cancelled") {
    return (
      <span class="mafw-task-status failed">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </span>
    )
  }
  return <span class="mafw-task-status pending" />
}

export function TaskList(props: {
  todos: any[]
  tokens: number
  started: number
  placement: "popover" | "dock" | "overlay"
  onClose: () => void
  onPin: () => void
  }) {
  const total = () => props.todos.length
  const done = () => props.todos.filter(t => t.status === "completed").length
  const running = () => props.todos.filter(t => t.status === "in_progress")
  const failed = () => props.todos.filter(t => t.status === "cancelled")
  const pending = () => props.todos.filter(t => t.status === "pending")

  const [now, setNow] = createSignal(Date.now())
  const [completedExpanded, setCompletedExpanded] = createSignal(false)
  const [overflowExpanded, setOverflowExpanded] = createSignal(false)

  // Elapsed ticker freezes when the run is not running.
  let tickTimer: ReturnType<typeof setInterval> | null = null
  createEffect(() => {
    const active = running().length > 0
    if (active && !tickTimer) tickTimer = setInterval(() => setNow(Date.now()), 1000)
    else if (!active && tickTimer) { clearInterval(tickTimer); tickTimer = null }
  })
  onCleanup(() => { if (tickTimer) clearInterval(tickTimer) })

  const elapsedMs = createMemo(() => (props.started ? Math.max(0, now() - props.started) : 0))

  // Density model (§9.1): completed collapsed when >4 total; pending window 2 (running) / 3 (no running).
  const compact = () => total() > 4
  const pendingWindow = () => (running().length > 0 ? 2 : 3)
  const visiblePending = createMemo(() => (compact() ? pending().slice(0, pendingWindow()) : pending()))
  const pendingOverflow = createMemo(() => pending().length - visiblePending().length)
  const completedVisible = createMemo(() => {
    if (!compact() || completedExpanded()) return props.todos.filter(t => t.status === "completed")
    return []
  })
  const completedCount = () => done()

  const visibleRows = createMemo(() => {
    const rows: any[] = []
    if (compact()) {
      rows.push(...completedVisible())
      rows.push(...running(), ...failed(), ...visiblePending())
    } else {
      rows.push(...props.todos)
    }
    return rows
  })

  return (
    <div class={`mafw-tasklist mafw-tasklist-${props.placement}`}>
      <div class="mafw-tasklist-header">
        <span class="mafw-tasklist-title">Tasks</span>
        <span class="mafw-tasklist-metrics">{formatDuration(elapsedMs())} · {formatTokens(props.tokens)}</span>
        <span class="mafw-tasklist-progress">{done()}/{total()}</span>
        <Show when={props.placement === "popover"}>
          <ButtonV2 variant="ghost" size="small" class="mafw-tasklist-pin" onClick={props.onPin} aria-label="钉到右侧 Dock">📌</ButtonV2>
        </Show>
        <ButtonV2 variant="ghost" size="small" class="mafw-tasklist-close" onClick={props.onClose} aria-label="关闭">✕</ButtonV2>
      </div>
      <div class="mafw-tasklist-body">
        <Show when={compact() && completedCount() > 0 && !completedExpanded()}>
          <button type="button" class="mafw-tasklist-collapse" onClick={() => setCompletedExpanded(true)}>
            ✔ {completedCount()} 个已完成
          </button>
        </Show>
        <For each={visibleRows()}>
          {(t) => (
            <div class="mafw-task-row" data-slot="task-row">
              <StatusSlot status={t.status} />
              <p
                class="mafw-task-content"
                classList={{ done: t.status === "completed", failed: t.status === "cancelled" }}
              >
                <span class="mafw-task-text">{t.content}</span>
                <Show when={t.priority === "high"}>
                  <span class="mafw-task-priority">HIGH</span>
                </Show>
              </p>
            </div>
          )}
        </For>
        <Show when={compact() && pendingOverflow() > 0 && !overflowExpanded()}>
          <button type="button" class="mafw-tasklist-collapse" onClick={() => setOverflowExpanded(true)}>
            还有 {pendingOverflow()} 个待执行
          </button>
        </Show>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: CSS（TaskList 三态 + 行样式 + 密度段）**

在 `mafw.css` 追加：

```css
/* ── TaskList（popover / dock / overlay）── */
.mafw-tasklist { display: flex; flex-direction: column; }
.mafw-tasklist-popover {
  width: min(560px, calc(100% - 32px));
  background: var(--bg-float);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  box-shadow: var(--shadow-float);
  max-height: 320px;
}
.mafw-tasklist-dock {
  position: fixed;
  top: 38px;
  right: 0;
  bottom: 0;
  width: 320px;
  background: var(--bg-base);
  border-left: 1px solid var(--border-subtle);
  z-index: 70;
}
.mafw-tasklist-overlay {
  position: fixed;
  top: 38px;
  right: 0;
  bottom: 0;
  width: 320px;
  background: var(--bg-base);
  box-shadow: var(--shadow-float);
  z-index: 70;
}
.mafw-tasklist-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.mafw-tasklist-title { font-size: 13px; font-weight: 500; color: var(--text-2); }
.mafw-tasklist-metrics {
  font-size: 11px;
  color: var(--text-4);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mafw-tasklist-progress {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.mafw-tasklist-pin, .mafw-tasklist-close {
  width: 22px;
  height: 22px;
  padding: 0;
  font-size: 11px;
  color: var(--text-4);
}
.mafw-tasklist-body {
  overflow-y: auto;
  flex: 1;
  padding: 4px;
  min-height: 0;
}
.mafw-task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 5px 8px;
  border-radius: 6px;
  animation: mafw-enter 200ms ease-out;
}
.mafw-task-row:hover { background: var(--hover); }
.mafw-task-status { width: 14px; height: 14px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.mafw-task-status.pending {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid var(--text-4);
}
.mafw-task-status.running {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--text-5);
  border-top-color: var(--accent);
  animation: mafw-spin 1s linear infinite;
}
.mafw-task-status.done { color: var(--accent); }
.mafw-task-status.failed { color: var(--danger); }
.mafw-task-content {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin: 0;
  font-size: 13px;
  color: var(--text-2);
}
.mafw-task-content.done {
  color: var(--text-4);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--text-4) 70%, transparent);
}
.mafw-task-content.failed { color: var(--text-4); }
.mafw-task-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mafw-task-priority {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--warning);
}
.mafw-tasklist-collapse {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-4);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.mafw-tasklist-collapse:hover { background: var(--hover); color: var(--text-2); }
```

- [ ] **Step 3: 移除旧 TaskPanel 渲染与 import**

在 `MafwShell.tsx`：
1. 删除 import：`import { TaskPanel } from "./components/TaskPanel"`（19 行区域）
2. 删除 input-area 内 `mafw-tasks-float` 块（约 1336-1347 行：`<Show when={currentSessionID() && (todos[...]||[]).length > 0}>` + `<div class="mafw-tasks-float">` + `<TaskPanel .../>` 整个 Show）
3. 删除文件 `opencode-dev/packages/desktop/src/renderer/mafw/components/TaskPanel.tsx`

- [ ] **Step 4: 构建验证**

Run: `cd opencode-dev/packages/desktop && npm run build`
Expected: `✓ built in ...`（无 error；TaskPanel 引用已清）

- [ ] **Step 5: 提交**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/TaskList.tsx opencode-dev/packages/desktop/src/renderer/mafw/components/TaskPanel.tsx opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx opencode-dev/packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): TaskList placement component replaces TaskPanel"
```

---

### Task 5: MafwShell 状态机接线（placement/listOpen/Ctrl+J/overlay + 渲染 TaskList）

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/pickers/PopoverShell.tsx`（若 below-center 在 Task 1 已完成则跳过）

**Interfaces:**
- Consumes: TaskBar（Task 2）、TaskList（Task 4）、PopoverShell below-center（Task 1）
- Produces: `taskListOpen`/`tasksPlacement` 状态机、Ctrl/Cmd+J 全局快捷键（输入聚焦跳过）、TaskList 渲染（popover 经 PopoverShell below-center / dock / overlay）、resize 监听（<1200px dock→overlay）

- [ ] **Step 1: 状态机 + 快捷键 + resize**

在 `MafwShell.tsx`（Task 3 已加占位状态的区域）完善：

```tsx
  const [taskListOpen, setTaskListOpen] = createSignal(false)
  const [tasksPlacement, setTasksPlacement] = createSignal<"bar" | "dock">(
    (localStorage.getItem("mafw-tasks-placement") as "bar" | "dock") || "bar"
  )
  const [viewportNarrow, setViewportNarrow] = createSignal(window.innerWidth < 1200)

  const applyTasksPlacement = (p: "bar" | "dock") => {
    setTasksPlacement(p)
    try { localStorage.setItem("mafw-tasks-placement", p) } catch { /* ignore */ }
  }

  // Ctrl/Cmd+J: toggle task list (bar) / return to bar (dock). Skip when typing.
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "j") return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return
      e.preventDefault()
      if (tasksPlacement() === "dock") applyTasksPlacement("bar")
      else setTaskListOpen(o => !o)
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  // Dock → overlay under 1200px viewport (storage unchanged).
  createEffect(() => {
    const onResize = () => setViewportNarrow(window.innerWidth < 1200)
    window.addEventListener("resize", onResize)
    onCleanup(() => window.removeEventListener("resize", onResize))
  })
```

- [ ] **Step 2: 渲染 TaskList（popover/dock/overlay）**

在 `.mafw-input-area` 结束后（chat 容器内、`</div>` 收尾前）添加：

```tsx
                  {/* TaskList: popover (bar state) / dock / overlay */}
                  <Show when={taskListOpen() && tasksPlacement() === "bar"}>
                    <PopoverShell
                      open={taskListOpen() && tasksPlacement() === "bar"}
                      trigger={document.querySelector(".mafw-session-titlebar-inner") as HTMLElement | null}
                      anchor="below-center"
                      onClose={() => setTaskListOpen(false)}
                      class="mafw-tasklist-popover-wrap"
                    >
                      <TaskList
                        todos={todos[currentSessionID()] || []}
                        tokens={taskMetrics().tokens}
                        started={taskMetrics().started}
                        placement="popover"
                        onClose={() => setTaskListOpen(false)}
                        onPin={() => { setTaskListOpen(false); applyTasksPlacement("dock") }}
                      />
                    </PopoverShell>
                  </Show>
                  <Show when={tasksPlacement() === "dock"}>
                    <TaskList
                      todos={todos[currentSessionID()] || []}
                      tokens={taskMetrics().tokens}
                      started={taskMetrics().started}
                      placement={viewportNarrow() ? "overlay" : "dock"}
                      onClose={() => applyTasksPlacement("bar")}
                      onPin={() => applyTasksPlacement("bar")}
                    />
                  </Show>
```

> 注意：`PopoverShell` 的 trigger 用 `document.querySelector` 在 SolidJS 中非响应式——改为响应式：定义 `const titlebarRef = createSignal<HTMLElement | null>(null)`，在 titlebar-inner div 加 `ref={setTitlebarRef}`，trigger={titlebarRef()}。用此方式替换上面的 querySelector。

- [ ] **Step 3: 构建验证**

Run: `cd opencode-dev/packages/desktop && npm run build`
Expected: `✓ built in ...`（无 error）

- [ ] **Step 4: 提交**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(desktop): tasks placement state machine + Ctrl+J + dock/overlay rendering"
```

---

### Task 6: CSS 清理与最终验收

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- Consumes: 全部前序任务
- Produces: 清理 `.mafw-tasks-float`、旧 `.mafw-task-panel` 外壳、`--tasks-glow` 引用；最终验收清单

- [ ] **Step 1: 清理遗留样式**

在 `mafw.css` 中删除/检查：
1. `.mafw-tasks-float` 规则（含 `animation: mafw-slide-in` 若仅此使用——保留 `mafw-slide-in` keyframes 若其他处使用，否则删除）
2. `.mafw-task-panel` 相关规则（`[data-slot="task-row"]:hover` 若已在新 TaskList 覆盖则删旧）
3. `--tasks-glow` 变量引用（若已无使用可保留定义，删除使用点）
4. 检查 `@keyframes mafw-slide-in`/`mafw-enter` 是否仍被引用（TaskList 行用 mafw-enter，保留）

执行：
```bash
# 在 mafw.css 中删除 .mafw-tasks-float、.mafw-task-panel 块；确认 --tasks-glow 无残留使用
```

- [ ] **Step 2: 构建 + 全量验证**

Run: `cd opencode-dev/packages/desktop && npm run build`
Expected: `✓ built in ...`

手动验收清单（对照设计文档 §6）：
- [ ] 无任务：头部行 = `[◉] Agent 标题`（无分隔线/TaskBar/徽章），常态成本 = 0
- [ ] 有任务：TaskBar 嵌入头部行（spinner + 当前任务 + n/N + 进度条 + 耗时 + chevron），下缘 2px accent 细线，done/total 徽章
- [ ] 全部完成：`✔ 全部完成（N/N）` → 3.5s 自动隐藏，细线收起
- [ ] 点击 TaskBar / Ctrl+J：popover 打开（头部行下方居中）；Esc / 点外部关闭
- [ ] popover Header ?? Pin → dock（右 320px 平铺）；指示条收回、busy 显示 Running；dock 关闭 → 回归 bar
- [ ] <1200px 视口：dock 显示为 overlay（浮层）
- [ ] 密度模型：>4 任务默认 ≈5 行（completed 折叠 + running/failed + 2-3 pending + 底部"还有 N 个"）
- [ ] 双主题：头部行/TaskBar/popover/dock tokens 正常
- [ ] 输入聚焦时 Ctrl+J 不触发

- [ ] **Step 3: 提交**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/mafw.css
git commit -m "chore(desktop): cleanup legacy tasks float/panel styles"
```

---

## Self-Review

- **Spec 覆盖**：架构（§1）→ Task 1/4/5；ChatHeader+TaskBar（§2）→ Task 2/3；TaskList+placement（§3）→ Task 4/5；状态机（§4）→ Task 5；数据流迁移清理（§5）→ Task 4/6；验收（§6）→ Task 6 Step 2。✓
- **占位符扫描**：所有代码步骤含完整代码；无 TBD/TODO。✓
- **类型一致性**：`TaskBar({todos,tokens,started,open,onToggle})`、`TaskList({todos,tokens,started,placement,onClose,onPin})`、`PopoverShell anchor: 'tr'|'bl'|'below-center'` 在 Task 间一致；`taskListOpen`/`tasksPlacement`/`applyTasksPlacement` 命名在 Task 3/5 一致。✓
- **已知取舍**：Task 3 Step 1 提前引用 Task 5 的状态名——Task 3 Step 1 同步添加占位状态定义保证每步可 build；Task 5 Step 1 完善。Task 5 Step 2 的 trigger 用 ref 而非 querySelector（响应式）。✓
