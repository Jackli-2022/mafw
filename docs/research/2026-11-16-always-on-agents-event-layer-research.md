# Always-on Agents 与事件层调研（2026-11-16）

- 状态：调研完成（web + 官方文档；未改产品代码）
- 范围：Claude / Anthropic、DeepSeek Super-agent，以及 OpenAI Codex、Cursor、OpenClaw 等相邻形态
- 关联：`docs/research/2026-11-02-dsh-superagent-vs-mafw-pod.md`、`docs/research/2026-11-04-superagent-multichannel-info-grading-research.md`、`docs/architecture/events.md`
- 结论一句话：**Always-on 不是“一直跑”，而是“大部分时间睡着，事件到达时短暂醒来”；真正的难点是事件收件箱、定时器、跨 run 记忆、权限和 outbox，而不是模型循环。**

---

## 0. TL;DR

1. **Anthropic 把 always-on agent 拆成五个原语**：event inbox、timers、memory、permissions、outbox。事件必须先进入耐久 inbox，不能直接调 agent；timer 只负责把事件放进 inbox；outbox 负责“结果而不是过程”的交付。
2. **DeepSeek Super-agent 的核心不是“多 agent”，而是把人从 session 里解放出来**：一个人的注意力只能同时跟 3–5 个活跃 session；所以用持久 Router（只做交互/路由/全局记忆）+ 多个隔离 Worker（真正执行），并用 Thread + Subscription 把后续事件直接送到 Worker，避免 Router 成为瓶颈。
3. **两家都同意“注意力是预算”**：Agent 只在被请求、命中规则、或结果/决策/失败需要人时说话；IM 回复要短（DeepSeek 实践中 ≤100 词），健康状态不占主面。
4. **DeepSeek 的事件层是“程序快筛 + 模型慢判”**：先按 source/allowlist/规则做确定性过滤，只有候选事件才调用模型；这比“每条事件都跑一次大模型”便宜且稳定。
5. **Claude 的 always-on 产品已经在做“每几小时检查一次”，不是非 stop**：Duet 明确说 nonstop 会更快耗尽套餐额度；Dispatch 要求主机保持运行；Channels 把 CI/告警/webhook 注入同一个 live session。
6. **MAFW 的事件层已经有 80% 的骨架**：source / trigger / thread / subscription / decision / delivery / outbox 表都在，且现在默认开启；decision draft → Lead context 也已经打通。
7. **但 MAFW 还缺“一个收件箱、一个 dispatcher、一个预算”**：`PodEventWake` 和 event layer 是两条唤醒路径；Lead 现在直接 `promptAsync`，没有走 `event_outbox`；没有 agent-set follow-up timer；没有 Lead run ledger；没有统一的 read/ack。
8. **不要照搬 DeepSeek 全套**：它的公开仓库是 research prototype，不是官方产品；没有默认 sandbox，presets 甚至 `danger-full-access`；MAFW 应保留确定性 NodeDriver、独立 Reviewer、human-only 验收和既有记忆系统。
9. **对 MAFW 的最小正确下一步**：把 Lead 播报收敛为“事件层 inbox → Lead outbox → 预算/合并/去重 → Lead chat”，而不是继续在 `DecisionRecordService` / `PodEventWake` 各自直连 `promptAsync`。
10. **中期再做**：agent-set timers、run ledger、per-run memory snapshot、独立 watchdog、deferred approval events；这些是 always-on 从“能播报”到“可持续运行”的分水岭。

---

## 1. Anthropic：always-on agent 的五个原语

来源：Anthropic, *Building always-on agents*, 2026-11-13
<https://claude.com/resources/articles/building-always-on-agents>

### 1.1 它不是“一直跑”

文章开篇就纠正：

> An always-on agent is not actually “always on.” This is just a description of the user experience. In reality, the agent spends most of its time asleep, waking up periodically to do work.

一次 work 叫 **run**：收到事件 → 开/续 session → agent loop → 把结果写回持久状态 → 睡回去。真正需要持久化的是 **event inbox、timers、memory、outbox**，不是常驻的模型进程。

