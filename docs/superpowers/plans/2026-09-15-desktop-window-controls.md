# Desktop Windows 自绘窗口控制按钮 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Windows 上去掉 Electron 原生 titleBarOverlay，自绘 Win11 Fluent 风格的最小化/最大化/关闭按钮，并对标题栏做轻量修饰（状态点 tooltip、底部分隔线）。

**Architecture:** Main 进程新增 4 个窗口控制 IPC handler + maximize 事件推送；preload 暴露 `platform` 与 `windowControls` API；renderer 新增 `WindowControls` 组件（仅 win32 渲染），MafwShell 接线。

**Tech Stack:** Electron (main/preload)、SolidJS (renderer)、CSS 变量主题。

**Spec:** `docs/superpowers/specs/2026-09-15-desktop-window-controls-design.md`

## Global Constraints

- desktop 包**无自动化测试基建**（不在 CI）：每个 Task 的验证门槛为 `bun run typecheck`（tsgo -b，工作目录 `packages/desktop`），最终 Task 4 做 `npx electron-vite build` + 人工运行验证。
- **TDD 不适用**：无测试 runner，不新增测试框架（YAGNI）；以 typecheck + 编译 + 截图作为质量门。
- macOS / Linux 行为必须零变化（darwin 红绿灯、linux 原生边框不动）。
- 提交前必须 typecheck 通过；所有 commit 需用户确认后执行，直接提交到 master/main。
- 关闭按钮必须走 `win.close()`，以复用现有 close-to-tray 逻辑（`windows.ts` 的 `win.on("close")`）。

---

### Task 1: Main 进程——移除 titleBarOverlay + 窗口控制 IPC

**Files:**
- Modify: `packages/desktop/src/main/windows.ts`
- Modify: `packages/desktop/src/main/ipc.ts`
- Modify: `packages/desktop/src/main/desktop-menu-actions.ts`

**Interfaces:**
- Produces: IPC handlers `window-minimize` / `window-toggle-maximize` / `window-close` / `window-is-maximized`；事件 `window-maximized-changed`（payload: boolean）。Task 2 的 preload 依赖这些名字。

- [ ] **Step 1: windows.ts——删除 overlay 相关代码**

删除 `const titlebarThemes = new WeakMap<BrowserWindow, Partial<TitlebarTheme>>()`（原 53 行）、`const titlebarHeight = 40`（原 64 行）。

将 `overlay()`、`setTitlebar()`、`updateTitlebar()` 三个函数（原 109-133 行）整体替换为：

```ts
export function setTitlebar(_win: BrowserWindow, theme: Partial<TitlebarTheme> = {}) {
  // macOS draws the window frame hairline and shadow using the NSWindow
  // appearance, which follows nativeTheme rather than the rendered content.
  // Align it with the app theme so a light app on a dark system does not get
  // the dark-appearance border and shadow. A "system" scheme must map to
  // "system" (not the resolved mode) or prefers-color-scheme stops tracking
  // OS appearance changes in the renderer.
  if (process.platform === "darwin") nativeTheme.themeSource = theme.scheme ?? theme.mode ?? "system"
}
```

（`updateTitlebar` 与 `overlay` 彻底删除；`setTitlebar` 保留 darwin 分支，参数 `win` 加下划线前缀避免未使用告警。）

- [ ] **Step 2: windows.ts——createMainWindow 移除 win32 titleBarOverlay**

删除 `const mode = tone()`（原 179 行，仅 overlay 使用）。win32 分支改为：

```ts
    ...(process.platform === "win32"
      ? {
          frame: false,
          titleBarStyle: "hidden" as const,
        }
      : {}),
```

- [ ] **Step 3: windows.ts——updateZoom 去掉 updateTitlebar 调用**

`updateZoom`（原 530-533 行）改为：

```ts
function updateZoom(win: BrowserWindow) {
  win.webContents.send("zoom-factor-changed", win.webContents.getZoomFactor())
}
```

- [ ] **Step 4: windows.ts——registerWindow 推送最大化状态**

在 `registerWindow` 中 `win.on("closed", ...)` 之前加入：

