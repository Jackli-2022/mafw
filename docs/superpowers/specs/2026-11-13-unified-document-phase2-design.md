# Unified Document Phase 2 设计（2026-11-13）

> 前置：Phase 1 已交付（`ddceab1d`，一条文件 / 浏览器混合 tab 条）。
> Phase 2 把「统一 tab 条」推进成「统一文档工作区」，但按风险分三段交付，不一次性重写
> 编辑器 / 浏览器状态机。

## 1. 意图

Phase 1 解决了「文件与网页能否同条」。Phase 2 解决「这条文档条是否真正持久、可整理、可扩展」：

- 用户能拖动 tab 重排（跨文件 / 网页）；
- 关闭应用后重新打开，文档列表按原顺序恢复，网页 tab 也回来；
- toolbar 动作由文档层统一编排，而不是每个 body 各自渲染一套；
- 最终 tab 集合与详细状态拥有单一 owner，减少两套 store 的同步缝。

## 2. 阶段拆分

### 2A · 拖拽排序 + 跨重启文档列表（本设计详述）

- tab 条支持 HTML5 拖拽，跨类型重排；顺序立即生效并持久化。
- 统一文档顺序按 **world（项目）** 持久化；文件 tab 的内容仍由 `content-scope-state`
  恢复，本阶段只持久化「顺序 + id 集合 + activeId」。
- 浏览器 tab 的 URL / 标题 / id / active 持久化到全局 key；重启后恢复 tab，webview 重新加载。
- 失效 id（文件已不存在、worktree 已删除）在同步时静默丢弃；损坏存储 fail-open。

非目标：拖拽跨窗口、键盘重排、分屏、拖拽排序的撤销栈。

### 2B · 统一 toolbar 动作注册（后续）

- body 不再各自渲染 `DocumentToolbar`，而是把 leading / center / trailing 动作注册到
  document 层；`DocumentStage` 渲染唯一 toolbar。
- 动作仍由 owning body 提供（保存、预览、后退、刷新…），document 层只负责布局与 active 切换。
- 需要先定型 action descriptor（id / label / icon / disabled / run），再做编辑器与浏览器迁移。

### 2C · 详细状态拥有权迁移（后续，风险最高）

- 把 `EditorModel` 的 tab 集合与 `BrowserTab` 集合提升为 document store 的一等文档记录；
  `EditorDock` / `BrowserDock` 退化为 body 视图。
- 文件内容、dirty / conflict / draft 仍留在 `editor-state` / `editor-drafts`；
  webview 生命周期仍留在 browser view registry。
- 交付顺序（2026-11-13 决策）：
  1. **2C-1（已交付）**：web tab 状态迁入 `documents/browser-documents.ts`；
     `browser-tabs.ts` 退化为兼容 facade；`document-tabs-store` 用模块级 effect 自动同步
     web entries，body 不再手写 `syncWebTabs`。
  2. **2C-2（已交付）**：`EditorModel`（含 root / files / active / dirty / preview /
     readOnly / content 基准）按 root 迁入 `documents/file-documents.ts`；
     `editor-model-store.ts` 退化为兼容 facade；`EditorDock` 只把用户动作交给 reducer，
     文件 entries 由 document store 自动派生。
  3. **2C-3（后续）**：删除 `browser-tabs` / `editor-model-store` 兼容 facade；如需要，
     再把 `savedContent` 从 tab record 拆到独立内容层，统一 file / web document record 类型。
- 2C-3 必须单独立 spec + plan，先做迁移映射与失败回滚设计。

## 3. 2A 设计

### 3.1 顺序权威

- `document-tabs-store` 的 entries 顺序是唯一权威。`syncKindEntries` 已保留 previous 中的
  surviving id 位置，因此 body 重新同步不会把用户拖拽顺序打回去。
- 新增纯函数 `moveDocumentTab(entries, fromId, toId, position: "before" | "after")`；
  拖拽只改 store，不重排 `EditorModel.files` 或 `BrowserTab[]`。
- 新 tab 仍追加到尾部；关闭 / 关闭其他 / 关闭右侧沿用 Phase 1 逻辑。

### 3.2 持久化模型

文档顺序按 world 存：

```ts
type DocumentListSnapshot = {
  version: 1
  order: string[]                 // 统一 document id，按 tab 顺序
  activeId: string | null
}
```

- key：`mafw-document-list:v1:<worldId>`，worldId 与 focus persistence 一致
  （`currentProject() ?? "unscoped"`）。
