# DeepSeek dsh-superagent 对 MAFW Pod 的参考

- 日期：2026-11-02
- 状态：调研完成（官方仓库文档核对，未改产品代码）
- 前置：`docs/research/2026-11-02-pod-usage-logic-audit.md`
- 对象：<https://github.com/deepseek-ai/dsh-superagent-prototype>

## 0. 结论

DeepSeek 刚开源的 `dsh-superagent-prototype` 是本次 Pod 审计中**最直接可借鉴的参照**，甚至比 CrewAI / Claude Agent Teams 更贴近我们缺的那一层。

原因不是它叫 Super-agent，而是它把产品主权从「有哪些 agent」转移到：

> **什么工作被授权、执行到哪一步、现在是否真的需要人、结果是否可信。**

这正好对应 MAFW Pod 的四个核心问题：

1. Pod 页面没有「交付目标」的主入口；
2. 「待我处理」漏掉真正的人类阻塞点；
3. manual/A2A/waves 任务混合了不同执行权威；
4. 休眠、失败、完成、投递等状态名实不一致。

建议借鉴它的**工作模型与状态语义**，保留 MAFW 已有的**独立 Reviewer、逐任务 rubric、确定性 NodeDriver、项目/谐波记忆分层和桌面工作台**。不建议照搬全套名词或运行时。

---

## 1. 官方事实与边界

仓库：<https://github.com/deepseek-ai/dsh-superagent-prototype>，MIT，2026-10-31 公开。

它是一个面向一个 GitHub 仓库的 proactive coding agent，可选接入飞书：

- 被允许的人明确提出工作后创建 Ticket；
- 每个 Ticket 在独立 Executor Session 和目录中执行；
- 结果返回原始会话，例如 PR；
- Web panel 优先显示需要人处理的事项。

**官方明确声明：这是 research prototype，不是生产就绪的正式 DeepSeek 产品；公开原型与内部版本/文章设计不完全相同，一些文章设计是未来方向。** 因此本文只借架构与使用逻辑，不把其视为生产验证结论。

官方文档：

- [README](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/README.md)
- [000 Philosophy](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/000-philosophy.md)
- [001 Domain model](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/001-domain.md)
- [002 Authorization](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md)
- [003 Execution](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md)
- [004 Prompts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/004-prompts.md)
- [005 Panel](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/005-panel.md)
- [007 Architecture](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md)

---

## 2. 最值得借的一点：把人注意力当成最高成本

Super-agent 的核心原则：

> **Take as little human attention as possible, and give as much value as possible.**

由此推出的产品规则：

- 只被明确请求，或命中团队写下的规则时才行动；
- 工作时保持安静，只在结果可用、需要决定、无法完成时发言；
- 一次只问一个结构化问题；
- 草稿标未完成，失败就是失败；
- panel 首先列出需要人的事项，健康状态不占空间。

这与 MAFW 当前形成直接反差：

- 左栏把内部 `review` 和 unread 当作人类待办；
- plan approval / askUser 这些真正阻塞人的状态反而不计数；
- roster、raw goal id、owner、mailbox、memory 等健康信息长期占据主面；
- FAIL goal 可以显示「完成」。

### 可直接采用的产品验收标准

每一个 Pod 元素必须回答以下三问之一，否则降级或移除：

1. **现在需要我做什么？**
2. **系统是否健康、是否在做正确的工作？**
3. **这件工作从请求到结果的完整历史是什么？**

Super-agent 的 Overview 也正是这三问，见 `docs/005-panel.md`。

---

## 3. Ticket stage：我们需要的不是更多状态，而是可判定的单一阶段

Super-agent 每个 open Ticket 只有一个 stage，按优先级从结构化事实计算：

| Stage | 含义 |
|---|---|
| `person / delivery` | 输入投递失败，需要处理 |
| `person / answer` | 有结构化 Attention，等待回答 |
| `person / review` | 最新 Report=ready，等待验收 |
| `person / blocked, failed` | 受阻/失败，等待人处理 |
| `working / queued` | 等待可用执行槽 |
| `idle` | 等待后续 Trigger |
| `working` | 正常执行 |

关键设计：

- **person 表示没有人就无法继续**；
- 阶段由结构化 Report/Attention/Assignment 计算，不从自由文本猜；
- 分类互斥且覆盖全部情况；
- label 说明「等谁、为什么」，不是直接暴露内部状态码；
- count 必须等于它链接到的列表长度。

### 对 MAFW 的最小落地

