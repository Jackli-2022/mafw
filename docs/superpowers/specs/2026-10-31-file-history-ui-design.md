# 文件历史 UI（桌面）设计（2026-10-31）

状态：待批准
调研：`docs/research/2026-10-31-file-history-ui-research.md`
范围：桌面工作台编辑器 + gateway 只读内容端点 + SDK/preload + 保留策略微调。

## 1. 意图

`FileHistoryService` 已经在 agent 每次写文件前保存版本（`reason=tool:before`），
但用户看不到、也无法在桌面恢复。本设计补上最后一段：**编辑器内的文件历史面板**
（列表 / 差异预览 / 恢复），让「非 git、二进制、Office」也有可用的版本回退。

不引入新的快照机制；复用现有 blob 与 `pre-restore` 反悔语义。

## 2. 目标

- G1 编辑器头部「历史」入口（针对当前文件）。
- G2 版本列表：按天分组，显示相对时间 + 绝对时间 tooltip、reason 徽标、大小；默认选中最新。
- G3 差异预览：默认「对比当前磁盘版本」，可切「对比上一版本」；只读，复用 `DiffReviewPanel`。
- G4 恢复：二次确认；恢复前自动 `pre-restore` 快照；恢复后编辑器重载、列表刷新、toast。
- G5 二进制/Office：不生成文本 diff，显示元数据并允许恢复。
- G6 契约完整：gateway 路由 + route-catalog/OpenAPI + SDK client + preload 类型。
- G7 测试：gateway 内容端点、desktop 纯逻辑、wiring 契约；全量通过。

## 3. 非目标（v1）

- 全局跨文件时间线 / 项目级历史和 `CheckpointOverlay` 合并。
- 删除文件恢复选择器（VS Code `Local History: Find Entry to Restore`）。
- **新建文件的 tombstone**：文件不存在时目前不快照，故「撤销文件创建」不可用；UI 明示。
- 片段级恢复（JetBrains chevron）。
- 任意两个版本对比（Select for Compare）。
- 手动命名快照的 UI（服务端 reason 已支持，后续）。
- 云端/跨机同步；替代 Git。

## 4. 交互

### 4.1 入口

`DockPanelHeader` 增加 clock 图标按钮（新图标 `history`），tooltip「文件历史」。
- 无活动文件时禁用。
- 点击在 `mode: "edit" | "diff"` 之外新增 `"history"`；再点返回编辑。
- 有未保存修改（dirty）时仍可打开查看；仅**恢复**被禁用。

### 4.2 布局

