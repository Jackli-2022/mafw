# Desktop 批注交互调研（2026-11-16）

- 状态：调研完成（未改产品代码）
- 范围：MAFW Desktop 文件预览 / 编辑器批注；Google Docs、Figma、GitHub PR review 的注释模式
- 方法：`EditorDock.tsx` / `AnnotationSheet.tsx` / `PendingAnnotations.tsx` / `annotation-store.ts` / `annotation-marks.ts` 代码审计 + 官方文档与产品博客
- 结论一句话：**现在的问题是“选中即弹一张表单、发完只剩一个小点、没有可浏览的批注列表”。业界做的是“显式入口 → 轻量 composer → 锚点 pin/highlight → margin/tray → resolve”。**

---

## 0. TL;DR

1. MAFW 现在把“选中文本”直接等同于“打开批注表单”：`selectionchange` 150ms 后自动 `setAnnotOpen(true)` / `setQuoteOpen(true)`。用户没有“我想批注”的明确动作，误选也会弹表单。
2. Composer 本身太重：420px 浮卡、标题 + 文件行号 meta + textarea + 10px 提示 + “攒草稿/发送/取消”三组动作，像一个小对话框，不像“在文档边上留一句话”。
3. 发出去之后没有“批注列表”：只剩编辑器上的 12px 小点和 pending 脉冲；唯一的列表是 composer 上方 10–11px 的 `PendingAnnotations`，截断、密集、只显示未发送草稿。
4. 业界共识非常一致：
   - **ADE（Agent Development Environment）**：选中 agent 回复 → 浮动 toolbar（Add to chat / Comment / Create issue）→ 300px 小 composer → CSS Custom Highlight 三态（pending / held / active）+ margin card → composer 旁 comments pill，逐条 “Send with next message”，发送后移除。它是**最接近 MAFW 的参照**：批注是给 agent 的 review note，不是人类协作 thread。
   - **Google Docs**：选中 → 点“添加评论” → 右侧 margin 卡片；有评论历史面板（All / For you / Open / Resolved）、搜索、选中文本预览、resolve / reopen。
   - **Figma**：进入 comment mode（`C`）→ 点位置或框选区域 → pin/region；canvas 上是 pin，密集时变 cluster；右侧 sidebar 可搜索/排序/过滤；resolve / unread；composer 刻意做小。
   - **GitHub**：hover 行 → 蓝色评论图标；可拖选行范围；单条 comment 或 Start a review 批量提交；Resolve conversation 折叠；Conversations 菜单区分 unresolved / resolved / outdated。
5. 建议的 MAFW 交互：**优先照 ADE 的 “selection toolbar → 300px composer → 三态高亮 + margin card → comments pill / Send with next message”**；Google Docs/Figma 的 tray、resolve、history 作为 P1/P2，不要一上来就做重系统。核心是“选中不自动弹表单、composer 要轻、发送要可预期”。

---

## 1. 现状审计

### 1.1 创建：选中即打开表单

`packages/desktop/src/renderer/mafw/components/EditorDock.tsx`：

- 源码编辑器：`onSelectionChange` 后 150ms，若无 preview quote 且 `sel()` 有内容，直接 `setAnnotOpen(true)`。
- 预览面（markdown/docx/pdf 等）：`selectionchange` / `mouseup` 捕获 `captureQuoteFromSelection()`，成功就 `setQuoteOpen(true)`。
- 键盘：`Ctrl+M`（macOS 也是 Ctrl，避免 Cmd+M 最小化）打开批注；没有 `C` 之类的单键入口。
- 注释本身写的是“选中即批注（rev4）：无模式开关”——这是当前不适的根源：**选择是阅读动作，不应该自动变成创作动作**。

### 1.2 Composer：一张小表单

`AnnotationSheet.tsx` + CSS：

- 位置：绝对定位在 `editor-body` 内，`placeAnnotationBox` 按 below → above → right → left 翻边；宽 `min(420px, 100% - 16px)`。
- 结构：标题「批注」+ `file › anchor` 的 11px mono meta + 可选「引用」+「取消」；textarea；10px 提示「Enter 发送 · Ctrl+Enter 攒草稿 · Shift+Enter 换行」；「攒草稿」「发送」两个按钮。
- 视觉：`bg-overlay`、1px strong border、12px 圆角、大阴影、160ms 入场；在密集内容上像一个浮窗，而不是 anchored note。
- 缺少：被批注文本的引用预览、作者/时间、目标 Agent、讨论 thread、resolve。