### 1.2 五个原语

| 原语 | 职责 | 关键约束 |
|---|---|---|
| **Event inbox** | 所有 source（webhook / schedule / background job / 用户消息）先写耐久表，再由 worker 取 | handler 快速 ack；inbox 是 source of truth；同一 inbox 只能有一个 active worker；按 source 唯一 id 去重；可批量合并 pending events |
| **Timers** | follow-up（agent 自己设的检查点）与 schedule（用户设的周期任务） | timer 不直接启动 agent；scheduler 轮询到期项 → 写 inbox → 唤醒 worker |
| **Memory** | 跨 run 的 instructions / user notes / past messages / task progress | 独立 store；每次 run 开头加载；只存“查不回来的东西”，其余存指针；可加 dreaming 做跨 session 整理 |
| **Permissions** | 无人值守时决定“自己干 / 拒绝 / 等人批准” | 凭证代理（agent 不接触真实 token）；auto-mode classifier；deferred tool call 把 run 挂起，等人回答后以事件恢复 |
| **Outbox** | 把结果交付给用户，而不是流式输出过程 | 独立表 + dispatcher；可做 pacing；建议先安静，再逐步“赢得”用户注意力；用 eval 调消息量 |

### 1.3 对上下文窗口的处理

- 每次 run 都带 system prompt + tools + memory 的固定开销；用 prompt caching 降成本。
- 新 session 只带 overhead + 触发事件；已有 session 带回完整 transcript。
- session 太长时压缩（compaction）或换新 session；两者都会丢细节，所以**需要持久化的内容必须在 run 中写回 memory**。

### 1.4 Claude 产品侧的对应形态

- **Claude Duet**（2026-10-21，research preview）：主动型 agent；每天早上给 brief；**每几小时检查一次连接的应用**（明确说 nonstop 会更快耗尽额度）；有需要时通知；有 VM + browser；发消息/付款/签文件/删除前必须批准；一个持续 thread。
- **Cowork Dispatch**（2026-03）：一个持久 session 跑在用户电脑上；可以从手机发消息；主机必须保持运行；sandbox + 逐步批准。
- **Claude Code Channels**：把 Telegram / Discord / CI / 告警 / webhook 注入同一个 live session，在同一个 thread 回复；这是“事件进入 live session”，不是完整的 inbox/router。
- **Claude Code scheduled tasks / cloud sessions**：定时/云端跑，关掉笔记本也继续；但仍是“trigger 启动一个 run”，不是持续常驻。

> 产品侧的共识：**always-on 的卖点是“需要时它已经在”，不是“每秒都在烧 token”**。

---

## 2. DeepSeek Super-agent：Router / Worker + 事件驱动

来源：
- DeepSeek Harness, *Exploring Super-agent Design: Towards a More Autonomous Agent System*, 2026-10-31（英文全文翻译：<https://offloop.org/learn/exploring-deepseek-super-agent-design>）
- `deepseek-ai/dsh-superagent-prototype` README / docs 000 / 003 / 007（MIT，research prototype）
- 二手摘要：CellCog、Developers Digest（用于实验数字与背景，非官方事实源）

### 2.1 问题定义：人的注意力是上限

DeepSeek 的起点不是“模型不够强”，而是：

> 一个人通常只能同时跟踪 3–5 个活跃 Session。单任务上限由模型能力决定；多任务上限由人的注意力决定。

所以它要打破“agent = 一个手动开始的 session”这个绑定，让 agent 成为**跨 session 连续、可并行推进多个任务、能主动响应环境事件、能持久运行**的实体。

四个特征：**Continuity / Efficiency / Proactivity / Persistence**。

### 2.2 两层：Router 与 Worker

| 层 | 职责 | 明确不做 |
|---|---|---|
| **Router** | 持久全局层；所有人机交互入口；跨任务协调；全局记忆；任务分派 | 不执行具体任务；可以没有 Bash；通常轻量模型即可 |
| **Worker** | 每个任务一个隔离 session + 工作目录；完整执行工具；订阅自己的 Thread；向 Router 报告 | 不直接对人说话；不把推理/工具调用直接发到外部频道 |

