# 插件 Web 页面与工作台宿主（Plugin Web Surfaces）

> 状态：设计草案（待批准）
> 日期：2026-11-09
> 关联：`docs/superpowers/specs/2026-11-03-unified-declarative-plugin-packages-design.md`（统一插件包与声明式 UI）
> 参考：dsh `dsh-better-sidebar`（插件自带的侧边栏工作台 + `ctx.betterSidebar.registerTab`）

## 1. 为什么

当前的插件 UI 只有四个声明式 slot：`panels`（右工作台二级 tab）、`configPages`、`toolCards`、`messageWindows`；widget 只有 12 种纯数据组件。后果：

- 插件做不了真正的工具页面（文件树、编辑器、终端、Git、浏览器、分栏）；
- 左栏没有插件入口，右 dock 只能把插件当「工作台里的一个声明式 tab」；
- 复杂交互只能退回宿主 action/event + 轮询，能力上限与 dsh 的 better-sidebar 差一个量级。

dsh 的做法证明了另一条路线：**插件 UI 是插件自己写的页面，插件同时自带 host 半（自己的 HTTP/WS 路由）**；宿主只提供上下文、基础服务（终端/文件）和安装/生命周期。better-sidebar 本身就是个插件，它把侧边栏开放成 `ctx.betterSidebar.registerTab` 给 30+ 生态插件注册页面。

本设计把这条路线收进 MAFW：新增**沙箱 Web 页面**作为插件 UI 的第二形态，落在右工作台二级 tab；左栏只做入口。

## 2. 已确认的决定

| # | 决定 | 理由 |
|---|---|---|
| D1 | 插件页面是**真 Web 页面**，在沙箱 webview/iframe 里跑；不把 React/Solid 组件注入宿主 DOM | 能力完整，且不污染宿主 DOM/CSS |
| D2 | 左栏只做**入口**；页面在「工作台」二级 tab 打开；一级仍是 工作/工作台/执行/审阅 | 复用现有 L2 tab 条、容量/溢出、键盘、持久化 |
| D3 | 插件**自带 host 半**：`ctx.http` 注册 scoped HTTP/WS 路由；页面调自己的路由 | better-sidebar 同款；流式/上传/大文件/长连接都能做 |
| D4 | 宿主额外提供**基础服务**：`ctx.files`（项目内文件）+ `ctx.terminal`（现有终端服务） | 让「文件树 + 终端」不用每个插件重造 |
| D5 | 声明式 `panels` / `configPages` / `toolCards` / `messageWindows` **保留**；`webSurfaces` 是新增形态 | 现有包与 Creator 不破坏 |
| D6 | 安装的插件仍按「可信本地代码」对待（host 半在 gateway 进程里）；页面沙箱防的是宿主 UI 被污染 | 与当前安全模型一致，不制造假隔离 |
| D7 | 插件页面只能访问自己的命名空间（`/api/plugins/<pkg>/…`） | 页面被攻破也拿不到别的插件/全局 API |

## 3. 目标 / 非目标 / 反目标

### 3.1 目标

- 插件可以声明 `ui.webSurfaces[]`，由 Desktop 在右工作台打开一个沙箱页面。
- 插件可以在 `activate(ctx)` 里注册自己的 HTTP/WS 路由（`ctx.http`），随包 revision 一起提交/退役。
- 插件页面通过 bridge 拿到当前项目/会话/主题，调用本包 action、订阅本包事件、设置角标。
- 左栏出现插件入口（图标/标题/角标），点击切到「工作台」并激活对应 tab。
- 页面对包 revision 敏感：包更新 → 页面重载；包移除/禁用 → tab 与 rail 项立即消失。
- 一个 `web-surface-demo` 包能端到端演示：文件树 + 终端 + 一个 action + 事件刷新。

### 3.2 非目标（本批不做）

- 插件定义**新的扩展点**给别的插件注册（better-sidebar 的 `registerTab` 模式）。
- npm/GitHub 安装、版本兼容矩阵、插件市场。
- host 模块级 HMR（只做包 reload；页面重载不等于 host 热替换）。
- 把插件组件注入宿主 DOM、共享宿主 CSS 变量（页面自己负责主题跟随）。
- 页面跨出自己 origin 的任意导航（外链走系统浏览器）。
- 移动端/TUI 的插件页面（先 Desktop）。

