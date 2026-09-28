# MAFW Desktop v6（美学微精化 + 局部逻辑重构）— 设计文档

> 日期：2026-09-28
> 前置：2026-09-20-desktop-ux-refactor-design.md（结构绞杀者四切片，v4）、2026-09-21-desktop-aesthetic-v5-design.md（暖纸感 token v5/字体契约/bento/动效审计，已落地）
> 依据：docs/research/2026-09-28-desktop-aesthetics-competitor-research.md（Kimi Code Desktop / Codex / OpenCode Desktop / Claude / Zed / DeepSeek Harness 六家调研）
> 状态：设计已获用户整体批准（§0–§6，含 Rail 与 TabStrip 决策）

## 1. 背景

v4 解决结构、v5 解决 token/排版/动效。本轮依据 9-28 调研的**增量信号**做美学微精化 + 局部逻辑重构：

调研收敛的关键增量：
1. **元数据行取代进度/折叠条**（Codex "Thought for 8s"、OpenCode "Show steps · 4m, 19s"、Claude "Read 3 files"——三家共识）
2. **Review/Changes 是一等公民**，形态三分：常驻右栏（OpenCode/Zed）/ 完成后浮动条（Codex）/ 右侧 tab（Kimi）
3. **人机消息字体分层**（Zed：回复=UI 字体，用户输入/代码=mono）
4. **发丝线 + 三级 elevation**（DeepSeek：0.5px hairline，浮层"发丝线+柔和投影"，禁字面色值 lint 级强制）
5. **品牌字体只做点睛**（DeepSeek Montserrat / Zed Sans / Claude serif，系统字体栈打底）
6. **可回放性 vs Out-of-your-face** 两个对立哲学，中间路线（元数据行）是主流收敛点
7. 暖色温不再是无人区（OpenCode 暖黑、Claude 奶油 `#FAF9F5`），MAFW v5 差异化靠**暗色墨纸底 + 信号绿**坚守

## 2. 目标 / 非目标

**目标**：
- §0 删除会话双栏分屏（减法先行）
- §0b Rail 重构：垂直主导航 + 多项目懒加载会话树；TabStrip 退役
- §1 Token 层：0.5px 发丝线 + 三级 elevation
- §2 字体分层：`--font-display` 点睛 + 人机用字分工
- §3 元数据行化：thinking/tool 完成态一行摘要、composer 实时元数据
- §4 Review 迁入 RightDock `changes` tab
- §5 Trajectory 升级为 call tree

**非目标**：
- 不做方向 C（对话退位、产出物上位的 IA 重构，便签板另立项）
- 不动 v4 已验收的三栏骨架（Rail/内容区/RightDock）——Rail 内部重排不算动骨架
- 不引入字体文件（`--font-display` 用系统衬线栈）、不引入新依赖
- 不动 gateway API 语义（§5 最多加只读字段，见风险）
- Trajectory 回放/分叉不做（YAGNI）
- 不追 OpenCode 暖黑、不引入 Claude 奶油浅色撞车风险——v5 暖纸感 token 值不动

## 3. 设计

### §0 删分屏（减法先行）

移除 `MafwShell` 的 splitViews 全套：
- `splitViews` signal、`loadSplitViews/persistSplitViews`（layout-persist.ts 对应段）
- ⛶ split-view tab（`.mafw-split-view-tab`）、splitViewMenu 菜单与状态
- 相关快捷键/命令面板项（`toggle-rightdock` 等保留，仅删分屏项）
- 外部删除会话时的 split 回退逻辑（`onSessionDeleted` 的 split view 分支）
- 测试清理：dock-tab.test.ts / 相关断言同步删

回归单会话 tab 体系。changelog 说明移除原因。

### §0b Rail 重构（导航 + 会话树）

