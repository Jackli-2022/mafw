# Desktop 右键菜单：现状梳理与业界对标（2026-10-28）

> 目的：为「Desktop 右键菜单重构」提供事实底稿——先盘清我们自己在哪些区域有/没有菜单、每张菜单长什么样，再对照 Claude Code Desktop / Codex app / Kimi Code Desktop / dsh / opencode 的同区域做法，最后给出重构切口。
> 方法：本地代码逐文件实读（`packages/desktop/src`，2026-10-28 工作区）；业界侧优先源码/测试快照，其次官方文档，最后公开 issue/changelog。证据等级在每个结论后标注。
> 关联：`2026-09-14-desktop-interaction-survey.md`（早期菜单盘点）、`2026-10-27-left-rail-visual-polish-research.md`（rail 右键两项的来源）、`2026-10-26-six-way-frontend-gap-resurvey.md`（六方功能面）。

## 0. 结论先行

1. **我们只有 5 个业务区域有自定义右键菜单**（rail ＋、左 dock 会话行、顶部页签、Dashboard/Memory/Approvals/Triage/Automations 卡片），**9 个高频编辑区域一个都没有**（聊天消息、代码块、聊天内文件路径、文件树、编辑器 tab、diff、终端、浏览器、执行/审阅面板）。
2. 现有菜单是**两套实现、五处手写数组**：`MafwContextMenu`（label/danger/separator 三字段）与直接使用 `@mafw/ui/context-menu`（IconRail / LeftDock / SessionStrip），没有共享 spec、没有图标/快捷键/子菜单/分组/复选。
3. 已有可验证缺陷：`danger` 字段**只写属性不写样式**（危险项与普通项视觉相同）；Automations 菜单**重复 Disable**；Approvals 菜单标签是乱码 `? Approve`；Triage 菜单**缺**页面上已有的 confirm/propose；同一产品内**中英混排**；LeftDock 的 `⋯` 按钮靠 `dispatchEvent(new MouseEvent("contextmenu"))` 伪造右键。
4. 业界收敛出四条硬规则：**菜单是「光标下对象的动词表」**（不是第二套工具栏）；**右键与 ⋯ 必须同一张表**（dsh 直接把两者实现为同一个有序 slot list）；**输入框/选区保留系统原生菜单**（opencode 在重命名态显式回退原生，Codex 刚补的也只是右键复制）；**路径/文件对象固定四件套**——附加为上下文 / 用…打开 / 在文件夹中显示 / 复制路径（Claude 官方文档逐项列出）。
5. 重构的正确切口不是「给每个区域补一张菜单」，而是**先抽一个可测试的菜单 spec + 一个渲染器**，把现有 5 张表迁进去并修缺陷，再按区域补缺。否则会得到 20 张风格各异的菜单。

## 1. 我们的现状（代码实读）

### 1.1 全区域清单

