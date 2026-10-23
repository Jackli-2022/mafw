# B2：quote-reply + 变更树实时化设计

> 日期：2026-10-23 · 状态：待用户确认
> 来源：`docs/research/2026-10-21-six-way-frontend-interaction-gap-survey.md` P1（quote-reply、变更文件树实时化）
> 关系：B 线（前端补完）第二批；第一批（readline/历史/task 跳转/后台 REST/点击聚焦）已交付（`2ddf576b`）。checkpoint/rewind、截屏注释、跨会话搜索不在本批。

## 1. 意图与 Why

1. **quote-reply**：用户看到 agent 的一段回答/一个代码块，想追问"这里为什么这样写"，今天只能手动复制粘贴到 composer——丢失上下文、易漏关键行。选中文本 → 一键引用进 composer，追问自然带上原文。
2. **变更树实时化**：ChangesDock 现在是平铺文件列表；agent 边写代码边产生 `session.diff` SSE，用户看不出目录结构、也看不到"刚刚又改了哪个文件"。升级为可折叠目录树 + 变更脉冲，让审阅跟得上写入。

## 2. 范围与设计

### 2.1 Quote-reply

**触发**

- 在 `.mafw-session-turn-container`（聊天滚动区）内拖选非空文本 → 选区旁浮出「引用」按钮。
- 点击按钮：把选中文本格式化后**追加**到 composer（保留原有草稿），清空选区，caret 落在末尾并聚焦。
- 不做右键菜单、不做整条消息引用、不做快捷键（v1 保持发现性）。

**工具栏行为**

- 位置：`Range.getBoundingClientRect()` 上方 8px；上方空间不足时放下方；left clamp 到视口内。
- 用 `Portal` 挂 body（滚动容器有 overflow，避免被裁切）。
- 隐藏：选区为空、选区不在聊天滚动区、滚动、resize、session 切换。
- **Esc 优先级**：工具栏可见时，Esc 只隐藏工具栏并 `preventDefault/stopPropagation`，**不中断当前回合**；工具栏不可见时才走既有 Esc 中断逻辑（避免"想关提示却杀了 agent"）。
- `onMouseDown` 必须 `preventDefault()`，否则点按钮会先清掉选区、按钮可能先消失。

**格式化（纯函数）**

`formatQuote(text: string, maxChars = 4000): string`

- CRLF → LF；trim 首尾空白。
- 每行前缀 `> `；空行输出 `>`（blockquote 连续）。
- 超过 `maxChars`：截断到 `maxChars`，末尾追加一行 `> …（引用已截断）`。
- 空文本返回空串（调用方不插入）。
- **不**附消息 id/角色标记：引文本身就是上下文，避免污染 prompt。

**插入**

```
const block = formatQuote(sel)
setInput(prev => prev.trim()
  ? prev.replace(/\s*$/, "") + "\n\n" + block + "\n\n"
  : block + "\n\n")
```

- 插入后 `textareaEl()?.focus({ preventScroll: true })` + caret 到末尾；`autoGrow`。
- 与 B4 点击聚焦的交互：拖选时选区非空 → B4 的 `shouldFocusComposerFromClick` 返回 false，不会抢焦点；工具栏在 Portal 中，点击不经过滚动区 click handler。
- **选区内容**：始终只取 `selection.toString()` 的精确文本（`formatQuote(sel)`）；`[data-message]` 只用于判定选区位于聊天区内，**不作为内容源**。跨多个消息时同样只引用用户实际选中的字符串。

**验收**

- 选中一段多行文本 → 点「引用」→ composer 出现 `> ` 前缀的引文 + 空行；原草稿保留在前。
- 选中超长文本 → 截断标记可见；空选区不出现按钮。
- 拖选文本时 composer 不被抢焦点；点按钮后 composer 聚焦、选区清除。
- 滚动/切会话/Esc → 按钮消失。

### 2.2 变更树实时化

**数据（builder check 修正）**