### 1.3 发送后：只剩小点

- `annotation-marks.ts`：`pending` / `responded` 两态；`pending` 的 rect/dot 做 1.6s 无限 pulse。
- `PendingAnnotations.tsx`：composer 上方的小列表，10–11px；`file:Lx-Ly` 或 `rel › anchor` 截断；`✕` 是文本字形；只展示 draft，不展示已发送/已回复/已解决。
- `annotation-store.ts`：只存待发送草稿；`takeForSend` 后清空，没有“已发送批注”的持久列表/thread。
- 因此发出去之后，用户没有地方回看“我批了什么、Agent 回了什么、哪些还没处理”。

### 1.4 其他细节问题

- `QuoteToolbar` 只服务聊天选中文本，文件编辑器没有同类“引用/批注”浮钮。
- Composer meta 使用 mono、11px，像调试信息；没有“选中文本”摘要。
- pending 的无限脉冲把“等待”变成持续噪音；resolved/answered 也没有明确的视觉状态。
- 没有按文件/未解决/已解决筛选，没有搜索，没有跳转到锚点。
- 没有编号 pin / cluster，多个批注在同一区域会重叠成一片小点。
- 没有“批量审阅”概念：攒草稿是隐藏快捷键，用户很难发现。

---

## 2. 业界做法

### 2.1 Google Docs：margin card + comment history

- 选中文字/图片 → 点工具栏「添加评论」图标（或 `Cmd/Ctrl+Alt+M`）→ 评论框出现在右侧 margin，输入后点「评论」。
- 评论历史面板支持 `All / For you / Open / Resolved` 过滤、关键词搜索；每条显示 `Selected text` 预览，点击会滚动到文档中的对应位置。
- Resolve 用 checkmark，隐藏 thread；可以在历史里 reopen。
- 隐藏评论时，文档里保留 speech-bubble 小图标，点击可重新显示。

对 MAFW 的启示：**评论应该是右侧的“边注”，不是盖在正文上的表单；列表和锚点必须互相可跳转。**

### 2.2 Figma：pin / region + sidebar

- `C` 进入 comment mode；点击 canvas 位置或拖选区域创建 pin/region。
- pin 固定在画布位置；密集时自动聚成 cluster；hover 预览，点击打开 thread modal。
- 右侧 sidebar 可搜索、按日期/未读排序、过滤“只看我的”“只看当前页”“显示 resolved”。
- composer 被刻意做小，鼓励短评论；支持 reaction、@mention、图片/GIF；评论可以在编辑时保持打开。
- 官方 redesign 博客明确说：早期评论“hard to discover”，所以把 sidebar 做得更容易发现、pin 默认可见、密集区域用 cluster 降噪。

对 MAFW 的启示：**入口要可见；pin 要编号/聚类；侧栏是批注的家，不是附属小列表。**

### 2.3 GitHub PR review：hover 入口 + 批量 review

- hover 代码行 → 出现蓝色评论图标；点击行号或拖选/Shift 选范围后评论。
- 可以只发一条 `Comment`，也可以 `Start a review` 连续加多条，最后 `Submit review` 一次提交（批量避免多次通知）。
- `Resolve conversation` 折叠整条 thread；`Conversations` 菜单区分 unresolved / resolved / outdated，方便导航。
- 支持 suggestion block，把“改成什么”直接写成可应用建议。

对 MAFW 的启示：**“先攒、再统一发”是成熟模式；批量不是隐藏快捷键，而是可见的 review 流程。**

### 2.4 ADE：selection toolbar + margin cards + send-with-next-message

ADE 开源仓库：<https://github.com/arul28/ADE>；相关实现：`ThreadCommentLayer.tsx`、`ThreadCommentControls.tsx`、`threadCommentAnchors.ts`、`threadCommentsStore.ts`、`AssistantOutputSelectionToolbar.tsx`、`threadCommentService.ts`、`index.css`。

ADE 的批注是 **给 agent 的 review note**，不是人类协作 thread；这和 MAFW 的定位最接近：