```ts
  const notifyMaximized = () => {
    if (!win.isDestroyed()) win.webContents.send("window-maximized-changed", win.isMaximized())
  }
  win.on("maximize", notifyMaximized)
  win.on("unmaximize", notifyMaximized)
  win.on("restore", notifyMaximized)
```

- [ ] **Step 5: ipc.ts——新增 4 个窗口控制 handler，清理 updateTitlebar**

从 import 中移除 `updateTitlebar`（原 13 行）。删除 `set-zoom-factor` handler 中的 `updateTitlebar(win)` 调用（原 244-246 行），改为：

```ts
  ipcMain.handle("set-zoom-factor", (event: IpcMainInvokeEvent, factor: number) => {
    event.sender.setZoomFactor(factor)
  })
```

在 `show-window` handler（原 232-235 行）之后新增：

```ts
  ipcMain.handle("window-minimize", (event: IpcMainInvokeEvent) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle("window-toggle-maximize", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle("window-close", (event: IpcMainInvokeEvent) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle("window-is-maximized", (event: IpcMainInvokeEvent) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })
```

- [ ] **Step 6: desktop-menu-actions.ts——清理 updateTitlebar**

删除 import 中的 `updateTitlebar`（原 3 行，`import { createMainWindow, updateTitlebar } from "./windows"` → `import { createMainWindow } from "./windows"`）。`setZoom`（原 80-84 行）改为：

```ts
function setZoom(win: BrowserWindow | null, value: number) {
  if (!win) return
  win.webContents.setZoomFactor(Math.min(Math.max(value, 0.2), 10))
}
```

- [ ] **Step 7: typecheck 验证**

Run: `bun run typecheck`（workdir: `packages/desktop`）
Expected: 通过，无 `updateTitlebar`/`overlay` 残留引用错误。

- [ ] **Step 8: Commit（需用户确认）**

```bash
git add packages/desktop/src/main/windows.ts packages/desktop/src/main/ipc.ts packages/desktop/src/main/desktop-menu-actions.ts
git commit -m "feat(desktop): win32 移除 titleBarOverlay，新增窗口控制 IPC"
```

---

### Task 2: Preload——platform + windowControls API

**Files:**
- Modify: `packages/desktop/src/preload/types.ts`
- Modify: `packages/desktop/src/preload/index.ts`

**Interfaces:**
- Consumes: Task 1 的 IPC handler 名与事件名。
- Produces: `window.api.platform: string`、`window.api.windowControls.{minimize,toggleMaximize,close,isMaximized,onMaximizedChange}`——Task 3 的 WindowControls 组件与 MafwShell 依赖。

- [ ] **Step 1: types.ts——ElectronAPI 增加字段**

在 `ElectronAPI` 类型中 `setTitlebar` 之前加入：

```ts
  platform: string
  windowControls: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onMaximizedChange: (cb: (maximized: boolean) => void) => () => void
  }
```

- [ ] **Step 2: index.ts——实现**

在 `api` 对象中 `setTitlebar:`（原 129 行）之前加入：

```ts
  platform: process.platform,
  windowControls: {
    minimize: () => ipcRenderer.invoke("window-minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window-toggle-maximize"),
    close: () => ipcRenderer.invoke("window-close"),
    isMaximized: () => ipcRenderer.invoke("window-is-maximized"),
    onMaximizedChange: (cb) => {
      const handler = (_: unknown, maximized: boolean) => cb(maximized)
      ipcRenderer.on("window-maximized-changed", handler)
      return () => ipcRenderer.removeListener("window-maximized-changed", handler)
    },
  },
```

（sandbox 预加载脚本中 `process.platform` 可用——Electron 为 sandboxed preload 提供 process 子集。）

- [ ] **Step 3: typecheck 验证**

Run: `bun run typecheck`（workdir: `packages/desktop`）
Expected: 通过。

- [ ] **Step 4: Commit（需用户确认）**

```bash
git add packages/desktop/src/preload/types.ts packages/desktop/src/preload/index.ts
git commit -m "feat(desktop): preload 暴露 platform 与 windowControls"
```

---