- 只存 id / 顺序 / active，不存文件内容、dirty、草稿、webview 状态。
- 300ms 去抖，切 world 前 flush；存储失败 fail-open。
- 加载后作为 `savedOrder`：每次 sync 结束后按 savedOrder 稳定排序（保存顺序中不存在的 id
  追加到尾部），再剪掉「上一轮存在、这一轮消失」的 id；未同步到的 id 暂不剪。

浏览器 tab 存全局：

```ts
type BrowserTabSnapshot = {
  version: 1
  activeId: string | null
  tabs: { id: string; url: string; title?: string }[]
}
```

- key：`mafw-browser-tabs:v1`；只恢复 `navigationDecision(url) === "allow"` 的 URL
  （http / https / mafw-file），`javascript:` / `file:` / `data:` 一律丢弃。
- 恢复时保留原 id，并把 `browser-tabs` 的 seq 推到已用 id 之后，避免新 tab 撞 id。
- 重启后 webview 会重新加载页面；这是可接受代价，不持久化页面内滚动 / 表单状态。

### 3.3 恢复时序

```text
MafwShell render
  → configureDocumentListWorld(currentProject)
  → FocusStage / DocumentStage 挂载
      → EditorDock 同步文件 tab（content-scope-state 恢复 openFiles）
      → BrowserDock 先 restoreBrowserTabsOnce()，再同步 web tab / 持久化
  → store 用 savedOrder 排序，focus persistence 恢复 active subject
```

- 文件 tab 的恢复仍由 `content-scope-state` 负责；本阶段不复制文件内容。
- 浏览器 tab 的恢复由 `BrowserDock` 首次挂载触发；工作台未打开时不提前加载网页。
- 若 focus 恢复的是文档 subject，Phase 1 的 active 同步继续生效；activeId 持久化只作为
  没有 focus 时的兜底。

### 3.4 拖拽 UI

`DocumentTabs` 新增可选 `onReorder(fromId, toId, position)`：

- tab 设置 `draggable`，dragstart 写入 id；dragover 按指针在 tab 左右半区决定 before / after；
- drop 调用 `moveDocumentTab`；dragend / dragleave 清理视觉状态；
- 视觉：拖动中降透明度，目标 tab 左侧 / 右侧 2px accent 线；
- 只有传入 `onReorder` 的 strip 可拖（`DocumentStage` 传入；非 embedded 的旧调用不启用）。

## 4. 失败模式

- **world 切换**：切 world 前 flush 旧 world；新 world 的 savedOrder 只影响当前 entries，
  旧 world 的 key 保留。
- **文件已不存在**：EditorDock 不会同步该 entry，store 在下一轮剪掉；不会出现幽灵 tab。
- **浏览器 URL 失效 / 协议非法**：解析时丢弃；恢复失败不影响其他 tab。
- **重复 id**：解析时去重；恢复时已存在的 id 跳过。
- **拖拽中关闭 / 切换 world**：drop 时重新查找 id，找不到则 no-op。
- **存储损坏 / quota**：返回空快照，继续以内存状态工作。
- **多实例共享 userData**：最后写入者生效；不引入跨实例同步（非目标）。

## 5. 测试

- 纯模型：move before/after、no-op、跨 kind、缺失 id。
- 持久化：document order 序列化 / world 隔离 / 损坏数据 / 剪枝；
  browser snapshot 协议过滤 / 去重 / id 恢复 / seq 推进。
- store：savedOrder 排序、新 id 追加、关闭剪枝、move 持久化、world 切换。
- wiring：`DocumentTabs` 暴露 onReorder、`DocumentStage` 接 store、`BrowserDock` 恢复/持久化、
  `MafwShell` 配置 world 与 storage。
- 实机：文件 + 网页混合 tab 拖拽；重启后顺序与网页 tab 恢复；无 error overlay。

## 6. 决策记录

- **先 2A 后 2B/2C**：2A 用户可见且不碰 dirty / webview 生命周期；2C 需要单独迁移设计。
- **顺序按 world、网页全局**：文件 id 天然带 root；浏览器 tab 现在就是全局单例，保持行为一致。
- **只持久化列表，不持久化内容**：内容恢复继续走现有 draft / content-scope 通道，避免双写。
- **拖拽只改 document store**：body 的 tab 数组不参与排序，减少两套状态互相覆盖。