不需要改名叫 Ticket，也可以保留 Goal。建议先做一个纯函数：

```text
podGoalStage(goalState, planApproval, pendingQuestion, latestReport, delivery)
  → { owner: 'person' | 'team' | 'system',
      kind: 'answer' | 'plan_approval' | 'review' | 'blocked' |
            'failed' | 'queued' | 'working' | 'waiting' | 'ended',
      label,
      action? }
```

并由此统一派生：

- 左栏 badge；
- 「待我处理」列表；
- 当前 Goal 主卡；
- 通知文案；
- 过滤器及计数。

**Reviewer 正在 review = team/working，不是 person/review。** 只有 Goal 已 ready、确实需要用户最终验收时，才进入 person/review。

---

## 4. Router / Executor：Lead 应该路由，不应成为所有东西的总称

Super-agent 有两层：

- **Main Session / Router**：只路由，转发原始 Trigger 和 routing facts，不做技术决策；
- **Executor**：读取原始资料、判断 scope、实现与验证；每个 Ticket 一个 Session 和工作目录。

同时：

- Executor 处理本 Ticket 的 follow-up；超出 scope 才 hand back；
- Main Session 不等待，报告/候选/后台完成由消息驱动；
- worker 的工具不包含向人提问的 UI，人的问题经结构化 `human_action` 上报；
- Prompt 不能改变 gate、Mandate、tool checks 等代码强制规则。

### MAFW 当前差距

- Lead = 项目 Manager session = 用户聊天会话 = Pod coordination 标签；
- spec 又说 Lead 拆任务、分配、升级、归纳记忆；
- 实际上任务由 Gateway 投影，NodeDriver 决定执行拓扑；
- Lead 没有清楚的「只路由」或「真正协调」产品边界。

### 建议

采用**弱 Router + 强确定性执行**：

- Lead 只负责接收目标、识别是新 Goal 还是已有 Goal 的 follow-up、返回路由结果；
- plan 可以作为独立规划职责存在，不要求 Lead 自己做技术方案；
- Builder 执行；
- Reviewer 独立验收；
- NodeDriver 仍是唯一工作流推进者；
- Lead 的 prompt 必须包含 Pod/Goal/follow-up/handback 语义，不再只是给 Manager 贴标签。

这比「让 Lead 全权管理团队」更符合 MAFW 的确定性定位。

---

## 5. Goal/Ticket 与内部 task 必须分开

Super-agent 的一等对象是：

- **Ticket**：被授权的一件工作；
- **Assignment**：把 Ticket 绑定到一次 Executor 执行；
- **Mandate**：为什么允许做、允许做到什么范围、基于哪个 Policy version；
- **Report**：一次执行向 Ticket 报告的结构化事实。

它不会把「用户想做的事」和「执行器内部步骤」混成一个任务板。

### MAFW 当前混淆

`pod_tasks` 同时承载：

- waves 投影（会执行的计划步骤）；
- manual（只写行，不执行）；
- A2A request（写行，但不进入 waves 执行器）；
- receipt/review 状态覆盖。

所以 UI 的「新建任务」无法表达执行权威。

### 建议的领域对齐

| Super-agent | MAFW 应对 | 说明 |
|---|---|---|
| Ticket | **Goal** | 用户/外部系统托付的一件完整工作 |
| Mandate | **Goal 的授权与范围** | 谁发起、允许什么、是否可自动接受、来源与策略版本 |
| Assignment | **goal_node_runs / 一次节点执行** | 可与 Goal 独立结束、重试、恢复 |
| Report | **receipt + review report + structured attention** | 结构化事实驱动 stage |
| waves task | **Goal 内部计划步骤** | 不是用户交付工作的入口 |
| manual task | **Note，或转成 Goal candidate** | 不能继续默认显示为待执行工作 |
| A2A request | **统一 admission / Eval** | 不应绕过计划权威直接生成另一种任务行 |

**核心决定：任务板应主要展示当前 Goal 的内部步骤；用户交付工作一律走 Goal/Ticket 层。**

---

## 6. Admission / Mandate：主动自主必须先有授权模型

Super-agent 不是「一直在线就随便找活」：

- allowed person 明确 @/直接请求 → explicit；
- 未明确请求的工作 → inferred candidate；
- inferred 默认 `observe`，只记录「本来会接受」，不执行；
- 只有 `auto` + 命中启用规则才接受；
- Ticket 的 Mandate 记录 scope、strength、matched rules、Source identity、Policy version；
- 后续消息可以是上下文，但不自动扩大授权；
- ended Ticket 恢复前重新验证 Mandate；
- 人 stop 才撤销授权。

