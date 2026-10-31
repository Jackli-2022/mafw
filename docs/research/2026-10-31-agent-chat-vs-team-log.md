# 人机对话 vs 团队消息日志：业界怎么切

- 日期：2026-10-31
- 触发问题：chatview 里跟某个 Pod 成员直接对话，要不要同时写一条 Pod 消息（让右栏邮箱/左栏「最近」看得到）？
- 结论：**不镜像**。业界把「会话 transcript」和「协调日志（inbox / 任务记录）」当两种不同性质的产物；自动镜像会污染日志，并破坏「未读 = 要你动手」的语义。

## 1. 直接可比的三个产品

### Claude Code Agent Teams（最接近我们的形态）

来源：`code.claude.com/docs/en/agent-teams`、社区实测（alexop.dev / getclaudeskills / aibuilderclub）

- **人 → 某个 teammate**：在 agent panel 里选中该 teammate，Enter 打开**它自己的会话**，「你敲的任何东西直接进那个 teammate，而不是 lead」（in-process 模式）；split-pane 模式则是点进那个 pane。
- **teammate → teammate**：用 `SendMessage` 写进 `.claude/teams/<team>/inboxes/<agent>.json`，在收件人下一轮被注入成 `<teammate-message teammate_id="…">`。
- 关键细节：**teammate 空闲时只发 `idle` 信号，不携带产出的内容**；产出必须显式 `SendMessage` 或被写进共享任务列表才能被 lead 看到。

→ 也就是说：**人机的对话留在会话里；inbox 只承载 agent 之间结构化的协调消息**，两者不互相复制。

### Devin（Devin Desktop / Agent Command Center）

来源：`docs.devin.ai/desktop/agent-command-center`、`docs.devin.ai/get-started/devin-intro`

- 一个 session 本身是"对话式界面"（你与 Devin 的往返）；
- **Agent inbox** 是另一层：只在"完成或需要你输入"时提醒，可批量归档，带逐行复选框；
- 没有"把聊天同步进收件箱"的机制——要进收件箱，得是那个 agent 明确需要你处理。

### Slack（人类协作的参照）

- DM 与频道是**两种会话容器**，消息只存在于它被发到的那个容器；
- 想跨容器传播要靠**显式转发**（forward / 分享到频道），没有自动镜像；
- 通知语义也是"未读会话数"，不是消息条数。

## 2. 为什么不该镜像（文献层面）

- 一篇多 agent 协调综述把区别讲得最清楚：**日志可以被重读来重建"当时什么是真的"；transcript 只能重建"当时谁相信/宣称了什么"**。协调日志（append-only）是状态事实源，transcript 是观点记录。
- 同一批资料反复强调 broadcast 是"昂贵操作，成本随团队规模增长"，inbox 兼作审计日志——日志的价值来自**低噪音**。

映射到 MAFW：`pod_messages` 是协调日志（handoff / receipt / decision / escalation），`pod_sessions` + runtime 的 session transcript 是对话记录。把 chatview 的每句话灌进 `pod_messages` 会让：

1. 左栏「最近」被闲聊刷满，「未读」不再等于"要我动手"；
2. `[POD HANDOFF]` 注入块变长（每个成员下次被 prompt 时都要读一遍噪音）；
3. A2A link / deliveredAt 这些投递语义失去意义（对话没有"投递"概念）。

## 3. 建议

**默认不镜像**，只给一个**显式的提升动作**（把某条对话变成协调记录），对应 Slack 的"转发到频道"：

- 在 chatview 的消息气泡上加一个次要动作「记入鲸群」（或 composer 上一个可勾选项），点了才写 `pod_messages`（`kind: note`，正文用该条消息摘要 + 一个指向 session 的 ref）；
- 不自动、不批量、不反向（Pod 消息不会灌进 session transcript 的历史里，只在下次 prompt 时作为 `[POD HANDOFF]` 进入）；
- 文案上明确：chatview = 跟这个成员 1:1 说话；邮箱 = 团队协调记录。

## 4. 来源
- Claude Code agent teams: https://code.claude.com/docs/en/agent-teams
- 社区拆解（Agent Teams 交互与 SendMessage）：alexop.dev「From Tasks to Swarms」、getclaudeskills「Agent Teams Explained」、aibuilderclub「Agent Teams Guide」
- Devin Desktop / Agent Command Center: https://docs.devin.ai/desktop/agent-command-center
- 协调日志 vs transcript 的论述：agility-at-scale「Coordination Substrate Before Topology」、claudepedia「Multi-Agent Coordination」
- Slack 转发/频道语义：slack.com/help（频道与 DM 分离、Activity 未读会话数）

## 5. 追加调研：必须是「用户主动点」吗？

结论：**是，但要给它一个看得见的入口**。分三层看。

### 5.1 行业里「显式 vs 自动」按产物分档

| 产物 | 机制 | 例子 |
|---|---|---|
| 个人记忆 | **自动 + 手动并存** | ChatGPT Memory：自动捕获（模型判断偏好/身份/项目状态）+ **任意消息旁的 Save 图标**手动存；界面上可查看/纠正/删除 |
| 团队可见记录 | **显式** | Slack 转发/保存到 Later；GitHub「Reference in new issue」；Linear 从消息建 issue |
| agent 间协调 | **由 agent 显式发起** | Claude Code 队友只能靠 `SendMessage` 汇报；空闲信号不携带产出 |

映射到 MAFW：`pod_messages` 是**团队可见记录**，落在第二档 → 显式；而「agent 自己想记」这条通道已经存在（`mafw_pod_message` 工具），不需要平台替它自动镜像。

### 5.2 但「右键菜单」是最差的显式入口

NN/g 关于上下文菜单的两条直接命中：

- 隐藏菜单**可发现性差**：「除非用户已经知道能右键，界面上没有任何东西告诉他这些动作存在」；
- 给出的对策是 **(1) 给一个可见触发点**、**(2) 允许同样的动作换一条路做**。

Slack 的做法是被反复引用的正例：**hover 出一条动作栏 + 三点「更多」**——入口本身不隐藏，只有完整菜单隐藏。Apple HIG 也要求上下文菜单里的动作配熟悉图标。

所以「记入鲸群」现在的形态（只有右键）在机制上正确、在可发现性上不合格。

### 5.3 可选入口的取舍

| 入口 | 可发现性 | 成本 | 评价 |
|---|---|---|---|
| 右键菜单（现状） | 低 | 已有 | 保留作第二路径 |
| **消息 hover 动作栏里的图标按钮** | 高（Slack 同款） | 需 session-ui 增加一个 assistant action + ChatPane 透传 | **推荐** |
| composer 旁的「记上一句」 | 中 | 需要定义"记哪条" | 不做：单位应该是消息而不是会话 |
| 斜杠命令 `/记入鲸群` | 中（熟手） | 便宜 | 可做备选，非必须 |
| 自动镜像 + 撤销提示 | 高 | 低 | **不做**：污染日志、破坏未读语义（见 §2） |

### 5.4 一句话

用户主动点是**对的**；要修的是「只在右键里」这件事——补一个 hover 就能看见的入口，右键菜单继续留着给熟手。
