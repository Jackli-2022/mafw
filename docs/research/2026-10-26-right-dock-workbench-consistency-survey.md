# 右 dock「文件 / 编辑器 / 浏览器」一致性与业界面板调研

日期：2026-10-26
背景：右 dock 已有 11 个 tab，其中「工作台四件套」（files / editor / browser / terminal）各自生长，用户观感「有点割裂」。本文盘点现状实现与样式、对照业界面板规范，回答：**割裂具体割在哪、业界靠什么机制维持一致性、有哪些收敛方向**。只调研不决策。

## 一、现状盘点（代码级）

### 1.1 面板骨架：没有契约

唯一的共享 chrome 是 `RightDock.tsx`（52 行）：pill tab 条 + 关闭钮 + 滚动 body。**不存在任何共享的面板头 / 空态 / 错误态组件**——四个 tab 各自为政：

| 维度 | 文件 FilesDock | 编辑器 EditorDock | 浏览器 BrowserDock | 终端 TerminalDock（参照） |
|---|---|---|---|---|
| 面板头 | **无** | 文件 tab 条 + 文字按钮（保存/外部编辑器/改动），`border-bottom` | **两根堆叠条**：导航条（← → ⟳ 地址栏 ↗）+ 状态条，双 `border-bottom` | **无**（live 时右上浮动按钮） |
| 头部 padding | — | `4px 6px` | `4px 6px` + `2px 8px` | —（dock 头是 `7px 10px`） |
| 空态 | 居中灰字「没有打开的会话 / 目录为空」 | **借用 files 的 `.mafw-file-tree-empty` 类**，文案不同 | **没有空态**——`about:blank` 白页，`background:#fff` 硬编码不吃主题 | 居中**浮层卡片**（边框/圆角/阴影/LoaderV2/动作按钮），四者中最完整 |
| 加载态 | 10px 灰字「加载中…」 | 无 | 状态条文字「加载中…」 | LoaderV2 旋转 |
| 错误态 | **仅 toast**（转瞬即逝） | **仅 toast** | 常驻内联错误条（`--red-9`） | 常驻 banner 卡片 + 恢复动作 |
| 背景机制 | 继承 dock `--bg-base` | 继承 | webview 强制 `#fff` | 整面板覆盖 `--bg-inset` |
| 图标语言 | `📄 ▾ ▸` | 无图标（纯文字按钮，无 tooltip） | `← → ⟳ ↗` 字形按钮（有 tooltip） | 文字按钮 |

ChangesDock（第五种风格）：标题行「改动」+ 统计，`padding: 2px 0 6px`，无 border——**同一个 dock 里存在五种面板头范式**。

### 1.2 视觉接缝问题

- dock 头 `.mafw-right-dock-head` **没有 border-bottom** → tab 条与内容之间的分隔线由各 tab 自己画：editor/browser 画了，files/terminal 没画——同一个位置时有时无的横线。
- 字号漂移：文件名 12px / editor tab 11px / browser 状态 10px / editor 冲突条 10px / 终端 banner 12px。
- editor 的 active 文件 tab 背景 = hover 背景（`.mafw-editor-tab:hover` 与 `-active` 同为 `--bg-overlay`），唯一激活信号是文字颜色 `--text-2 → --text-1`，远弱于 dock pill 条的 `--accent-dim`。

### 1.3 Tab 条本身

`RightDock.tsx` L28–38：11 个 emoji+文字 pill，`flex-wrap: wrap`——320px 宽 dock 下折成两行+，吃掉垂直空间。emoji 有重复（`📝` 同时用于便签和编辑器）；浏览器 tab 文案是「浏览」。

### 1.4 挂载与尺寸

- **全部 11 个 tab 常挂载**（MafwShell 用 `display:contents/none` 切换）——BrowserDock 挂载即建 `<webview>`，哪怕用户从未打开过浏览器 tab。
- 宽度全局单值（`mafw-right-dock-width`），`WORKBENCH_TABS`（files/editor/browser/terminal）共享 50% 上限策略；但 `applyRightDock` 只对 files/editor 调 `suggestDockWidth` 自动加宽到 560——**browser/terminal 有宽上限却从不自动加宽**（不对称）。
- 死代码：`.mafw-right-dock-resizer` CSS 无消费者；`.mafw-right-dock-close` 类无规则。
- files 双重滚动：`.mafw-right-dock-body` 与 `.mafw-file-tree` 都是 `overflow:auto`。

### 1.5 割裂感清单（按观感影响排序）

1. **空态四种长相**：灰字 / 借来的类 / 白屏 / 精致卡片——同一个 dock 里像是四个人写的。
2. **面板头五种范式**（含 ChangesDock）：无 / tab 条 / 双条 / 浮动钮 / 标题行；分隔线时有时无。
3. **错误三种出口**：toast（丢）/ 内联条 / banner 卡片——同类故障三种命运。
4. **图标三种语言**：emoji / 字形 / 纯文字，emoji 还有重复。
5. **11 个 pill 折两行**：超出任何业界的容器内视图数舒适区。
6. browser 空白白页不吃主题，与深色 dock 并置突兀。
7. 自动加宽不对称、死 CSS、双滚动等结构性毛边。

## 二、业界做法