关键点：

- Router 是“全局序列点/协调点/记忆”，但不是“什么都自己干”的 Team Lead。
- Worker 之间一般不直接通信；它们通过订阅同一个 Thread 获得同一批事件，自行发现冲突。
- Session 变成实现细节，不再是用户要管理的东西。
- Router 的事件在推理期间会累积，下一轮 LLM call 一起处理，形成天然 batching；实测 1→40 trigger/min 时平均 batch 1.0→2.8，单请求 2.5→3.9s，摊薄到每个决策 6.4→1.6s（合成负载，初步实验）。

### 2.3 事件驱动：Trigger / Thread / Subscription

- **Trigger**：来自 IM、GitHub、邮件、日历、CI 的半结构化事件。
- **Thread**：同一 PR / IM topic / 邮件串下的连续事件流。
- **Subscription + 直接投递**：
  - 新 Thread 的第一个事件走 Router（Slow Path）；
  - Router 建 Worker 后，Worker 订阅该 Thread；
  - 后续事件由代码**直接投递**给 Worker（Fast Path），不再经过 Router；
  - 超出 scope 时 Worker 可以 unsubscribe / hand back。
- **两级过滤**：
  - 程序快筛：source、群范围、allowlist、规则 → 过滤掉大多数噪音；
  - 模型慢判：只有候选事件才让 LLM 判断是否行动。
- **Inline & Spill + Chain of Recall**：上下文只放 ID + 摘要 + 邻近内容；长内容溢出到外部，模型按引用链按需取回。
- **Speculative execution**：在用户还没确认前，后台先复现/准备修复/草稿；有价值才交付，没价值就安静丢弃。

### 2.4 人机交互：全双工 + 按渠道说话

- 异步 `start()` / `stop()` 工具：长命令立刻返回 Started，不阻塞前台；完成后作为新事件投回 session。
- IM 频道：只发决策/验收/失败；短（实践中 ≤100 词）；直接问一个问题。
- GitHub / 邮件 / 文档：结构化、高信息密度；完整问题/改动/验证。
- 一次只问一个结构化问题；草稿标未完成；失败就是失败。

### 2.5 计算、状态、执行环境分离

- Agent Loop 可以无状态、弹性伸缩；session state 持久化到数据库。
- 执行环境（本地仓库、未提交改动、私有凭证、内网服务）不强行搬到云；设备上只放轻量 daemon，按需执行命令。
- 支持 BYOM（Bring Your Own Machine）与云端 sandbox 两种环境。

### 2.6 Watchdog

- 独立于主系统的 Watchdog Session，由 scheduled messages 驱动。
- 不只检查进程存活；用模型判断 Worker 是否在**实质推进**、是否偏离目标。
- Watchdog 自己也有完整工具，可以被人用自然语言询问、修改 prompt/trigger 规则。

### 2.7 实验与边界

- 合成负载（约 300 条消息，20 个 work request）：Super-agent p50 12.4 min / p95 15.7 min；单 session + subagent 的 p95 29.5 min。
- 去掉 direct delivery 后完成时间几乎不变，但 Router 决策数 +30%、cache-read tokens +37%。
- 官方明确：**research prototype，不是 DeepSeek 正式产品**；公开原型与文章/内部版本不完全一致；没有默认 sandbox，presets 可能 `danger-full-access`；不应直接生产照搬。

---

## 3. 相邻形态：OpenAI / Cursor / OpenClaw

这一节只做对照，不作为核心事实源（部分为二手报道）。