这为我们补全两种目前不清楚的入口提供了统一模型：

- 桌面/Lead 对话：显式请求；
- A2A、GitHub、定时事件、其他 agent：候选，必须经过 admission；
- 主动找活：先 observe，不直接 auto。

### 对 MAFW 的建议

不需要第一版就实现全部 Policy。最小字段可以是：

```text
goalAuthorization = {
  source: 'desktop' | 'lead' | 'a2a' | 'automation',
  requestMode: 'explicit' | 'inferred',
  scope,
  acceptedBy,
  policyVersion?
}
```

**没有执行授权的 manual/A2A 条目，不得出现在「待执行工作」语义里。**

---

## 7. Follow-up ownership / Subscription：比 mailbox 更重要的一层

Super-agent 的后续消息不是简单 inbox：

- 已订阅 Thread 的后续会 fan-out 到相关 Tickets；
- 人的 follow-up 由原 Ticket Executor 优先处理；
- 超出 scope 或属于其他 Ticket 才 hand back；
- 没有 owner 后才重新 Eval；
- context-only subscription 只给上下文，不给权限，也不恢复 Ticket；
- Ticket 结束时，未读/未处理 follow-up 会回到 Eval；
- 每个 Input 区分 delivered / read / acknowledged / answered / handed back。

这比「邮件发出去了」多回答了四个问题：

1. 谁负责处理这条后续？
2. 它是否扩大了原工作范围？
3. 它是否已经被真正读取和处理？
4. 工作结束后，是否还有被遗漏的人消息？

### 对 MAFW 的优先级

在修完广播 `delivered_at` 后，不建议继续只加「已读回执」。更有价值的是：

- `goalId/ticketId` 归属；
- `ownerSessionId`；
- `deliveryState` per recipient；
- `readState` / `handledState`；
- `handbackReason`；
- 未处理 follow-up 在归档时不得静默消失。

---

## 8. Durable effects / Outbox：解决我们的投递与状态一致性

Super-agent 的架构将：

- 领域状态先在事务中写入；
- 外部副作用进入 durable Effects；
- commit 后才执行；
- 每类副作用有顺序、重试、退避和健康状态；
- Outbox 负责 outgoing receipts；
- restart 后恢复未完成 work。

MAFW 当前的风险正好集中在：

- 广播只有一个 `delivered_at`；
- force notify 直接写运行中的节点 session；
- 归档/决策/消息/任务状态不是一个可恢复整体；
- 状态显示与真实执行可能矛盾。

### 最小借鉴，不必先造完整 Outbox

1. per-recipient delivery 行；
2. 状态变更与待投递记录同事务；
3. prompt/HTTP/A2A 等副作用在 commit 后执行；
4. 明确的 retry / failed / dropped；
5. UI 只展示可行动的投递问题，不把每次网络错误都变成噪音。

---

## 9. Pause、stop、retry：三种控制必须分开

Super-agent：

- **Pause processing**：停止 dispatch、新 Eval、Input delivery 和 replies；Source 继续记录，运行中的 Executor turn 不被硬中断；恢复后继续。
- **Stop Ticket**：撤销该 Ticket 的 Mandate，不再接收后续。
- **Retry**：结束当前 Assignment，在同一个 Session/directory/branch/PR 上启动新 Assignment。
- **Restart**：持久状态保留，被中断 Assignment 带 recovery note 恢复。

MAFW 的「休眠」目前只是 `active↔idle`，既不暂停队列也不停止工作，是没有清晰语义的第四个概念。

建议直接采用三档语义：

- **暂停自动推进**（暂停新节点/新 Goal/投递，正在运行的当前 turn 按约定完成或中止）；
- **停止这个 Goal**（终止授权，需确认）；
- **重试这个节点/Goal**（明确保留哪些上下文和产物）。

「休眠通知」如果确有需求，单独叫「免打扰」，不要与执行暂停共用。

---

## 10. Per-Ticket workspace 与人类介入优先槽

Super-agent 每个 Ticket 有：

- 独立 Executor Session；
- 独立 directory（prepare 通常可建 git worktree）；
- 可配置 worker slots；
- **额外一个供人消息/状态请求的槽**，新工作不能把人继续已有工作堵死。

这对 MAFW 有两点启示：

1. 未来并行不应只是「多 Builder」，而应是 **Goal × isolated workspace × Assignment**；
2. 即便继续单 active goal，也应保证 **人的介入优先于新工作启动**，不要把 force push 当普通队列消息。

