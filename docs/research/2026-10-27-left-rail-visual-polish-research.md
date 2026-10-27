# 左侧 Rail 视觉整理：业界调研

日期：2026-10-27
状态：调研完成，方案待产品挑（A 降噪 / B 现代化）；未改产品代码
范围：**视觉层**——行结构、分组头、标题质量、Manager 卡、图标轨细节、项目切换器。
信息架构（faces 划分、图标轨分组原则、宽度/push 规则）已由 `2026-10-26-agent-workbench-rails-research.md` 定案，本调研不重开。

截图：`.superpowers/sdd/2026-10-27-left-rail-visual/current-left-rail.png`（look 项目，Manager 卡在场）+ `rail-zoom.png`（2× 放大）
DOM 核实：`b1-rail-dom.mjs` / `b1-rail-dom2.mjs`（CDP 实测）

## 1. 当前状态事实清单

全部经 DOM 实测确认，不是观感推断：

| # | 位置 | 事实 | 来源 |
|---|---|---|---|
| 1 | 会话行标题 | 兜底标题是原始 ISO 串：`New session - 2026-10-13T06:28:19.923Z` ×10 行 | DOM |
| 2 | 项目切换器 | 当前项目渲染为 `.`（相对路径被注册进项目表，switcher 与分组头双双显示 "."） | DOM |
| 3 | 项目分组头 | `项目名 + 计数`，项目名为 "." 时整行退化为 `. 10` | DOM |
| 4 | 日期分组头 | `10月` + 全宽横线穿过（`::after` 1px line）+ 计数 `10` | CSS 465-467 |
| 5 | Manager 卡 | accent 8% 底 + 左 2px accent 边 + 三行内容（名称/阶段+进度条/相对时间），最高 ~76px；当前项目无 manager 时不渲染 | CSS 482-495, ManagerCard.tsx |
| 6 | 图标轨主题钮 | ☀ 文本 emoji（注释自认「图标集无 sun/moon」），与 icon set 线条风格断裂 | IconRail.tsx:48 |
| 7 | 连接状态点 | 绿色呼吸点挂在 **Config 齿轮**右下角，语义错位（状态 ≠ 设置） | IconRail.tsx:47 |
| 8 | 切换器 chevron | `▾ 项目名`——chevron 在名字**前**；业界通行名字在前、chevron 在后（或无 chevron） | LeftDock.tsx:277 |
| 9 | 会话行 | 32px 单行 ellipsis，hover 出 ⋯，active = hover 底 + inset 2px accent 竖条 | CSS 468-477 |
| 10 | sessions face | 顶部无常驻搜索框（搜索是独立 face，靠图标轨切换） | LeftDock.tsx:319 |

结论：**难看的主因不是布局结构，是「数据质量泄漏 × 装饰性噪音 × 风格断裂」三层叠加**。结构（faces/分组/32px 行/hover 交互）本身与业界同构。

## 2. 业界参考（视觉层）

前次调研已覆盖 IA 与尺寸；这里只看「列表长什么样」的规范。

### 2.1 会话列表类（ChatGPT / Claude Desktop）

产品观察（2026 现状，无官方设计文档，记录为事实）：

- 顶部：搜索框 + New chat 按钮，两者常驻；
- 分组：Today / Yesterday / Previous 7 Days / 月——**小字号、静音色、无横线、无计数**；
- 行：单行 ellipsis、无行内图标、无时间戳、无卡片；hover 才出 `⋯` 菜单（rename/share/delete）；
- 标题：LLM 生成的短主题（≤20 词），空会话显示为短占位，从不露原始消息文本或 ISO 串；
- 全列表单色，唯一的彩色留给品牌与用户头像。

### 2.2 侧栏规范类（Apple HIG / VS Code）

- **Apple HIG Sidebars**：侧栏 = 导航；短标签、避免截断；选中行用系统 accent 填充传达，**不靠装饰线**。层级用缩进，不用横线切割。
  - https://developer.apple.com/design/human-interface-guidelines/sidebars
  - https://developer.apple.com/design/human-interface-guidelines/lists-and-tables（行结构适配内容；扫读优先）
- **VS Code**：分区头 = 11px 大写小字 + 静音色，动作图标 hover 才显；树行 22px；活动栏 48px 纯图标，active 用左侧指示条/填充块表达；图标必须与默认集合同风格、禁重复。
  - https://code.visualstudio.com/api/ux-guidelines/activity-bar
  - https://code.visualstudio.com/docs/editing/getting-started/userinterface