- **只对 finished reply 开放**：选中 agent 回复文本后出现浮动 toolbar，按钮是 `Add to chat` / `Comment` / `Create issue`；回复还在 streaming 时 Comment 显示 `Wait for turn` 并禁用。选择本身不会自动弹表单。
- **Composer 很小**：300px popover，2 行 textarea 自动增高 52–180px；placeholder 直接写 “Comment for the agent. It goes with your next message.”；底部只有 `Cancel` / `Comment`，`Cmd/Ctrl+Enter` 保存，Esc 取消。没有 header、meta、三行快捷键说明。
- **锚点很稳**：text 用 `quote + 32 chars prefix/suffix`；table 用 `tableIndex/rowIndex/headers/cells`；图片/视频用 `mediaKind/source/label/index`。markdown 重渲染后重新解析，不依赖 DOM 位置。
- **三态高亮**：用 CSS Custom Highlight API，不改回复 DOM：
  - pending（随下一条发送）：accent 22% + 实线下划线 1.5px；
  - held（保留但不发）：accent 9% + 虚线下划线；
  - active（正在看/编辑）：accent 38% + 2px 实线。
  图片/视频用 2px outline 环，不是 highlight。
- **margin card**：正文右侧有 ≥196px 空间时，评论卡按锚点高度排到 margin 里，hover 打开；窄窗口退化成点击高亮后的 popover。卡片在正文滚动内容里，跟着消息滚。
- **发送集成**：composer 的 Send 左边是 comments pill（图标 + 数量）；有评论时会和 Send 合并成一个 pill；点开是 comments 列表，每条有 `Send with next message` checkbox。发送时把选中的评论格式化成 `<ade-review>` 块（每条 `<comment><quote><note>`），发送后从 pending 移除；失败可 restore。
- **乐观更新**：评论保存先本地显示，host 确认后再对齐；输入框因切 chat/tab 关闭时，按锚点保留未保存文本，回到同一段文字再打开会恢复。
- **没有 resolve/history**：评论是临时 review queue，发送后就消失；不维护已解决 thread。ADE 用 margin cards + composer list 解决“看见/编辑/选择发送”，而不是 Google Docs 式永久评论历史。

对 MAFW 的启示：**ADE 这套比 Google Docs/Figma 更适合我们**——MAFW 的批注也是发给 agent 的反馈，不是多人 thread。优先抄它的“显式 toolbar + 小 composer + 三态高亮 + margin card + comments pill”，而不是先做 tray/resolve/搜索。

### 2.5 横向对照

| 能力 | Google Docs | Figma | GitHub | ADE | MAFW 现状 |
|---|---|---|---|---|---|
| 显式入口 | 工具栏 + 快捷键 | `C` + 工具栏 | hover 行图标 | 选中回复 → 浮动 toolbar | ❌ 选中即弹 |
| 锚点形态 | margin card + 高亮 | pin / region / cluster | 行号 + 范围 | highlight + margin card | 小点/矩形 |
| 创建 composer | 右侧 margin | 小 modal | 行内 | 300px popover，2 行 | 420px 浮卡 |
| 列表/侧栏 | 评论历史 | 右侧 sidebar | Conversations | margin cards + composer list | ❌ 只有小 pending 列表 |
| 过滤/搜索 | All/Open/Resolved + 搜索 | 日期/未读/我的/当前页 | unresolved/resolved/outdated | 无 | ❌ |
| 批量 | — | — | Start a review | 逐条 Send with next message | 仅隐藏的攒草稿 |
| 状态 | Open/Resolved | Unread/Resolved | unresolved/resolved/outdated | pending / held / active | pending/responded |
| 跳转锚点 | 点击评论滚动 | 点击 pin 定位 | 点击 conversation | 点击高亮/卡片 | ❌ |
| 线程/回复 | 支持 | 支持 | 支持 | 无（发送后移除） | ❌ 一次性消息 |
| 视觉降噪 | 折叠成气泡图标 | cluster | 折叠 resolved | 三态高亮，无 pulse | 无限 pulse |

---

## 3. 交互原则

1. **两步创建**：选择/落点只产生“可批注”状态，出现一个轻量入口；用户再点“批注”才打开 composer。选择是阅读，不是提交。
2. **上下文先于输入**：composer 顶部必须显示被选中的 1–3 行引文或区域缩略图 + 人类可读位置（`desktop.md · L42–48`），而不是 mono 调试串。
3. **锚点要能看见、能解释**：文本用三态高亮 + margin card；图片/区域/表格用 outline + 编号 pin；同一区域聚合，不让小点堆叠。
4. **状态要诚实**：Pending（随下一条发送）/ Held（保留）/ Active（正在看）/ Sent（已发出）。用静态颜色 + 文案，不用无限脉冲。
5. **发送要可预期**：comments pill 显示条数，逐条勾选 `随下一条消息发送`；发送失败可恢复，不留“以为发了”的歧义。
6. **先轻后重**：ADE 不发散“永久评论历史”；先做 selection toolbar + 小 composer + 三态 + pill，tray / resolve 等审计需求出现再做。
7. **视觉克制**：一个 accent、6/10/14 半径、浮层用 `elev-panel`；不要把 composer 做成大对话框；12px 最小字号。
8. **键盘可完成**：`C` / `Ctrl+M` 新建，`⌘↵` 保存，`Esc` 取消；toolbar 可用方向键 + Enter 选择。

