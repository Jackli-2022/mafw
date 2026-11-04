# 多信道分层 × 信息分级：Super-agent 与业界实践调研

日期：2026-11-04
目的：为 MAFW Pod「事件层」定形——解决「test goal 跑完了，人不知道」与「Lead 只有人说话才读消息」两个被动性问题。
范围：只做参考调研与现状差距分析，不含实现决定。

---

## 0. 结论摘要

1. **多信道分层的本质不是「接更多入口」，而是「按信道的注意力成本定制输出密度」**。Super-agent 的做法是：Worker 的推理与工具调用永不出现在外部信道，对外只由 Router 说话；IM 类同步信道硬性 ≤100 词、只在需要决策/验收时开口，GitHub/邮件类异步信道写完整结构。
2. **信息分级的本质是「每条打断都必须挣得」**。业界的稳定解是三档：Critical（立即打断）/ Warning（及时但不打断）/ Info（不推，进 digest 或只记日志），并且**在架构上让不可行动的事件根本不进通知通道**——不是先发再过滤。
3. **通知必须带「为什么找你」的理由**。GitHub 的 `reason`（mention / review_requested / assign / author / ci-activity / state-change…）是这件事最成熟的产品化，且 inbox 有 Done / Saved / Unread / Unsubscribe 四态 triage。
4. MAFW 现状的缺口不在「通知能力」，而在**事件没有身份**：Goal 完成只是 Goal 行上的一个 boolean + rail 上一个小点，没有一条可读、可等、可 triage 的条目；也没有「该叫醒 Lead」这个中间态。

---

## 1. DeepSeek Super-agent：多信道分层的三层结构

来源：《Super-agent 设计探索：迈向更自主的 Agent 系统》（DeepSeek Harness，2026-10-31）；原型 `deepseek-ai/dsh-superagent-prototype`。

### 1.1 讲什么、在哪讲（信道 = 注意力成本）

| 层 | 职责 | 信道规范 |
|---|---|---|
| Router | 唯一对外说话者，维持跨信道连续性 | 按信道定制：IM 只问直接问题、给短结论、**单次 ≤100 词**；GitHub/邮件/文档写完整背景 + 改动 + 验证 |
| Worker | 上下文隔离执行 | 推理过程与密集工具调用**只在 Worker 内**，不输出到外部信道 |

关键判断：如果沿用单人终端的输出方式（长篇推理 + 工具日志）进群聊，在多人协作里必然信息过载。**分层的价值是把「噪音」关在 Worker 里，把「结论」留给信道。**

### 1.2 事件路由：订阅即直通

- Thread = 同一个 PR / 同一个 IM 话题 / 同一封往来邮件串下的连续事件。
- Router 只在**新 Thread 冷启动**与跨任务协调时介入；已订阅的后续事件由程序**直通** Worker（Fast Path）。
- 未订阅事件才走 Router 判（Slow Path）。Worker 也可取消订阅、交回 Router 重分派。

### 1.3 事件过滤：程序先快筛，模型再慢判

- Fast Path（程序）：按来源、群组范围、用户/机器人白名单做确定性准入（「仅响应明确请求」/「作为候选」/「直接忽略」）。
- Slow Path（LLM）：只判通过快筛的候选，提示词即策略扩展点。
- 目的：高噪音、低触发率的环境里，避免每个事件都跑一次大模型。

### 1.4 其他可借用

- **投机执行**：正式任务下达前，根据环境信号在后台先做（先复现、先定位）。
- **主动行为默认 observe 不执行**（原型侧 Policy / observe 模式）：先影子运行，再放开。
- **外部 Watchdog**：进度停滞 / 偏离目标时介入。

---

## 2. 信息分级：业界可复用的四个机制

### 2.1 三档严重度（最广泛共识）

| 档 | 语义 | 投递 |
|---|---|---|
| Critical | 需要人做决策 / 硬失败 | 立即打断，全渠道 |
| Warning | 异常、软失败（已重试）、阈值 | 及时但不打断，单渠道 |
| Info | 常规完成、成功运行 | 不推；digest 或只记日志 |

配套两条纪律：
- **每条打断都必须是「你愿意被打断」的那条**（否则一周内被静音）。
- **Auto-resolution suppression**：agent 自己解决掉的问题，不通知，最多进 digest。