### Task 3: Renderer——WindowControls 组件 + MafwShell 接线 + CSS

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/WindowControls.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- Consumes: `window.api.platform`、`window.api.windowControls`（Task 2）；既有组件 `TooltipV2`（MafwShell 已导入）。
- Produces: `.mafw-shell.maximized`、`.mafw-window-controls`、`.mafw-wc-btn`、`.mafw-wc-close` CSS 类。

- [ ] **Step 1: 新建 WindowControls.tsx**

```tsx
import { createSignal, onCleanup, onMount, Show } from "solid-js"

const isWin32 = window.api.platform === "win32"

export function WindowControls() {
  const [maximized, setMaximized] = createSignal(false)

  onMount(() => {
    void window.api.windowControls.isMaximized().then(setMaximized)
    const unsub = window.api.windowControls.onMaximizedChange(setMaximized)
    onCleanup(unsub)
  })

  return (
    <Show when={isWin32}>
      <div class="mafw-window-controls">
        <button
          class="mafw-wc-btn"
          aria-label="最小化"
          onClick={() => void window.api.windowControls.minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5h10" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
        <button
          class="mafw-wc-btn"
          aria-label={maximized() ? "还原" : "最大化"}
          onClick={() => void window.api.windowControls.toggleMaximize()}
        >
          <Show
            when={maximized()}
            fallback={
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
              </svg>
            }
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2.5 2.5V1h7v7H8" fill="none" stroke="currentColor" />
              <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" />
            </svg>
          </Show>
        </button>
        <button
          class="mafw-wc-btn mafw-wc-close"
          aria-label="关闭"
          onClick={() => void window.api.windowControls.close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0.7 0.7L9.3 9.3M9.3 0.7L0.7 9.3" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
      </div>
    </Show>
  )
}
```

- [ ] **Step 2: MafwShell.tsx——导入与 maximized 状态**

文件顶部组件 import 区加入：

```ts
import { WindowControls } from "./components/WindowControls"
```

在组件内既有 `createSignal` 声明区附近加入（紧跟 `const [titlebarRef, setTitlebarRef] = ...` 之后即可）：

```tsx
  const [winMaximized, setWinMaximized] = createSignal(false)
  onMount(() => {
    if (window.api.platform !== "win32") return
    void window.api.windowControls.isMaximized().then(setWinMaximized)
    const unsub = window.api.windowControls.onMaximizedChange(setWinMaximized)
    onCleanup(unsub)
  })
```

（`onMount`/`onCleanup`/`createSignal` 文件已有导入，无需新增。）

- [ ] **Step 3: MafwShell.tsx——根元素加 maximized class**

`<div class="mafw-shell">`（原 2065 行）改为：

```tsx
      <div class="mafw-shell" classList={{ maximized: winMaximized() }}>
```

- [ ] **Step 4: MafwShell.tsx——标题栏 JSX 改造**

将标题栏块（原 2080-2099 行）替换为：

```tsx
      <div
        class="mafw-titlebar"
        onDblClick={(e) => {
          if (window.api.platform !== "win32") return
          if ((e.target as HTMLElement).closest("button")) return
          void window.api.windowControls.toggleMaximize()
        }}
      >
        <Icon name="logo" size="small" />
        <span style={{ "font-size": 13, "font-weight": 600, color: "var(--text-2)" }}>MAFW</span>
        <TooltipV2
          value={
            gwStatus()?.state === "ready" ? "Gateway 已连接" :
            gwStatus()?.state === "starting" ? "Gateway 启动中" :
            gwStatus()?.state === "failed" ? "Gateway 启动失败" :
            "Gateway 已停止"
          }
          openDelay={300}
        >
          <div class="mafw-titlebar-dot" classList={{
            ready: gwStatus()?.state === "ready",
            starting: gwStatus()?.state === "starting",
            failed: gwStatus()?.state === "failed",
            stopped: !gwStatus() || gwStatus()?.state === "stopped",
          }} style={{ "margin-left": 4 }} />
        </TooltipV2>
        <TooltipV2 value="切换主题" openDelay={300}>
          <ButtonV2 variant="ghost" size="small" class="mafw-theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
            {theme() === 'light' ? '☀' : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M11.2 8.9A5 5 0 1 1 5.1 2.8a4 4 0 0 0 6.1 6.1Z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            )}
          </ButtonV2>
        </TooltipV2>
        <div style={{ flex: 1 }} />
        <WindowControls />
      </div>
```

