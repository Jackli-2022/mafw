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
   - **Google Docs**：选中 → 点“添加评论” → 右侧 margin 卡片；有评论历史面板（All / For you / Open / Resolved）、搜索、选中文本预览、resolve / reopen。
   - **Figma**：进入 comment mode（`C`）→ 点位置或框选区域 → pin/region；canvas 上是 pin，密集时变 cluster；右侧 sidebar 可搜索/排序/过滤；resolve / unread；composer 刻意做小。
   - **GitHub**：hover 行 → 蓝色评论图标；可拖选行范围；单条 comment 或 Start a review 批量提交；Resolve conversation 折叠；Conversations 菜单区分 unresolved / resolved / outdated。
5. 建议的 MAFW 交互：**“选中/落点 → 轻量‘批注’入口 → 紧凑 composer（带引文）→ 编号 pin + 右侧批注 tray → 状态/筛选/跳转 → resolve”**。不要继续用“选中即弹表单 + 小点 + 小列表”。

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

### 2.4 横向对照

| 能力 | Google Docs | Figma | GitHub | MAFW 现状 |
|---|---|---|---|---|
| 显式入口 | 工具栏 + 快捷键 | `C` + 工具栏 | hover 行图标 | ❌ 选中即弹 |
| 锚点形态 | margin card + 高亮 | pin / region / cluster | 行号 + 范围 | 小点/矩形 |
| 创建 composer | 右侧 margin | 小 modal | 行内 | 420px 浮卡 |
| 列表/侧栏 | 评论历史 | 右侧 sidebar | Conversations | ❌ 只有小 pending 列表 |
| 过滤/搜索 | All/Open/Resolved + 搜索 | 日期/未读/我的/当前页 | unresolved/resolved/outdated | ❌ |
| 批量 | — | — | Start a review | 仅隐藏的攒草稿 |
| 状态 | Open/Resolved | Unread/Resolved | unresolved/resolved/outdated | pending/responded |
| 跳转锚点 | 点击评论滚动 | 点击 pin 定位 | 点击 conversation | ❌ |
| 线程/回复 | 支持 | 支持 | 支持 | ❌ 一次性消息 |
| 视觉降噪 | 折叠成气泡图标 | cluster | 折叠 resolved | 无限 pulse |

---

## 3. 交互原则

1. **两步创建**：选择/落点只产生“可批注”状态，出现一个轻量入口；用户再点“批注”才打开 composer。选择是阅读，不是提交。
2. **上下文先于输入**：composer 顶部必须显示被选中的 1–3 行引文或区域缩略图 + 人类可读位置（`desktop.md · L42–48`），而不是 mono 调试串。
3. **锚点要能看见、能数、能跳**：编号 pin / 高亮 / margin card；同一区域聚合，不让小点堆叠。
4. **状态要诚实**：Draft（本地）/ Sent（等待 Agent）/ Answered（Agent 已回复）/ Resolved（已解决）。用静态颜色 + 文案，不用无限脉冲。
5. **批量是显式流程**：待发送 tray 显示数量，逐条可编辑/删除，最后一次发送；不要靠隐藏快捷键。
6. **一个家**：右侧/底部有批注 tray 或 margin rail，支持 All / Open / Resolved、搜索、跳转。
7. **视觉克制**：一个 accent、6/10/14 半径、浮层用 `elev-panel`；不要把 composer 做成大对话框；12px 最小字号。
8. **键盘可完成**：`C` / `Ctrl+M` 新建，`⌘↵` 发送，`Esc` 取消，`J/K` 或上下键在批注间移动（可选）。

---

## 4. 建议的 MAFW 交互

### 4.1 创建

1. 在编辑器/预览中选中文本，或 hover 行/区域：
   - 选区旁出现一个小浮钮：`＋ 批注`（图标 + 文字，120ms 淡入，不自动打开 composer）。
   - 行 hover 时行号旁出现同样的图标（GitHub 模式）。
   - `C` / `Ctrl+M` 在当前光标/选区打开。