### 2.2 通知带理由（GitHub `reason`）

`mention` / `review_requested` / `assign` / `author` / `comment` / `participating` / `manual` / `ci-activity` / `state-change` / `team-mention` / `security-alert`。

三个可借用点：
- **默认过滤器 = 我被直接牵扯的几种**（assigned / participating / review requested / mention），其余默认沉底。
- **reason 是按 thread 覆写的**：后来被 @ 到，整条 thread 的 reason 升级为 mention。
- **inbox 四态 triage**：Done（清出主列表）/ Saved（永久保留）/ Unread / Unsubscribe（不再收，除非再次被 @）。

### 2.3 时机：批处理与断点

- Microsoft Research CHI 2016：把通知批到一天 3 次，认知表现改善。
- UC Irvine：一次打断平均 **23 分钟**才恢复专注；甚至「知道有通知来了」本身就影响持续注意力。
- **Breakpoint principle**（CMU）：任务自然断点（完成一步、想完一件事）的打断成本远低于中途。

对 Agent 的直接含义：**「完成」本身就是最好的断点**——Goal 跑完是天然的低成本通知点；节点中途状态不是。

### 2.4 架构性降噪 > 过滤

> "The most effective noise reduction is not filtering — it is architectural. Design agent workflows so that non-actionable events are never routed to notification channels in the first place."

即：不可行动的事件不进通知通道，只进 log / dashboard / digest。**每一实时通知都应绑定一个可立即执行的人类动作。**

### 2.5 前沿（2026）

- LLM 判断可打断性（LangAware；AHs '26《Using LLMs to Model Notification Timing》）：用自然语言上下文替代硬编码规则。
- 用户期望（MobileHCI 2026）：通知系统应**渐进披露细节**、给可行动 takeaway、把相关通知聚成一组。

---

## 3. 多信道产品实践

### 3.1 Devin（Slack）

- thread ↔ session 双向同步：thread 里的追问直接进同一个 session。
- **code channel**：一个 session 一个频道。频道名跟 session 标题、状态芯片 `working / blocked / done`、PR chips、live worklog。
- 工作变重时**自动搬家**：从 thread 迁到 code channel，原 thread 留一条「This session moved to #channel」通知。
- 人可随时 `!ask`（只问不干）、`!normal`、`!new`。

### 3.2 Slack Code（Claude Code / Copilot / Cursor 等）

- code channel 四个 tab：conversation / plan / diff / live preview。
- 完成后**自动归档**，但保留可搜索审计日志。
- 任何人都能 pause / redirect / stop。

### 3.3 Cursor Cloud

- 入口：Desktop / Slack `@cursor` / GitHub PR 评论 / Web / iOS。
- 一个 session 一个可分享 URL；队友打开时按他自己仓库权限校验。

### 3.4 共性

| 共性 | 含义 |
|---|---|
| **一个任务 = 一个可寻址对象** | 有 URL/频道/标题，不寄生在某个会话流里 |
| **状态是对象属性，不是消息** | `working/blocked/done` 是可查询状态，不靠人翻记录 |
| **噪音关在容器里** | worklog 在 channel 内，不刷主对话 |
| **归档不等于删除** | 完成后自动收起，但审计可查 |

---

## 4. 映射到 MAFW：现状与差距

### 4.1 已有零件（真实代码位置）

| 能力 | 位置 | 现状 |
|---|---|---|
| 人类阻塞点投影 | `gateway/src/core/pod/pod-stage.ts` | `owner = person \| team \| system`；只有计划批准/提问/状态损坏算 person |
| Goal 视图 | `gateway/src/core/pod/pod-view.ts` | `resultReady = terminal && hasResultEvidence` |
| 五桶 | `gateway/src/core/pod/pod-work-stage.ts` | `needs_you / queued / in_progress / result_ready / ended` |
| rail 徽标 | `packages/desktop/src/renderer/mafw/pod-rail-badge.ts` | 数字**只算 attention**；结果另走 `podResultBadge = resultReady && !viewed` |
| rail 小点 | `packages/desktop/.../components/IconRail.tsx` + `MafwShell.tsx podResultDot` | 鲸群图标一个小圆点 |
| OS 通知 | `MafwShell.tsx handlePodResultEvent` → main `Notification` | **仅主窗口隐藏时** |
| Pod 消息投递 | `gateway/src/core/pod/pod-message-delivery.ts` | `decide()` 只有三种：live coordination→push / 否则 pending（节点运行时 pull） |

