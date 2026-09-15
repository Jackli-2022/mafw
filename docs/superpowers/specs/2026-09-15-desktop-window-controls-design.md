# Desktop Windows 标题栏自绘窗口控制按钮 — 设计

日期：2026-09-15
范围：packages/desktop（main / preload / renderer）

## 背景与目标

Windows 上 desktop 窗口使用 `frame: false` + `titleBarStyle: "hidden"` + `titleBarOverlay`，
右上角最小化/最大化/关闭按钮由 Electron 原生绘制，只能改颜色/符号色/高度，无法美化。
目标：完全自绘 Win11 Fluent 风格窗口控制按钮，并对标题栏本体做轻量修饰。

## 方案

### Main 进程（`src/main/windows.ts` + `src/main/ipc.ts`）

- win32 移除 `titleBarOverlay`（保留 `frame: false` + `titleBarStyle: "hidden"`）；
  `overlay()` 函数与 win32 侧 `updateTitlebar()` 调用清理（HTML 按钮随 zoom 自然缩放，
  不再需要 overlay 高度随 zoom 缩放）。
- macOS 完全不动：`trafficLightPosition` 与 darwin 的 `nativeTheme` 逻辑保留。
- 新增 IPC handler（注册在 `src/main/ipc.ts`，经 `BrowserWindow.fromWebContents(event.sender)` 定位窗口）：
  - `window-minimize` → `win.minimize()`
  - `window-toggle-maximize` → `isMaximized() ? unmaximize() : maximize()`
  - `window-close` → `win.close()`（自动复用现有 close-to-tray 判断，无需改动）
  - `window-is-maximized` → boolean（初始状态查询）
  - `registerWindow` 中监听 `maximize`/`unmaximize`/`restore` →
    `webContents.send("window-maximized-changed", win.isMaximized())`

### Preload（`src/preload/index.ts` + `src/preload/types.ts`）

- 暴露 `platform: string`（`process.platform`）
- 暴露 `windowControls`：
  ```ts
  windowControls: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizedChange(cb: (maximized: boolean) => void): () => void
  }
  ```

### Renderer（`src/renderer/mafw/MafwShell.tsx` + `mafw.css`，新组件 `components/WindowControls.tsx`）

- `WindowControls` 仅 `platform === "win32"` 时渲染（linux 无 frame:false、mac 有红绿灯，均不渲染）。
- Win11 Fluent 样式：
  - 三个 46×38px 扁平按钮贴齐右上角，与标题栏等高（38px），按钮 `no-drag`
  - SVG 图标：minimize（横线）/ maximize（单线方框）/ restore（双方框）/ close（✕）
  - 默认透明背景，图标色 `var(--text-3)`，hover 背景 `var(--hover)`、图标 `var(--text-1)`
  - 关闭按钮 hover 背景 `#E81123`、图标白色；active 态背景稍深
  - 最大化时 maximize↔restore 图标自动切换（初始 `isMaximized()` 查询 + `onMaximizedChange` 订阅）
- `MafwShell` 标题栏右侧 spacer `<div style={{flex:1}} />` 之后挂 `<WindowControls />`；
  标题栏 `padding-right` 归 0 使按钮贴边；双击 `.mafw-titlebar` 拖拽区 → `toggleMaximize()`
  （frameless 丢失原生双击最大化行为，需补回）。
- 轻量修饰：
  - 状态点加 TooltipV2 文案（「Gateway 已连接/启动中/失败/已停止」）
  - 标题栏底部加 `border-bottom: 1px solid var(--border-subtle)`
- 最大化溢出修正：frameless 窗口最大化时内容会溢进屏幕外阴影区——
  renderer 根 `.mafw-shell` 在 maximized 态（监听同一事件）加补偿 padding（约 8px），还原时归 0。

### 主题联动

按钮颜色全部走 CSS 变量（`--text-*`、`--hover`），随 app 主题（light/dark/oc-2）自动切换；
关闭按钮红色 `#E81123` 固定（Win11 语义色）。

## 取舍

- 自绘按钮失去 Win11 snap layout 悬停浮出（所有自绘方案固有限制，接受）。
- zoom 下按钮随 HTML 自然缩放，main 侧 zoom→overlay 联动代码删除。

## 验证

- desktop 无测试基建（不在 CI）：`npx electron-vite build` 编译通过
- 运行 desktop 检查：普通态三按钮渲染、hover（含关闭红色）、最大化/还原图标切换、
  双击标题栏最大化、close-to-tray 仍生效、light/dark 主题下观感
