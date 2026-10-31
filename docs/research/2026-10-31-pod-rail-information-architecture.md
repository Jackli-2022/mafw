# 左栏鲸群面的信息组织：深度调研

- 日期：2026-10-31
- 目的：输入框移出左栏后，确定「名册 / 目标 / 计数 / 最近消息」如何组织、密度多少、顺序如何
- 相关实现：`packages/desktop/src/renderer/mafw/components/PodRailFace.tsx`、`pod-rail-face-model.ts`、`pod-rail-badge.ts`
- 相关 spec：`docs/superpowers/specs/2026-10-30-pod-left-rail-design.md`

## 0. 结论先行

1. **顺序应该从「班底优先」改成「待办优先」**：Apple HIG 要求侧栏层级 ≤2 层、Material 3 用 section label 分组；Slack Activity / Linear Inbox / Devin Agent Command Center 三家都把「要你处理的」放在最上。用户当前选的 A（名册优先）在**只有名册**时成立，一旦加入最近消息，班底就退化成"背景信息"，把待办压到底部不合理。
2. **最近消息用单行**（`来源 → 目的地 · 摘要… · 时间`），5 条，34px/条；两行预览只在宽面板（右栏）用。
3. **每个成员行只加一个数字**（名下未完成任务数），不加第二条状态词；状态点已经表达"在忙/待命"。
4. **计数条不是导航，是过滤器**：三项分别对应右栏任务板/邮箱的筛选入口，点击后滚动 + 高亮，不是单纯"打开面板"。
5. **空态必须给下一步**（NN/g 渐进披露的"机制必须明显"）：无 Pod → 创建；无最近消息 → 一行灰字「还没有交接」；离线 → 重试。

## 1. 调研对象与来源

| 对象 | 来源 | 取到的关键事实 |
|---|---|---|
| Apple HIG · Sidebars | developer.apple.com/design/human-interface-guidelines/sidebars（2026-06-08 更新） | **侧栏层级 ≤2 层**；超过两层改用 split view；两层时用简短分组标题 |
| Material 3 · Navigation drawer | m3.material.io/components/navigation-drawer/guidelines | 抽屉可有 **section label / divider / badge**；图标要么全有要么全无；标签要短到不被截断 |
| Material 3 · Lists | m3.material.io/components/lists/guidelines | 紧凑断点可减少内边距；**展开断点才显示 supporting text**（即"两行"是宽屏特权） |
| NN/g · Progressive Disclosure | nngroup.com/articles/progressive-disclosure；2026 分析里的 "workbench test" | 用户应能在**不打开二级面板**的情况下完成约 80% 的高频任务；每多一层披露，点击翻倍、可发现性减半 |
| Slack · Activity view | slack.com/help/articles/46751260742035 | 统一收件箱；**Detailed / Dense 两档密度**；DM 徽标显示**未读会话数**而不是消息数；清除通知=标记已读 |
| Linear · 2024 UI redesign | linear.app/changelog/2024-03-20-new-linear-ui、linear.app/now/how-we-redesigned-the-linear-ui | 侧栏/表头/面板降噪；**Inbox 提升密度与对比度**；行是"标识 + 状态点 + 标题 + 右侧元数据"单基线 |
| Linear · 密度（第三方拆解） | buildmvpfast.com、designmd.cc | 13px 正文、行高 1.45、4px 栅格、**行高 32–36px**；"密度≠拥挤，小字要光学校正对齐" |
| VS Code · Agent Sessions | code.visualstudio.com/learn/foundations/agent-sessions-and-where-agents-run（2026-10-28） | 每行 = **名称 + 最近活动时间 + 未审阅改动数**；右键 archive/delete；可拖到 editor tab 并行看 |
| Devin Desktop · Agent Command Center | docs.devin.ai/desktop/agent-command-center、windsurf.com/changelog（2026-10-23） | 侧栏列出 workspace 内**全部 session**，可 **filter / sort / group**；运行中的 session **置灰只读**；收件箱列表行有**逐行复选框**批量归档；通知只在"完成或需要你输入"时发 |
| Cursor 2.0 | cursor.com/changelog/2-0 | 左栏 agent 列表取代项目树；每个 agent 有状态、进度、上下文 pills；最多 8 并行 |
| OpenAI Codex 桌面 | openai.com/codex + 桌面端评测 | 左栏竖排 agent；多线程 + 线程内 subagent |
| Agent team 消息语义（Claude Code 式） | claude-code docs / 社区实现文章（porting to OpenCode） | 广播 "expensive — scales with team size"；默认一对一；inbox 兼作审计日志；**markRead 批量回执** |

