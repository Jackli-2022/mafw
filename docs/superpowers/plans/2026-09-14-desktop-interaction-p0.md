# Desktop 交互 P0 三件套实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 desktop 交互的三个结构性缺陷——busy 消息排队（替代静默丢弃）、离场闭环（Tray + OS 通知 + 关窗进托盘）、Goal 详情视图（View Details 真正可下钻）。

**Architecture:** 三个独立子域：(1) renderer 侧在 ChatPane busy 分支引入不可变队列 + MafwShell 的 idle 事件钩子续发（复用 sendingResetters 模式）；(2) main 侧新增 tray.ts + close 拦截 + `mafw-notify` IPC，renderer 在四类 SSE 事件挂通知（`document.hidden` 时才发）；(3) preload 暴露 SDK 已有的 `goals.sessions()`，Dashboard 加详情 overlay。纯逻辑（队列操作、关闭决策）抽无依赖模块用 `bun:test` 覆盖（先例：`src/main/window-registry.test.ts`）。

**Tech Stack:** Electron 42（Tray/Notification/ipcMain）、SolidJS signals、`@mafw/sdk`（`goals.sessions` 已存在于 client.ts:537）、bun:test。

**调研依据:** `docs/research/2026-09-14-desktop-interaction-survey.md`

## Global Constraints

- 所有命令在仓库根 `C:\work\work-loop\opencode-plugin-mafw` 下执行；desktop 包命令用 `workdir` 或 `cd packages/desktop`。
- desktop 无 jest/vitest；单测用 `bun:test`（先例 `packages/desktop/src/main/window-registry.test.ts`），运行：`cd packages/desktop && bun test <file>`。
- 全量门禁（每任务末尾必跑）：`cd packages/desktop && npx tsgo -b`（typecheck）+ `npx electron-vite build`。
- renderer 组件无测试框架，组件接线靠 typecheck + build + Task 7 手动冒烟；**可测逻辑必须抽纯模块**。
- UI 组件禁裸 `<button>`（AGENTS.md §5.10）——排队条用 `ButtonV2`；overlay 关闭按钮沿用 Dashboard/ChatPane 已有 `mafw-btn`/`ButtonV2` 模式。
- `ChatPane.tsx` 与 `Dashboard.tsx` 顶部已有 `// @ts-nocheck`，类型风险低；新增纯模块**不要**加 `@ts-nocheck`。
- 不 commit 除非任务步骤明确要求；提交直接进 main（仓库惯例，无 PR 流程）。
- CSS 变量用现有 token：`--surface-base` / `--surface-base-hover` / `--border-base` / `--text-base`（mafw.css:47-55 暗色、104-112 亮色）。

---

### Task 1: TurnQueue 纯逻辑模块（TDD）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/turn-queue.ts`
- Test: `packages/desktop/src/renderer/mafw/components/turn-queue.test.ts`

**Interfaces:**
- Produces（Task 2 消费）:
  ```ts
  export type QueuedTurn = { text: string; atts: unknown[]; agents: { name: string }[] }
  export function enqueueTurn(list: QueuedTurn[], turn: QueuedTurn): QueuedTurn[]
  export function removeTurnAt(list: QueuedTurn[], index: number): QueuedTurn[]
  export function takeFirstTurn(list: QueuedTurn[]): { first: QueuedTurn | null; rest: QueuedTurn[] }
  ```

- [ ] **Step 1: 写失败测试**

创建 `packages/desktop/src/renderer/mafw/components/turn-queue.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { enqueueTurn, removeTurnAt, takeFirstTurn, type QueuedTurn } from "./turn-queue"

const t = (text: string): QueuedTurn => ({ text, atts: [], agents: [] })

describe("turn queue", () => {
  test("enqueue appends and preserves order (FIFO)", () => {
    const q = enqueueTurn(enqueueTurn([], t("a")), t("b"))
    expect(q.map(x => x.text)).toEqual(["a", "b"])
  })

  test("enqueue does not mutate the input list", () => {
    const orig: QueuedTurn[] = []
    enqueueTurn(orig, t("x"))
    expect(orig).toEqual([])
  })

  test("takeFirstTurn returns head and rest", () => {
    const q = [t("a"), t("b"), t("c")]
    const { first, rest } = takeFirstTurn(q)
    expect(first?.text).toBe("a")
    expect(rest.map(x => x.text)).toEqual(["b", "c"])
    expect(q).toHaveLength(3) // source untouched
  })

  test("takeFirstTurn on empty list returns null and empty rest", () => {
    const { first, rest } = takeFirstTurn([])
    expect(first).toBeNull()
    expect(rest).toEqual([])
  })

  test("removeTurnAt drops only the targeted index", () => {
    const q = [t("a"), t("b"), t("c")]
    expect(removeTurnAt(q, 1).map(x => x.text)).toEqual(["a", "c"])
    expect(removeTurnAt(q, 99)).toEqual(q) // out of range is a no-op
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/turn-queue.test.ts`
Expected: FAIL（`Cannot resolve module "./turn-queue"`）

