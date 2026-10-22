# 业界左侧 Rail（activity bar / icon rail）调研

日期：2026-10-22
背景：Agent Workbench 布局重排（chat=喊话器、右 dock=桌面），左栏从 200px 会话栏改为图标轨 + 按需展开的左 dock。本文回答：**业界图标轨放什么、怎么组织、有哪些已验证的坑**。

## 六家做法

| 产品 | 形态 | 轨内容 | 组织方式 | 备注 |
|---|---|---|---|---|
| **VS Code**（activity bar 范式源头） | 图标轨 + Primary Side Bar（两层） | Explorer / Search / SCM / Debug / Extensions + 扩展贡献 | 顶部=视图切换；**底部固定 Account + Manage(⚙)**；图标带 badge（git 变更数） | 点当前图标=收起侧栏（toggle 语义）；右键可隐藏/重排/换位置；UX 指南：图标不得重复、不得直接开 webview |
| **Cursor**（VS Code 基座 + agent） | activity bar + Agents 侧栏 + 右侧 chat | 同 VS Code + Agents | 布局切换藏在右上 ⚙ 菜单 | **反面教材**：chat 面板开关藏进菜单后用户连开 4 个 issue 抱怨「找不到一键开关」——面板开关必须是一等可见按钮 |
| **Slack desktop** | 图标轨（nav bar）+ 内容 | Home / DMs / Activity / Later / More；底部 Search / Create / Profile | 顶部=最重要入口；**可自定义显示哪些 tab**；未读 dot/badge | 2023 大改版结论：最重要入口必须在导航顶层 |
| **Linear** | 可全收起侧栏（倒 L 导航：全局 chrome 控主视图） | Inbox / My Issues / Views / Projects + Favorites 自定义分区 | 底部 Settings / Invite / Collapse；badge 计数 | `[` 快捷键/点边框/命令菜单全收起（zen）；悬停左边缘 peek（修过贴边抖动 bug） |
| **Codex desktop**（最近似的聊天形态） | nav rail + contextual list（两层） | 顶部 Workspace 切换器；Pinned / Chats / Projects / Agents(**live 状态点**) / Automations / Sites / Plugins；**底部 Profile / Usage / Settings** | 两层：轨选区、列表显上下文 | 用户抱怨：①Projects 和 Threads 视觉层级分不清（issue #29161）②想要自定义排序/分区（#28692）③想看到每个 chat 属于哪个项目目录（#26386） |
| **ChatGPT desktop**（新合并版） | 顶左 Chat/Codex 模式切换 + 可收起侧栏 | 会话列表 + Projects + Plugins | 侧栏 toggle 有快捷键；自定义 Sections | 非图标轨路线：侧栏直接收起/展开 |

## 收敛出的六条规律

1. **两层结构是行业共识**：图标轨（选"哪个面"）+ 上下文面板（"面里的内容"）。VS Code/Cursor/Codex/Slack 全如此。
2. **轨上分区**：顶部=主导航（会话/文件等高频面），**底部=meta（设置/账户/用量）**。底部 pinned 是强约定。
3. **badge 是轨的核心价值**：live 状态（运行中 agent 数、未读、变更数）在图标上直接可见——轨不只是导航，还是存在感层。
4. **toggle 语义**：点当前激活图标 = 收起面板（VS Code），用户已形成肌肉记忆。
5. **图标必须可辨识 + tooltip**（mini 模式无文字）；激活态要有明确指示（背景块或左侧 accent 条）。
6. **可定制是加分项不是必需品**：VS Code/Slack 允许重排/隐藏，但第一期可以不做。

## 已验证的坑（别踩）

- **开关藏菜单**（Cursor）：面板显隐必须是一等按钮，藏进 ⚙ 菜单会被用户追着骂。
- **列表层级不清**（Codex #29161）：左 dock 列表里项目行与会话行要有强视觉区分（缩进/背景/色条）。
- **会话归属不明**（Codex #26386）：多项目并行时，会话行要能看到所属项目（badge 或副标题）。
- **hover peek 贴边抖动**（Linear changelog 自报）：边缘悬停展开要做去抖。

## 对 MAFW 的映射建议

现状 Rail（200px）内容：品牌、项目切换器、搜索、New session、会话列表、Dashboard/Config 入口。

按两层范式重组：

- **图标轨（常驻，~48px）**
  - 顶部：💬 会话（开左 dock=会话列表）、＋ 新建会话
  - 中部：⚡ 后台/代理（badge=运行中数）、🔍 搜索
  - 底部：📊 Dashboard、⚙ Config、主题切换
- **左 dock（按需展开，窗口化=浮层 / 全屏=推挤列）**
  - 顶部放项目切换器（Codex workspace switcher 位）
  - 会话列表：项目行与会话行强层级区分；会话行带项目徽标
  - 点当前轨图标=收起（VS Code toggle 语义）
- **右 dock**：保持现状九 tab（已是一等工作台）

## 来源

- VS Code: code.visualstudio.com/docs/editing/userinterface + /api/ux-guidelines/activity-bar + custom-layout
- Cursor: forum.cursor.com（chat 开关抱怨 thread 148415、Agents 面板位置 166463 等）
- Slack: slack.com/help 更新日志 + 2023  redesign 报道
- Linear: linear.app/now/how-we-redesigned-the-linear-ui + changelog（collapsible sidebar）
- Codex: developers.openai.com/codex/app + openai/codex issues #26386/#28692/#29161 + ManasesLovera/codex-desktop 布局文档
- 通用模式：stellae.design sidebar 指南（展开 240-280 / 收起 56-72 / overlay drawer 断点策略）