> 无法直连的页面（m3.material.io/components/lists、Apple sidebars 全文）当日抓取失败，采用了搜索摘要与第三方拆解，已在表中标注；涉及"行高 32–36px"等数值来自第三方逆向，不是官方规范。

## 2. 提炼出的 7 条法则

1. **层级 ≤2**（Apple）：侧栏不要出现「分组 ⊃ 子分组 ⊃ 条目」。我们只允许一级 section label。
2. **待办置顶**（Slack/Linear/Devin）：第一屏回答"要不要我动手"，第二屏才是"谁在忙"。
3. **单行优先，宽屏才两行**（M3 lists）：紧凑宽度下，支持性文字应折叠或省略；两行留给宽面板。
4. **徽标=待处理数，不是总数**（Slack DM 未读会话数、VS Code 未审阅改动数）：数字必须能归零，否则失去信号。
5. **每行一个主指标**（Linear）：标识 + 标题 + 一个右侧元数据；不要在一个行里塞状态词、任务数、时间三样。
6. **渐进披露必须有明显入口**（NN/g）：折叠的东西要有一眼可见的按钮/箭头；"最近消息"的「全部 ↗」就是入口。
7. **运行态要"锁"而不是"藏"**（Devin）：跑着的成员置灰但仍可见（我们的 `active` 行背景 + 状态点已符合），不要因为忙就把行移走。

## 3. MAFW 现状（当日实读）

### 3.1 当前左栏面结构（`PodRailFace.tsx:124-213`）

1. 头部：`鲸群` + 状态 pill + 刷新
2. 五态空/错分支（loading / error / unsupported / worktree / create）互斥
3. 成员三卡：色点 + `名字 + agent 名 + 状态词` + `会话中 · 标题` + `打开会话 ↗`
4. goal 卡：`goalId 短码 + status`
5. 计数条：`待审 N / 待办 N / 邮箱 N`（三项都只打开右栏面板）
6. ~~输入区（已决定移除）~~

### 3.2 可用数据（无需新接口）

| 字段 | 来源 | 粒度 |
|---|---|---|
| 成员 role/status/displayName/agentName | `PodDetail.members` | 3 人 |
| 成员→活跃 session | `PodDetail.sessions`（`endedAt === null`） | 每人 0..n |
| 会话标题 | `sessionStore.session` | 按 id |
| 任务 status/ownerMemberId/title | `PodDetail.tasks` | 全部 |
| goal id/status | `PodDetail.goals` | 全部 |
| 消息 from/to/kind/body/readAt/protocol/deliveredAt/createdAt | `podStore.messages()`（`GET …/messages`，最近 100 条） | 足够做"最近 5 条" |
| pod status | `PodDetail.pod.status` | 单值 |
| 花费 | `podStore.cost()` | 单值（**当前左栏未用**） |

**结论**：**不需要任何新接口**就能做出下面的方案；缺的只是"组织方式"。

### 3.3 现有的三个隐患（本次要顺手修掉）

1. 计数条三项行为完全相同（都 `onOpenPanel`），参数 `panel` 只用于滚动目标；"待审/待办"和"邮箱"在语义上应分开（前两者=任务板筛选，后者=收件箱）。
2. 成员行右侧 `打开会话 ↗` 在无会话时禁用——但整行不可点，导致"看到 Reviewer 待命却点不动"。
3. 状态词（工作中/待命）与状态点重复；而真正缺失的"该成员名下还有几个活"没有。

## 4. 高度预算（264px 宽 × 640px 可用高）

| 区块 | 单块高 | 数量 | 小计 |
|---|---|---|---|
| 头部 | 28 | 1 | 28 |
| 「待我处理」组标签 | 16 | 1 | 16 |
| 计数行 | 30 | 1 | 30 |
| 「班底」组标签 | 16 | 1 | 16 |
| 成员行 | 40 | 3 | 120 |
| goal 卡 | 30 | 1 | 30 |
| 「最近」组标签 + 全部入口 | 18 | 1 | 18 |
| 最近消息（单行） | 34 | 5 | 170 |
| 间距 | 8×6 | — | 48 |
| **合计** | | | **476** |