**上部：垂直主导航**（吸收 TabStrip 全部职责）：
- 六页导航项：Chat / Goals / Memory / Approvals / Triage / Automation（图标+label，badge 计数保留——approvals 等待数从 TabStrip 迁入）
- 「新建会话」按钮置顶（Claude 式 New session）
- 设置入口、trajectory 触发按钮（从 TabStrip 迁入 Rail）
- **TabStrip 组件整条删除**，内容区少一条横条；`activeTab` 状态保留在 MafwShell，Rail 导航项 onClick 驱动

**下部：多项目懒加载会话树**（Kimi workspace 心智）：
- 所有注册项目作为树节点，**默认折叠**；展开时才拉该项目会话（sessionStore 已按项目分桶，加"已加载"标记，展开触发 `sessionsFor(projectID)` 拉取）
- 当前项目默认展开并高亮
- 项目节点内：★manager 会话置顶 → 普通会话按日期分组（今天/昨天/过去 7 天/按月，沿用现有 groupLabel）
- 会话子项保留：⎇ worktree 徽标、改名/删除右键菜单、搜索（搜索时跨已加载项目过滤，未加载项目提示"展开以搜索"）
- 点击其他项目会话 = 切项目（`projects.setCurrent`）+ 开会话 tab（复用现有逻辑）

### §1 Token 层：发丝线 + 三级 elevation

- `--hairline-width: 0.5px`（退化为 1px 的媒体查询兜底：低 DPI 屏 0.5px 不可见时）
- elevation 三级 token：`--elev-panel` / `--elev-prominent` / `--elev-soft` = hairline 描边 + 柔和投影组合，**互斥规范**：浮层要么 hairline 要么投影不叠加（DeepSeek 规范）
- token-alignment.test.ts 收紧：border-width/box-shadow 一律走 token，白名单外禁字面色值与裸 px 边框
- 颜色 token 值全部不动（v5 暖纸感保留）

### §2 字体分层（人机用字 + 品牌点睛）

- 新增 `--font-display`：系统衬线栈（`Georgia, "Times New Roman", "Songti SC", serif`），只用于页面标题与 WelcomeHome 大问候——零新字体文件
- 人机用字分工（Zed 决策）：assistant 正文保持 sans 16px/1.7；**用户消息气泡与代码片段切 `--font-data` mono**（沿用 mono 小 1px 契约：正文 16 → mono 15）
- `--font-ui`/`--font-data`/tabular-nums 契约不变（v5 已制度化）

### §3 元数据行化

- **thinking 折叠摘要一行**：`思考了 Ns`（流式时实时跳秒，完成冻结；沿用现有 thinking-label 逻辑改呈现）
- **tool 完成态一行摘要**：`Read 3 files` / `Searched the checkout flow` 式聚合行（同工具连续调用合并计数）；进行态保留现状呼吸态
- **composer 区实时元数据**：当前会话耗时 + token 数（tabular-nums，15s 轮询复用现有 usage 数据面，streaming 时实时）
- 不新增任何 spinner；streaming 尾光标保留（v5）
- reduced-motion 下实时跳秒降级为静态

### §4 Review 迁入 RightDock

- RightDock tabs 增加 `changes`：`tasks | trajectory | usage | quota | notes | changes`
- **两级视图**：文件列表（现 ChangesDock 内容）→ 点击进文件 diff（现 DiffReviewPanel hunk 级 accept/reject）→ 返回列表；dock 内导航，不开抽屉
- 独立 `DiffReviewPanel` 抽屉删除；ChatPane「审阅改动」与 composer 入口改为 `applyRightDock(true, "changes")`
- SSE `session.diff` 数据流不变，只改呈现容器
- Unified/Split diff 切换保留（§0 只删会话分屏）
- dock 默认宽度 320px 对 diff 偏窄：changes tab 激活时自动加宽到 480px（记忆每 tab 宽度）

### §5 Trajectory 升级 call tree

