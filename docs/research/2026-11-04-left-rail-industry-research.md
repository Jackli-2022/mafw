# 左侧收起 Rail 业界调研 · 2026-11-04

> 范围：桌面端左栏收起态（IconRail，46px 图标轨）的重设计依据。纯研究，不改码。
> 触发：用户反馈「左侧收起的时候的 rail，这个会话按钮，搜索按钮，收起来的看起来好丑」。
> 姊妹篇：`2026-11-04-inputbar-redesign-research.md`（composer 重设计）。

## 1. 现状（实读 `IconRail.tsx` + `mafw.css:3090-3160`）

- 宽度 **46px**，按钮 34px，gap 5px，radius 9px
- 结构：＋新建（**虚线描边** + accent 10% 底）→ 4 目的地连排（讨论 `bubble-5` / 搜索 `magnifying-glass` / 便签 `sticky-note` / 资源 `team-three`）→ spacer → 2 meta（工作空间 `layout-grid` + approval 徽标 / Config `settings-gear` + 连接点）
- 激活态：accent 12% **填充块** + accent 图标（2026-10-27 §6.1 定的）
- 徽标：红色计数（attention）+ 独立结果圆点 + 连接点

## 2. 业界系统对照（2026-11 实测/spec）

| 系统 | 宽度 | 图标 | 标签 | 激活态 | 分组 | 备注 |
|---|---|---|---|---|---|---|
| **M3 Expressive**（collapsed rail，替代旧 baseline） | 80dp | 24dp，激活**填充**/未激活描边 | **恒有，1-2 词** | **药丸形指示器**（对比色、hug 内容，非全宽） | 3-7 目的地 + 顶部可选 **FAB** | 官方 spec；命中区应全宽；badge 有 small/large 两档 |
| **VS Code** 活动栏 | 48px（有 compact 档） | 24px | 无（tooltip） | **左侧 2px 指示条** + 图标提亮（无填充块） | 上目的地/下 account+gear | 工具铬传统；右键可挪位置/隐藏 |
| **Discord** 服务器轨 | **72px 固定** | **48×48 圆角方**（r16，hover/active morph 成圆，350ms 品牌动效） | 无（tooltip，hover 显示最新未读频道） | **左侧 4px 白色胶囊** | DM/发现/服务器/底部设置 | 轨 = 最深背景层（#1e1f22）；白胶囊=未读、红数字=mention |
| **Slack** | ~68px | squircle | **可切换「仅图标 / 图标+文字」**（右键侧栏） | 着色 squircle 底 | 顶部 workspace 切换器 | 给用户选择权 |
| **setproduct** 侧栏导航 16 模式调研 | **收起轨 56-72px**（56 容 20px 图标+40px 命中；72 可加 11px 标签） | — | 轨适合**具象目的地**（收件箱/日历/文件/人）；抽象目的地无标签就是猜 | — | — | 展开态 240-280px |

## 3. 提取的共识

1. **宽度下限 56px**（setproduct）；M3 80dp、Discord 72px、VS Code 48px 是唯一低于 56 的（但它的图标是超具象的工具隐喻 + 24px 小图标留白大）。我们 46px 低于一切参考——34px 按钮只有 6px 边距，是「挤/丑」的第一来源。
2. **标签是抽象目的地的唯一救济**：讨论/搜索/便签/资源是功能不是身份。Discord 无标签能成立是因为图标是服务器头像（身份对象）；VS Code 无标签能成立是因为 Explorer/Search 是超具象工具隐喻。我们两头都不占——「气泡=讨论」「放大镜=搜索」用户要靠猜。
3. **激活态三大系统**：药丸指示器（M3）/ 左侧指示条（VS Code）/ 左侧胶囊（Discord）。**全宽填充块**只有 Slack（配 squircle 图标底）。我们的 12% 填充块无大系统背书，且和 34px 方块组合显得闷。
4. **＋按钮 = FAB 槽位**：M3 明确「顶部可选 FAB」；Discord 顶部也是加号（实心圆）。**虚线描边**是占位符视觉语言（WIP/未完成），业界无人用于常驻动作。
5. **meta 收底**：VS Code（account+gear）、Discord（设置）均把账号/设置钉在底部——我们已经是这样（工作空间/Config 收底），✅ 无需动。
6. **徽标语义分层**：Discord 白胶囊=未读、红数字=提及（两个注意力等级）。我们已有红色计数+结果圆点分层，方向对，视觉可微调。

