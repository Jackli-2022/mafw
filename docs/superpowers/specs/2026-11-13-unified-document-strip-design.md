# Unified Document Strip（Phase 1）设计（2026-11-13）

> 目标：把右 dock 的文件 tab 与浏览器 tab 收敛成**同一条文档 tab 条**。
> 这是统一 document model 的第一刀：先统一「打开文档的顺序 / 激活 / 关闭 / 右键菜单」，
> 不迁移编辑器和浏览器内部的详细状态。

## 1. 意图

`DocumentFrame` 已经统一了 tab 与 toolbar 的视觉，但编辑器与浏览器仍是两个独立 stage：

- 文件 tab 由 `EditorModel.files` 驱动；
- 浏览器 tab 由 `browser-tabs` 的 `BrowserTab[]` 驱动；
- `FocusStage` 分成 `editor` / `browser` 两个分支；
- 用户不能在同一条 tab 条里同时看到 `gateway.md` 和 `example.com`。

Phase 1 解决用户最直接的缺口：**一个右 dock，一条 tab 条，文件与网页混排**。
编辑器的 draft/dirty/冲突、浏览器的 webview 生命周期仍由各自模块持有，避免一次性重写高风险状态机。

## 2. 目标

- 文件与浏览器 tab 出现在同一条 `DocumentTabs`，保持稳定的打开顺序。
- 点击任一 tab 切换 active document，并让焦点栈指向对应的 file / web subject。
- 关闭 active tab 后聚焦相邻 tab；关闭最后一个 tab 回到取景器 / 空态。
- 支持关闭其他 / 关闭右侧（跨类型）。
- 右键菜单按被点击 tab 的 kind 提供关闭、复制路径/链接、系统打开等动作。
- 编辑器与浏览器 body 都保持常挂载：切换 tab 不丢编辑器状态，也不重载 webview。
- 现有 `DocumentTabs` 的滚轮横滚、中键关闭、键盘操作继续可用。

## 3. 非目标

- 不把 `EditorModel` / `BrowserTab` 的详细字段迁移进 DocumentStore。
- 不做跨类型拖拽排序（tab 顺序 = 打开顺序，关闭其他/右侧仍可改变集合）。
- 不做跨重启的「打开文档列表」持久化；继续沿用现有焦点恢复与编辑器草稿恢复。
- 不合并 editor toolbar 与 browser toolbar；active body 的 toolbar 仍由各自组件渲染。
- 不重新引入 split view，不改 webview sandbox / preload 边界。

## 4. 现状

```text
FocusStage
├─ kind === "editor"  → EditorDock  → DocumentFrame(tabs + toolbar + editor body)
└─ kind === "browser" → BrowserDock → DocumentFrame(tabs + toolbar + webview body)
```

- `editorDocumentTabs(model)` → `DocumentTabView[]`，id = `rel`。
- `browserDocumentTabs(tabs, activeId)` → `DocumentTabView[]`，id = browser tab id。
- `EditorModel` 按 content root 存在 `editor-model-store`；`BrowserTab` 是模块级单例。
- `SubjectRef` 有独立的 `file` / `web` kind；焦点栈一次只显示一个 subject。

## 5. 设计

### 5.1 文档 tab 条目

```ts
type DocumentTabKind = "file" | "web"

type DocumentTabEntry = {
  id: string                 // file:<root>\0<rel> | web:<tabId>
  kind: DocumentTabKind
  view: DocumentTabView      // 复用 DocumentTabs 的视图形状
}
```

- 文件 id 必须带 root，避免项目 / Goal worktree 同名文件串台。
- 浏览器 id 用现有 `BrowserTab.id`，保留同 URL 多 tab 的能力。
- `view.active` 由 store 统一设置，不让两个 body 各自决定。

### 5.2 稳定顺序与合并

```ts
mergeDocumentTabs(previous: DocumentTabEntry[], incoming: DocumentTabEntry[]): DocumentTabEntry[]
```

规则：

1. `previous` 中仍存在的 id 保持原顺序；
2. `incoming` 中新增的 id 按 incoming 顺序追加到尾部；
3. 不在 incoming 中的 id 删除；
4. 相同 id 的 `view` 用 incoming 更新（标题 / dirty / loading / icon）。

这样 EditorDock 和 BrowserDock 可以各自同步自己的 tab 列表，而不会互相打乱顺序。

### 5.3 Store

`document-tabs-store.ts` 是模块级单例，持有：

```ts
type DocumentTabsState = {
  entries: DocumentTabEntry[]
  activeId: string | null
}
```

API：

- `documentTabs()` / `activeDocumentTabId()`
- `syncFileTabs(root, views)` / `syncWebTabs(views)`：合并对应 kind 的条目；
- `activateDocumentTab(id)`：设置 activeId；
- `requestCloseDocumentTab(id)` / `takeCloseRequests()`：关闭请求总线；
- `closeOtherDocumentTabs(id)` / `closeDocumentTabsToRight(id)`：计算目标 id 并发出关闭请求；
- `resetDocumentTabsForTests()`。