- **OpenAI Codex Triggers**（2026-03 起）：GitHub Actions `on:` 事件触发 `codex exec`；事件驱动、按 push/PR/webhook 跑；更接近“事件触发一次 run”，不是持久 Router。
- **Codex background computer use**（2026-04 报道）：后台操作桌面/应用，多个 agent 并行，不干扰用户前台；仍是“任务型 run”。
- **OpenAI Dots**（报道）：面向个人的 persistent agent，后台跟进目标，需要时找人；与 Claude Duet 同类。
- **Cursor Cloud Agents**：把 agent 放到云端 sandbox，关掉笔记本也继续；偏“远程执行环境”，不是注意力路由器。
- **OpenClaw**：把整台机器交给 agent，能力最强但信任/安全问题最大；Anthropic Dispatch 的定位正是“OpenClaw 的 always-on 体验，但加权限、审批、sandbox、可信入口”。

> 这些形态说明：**always-on 的竞争点正在从“能不能跑”转向“什么时候该说话、什么时候该闭嘴、出了事谁负责”**。

---

## 4. 共同模式（跨厂商）

1. **事件先入 inbox，不直接调 agent**：耐久、去重、可恢复、可批量。
2. **一个 inbox 一个 active worker**：避免并发 run 互相覆盖；新事件可以合并到下一轮，或中断重开。
3. **Router / Worker 分离**：连续性（Router）与吞吐（Worker）分开；Router 不执行具体任务。
4. **Thread + Subscription 快路径**：已归属的后续事件直接到 Worker，Router 只处理新事件/跨任务协调。
5. **程序快筛 + 模型慢判**：确定性规则先挡噪音，模型只处理候选。
6. **注意力预算 / Outbox**：只在“人必须行动”或“结果可用”时说话；先安静，再逐步增加；按渠道调整长度与结构。
7. **Memory 是独立持久层**：instructions / notes / past messages / task progress；只存查不回来的东西，其余指针；跨 run 加载。
8. **权限是 always-on 的核心风险面**：凭证代理、auto-mode classifier、deferred tool call、human-only 动作。
9. **状态与执行分离**：session state 持久化；执行环境按需连接；重启可恢复。
10. **独立 Watchdog**：检查“有没有实质进展”，不只检查进程存活。
11. **全双工**：长任务后台跑，前台仍能接收新指令/打断。
12. **诚实的失败语义**：draft 是 draft，failed 是 failed，不拿“完成”掩盖。

---

## 5. 对照 MAFW 现状

### 5.1 已经有的

| 能力 | MAFW 现状 |
|---|---|
| 事件表 | `event_sources / event_threads / event_triggers / event_subscriptions / event_decisions / event_deliveries / event_channels / event_outbox` |
| 事件开关 | 2026-11-16 起默认开启；`MAFW_EVENT_LAYER=0` 关闭 |
| 系统 source | 启动时 ensure `internal` / `cron` |
| 事件路由 | Source → Trigger → Thread → Subscription → Decision → Delivery；`work` / `context` 两种订阅 |
| Context 投递 | 2026-11-16 新增 `deliverContext`；decision draft → Lead context → Lead chat `[LEAD EVENT]` |
| Work 投递 | `deliverWork` → Standing Goal `handleEventTrigger` |
| Lead 唤醒 | `PodEventWake` 对 p2 Pod event 做预算/去重后 `promptAsync`；Goal 归档发 Pod message |
| 决策 | `DecisionRecordService` draft / confirm / shelve / reopen；human-only 确认；decision attention 投影 |
| 定时 | AutomationEngine / Standing Goals cron；没有 agent-set follow-up timer |
| 记忆 | 谐波记忆、T1、soft supersede、pinned/sticky、100ms recall；没有 per-run instructions/progress 快照 |
| 权限 | human-only 验收、审批、权限模式、Pod 角色门；没有 always-on 的 deferred tool call / auto-mode classifier |
| 状态机 | NodeDriver / Goal / Pod / revision；确定性执行 |
| 桌面 | 工作台、Lead chat、Pod/Goal、事件层诊断页 |

### 5.2 缺口（按 always-on 原语映射）