（改动点：加 onDblClick、状态点包 TooltipV2、尾部挂 `<WindowControls />`。）

- [ ] **Step 5: mafw.css——样式**

`.mafw-titlebar` 规则（原 173-182 行）改为：

```css
.mafw-titlebar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 0 0 12px;
  height: 38px;
  background: var(--bg-base);
  border-bottom: 1px solid var(--border-subtle);
  -webkit-app-region: drag;
  user-select: none;
}
```

在 `.mafw-titlebar` 规则块之后新增：

```css
/* ── Window controls (win32 自绘 caption 按钮, Win11 Fluent) ── */
.mafw-window-controls { display: flex; align-self: stretch; flex-shrink: 0; -webkit-app-region: no-drag; }
.mafw-wc-btn {
  width: 46px;
  border: none;
  background: transparent;
  color: var(--text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: background .1s, color .1s;
}
.mafw-wc-btn:hover { background: var(--hover); color: var(--text-1); }
.mafw-wc-btn:active { background: var(--hover-strong); }
.mafw-wc-close:hover { background: #E81123; color: #fff; }
.mafw-wc-close:active { background: #C50F1F; color: #fff; }

/* frameless 窗口最大化时内容会溢进屏幕外阴影区，补偿内边距 */
.mafw-shell.maximized { padding: 8px; }
```

- [ ] **Step 6: typecheck 验证**

Run: `bun run typecheck`（workdir: `packages/desktop`）
Expected: 通过。

- [ ] **Step 7: Commit（需用户确认）**

```bash
git add packages/desktop/src/renderer/mafw/components/WindowControls.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): 自绘 Win11 Fluent 窗口控制按钮 + 标题栏轻量修饰"
```

---

### Task 4: 构建 + 运行人工验证

**Files:** 无修改，纯验证。

- [ ] **Step 1: 完整构建**

Run: `npx electron-vite build`（workdir: `packages/desktop`）
Expected: main/preload/renderer 三段全部构建成功。

- [ ] **Step 2: 启动 desktop 人工验证**

Run: `bun run dev`（workdir: `packages/desktop`），逐项检查：

1. 右上角出现三个自绘按钮（46×38，贴边）；原生 caption 按钮不再出现
2. 最小化 hover 灰底；最大化 hover 灰底；关闭 hover 红底白图标
3. 点击最小化/最大化/关闭行为正确；close-to-tray 开启时关闭仍进托盘
4. 最大化后按钮图标变为还原（双方框），还原后变回方框；最大化时内容不溢出屏幕边缘（如有明显黑边/遮挡任务栏，调整 `.mafw-shell.maximized` padding 值）
5. 双击标题栏空白区切换最大化；双击按钮不触发
6. 标题栏底部有细分隔线；状态点 hover 显示「Gateway 已连接」等文案
7. 切换 light/dark 主题，按钮观感正常
8. 可用 `mafw_desktop_screenshot` 截图核对各状态

- [ ] **Step 3: 如有视觉问题，微调 CSS 后回到 Step 1**

- [ ] **Step 4: 最终 Commit（需用户确认）——仅当验证中产生额外修改**

---

## Self-Review 记录

- **Spec 覆盖**：移除 overlay（T1）、IPC（T1）、preload（T2）、WindowControls 组件/样式/双击/tooltip/分隔线/最大化补偿（T3）、构建+人工验证（T4）。✅
- **占位符**：无 TBD/TODO；所有代码完整。✅
- **类型一致性**：`windowControls` 方法名在 T1（IPC channel）/T2（preload）/T3（组件调用）三处一致；事件名 `window-maximized-changed` 一致。✅
- **已知取舍**：Win11 snap layout 悬停浮出丢失（spec 已声明接受）；`.mafw-shell.maximized` padding 值以 T4 实测为准。✅
