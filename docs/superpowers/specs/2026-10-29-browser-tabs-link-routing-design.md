# Right Workbench Browser Multi-Tab + Link Routing

日期：2026-10-29
状态：已实现（代码 commits `01ff5e7`..`d7fb41e2`；含终审修复；GUI 冒烟通过；收尾契约见本批文档 commit）
相关：`docs/superpowers/specs/2026-10-27-workbench-file-preview-design.md`（工作台浏览器首版）
`docs/superpowers/specs/2026-10-29-terminal-surface-ssh-design.md`（工作台 surface 导航）

## 1. 意图 / Why

桌面端点击聊天、工具卡、Ask 卡或插件卡里的外链时，现在会由 Electron 默认行为弹出新窗口，或者跳系统浏览器。用户希望**不离开工作台**：

> 「我希望不是弹出一个新窗口，而是直接在右 dock 里面工作台浏览器里面显示。」

右 dock 现有浏览器是**单 webview、单页面**，没有 tab。用户进一步确认：外链默认**新开一个 tab**，不覆盖当前页面。

本设计把右工作台浏览器升级为多 tab，并把所有桌面内可导航外链统一路由到该 surface。

## 2. 目标 / 非目标 / 反目标

### 目标

- G1：聊天 / 工具卡 / Ask 卡 / 插件卡 / Markdown 的外链不再创建 Electron 新窗口。
- G2：外链自动切到「工作台 › 浏览器」并**新开 tab**，当前 tab 保持不变。
- G3：浏览器 surface 支持多 tab：独立 webview / URL / 标题 / 历史 / 加载状态。
- G4：浏览器内普通链接在当前 tab 导航；`target=_blank` / `window.open` 新开 tab。
- G5：关闭 tab 后激活邻居；无 tab 时显示空态，地址栏可直接新建。
- G6：保留显式「在系统浏览器打开」入口；危险协议继续拒绝。
- G7：复用 `@mafw/ui/v2` 的 `TabsV2`（pill 变体）与设计令牌，不新增裸 button / 自定义 tab 结构。

### 非目标

- N1：不恢复上次会话的浏览器 tab（跨 app 重启）。`persist:workbench-browser` 的 cookie/session 仍保留。右 dock 收起再打开时保留**tab 列表**，webview 会重建、页面内状态重置（见 §6.3）。
- N2：不做 tab 拖拽排序、pin、tab group、split view、阅读列表、下载管理器。
- N3：不改变 webview 的权限基线（权限全拒、`nodeIntegration:false`、sandbox、无 preload）。
- N4：不支持需要 `window.opener` / postMessage 回传的 OAuth popup 流程；这类流程走显式系统浏览器。
- N5：不把浏览器 tab 与终端/文件 tab 合并成统一标签条（方案 C 仍后置）。

### 反目标

- 反目标 A：任何 `javascript:` / `file:` / `data:` / `about:` 链接进入 webview 或被 `shell.openExternal` 交给 OS。
- 反目标 B：为了单页链接新开 Electron `BrowserWindow`。
- 反目标 C：切换 tab 时销毁 webview，导致滚动位置 / 表单 / 页面内状态丢失。
- 反目标 D：链接被路由进一个用户当前看不见的工作台（非 chat 视图 / Goal overlay）而没有任何反馈。

### 3.1 Builder decisions（设计作者裁决）

- **右 dock 收起/切换项目**：tab 元数据放在模块级 store，重新打开 dock 时恢复 tab 条与 URL；webview 重建，页面内状态不保证保留。跨 app 重启不恢复 tab。
- **非 chat 视图中的链接**（Goal overlay、Dashboard、Config 等）：工作台浏览器不可见，链接交给系统浏览器，避免静默写入隐藏 dock。chat/workbench 可见时一律进 dock。
- **app-internal `target=_blank`**：主窗口 `will-navigate` 对 same-origin / `oc:` 放行；`setWindowOpenHandler` 对 app-internal 直接 deny（不创建第二个 app 窗口）。已知相对链接插件不做兼容。
- **`data:image/*` 大图**：Python 工具卡、插件 image/link widget 继续用应用内 `ImageLightbox` 查看；不改走 webview、不交给 OS 新窗口。


## 3. 当前状态

- `BrowserDock.tsx` 只有一组 `address/title/loading/view` 状态和一个 `webview`。
- `browser-nav.ts` 只有一个 `{url, at}` 请求信号，供文件预览 HTML 打开浏览器 surface。
- `preload/index.ts` 的 `browser.onOpenUrl` 只接收 `string`；`browser-session.ts` 的 guest `window.open` 发送 `browser-open-url` 字符串。
- 主窗口没有 `setWindowOpenHandler` / `will-navigate` 兜底，所以渲染层 `<a target="_blank">` 走 Electron 默认新窗口。
- `BrowserDock` 自己订阅 `browser-open-url` 并直接 `load(url)`，不会主动切换工作台 surface。