| 原语 | MAFW 缺口 | 影响 |
|---|---|---|
| **Event inbox** | 有 event layer，但 `PodEventWake` 是第二条唤醒路径；两条路径各自做预算/去重；没有统一 worker | 同一事件可能两次触达；无法统一 batching、pause、恢复 |
| **Router** | Lead 同时是聊天对象、协调者、可能的执行者；没有“只路由/不干活”的产品边界 | Lead 容易变成所有事情的总称；上下文和权限混杂 |
| **Worker** | NodeDriver/Tech Lead/Builder/Reviewer 已经是隔离执行层（强项） | 不需要重造；但 event layer 的 work/context 与 Pod 角色关系还没完全统一 |
| **Timers** | 只有 cron/automation；没有 agent 自己设的 follow-up（等 PR review、等 CI、提醒决定） | always-on 只能被动等事件，不能“过 2 小时再看一眼” |
| **Memory** | 记忆系统强，但没有“本次 run 的 instructions/notes/progress”快照；Lead 跨 run 依赖聊天 transcript | 长跑后 context 被压缩/换 session，细节丢失 |
| **Permissions** | human-only 门很硬（强项）；有 pendingQuestion / approvals，但还没有统一成“run 挂起 → 人回答作为事件恢复”的 deferred input；auto-mode classifier 也还没有 | 无人值守时只能“停下等人”，不能安全地继续别的 run |
| **Outbox** | `EventOutbox` 类存在但未接线；Lead 直接 `promptAsync` | 没有 pacing/合并/排序/read-ack；decision 一多就刷屏 |
| **Attention budget** | `PodEventWake` 有 6/hour + 10min dedupe；decision Lead 播报没有预算 | 两类消息量级不一致；Lead 可能被 decision 淹没 |
| **Run ledger** | Goal 有 state；Lead context 投递没有 run id / event ids / status | 重启后无法判断哪条已播报、哪条该重试 |
| **Watchdog** | 有节点 timeout/retry；没有独立检查“Lead/事件投递是否实质推进”的 watchdog | 静默卡住只能靠人发现 |
| **Admission** | event layer 有准入；decision 走 internal 绕过；Standing Goal 有规则 | “inferred 事件”缺少 observe/auto 的统一策略 |

### 5.3 MAFW 不该丢的东西

- **确定性 NodeDriver**：不把工作流交给 Router 的临场判断。
- **独立 Reviewer + 逐任务 rubric + 必需 Goal 条件**：不拿“任务全绿”推导 Goal PASS。
- **human-only 验收 / 计划批准 / 方向裁定**：always-on 不等于自动验收。
- **谐波记忆 / soft supersede / pinned-sticky / 100ms recall**：不要为了 always-on 再造一套 memory。
- **Pod / Goal / revision 状态机**：事件层是入口，不是替代品。

---

## 6. 对 MAFW 的建议（分阶段）

### P0：Lead 播报收敛到“一个 inbox + 一个 outbox”

现状：decision draft → event layer → Lead `promptAsync`；PodEventWake → Lead `promptAsync`；两条路径、两种预算。

建议：

1. **Lead 消息统一走 outbox**：`deliverContext` 不再直接 `promptAsync`，而是写 `event_outbox`（channel=`chat`，address=`podId/lead`，dedupeKey=`decision:<recordId>` / `pod-event:<eventId>`），由 dispatcher 统一发送。
2. **一个 Lead dispatcher**：按 Pod/项目串行；Lead busy 时排队；合并同一轮的多条消息；失败退避；记录 delivered/read/ack。
3. **统一注意力预算**：p1 立即、p2 下一轮、p3 只进 digest；每 Pod 每小时上限；dedupe 窗口；先安静。
4. **delivered / sent 语义**：P0 先记录 outbox 的 `sent` / `failed`；`read` / `ack` 需要把 Lead 的回复与具体 outbox 消息关联，放 P1。
5. **event_outbox 接线**：目前 `EventOutbox` 只有类，没有 dispatcher/worker；这是最小可用的“结果交付”层。

### P1：合并 PodEventWake 与 event layer

- 把 Pod event 变成 event layer 的 `internal` / `pod-event` source：`goal.result`、`member.request`、`member.escalation` 等。
- Lead 用 `context` 订阅；`PodEventWake` 的预算/去重逻辑变成 dispatcher 的 policy，而不是另一条独立路径。
- 好处：一个 inbox、一个 worker、一个 pause/resume、一个审计面；避免“事件层不知道 PodEventWake 已经叫过 Lead”。