---

## 4. 建议的 MAFW 交互

### 4.1 创建（ADE 模式）

1. 在编辑器/预览中选中文本，或 hover 行/区域：
   - 选区旁出现 **浮动 toolbar**：`引用` / `批注`（图标 + 文字，120ms 淡入；选择只产生入口，不自动打开 composer）。
   - 行 hover 时行号旁出现同样的入口（GitHub 模式）。
   - `C` / `Ctrl+M` 在当前光标/选区打开。
   - 如果内容还在 streaming / 正在刷新，`批注` 显示 `等待完成` 并禁用（ADE 的 `Wait for turn`）。
2. 点击 `批注` 后出现 **300–340px 小 composer**：
   - 顶部一行：引文摘要（最多 2 行，超出省略）+ `desktop.md · L42–48`（12px，非 mono）。
   - 输入：2 行 textarea 自动增高 52–180px；placeholder「这条批注会随下一条消息发给 Agent」。
   - 底部只有 `取消` / `批注`；`⌘↵` 保存，`Esc` 取消；快捷键提示只在 focus 时显示。
   - 不放大标题、meta、三行说明；composer 看起来像“边上的一张小纸条”，不是对话框。
3. JSON 节点 / 表格单元格 / 图片区域 / PPTX 图钉：hover 出现小 `＋` / 拖动落框，打开同一个 composer；区域/单元格的缩略图放在引文位置。

### 4.2 发送前：三态高亮 + margin card

- 使用 CSS Custom Highlight API（或等价 overlay），三态：
  - **pending**（随下一条发送）：accent 22% 背景 + 实线下划线 1.5px；
  - **held**（保留但不发）：accent 9% + 虚线下划线；
  - **active**（正在看/编辑）：accent 38% + 2px 实线。
- 正文右侧有 ≥196px 空间时，评论卡按锚点高度排到 margin（宽 280px，跟随滚动，hover 打开）；窄窗口退化为点击高亮后的 popover。
- 图片/视频/区域用 2px accent outline 环，不用 highlight；表格行在行尾 hover 出现小评论按钮（ADE 的 row button）。
- 文本用高亮 + margin card；图片/区域/表格可用编号 pin（1、2、3）辅助定位，但不要给每个文本评论都加编号圆点。
- **不要无限 pulse**：只保留首次 180ms 出现和静态状态色。

### 4.3 发送：comments pill

- composer 的 Send 左侧放 comments pill（图标 + 数量）；有评论时它和 Send 合并成一个 pill（ADE 的 `ade-send-cluster`）。
- 点 pill 打开评论列表：每条显示引文 2 行、正文、`随下一条消息发送` checkbox、编辑/删除/跳转；顶部显示“3 条随下一条消息发送 / 1 条保留”。
- 发送时把选中的评论格式化成结构化块（每条 quote + note），发送成功后从 pending 移除；失败则恢复。
- 这比当前“composer 上方 10px 的待发送列表”更可见，也比单独一个 tray 更贴近发送动作。

### 4.4 永久 tray / resolve（P1，可选）

- ADE 不维护“已解决历史”；如果 MAFW 需要审计（谁在哪个文件批过什么、Agent 是否回复），再加右侧 `批注` tray：
  - `Open / Resolved / All` + 搜索；
  - 行：引文 2 行 + 文件/行号 + 状态 + 时间；
  - 点击跳转；resolve / reopen。
- 这是 P1，不要阻碍 P0 的“显式入口 + 小 composer + 三态高亮 + comments pill”。

---

## 5. 三个方向

| 方向 | 适合 | 关键 | 风险 |
|---|---|---|---|
| **A. ADE Review Notes（推荐）** | agent 回复 / 文档 / 预览 | selection toolbar + 小 composer + 三态高亮 + margin card + comments pill | 锚点要稳（quote + prefix/suffix）；宽度 < ~640px 时 margin card 要退化 |
| **B. Margin Rail + Tray** | 长时间审阅 / 需要回看 | 右侧 margin card / tray + Open·Resolved + 搜索 + 跳转 | 对“发给 agent 的临时反馈”偏重，容易做成第二个收件箱 |
| **C. Quiet Inline** | 快速阅读批注 | 极轻浮钮 + 小 composer，评论只做小标记 | 发现性和全局浏览弱 |