| 产品 | 面板模型 | 关键机制 |
|---|---|---|
| **VS Code** | View = **标准化头部（标题 + 右对齐 View Toolbar）+ 内容**；容器（Sidebar/Panel/Secondary Sidebar）只负责摆位 | 头部动作溢出进 `...` More Actions 菜单；空态用 **Welcome view**（链接优先、至多一个主按钮、给起步指引）；进度可按 view ID 呈现；**图标用 product icon，明令禁止 emoji**；每个图标按钮必须 tooltip。视图可拖进任意容器仍保持一致——因为 chrome 是 per-view 契约而非 per-container 手笔 |
| **JetBrains** | Tool window = **header + content pane，永远如此** | 头部含 ⚙ options 菜单 / 视图切换 tab 或下拉 / 相关动作 / 隐藏钮，右键头部=同一组选项；头部图标默认 hover/聚焦才显示（省空间）；**空态是成文规范**（有正确/错误示例图）；名称 ≤2 词、常用缩写；**反馈用图标 badge，绝不改图标本体**；竖窗放树、横窗放宽内容（终端/日志）；可选「记住每个 tool window 的宽度」 |
| **Zed** | 面板可 toggle、可换边；agent 面板固定右侧 | 并行 agent（v0.233.5）**放弃了 tab 条方案**，改为新侧栏设计；社区 tab-bar PR 的经验被吸收：**控件非聚焦时自动隐藏**、tab 标题 20 字截断 + tooltip 全文；用户诉求=终端与 agent 面板同屏可见（分屏） |
| **Cursor** | VS Code 基座 + 右侧 chat | 反面教材集中地：后台 agent 开的终端找不到（只能重启编辑器杀）、开关/快捷键 affordance 不一致被用户追着骂 |
| **Windsurf** | 右侧面板群 = AI chat / agent 控制 / 上下文管理，占显著屏幕比例 | 布局哲学：AI 是一等公民而非可选侧栏 |

## 三、业界维持一致性的机制（收敛规律）

1. **面板 chrome 是契约不是选择**。VS Code 几十个视图长得一致、JetBrains 几十个 tool window 长得一致，靠的不是设计师手勤，而是「header（标题+右对齐动作）+ 内容 + 标准化空/载/错态」的**强制骨架**。我们的四个 tab 恰恰是四种自由发挥。
2. **空态是一等公民**：VS Code Welcome view / JetBrains empty state 都有专门规范——空面板要给「怎么开始」的指引。空白白页是最差解。
3. **错误要常驻、要带恢复动作**：jetbrains badge/通知、VS Code 面板内常驻提示；toast-only 意味着「看漏了就永远不知道」。
4. **一套图标 + 强制 tooltip，禁 emoji**（VS Code 明文）。图标是面板间最强的「同族」信号。
5. **单容器视图数 3-5 个是舒适区**（VS Code 明文）。超出就该分组（图标轨/侧栏/分段），Zed 甚至为并行线程放弃了 tab 条。
6. **方向感**：树竖放、宽内容横放（JetBrains）——browser/terminal 本质是「宽内容」。

## 四、差距对照

| 业界规律 | 我们现状 | 差距 |
|---|---|---|
| 面板骨架契约 | 无共享 DockPanel 原语，五种头部范式 | 最大结构性缺口 |
| 空态规范 | 四种长相，browser 为白屏 | 直接割裂感来源 #1 |
| 错误常驻+恢复 | files/editor 仅 toast | 割裂感 #3 |
| 图标系统+tooltip | emoji/字形/文字混用、有重复 | 割裂感 #4 |
| 3-5 视图/容器 | 11 pill 折两行 | 割裂感 #5 |
| 宽内容横放 / 尺寸一致 | browser/terminal 不自动加宽、死 resizer | 毛边 |

## 五、候选收敛方向（供后续 brainstorm，不在本文决策）

- **A. 统一面板骨架（不动结构）**：抽 `DockPanelHeader`（标题+动作、统一 padding/border）+ `DockEmpty`/`DockBanner`（terminal 卡片泛化）+ 内联错误规范 + 图标集；11 tab 保持。改动最小，治 #1-#4。
- **B. 工作台分组**：把 dock 分成「会话数据」组（任务/轨迹/用量/便签/改动/子代理/后台）与「工作台」组（文件/编辑器/浏览器/终端），工作台组有自己的子结构或独立 strip。治 #5，改动中等。
- **C. 工作台单面多 tab**：editor/browser/terminal 合成一个「工作台」面板，内部自持 tab 条（文件 tab + 浏览 tab + 终端 tab 同居一个可加宽的宽面板，参考 Zed「终端与 agent 面板同屏」诉求的镜像解）。改动最大，但「宽内容」获得真正需要的宽度。
- 任一方向都应顺带处理：browser 主题化空态、挂载策略（lazy browser webview）、自动加宽对称化、死 CSS 清理、双滚动收敛。

## 来源

- VS Code UX Guidelines — Sidebars / Panel / Views / Overview：<https://code.visualstudio.com/api/ux-guidelines/sidebars> 等
- IntelliJ Platform Plugin SDK — Tool Window / Icon Button：<https://plugins.jetbrains.com/docs/intellij/tool-window.html>
- IntelliJ IDEA Help — Tool windows / New UI：<https://www.jetbrains.com/help/idea/tool-windows.html>
- Zed 并行 agent 发布（v0.233.5 弃 tab 条改侧栏）与讨论 #42381 / issue #43229
- Cursor UI 投诉：<https://tanvibhakta.mataroa.blog/blog/issues-with-the-cursor-ui/>
- 本仓库代码：`RightDock.tsx` / `FilesDock.tsx` / `EditorDock.tsx` / `BrowserDock.tsx` / `TerminalDock.tsx` / `ChangesDock.tsx` / `dock-width.ts` / `mafw.css`（行号见 §1）