### P1：Agent-set timers

- 新增 `event_timers`（或复用 automation）：`{podId, goalId, kind: followup|schedule, dueAt, recurrence, payload, createdBy}`。
- 到点只写 inbox，不直接跑 agent。
- 典型场景：等 PR review、等 CI、2 小时后提醒未确认的 decision、每日 brief。
- 与 Standing Goals cron 区分：cron 是用户/团队规则；follow-up 是 agent 在一次 run 里给自己设的检查点。

### P1：Lead run ledger

- `event_runs`：`{runId, podId, sessionId, triggerIds, status, startedAt, endedAt, lastMessageId, error}`。
- 重启后能判断：哪些 delivery 已发、哪些要重试、哪些 run 被中断。
- 与 Goal 的 `nodeSession` 分开：Lead 的 context run 不是 Goal node run。

### P2：Per-run memory snapshot

- 每次 Lead 唤醒前加载：`instructions.md`（用户长期指令）、`index.md`（notes/progress 索引）、`reported.md`（已告诉用户什么）。
- 任务进度单独文件；只把索引放进 context，细节按需读。
- 复用现有谐波记忆，不另起一套；把“跨 run 必须知道的事”写成指针。

### P2：Deferred approval / auto-mode

- 高风险动作（merge/purge/send/pay）继续 human-only；但可以引入 deferred tool call：run 挂起、session 保存、人回答后以事件恢复。
- auto-mode classifier 只用于低风险动作；高风险仍走 human gate。
- 凭证代理：event source 的 token 不进入模型上下文。

### P2：Watchdog

- 独立 session，定时检查：Lead 是否卡住、delivery 是否积压、event thread 是否长期无进展、decision 是否长期未确认。
- 只看“实质进展”，不看进程存活；发现异常时给人/Lead 发一条结构化消息。

### P2：Admission / observe → auto

- 对“未被明确请求”的事件，先 `observe`：记录“本来会做什么”，不执行；团队确认规则后才 `auto`。
- 与 Goal 的 authorization / Policy version 对齐；inferred 事件不能绕过 human-only 验收。

### 不建议做

- 不把 Lead 变成通用 Worker（不要给 Lead 默认 Bash/文件写权限）。
- 不为 always-on 另造一套 memory，复用谐波记忆 + 指针。
- 不自动接受 inferred 工作；不自动 merge/purge。
- 不把每条事件都广播给 Lead；注意力是预算，不是管道。
- 不照搬 DeepSeek 的 research prototype 作为生产架构；只借 Router/Worker、Thread/Subscription、两级过滤、outbox、watchdog 这些模式。

---

## 7. 评估指标（建议）

| 指标 | 定义 | 目标 |
|---|---|---|
| Signal-to-noise | 每一条 Lead 消息对应的“人类动作或可用结果”数 | 越高越好；低价值消息应进 digest/log |
| False alarm | 不需要人但打断了人的比例 | 越低越好；先安静 |
| Time-to-human | 事件发生 → 人看到可行动消息 | p1 秒级；p2 分钟级；p3 小时/日 |
| Duplicate | 同一事件/决定重复播报次数 | 0 |
| Ack rate | Lead 消息被人回复/确认的比例 | 用于调预算与措辞 |
| Recovery | 重启后未完成 delivery 的恢复率 | 100% 可恢复或明确失败 |
| Cost per run | 每次唤醒的 token/费用 | 用 prompt caching + 批量 + 轻模型 |
| Batch size | Router/Lead 一次处理的 pending events | 在 context 上限内越大越省 |

---

## 8. 开放问题