| # | 区域 | 触发方式 | 现有项 | 代码 | 备注 / 问题 |
|---|---|---|---|---|---|
| 1 | 左 rail `＋` | 右键 | 新建会话 / ⎇ 并行 worktree | `components/IconRail.tsx:77-103` | worktree 能力门已接；菜单只有 2 项 |
| 2 | 左 rail 其余 6 钮（工作/搜索/便签/Dashboard/Config） | 无 | — | `components/IconRail.tsx:44-50` | 无「隐藏/移动/快捷键」类菜单（VS Code activity bar 有） |
| 3 | 左 dock 会话行 | 右键 + `⋯` | Open / Rename / Delete / Copy session ID | `components/LeftDock.tsx:236-273` | 英文；Delete 无危险色；无 pin/archive/fork/export；`⋯` 伪造 contextmenu 事件 |
| 4 | 左 dock 项目行 | 左键 switcher（非右键） | 项目列表 / 打开项目文件夹 / Copy project ID | `components/LeftDock.tsx:276+` | 项目行右键无菜单；无「新会话 / 在文件管理器显示 / 编辑 / 隐藏」 |
| 5 | 顶部会话页签 | 右键 | Close / 导出 Markdown… / Copy session ID | `components/SessionStrip.tsx:95-140` | 中英混排；无 Rename（只能双击）、无 Close others/right、无 Pin；溢出菜单（`⋯`）是另一套 session 列表，不是动作菜单 |
| 6 | 聊天消息 | 无 | 全局 `electron-context-menu`（文本复制/保存图片/检查元素） | `main/index.ts:110` | 无「引用 / 编辑重发 / 复制为 Markdown / 从此处分叉」 |
| 7 | 代码块 | 无 | 同上 | `components/*` / `session-ui` | 无「复制代码 / 在编辑器中打开」 |
| 8 | 聊天内文件路径 | 无 | — | `@mafw/session-ui` | 无「附加为上下文 / 用…打开 / 在文件夹中显示 / 复制路径」 |
| 9 | 工作台文件树行 | 无 | — | `components/FilesDock.tsx:121` | 只有单击打开；无右键动作 |
| 10 | 编辑器 / 预览 tab | 无 | 行尾 `✕` 关闭 | `components/EditorDock.tsx:890-903` | 无「关闭其他 / 关闭右侧 / 复制路径 / 在文件夹中显示」 |
| 11 | 编辑区 / 预览内容 | 系统原生 | `electron-context-menu` | — | 与批注、引用、选区动作无交集（批注走划选浮层） |
| 12 | diff 视图 | 无（行内按钮） | 加入批注 / 立即发送（per-hunk） | `components/EditorDock.tsx` / `DiffReviewPanel` | 无「复制 diff / 撤销此 hunk」 |
| 13 | 内置终端 | 无 | — | `components/TerminalDock.tsx` | 无复制/粘贴/清屏/在外部终端打开 |
| 14 | 浏览器 webview | 平台默认 | — | `components/BrowserDock.tsx` | 无「复制链接 / 新标签打开 / 点选元素」 |
| 15 | 执行/审阅面板行（任务/轨迹/子代理/后台） | 无 | — | `components/dock-panel.tsx` 及各 panel | 无「打开会话 / 复制 ID / 终止」 |
| 16 | Goal 卡（Dashboard） | 右键 | View Details / Pause｜Resume / Cancel | `pages/Dashboard.tsx:36-45` | 英文；无「在时间线打开 / 复制 goal ID」 |
| 17 | Goal 泳道格 | 无（点击展开） | 重跑按钮在展开区 | `components/GoalTimelineLane.tsx` | 无右键；无「复制产物路径」 |
| 18 | Memory 行 | 右键 | Copy Abstraction / Copy Full Text / Delete | `pages/Memory.tsx:139-146` | 无 pin/sticky/编辑 |
| 19 | Approvals 行 | 右键 | `? Approve` / `? Reject` / Copy Question | `pages/ApprovalsPage.tsx:82-89` | 标签乱码；无「记此前缀 / 记此工具」（页面上有规则能力） |
| 20 | Triage 行 | 右键 | View Goal / Dismiss | `pages/TriagePage.tsx:55-58` | 缺 confirm / propose-confirm / propose-reject（页面上有按钮） |
| 21 | Automations 行 | 右键 | Enable｜Disable + Disable（危险） | `pages/Automations.tsx:120-124` | 重复项；无「立即运行 / 复制规则 / 删除」 |
| 22 | 托盘 | 右键 | 状态行 / Open MAFW / Close to tray / Quit | `main/tray.ts:40+` | 基本可用；无「最近会话」 |
| 23 | 原生应用菜单 | 菜单栏（仅 macOS） | 标准 File/Edit/View/Window/Help | `main/menu.ts` + `types/desktop-menu.ts` | Windows `autoHideMenuBar: true`，无应用菜单入口 |

### 1.2 现有基础设施

- `components/MafwContextMenu.tsx`：类型只有 `{ label, disabled?, danger?, separator?, onSelect? }`；渲染 `ContextMenu.Item + ItemLabel`；`data-danger` 写在 DOM 上但**没有任何 CSS 命中**（全仓 grep 仅此一处）。
- 直接使用 `@mafw/ui/context-menu` 的三处：IconRail、LeftDock、SessionStrip——它们能用到 Kobalte 的 Sub/Checkbox/Radio/GroupLabel，但实际只用了 Item。
- `@mafw/ui/context-menu` 本身能力完整（Kobalte 包装：Sub / CheckboxItem / RadioItem / GroupLabel / Arrow / Separator），**缺的是我们的上层模型**。
- 全局兜底：`electron-context-menu`（`showSaveImageAs: true`），英文默认标签，无 i18n，覆盖所有窗口（含 webview 场景待验证）。

### 1.3 缺陷清单（可直接进 issue）