### 3.3 反目标（做了就算失败）

- 插件页面能直接 `require`/`ipcRenderer`/读任意文件或别的包的路由。
- 页面加载失败时留一块白屏，没有错误面/重试。
- 新增的 slot 与 `panels` 语义混淆，导致安装预览/文档说不清「装完会出现在哪」。

## 4. dsh 参考与映射

| dsh / better-sidebar | 本设计 | 差异 |
|---|---|---|
| `ctx.betterSidebar.registerTab({id,title,component})` | `ui.webSurfaces[]`（声明式）+ 右工作台 L2 | 我们是数据描述符，组件在沙箱页面里 |
| 插件自带 `/sidebar/api/*` + WS | `ctx.http.route/ws` → `/api/plugins/<pkg>/*` | 命名空间由宿主强制 |
| Cordis `inject` + service | bridge（上下文/action/event）+ `ctx.files`/`ctx.terminal` | v1 没有通用 DI |
| `dsh plugin --profile add` | 现有 PackageManager（本地目录安装） | 暂无市场/git/版本矩阵 |
| HMR 模块热替换 | 包 revision → 页面 reload | 粒度更粗，但足够 UI |
| create mode 生成插件并验证 | Creator 生成声明式包；Web 页面生成放 P2 | v1 先手动/Agent 辅助写包 |

不照搬的点：插件组件注入宿主 DOM（安全与样式耦合）、profile 配置层 Patch（我们用 package.json + 目录）、进程级插件树（我们是单进程包注册表）。

## 5. 契约

### 5.1 `ui.webSurfaces[]`

```ts
interface PluginWebSurfaceDescriptor {
  id: string                 // ^[A-Za-z0-9][A-Za-z0-9._-]*$
  title: string
  /** 白名单字形；缺省用通用方块。 */
  icon?: string
  /** 相对 web/ 的入口，缺省 index.html；禁止 ..、绝对路径、scheme。 */
  entry?: string
  /** 页面作用域：session（默认）| project | global。 */
  scope?: "session" | "project" | "global"
  /** 左栏入口；缺省不在左栏出现，只能从工作台 tab 打开。 */
  rail?: {
    icon: string
    order?: number
    /** 是否显示角标；计数由 bridge setBadge 提供，缺省不显示。 */
    badge?: boolean
  }
}
```

校验（`package-validator` + `plugin-contract`）：

- `id` 唯一（同包内），符合 NAME 语法；`title` 非空（≤80）；
- `entry` 归一化后必须落在 `web/` 内；拒绝 `..`、绝对路径、`\0`、`#`/`?`；
- `rail.icon` 必须命中 `@mafw/plugin-contract` 的 `PLUGIN_ICON_NAMES`（与 `@mafw/ui` 注册表由 desktop 侧 freshness 测试钉住）；未知图标是 validation error，不是静默画 plus；
- `webSurfaces` 非空时，包目录必须存在 `web/` 与 entry 文件（fs 检查在 Host/Manager 层，契约校验保持 fs-free）；
- 与 `panels` 共用同一 surface 命名空间：同包内 `panels` 与 `webSurfaces` 的 id 冲突 → validation error（`plugin:<pkg>:<id>` 只有一个渲染器）；
- 声明了 `webSurfaces` 但 entry 缺失/不可读 → **整包激活失败**（fail-closed；结构化 error 指出 surface id 与路径），不做静默降级；单文件包（`~/.mafw/plugins/x.js`）不能声明 `webSurfaces`（没有 `web/` 目录）。

### 5.2 包布局

```text
~/.mafw/plugins/my-panel/
  plugin.json
  index.js          # host 半：activate(ctx) + ctx.http
  web/
    index.html
    app.js
    style.css
```

### 5.3 `ctx.http`（gateway）