- [ ] **Step 3: 写最小实现**

创建 `packages/desktop/src/renderer/mafw/components/turn-queue.ts`：

```ts
// Busy-turn queue primitives for the chat composer. Immutable helpers so a
// SolidJS signal can hold the list and rerun on replacement (renderer/mafw
// has no component test framework; this module is the testable core).
export type QueuedTurn = { text: string; atts: unknown[]; agents: { name: string }[] }

export function enqueueTurn(list: QueuedTurn[], turn: QueuedTurn): QueuedTurn[] {
  return [...list, turn]
}

export function removeTurnAt(list: QueuedTurn[], index: number): QueuedTurn[] {
  if (index < 0 || index >= list.length) return list
  return list.filter((_, i) => i !== index)
}

export function takeFirstTurn(list: QueuedTurn[]): { first: QueuedTurn | null; rest: QueuedTurn[] } {
  if (list.length === 0) return { first: null, rest: [] }
  const [first, ...rest] = list
  return { first, rest }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/turn-queue.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/turn-queue.ts packages/desktop/src/renderer/mafw/components/turn-queue.test.ts
git commit -m "feat(desktop): turn-queue immutable primitives with tests"
```

---

### Task 2: ChatPane busy 排队接线 + 排队条 UI + idle 续发

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx:818-833`（busy 分支）、`:128-147`（信号区）、`:1047-1063`（onMount 区）、`:1879-1892`（input-area 排队条）、props 类型 `:108-116`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:292-293`（flushers record）、`:1251-1271`（四个 idle 分支）、`:2035-2038`（ChatPane props 传递）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（文件末尾追加样式）

**Interfaces:**
- Consumes: Task 1 的 `QueuedTurn` / `enqueueTurn` / `removeTurnAt` / `takeFirstTurn`
- Produces: `ChatPaneProps.onRegisterQueueFlush?: (sid: string, fn: () => void) => void` 与 `onUnregisterQueueFlush?: (sid: string) => void`（MafwShell 在 session.idle 等事件时调用 fn 实现排队续发）

- [ ] **Step 1: ChatPane 加 queued 信号与 import**

`ChatPane.tsx` 顶部 import 区（line 18 `scrollPinDecision` 之后）加：

```ts
import { enqueueTurn, removeTurnAt, takeFirstTurn, type QueuedTurn } from "./turn-queue"
```

`ChatPaneProps`（line 108-111 的 resetSending 注册对之后）加：

```ts
  onRegisterQueueFlush?: (sid: string, fn: () => void) => void
  onUnregisterQueueFlush?: (sid: string) => void
```

`PaneInner` 信号区（line 147 `canUnrevert` 之后）加：

```ts
  // Busy-turn queue: regular messages sent while a turn is running are held
  // here and dispatched on the next idle boundary (steering without abort).
  const [queuedItems, setQueuedItems] = createSignal<QueuedTurn[]>([])
```

- [ ] **Step 2: 改造 sendMessage busy 分支**

`ChatPane.tsx:827-833` 把：

```ts
    if (sending()) {
      // Voice messages (walkie-talkie) interrupt the in-flight reply; regular
      // messages stay rejected while a turn is running.
      if (!hasVoice) return
      console.log("[mafw] sendMessage: voice interrupts in-flight turn")
      try { await window.api.mafw.sessions.abort(sid) } catch { /* ignore */ }
    }
```

替换为：

```ts
    if (sending()) {
      // Voice messages (walkie-talkie) interrupt the in-flight reply; regular
      // messages queue for the next idle boundary instead of being dropped.
      if (!hasVoice) {
        setQueuedItems(prev => enqueueTurn(prev, { text, atts, agents }))
        setInput("")
        setAttachments([])
        setMentionedAgents([])
        const ta = textareaEl()
        if (ta) ta.style.height = "auto"
        return
      }
      console.log("[mafw] sendMessage: voice interrupts in-flight turn")
      try { await window.api.mafw.sessions.abort(sid) } catch { /* ignore */ }
    }
```

（`text`/`atts`/`agents` 是函数开头已有的局部变量，核心发送路径不改。）

