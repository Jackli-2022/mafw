# 右面板开关位置与面板布局对标（dsh / Codex / OpenCode / Kimi Code / Claude）

日期：2026-09-29 · 承接 `docs/research/2026-09-28-desktop-aesthetics-competitor-research.md`（同批产品，本轮只深入窗口 chrome 与面板开关位置）
触发问题：MAFW 的「右面板开关」该放哪里——用户提出「放到 titlebar 最右端更符合逻辑」，需业界证据

## 结论速览

| 产品 | 顶栏类型 | 左栏开关 | **右面板开关位置** | tab 位置 | 右面板模型 |
|---|---|---|---|---|---|
| DeepSeek Harness (dsh) | Electron；原生/自绘**未确认** | 未载明（root slot 有独立 `sidebar` 列，品牌 mark/name 在栏顶） | 接口为 `ctx.sidebarRight.toggleExpanded()`；**物理按钮位置未载明** | 面板 tab 在**面板自身 tab 条**；无窗口级会话 tab（会话在左栏） | 每会话一个停靠面；pane 可分栏/浮出/收回/关闭；整列可折叠；布局仅在内存 |
| OpenAI Codex | ChatGPT 桌面 app 的 Codex mode；chrome**未确认** | 单栏形态无左栏 | **无右面板**——改动用会话流末尾内联卡（`Changed 8 files … Review`） | 截图未见会话 tab | 单栏居中流，无 dock |
| OpenCode Desktop | **自绘标题栏**（mac 36 / win 44px），win 右侧原生按钮 138px | 无固定左项目栏；标题栏最左 Home 按钮（`home.toggle = mod+b`） | **会话内容区右上角浮动按钮** `SessionReviewToggle`（`absolute end-3 top-0`，icon `sidebar-right`，tooltip 含键位） | **会话 tab 在标题栏行内** + "+" | 固定列、可折叠、可拖拽调宽；**每 tab 持久化**；review 内另有文件列表 sidebar 开关 |
| Kimi Code Desktop | 截图倾向自绘/frameless（**未确认**） | 左栏 workspace 会话 + 左下账户/设置 | **顶部栏最右侧按钮**（官方原话 "the rightmost button collapses or expands the right panel"） | 面板 panel tabs 在**顶部栏中部**（+ 新建）；底部终端独立 | 可折叠固定列（可拖拽边界），tab 随会话 |
| Claude (Desktop/Code) | 应用三 tab（Chat/Cowork/Code）在**顶部中央** | 左栏列会话（顶部筛选、底部 Customize） | **无单一切换点**：会话工具栏 **Views 菜单**逐 pane 开关 | 会话 tab **不在标题栏**（侧栏列表 + Ctrl+Tab 循环） | **自由可排布 pane**（拖动重定位/调大小/弹出独立窗口） |

## 逐家要点

### DeepSeek Harness Desktop（dsh）
- 右侧栏正式名 "right sidebar"，由 `dsh-client-ui-sidebar-right` 拥有、`dsh-client-ui-dockkit` 做布局；每会话一个停靠面，tab 类型 `guide`/`text`/`files`/`browser`/`subagentchat`
- "+" 新 tab 在**面板自己的 tab 条**上；`revealIfOpened` 默认 true（同地址重复打开聚焦已有 tab）
- "从会话区打开文件/链接会在同一步展开折叠的列"——即**面板开关与内容打开动作耦合**，不强调一个常驻开关键
- 来源：`deepseek-harness.github.io` reference（slots / sidebar-right）

### OpenAI Codex
- 官方营销图是**居中单列卡片流**：无左栏、无右面板、无 tab；改动审查是 message stream **末尾内联卡**
- 多 agent "command center" 侧栏形态来自上一轮调研（本轮未取得官方截图验证）
- `developers.openai.com` 返回 403，App 布局/键位无一手文档