## 4. 方向建议（数据支撑）

- **R1 · M3 标签轨（72px）**——治本：标签解决抽象目的地、宽度进区间、药丸激活换掉填充块、＋改实心 tint（FAB 语义）。代价：左栏收起态宽 46→72（+26px，展开 LeftDock 264px 不变）。
- **R2 · VS Code 指示条（56px）**——最小结构改动：宽度 46→56 刚好进区间，激活改左 2px 指示条+提亮，＋实心化。但无标签救济，图标字形必须换得更具象才撑得住。
- **不推荐 Discord 式（无标签大圆标）**：其成立前提是图标=身份头像；我们是功能轨，学它等于回到「靠猜」。

共同前置：**图标字形重描**（1.2-1.3px 线宽的线性 glyph，弃粗体气泡/放大镜）——无论选哪个方向都需要，这是「会话/搜索按钮丑」的直接来源。

## 5. 初步结论（通用 UI 系统参考系）

推荐 **R1（M3 标签轨 72px）**：唯一同时治三层病根（宽度/标签/激活态+虚线）的方案，且 M3 spec 给了完整落地参数（80dp 可折到 72、标签 1-2 词、药丸 hug 内容、命中区全宽、badge 两档）。R2 作为「不想动布局」的保守选项保留。

## 6. 参考系切换：AI 产品导航调研（用户指定方向，2026-11-04 补）

用户要求参考系从通用 UI 系统（M3/VS Code/Discord）改为 **Codex、Claude 等 AI 产品**。结合仓库已有 `2026-10-22-left-rail-industry-survey.md`（六家）+ 本次新查：

| 产品 | 左侧导航形态 | 收起态 | 关键事实 |
|---|---|---|---|
| **Claude Code desktop**（2026-04-14 重设计） | **全标签侧栏**：会话列表为中心，可按状态/项目/环境过滤、按项目分组；PR 合并自动归档；⌘+; side chat 分支 | 完全隐藏（0px） | 官方文章《Redesigning Claude Code on desktop for parallel agents》；无图标轨 |
| **Codex desktop**（2026-02 发布，Win 2026-03） | **全标签侧栏**：顶部 workspace 切换器 → New chat / Search / Plugins / Automations / Codex mobile 固定项 + Pinned/Chats/Projects/Agents(live 点)/Sites → 底部 Profile/Usage/Settings | 完全隐藏 | **issue #27042：用户主动请求「固定导航项图标紧凑模式」+隐藏低频项——未被采纳**；AI 产品明确选择可读性优先 |
| **ChatGPT desktop**（合并版） | 可收起标签侧栏：顶左 Chat/Codex 模式切换 + 会话列表/Projects | 完全隐藏 | 非图标轨路线 |
| **opencode desktop v2** | Home 屏（项目列表）+ 会话 tabs，无常驻左轨 | — | 上游自己的桌面形态 |
| **Cursor 3.x** | Agents Window 左面板（标签列表） | — | VS Code 基座但 agent 面板是标签列表 |
| **Kimi / Grok** | Web / TUI | — | 无桌面轨形态 |

**核心发现：没有任何 AI 编码产品用图标轨做主左导航。** 图标轨是 IDE 范式（VS Code activity bar），我们从 IDE 隐喻继承了它。AI 产品的共性选择：

1. **侧栏=会话/项目列表**（内容自解释，标签承载语义），不是「面切换器」
2. **收起态=完全隐藏（0px）**，不是中间态图标轨；恢复靠角落按钮/快捷键
3. **可读性 > 空间节省**：Codex 用户要图标模式，官方不批——方向与我们「46px 挤」的问题相反