- [ ] **Step 3: flushQueue + 注册**

`ChatPane.tsx` 的 `interrupt()`（line 1034-1044）之后加：

```ts
  // Dispatch the next queued turn (called from MafwShell on session idle).
  // Restores the turn into the composer signals, then reuses sendMessage().
  const flushQueue = () => {
    if (sending()) return
    const { first, rest } = takeFirstTurn(queuedItems())
    if (!first) return
    setQueuedItems(rest)
    setInput(first.text)
    setAttachments(first.atts as Attachment[])
    setMentionedAgents(first.agents)
    void sendMessage()
  }
```

在 ESC/Ctrl+C 的 `onMount`（line 1047-1063）里追加注册（`window.addEventListener("keydown", onKey)` 之前）：

```ts
    props.onRegisterQueueFlush?.(sidProp(), flushQueue)
    onCleanup(() => props.onUnregisterQueueFlush?.(sidProp()))
```

（该 onMount 内已有 `onCleanup` import；若放在同一个 onMount 内不便，可在其后新建一个 `onMount(() => { ... })` 块。）

- [ ] **Step 4: 排队条 UI**

`ChatPane.tsx` 的 input-area 内（line 1885 "有待回答卡片" pill 的 `<Show>` 之后、`mafw-composer` div 之前）插入：

```tsx
          <Show when={queuedItems().length > 0}>
            <div class="mafw-queue-bar">
              <span class="mafw-queue-count">⏳ {queuedItems().length} 条排队 · 回合结束后自动发送</span>
              <For each={queuedItems()}>
                {(q, i) => (
                  <span class="mafw-chip">
                    <span class="mafw-chip-label">{q.text.trim().slice(0, 40) || `(${q.atts.length} 个附件)`}</span>
                    <ButtonV2 variant="ghost" size="small" class="mafw-chip-x" onClick={() => setQueuedItems(removeTurnAt(queuedItems(), i()))} aria-label="移除排队消息">✕</ButtonV2>
                  </span>
                )}
              </For>
              <ButtonV2 variant="ghost" size="small" onClick={() => setQueuedItems([])}>清空</ButtonV2>
            </div>
          </Show>
```

- [ ] **Step 5: MafwShell 接线 idle 续发**

`MafwShell.tsx:292-293`（sendingResetters 声明旁）加：

```ts
  const queueFlushers: Record<string, () => void> = {}
```

四个复位分支各追加一行 `queueFlushers[sid]?.()`：
- `message.complete` 分支（line 1251-1255，`expireSessionCards(sid)` 之后）
- `message.part.complete` 分支（line 1256-1259，`sendingResetters[sid]?.()` 之后）
- `session.idle` 分支（line 1260-1267，`expireSessionCards(sid)` 之后）
- `session.error/message.error/message.aborted` 分支（line 1268-1271，`expireSessionCards(sid)` 之后）

ChatPane 渲染 props（line 2035-2038 的 onRegister/onUnregister 对之后）加：

```tsx
                          onRegisterQueueFlush={(s, fn) => { queueFlushers[s] = fn }}
                          onUnregisterQueueFlush={(s) => { delete queueFlushers[s] }}
```

- [ ] **Step 6: CSS**

`mafw.css` 文件末尾追加：

```css
/* Busy-turn queue bar (composer above-row, P0-1) */
.mafw-queue-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 12px; margin-bottom: 6px; border: 0.5px solid var(--border-base, rgba(255,255,255,0.12)); border-radius: 10px; background: var(--surface-base-hover); }
.mafw-queue-count { font-size: 11px; color: var(--text-base); white-space: nowrap; }
```

- [ ] **Step 7: 验证**

Run: `cd packages/desktop && bun test src/renderer/mafw/components/turn-queue.test.ts && npx tsgo -b && npx electron-vite build`
Expected: 5 tests PASS + typecheck 0 error + build 成功

- [ ] **Step 8: 手动冒烟（dev）**

Run: `cd packages/desktop && npm run dev`
1. 发一条需要长回复的消息（如"数到 100 再总结"），busy 时再发第二条 → 第二条**不消失**，出现排队条
2. 回合结束 → 排队消息自动发出，排队条消失
3. 排队条 ✕ 单条移除 / 清空可用
4. 语音消息 busy 时发送 → 仍然打断（行为不变）