2. 点击后出现 **紧凑 composer**：
   - 宽 360–400px，12px 圆角，`elev-panel`，不遮住选区（优先下方/上方，翻边逻辑保留）。
   - 顶部：`引用 2 行`（引文块，最多 2–3 行，超出省略，可展开）+ 文件/行号（12px，非 mono）。
   - 输入：单行自动增高（1–4 行），placeholder「要改什么？」
   - 底部：左侧 `⌘↵ 发送` 轻提示（仅 focus 时显示），右侧图标按钮：`加入待发送`、`发送`、`关闭`；Esc 取消。
   - 不在 composer 里放三行操作说明；快捷键放 tooltip。

### 4.2 发送后

- 立即生成编号 pin（1、2、3…）或 margin card；文本高亮保留，状态 `等待 Agent`（amber dot）。
- Agent 回合结束 → `已回复`（success dot），不自动 resolved。
- 用户点 pin / tray 项 → 滚动到锚点并短暂高亮；tray 里可 `Resolve` / `Reopen`。
- Resolved 的 pin 变灰/折叠，保留在 `Resolved` 过滤里。

### 4.3 批注 tray

- 放在编辑器右侧（窄屏时作为底部抽屉）或右 dock 的「批注」tab：
  - 顶部：`批注 6` + 过滤 `Open / Resolved / All` + 搜索。
  - 行：编号 pin + 引文 2 行 + 文件/行号 + 状态点 + 时间；hover 出现 `跳转 / Resolve / 删除`。
  - 点击行滚动到锚点；当前选中行高亮。
- 没有 tray 时，至少有一个常驻计数 badge（编辑器标题栏/右 dock tab），不要让用户猜。

### 4.4 批量

- 保留 `加入待发送`，但把它变成 tray 里的 `待发送 3` 区域：
  - 每条可编辑/删除；
  - `全部发送` 一次提交；
  - 发送前可展开预览最终 prompt 的摘要。
- 这对应 GitHub 的 `Start a review`，但用更轻的 tray 表达。

---

## 5. 三个方向

| 方向 | 适合 | 关键 | 风险 |
|---|---|---|---|
| **A. Margin Rail（推荐）** | 文档/预览/表格 | 右侧 margin card 与锚点对齐；评论历史；滚动同步 | 窄窗口需要折叠成 tray |
| **B. Pin + Tray（推荐）** | diff/图片/office/画布 | 编号 pin、区域框、cluster、右侧 tray | 文本编辑器里 pin 不如 margin 自然 |
| **C. Quiet Inline** | 快速阅读批注 | 极轻浮钮 + 小 composer，评论只做小标记 | 发现性和全局浏览弱 |

建议 **A + B 混合**：

- 文本/markdown/PDF：margin rail + 编号高亮；
- 图片/表格/JSON/PPTX/diff：pin/region + 右侧 tray；
- 两种都落到同一个 `AnnotationTray` 数据源。

---

## 6. 视觉规格

### Pin / highlight

- Pin：18px 圆形，accent 填充，白色 10px 数字；未解决 2px 外环；resolved 用 `text-4`。
- 文本高亮：accent 10–14% 背景 + 2px 底部 accent；hover 提到 18%；resolved 灰。
- 同一行多个 pin：横向错开 4px；超过 3 个折叠成 `+N` cluster。

### Composer

- 宽 360–400px；padding 12px；radius 12px；`bg-overlay` + `border-strong` + `elev-panel`。
- 引文块：`bg-inset`、6px 圆角、2 行、12px、`text-2`；点击展开。
- 输入 13px；按钮 28px；图标用已注册 SVG，不用 `✕` 文本字形。
- 阴影比当前 `0 18px 44px rgba(0,0,0,.38)` 更轻：`elev-panel` 即可。

### Tray

- 宽 300–340px；行高 52–60px；标题 2 行，meta 11px；状态点 6px。
- 顶部 32px 过滤行；计数 badge 用 accent-soft，不用实心大红。
- Resolved 行降为 `text-3`，不删除；可 reopen。

### 状态