- **Material 3 navigation rail**（前次已引）：3–7 个目的地；active indicator；badge 只表达动态状态。
- **NN/g 图标可用性**（前次已引）：无文字标签的图标必须是高度通用图形，否则不可依赖 tooltip。

### 2.3 社交/协作类（Discord / Linear，产品观察）

- Discord：分组头 tiny 大写 + hover 才显 ＋；行内尾部动作 hover 显；badge 是红色 pill 只在右缘。
- Linear：workspace 切换器 = 头像 + 名字 + **chevron 在后**；导航行 28px 带图标；分区头 tiny 静音。
- 共同点：**信息按 hover 时序分层**——静态只留「扫读需要的最少元素」，其余（计数/动作/状态）hover 才出现。

## 3. 视觉规则提炼

1. **静音分组头**：11px、大写或小字重、60% 静音色；无横线、无计数（或计数只在 hover 显）。分组靠间距和字重，不靠装饰线。
2. **单行干净行**：标题一行 ellipsis；行内零装饰（无时间戳、无内嵌徽标文本）；动作 hover 显。
3. **标题零泄漏**：列表标题永不显示原始消息文本、ISO 时间戳、路径片段；空会话用短占位（"未命名"或"10月13日"），首消息长标题截断到合理长度。
4. **无卡片**：导航列表里不出现 card 对象；「置顶项」用普通行 + accent 左条表达。
5. **图标同源**：一条 rail 上所有图标来自同一集合同风格；状态点不挂在功能图标上（状态≠设置）。
6. **选态用填充**：active 用 bg tint（accent 8–12%）+ 可选左条，永不用彩底大块或渐变。

## 4. 差距对照

| 我们 | 业界 | 判定 |
|---|---|---|
| 分组头横线穿过 + 常驻计数 | 静音小字无装饰 | 改 |
| ISO 串标题 `New session - <ISO>` | 短主题/短占位 | 改（客户端兜底格式化即可，不需改 wire） |
| Manager 三行卡（accent 底+进度条） | 置顶行（普通行+左条） | 改（Manager 本质是"置顶会话"，不是仪表盘卡） |
| 项目名 `.` 直接渲染 | 名字兜底（basename 缺失→显示"当前项目"） | 改 + 数据侧另修 |
| ☀ emoji | 图标集风格 SVG | 改 |
| 状态点挂 Config 齿轮 | 状态独立或收进 tooltip | 改 |
| `▾ 名字` | `名字 ▾` | 改 |
| 32px 行 + ellipsis + hover ⋯ + inset 左条 | 同构 | 保留 |
| 独立搜索 face | （ChatGPT 顶部常驻搜索框） | IA 已定不重开；视觉层可在 sessions 头部提示可搜索性，不强加 |
| 图标轨 3 组分层（top 工作 / middle 搜索 / bottom meta） | VS Code/M3 同构 | 保留 |

## 5. 方案

### A. 静音降噪（最小改动，纯视觉 + 兜底格式化）

不动任何结构，六处修正：

1. 分组头：去 `::after` 横线；计数降为 hover 才显或删除；11px 60% 静音。
2. 兜底标题客户端格式化：匹配 `New session - <ISO>` → `未命名 · 10月13日`；其余超长标题截断到 24 字符显示（存 titles 不动）。
3. ManagerCard → 单行置顶行：`● Manager · <phase> · 2h前`，待决数用红色 pill badge，进度降为行底 2px 细线；删掉三行卡。
4. 项目名兜底：basename 解析结果为空/`.` → 显示"当前项目"；switcher 与分组头同源。
5. 主题钮 ☀ emoji → 与 icon set 同风格自绘 SVG（moon/sun 轮换，线条 1.4px）。
6. chevron 移到名字后：`项目名 ▾`。

### B. A + 现代化微调（结构微动，仍在既有 IA 内）

A 全部 + 三处：

7. sessions face 头部：项目切换行与"新建/关闭"合并为一行（`新建 +` 左、`名字 ▾` 中、`×` 仅 overlay 显）。
8. 连接状态：从 Config 齿轮上摘下，做成 rail 底部独立 4px 状态条（绿/灰/红），tooltip 显示状态文案；Config 图标只做设置。
9. 分组头进一步弱化为 sticky 悬浮小字（滚动时淡入），对齐 ChatGPT 的 Today/Yesterday 视觉密度。

### 不做（本线）

- 不重开 faces IA（搜索/便签/会话三面维持）；
- 不加行内时间戳（业界均不显示）;
- 不把 Dashboard/Config 移进 dock（上次 IA 定案保留在 rail 底部 meta 组）；
- 不改宽度/push 规则（上次定案 1366 阈值）。

