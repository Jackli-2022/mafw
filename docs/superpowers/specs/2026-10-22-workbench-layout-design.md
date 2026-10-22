# MAFW Desktop 工作台布局重排（Agent Workbench Layout）设计

日期：2026-10-22
状态：待确认
调研依据：`docs/research/2026-10-22-left-rail-industry-survey.md`（VS Code/Cursor/Slack/Linear/Codex/ChatGPT 六家）
前置：Agent Workbench 一期已落地（文件树/编辑器/diff 在右 dock，见 `2026-10-22-agent-workbench-design.md`）

## 意图与为什么

产品定位已定：**chat = 喊话器，右 dock = 桌面**（agent 干活与人验收的地方）。但现状布局与定位相反：工作台默认关、上限 480px，chat 占满主画面——"喊话器"当了主角，"桌面"藏在抽屉里。

本次重排让布局服从定位：工作台成为画面主角并默认打开，chat 退为常驻窄栏，左栏从 200px 会话栏收成图标轨 + 按需展开的左 dock。

## 用户已确认的决策（逐项经可视化 mockup 确认）

### D1 主画面三列（A · IDE 式）

```
┌──────────────────────────────────────────────┐
│ 顶行：会话 tab 条 + 窗口控制                  │
├───┬─────────────┬────────────────────────────┤
│轨 │ Chat ~30%   │ 工作台（右 dock）~62%      │
│46 │ 喊话器      │ 默认打开                   │
│px │             │ 文件/编辑器/diff/任务/...  │
└───┴─────────────┴────────────────────────────┘
```

- 工作台默认打开，是画面主角；chat 常驻窄栏只负责对话与发指令
- chat 与工作台之间分隔条可拖（沿用既有 ResizeHandle/dock-width 机制）
- 参考：Cursor / VS Code

### D2 左 dock 展开双模态（窗口状态分岔）

- **窗口化（非最大化）**：左 dock 展开为**浮层**，盖在 chat 上方；底层布局不动；点外 / 选中会话后关闭
- **全屏/最大化**：展开为**推挤列**——chat 与工作台让位，会话列表常驻并排，可再手动收起
- 判定信号用窗口状态（`winMaximized()` 已存在于 MafwShell），不只依赖宽度断点
- 依据：窗口化时横向空间稀缺，浮层不破坏 chat/工作台宽度；全屏时空间宽裕，并排常驻方便来回切会话（通用 sidebar 响应式策略同此：窄→overlay drawer，宽→persistent）

### D3 图标轨组成（6 图标，三段）与去向

| 段 | 图标 | 行为 |
|---|---|---|
| 顶部（高频导航） | 💬 会话 | 开/关左 dock「会话列表」面 |
| | ＋ 新建会话 | 即时动作，不开面板 |
| 中部 | 🔍 搜索 | 开/关左 dock「搜索」面 |
| 底部（meta） | 📊 Dashboard | 整页主视图切换；兼枢纽页（页面链接卡 + Approvals 徽标，见 D6） |
| | ⚙ Config | 同上（现状 `setShowConfig` 路径） |
| | 🌙 主题 | 即时动作（亮/暗/系统循环），不开面板 |

- 点已激活的 💬/🔍 = 收起左 dock（VS Code toggle 语义）
- 左 dock 只有两种面（会话 / 搜索），同一容器、同一浮层/推挤规则
- 图标可辨识 + TooltipV2（openDelay 300）；激活态 = 背景块 + 左侧 accent 条

### D4 后台任务不上轨

今早决策不变：存在感层 = composer 上方 work bar；详情层 = 右 dock「后台」tab。轨上**不放** ⚡ 图标（用户选"轨保持干净"）。

### D6 五个主页面（Goals/Memory/Approvals/Triage/Automation）= Dashboard 枢纽页

- 轨不加图标（保持 6 个）；五个页面的入口改为 **Dashboard 页面内的链接区**（Dashboard 从纯数据页升级为枢纽页，加一块「页面」链接卡——这是本次唯一允许的 Dashboard 内容变更）
- Approvals 待办数徽标挂在 📊 Dashboard 图标上（语义妥协：徽标不再专属于 Approvals 入口，用户已知情接受）
- 五个页面本体仍是整页主视图切换（与 Dashboard/Config 同机制）

### D7 WelcomeHome 整页化