但这属于后续执行能力，不应先于 P0 的使用语义修复。

---

## 11. Panel：我们应该借的不是页面，而是约束

Super-agent `docs/005-panel.md` 的原则可直接作为 Pod UI 验收清单：

- Overview 先列需要人的事，再是系统健康和历史；
- 每个概念只有一个主页面，Overview 只汇总并链接；
- id 放折叠详情，能解析名称就不用 id；
- count 等于目标列表长度；
- 状态之间不得互相矛盾；
- healthy state 不占额外空间；
- 问题必须可行动；
- destructive action 要确认；
- 内部领域词与给用户看的语言分开。

### 对 MAFW Pod 的具体映射

- Pod 主面：需要你 / 当前 Goal / 系统问题；
- Goal 详情：授权、计划、任务、回执、rubric、产物、follow-up；
- 团队页：职责与成员 sessions；
- 协调日志：handoff、handback、消息与投递；
- 记忆页：项目约定与决策；
- raw goal id/session id/task sourceKey 全部退到详情。

---

## 12. 我们不应该照搬什么

### 12.1 不把全套领域名词搬给终端用户

Source / Trigger / Thread / Eval / Mandate / Ticket / Assignment / Subscription 是优秀的内部边界，但普通用户只需看到「工作、后续、授权、执行、等待你」。MAFW 已经有 Goal/NodeDriver，不需要为像 DeepSeek 而全局改名。

### 12.2 不用 Executor 的 ready 自报替代独立 Reviewer

DeepSeek 的 Executor 可以 Report ready，再进入人的 review。MAFW 已有独立 Reviewer + 逐任务 rubric + 产物门，这是我们应该保留并展示出来的优势。

正确组合是：

> DeepSeek 的 stage / attention / durable lifecycle + MAFW 的 independent review / rubric / artifact gate。

### 12.3 不直接打开主动 auto 模式

先支持明确请求；主动候选先 observe。我们的广播、follow-up ownership、授权模型尚未稳定，直接 proactive auto 会放大问题。

### 12.4 不照搬 GitHub/PR 作为唯一完成语义

MAFW 的目标不都是 PR。保留 artifact/rubric 验收，把 PR merged 只作为代码类 Goal 的一种外部结果。

### 12.5 不把 research prototype 当生产证明

借设计，不引用 star 数或「超级智能体」宣传作为质量证据。

---

## 13. 调整后的实施优先级

### P0：状态与注意力（直接借 Super-agent）

- 单一 `podGoalStage` / `nextHumanAction` 纯函数；
- person/team/system 分开；
- plan approval、askUser、ready review、blocked/failed 进入正确类别；
- FAIL 不再显示完成；
- count=list 长度，点击必须过滤到同一列表；
- 健康 roster 不再抢占主面。

### P1：统一工作入口与授权

- 「交给团队一个目标」创建 Goal，不创建 manual task；
- Goal 记录 explicit/inferred、source、scope；
- manual 改 Note 或转 Goal candidate；
- A2A 走同一 admission；
- Lead 只路由，plan/execute/review 保持确定性；
- 当前 Goal 的内部 waves tasks 与项目工作入口分离。

### P2：follow-up 与副作用可靠性

- per-recipient delivery；
- follow-up owner / handback / handled；
- commit 后副作用与可恢复重试；
- pause/stop/retry 分离；
- 未处理的人消息在归档时显式收口。

### P3：执行扩展

- Goal × workspace × Assignment；
- 并行 worker slots + 人类介入优先；
- 主动 Source/Trigger/Eval，默认 observe；
- 多 Builder×worktree、specialist、依赖解锁。

---

## 14. 最终产品判断

Super-agent 给 MAFW Pod 最大的启发不是「再做一个更自主的 agent」，而是：

> **把 agent 的自主性藏在工作系统里，把人的界面收敛到授权、必要介入与可信结果。**

MAFW 不需要在「固定团队」和「Super-agent」之间选边：

- 固定 Lead/Builder/Reviewer 可以继续是职责与验收边界；
- Goal 可以成为 Ticket；
- NodeDriver 可以继续控制执行；
- Reviewer rubric 可以继续是比 Executor 自报更强的质量门；
- Pod 的前端则应该全面转向「需要什么注意、工作是否健康、结果是否可信」。

**DeepSeek 补的是我们缺的工作生命周期与注意力模型，不是替代我们已有的执行与验收内核。**