| 级别 | 缺陷 | 证据 |
|---|---|---|
| P0 | 危险项无视觉区分 | `MafwContextMenu.tsx:32` 写 `data-danger`，CSS 零命中 |
| P0 | Automations 菜单重复 Disable | `Automations.tsx:121` 与 `:123` |
| P0 | Approvals 菜单标签乱码 | `ApprovalsPage.tsx:83-84` 源文件即 `? Approve` |
| P1 | Triage 菜单与页面动作不一致 | 菜单只有 View/Dismiss，页面有 确认/建议确认/建议拒绝 |
| P1 | 同一产品中英混排 | LeftDock/SessionStrip/Dashboard 英文，rail/pages 中文 |
| P1 | `⋯` 伪造右键事件 | `LeftDock.tsx:254` `dispatchEvent(new MouseEvent("contextmenu"))` |
| P1 | 无键盘打开路径 | 未见 Shift+F10 / ContextMenu 键处理；Kobalte 默认行为未验证 |
| P2 | 无图标 / 快捷键 / 子菜单 / 分组 / 复选 | `MafwContextMenu` 类型面 |
| P2 | 菜单不可插件扩展 | 五处手写数组，与 dsh/opencode 的 slot/plugin 模型相反 |

## 2. 业界对标

### 2.1 opencode（源码实证，dev @ 2026-10-28）

| 区域 | 菜单项 | 证据 |
|---|---|---|
| 项目行（右键 + `⋯`） | New session / Import session / Edit project / Reveal in Finder｜Explorer / Clear notifications（无未读时 disabled）/ — / Close（隐藏项目） | `packages/app/src/home/projects/view.tsx:591-665` |
| 会话行（右键） | Rename / Export… / — / Delete… | `home/sessions/view.tsx:610, 806-813` |
| 会话标题 `⋯` | Rename / Export… / — / Delete… | `session/timeline/message-timeline.tsx:634-671` |
| 会话页签 | **无右键菜单**；另有「最近关闭的 tab」下拉（带搜索） | `shell/titlebar/tab-strip.tsx`、`recently-closed-tabs-menu.tsx` |
| 消息 | **无右键菜单**；公开 issue #12208 记录「右键 prompt 弹出的是内嵌浏览器菜单」，用户请求「编辑并重发」 | GitHub issue #12208 |
| 服务器行 | Edit / Hide｜Show / — / Remove | `servers/registry/row-menu.tsx` |

值得抄的两个细节：
- **重命名态显式回退系统菜单**：`if (editor()) return`，注释写明「保留原生菜单以便粘贴与拼写检查」。
- **菜单与行内 `⋯` 共用同一份 items**，不维护两套。

### 2.2 dsh（源码测试快照实证，master @ 2026-10-28）

| 区域 | 菜单项 | 证据 |
|---|---|---|
| 会话行（右键 + `⋯`） | Pin session / Rename / Fork session / Archive session / Copy Session ID | `apps/web/tests/expected/menu-material/session-menu.expected.md` |
| 会话页签 | Close | `.../shortcuts-panels/tab-menu.expected.md` |
| 新建终端 | bash / sh | `.../sidebar-terminal/shell-menu.expected.md` |
| 合并确认 | 压缩合并 / 合并提交 / 变基合并 / — / 确认合并 | `.../forge-panel/merge-menu.expected.md` |
| 未登录原生菜单 | 关于 / 检查更新 / 登录（zh-CN 快照） | `apps/desktop/tests/expected/application-menu-zh-CN.json` |

架构层最值得抄：**「Session row actions as slot lists」**（`.agents/notes/.../2026-09-17-session-row-menu-actions-slot.md`）——
- 菜单项和 hover 按钮是**同一个有序 slot list**（`sidebar.workspaces.session.menu.item` / `.row.action`），插件可插入、可覆盖、可排序；
- 没有「官方组 / 扩展组」之分，分隔线由条目自己的 `separatorBefore` 决定；
- 条目只拿到 `{ sessionId, displayTitle }`，可见性由条目自己决定（pin 在 archived 行不渲染）。

### 2.3 Claude Code Desktop（官方文档实证）

| 区域 | 菜单项 | 证据 |
|---|---|---|
| 聊天 / diff / 文件面板里的**文件路径**（右键） | Attach as context / Open in ▸（VS Code / Cursor / Zed）/ Show in Finder｜Explorer / Copy ▸（Absolute path / Relative path / Filename） | `code.claude.com/docs/en/desktop`「Open files in other apps」 |
| 聊天里的**文件夹**（右键） | Open in terminal | 同上「Run commands in the terminal」 |
| 侧栏**会话行**（右键） | Open in ▸（Split view / New window） | 同上「Work in parallel with sessions」 |
| 会话标题旁 caret | Transcript view（Normal / Thinking / Verbose）/ Open in / Archive | 同上「Switch view modes」「Continue in another surface」 |
| 会话行 hover 菜单 | Archive | 同上「Archive a session」 |
| 面板溢出 | 标题栏 `⋮` 收纳放不下的 pane 按钮 | 同上「Arrange your workspace」 |