```
┌ EditorDock header: [保存] [外部] [预览] [diff ↑↓] [历史*] [改动] ┐
├ tabs ───────────────────────────────────────────────────────────┤
│ ┌ 版本列表 280px ────────┐ ┌ 只读差异 ───────────────────────┐ │
│ │ 今天                    │ │ 改动预览（只读）                 │ │
│ │ ● 14:03 Agent 写入前 32KB│ │ --- a/report.pptx (binary)      │ │
│ │   13:58 恢复前       31KB│ │ （二进制/超大 → 元数据占位）     │ │
│ │ 昨天                    │ │                                  │ │
│ │ ● 10-30 18:22 手动    12KB│ │                                  │ │
│ │                         │ │                                  │ │
│ │ [对比当前|上一版本]      │ │                                  │ │
│ │ [恢复此版本]            │ │                                  │ │
│ └─────────────────────────┘ └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

- 左栏固定 280px；窄容器（< 520px）列表收窄到 220px，仍保持双栏（不做抽屉切换）。
- 列表行：`role=button`、`tabIndex=0`；`↑/↓` 移动选择，`Enter` 预览（选中即预览，Enter 等价）。
- 选中行高亮；行内显示 `HH:mm`（今天）/`MM-DD HH:mm`（非今天）+ reason 徽标 + 大小。
- 按天分组头：今天 / 昨天 / `MM-DD`（历史按 session 存续，不跨年设计；跨年沿用 `MM-DD`）。
- 恢复按钮在左栏底部，**常显不隐藏**（Cursor 2026 教训），dirty 时禁用并显示原因。
- 对比模式：两态 segmented（`ButtonV2` aria-pressed）「对比当前」/「对比上一版本」；
  上一版本不存在时禁用。

### 4.3 恢复流程

1. 点击「恢复此版本」→ 行内确认条：「恢复到此版本？当前内容会先自动保存为快照」+ [恢复] [取消]。
2. 确认 → `POST /api/file-history/restore`。
3. 成功 → `EditorDock.reloadFromDisk(rel)`；面板刷新；自动选中新出现的 `pre-restore` 条目
   （即“撤销这次恢复”的入口）；toast「已恢复到 13:58 的版本，可再次撤销」。
4. 失败 → 面板内 banner 显示原因（not-found / blob-missing / io），保留选择。
5. dirty → 禁用恢复，banner：「编辑器有未保存修改；先保存或撤销修改再恢复。」

### 4.4 空态 / 特殊态

| 状态 | 文案/行为 |
|---|---|
| 无历史 | 「该文件还没有历史版本」+「agent 每次写入前会自动保存；新建文件在首次覆盖后才有历史」 |
| binary | 「二进制文件（32 KB），无法预览文本差异，仍可恢复」 |
| large（>1 MiB） | 「文件超过 1 MB，未生成差异预览，仍可恢复」 |
| 内容相同 | 「该版本与当前内容相同」 |
| 列表加载失败 | banner + 重试按钮 |
| 文件被删除（当前不存在） | 允许选历史版本恢复（服务端 restore 会重建文件）；当前文本视为空串 |
| agent 正在写 | 列表随 fs.watch 刷新；恢复不做额外锁（用户自担并发，冲突横幅兜底） |

## 5. Gateway

### 5.1 新端点 `GET /api/file-history/content`

Query：`sessionID`、`entryId`。

200：

```json
{
  "entry": { "id": "...", "rel": "docs/a.md", "size": 1234, "reason": "tool:before", "createdAt": "...", "seq": 3 },
  "kind": "text",
  "content": "…",
  "size": 1234
}
```

- `kind`：
  - `text`：`size <= 1 MiB` 且无 NUL、UTF-8 解码成功（`TextDecoder('utf-8', { fatal: true })`）。
  - `large`：`size > 1 MiB`。
  - `binary`：其余。
- 只有 `kind=text` 才返回 `content`。
- 错误：400 缺参，404 entry/blob 不存在，403 非 loopback，503 服务未初始化，500 IO。
- 实现：`FileHistoryService.readContent(sessionID, entryId, { maxTextBytes })`；只读 blob，不碰工作区。
- 不新增 `diff` 端点：差异在桌面用 `diff` 包从「历史内容 + 当前文本」计算，避免 gateway 引入 diff 依赖。

### 5.2 保留策略

`DEFAULT_MAX_PER_FILE` 20 → 50（对齐 VS Code 默认）。会话上限 500、单文件 50 MB 不变。
只影响后续 prune；存量条目不会被主动删除。

### 5.3 契约

- `gateway/src/routes/route-catalog.ts` 增加 content 路由（tag `internal`，与现有 file-history 一致）。
- `npm run emit:openapi` 重新生成 `packages/gateway-sdk/contract/*` 与 `api-schema.gen.ts`。
- SDK：`MafwClient.fileHistory.list/content/restore`；导出 `FileHistoryEntry`、`FileHistoryContent`。
- `snapshot` 端点保持 internal，不暴露给桌面。

## 6. Desktop

### 6.1 新模块

| 文件 | 职责 |
|---|---|
| `renderer/mafw/components/file-history-model.ts` | 分组、相对时间、reason 文案、大小格式化（纯函数） |
| `renderer/mafw/components/file-history-diff.ts` | `buildHistoryPatch(rel, before, after)`（`createTwoFilesPatch`）、统计、1 MiB/文本守卫（纯函数） |
| `renderer/mafw/components/FileHistoryPanel.tsx` | 列表 + 预览 + 恢复确认 |
| `renderer/mafw/components/FileHistoryPanel.css`（或并入 mafw.css） | 双栏、行、徽标、确认条 |

`diff` 包加入 `packages/desktop/package.json` dependencies（`8.0.2`，与 session-ui 同版）。

### 6.2 EditorDock 接线

- `mode` 联合类型加 `"history"`。
- 头部按钮：`Icon name="history"`（需在 `packages/ui/src/components/icon.tsx` 增加 clock 图标）。
- body：`<Show when={mode()==="history"}>` 渲染 `FileHistoryPanel`；
  `embedded` 样式与现有 diff 模式一致（不新开 Portal/模态）。
- Props：`sessionID`、`rel=activeFile().rel`、`currentText=f.savedContent`、`currentKind=f.kind`、
  `dirty=f.dirty`、`refreshKey=fileVersion()[rel] ?? 0`。
- `onRestored` → `reloadFromDisk(rel)`（已有）；保持 history 模式。
- `Esc`：history 模式返回编辑（与 diff 模式一致，若现有 diff 模式有 Esc 处理则复用）。

### 6.3 数据流

```
FileHistoryPanel
  onMount / refreshKey 变化
    → fileHistory.list({sessionID, rel})
  selected 变化
    → fileHistory.content(selected)        // entry 内容缓存
    → compareBase==='previous' 时再取上一条
  patch = buildHistoryPatch(rel, entryText, currentText)
  restore → fileHistory.restore → props.onRestored() → 重拉 list（选中最新 pre-restore）
```

- 内容按 `entryId` 缓存（blob 不可变），会话/文件切换时清空。
- 列表刷新时保留当前 `entryId` 选中；不存在则回到最新。
- 不轮询；依赖 `refreshKey`（fs.watch 版本号）+ 打开时拉取。

## 7. SDK / preload

```ts
// SDK
fileHistory: {
  list(params: { sessionID: string; rel?: string }): Promise<{ entries: FileHistoryEntry[] }>
  content(params: { sessionID: string; entryId: string }): Promise<FileHistoryContent>
  restore(params: { sessionID: string; entryId: string }): Promise<{ ok: true; rel: string }>
}
```

preload 同名命名空间；`mafw-types.ts` 的两套 API 面同步（`MafwApi` / invoke 面）。

## 8. 测试

- gateway：
  - `readContent`：text / binary（NUL）/ large / not-found / 非法 entry。
  - 路由：200/400/404；loopback 门沿用现有。
  - 保留上限 50（prune 测试）。
- desktop：
  - `file-history-model`：今天/昨天/更早分组；相对时间；reason 文案；大小；空数组。
  - `file-history-diff`：相同 → null；新增/删除/修改 hunk；超限 → null；二进制守卫。
  - wiring 契约：EditorDock 含 history 模式、按钮、面板 props；CSS 类存在。
- 全量：gateway jest、root plugin、desktop `npm test`、`tsgo -p`、`electron-vite build`。

## 9. 手工验收

1. 打开一个被 agent 改过的文本文件 → 历史按钮 → 列表有 `Agent 写入前` 条目 → diff 正确。
2. 切「对比上一版本」→ diff 变化正确。
3. 恢复旧版本 → 确认 → 文件内容变回、编辑器刷新、出现 `恢复前` 条目 → 再恢复回来。
4. 打开 pptx → 历史 → 元数据态；恢复可用。
5. 新建文件（无历史）→ 空态文案。
6. dirty 时恢复按钮禁用 + 提示。

## 10. 决策（我的判断）

1. 用编辑器内 `mode=history`，不做模态/全局时间线（保持 tabs 与上下文）。
2. 内容端点 + 客户端 diff，gateway 不新增 diff 依赖。
3. dirty 时禁止恢复（保护未保存草稿），而不是覆盖后再提示。
4. 每文件上限 50，对齐 VS Code。
5. 恢复后自动选中 `pre-restore` 条目，让“撤销恢复”一键可达。
6. v1 不做新建文件 tombstone；在空态与文档中明示。

## 11. 风险

- 大文件 diff 卡 UI：1 MiB 上限 + 只读预览；超过直接元数据态。
- 恢复与 agent 并发写：依赖现有 fs.watch 冲突横幅与 mtime 校验；不做额外分布式锁。
- Office 文件恢复后预览缓存：`reloadFromDisk` + `fileVersion` 递增应触发重解析；需手工验收。
- 历史列表膨胀：50/文件 + 500/会话 + 内容寻址；prune 清理无引用 blob。