## 4. 触发矩阵

| 来源 | 行为 |
|---|---|
| 聊天 Markdown / 工具卡 / Ask 卡 / 插件卡的 http(s) 外链 | 新 tab + 自动切浏览器 surface |
| 主窗口内 `<a target="_blank">` / `window.open` | 新 tab + 自动切浏览器 surface |
| 主窗口内普通 `<a href>` 站外导航 | 阻止主窗口导航；新 tab + 切 surface |
| 浏览器 guest 内 `target=_blank` / `window.open` | 新 tab |
| 浏览器 guest 内普通链接 | 当前 tab 导航 |
| 浏览器地址栏 Enter | 当前 tab；无 tab 时新建 |
| 文件预览 HTML（`mafw-file://`） | 当前 tab；无 tab 时新建（保持既有行为语义） |
| `data:image/*`（Python / 插件图片） | 应用内 `ImageLightbox`，不进浏览器、不新建窗口 |
| 非 chat 视图（Goal overlay / Dashboard / Config）里的外链 | 系统浏览器（工作台不可见，避免隐藏 dock） |
| `mailto:` / `tel:` | 系统处理，不进 dock |
| `javascript:` / `file:` / `data:` / 未知协议 | 拒绝，不打开任何东西 |

## 5. 交互

### 5.1 Browser surface 结构

从上到下：

1. `TabsV2` pill tab 条：活动 tab、页面标题、关闭按钮、`+` 新建、溢出时横向滚动。
2. 地址栏行：后退 / 前进 / 刷新 / 地址输入 / 在系统浏览器打开 / 点选元素。
3. 错误 banner（仅活动 tab）。
4. webview 内容区：每个 tab 一个 webview，非活动 tab `display:none` 但保持挂载。
5. 无 tab 时：`DockEmpty` + 地址栏可输入。

### 5.2 Tab 行为

- 打开外链默认新 tab；最多 12 个 tab，超出 toast「最多同时打开 12 个浏览器标签」。
- 关闭活动 tab：优先左侧邻居，否则右侧，否则空态。
- 中键点击 tab = 关闭。
- 新 tab 先显示空地址栏，用户输入后创建 webview；外链新 tab 直接加载。
- 切换 tab 只改 `display`，不销毁 webview。
- 地址栏始终显示活动 tab 的 URL（`mafw-file://` 显示解码后的相对路径）。
- 后退/前进/刷新/点选/系统浏览器打开只作用于活动 tab。
- 页面标题为空时显示 host（或「新标签页」）。

### 5.3 链接路由

- 主窗口 `setWindowOpenHandler`：
  - `http(s)` / `mafw-file` → `webContents.send("browser-open-url", { url, newTab: true })`，`deny` 新窗口。
  - `mailto:` / `tel:` → `shell.openExternal`。
  - 其他 → `deny`，不交给 OS。
- 主窗口 `will-navigate`：
  - 同 origin / `oc:` 应用内导航 → 放行。
  - 外部可导航 URL → `preventDefault()`，发送 `{ url, newTab: true }`。
  - `mailto/tel` → 外部；危险协议 → 阻止。
- 浏览器 guest `setWindowOpenHandler`：发送 `{ url, newTab: true }`，`deny`。
- `MafwShell` 收到 `browser-open-url` 后：
  - `requestBrowserNavigate(url, { newTab: true })`
  - `openWorkbenchSurface("browser")`
- `BrowserDock` 不再自己订阅 `browser-open-url`；统一由 shell 路由，避免重复加载。

## 6. 架构

### 6.1 Shared policy

`packages/desktop/src/shared/browser-policy.ts` 新增：

```ts
export type BrowserLinkAction =
  | { action: "allow" }                    // app-internal navigation
  | { action: "dock"; url: string }        // open in workbench browser
  | { action: "external"; url: string }    // mailto/tel
  | { action: "deny" }

export function browserLinkAction(url: string, currentUrl: string): BrowserLinkAction
```

规则：

- `isAppUrl(url, currentUrl)`（same origin 或 `oc:`）→ `allow`（仅 `will-navigate` 使用；`setWindowOpenHandler` 对 `allow` 直接 deny，避免第二个 app 窗口）。
- 其余复用 `windowOpenDecision`：navigate → `dock`，external → `external`，deny → `deny`。

### 6.2 Main

- `windows.ts`：主窗口创建后安装 `setWindowOpenHandler` + `will-navigate`。
- `browser-session.ts`：guest `setWindowOpenHandler` 发送 `{ url, newTab: true }`。
- `browser-open-url` 载荷统一为 `{ url: string; newTab: boolean }`。
- preload `browser.onOpenUrl(cb: (req: BrowserOpenRequest) => void)`；兼容旧字符串载荷（转成 `newTab:true`）。