- **树结构/统计**：继续用 ChangesDock 现有 `props.diffs` = `aggregateSessionDiffs(...)`（per-turn `summary.diffs` 累计；见 `MafwShell.tsx` 的 ChangesDock 接线）。这是"本会话改过哪些文件"的稳定列表，不因 commit 归零。
- **实时脉冲**：用 `store.session_diff[sid]`（SSE `session.diff` 写入；此前无人读取）作为 `liveDiffs` 新 prop 传入 ChangesDock。树只对 `liveDiffs` 里出现且存在于树中的 path 脉冲；`session.diff` 缺失时只建树、不脉冲（fail-open）。
- 路径归一化：`\` → `/`，去掉前导 `./`；空路径归 `"(unknown)"`。
- 纯函数 `buildChangeTree(files: FileDiffEntry[]): ChangeTreeNode[]`：
  - `{ kind: "dir" | "file", name, path, additions, deletions, status?, file?, children[] }`
  - 目录聚合子树 +/−；排序目录优先、同类按 `localeCompare`。
  - 同目录同名文件/目录不合并（合法极端情况）。
- 纯函数 `changedDiffPaths(prev, next): Set<string>`：新增文件或 +/− 计数变化的 path（用于脉冲）。
- **脉冲基线**：组件内维护 `seenSnapshot` + `prevLive`；`sessionID` 变化时清空两者。**每个会话的第一份 `liveDiffs` 快照只建立基线、不脉冲**（包括空数组）；之后快照变化才脉冲。这样切会话不会闪一整屏，且"会话从空到第一个文件"仍会脉冲。

**UI**

- ChangesDock 文件列表替换为树：
  - 目录行：chevron（展开/折叠）+ folder 图标 + 目录名 + 聚合 `+N/-M`；点击切换展开。
  - 文件行：缩进（depth × 12px）+ 文件名 + `+N/-M` + status 徽标（A/D/M，若 `status` 有值）；点击进入既有 `DiffReviewPanel`。
  - 默认全部展开；折叠状态按 path 记录在组件内信号，sessionID 变化时清空（同时清 `openFile`）。
  - 头部总统计与空态保持现状。
- 实时脉冲：
  - `createEffect` 监听 `props.liveDiffs`，用 `changedDiffPaths` 找出变化文件；加入 `pulse` Set，1200ms 后移除。
  - 文件行加 `mafw-change-pulse`（背景/左边框短暂高亮，用 token，`prefers-reduced-motion` 下无动画）。
  - 初次挂载 / 切会话：第一份 `liveDiffs` 只建基线、不脉冲；之后才脉冲。
- 不做：文件状态推断（只用 `status` 字段）、目录级键盘导航、树搜索。

**验收**

- 嵌套路径显示为树；目录聚合统计正确；折叠/展开可用；点击文件进 diff。
- 树来自 `aggregateSessionDiffs`；`store.session_diff` 更新时对应文件行脉冲一次；每个会话第一份快照不脉冲。
- 切会话重置展开态、打开文件与脉冲基线。
- 大目录不递归预取（纯前端字符串分组，无 IO）。

## 3. Builder check 裁定（2026-10-23，四项）

1. **树的数据源**：树/统计继续用 `aggregateSessionDiffs`（`MafwShell.tsx` 现有接线，per-turn `summary.diffs` 累计）；**脉冲**新增 `liveDiffs` prop，来自 `store.session_diff[sid]`（SSE `session.diff`，此前无人读取）。不把整棵树切到 `session_diff`——它是 VCS 当前未提交状态，commit 后会归零，语义不同。
2. **引用内容**：只取 `selection.toString()` 的精确文本；`[data-message]` 仅作"选区在聊天区内"的判定，不作为内容源（`data-message` 包住整个 turn，取它会引用过多）。
3. **脉冲基线**：`sessionID` 变化清空 `seenSnapshot`/`prevLive`；每个会话**第一份** `liveDiffs` 快照只建基线、不脉冲（含空数组）；之后才脉冲。避免切会话闪屏，同时保留"从空到第一个文件"的脉冲。
4. **Esc 优先级**：工具栏可见时 Esc 只隐藏工具栏、不中断回合；工具栏不可见时才执行既有中断。避免用户想关提示却杀掉 agent。

## 4. 非目标

- checkpoint/rewind 时间线、截屏注释、跨会话全文搜索（下一批）。
- gateway / runtime 改动；`session.diff` 数据面不变。
- quote-reply 的跨消息精确来源、富文本/代码围栏格式。
- 变更树的目录级操作（全部暂存/回退）——diff 面板已有 hunk 级能力。

## 5. 文件预估

| 文件 | 动作 |
|---|---|
| `packages/desktop/src/renderer/mafw/components/quote-format.ts` + `.test.ts` | 新建纯格式化 |
| `packages/desktop/src/renderer/mafw/components/QuoteToolbar.tsx` | 新建浮层（Portal） |
| `packages/desktop/src/renderer/mafw/components/ChatPane.tsx` | 选区监听 + 插入 |
| `packages/desktop/src/renderer/mafw/components/change-tree.ts` + `.test.ts` | 新建纯树/脉冲 |
| `packages/desktop/src/renderer/mafw/components/ChangesDock.tsx` | 树 UI + 脉冲（新 `liveDiffs` prop） |
| `packages/desktop/src/renderer/mafw/MafwShell.tsx` | 传 `liveDiffs={store.session_diff[sid]}` |
| `packages/desktop/src/renderer/mafw/mafw.css` | 树缩进/chevron/脉冲 |
| `packages/desktop/tests/b2-wiring.test.ts` | 接线断言 |

## 6. 测试策略

- `quote-format.test.ts`：多行/空行/CRLF/trim/超长截断/空文本/中文。
- `change-tree.test.ts`：嵌套目录聚合、排序、根文件、Windows 分隔符、unknown、status、changedDiffPaths（新增/计数变化/不变/删除）。
- `b2-wiring.test.ts`：ChatPane 有选区监听与 `formatQuote` 插入；ChangesDock 使用 `buildChangeTree`/`changedDiffPaths`/`mafw-change-pulse`。
- 门禁：desktop `npm test`、`tsgo --noEmit`、`electron-vite build`；session-ui 不受影响（本次不改）。
- 手工冒烟：真实会话拖选引用；agent 改动文件时观察树脉冲（dev app + serve 就绪）。

## 7. 风险

| 风险 | 处置 |
|---|---|
| 点「引用」时选区先被清空 | 工具栏 `onMouseDown` preventDefault；点击前不隐藏 |
| 浮层被滚动容器裁切 | Portal 到 body + fixed；滚动即隐藏 |
| 长选区撑爆 prompt | 4000 字符截断 + 明确标记 |
| 拖选被 B4 抢焦点 | B4 已按 `selectionCollapsed` 排除；手工回归 |
| 大 diff 快照每次全量重建树 | 纯字符串分组，文件数百级无压力；不做深比较缓存（YAGNI） |
| 脉冲在 reduced-motion 下闪烁 | media query 关闭动画，只保留静态高亮或直接不显示 |
| 路径分隔符/大小写 | 归一化 `\`→`/`；排序用 localeCompare；不做大小写折叠（保留真实路径） |