- [ ] **Step 9: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): queue busy-turn messages and auto-dispatch on idle (steering)"
```

---

### Task 3: close-to-tray 决策 + 窗口 close 拦截（TDD 决策函数）

**Files:**
- Create: `packages/desktop/src/main/close-decision.ts`
- Test: `packages/desktop/src/main/close-decision.test.ts`
- Create: `packages/desktop/src/main/tray-prefs.ts`
- Modify: `packages/desktop/src/main/window-registry.ts:18-46`（加 isQuitting getter）
- Modify: `packages/desktop/src/main/windows.ts`（import + registerWindow close 拦截 + 导出 trayIconPath）

**Interfaces:**
- Produces:
  ```ts
  // close-decision.ts
  export type WindowCloseAction = "close" | "hide-to-tray"
  export function windowCloseAction(opts: { isQuitting: boolean; closeToTray: boolean }): WindowCloseAction
  // tray-prefs.ts
  export function isCloseToTrayEnabled(): boolean   // 默认 true
  export function setCloseToTray(enabled: boolean): void
  // windows.ts 新导出
  export function trayIconPath(): string   // resources/icons/icon.png
  ```

- [ ] **Step 1: 写失败测试**

创建 `packages/desktop/src/main/close-decision.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { windowCloseAction } from "./close-decision"