640px 可用高下余 ~160px；窗口 520px 高时会溢出，走现有 `overflow-y: auto`。**5 条是上限**，再多就滚动了（滚动没问题，但不该默认要求滚动）。

## 5. 三个候选结构

### 方案 A：名册优先（当前 + 最近消息替换输入区）

```
鲸群 · 活跃 · ⟳
[Lead 卡] [Builder 卡] [Reviewer 卡]
goal 卡
待审 2 · 待办 3 · 邮箱 1
最近
  Lead → Builder  wave 3 回执收到…  8 分
  …
发送在右侧 › 邮箱
```
- 优点：改动最小；与用户先前选的 A 一致
- 缺点：待办在第三屏；成员卡占 120px 却信息量低（无会话时三行全是"待命"）；违反"待办置顶"

### 方案 B：待办优先（推荐）

```
鲸群 · 活跃 · ⟳
待我处理
  [待审 2] [待办 3] [邮箱 1]      ← 点击 = 右栏筛选
班底
  Lead      manager       会话中 · 拆解 goal     2   ↗
  Builder   mafw-execute  会话中 · wave 3        3   ↗
  Reviewer  mafw-review   待命                   —   ↗
goal  goal_9f3c21a0 · active
最近                                  全部 ↗
  Lead → Builder   wave 3 回执收到…            8 分
  Builder → 广播   types/api.ts 改了…         32 分
  Reviewer → Lead  loop 1 验收通过…          1 小时
  …（共 5 条）
```
- 优点：符合三家"待办置顶"；成员行去掉重复状态词、加任务数后信息量翻倍；最近消息补足"最近发生了什么"
- 缺点：需要重排现有 DOM 与 CSS；成员行右移的数字需要 `tasks` 聚合（已有数据）
- 高度：仍 ~476px

### 方案 C：单活动流（Devin 式）

所有事件（交接、任务状态变化、goal 切换）拍平成一条时间线，成员缩成顶部三个头像点。
- 优点：最有"指挥台"感，密度最高
- 缺点：需要新的"事件流"数据（当前只有消息和任务快照，没有事件历史）；成员的"谁在忙"被弱化；实现成本是本批 2–3 倍
- 结论：**不选**，作为后续（若引入 `pod_events` 表再议）

## 6. 推荐：方案 B + 四个细节

1. **顺序**：`待我处理 → 班底 → goal → 最近`（对应 Apple ≤2 层：四个同级 section）
2. **成员行**：`名字 · agent 名（mono，超长省略） · 当前动作 · 未完成任务数 · ↗`
   - 状态点保留（色 + 虚线休眠）；**移除**重复的状态词
   - 未完成数 = `pending|in_progress|blocked|review|reopened` 且 `ownerMemberId === 该成员`；0 显示 `—` 而非 `0`（避免噪音）
   - 无会话时整行不可展开，但 `↗` 仍可见置灰（现状）
3. **计数条**：三项都带 aria `待审 2 项`；点击 = 打开右栏 + 滚到对应区块（现状已实现滚动，补上"任务板筛选"后续再做）
4. **最近消息**：单行 `来源 → 收件人 · 摘要（省略） · 相对时间`；未读行左侧 accent 竖线 + 圆点；点击 = 标记已读 + 打开右栏并滚到该条；底部「全部 ↗」打开右栏邮箱
5. **空态**：无消息时一行灰字「还没有交接消息」+ 「全部 ↗」仍可点（进入右栏空邮箱）

## 7. 不做什么

- 不做筛选器/排序器（Devin 有，但那是 100+ session 的场景；我们固定 3 人 + 5 条）
- 不做多选/批量归档（同理）
- 不在左栏显示花费（`cost` 留在右栏概览，左栏已有 goal/任务两块，再加会破 640px 预算）
- 不做 Kanban（方案 C 的简化版已在右栏任务板）
- 不引入 `pod_events` 表（方案 C 的前置条件，本批不做）

## 8. 验收标准

- 640px 高窗口下：无滚动即可看到 `待我处理 + 三名成员 + 最近 3 条`；出现第 4 条时才需要滚动
- 每个区块都有 section label，层级 ≤2（只有一级分组）
- 角标数字（rail）与「待我处理」三项之和一致（读屏名同样）
- 键盘：Tab 可依次到达 计数三项 → 三个 ↗ → goal → 五条消息；Enter 触发与点击一致
- 空态/错误/不支持/worktree 四态互斥且有下一步动作