```ts
interface PluginHttpApi {
  route(method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE",
        path: string,                     // 相对，'' 或 '/files'
        handler: PluginHttpHandler,
        opts?: { maxBodyBytes?: number }): void
  ws(path: string, handler: PluginWsHandler): void
}
```

- 实际 URL：`/api/plugins/<pkg>/<path>`；`path` 不允许 `..`、不允许重复注册；
- handler 收到 `{ method, url, query, params, headers, sessionID?, projectDir, body: AsyncIterable<Buffer> }`；
- 返回 `{ status?, headers?, body?: string | Buffer | Readable | AsyncIterable<Uint8Array> }`；
- 默认请求体上限 32 MiB；响应流不设硬上限但记录字节数；
- 路由只在包 commit 后生效；reload/disable/remove 时全部退役（走 `ctx.effect` 同一 bag）；
- `check`（离线 activate）时 `ctx.http` 是**记录器**：只校验路径/重复/方法，不监听端口。
- WS：`/api/plugins/<pkg>/ws/<path>`；handler 收到 `ws` + 同样的 context；包退役时 `close(1001)`。

### 5.4 静态资源

- `GET /api/plugins/<pkg>/ui/<entry…>`：只服务 active 包的 `web/`；`realpath` 包含校验；拒绝 dotfile；流式返回；`Content-Type` 按扩展名；`Cache-Control: no-store`（revision 由 query 承载）。
- 响应头：`Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'`。
- 404/包未激活/路径逃逸 → 404，不泄露目录。

### 5.5 票据与命名空间

- `POST /api/plugins/<pkg>/web-ticket`（loopback；body `{ projectDir, sessionID? }`）返回 `{ ticket, expiresAt }`；
- gateway 设置 **path-scoped cookie**：`mafw_plugin_ticket=<ticket>; Path=/api/plugins/<pkg>/; HttpOnly; SameSite=Strict`；
- **执行面必须带票**（2026-11-09 rev2）：`api/*` / `events` / `ws/*` 校验票据（cookie 或 `x-mafw-plugin-ticket`）——**即使来自 loopback 也不例外**；只有 `ui/*` 资产允许无票据 loopback 打开（bootstrap）。票据绑定包名，跨包请求 403；
- `web-ticket` 只接受 gateway 自己的 `Origin`（无 `Origin` 的非浏览器客户端允许），响应不发 `Access-Control-Allow-Origin`；WS upgrade 校验 `Origin`/`Sec-Fetch-Site`；
- Desktop 只在对应分区里加载该 URL；主进程 `webRequest` 只允许该分区访问 `/api/plugins/<pkg>/`（外加 `/api/plugins/<pkg>/ui/`、`/events`、`/ws/*`），并覆盖 **`ws://` / `wss://`**（`*://*/*` 在 Electron 42 不拦截 WebSocket）。

### 5.6 事件

- `GET /api/plugins/<pkg>/events`（SSE，票据同源）只转发本包注册的 `plugin:<pkg>:*` 事件；带 `sessionID` 时只转发该会话（缺省全局）。
- 页面也可以订阅 bridge 的 `onEvent`；Desktop 已订阅全局 SSE，按包过滤后 `webview.send` 给页面。

### 5.7 票据绑定、TTL 与续期

- 票据载荷绑定 `(pkg, projectDir, sessionID?)`；`POST /api/plugins/<pkg>/web-ticket` 的 body 必须显式带 `projectDir`（canonical 化后必须是已注册项目、其子目录、或已知 `session-worktree` 目录；gateway 校验，不读全局 currentProject，避免多窗口串项目），`sessionID` 可选；
- handler 的 `ctx.projectDir`/`sessionID` 只来自票据载荷（**没有** ambient project 回退），**不是** gateway 启动目录或全局当前项目；
- TTL 8 小时；主进程在过期前 30 分钟或首次 403 时调 `plugins.refreshWebTicket(pkg)` 续期（页面不接触 cookie）；
- 页面 403 恢复：主进程续票后通过 `<webview>.reload()` 重载；连续失败进入错误面；
- 同一包同一项目同一会话同一时间只有一个有效票据；切换会话/项目时重新取票（旧票自然过期）。

### 5.8 `scope` 语义