1. **Lead 是一个持久 session，还是每类事件一个 session？** Anthropic 建议“继续已有工作 → 复用 session；新工作 → 新 session”；DeepSeek 用 Router + Worker。MAFW 的 Lead 更像 Router，但当前也是聊天对象；需要明确边界。
2. **p1/p2/p3 的 MAFW 分类表**：哪些事件必须立即打断？哪些进下一轮？哪些只进 digest？
3. **read/ack 怎么定义**：Lead 回复算 ack？用户看到但没回算 read？超时怎么办？
4. **timer 归属**：Lead 自己设的 follow-up 与 Standing Goal cron 如何避免重复？
5. **PodEventWake 合并迁移**：先双写/影子运行，还是一次性切？历史 `pod_events` 的 wake 状态怎么迁移？
6. **多项目 / 移动端**：Lead 是每项目一个，还是用户级一个跨项目 Router？移动端如何收/回消息？
7. **安全**：外部事件 source 的 prompt injection、凭证代理、跨设备 daemon 的信任边界；DeepSeek 自己也把 security/privacy 列为 open question。

---

## 9. 来源

### 官方 / 一手

1. Anthropic, *Building always-on agents*, 2026-11-13 — <https://claude.com/resources/articles/building-always-on-agents>
2. Anthropic, *Introducing Claude Duet*, 2026-10-21 — <https://claude.com/resources/articles/claude-duet>
3. DeepSeek Harness, *dsh-superagent-prototype* README + docs 000 / 003 / 007 — <https://github.com/deepseek-ai/dsh-superagent-prototype>
4. DeepSeek Harness, *Exploring Super-agent Design: Towards a More Autonomous Agent System*, 2026-10-31；英文全文翻译（2026-11-13 更新）— <https://offloop.org/learn/exploring-deepseek-super-agent-design>
5. Anthropic, *How we contain Claude across products* — <https://www.anthropic.com/research/how-we-contain-claude>
6. Claude Code Channels docs — <https://code.claude.com/docs/en/channels>

### 二手 / 讨论

7. Tessl, *How Anthropic is turning Claude into an ‘always-on’ agent — and what it learned from OpenClaw*, 2026-03-24 — <https://tessl.io/blog/how-anthropic-is-turning-claude-into-an-always-on-agent-and-what-it-learned-from-openclaw>
8. CellCog, *DeepSeek’s Super-agent: One Router, Many Workers* — <https://cellcog.ai/blog/deepseek-super-agent>
9. Developers Digest, *DeepSeek Super-Agent: The Always-On Router and Worker Design* — <https://www.developersdigest.tech/blog/deepseek-dsh-superagent-router-worker-always-on-agent-2026>
10. DEV, *Stop Letting Five Coding Agents Ping You. Answer Them in Batches From One Inbox* — <https://dev.to/gabrielanhaia/stop-letting-five-coding-agents-ping-you-answer-them-in-batches-from-one-inbox-2in3>
11. Hacker News, *2026 will be the year of on-device agents* — <https://news.ycombinator.com/item?id=46471524>

> 二手来源只用于实验数字、产品背景与行业讨论；架构判断以 Anthropic / DeepSeek 官方文档与文章为准。

---

## 10. 附：一句话对照

| 问题 | Claude 的回答 | DeepSeek 的回答 | MAFW 应该的回答 |
|---|---|---|---|
| Agent 什么时候醒？ | event inbox + timers | Trigger（IM/GitHub/CI/…）+ 程序快筛 | 统一 event inbox + PodEventWake 合并 |
| 谁跟人说话？ | outbox / 产品界面 | 持久 Router | Lead（但要走 outbox，不是直连 promptAsync） |
| 谁干活？ | agent run / sandbox | 隔离 Worker | NodeDriver + Tech Lead/Builder/Reviewer |
| 后续事件去哪？ | 续 session 或新 session | Thread subscription 直达 Worker | event layer subscription；work/context 分流 |
| 怎么防噪音？ | 只在需要时发；先安静 | 两级过滤 + 注意力预算 | 统一预算 + p1/p2/p3 + digest |
| 怎么防失控？ | 权限、approval、auto-mode | Mandate / admission / Watchdog | human-only 门 + deferred approval + watchdog |
| 跨 run 记什么？ | memory 四类文件 + dreaming | Task state + Chain of Recall | 谐波记忆 + per-run instructions/progress 指针 |