| 状态 | 视觉 |
|---|---|
| Draft | accent dot + `待发送` |
| Sent / waiting | amber dot + `等待 Agent` |
| Answered | success dot + `已回复` |
| Resolved | text-4 dot + `已解决`，折叠 |

不再用无限 pulse；只在 pin 首次出现时 180ms scale-in。

---

## 7. 动效

- 选区浮钮：120ms opacity + translateY(2px)。
- Composer：180ms scale(.98) + fade，`ease-surface`；exit 140ms。
- Pin：180ms scale(.8)→1；不循环。
- Tray：240ms 滑入；行 stagger 20ms（首次打开）。
- Resolve：140ms 折叠/变灰。
- `prefers-reduced-motion` 直达终态。

---

## 8. 落地切片

### P0（先解决“不舒服/不明显”）

1. 去掉“选中即自动打开表单”；改为选区/行 hover 的 `＋ 批注` 浮钮 + `C`/`Ctrl+M`。
2. 重做 composer：引文块 + 人类可读位置 + 单行自动增高 + 图标按钮 + 轻阴影。
3. 去掉 1.6s 无限 pulse；pin/highlight 做静态状态 + 首次 180ms 出现。
4. `PendingAnnotations` 从 10px 小列表升级为可见的 `待发送 N` tray（至少底部抽屉），字号 ≥12px，`✕` 换 SVG icon。
5. 明确 Draft/Sent/Answered 文案，发送后 pin 变 `等待 Agent`。

### P1（可浏览、可导航）

1. `AnnotationTray`（编辑器右侧 / 右 dock tab）：Open / Resolved / All + 搜索 + 跳转。
2. 编号 pin / highlight / cluster；点击 tray 行滚动到锚点。
3. 批量发送：tray 内编辑/删除/全部发送。
4. 状态从 `pending/responded` 扩展为 `draft/sent/answered/resolved`；`annotation-store` 需要保存已发送记录（当前 `takeForSend` 会清空）。

### P2（线程化）

1. Thread/reply：Agent 回复挂在同一锚点下，而不是另起一条消息。
2. Resolve / reopen + resolved 历史。
3. 可选 @mention / assignment（如果未来有多人协作）。

---

## 9. 验收指标

- 误触率：阅读时意外打开 composer 的次数 → 接近 0。
- 创建耗时：选中到发送 < 3s（不含输入）。
- 发现性：新用户能在 5s 内找到“如何批注”和“我的批注在哪”。
- 可恢复性：发送后 100% 能在 tray 里找到对应记录。
- 噪音：没有无限循环动画；同一屏 pin 数量超过 3 时自动 cluster。
- 可访问性：键盘可创建/发送/取消/跳转；12px 最小字号；focus ring。

---

## 10. 参考来源

1. Google Docs 评论帮助（官方）— <https://support.google.com/docs/answer/65129>
2. Zapier, *How to add, view, and print comments in Google Docs* — <https://zapier.com/blog/how-to-use-google-docs-comments/>
3. Figma, *Add comments to files* — <https://help.figma.com/hc/en-us/articles/360041068574-Add-comments-to-files>
4. Figma, *View and manage comments* — <https://help.figma.com/hc/en-us/articles/360041547593-View-and-manage-comments>
5. Figma, *Stay in the flow with redesigned comments* — <https://www.figma.com/blog/stay-in-the-flow-with-redesigned-comments/>
6. GitHub, *Commenting on a pull request* — <https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/commenting-on-a-pull-request>

### 本仓库

- `packages/desktop/src/renderer/mafw/components/EditorDock.tsx`
- `packages/desktop/src/renderer/mafw/components/AnnotationSheet.tsx`
- `packages/desktop/src/renderer/mafw/components/PendingAnnotations.tsx`
- `packages/desktop/src/renderer/mafw/annotation-store.ts`
- `packages/desktop/src/renderer/mafw/annotation-marks.ts`
- `packages/desktop/src/renderer/mafw/annotation-placement.ts`
- `packages/desktop/src/renderer/mafw/mafw.css`（`.mafw-annot-*` / `.mafw-pending-annotation*`）