| scope | 绑定的上下文 | 页面收到 | 会话切换时 |
|---|---|---|---|
| `session`（默认） | `projectDir` + 打开时的 `sessionID` | `{projectDir, sessionID}` | 重新绑定**当前活动会话**，下发 `contextChange`；页面若声明 `reloadOnSessionChange !== false` 则整页重载 |
| `project` | 仅 `projectDir` | `{projectDir}` | 只下发 `projectDir`（切项目才重载） |
| `global` | 无 | `{}` | 不重载 |

Tab 身份仍是项目级 `plugin:<pkg>:<surface>`（复用 `mafw-workbench-*` 持久化）；`scope` 只决定上下文与重载策略，不改变 tab 数量。

### 5.9 基础服务 `ctx.files` / `ctx.terminal`

为了让「文件树 + 终端」不必每个插件重造，v1 提供最小基础服务（都按票据绑定的 `projectDir` 作用域）：

```ts
interface PluginFilesApi {
  list(rel: string): Promise<Array<{ name: string; kind: "file"|"dir"; size?: number; mtime?: number }>>
  stat(rel: string): Promise<{ kind: "file"|"dir"; size: number; mtime: number }>
  read(rel: string, opts?: { maxBytes?: number }): Promise<Buffer>   // 默认 8 MiB 上限
}

interface PluginTerminalApi {
  /** 在 projectDir 下创建 PTY，返回 id；页面经插件自己的 WS 路由桥接。 */
  create(opts?: { cols?: number; rows?: number }): Promise<{ id: string }>
  /** 把已建立的 WS 接到 PTY（插件 host 半调用；生命周期随 WS/包 revision）。 */
  bridge(id: string, ws: import("ws").WebSocket): Promise<void>
  resize(id: string, cols: number, rows: number): void
  kill(id: string): void
}
```

- `ctx.files` 只读、限项目根内（realpath 包含；拒绝 `..`/绝对路径/符号链接逃逸）；写操作放 P2；
- `ctx.terminal` 复用现有 `TerminalService`（desktop 终端同款 PTY）；包退役时关闭该包创建的 PTY；
- 两个服务都只给 host 半（页面经插件自己的路由/WS 间接使用），不直接暴露给页面。

## 6. Desktop

### 6.1 Surface 身份

沿用 `plugin:<pkg>:<surface>`（`workbench-views.ts` 已有解析/持久化）。描述符决定渲染器：`panels` → `PluginSurfaceHost`（声明式）；`webSurfaces` → `PluginWebSurfaceHost`。

### 6.2 `PluginWebSurfaceHost`

- 用 `document.createElement("webview")`（与 `BrowserDock` 同模式），`partition="persist:mafw-plugin-<pkg>"`；
- `src = <gatewayUrl>/api/plugins/<pkg>/ui/<entry>?revision=<rev>`；加载前先取票据（主进程 IPC `plugins.webTicket(pkg, sessionID)`，设置 cookie）；
- `webpreferences`: `contextIsolation=yes`, `sandbox=yes`, `nodeIntegration=no`, `webSecurity=yes`；
- `will-attach-webview`：只允许 gateway origin + 该包路径；`setPermissionRequestHandler` 全拒；`setWindowOpenHandler` 拒绝（外链走 bridge）；禁止 `file:`/`javascript:`/`data:` 导航；
- 失败/404/CSP → `DockBanner` 错误面 + 重试按钮；不白屏；
- tab 切换保留实例（与浏览器 tab 一致），包移除/禁用或 revision 变化时重载/卸载。

### 6.3 Bridge

宿主 preload（桌面静态文件，可信）通过 `contextBridge` 暴露 `window.mafwPlugin`：

```ts
interface MafwPluginBridge {
  version: 1
  context(): Promise<{ projectDir, sessionID?, surface: string, theme: "light"|"dark" }>
  invoke(action: string, input?: unknown): Promise<unknown>
  onEvent(type: string, cb: (payload: unknown) => void): () => void
  setBadge(count: number): void
  setTitle(title: string): void
  openExternal(url: string): void
  onThemeChange(cb: (theme: "light"|"dark") => void): () => void
  /** scope=session/project：活动会话或项目变化时推送；页面自行决定是否重载。 */
  onContextChange(cb: (ctx: { projectDir: string; sessionID?: string }) => void): () => void
}
```