这是目前看到的最完整的「对象动词表」范例：**路径 = 附加/打开/定位/复制**，且「复制」用子菜单收三种粒度。

### 2.4 Kimi Code Desktop（官方 changelog / 文档实证）

| 区域 | 菜单项 | 证据 |
|---|---|---|
| 会话中的**文件名**（右键） | 复制路径 / 在文件夹中显示 | 官方 changelog 1.0.3（2026-09-23） |
| 会话标题「更多」 | 会话操作（含 `/reload`） | 官方「界面导览」顶部栏 |
| 顶栏「外部应用」 | VS Code / Cursor / Zed / Xcode / 系统终端 / Finder｜资源管理器 / 复制当前路径 | 同上 |
| 右侧面板标签 | 切换 / 关闭 / `+` 新建（改动/浏览器/终端/侧边聊天） | 同上 |
| 消息 | 无右键菜单；划词 → 评论/引用 | changelog 划词标注条目 |

倾向：Kimi 把「动作」放在**顶栏菜单 + 划词浮层**，右键只承担文件对象的两件事（复制路径/定位）。

### 2.5 Codex app（公开 issue / changelog）

- changelog `#46895`：**「Add right-click copying for transcript and composer selections」**——右键复制是刚补的能力。
- issue `#31281`（macOS）：选中聊天文本右键，看到的是系统原生菜单（Look Up 等），即 Codex 没有自绘消息菜单。
- 桌面端另有原生菜单栏 File / Edit / View / Window / Help（Reddit 实测帖）。

结论：Codex 走的是「**原生文本菜单 + 菜单栏 + 面板内 `⋯`**」路线，右键不承载业务动词。

### 2.6 横向对照（右键维度）

| 区域 | Claude | opencode | dsh | Kimi | Codex | 我们 |
|---|---|---|---|---|---|---|
| 会话行 | 有（Open in ▸） | 有（Rename/Export/Delete） | 有（Pin/Rename/Fork/Archive/Copy ID） | 菜单（非右键） | 无证据 | 有（Open/Rename/Delete/Copy ID） |
| 项目行 | — | 有（6 项） | — | 拖入添加 | — | 无 |
| 页签 | — | 无 | 有（Close） | 面板标签有 | — | 有（3 项） |
| 消息 | 无（选区原生） | 无（已知缺口） | 无 | 无（划词） | 原生 | 无（原生） |
| 文件路径 | **有（4 组）** | — | — | **有（2 项）** | 无 | **无** |
| 文件树 | — | 无 | — | — | — | **无** |
| 编辑器 tab | — | — | — | — | — | **无** |
| 终端 | 文件夹右键 → Open in terminal | 无 | 新建 shell 选择 | 终端标签 | 无 | **无** |
| 危险项区分 | Archive 需确认 | Delete…（省略号） | Archive | — | — | 仅字段，无样式 |

## 3. 收敛出的设计规则

1. **对象动词表**：菜单只回答「我现在右键的这个东西能做什么」。会话行、项目行、文件路径、文件夹、页签各自一张表；不为「空白区域」造大而全菜单。
2. **一表两入口**：右键与行内 `⋯` 必须渲染同一份 items（dsh 的 slot list、opencode 的同一 `Menu.Content`）。我们目前 LeftDock 靠伪造事件、SessionStrip 的 `⋯` 是另一套列表，都要收。
3. **原生文本菜单不可夺**：输入框、重命名态、消息选区保持系统菜单；自绘菜单只挂在**容器/对象**上。opencode 的 `if (editor()) return` 是明写的先例。
4. **危险项最后、分隔、可辨识**：删除/归档/终止放末尾，前面加分隔线，视觉用 danger 色；会弹确认框的动作加省略号（`Delete…`）。
5. **路径/文件对象四件套**：附加为上下文、用…打开、在文件夹中显示、复制路径（子菜单给绝对/相对/文件名）。这是 Claude 与 Kimi 的交集，也是我们缺得最狠的一块。
6. **深度 ≤ 2、条目 ≤ 9**：子菜单只用于「打开方式」「复制为」这类同族动作。
7. **菜单是快捷键的发现面**：能配快捷键的动作在菜单右侧显示 accelerator（dsh/opencode 都这么做）。
8. **可扩展**：菜单项来自注册表（surface + target → items），不是每个页面手写数组；为将来的插件/命令面板复用留口。