### OpenCode Desktop（v2 源码）
- 自绘标题栏；Windows 右侧保留 3 个原生按钮共 138px、左侧应用菜单；macOS 保留红绿灯（预留 68px）
- **右面板开关不在标题栏**，而是会话内容区**右上角浮动按钮**（`sidebar-right` 图标），tooltip 带键位
- Review 面板内部**还有一层**文件列表 sidebar 及其独立开关 + 持久化宽度
- 会话 tab 在标题栏行内（`TitlebarTabStrip`）；`tabLayout=vertical` 时移入左侧竖排 sidebar
- 来源：`anomalyco/opencode` v2 `packages/app/src/...`

### Kimi Code Desktop
- 官方文档原话：右面板开关 = **顶部栏最右侧按钮**
- 面板 panel tabs 在**顶部栏中部**（与"新建"同区）；底部终端面板独立、自带多 tab
- 会话右上角另有 "Open Terminal" 按钮
- 默认快捷键表**不含**右面板开关键位（可在 Settings→Hotkeys 自定义）
- 来源：`kimi.com/code/docs/en/kimi-code-desktop/*`

### Claude（Desktop + Code）
- 无固定右栏：chat/diff/browser/terminal/file/plan/tasks/subagent 是**自由 pane**，从会话工具栏 **Views 菜单**打开、可拖动重排、可弹出独立窗口
- 会话不在标题栏（侧栏列表 + `Ctrl+Tab` 循环；应用级三 tab 在顶部中央）
- 快捷键按 pane 分：`Cmd+Shift+D` diff、`Cmd+Shift+B` browser、``Ctrl+` `` terminal、`Cmd+\` 关闭 pane
- 来源：`code.claude.com/docs/en/desktop`

## 对 MAFW 的启示

1. **「顶栏最右端的应用侧开关」有明确先例**：Kimi 的「顶部栏最右侧按钮」与 VS Code 的布局开关簇都落在**窗口控制的紧左**——我们当前实现（右开关右缘 1898，窗口控制左缘 1902，**间隙 4px**）与两者一致
2. **窗口控制右侧不可放可交互元素**：Windows 将右上角保留给 caption 按钮且不向内容派发输入；Electron `titleBarOverlay` 同理 → 「关掉按钮的右边」不是可选项
3. **另一种同样主流的做法**：把开关放进**会话内容区右上角**（OpenCode），开关贴着它控制的面板所在侧；好处是开关与被控对象同域，缺点是每个会话视图都要复现该按钮
4. **面板 tab 的位置无共识**：dsh 把 tab 放面板内、Kimi 把 panel tabs 放顶栏中部、OpenCode 放标题栏行内（会话 tab）—— 三种都有先例，不构成"必须改"的压力
5. **Claude/Codex 这两家根本没有常驻右面板**（自由 pane / 内联卡）——说明右面板本身是"可选架构"，MAFW 保留自动折叠固定列是稳妥选择

## 未确认项（防误假设）

1. **dsh 窗口 chrome**（原生/自绘、右上角内容）与**右栏物理按钮位置/键位**：官方只给编程接口，未给 UI 坐标
2. **dsh 主区顶层视图切换（对话/轨迹）**：来自截图复核，非文档化结构，存疑
3. **Codex App 布局**：`developers.openai.com` 403，仅营销图 + Help Center；营销图是否等于最终形态不确定
4. **OpenCode review 开关的确切默认键位**（tooltip 用 `command.keybindParts("review.toggle")` 渲染，注册点未见）；`sidebar.toggle` 键位亦未确认（`mod+b` 的是 `home.toggle`，非同一命令）
5. **OpenCode 是否存在常驻左项目栏**：shell 层无，Home 视图承担总览；`verticalTabs` 左栏仅在特定设置下出现
6. **Kimi 窗口 chrome 与左栏品牌位置**：截图视觉判断（自绘/内容贴顶、品牌不在侧栏），非官方声明
7. **Claude Desktop 窗口 chrome（原生/自绘）与左栏开关**
8. 通用：本轮媒体视觉复核多次给出不一致描述，凡与官方文档冲突一律以文档为准；仅凭截图的结论已逐条标注存疑