- trajectory tab 从平铺事件列表升级为**树**：turn → tool call 嵌套、子代理调用缩进一级、节点可展开看输入/输出摘要
- 折叠节点显示一行摘要（复用 §3 元数据行样式）
- 数据面：现有 TrajectoryStore 事件若缺 parent 关联，gateway 侧加**只读**派生字段（如 `parentTurnId`，不改事件语义、不加写路径）
- 回放/分叉不做（YAGNI，记风险节）

### §6 测试与验收

- **token-alignment.test.ts 扩展**：hairline/elevation/`--font-display` 存在且被引用；白名单扫描收紧（border-width/box-shadow 禁字面值）
- **结构断言**：Rail 导航六页 + 会话树懒加载（展开才发请求）+ TabStrip 移除；dock changes tab 两级视图导航
- **分屏移除**：splitViews 相关测试删除，残留引用 grep 清零
- **元数据行**：thinking/tool 摘要纯逻辑测试（合并计数、冻结、reduced-motion）
- **截图门禁**：每 wave 双主题各一张人工确认（`mafw_desktop_screenshot`）
- CSS 总量约束：v5 基础上 ≤ +10%（删分屏/抽屉应抵消新增）

## 4. 实施波次

| Wave | 内容 | 验收物 |
|---|---|---|
| 0 | §0 删分屏 | 引用清零 + 测试绿 |
| 1 | §1 token 层（hairline/elevation） | token 测试绿 + 双主题截图 |
| 2 | §3 元数据行化 + §2 字体分层 | 纯逻辑测试 + 对话区截图 |
| 3 | §0b Rail 重构 + TabStrip 退役 | 结构断言 + 懒加载测试 + 截图 |
| 4 | §4 Review 迁 dock | dock 导航测试 + 截图 |
| 5 | §5 Trajectory call tree | 树渲染测试 + 截图 |

每波独立 commit + 版本号 + 新增测试数与全量通过数汇报（用户惯例）。

## 5. 落地文件映射

| 区域 | 文件 |
|---|---|
| 删分屏 | `MafwShell.tsx`、`layout-persist.ts`、mafw.css 分屏段、dock-tab.test.ts |
| Rail 重构 | `components/Rail.tsx`（导航段+会话树）、`components/TabStrip.tsx`（删除）、`session-store.ts`（懒加载标记）、MafwShell（activeTab 接线） |
| token 层 | `mafw/mafw.css` 变量层、`tests/token-alignment.test.ts` |
| 字体分层 | mafw.css（`--font-display`、用户消息/代码 mono）、ChatPane/SessionTurn |
| 元数据行 | ChatPane thinking 区、tool card 聚合行、composer 元数据条 |
| Review 迁 dock | `components/RightDock.tsx`、`ChangesDock.tsx`、`DiffReviewPanel.tsx`（并入 dock）、MafwShell 入口接线 |
| Trajectory 树 | trajectory dock 组件、（可能）gateway TrajectoryStore 只读字段 |

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 用户正在用分屏 | changelog 明确说明；移除属用户已批准决策 |
| TabStrip 退役后六页可达性下降 | Rail 导航图标+label 常驻可见，badge 计数保留；截图门禁验收 |
| 多项目树懒加载的体验空洞（折叠项目看不见会话数） | 项目节点显示会话计数徽标（list 接口轻量字段，fail-open 不显示） |
| changes tab 320px 太窄 | 每 tab 记忆宽度，changes 默认 480px |
| Trajectory 树缺 parent 关联 | gateway 加只读派生字段；拿不到就按时间序扁平渲染降级 |
| 用户消息改 mono 影响可读性 | 仅限气泡与代码片段；双主题截图门禁，不达标回退 sans |
| 0.5px 在低 DPI 屏不可见 | 媒体查询退化 1px |

## 7. 明确不纳入（YAGNI）

- 方向 C 信息架构重构（对话退位/产出物上位）
- Trajectory 回放/分叉、diff Split 模式删除
- 字体文件引入、玻璃拟态、Claude 拟人动词（Pondering 式微文案）
- v5 颜色 token 值变更（暖纸感保留）
- TUI 侧对齐（本轮仅 desktop）