## 6. 数据侧问题（视觉修复之外的移交项）

- `.` 项目注册：`projects.setCurrent` 接受了相对路径，注册表应绝对化或拒绝相对路径（gateway 侧修复，单独立项）；
- opencode 空会话标题：`New session - <ISO>` 来自 runtime 侧自动命名，视觉兜底格式化后仍建议 gateway 在首次回复后生成 LLM 短标题（已有 summarize 通道可复用）。

## 7. 未决

- A or B（本文档完成后由产品在 mockup 上挑）；
- 置顶 Manager 行的 phase 文案是否显示英文 phase 还是映射中文（当前 phase 为英文枚举）。

## 8. 业界左导航功能按钮调研（六家，2026-10-27）

> 用户指定对标：Claude / opencode / dsh / Kimi / Codex / pi desktop。所有条目来自官方文档、官方公告或一手 hands-on，来源见各小节。

### 8.1 六家逐个盘点

**Claude Code Desktop**（2026-04-14 重建 + 10-14 更新，多会话 sidebar 形态）

- New session：recent folders 一键、saved environments（多文件夹 + SSH/云端 + 每文件夹独立 worktree）、环境下拉（Local / Cloud / SSH / WSL）
- 会话列表：active + recent；按 status / project / environment 筛选；按项目分组（跨 4 仓的 refactor 折叠为一个可展开簇）；**working / needs-attention 状态指示**；PR 合并自动归档（opt-in）
- **Routines 页**（sidebar 内）：Cloud（Anthropic 基础设施）/ Local（桌面定时任务，间隔可到 1 分钟）；routine run 以会话身份落进 sidebar
- **Usage 按钮**（sidebar 内）：context window + 会话用量一眼可见
- Side chat（Cmd+; / `/btw`，读主线程不回流）；task chips（follow-up 工作一键开新会话新 worktree）
- 来源：https://claude.com/blog/claude-code-desktop-redesign 、https://code.claude.com/docs/en/desktop 、https://aicatchup.com/news/claude-code-desktop-redesign

**opencode Desktop**（去 sidebar 化，Tabs 为中心）

- 官方公告："OpenCode Desktop is now built around **tabs**. Start a new session in a tab, or open an existing session from any of your projects."
- Home 视图列项目；旧 sidebar（跨项目会话分组）被移除，社区在 GitHub issue #29902 / Reddit 追悼（"legacy GUI with sidebar much easier for managing multiple sessions across different projects"）
- tabs 可配：scope=cwd / layout=horizontal / indicators=status；session.sidebar=auto
- 来源：https://x.com/opencode/status/2077148766092558570 、https://github.com/anomalyco/opencode/issues/29902 、https://opencode.ai/v2/docs/cli/config/

**dsh Desktop**（DeepSeek Harness 2.0，左 sidebar + 右 workspace files）

- sidebar **＋ 添加项目文件夹**；active workspace 选择器在 composer 上方
- per-task：模型 / thinking 档 / 权限（read-only / workspace-write / full-access）/ 预设（Standard / PTC / Minimal / Creator）
- 右侧 workspace files 面板（HTML 报告内嵌预览 + 全屏）；顶右动作菜单：session log / chat / trajectory
- **plugins tab**（官方 bundles + installed + creator mode 自建面板装进 sidebar）；**automation tasks**（一次性/循环定时任务 + delivery records tab）；agent teams（实验）
- "Show coding view" 设置：coding trajectory、file diffs、agent presets
- 来源：https://github.com/dataelement/dsh-desktop 、https://www.mindstudio.ai/blog/deepseek-harness-2-desktop-app 、https://www.deepseek.com/en/harness/ 、https://github.com/deepseek-ai/deepseek-harness/discussions/2669

**Kimi Code Desktop**（单栏 sidebar，ChatGPT 式）

- 顶部常驻：**New chat / Search**
- Sessions 按项目分组（landing-page / kimi-code-app / api-server）；任务式标题 + 相对时间（"Hero copy polish 26m"）
- CLI 侧另有 subagents（coder/explore/plan）、插件 marketplace、生命周期 hooks（桌面导航未暴露）
- 来源：https://www.kimi.com/code/en （landing 桌面截图文字）、https://github.com/MoonshotAI/kimi-code

**Codex（OpenAI）**（sidebar = Projects + Threads）

- 新建 thread；**Projects**（文件夹）+ Recents/threads；"Move to project" 行内动作
- 已知弱点：projects 与 threads 视觉区分弱（issue #29161）；多项目时 sidebar 可扩展性被吐槽；sidebar 跨设备同步
- 来源：https://github.com/openai/codex/issues/54661 、https://github.com/openai/codex/issues/29161

