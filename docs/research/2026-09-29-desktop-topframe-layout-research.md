# 顶栏/框架布局业界调研（desktop top-frame layout）

日期：2026-09-29 · 动机：SessionStrip 升入标题行 + 右 dock tab 并入 + Rail 通高 的重构决策依据

## 逐家结论

### Claude Desktop（Code tab）
- **没有 tab 条**：会话是左侧 sidebar 列表（Cmd+N 新建、Ctrl+Tab 循环），并排靠 split pane 而非 tab
- Code tab 是自由 pane 布局：chat/diff/browser/terminal/file/plan/tasks/subagent 面板可拖拽重排、可弹出为独立 OS 窗口
- 面板从**会话工具栏的 "Views" 菜单**打开，不从标题栏
- 来源：https://code.claude.com/docs/en/desktop

### OpenAI Codex desktop
- 公开官方资料未记录窗口框架细节（landing page 只有任务+review panel 截图暗示）；**不确定**

### Kimi（Moonshot）
- kimi.com 是 web 应用（左 sidebar 导航）；kimi-cli 是终端程序；无公开 desktop 框架文档；**不确定**

### Zed
- 细自定义 titlebar（git 分支/worktree/项目/用户菜单，默认无菜单栏）——**标题栏是信息条**
- editor tab 在**标题栏下方**的 per-pane tab bar（VS Code 式，非 Chrome 式）
- 所有面板是 dockable panel（agent 默认右侧 640px），开关按钮在**状态栏**而非标题栏
- 来源：https://zed.dev/docs/visual-customization

### opencode desktop
- Electron 应用；左竖直导航 rail（chat/goals/memory/approvals/triage/automation），无顶部 tab 条；框架细节无官方文档；**部分不确定**

### "dsh desktop"
- 未能识别该产品。可能是 Dash（macOS 文档浏览器，原生标题栏）或 Warp（终端）。**待用户澄清**

## 通用模式参考

### Windows Terminal —— tabs-in-titlebar（Chrome 式）的标杆
- `showTabsInTitlebar` 默认 **true**：tab 移入标题栏、经典标题栏消失；false 则 tab 在标题栏下方（VS Code 式）
- 配套旋钮：`alwaysShowTabs`、`tabWidthMode`（equal/titleLength/compact——compact 把非活跃 tab 收成图标宽）、`newTabPosition`
- 教训：该模式省一行垂直空间，代价是拖拽区与窗口控制的拥挤，官方做成**可切换项**
- 来源：https://learn.microsoft.com/en-us/windows/terminal/customize-settings/appearance

### VS Code —— tabs-below-titlebar + 标题栏布局按钮
- 自定义标题栏：菜单 + Command Center 搜索 + **右端的 layout controls**（主侧栏/底部面板/副侧栏三个切换按钮，紧邻窗口控制）
- editor tab 在标题栏下方的 editor-group 条
- **关键借鉴**：面板开关按钮放标题栏右端（窗口控制左边）正是"dock 合入顶行"的业界先例
- 来源：https://code.visualstudio.com/docs/getstarted/userinterface

## 横向模式总结

| 模式 | 代表 | 优点 | 代价 |
|------|------|------|------|
| tab 入标题栏（Chrome 式） | Windows Terminal（默认） | 省一行垂直空间 | 拖拽区/窗口控制拥挤 |
| tab 在标题栏下（VS Code 式） | VS Code、Zed | 标题栏简洁、tab 区宽裕 | 多占一行 |
| 无 tab 条（sidebar 列表 + split） | Claude Desktop、opencode desktop | 会话多时不挤 | 无"打开会话"一览 |

**面板开关位置**：VS Code 放标题栏右端；Zed 放状态栏；Claude 放会话工具栏菜单。

## 对本重构的启示

1. 用户方案（SessionStrip 入标题行 + dock 开关入顶行右端）= Windows Terminal 的 tab 模式 + VS Code 的 layout controls 模式，两者都有标杆先例，**方向成立**
2. 拖拽区工学是主要风险：顶行同时要容纳 会话tab（可溢出滚动）+ 5 个 dock 图标 + 138px 窗口控制，tab 区需要 compact/溢出策略（参考 `tabWidthMode: compact`）
3. Claude/opencode 代表的「无 tab 条、sidebar 列表」趋势说明：tab 条不是必需品——但 MAFW 已有 SessionStrip 且用户明确要保留并上移，不推翻