## 4. 重构方向（建议）

### 4.1 分层

```
context-menu/
  types.ts        MenuItem = item | separator | submenu | group | checkbox | radio
  spec.ts         buildMenu(surface, target, deps): MenuItem[]   ← 纯函数、可单测
  surfaces.ts     surface 常量 + target 类型（session/file/tab/goal/...）
  MafwContextMenu  → 只负责渲染 spec（icon/shortcut/danger/disabled/group/sub/check）
  menu.css        danger / shortcut / icon / group label 样式
```

- `buildMenu` 纯函数按 surface 返回 items；每个 surface 一个文件、一组测试（与仓库现有「纯逻辑模块 + 同目录 .test.ts」一致）。
- 渲染器统一支持：`icon`、`shortcut`、`disabled`（可带原因 tooltip）、`danger`、`submenu`、`checkbox/radio`、`group`。
- i18n：菜单标签进现有 i18n 表（`renderer/i18n/*.ts`），禁止再写死中英混排。

### 4.2 分期

| 阶段 | 内容 | 产出 |
|---|---|---|
| P0 框架 + 收口 | spec/types/renderer；迁移现有 5 张菜单；修 danger 样式、Automations 重复、Approvals 乱码、Triage 缺项、中英混排；LeftDock `⋯` 改为直接控制同一菜单 | 现有菜单风格一致、缺陷清零 |
| P1 高频补缺 | 文件路径四件套；文件树（打开/预览/附加/复制路径/定位）；编辑器 tab（关闭其他/右侧/复制路径/定位）；聊天消息（复制/引用/编辑重发/从此分叉）；终端（复制/粘贴/清屏/外部打开） | 9 个空白区域里补 5 个最高频 |
| P2 面板与对象 | 执行/审阅面板行、Goal 卡与泳道格、Memory/Notes 卡片、Tray 最近会话 | 全区域覆盖 |
| P3 扩展性 | surface 注册表 + 插件/用户命令接入（对齐 dsh slot list） | 菜单可被扩展 |

### 4.3 非目标（本批不做）

- 不自绘消息选区菜单（保留系统原生 + 现有引用浮层）。
- 不做「空白区域全局菜单」（新建/粘贴/设置）——收益低、与命令面板重复。
- 不做菜单内搜索/多级超过 2 层。

## 5. 待拍板

1. **范围**：只做 P0 收口，还是 P0+P1 一起（业界对标里我们最缺的是文件路径/文件树/编辑器 tab）。
2. **消息右键**：保持原生（Codex 路线）还是加自定义菜单（复制/引用/编辑重发/分叉）——Claude 与 opencode 都没做，属于「我们有而别人没有」的差异化。
3. **外部编辑器「用…打开」**：是否要探测本机已安装的 VS Code / Cursor / Zed（Claude 做了，Kimi 也有），还是先只做「在文件夹中显示 + 复制路径」。
4. **菜单语言**：统一中文（现状 UI 主体）还是中英双语跟随 i18n 设置。

## 附录：证据索引

- opencode `dev`：`packages/app/src/home/projects/view.tsx`、`home/sessions/view.tsx`、`session/timeline/message-timeline.tsx`、`shell/titlebar/tab-strip.tsx`、`shell/titlebar/recently-closed-tabs-menu.tsx`、`servers/registry/row-menu.tsx`；issue #12208。
- dsh `master`：`apps/web/tests/expected/**/menu*.expected.md`、`apps/desktop/tests/expected/application-menu-zh-CN.json`、`.agents/notes/archived/architecture/2026-09-17-session-row-menu-actions-slot.md`。
- Claude Code Desktop：<https://code.claude.com/docs/en/desktop>（「Open files in other apps」「Work in parallel with sessions」「Switch view modes」「Archive a session」）。
- Kimi Code Desktop：<https://www.kimi.com/code/docs/kimi-code-desktop/changelog.html>（1.0.3）、<https://www.kimi.com/code/docs/kimi-code-desktop/interface-and-sessions.html>。
- Codex：openai/codex issue #31281；ChatGPT/Codex changelog `#46895`「Add right-click copying for transcript and composer selections」。
- 我们：`packages/desktop/src/renderer/mafw/components/{MafwContextMenu,IconRail,LeftDock,SessionStrip,FilesDock,EditorDock,TerminalDock,BrowserDock}.tsx`、`pages/{Dashboard,Memory,ApprovalsPage,TriagePage,Automations}.tsx`、`main/{index.ts,menu.ts,tray.ts}`。