**我们的真实差异**：左 dock 是多面结构（讨论/搜索/便签/资源，VS Code 式 faces）+ presence 层（attention badge/审批/连接点）。AI 产品侧栏是单一会话列表，没有面切换问题。§5.26 后「资源」已可由工作空间 Home 承载，讨论面≈Claude 侧栏（会话列表），搜索/便签是独立工具面。

## 7. 修正后的方向（AI 产品参考系）

- **A-I · AI 对齐·隐藏式**：收起态 = 完全隐藏（0px）——Ctrl+B / 边缘悬停 / 顶栏角落按钮展开；attention/presence 徽标转移到 topstrip。最贴 Claude/Codex/ChatGPT，省全部 46px；代价：presence 层搬家、面切换恢复是两步。
- **A-II · 混合·标签轨**（= 通用参考系的 R1，72px M3 标签轨 + 字形重描）：保留 VS Code 式多面结构的存在感层，吸收 AI 产品「可读性优先」（标签恒有）。保守增量路径。
- 两者可组合分阶段：先 A-II 治视觉，后续评估 A-I 是否值得（取决于搜索/便签面的实际使用频率）。

## 8. Pod 注意力到达面审计（rail 决策的前置，2026-11-04 实读代码）

问题：「pod 如何接收注意力」——attention 信号现在从哪些面到达用户？（决定 rail 徽标是否不可替代）

| 到达面 | 触发/时机 | 主动 or 被动 | 代码依据 |
|---|---|---|---|
| **IconRail 资源徽标**（数字） | `pod.updated` SSE → `ingestPodEvent` → store 刷新 | **被动·静默**（无 toast/通知，数字自己变） | `MafwShell.tsx:1920 podBadgeCount`；只计人类 attention（待批计划/问题/方向） |
| WorkspaceHome 工作概览 `needs_you` 桶 | 打开工作空间 Home 时拉取 | 被动（要导航过去） | `WorkOverview.tsx:9` |
| Tech Lead 邀请横幅 | **仅当活动 tab = Lead 会话**，composer 上方 | 半主动（依赖你开着 Lead） | `MafwShell.tsx:2016 activeLeadGoalInvite` → `PodTechLeadInvite` |
| Lead 会话消息（milestone-push/handoff） | goal 里程碑推进时 promptAsync 到 Lead 会话 | 半主动（需开着 Lead tab；消息进历史） | `milestone-push.ts` |
| GoalDetailOverlay attention 落点 | 点击后 | 被动 | `attentionTarget` |
| **结果事件（非 attention）** | `pod.updated {kind:'result'}` | **主动·完整链**：toast（可见时）+ OS 通知（`notifyIfHidden`，隐藏时）+ 通知点击回焦打开 Goal 详情 | `MafwShell.tsx:1935 handlePodResultEvent` + `podResultQueue` |
| 审批/权限（gateway 级） | permission.asked | 主动：OS 通知 + 托盘计数 | `notify` 注入 + `tray-status.ts`（30s 轮询，**不含 pod attention**） |

**核心发现：pod attention（待批计划/问题/方向裁定）是所有人类阻塞信号里唯一没有主动通知链的**——审批有 OS 通知、结果有 toast+OS 通知+点击回焦，attention 只靠 rail 徽标数字的静默变化 + 用户主动看工作空间。

**对 rail 决策的影响**：
- 若不补通知链：rail 徽标是 attention 的**唯一常驻视野面** → 保留条（72px 或 presence 窄带）有硬依据；
- 若补上 attention 通知链（对齐结果事件：toast + `notifyIfHidden` + 点击落点）：主动信号有兜底 → rail 徽标降级为概览指示 → 0px 隐藏式变得可行。
- 结论：**attention 通知链是独立于 rail 的必补洞**（无论 rail 选什么）；补完后 rail 决策自由度大增。


