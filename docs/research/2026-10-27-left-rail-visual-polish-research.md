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