建议 **A 为 P0，B 作为 P1 可选**：

- agent 回复 / 文本 / markdown / PDF：selection toolbar + 三态高亮 + margin card；
- 图片 / 表格 / JSON / PPTX / diff：区域/行入口 + 同一个 300px composer + outline 状态；
- 两种都落到同一个 pending comment 数据源，发送时合并成一个结构化 review block；
- 只有出现“需要审计/回看”的需求时，再增加 tray / resolve（P1）。

---

## 6. 视觉规格

### 三态高亮（ADE 值）

| 状态 | 背景 | 下划线 | 含义 |
|---|---|---|---|
| pending | accent 22% | 实线 1.5px（accent 75%） | 会随下一条消息发送 |
| held | accent 9% | 虚线（accent 45%） | 保留，不发送 |
| active | accent 38% | 实线 2px（accent 100%） | 正在查看/编辑 |

- `text-underline-offset: 3px`；不改 DOM，用 CSS Custom Highlight API；不支持时退化为 overlay rect。
- 图片/视频/区域：2px accent outline 环（held 用虚线），与文字三态对应。
- 表格行：行尾 hover 出现小评论按钮，不整行染色。
- 编号 pin 只用于图片/区域/表格等无法用高亮表达的位置；文本评论不额外加圆点。
- 不再用无限 pulse；只在评论首次出现时 180ms 出现。

### Composer（300–340px）

- 宽 300px（窄屏 `calc(100% - 24px)`）；padding 10–12px；radius 10–12px；`bg-overlay` + `border-strong` + `elev-panel`。
- 顶部一行：引文摘要（最多 2 行，`text-2`，可展开）+ 人类可读位置（12px，非 mono）。
- textarea 2 行起，自动增高 52–180px；placeholder「这条批注会随下一条消息发给 Agent」。
- 底部只有 `取消` / `批注`；`⌘↵` 保存，`Esc` 取消；快捷键提示只在 focus 时显示。
- 图标用已注册 SVG，不用 `✕` 文本字形；阴影比当前 `0 18px 44px rgba(0,0,0,.38)` 更轻。

### Margin card

- 正文右侧 ≥196px 空间时出现：宽 280px，最小高 44px，按锚点纵向位置排序，间距 8px。
- 卡片：引文 2 行 + 正文 2 行 + 状态点；hover 提升到 `bg-raised`；点击进入 active。
- 跟随正文滚动；窄窗口退化为点击高亮后的 popover（position: fixed）。
- 同一锚点多条评论时合并成一张卡（`2 条批注`），展开成列表。

### Comments pill

- 位于 Send 左侧：`💬 3`；有 pending 评论时与 Send 合并成一个 pill（ADE 的 send cluster）。
- 点开列表：每条引文 2 行 + 正文 + `随下一条消息发送` checkbox + 编辑/删除/跳转。
- 顶部摘要：`3 条随下一条消息发送 · 1 条保留`。
- 列表为空时不显示 pill；`held` 评论仍有入口，避免“评论消失”。

### 状态

| 状态 | 视觉 |
|---|---|
| Pending | accent 22% 高亮 + `随下一条发送` |
| Held | accent 9% 虚线 + `保留` |
| Active | accent 38% + 2px 下划线 |
| Sent | 发送后从 pending 移除，聊天里出现结构化 review 卡 |

ADE 没有 resolved / reopen：评论是临时 review 队列，发送即完成。若未来需要审计，再在 P1 加 `已发送` 列表。

---

## 7. 动效

- 选区 toolbar：120ms opacity + translateY(2px)；出现即定位，不淡入等待。
- Composer：160–180ms scale(.985) + fade，`ease-standard`；exit 140ms。
- 三态切换：120ms 背景/下划线过渡；active 切换不弹跳。
- Margin card：首次出现 160ms fade；新增评论 180ms 高度展开；不做 stagger。
- Comments pill：数量变化 120ms 数字滚动/淡入；与 Send 合并 160ms 宽度过渡。
- 发送后：高亮从 pending 淡出 140ms 并移除，不留下残余矩形。
- `prefers-reduced-motion` 直达终态。

---