未选会话时的欢迎页（项目切换/新建 goal/最近会话）不再挤在 340px chat 窄栏，改为**整页主视图**（与 Dashboard/Config 同机制）；选中会话后回到三列布局。

### D5 左 dock 会话列表要求（Codex 教训）

- 顶部放项目切换器（Codex workspace switcher 位）
- 项目行与会话行**强视觉层级**区分（Codex #29161 教训）
- 会话行带所属项目徽标（Codex #26386 教训）
- worktree 会话带 ⎇ 徽标（沿用既有 `worktree-label.ts`）

## 现状锚点（实现基础，已核对）

- `.mafw-shell` grid 由 `--rail-w` 变量驱动 rail 列宽（v7 动效收口）；`railCollapsed`（`mafw-rail-collapsed`）/ `railWidth`（`mafw-rail-width`，默认 264）持久化
- `winMaximized()` signal 已存在（`.mafw-shell` 的 `maximized` class）
- `layout-breakpoints.ts`：`NARROW_BREAKPOINT = 1200` + `railAutoAction`（窄视口 Rail 自动折叠、RightDock overlay 化）
- 顶行开关（818b11b8）：左侧 rail 折叠按钮（Ctrl+B）、右侧 dock 开关
- RightDock 9 tab + `dock-width.ts` clamp（files/editor 上限窗口 50%）+ ResizeHandle
- Dashboard/Config 已是整页 Page（`DashboardPage` / `setShowConfig` → `ConfigPage`）
- Rail 组件 = 现 200px 会话栏（品牌/项目切换器/搜索/新建/会话列表/底部入口），其内容即左 dock「会话」面的现成材料

## 目标 / 非目标 / Anti-goals

**目标**
- G1 三列布局落地：图标轨 46px + chat 窄栏 + 工作台默认打开
- G2 图标轨 6 图标三段式，去向按 D3
- G3 左 dock 两面（会话/搜索）+ 双模态展开（D2）
- G4 所有面板开关一等可见（Cursor 反面教材：不得藏进菜单）
- G5 小窗口可用性不回归（720px minWidth、1200px 断点行为共存）

**非目标**
- chat 功能本身不变；右 dock tab 集合不变
- Config 页面内容不变（只是入口上轨）；Dashboard 仅新增「页面」链接卡（D6）
- 轨图标自定义（重排/隐藏）不做（VS Code/Slack 有，一期 YAGNI）
- 全局文件搜索（左 dock 搜索面一期 = 会话/项目搜索，复用 Rail 现有搜索）——我的判断，非用户决策

**Anti-goals**
- A1 面板开关藏菜单（Cursor 教训）
- A2 左 dock 列表项目行/会话行无层级区分（Codex #29161）
- A3 新布局破坏小窗口可用性

## Builder check 已决项（我的判断，2026-10-22）

- **默认打开语义**：一次性默认值变更——`mafw-right-dock-open` 从未被用户显式设置过时默认打开；用户显式关过则尊重其选择（不每次启动强制重开）。**工作台默认 tab = 📁 文件**（呼应主角定位；`dock-width.ts` 的 50% clamp 随之生效）
- **跨平台最大化检测**：`winMaximized()` 现状只在 win32 填充——需补 macOS/Linux 的窗口状态 IPC（isMaximized/isFullScreen 事件推送），三平台双模态行为一致
- **gateway 连接状态点**：从 Rail 品牌块挪到 ⚙ Config 图标上做红/绿徽标；ConnBanner 不变
- 顶行左侧 rail 折叠按钮删除，由轨 💬 接管（Ctrl+B 快捷键保留，映射为切换左 dock）；顶行右侧 dock 开关保留
- 默认宽度：chat ≈ 340px（可拖 280-480），工作台 = 剩余；持久化复用 `mafw-rail-width` 模式新增 chat 宽度键
- <1200px 窄窗口：工作台沿用既有 overlay 化行为（layout-breakpoints 既有注释口径）；左 dock 恒浮层
- 浮层/推挤动画沿用 v7 motion tokens（`--dur-surface` / `--ease-surface`），左 dock 列宽参考 `--rail-w` 变量过渡模式
- 旧 `mafw-rail-collapsed`/`mafw-rail-width` 键迁移为左 dock 状态键（一次性读取迁移）
- 状态模型建议：纯函数模块 `left-dock.ts`（mode: closed | overlay | push；face: sessions | search；决策函数输入 winMaximized + 窄断点），CSS 契约测试钉扎浮层/推挤两态