- 实现：preload 用 `ipcRenderer.sendToHost("mafw-plugin-bridge", msg)`；宿主 renderer 监听 `ipc-message`（`e.channel === "mafw-plugin-bridge"`），按 surface 路由；
- `invoke` 只允许本包 action（宿主用 `plugins.invoke(pkg, action, …)`）；
- `onEvent` 由宿主订阅 SSE 后过滤 `plugin:<pkg>:*` 再下发；页面不得自行跨包订阅；
- 角标写回 `pluginSurfaceBadges` store，rail 与 tab 共用。

### 6.4 左栏

- `MafwShell` 从 `pluginClientSnapshot.webSurfaces[].rail` 派生 rail items（排序：`order` 升序，稳定序）；
- `IconRail` 增加 `pluginItems` prop；点击 → `openWorkbench("workbench", pluginSurfaceId(pkg, surface))`；
- 激活态 = 当前 L1=workbench 且 surface 匹配；badge 来自 `pluginSurfaceBadges`；
- 图标白名单与 `@mafw/ui` 注册表同源；未知图标在 descriptor 校验阶段就报错（避免「全是加号」重现）。

### 6.5 生命周期

- revision 变化：surface 仍存在 → 重新取票据 + 重载 `src`；不存在 → 关闭 tab、移除 rail 项；
- 包禁用/删除：立即卸载页面、清 cookie/分区？v1 保留分区缓存（可清理）；
- 工作台 L1 切走：页面保持挂载（与浏览器 tab 一致），不后台轮询；
- 窄屏 overlay / dock 收起：随工作台 existing 规则。

## 7. Gateway 资源与路由接线

- 新 `gateway/src/plugins/plugin-http.ts`：per-package router 注册表 + dispatch + 退役；
- `routes/plugin-web.ts`：static、ticket、events（SSE）；
- upgrade 分流：`/api/plugins/<pkg>/ws/*` → package WS（票据校验后 `handleUpgrade`）；
- `PluginHost`：`activate` 时注入 `ctx.http`（记录 → commit 后生效）；`RegistrationBag` 退役路由/WS；
- 客户端描述符：`buildClientDescriptor` 增加 `webSurfaces`（只含数据，不含 handler）；`client-descriptor` 冻结；
- `PLUGIN_PUBLIC_CONTRACT.slots` 增 `webSurfaces`，Creator `mafw_plugin_inspect({query:"slots"})` 自动看到。

## 8. 安全

| 面 | 措施 |
|---|---|
| 宿主代码 | 与今天一致：本地可信代码，进程内全权限（文档明示） |
| 页面 → gateway | 独立 partition + 票据 cookie（包绑定）+ 主进程请求过滤（只允许本包命名空间） |
| 页面 → 宿主 UI | 沙箱 webview、无 node、contextIsolation、CSP、禁导航/弹窗/下载/权限 |
| 页面 → 别的插件 | 票据绑定包名；路由/事件/WS 全部按 `pkg` 命名空间隔离 |
| 静态资源 | realpath 包含、dotfile 拒绝、MIME 白名单、无目录列表 |
| 失败面 | 错误 banner + 重试；不白屏 |

明确不做：把页面当不可信沙箱去防「插件作者」——安装插件本来就等于信任它的 host 代码。

## 9. Creator 与文档

- `plugin-authoring.md` 增「Web 页面」章节：目录、`ctx.http`、bridge、票据、CSP、示例；
- `mafw_plugin_inspect`：`slots` 返回 `webSurfaces`；新增 `webSurface` 字段说明；
- Creator 指南：v1 允许 Agent 手写 `web/`（inspect 提供字段），P2 再加专用 scaffold/验证；
- 安装预览（`plugin-packages-model`）增加「Web 页面 N」badge 与「左栏入口」标记；
- 文档明确：`panels` = 声明式数据；`webSurfaces` = 沙箱页面；两者可以并存。