## 8. 落地切片

### P0（先解决“不舒服/不明显”，照 ADE）

1. 去掉“选中即自动打开表单”；选中/行 hover 只出现浮动 toolbar：`引用` / `批注`（streaming 时 `等待完成` 禁用）。
2. 重做 composer 为 **300px 小纸条**：引文摘要 + 人类可读位置 + 2 行自动增高 + 只有 `取消` / `批注`；`⌘↵` / `Esc`。
3. 三态高亮（pending 22% / held 9% / active 38%）+ 静态状态，去掉 1.6s 无限 pulse。
4. 右侧 ≥196px 时渲染 margin card；窄窗口退化为 popover。
5. 用 comments pill 替代 composer 上方 10–11px 的 `PendingAnnotations`：条数 + 列表 + `随下一条消息发送` + 编辑/删除。
6. 发送后把 pending 评论合并成结构化 review block；失败可恢复。

### P1（可浏览、可导航）

1. `已发送` 列表 / tray：按文件、时间回看；可选 `Open / Resolved / All`。
2. 编号 pin / cluster 仅用于图片/区域/表格；点击跳转锚点。
3. 状态从 `pending/responded` 扩展为 `pending/held/active/sent`；`annotation-store` 保存已发送记录（当前 `takeForSend` 会清空）。
4. 选区 toolbar 增加 `创建 issue`（若接入 issue 系统）。

### P2（线程化）

1. Thread/reply：Agent 回复挂在同一锚点下，而不是另起一条消息。
2. Resolve / reopen + resolved 历史（仅当出现审计需求）。
3. 可选 @mention / assignment（如果未来有多人协作）。

---

## 9. 验收指标

- 误触率：阅读时意外打开 composer 的次数 → 接近 0。
- 创建耗时：选中到出现 toolbar < 120ms；toolbar 到 composer < 1 次点击。
- 发现性：新用户能在 5s 内找到“如何批注”和“这条批注会不会发出去”。
- 发送可预期：composer 的 `批注` 与 `随下一条消息发送` 语义一致，不会出现“以为发了其实没发”。
- 可恢复性：composer 关闭后未保存文本按锚点保留；发送失败可恢复。
- 噪音：没有无限循环动画；文本评论不叠加编号圆点。
- 可访问性：键盘可创建/保存/取消/切换 pending；12px 最小字号；focus ring；`aria-label` 齐全。

---

## 10. 参考来源

1. **ADE（Agent Development Environment）** — <https://ade-app.dev/>；源码 <https://github.com/arul28/ADE>
   - `apps/desktop/src/renderer/components/chat/AssistantOutputSelectionToolbar.tsx`（Add to chat / Comment / Create issue）
   - `ThreadCommentLayer.tsx` / `ThreadCommentControls.tsx` / `threadCommentAnchors.ts` / `threadCommentsStore.ts`（三态高亮、margin card、comments pill）
   - `apps/desktop/src/shared/threadComments.ts`（`<ade-review>` 结构化块、quote/table/media 锚点）
   - `apps/desktop/src/main/services/chat/threadCommentService.ts`（pending 持久化、乐观更新）
2. Google Docs 评论帮助（官方）— <https://support.google.com/docs/answer/65129>
3. Zapier, *How to add, view, and print comments in Google Docs* — <https://zapier.com/blog/how-to-use-google-docs-comments/>
4. Figma, *Add comments to files* — <https://help.figma.com/hc/en-us/articles/360041068574-Add-comments-to-files>
5. Figma, *View and manage comments* — <https://help.figma.com/hc/en-us/articles/360041547593-View-and-manage-comments>
6. Figma, *Stay in the flow with redesigned comments* — <https://www.figma.com/blog/stay-in-the-flow-with-redesigned-comments/>
7. GitHub, *Commenting on a pull request* — <https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/commenting-on-a-pull-request>

### 本仓库

- `packages/desktop/src/renderer/mafw/components/EditorDock.tsx`
- `packages/desktop/src/renderer/mafw/components/AnnotationSheet.tsx`
- `packages/desktop/src/renderer/mafw/components/PendingAnnotations.tsx`
- `packages/desktop/src/renderer/mafw/annotation-store.ts`
- `packages/desktop/src/renderer/mafw/annotation-marks.ts`
- `packages/desktop/src/renderer/mafw/annotation-placement.ts`
- `packages/desktop/src/renderer/mafw/mafw.css`（`.mafw-annot-*` / `.mafw-pending-annotation*`）