**pi-gui**（pi coding agent 的桌面壳，thread sidebar 状态驱动）

- 新建 thread：checkout 或全新 git worktree
- sidebar 显示每个 thread 的 **running / finished / needs you** 状态（"The sidebar shows what is running, what finished and what needs you"）
- ⌘K palette（chats + workspaces + actions）、⌘P 文件、Ctrl-Tab 近期线程、⌘1–⌘9 跳线程
- Review tab（diff 分文件 staging）；workbench（真终端 + 文件 + worktrees tabs）；queue & steer；scheduled tasks；skills/extensions 开关 + 独立 tabs；fork/rewind
- 来源：https://www.pi-gui.com/ 、https://github.com/minghinmatthewlam/pi-gui

### 8.2 横向对照表

| 能力 | Claude | opencode | dsh | Kimi | Codex | pi-gui | 我们现状 |
|---|---|---|---|---|---|---|---|
| 新建常驻导航区 | ✅ New session（含环境/worktree） | ✅ New tab | ✅ ＋ 项目 | ✅ New chat | ✅ New thread | ✅ New thread | ❌（收起态无，仅 dock 头/标题栏） |
| 搜索常驻 | ✅ | ✅（palette） | ✅ | ✅ | ✅ | ✅ ⌘K | ✅ 搜索 face |
| 会话列表项目分组 | ✅ | ✅（Home/projects） | ✅ | ✅ | ✅ | ✅（workspaces） | ✅ |
| 会话状态维度（running/待你处理） | ✅ 筛选+指示 | ✅ indicators=status | ✅（trajectory/log） | 部分（任务式标题） | ❌ | ✅ running/finished/needs you | ❌（仅日期分组） |
| 定时任务/自动化进导航 | ✅ Routines 页 | ❌ | ✅ automation tasks | ❌ | ❌ | ✅ scheduled | ❌（在 Dashboard 里） |
| 用量进导航 | ✅ usage 按钮 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌（在执行概览，上次 IA 决定） |
| 插件/扩展管理 | ✅（plugin manager） | ❌ | ✅ plugins tab | ✅（marketplace，CLI） | ❌ | ✅ skills/extensions | ✅（Config 插件中心） |
| worktree/并行 | ✅ per-session | ❌ | ❌ | ❌ | ❌ | ✅ 新 thread 选 worktree | ✅（chat 标题栏"并行"） |
| 主题切换 | ✅（设置内） | ✅ | ✅（设置内） | ✅ | ✅ | ✅ presets | ✅ rail 按钮（业界唯一在 rail 的） |

### 8.3 对我们左 rail 的结论

1. **新建常驻是 6/6 共识**——直接验证 C2（新建钮）；Claude/dsh/pi-gui 还把"新 worktree/环境"挂进新建流程，我们右键出「并行」与 pi-gui 同构。
2. **状态维度是业界普遍而我们缺的**（4/6）：Claude 的 working/needs-attention 筛选、pi-gui 的 running/finished/needs-you。我们上次 IA 调研 §5.1 写过「待你处理 → 运行中 → 最近」分组但实现时未做——这是展开态列表功能，不是 rail 按钮，记录为后续项。
3. **定时任务/自动化**：3/6 给了导航位（Claude Routines 页、dsh automation、pi-gui scheduled）。我们自动化规则在 Dashboard 里；维持现状可行，但这是唯一值得重新审视归属的候选。
4. **用量**：仅 Claude（1/6）放进 sidebar；我们放执行概览符合多数派，维持。
5. **主题**：六家全部放设置/预设里，没有一家放常驻导航轨——我们的 rail 主题按钮是孤例。结合用户此前的"难看"抱怨（☀ emoji），**建议把主题切换降级进 Config**（或 rail 底部溢出菜单），rail 底部 meta 组收敛为 Dashboard + Config 两件。
6. **形态启示**：opencode 去 sidebar 转 tabs 是激进反例（社区反弹说明 sidebar 对跨项目多会话仍有价值）；Claude/pi-gui 的"状态驱动列表"是正例方向。

### 8.4 收敛后的收起态 rail 目标（供 spec 用）

```text
顶部动作区    ＋ 新建会话（右键：并行 worktree）
目的地组      工作 / 搜索 / 便签
（spacer）
meta 组       Dashboard（badge）/ Config（静音连接点）
```

- 主题切换移入 Config（业界 6/6 无一放 rail；rail 收两件 meta 更干净）
- 1a 填充块激活 + 统一 1.5px 图标家族（上一屏已选）