## 10. 兼容与迁移

- `webSurfaces` 是新增字段；旧 Desktop 会忽略（descriptor 校验按已知字段投影），旧 gateway 不会返回；
- 旧 gateway 会**拒绝**声明 `webSurfaces` 的包（descriptor 校验是封闭的）；这是有意的 fail-closed：发布说明标注最低 gateway 版本，仓库外安装需要同步升级；
- 现有 `panels` 包不受影响；`service-monitor` 示例保留；
- `uiTools` 仍为 dead contribution（本批不处理）；
- `pluginCreatorApi` 只门控 **Creator 工具与 `mafw_plugin_inspect` 的 `webSurfaces` 提示**；Desktop 的 rail/tab 渲染与 runtime 无关（pi/opencode 下都能打开已安装的 web surface）。

## 11. 测试

- 契约：`webSurfaces` 校验（id/entry 逃逸/rail icon 未知/缺 web 目录/重复 id）；
- gateway：`ctx.http` 注册/退役/重复路径/方法、body 上限、静态资源 200/404/逃逸、CSP、ticket 跨包 403、SSE 过滤、WS 升级；
- desktop：`pluginSurfaceId` 复用、web host src 构造（revision/ticket）、rail item 派生（order/active/badge）、bridge 消息路由、revision 重载/移除关闭、错误面；
- 集成：`web-surface-demo` 包（文件树 + 终端 + action + 事件）安装 → 打开 → 点击 → 刷新 → 热重载；
- Creator：`mafw_plugin_inspect({query:"slots"})` 含 `webSurfaces`；
- 真机：dev app + CDP，验证左栏入口、tab 打开、页面内文件树/终端、包更新重载、移除关闭。

## 12. 分期

| 阶段 | 内容 |
|---|---|
| P1（本设计 v1） | 契约 + 校验、`ctx.http`（HTTP/WS）、静态资源 + 票据 + SSE、`PluginWebSurfaceHost`、左栏入口、bridge v1、revision 重载、`ctx.files`（只读）+ `ctx.terminal`（PTY 桥接）、demo 包（文件树 + 终端）、文档 |
| P2 | `ctx.files` 写操作 / git 面板服务、Creator Web scaffold + 端到端验证、安装预览细化、主题包/图标自定义 |
| P3 | 插件定义扩展点（seam registry，better-sidebar 的 `registerTab` 模式）、市场/Git 安装、HMR |

> P1 的范围已经足够让 better-sidebar 式插件出现（页面 + 自带路由 + 宿主文件/终端服务）。P2 降低作者成本，P3 才是平台化。

## 13. 风险

- **资源泄漏**：每个包一个分区 + 常挂 webview，内存占用高；需要 tab 关闭时销毁、分区清理策略。
- **路由命名空间与既有 API 冲突**：`/api/plugins/*` 已被 package 管理占用；新增 `/api/plugins/<pkg>/ui|ws|events|web-ticket` 需要与现有 `package-manager` 路由共存，route-catalog 要登记。
- **CSP 与 Vite 产物**：开发期页面若是 Vite dev server（HMR）需要放宽 `connect-src`；v1 只支持构建产物，不接 dev server。
- **主题**：页面要跟随宿主亮暗，bridge 提供 theme + change；文档给 CSS 变量映射建议，但不强制。
- **Creator 复杂度**：生成 Web 页面比声明式包大一个量级；P1 只做「能写、能验证、能装」，不做模板市场。

## 14. 开放问题（构建期可自行决定，已给默认）

1. 页面是否允许 `<iframe>` 内嵌第三方站点？默认禁止，外链走系统浏览器。
2. `ctx.http` 是否需要 multipart/上传解析？默认不给，body 是原始 `AsyncIterable<Buffer>`，插件自行解析。
3. 左栏图标是否允许插件提供 SVG/data URL？v1 只允许白名单字形；自定义图标放 P2。
4. 同一包多个 webSurfaces 是否共用 partition？每个包一个 partition（cookie/票据同源）。
5. `ctx.files` 写操作与 git 服务：放 P2（P1 只读文件 + 终端）。