关闭请求用一次性队列而不是直接删条目：EditorDock / BrowserDock 仍拥有详细状态，必须由它们执行真正的
`closeFile` / `closeBrowserTab`；它们完成后同步列表，store 自然移除条目。

### 5.4 UI 组合

```text
DocumentStage
├─ DocumentTabs（统一 entries / active）
└─ body
   ├─ EditorDock  embedded showTabs={false}   // display: contents when active kind=file
   └─ BrowserDock embedded showTabs={false}   // display: contents when active kind=web
```

- `DocumentStage` 自己渲染 `DocumentTabs`，不经过 `DocumentFrame` 的 tabs 槽，避免两层 tab。
- `EditorDock` / `BrowserDock` 增加 `embedded?: boolean`：
  - `embedded` 时不再渲染 `DocumentFrame` 外壳，只渲染 toolbar + body；
  - `showTabs` 由 embedded 语义取代（embedded 一定没有自己的 tab 条）。
- 两个 body 都常挂载；非 active 的 wrapper 用 `display: none`。active wrapper 用 `display: contents`。
- active kind 由 `activeId` 的 `kind` 决定；没有 active 时显示空态。

### 5.5 焦点与激活

焦点仍是导航真相源，tab 条是文档集合的视图：

- `focus` 是 `file` / `web` 时，`MafwShell` 把 `activeId` 同步为对应文档 id。
- 点击统一 tab：
  - file → `MafwShell` 把焦点设为该 file subject，并调用 `activateDocumentTab(id)`；
  - web → 把焦点设为该 web subject，并调用 `activateDocumentTab(id)`；不重新发导航请求，避免刷新页面。
- `EditorDock` 接收 `activeDocumentId` / `activeRel`，在变化时调用内部 `activateRel`；
  `BrowserDock` 接收 `activeTabId`，在变化时调用 `setActiveBrowserTab`。
- 关闭 active tab：store 先算 `nextDocumentTabId(entries, closingId, activeId)`，shell 聚焦 next；
  没有 next 时调用 `showWorkbenchLanding()`。
- `FocusStage` 对 `editor` / `browser` 两个 kind 都渲染同一个 `DocumentStage`，通过新增的
  `renderDocument` prop 注入；`WorkbenchShell` 只透传。

### 5.6 右键菜单

新增 `buildDocumentTabMenu`（纯函数）：

- 关闭 / 关闭其他 / 关闭右侧；
- file：复制路径；
- web：复制链接 / 系统浏览器打开。

菜单动作通过 `DocumentStage` 的 `onClose` / `onCloseMany` 回调回到 shell；shell 发关闭请求并处理 next active。

## 6. 边界与失败模式

- **两个 body 的 active 不同步**：以 store 的 `activeId` 为准；EditorDock/BrowserDock 的 active 只作为
  内部状态，收到 `activeDocumentId` 后单向同步。
- **关闭请求丢失**：两个 body 在 `DocumentStage` 中始终挂载，close request 队列在 effect 中消费；
  同一请求只消费一次。
- **root 切换**：`syncFileTabs` 只替换当前 root 的文件条目；其他 root 的 file 条目不进入同一条 strip
  （当前 content scope 只显示一个 root）。切换 root 时旧 root 的 tab 不应残留。
- **同名文件不同 root**：id 带 root，绝不复用。
- **重复 URL**：web id 用 tab id，允许同 URL 多 tab；焦点按 active tab 映射。
- **旧 focus 持久化**：仍只恢复一个 file/web subject；统一 tab 列表不做跨重启持久化。
- **关闭最后一个 tab**：回到 `showWorkbenchLanding()`，不显示空白 DocumentStage。

## 7. 测试

- 纯模型：merge 顺序 / 更新 view / 删除 / next active / close others / close right / menu items。
- store：file/web sync、root 隔离、close request 队列、activate。
- wiring：EditorDock/BrowserDock sync + active 同步；DocumentStage 同时挂载两个 body；
  FocusStage/WorkbenchShell 的 `renderDocument`；MafwShell 的 select/close 路由。
- 回归：desktop 全量、tsgo、electron-vite build。
- 实机：左 dock 打开文件 → 文件 tab；地址栏打开网页 → 网页 tab 与文件 tab 同条；
  切换/关闭/右键菜单；webview 不重载；无 error overlay。

## 8. Phase 2（不在本计划）

- 把 `EditorModel` / `BrowserTab` 的详细状态迁入 DocumentStore。
- 跨类型拖拽排序、跨重启文档列表持久化、统一 toolbar 动作注册。
- 大文档 / 大变更集虚拟化。