describe("window close action", () => {
  test("always close while the app is quitting", () => {
    expect(windowCloseAction({ isQuitting: true, closeToTray: true })).toBe("close")
  })

  test("hides to tray when enabled and not quitting", () => {
    expect(windowCloseAction({ isQuitting: false, closeToTray: true })).toBe("hide-to-tray")
  })

  test("closes when the preference is off", () => {
    expect(windowCloseAction({ isQuitting: false, closeToTray: false })).toBe("close")
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/desktop && bun test src/main/close-decision.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

创建 `packages/desktop/src/main/close-decision.ts`（零 import，纯函数）：

```ts
// Decides what a window `close` event should do. Pure so it stays testable
// without Electron; the preference itself lives in tray-prefs.ts.
export type WindowCloseAction = "close" | "hide-to-tray"

export function windowCloseAction(opts: { isQuitting: boolean; closeToTray: boolean }): WindowCloseAction {
  if (opts.isQuitting) return "close"
  return opts.closeToTray ? "hide-to-tray" : "close"
}
```

创建 `packages/desktop/src/main/tray-prefs.ts`：

```ts
import { getStore } from "./store"

const CLOSE_TO_TRAY_KEY = "closeToTray"

export function isCloseToTrayEnabled(): boolean {
  return getStore().get(CLOSE_TO_TRAY_KEY, true) as boolean
}

export function setCloseToTray(enabled: boolean): void {
  getStore().set(CLOSE_TO_TRAY_KEY, enabled)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/desktop && bun test src/main/close-decision.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: registry 加 isQuitting getter**

`window-registry.ts` 返回对象（line 20 `setQuitting` 之后）加：

```ts
    isQuitting() {
      return quitting
    },
```

- [ ] **Step 6: windows.ts close 拦截 + trayIconPath**

`windows.ts` import 区加：

```ts
import { windowCloseAction } from "./close-decision"
import { isCloseToTrayEnabled } from "./tray-prefs"
```

`iconPath()`（line 90-93）之后加：

```ts
export function trayIconPath() {
  return join(iconsDir(), "icon.png")
}
```

`registerWindow`（line 232-241）的 `win.on("closed", ...)` 之前加：

```ts
  // Close-to-tray: hide instead of destroying while the app keeps running
  // (the MAFW gateway daemon is independent and keeps working).
  win.on("close", (event) => {
    const action = windowCloseAction({
      isQuitting: registry.isQuitting(),
      closeToTray: isCloseToTrayEnabled(),
    })
    if (action === "hide-to-tray") {
      event.preventDefault()
      win.hide()
    }
  })
```

- [ ] **Step 7: 验证**

Run: `cd packages/desktop && bun test src/main/close-decision.test.ts && npx tsgo -b`
Expected: 3 tests PASS + typecheck 0 error

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src/main/close-decision.ts packages/desktop/src/main/close-decision.test.ts packages/desktop/src/main/tray-prefs.ts packages/desktop/src/main/window-registry.ts packages/desktop/src/main/windows.ts
git commit -m "feat(desktop): close-to-tray decision + window close interception"
```

---

### Task 4: Tray 图标与菜单 + main 挂载

**Files:**
- Create: `packages/desktop/src/main/tray.ts`
- Modify: `packages/desktop/src/main/index.ts:269`（`setDockIcon()` 之后挂 tray）

**Interfaces:**
- Consumes: Task 3 的 `trayIconPath`（windows.ts）、`isCloseToTrayEnabled`/`setCloseToTray`（tray-prefs.ts）、`getLastFocusedWindow`（windows.ts:150 已有）
- Produces: `createTray(): Tray`（index.ts 调用一次）

- [ ] **Step 1: 写 tray.ts**

创建 `packages/desktop/src/main/tray.ts`：

```ts
import { Menu, Tray, nativeImage, app } from "electron"
import { getLastFocusedWindow, trayIconPath } from "./windows"
import { isCloseToTrayEnabled, setCloseToTray } from "./tray-prefs"
import { write as writeLog } from "./logging"

let tray: Tray | null = null

export function createTray(): Tray | null {
  if (tray) return tray
  try {
    const icon = nativeImage.createFromPath(trayIconPath())
    if (icon.isEmpty()) {
      writeLog("utility", "tray icon missing, skipping tray", { path: trayIconPath() }, "warn")
      return null
    }
    tray = new Tray(icon)
    tray.setToolTip("MAFW Desktop")
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Show MAFW", click: () => { const win = getLastFocusedWindow(); if (win) { win.show(); win.focus() } } },
      { type: "separator" },
      { label: "Close to tray", type: "checkbox", checked: isCloseToTrayEnabled(), click: (item) => setCloseToTray(item.checked) },
      { type: "separator" },
      { label: "Quit", click: () => { app.quit() } },
    ]))
    // Windows/Linux: single (left) click shows the window.
    tray.on("click", () => { const win = getLastFocusedWindow(); if (win) { win.show(); win.focus() } })
    writeLog("utility", "tray created", { path: trayIconPath() })
    return tray
  } catch (err) {
    writeLog("utility", "tray creation failed", { err: String(err) }, "warn")
    return null
  }
}
```

- [ ] **Step 2: main/index.ts 挂载**

`index.ts` import 区（line 40-41 `setDockIcon, restoreMainWindows,` 所在的 from "./windows" import 块之后）加：

```ts
import { createTray } from "./tray"
```

line 269 `setDockIcon()` 之后加：

```ts
  createTray()
```

- [ ] **Step 3: 验证**

Run: `cd packages/desktop && npx tsgo -b && npx electron-vite build`
Expected: typecheck 0 error + build 成功

- [ ] **Step 4: 手动冒烟**

Run: `cd packages/desktop && npm run dev`
1. 系统托盘出现 MAFW 图标；悬停显示 "MAFW Desktop"
2. 点窗口 ✕ → 窗口隐藏、托盘图标仍在、app 进程活着（任务管理器确认）
3. 托盘左键单击 → 窗口恢复
4. 托盘右键 → Show MAFW / Close to tray checkbox / Quit
5. 取消勾选 Close to tray → 点 ✕ → app 直接退出
6. Quit 菜单 → app 退出（close 拦截不阻塞退出路径）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/tray.ts packages/desktop/src/main/index.ts
git commit -m "feat(desktop): system tray with show/quit and close-to-tray toggle"
```

---

### Task 5: OS 通知 IPC + renderer 事件挂点

**Files:**
- Modify: `packages/desktop/src/main/mafw-ipc.ts`（加 `mafw-notify` handler）
- Modify: `packages/desktop/src/preload/mafw-api.ts`（notify 方法）
- Modify: `packages/desktop/src/preload/mafw-types.ts`（MafwAPI 顶层 notify 类型）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:1075-1099`（三类事件挂点）、`:1260-1267`（session.idle 挂点）

**Interfaces:**
- Produces: `window.api.notify(opts: { title: string; body: string }): Promise<boolean>`（main 进程弹 OS 通知，点击聚焦窗口；不支持时返回 false）

- [ ] **Step 1: main 侧 handler**

`mafw-ipc.ts` import 区改为（新增 Notification 与 windows 依赖）：

```ts
import { MafwClient } from "@mafw/sdk"
import { BrowserWindow, Notification, app, ipcMain } from "electron"
import { getLastFocusedWindow, trayIconPath } from "./windows"
```

`registerMafwIpcHandlers()` 内（`mafw-gateway-info` handler 附近）加：

```ts
  // OS-level notification for away-from-window moments (close-to-tray).
  // The renderer decides relevance (document.hidden) and throttling.
  ipcMain.handle("mafw-notify", (_event: IpcMainInvokeEvent, opts: { title: string; body: string }) => {
    if (!Notification.isSupported()) return false
    try {
      const n = new Notification({ title: opts.title, body: opts.body, icon: trayIconPath() })
      n.on("click", () => { const win = getLastFocusedWindow(); if (win) { win.show(); win.focus() } })
      n.show()
      return true
    } catch {
      return false
    }
  })
```

- [ ] **Step 2: preload 暴露**

`mafw-api.ts` 的 `createMafwApi()` 返回对象**顶层**（`gateway: {...},` 之前）加：

```ts
    notify: (opts: { title: string; body: string }) => ipcRenderer.invoke("mafw-notify", opts) as Promise<boolean>,
```

`mafw-types.ts` 的 `MafwAPI` 类型**顶层**（`gateway: {...}` 之前）加：

```ts
  notify: (opts: { title: string; body: string }) => Promise<boolean>
```

- [ ] **Step 3: renderer 挂点**

`MafwShell.tsx`（sendingResetters 声明附近，line 292-293 区域）加辅助与节流表：

```ts
  // OS notification only when the window is hidden (tray/minimized); the
  // in-app toasts remain the primary feedback while the window is visible.
  const notifyIfHidden = (title: string, body: string) => {
    if (!document.hidden) return
    void window.api.notify?.({ title, body }).catch(() => { /* fail-open */ })
  }
  const lastIdleNotify: Record<string, number> = {}
```

三个事件分支各加一行（body 取自事件摘要，`return` 之前）：

- `user_question`（line 1077 `setActiveQuestion(event as QuestionData)` 之后）：
  ```ts
        notifyIfHidden("MAFW：Agent 需要你的回答", String(event.question || "").slice(0, 80))
  ```
- `question.asked`（line 1092 `upsertCard(...)` 之后）：
  ```ts
        notifyIfHidden("MAFW：Agent 提问", String(event.properties?.question || "").slice(0, 80))
  ```
- `permission.asked`（line 1097 `upsertCard(...)` 之后）：
  ```ts
        notifyIfHidden("MAFW：需要权限审批", String(event.properties?.permission?.tool || "工具调用").slice(0, 80))
  ```

`session.idle` 分支（line 1260-1267，Task 2 已在此加过 `queueFlushers[sid]?.()`）末尾加带节流的完成通知：

```ts
        if (document.hidden && Date.now() - (lastIdleNotify[sid] || 0) > 60_000) {
          lastIdleNotify[sid] = Date.now()
          const title = sessions().find(s => s.id === sid)?.title || "会话"
          notifyIfHidden("MAFW：回合完成", `「${title}」已回复`)
        }
```

- [ ] **Step 4: 验证**

Run: `cd packages/desktop && npx tsgo -b && npx electron-vite build`
Expected: typecheck 0 error + build 成功

- [ ] **Step 5: 手动冒烟**

Run: `cd packages/desktop && npm run dev`
1. 窗口最小化（或点 ✕ 进托盘）→ 发消息触发权限卡 → OS 通知弹出；点击通知 → 窗口恢复并聚焦
2. 窗口可见时同样事件 → **无** OS 通知（只有窗口内 toast/卡片）
3. 隐藏窗口等回合结束 → "回合完成"通知；60s 内多次 idle 只通知一次
4. Windows 专注助手开启时通知被系统吞属预期（fail-open）

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/main/mafw-ipc.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/src/preload/mafw-types.ts packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(desktop): OS notifications for permission/question/idle when window hidden"
```

---

### Task 6: Goal 详情视图（View Details 下钻）

**Files:**
- Modify: `packages/desktop/src/preload/mafw-types.ts:87-92`（goals 加 sessions）+ 顶部 import 加 `GoalSessionInfo`
- Modify: `packages/desktop/src/preload/mafw-api.ts:98-102`（goals 加 sessions）
- Create: `packages/desktop/src/renderer/mafw/components/GoalDetailOverlay.tsx`
- Modify: `packages/desktop/src/renderer/mafw/pages/Dashboard.tsx`（View Details 打开 overlay + onOpenSession prop）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:2212`（传 onOpenSession）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（overlay 样式）

**Interfaces:**
- Consumes: SDK 已有 `goals.sessions(goalId): Promise<GoalSessionInfo[]>`（gateway-sdk/src/client.ts:537，经通用 `mafw-invoke` 派发，main 零改动）；`GoalSessionInfo = { sessionID: string; phase: string; loop: number; title?: string; time?: { created?: number; updated?: number } }`（sdk types.ts:510-516）
- Produces: `DashboardPage(props: { onOpenSession?: (sid: string) => void })`（MafwShell 传 `openSessionTab`）

- [ ] **Step 1: preload 类型与方法**

`mafw-types.ts` line 2 import 列表加 `GoalSessionInfo`；goals 命名空间（line 87-92）加：

```ts
    sessions: (id: string) => Promise<GoalSessionInfo[]>
```

`mafw-api.ts` goals 命名空间（line 98-102）加：

```ts
      sessions: (id) => invoke("goals", "sessions", id),
```

- [ ] **Step 2: 写 GoalDetailOverlay 组件**

创建 `packages/desktop/src/renderer/mafw/components/GoalDetailOverlay.tsx`：

```tsx
// @ts-nocheck
import { createSignal, Show, For, onMount, onCleanup } from "solid-js"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"

// Goal drill-down: metadata (goals.get) + orchestrations session list
// (goals.sessions, gateway /api/goals/:id/sessions). Clicking a session opens
// it as a chat tab via MafwShell.openSessionTab.
export function GoalDetailOverlay(props: { goalId: string | null; onClose: () => void; onOpenSession: (sid: string) => void }) {
  const [goal, setGoal] = createSignal<any>(null)
  const [sessions, setSessions] = createSignal<any[]>([])
  const [loading, setLoading] = createSignal(false)

  createEffect(async () => {
    const id = props.goalId
    if (!id) { setGoal(null); setSessions([]); return }
    setLoading(true)
    try {
      const [g, s] = await Promise.all([
        window.api.mafw.goals.get(id),
        window.api.mafw.goals.sessions(id),
      ])
      setGoal(g)
      setSessions(s || [])
    } catch (e) { console.warn("[mafw] goal detail load failed:", e) }
    setLoading(false)
  })

  onMount(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose() }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  return (
    <Show when={props.goalId}>
      <div class="mafw-goal-overlay" onClick={e => { if (e.target === e.currentTarget) props.onClose() }}>
        <div class="mafw-goal-panel">
          <div class="mafw-goal-head">
            <div style={{ "min-width": 0 }}>
              <div class="mafw-card-title">{goal()?.goalId || props.goalId}</div>
              <div class="mafw-card-meta">{goal()?.title || ""}</div>
            </div>
            <button class="mafw-btn" onClick={props.onClose} aria-label="关闭详情">✕</button>
          </div>
          <Show when={!loading()} fallback={
            <div style={{ display: "flex", gap: 8, padding: "32px 0", "justify-content": "center" }}>
              <LoaderV2 width={16} height={16} />
            </div>
          }>
            <div class="mafw-goal-meta">
              <span class="mafw-badge">{goal()?.phase || "UNKNOWN"}</span>
              <span class="mafw-card-meta">Wave {goal()?.currentWave ?? "?"}/{goal()?.totalWaves ?? "?"} · Loop {goal()?.loop ?? 0}</span>
            </div>
            <Show when={goal()?.charter}>
              <div class="mafw-goal-charter">{goal()?.charter}</div>
            </Show>
            <div class="mafw-goal-sessions">
              <div class="mafw-goal-sec-title">编排会话（{sessions().length}）</div>
              <Show when={sessions().length === 0} fallback={
                <For each={sessions()}>
                  {(s) => (
                    <div class="mafw-goal-session" onClick={() => props.onOpenSession(s.sessionID)}>
                      <span class="mafw-goal-session-title">{s.title || s.sessionID}</span>
                      <span class="mafw-card-meta">{s.phase}{s.loop ? ` · Loop ${s.loop}` : ""}</span>
                    </div>
                  )}
                </For>
              }>
                <div class="mafw-empty">暂无会话记录</div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )
}
```

（`createEffect(async ...)` 中 async 回调 Solid 允许但不追踪 await 后的依赖——此处只依赖 `props.goalId`，在 await 前读取，安全。）

- [ ] **Step 3: Dashboard 接线**

`Dashboard.tsx`：
- import 区加：`import { GoalDetailOverlay } from "../components/GoalDetailOverlay"`
- 签名改为 `export function DashboardPage(props: { onOpenSession?: (sid: string) => void }) {`
- 信号区加：`const [detailGoalId, setDetailGoalId] = createSignal<string | null>(null)`
- View Details 菜单项（line 29）改为：
  ```ts
      { label: "View Details", onSelect: () => setDetailGoalId(g.goalId) },
  ```
- return 的最外层 `<div>` 末尾（`</div>` 闭合前）加：
  ```tsx
        <GoalDetailOverlay
          goalId={detailGoalId()}
          onClose={() => setDetailGoalId(null)}
          onOpenSession={(sid) => { setDetailGoalId(null); props.onOpenSession?.(sid) }}
        />
  ```

- [ ] **Step 4: MafwShell 传 openSessionTab**

`MafwShell.tsx:2212` 的 `<DashboardPage />` 改为：

```tsx
              <DashboardPage onOpenSession={openSessionTab} />
```

- [ ] **Step 5: CSS**

`mafw.css` 末尾追加：

```css
/* Goal detail overlay (P0-3) */
.mafw-goal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; }
.mafw-goal-panel { width: min(640px, 90vw); max-height: 80vh; overflow-y: auto; background: var(--surface-base); border: 0.5px solid var(--border-base, rgba(255,255,255,0.12)); border-radius: 12px; padding: 16px; }
.mafw-goal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.mafw-goal-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.mafw-goal-charter { font-size: 12px; color: var(--text-base); white-space: pre-wrap; border: 0.5px solid var(--border-base, rgba(255,255,255,0.12)); border-radius: 8px; padding: 10px; margin-bottom: 12px; max-height: 200px; overflow-y: auto; }
.mafw-goal-sec-title { font-size: 11px; color: var(--text-base); margin-bottom: 6px; }
.mafw-goal-session { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.mafw-goal-session:hover { background: var(--surface-base-hover); }
.mafw-goal-session-title { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 6: 验证**

Run: `cd packages/desktop && npx tsgo -b && npx electron-vite build`
Expected: typecheck 0 error + build 成功

- [ ] **Step 7: 手动冒烟**

Run: `cd packages/desktop && npm run dev`（需 gateway 运行 + 至少一个历史 goal，可先跑一轮小 goal）
1. Goals 页右键 goal → View Details → overlay 弹出：phase 徽标 / Wave·Loop / charter / 会话列表
2. 点击任一会话 → overlay 关闭 + 该会话以 chat tab 打开
3. Esc / 点击遮罩 → 关闭
4. 无 goal 时页面不受影响

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src/preload/mafw-types.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/src/renderer/mafw/components/GoalDetailOverlay.tsx packages/desktop/src/renderer/mafw/pages/Dashboard.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): goal detail overlay with session drill-down"
```

---

### Task 7: 全量验证与收尾

**Files:**
- 无新文件；只跑门禁与回归

- [ ] **Step 1: desktop 全部单测**

Run: `cd packages/desktop && bun test`
Expected: turn-queue（5）+ close-decision（3）+ window-registry（既有 8）全部 PASS

- [ ] **Step 2: typecheck + build**

Run: `cd packages/desktop && npx tsgo -b && npx electron-vite build`
Expected: 0 error，build 产物生成

- [ ] **Step 3: 邻近回归（preload/main 无关 gateway，跑 SDK 测试确认无破坏）**

Run: `npm test --prefix gateway`（如时间紧可只跑 `gateway/tests/unit` 中 sdk/路由相关）
Expected: 全量通过（439+ 基线）

- [ ] **Step 4: 端到端手动冒烟（汇总）**

`cd packages/desktop && npm run dev`，依次验证：
1. busy 排队 → idle 自动续发；语音仍打断
2. ✕ 进托盘 / 托盘恢复 / Quit 真退出
3. 隐藏时权限卡/提问/回合完成出 OS 通知，点击聚焦
4. Goal 详情下钻 → 会话打开
5. 多 tab + 分屏下排队条仅出现在对应 pane

- [ ] **Step 5: 汇报**

按用户惯例汇报：commit 范围（首尾 hash）、新增测试数（预期 8）、全量通过数（desktop bun test 总数 + gateway 全量）。

---

## Self-Review 记录

- **Spec 覆盖**：P0-1（Task 1-2）、P0-2（Task 3-5）、P0-3（Task 6）——调研报告 §4 建议的 P0 三件套全覆盖；P1/P2（审批模式选择器、@file、draft、会话搜索等）明确不在本计划，留待下批。
- **占位符扫描**：Task 4 初稿曾含 `showMainWindow` 占位死函数，已删除，所有步骤均含完整代码与命令。
- **类型一致性**：`QueuedTurn` 在 Task 1 定义、Task 2 消费（`atts: unknown[]` ↔ `Attachment[]` 经 `as` 断言，ChatPane 有 @ts-nocheck 兜底）；`windowCloseAction` 签名在 Task 3 定义并消费；`GoalSessionInfo` 字段与 sdk types.ts:510-516 逐字核对；`notify` 类型 preload 两文件一致。
- **已知风险**：① `tray.ts` 与 `windows.ts` 无循环 import（tray→windows 单向）；② `mafw-notify` 在窗口全部关闭（都在托盘）时 `getLastFocusedWindow()` 返回 null → 通知点击无动作，可接受（托盘 click 路径仍在）；③ electron-store `get(key, true)` 默认值语义已按其 API 写法。
