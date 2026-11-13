# 2026-11-13 · 统一文档 Phase 2A（拖拽 + 跨重启）

- **版本**：`v5.1.0`
- **Commit**：`2dca5015`（move 模型 + spec/plan）、`703b3bab`（顺序持久化）、
  `dfdabb90`（浏览器 tab 持久化）、`9f50e122`（store 顺序权威）、`8cf187e5`（拖拽 UI）、
  `b9c856fa`（浏览器恢复）、`acfad16a`（world 配置）
- **范围**：Phase 2 的第一段；不做 toolbar 合并与详细状态迁移

## 交付

- `moveDocumentTab` 纯函数：跨 kind 的 before / after 重排，no-op 保持原数组。
- `document-tabs-store` 成为 tab 顺序权威：
  - `configureDocumentListWorld(worldId)` 按 world 载入顺序，未同步的 id 等到对应 body；
  - 每次 sync 后按 savedOrder 稳定排序，新 id 追加；
  - 关闭只剪掉「上一轮存在、这一轮消失」的 id；
  - 拖拽 / sync / active 变化都写回顺序快照。
- 新增 `document-list-persistence`：`mafw-document-list:v1:<worldId>`，只存 id 顺序 +
  activeId，300ms 去抖，切 world 前 flush，损坏数据 fail-open。
- 新增 `browser-tabs-persistence`：`mafw-browser-tabs:v1`，存 id / URL / 标题 / active；
  只恢复 `navigationDecision(url) === "allow"` 的 URL（http / https / mafw-file），
  `javascript:` / `file:` / `data:` 丢弃；恢复后保留原 id 并推进 seq，避免新 tab 撞 id。
- `DocumentTabs` 支持 HTML5 拖拽：左右半区决定 before / after，拖动中降透明度，目标侧
  accent 线；`DocumentStage` 直接接 `moveDocumentTab`。
- `BrowserDock` 首次挂载恢复浏览器 tab，随后跟随 tab / active 变化持久化；卸载时 flush。
- `MafwShell` 在 localStorage bootstrap 配置两个存储，并用 `on(currentProject)` 配置
  document world。

## 测试

- desktop 全量：**3745 / 3745**（725 suites）
- 本轮新增测试：**19**
  - `document-tabs-model.test.ts`：1（move before/after / no-op / 跨 kind）
  - `document-list-persistence.test.ts`：5（roundtrip / world 隔离 / 损坏数据 / 去抖 /
    单 world flush）
  - `browser-tabs.test.ts`：1（显式 id 推进 seq）
  - `browser-tabs-persistence.test.ts`：4（恢复一次 / 协议过滤 / 快照 roundtrip / 12 上限）
  - `document-tabs-store.test.ts`：5（savedOrder / 新 id 追加 / 关闭剪枝 / move 持久化 /
    world 切换 / 无 world 不写）
  - `document-stage-wiring.test.ts`：2（拖拽接线 / 浏览器恢复持久化）
  - `unified-document-wiring.test.ts`：1（MafwShell world + storage 配置）
- `tsgo --noEmit -p tsconfig.json`：rc=0
- `electron-vite build`：rc=0

## 实机确认

fresh built app（CDP 9224）：

- 打开 `AGENTS.md` + `https://example.com`，tab 顺序 `[file, web]`。
- 用 `DragEvent` 驱动与真实拖拽相同的 handler，把 web 拖到 file 左侧 → `[web, file]`；
  webview 元素标记保持，切换不重载。
- reload 后恢复 `[web, file]`，webview 重新加载 `https://example.com/`，
  `mafw-document-list:v1:C:\...opencode-plugin-mafw` 与 `mafw-browser-tabs:v1` 内容正确。
- 关闭 web tab 后快照变 `tabs: []`，reload 后只剩 `AGENTS.md`，不会复活。
- 无 Vite error overlay。

## 边界与后续

- **2B**：统一 toolbar 动作注册（body 注册动作，`DocumentStage` 渲染唯一 toolbar）未做。
- **2C**：`EditorModel` / `BrowserTab` 详细状态迁入 document store 未做；文件内容 / dirty /
  conflict / 草稿仍由 `editor-state` / `editor-drafts` 持有，webview 生命周期仍由 browser
  view registry 持有。
- 不做拖拽跨窗口、键盘重排、分屏或撤销栈。
- 已知：right dock 的 open 状态仍独立持久化；若上次关闭 dock，重启后文档 tab 已恢复但
  dock 保持关闭，需要用户切回面板（现有 dock 偏好行为，不在 2A 改动）。
- E6 worktree / `feat/gateway-e6-interaction-model` 未触碰。