### 4.2 差距（对应用户实证）

1. **事件没有身份**：Goal 完成 = 一个 boolean + 一个点，没有「一条等你查收的条目」。
2. **没有唤醒中间态**：Lead 只有「live 会话 → push」和「否则 pending → 下次 prompt 才 pull」；缺「这件事该主动叫醒 Lead」。
3. **信号太弱且位置错**：数字不计数、点会被忽略、OS 通知只在窗口隐藏时发（人正看着屏幕时反而什么都没有）。
4. **没有 reason**：不知道「为什么叫我」——是结果、是决策、还是软失败。
5. **没有 triage**：不能标记已读/已处理/稍后，条目只有「点开」一种出路。
6. **决策摘要自留却套了送达语义**：`finishPodGoal` 写 `kind:decision` 给 Lead 自己，`delivered_at` 永远为空，UI 显示「待送达」。

### 4.3 两个维度的交叉（建议形态，未决）

**信息分级**（谁需要动）：

| 级 | 例子 | 该叫醒谁 | 该打断人吗 |
|---|---|---|---|
| P0 决策 | 计划批准、提问、方向裁定 | 人（Lead 代收无效） | 是，全渠道 |
| P1 结果 | Goal PASS/FAIL、可打回结果、artifact | 人（查收，不阻塞） | 否，条目 + 角标 + 非前台时 OS |
| P2 协作 | Builder/Reviewer 发给 Lead 的阻塞、失败可重试 | **Lead** | 否 |
| P3 进度 | 节点 started/finished、心跳 | 无人（仅轨迹） | 否 |

**信道分层**（在哪说、说多少）：

| 信道 | 放什么 | 输出密度 |
|---|---|---|
| chat 流 | P0/P1 一句话摘要；不刷 P3 | 最短（≤1 行） |
| 工作台 inbox | P1 全量条目 + P0 未处理 | 结构完整（结论/证据/动作） |
| rail 徽标 | 数字 = P0；小点 = P1 未查收 | 极简 |
| OS 通知 / tray | P0 立即；P1 仅非前台 | 标题 + 一句 |
| Pod 邮箱 | agent↔agent 内部信道 | 人不看，除非被指向 |

**唤醒策略**：两级过滤——程序规则（谁发给谁、kind、是否已处理、是否在跑）先筛，只有 P2 候选才交给 Lead 慢判；加每 Goal 每小时的唤醒预算，防抖。

---

## 5. 开放问题

1. 用户实际会看几个信道？（只有桌面时，「多信道」= 应用内多面 + OS 通知，不必引入 IM/GitHub）
2. P1（结果就绪）要不要主动出声？还是纯安静条目？
3. 唤醒预算怎么定？（每 Goal 每小时 N 次 / 每 Pod 每小时 N 次）
4. Lead 慢判是否值得成本？还是 P2 全部程序规则唤醒（更可预测）？
5. `kind:decision` 自留消息的 UI 语义（归档记录 vs 待送达）。

---

## 参考

- DeepSeek Harness《Super-agent 设计探索：迈向更自主的 Agent 系统》，2026-10-31
- `github.com/deepseek-ai/dsh-superagent-prototype`（MIT，研究原型）
- GitHub Docs：About notifications / Reasons for receiving notifications / Triaging notifications
- Microsoft Research, *Email Duration, Batching and Self-interruption*, CHI 2016
- CMU HCII：breakpoint principle（interruption cost 与任务断点）
- UC Irvine：23-minute refocus cost
- Gravity, *How to Set Up AI Agent Notifications*（三档严重度）
- Zylos, *Agent Notification Intelligence*（auto-resolution suppression / 架构性降噪）
- ACM AHs '26, *Using LLMs to Model Notification Timing from Context-Sensitive Features*
- MobileHCI 2026, *"I Want It to Do More Than Deliver"*
- Devin Docs（Slack / code channels）；Slack Code API Blog（2026-10-28）；Cursor Cloud Agents Docs