### 6.3 Renderer

- `browser-nav.ts`：
  ```ts
  type BrowserNavRequest = { url: string; newTab: boolean; at: number }
  requestBrowserNavigate(url, opts?: { newTab?: boolean })
  ```
- `MafwShell.tsx`：单点订阅 `browser.onOpenUrl`，请求导航 + 打开 browser surface；非 chat 视图直接走 `browser.openExternal`。
- `BrowserDock.tsx`：多 tab 容器。
- 新增 `renderer/mafw/browser-tabs.ts` 纯模型 + 模块级 tab store：
  ```ts
  type BrowserTab = {
    id: string
    url: string
    title: string
    loading: boolean
    canBack: boolean
    canForward: boolean
    failed?: string
  }
  createBrowserTab(url, id, title?)
  nextBrowserTabAfterClose(tabs, activeId, closingId)
  browserTabTitle(tab)
  ```
  模块级 store 保留 tab 列表与 activeId，使右 dock 收起后 tab 条仍可恢复；webview 由 BrowserDock 重挂载时按 URL 重建。
- 每个 tab 的 webview 由 `Map<tabId, webview>` 持有；关闭 tab 时移除元素，其他 tab 不动。
- `ImageLightbox`：`renderer/mafw/components/ImageLightbox.tsx` + 模块信号；Python 卡 / 插件 image/link widget 的 `data:image/*` 点击改为打开 lightbox。

### 6.4 UI

- 使用 `TabsV2` `variant="pill"`：
  - `TabsV2.List` + `TabsV2.Trigger` + `TabsV2.CloseButton`。
  - `onMiddleClick` 关闭。
  - 不开 `TabsV2.Content`；webview 内容区由 BrowserDock 自己管理，保证常挂载。
- 地址栏、后退/前进/刷新继续用 `ButtonV2` / `TextInputV2` / `TooltipV2`。
- 新增 CSS：`.mafw-browser-tabbar`、`.mafw-browser-tab-pane`、`.mafw-browser-tabs`，不改 `TabsV2` 公共样式。

## 7. 安全

- 主窗口与 guest 的双层链接策略都走 `browser-policy.ts` 纯函数。
- 非 http(s)/mafw-file 一律拒绝；`mailto/tel` 才允许 `shell.openExternal`。
- webview 继续使用 `persist:workbench-browser` partition；权限全拒、无 preload、无 node。
- 外链 URL 可以出现在地址栏 / localStorage（不存敏感凭据）；浏览器页面自己的 cookie 由 Chromium partition 管理。
- OCR/截图/点选等既有能力继续只作用于活动 webview。

## 8. 测试

- `browser-policy.test.ts`：`browserLinkAction` 的 app/internal/dock/external/deny 矩阵。
- `browser-tabs.test.ts`：创建、关闭邻居、标题 fallback、12 tab 上限、模块级 tab 列表在 BrowserDock 卸载后仍保留。
- `ImageLightbox`：`data:image/*` 打开应用内 lightbox；Esc/遮罩关闭。
- `BrowserDock` wiring：
  - 使用 `TabsV2`（variant pill）。
  - 每个 tab 独立 webview / 非活动 tab 保持挂载。
  - 地址栏、后退/前进/刷新作用于活动 tab。
- `workbench-browser-wiring.test.ts` 更新：
  - `MafwShell` 订阅 `browser.onOpenUrl` 并调用 `requestBrowserNavigate(..., { newTab:true })` + `openWorkbenchSurface("browser")`.
  - `BrowserDock` 不再直接订阅 `browser-open-url`。
  - `windows.ts` 包含 `setWindowOpenHandler` / `will-navigate` / `browser-open-url`。
- 手工 GUI 冒烟：
  1. 聊天点外链 → 新 tab + 浏览器 surface。
  2. 工具卡 / Ask 卡 / 插件卡外链同样。
  3. 浏览器内普通链接当前 tab；`target=_blank` 新 tab。
  4. 关闭活动 tab → 邻居；关闭全部 → 空态；`+` 新建。
  5. 地址栏输入、后退/前进/刷新/系统浏览器打开。
  6. `javascript:`/`file:` 被拒绝；`mailto:` 进系统。

## 9. 验收

1. 点击聊天外链不再产生 Electron 新窗口。
2. 链接出现在右工作台浏览器的新 tab，当前 tab 不被覆盖。
3. 多 tab 切换保留各页滚动/表单状态。
4. 关闭 tab 行为符合邻居规则。
5. 浏览器内普通链接不跳系统浏览器。
6. 危险协议全部拒绝。
7. desktop 全量测试、tsgo、electron-vite build 通过。
