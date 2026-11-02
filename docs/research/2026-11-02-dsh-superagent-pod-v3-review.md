# DeepSeek Super-agent 设计原理与 Pod v3 可借鉴性复核

- 日期：2026-11-02
- 状态：官方文章与原型文档已核对；MAFW 当前代码已只读复核；未改产品代码
- 前置调研：`docs/research/2026-11-02-dsh-superagent-vs-mafw-pod.md`
- 当前设计：`docs/superpowers/specs/2026-11-02-pod-v3-goal-attention-design.md`

## 0. 结论

**可以借鉴，而且 Pod v3 已经落地了最值得借鉴的第一层：Goal 工作入口、服务端 stage/attention、真实终态、暂停/恢复和授权边界。**

DeepSeek Super-agent 对 Pod 的下一批价值，按优先级是：

1. **follow-up ownership**：后续消息归谁、是否处理、超范围如何交回、归档时如何防遗漏；
2. **durable Effects / Outbox**：状态与外部副作用可靠衔接，自动重试、顺序与健康可观测；
3. **observe → auto 的 admission**：A2A/自动化/主动候选先记录和评估，再按明确规则获得执行授权；
4. 仅在确有并行需求后，再做 **Goal × 独立 workspace × 多 Worker**。

不建议现在照搬：动态 swarm、全套 Ticket/Mandate 名词、云端 BYOM、模型型 Watchdog、默认 proactive auto，或用 Executor 自报 `ready` 替代 MAFW 的独立 Reviewer。

一句话判断：

> **Pod 应借 Super-agent 的“工作操作系统”，不是借它的 Agent 数量；保留 NodeDriver、独立 Reviewer、rubric 和记忆分层。**

---

## 1. 先厘清对象

用户所说的“DeepSeek 开源 Super Agent”实际是两部分：

| 对象 | 作用 | 边界 |
|---|---|---|
| [Super-agent 设计文章](https://mp.weixin.qq.com/s/zoS7GlReWPhfCjENGxXCdg) | 常驻、多任务、事件驱动、自恢复系统的架构设计 | 工程探讨，不是论文或正式产品说明 |
| [`dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype) | 面向一个 GitHub 仓库、可选飞书的参考实现 | MIT；官方明确为 research prototype，非生产就绪 |
| [`deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) | 承载原型的 Agent 宿主，Everything-is-a-plugin | 不等同于 Super-agent 的工作生命周期设计 |

**文章中的设计不等于原型全部实现。** 云端常驻、BYOM、通用 Chain of Recall、独立模型 Watchdog 等主要是文章方向；公开原型主要是本地 SQLite + DSH bundle。

---

## 2. Super-agent 的核心设计与原理

### 2.1 Router / Worker：把连续性与吞吐分开

- **Router**：常驻的全局路由与对外交互层，维护跨任务上下文，不深入单任务实现；
- **Worker**：上下文隔离地执行具体工作，可挂载完整工具，内部仍可再派 Subagent；
- Router 将推理期间积压的 Trigger 合并处理，以批处理提高吞吐；
- 已归属的工作不反复经过 Router，后续事件通过订阅直接送达 Worker。

它解决的不是“一个任务怎样拆得更细”，而是“多个任务怎样并行推进而不让用户管理一堆 Session”。这也是它和普通 Agent Team 的主要区别。

### 2.2 Trigger / Thread / Subscription：事件驱动与两级路径

环境消息统一成为 **Trigger**；同一 PR、IM 话题或邮件串形成 **Thread**。

- **Fast Path**：确定性规则过滤来源、身份、群组与订阅关系；
- **Slow Path**：只有候选的新工作交给模型做语义 Assessment；
- **订阅直通**：已订阅 Thread 的后续直接给对应 Ticket/Worker，不再让 Router 重复路由；
- 超出范围时，Worker 可以 hand back，让事件重新进入 Eval。

官方初步实验中，去掉订阅直通没有明显改变完成时间，但 Router 决策数约增加 30%，缓存读取 token 约增加 37%。因此直通的主要价值是**降低协调成本**，不是提高单任务质量。实验是合成负载、5 次重复，不能当作生产 benchmark。

### 2.3 Ticket / Mandate / Assignment / Report：工作、授权、执行、事实分离

```text
Source → Trigger → Thread → Eval(Gate + Assessment)
                              ├─ accept → Mandate → Ticket → Assignment → Worker
                              ├─ ignore / stop / unavailable
                              └─ observe 时只记录 would accept
Ticket → Report / Attention → 原信道或面板
```

- **Ticket**：一件完整、被授权的工作；
- **Mandate**：为什么允许做、允许做到哪、命中什么规则与 Policy 版本；
- **Assignment**：一次具体执行，可结束、重试、恢复，不等于 Ticket 本身；
- **Report**：执行产生的结构化事实，如 progress/waiting/ready/blocked/failed；
- **Input/Attention**：后续输入和真正需要人处理的问题有独立生命周期。

关键原则是：**提示词可以提出判断，但只有领域代码能授予权限、改变状态和决定阶段。**

### 2.4 人类注意力是最贵资源

官方原则是：尽量少占人的注意力，尽量多交付价值。

- 只在结果可用、需要决定/资源、无法完成时发言；
- 推断工作默认 `observe`，只记录“本来会接受”，不直接执行；
- 一次只问一个结构化问题；
- `ready` 不等于“完成”，草稿和未验证结果必须如实标记；
- 面板优先显示需要人的事，健康状态不抢占主面；
- Ticket stage 从结构化事实计算，不从自由文本猜。

### 2.5 Durable Effects / Outbox：可靠性来自事务边界

原型中 Engine 是 Trigger、Thread、Ticket、Assignment 等领域状态的唯一写方：

1. 命令在一个事务内修改状态并排入 Effect；
2. 事务提交后才执行模型调用、Input delivery、reply 等外部副作用；
3. 每类 Effect 有顺序、并发、指数退避和健康状态；
4. Outbox 保存对外回复 receipt；
5. 重启后恢复未完成 Assignment 与待执行 Effect。

这比“调用成功后再尽量更新 UI”更能避免状态与实际副作用分裂。

### 2.6 暂停、停止、重试是三个不同动作

- **Pause processing**：停止新 Eval、dispatch、Input delivery 和回复；运行中的工作不被简单等同为崩溃；
- **Stop Ticket**：人撤销该工作的 Mandate；
- **Retry**：结束当前 Assignment，在保留的上下文/目录上启动新 Assignment；
- **Restart**：进程恢复后带 recovery note 继续，不把中断当作新工作。

### 2.7 上下文与未来模块要和原型区分

文章还提出：

- Inline & Spill：近期高价值信息内联，长内容保留摘要和续读入口；
- Chain of Recall：每个对象带下一跳 ID，沿引用图按需召回；
- 计算、状态和执行环境分离，支持云端常驻与 BYOM；
- 外部 Watchdog Session 判断“没崩溃但无进展/偏航”。

这些是有价值的方向，但公开原型并未全部实现；原型也没有独立长期记忆/RAG 系统。不能把文章能力全部当成开源代码事实。

---

## 3. 与当前 Pod v3 的逐项对照

| 能力 | Super-agent | 当前 Pod v3 | 判断 |
|---|---|---|---|
| 工作入口 | Ticket 由授权 Eval 创建 | Goal composer / MCP 共用 `goal-intake.ts`；Pod 队列启动 | **已借鉴** |
| 授权边界 | Mandate + Policy version + explicit/inferred | `authorization{source,requestMode,scope}`；UI 只接受 explicit | **轻量版已具备** |
| 人类注意力 | 结构化 stage，person 才需人 | `pod-stage.ts` 纯函数；仅计划批准/提问/blocked 进 attention | **已借鉴** |
| 结果可信 | Report ready 不等于完成 | PASS/FAIL/MAX_RETRIES/ERROR/CANCELLED + result evidence | **已借鉴且验收更强** |
| 工作流推进 | Engine + Assignment | 确定性 NodeDriver：plan→execute→review | **保留 MAFW 方案** |
| 独立验收 | 主要依赖 Executor Report | 独立 Reviewer + 每任务 rubric + artifact 双门 | **MAFW 优势，不替换** |
| 暂停/停止/重试 | 三者分离 | Pod pause/resume、Goal cancel、node retry 已分开 | **主体已具备** |
| 固定角色 | Router + 多 Worker | Lead / Builder / Reviewer；NodeDriver 控制拓扑 | **无需改成动态 swarm** |
| 后续归属 | Thread 订阅、follow-up owner、handback、handled | 有 Goal/task 引用与 per-recipient delivery，但无完整 follow-up 生命周期 | **下一优先缺口** |
| 可靠副作用 | 事务内 Effect，commit 后执行，自动退避 | delivery 行、pull/push、手动 retry/dismiss；无通用事务 Outbox/自动调度 | **下一优先缺口** |
| 外部事件准入 | Source/Trigger/Eval，off/observe/auto | A2A 只形成 external_request，不自动进入 waves；无 Source/Eval/Policy 版本 | **预留字段，机制未建** |
| 工作区与并行 | 每 Ticket 一个 Session + directory，worker slots | 单 active Goal；每节点建 Session；没有每 Goal 持久 Executor/workspace | **暂不宜先做** |
| 恢复 | Assignment recovery + durable Effects | state/产物优先恢复、确定性 watchdog、失败分类 | **核心已强，Effects 待补** |
| 上下文/记忆 | Thread 上下文、摘要与按需读取；长期记忆仍开放 | Pod 4KB 上下文 + 决策文件 + 谐波记忆检索 | **保留 MAFW 分层** |
| 外部 Watchdog | 模型判断无进展/偏航 | digest 无进展检测、超时/恢复与结构化失败 | **无需先复制模型 Watchdog** |

当前实现复核主要依据：

- `gateway/src/core/goal/driver.ts`
- `gateway/src/core/goal/goal-intake.ts`
- `gateway/src/core/goal/review-rubric.ts`
- `gateway/src/core/pod/pod-stage.ts`
- `gateway/src/core/pod/pod-goal-service.ts`
- `gateway/src/core/pod/pod-message-delivery.ts`
- `gateway/src/core/pod/pod-memory-service.ts`
- `gateway/src/core/pod/pod-task-service.ts`

---

## 4. 下一步最值得借鉴的三项

### 4.1 第一优先：follow-up ownership，而不是继续加已读回执

当前邮箱能表达 delivered/read 和 pull/push，但还不能完整回答：

1. 这条人的后续属于哪个 Goal？
2. 谁负责真正处理，而不只是收到？
3. 是否扩大了原 Goal 的 acceptance/scope？
4. 超范围后由谁 hand back、重新进入什么流程？
5. Goal 归档时是否还有未处理的人消息？

**适配 MAFW 时不宜机械绑定“原 Executor Session”。** Pod 的 plan/execute/review 是不同节点 Session，持久 owner 应是 Goal；由 NodeDriver 根据当前阶段和 follow-up 类型决定送到哪个节点。最小语义可包括：

- `goalId` 归属与 `owner = Goal`；
- `delivered / read / handled / answered / handedBack`；
- `handbackReason`；
- 归档前未处理 follow-up 检查，禁止静默消失。

### 4.2 第二优先：从现有 delivery 表长成小型 Outbox

不需要一步造通用 Effects 框架。先覆盖 Pod 消息、归档 decision 和关键外部回复：

- 状态变更与待投递记录同事务；
- commit 后才 prompt/HTTP/A2A；
- 每类副作用明确顺序、自动 retry/backoff、最终 failed/dropped；
- 启动时恢复 pending；
- UI 只把可行动且持续失败的问题显示为系统健康，不把普通 pending 当错误。

现有 `pod_message_deliveries.status/attempts/next_retry_at` 已是接缝，缺的是事务边界与后台调度闭环。

### 4.3 第三优先：外部/主动工作统一 admission

把桌面、Lead、A2A、automation 都映射到同一授权语义：

- explicit：明确请求，可按现有 Goal intake 执行；
- inferred：只形成候选；默认 observe，不自动执行；
- auto：只有命中启用规则才允许转成 Goal；
- 记录 source、scope、matched rules、policyVersion；
- 后续消息提供上下文，不自动扩大原授权。

这样未来接 GitHub/定时事件时，不会再长出一套绕过 Goal 权威的任务体系。

---

## 5. 暂缓或明确不照搬

### 5.1 暂不多 active Goal / 多 Builder

Super-agent 的 Worker 并行有价值，但 Pod 当前瓶颈不是执行槽数量，而是 follow-up 与副作用可靠性。直接并行会放大状态、工作区冲突和人类介入问题。确有需求时，应按 **Goal × workspace × Assignment** 设计，并保留人的优先介入通道，而不是只把 `activeGoalId` 改成数组。

### 5.2 不让 Lead 取代 NodeDriver

可以收敛 Lead 为弱 Router：识别新 Goal、已有 Goal follow-up 和 handback；但状态推进、重试、暂停、验收仍由确定性代码负责。不要让一个高权限 LLM 同时成为路由器、执行器和状态真相源。

### 5.3 不用自报 ready 替代 Reviewer

正确组合是：

> Super-agent 的 stage / admission / follow-up / durable lifecycle + MAFW 的 independent Reviewer / rubric / artifact gate。

### 5.4 不复制原型的安全边界

原型 Worker 采用高权限执行模型，且官方建议专用 OS 账户隔离。MAFW 不应把“Super-agent”理解为扩大工具权限；云端 BYOM、凭据使用和外部不可信输入必须另做安全设计。

### 5.5 不把文章方向当成已验证代码

云端常驻、通用链式召回、模型 Watchdog、投机执行等可继续研究，但不是当前 Pod 必须补齐的“标准功能”。尤其 MAFW 已有自己的记忆与恢复机制，不需要为对齐名词而重写。

---

## 6. 最终架构判断

Pod v3 当前可以概括为：

> **固定三人班底 + 单 active Goal 的确定性工作流 + 真正的人类 attention + 可审计结果。**

Super-agent 的下一步价值，是把它从“一个 Goal 能可靠跑完”扩展为“多个来源、后续消息和副作用也能长期可靠运转”。这条演进路径不需要推翻现有内核：

1. 先让每条人的后续有 owner、有处理闭环；
2. 再让每个外部副作用可恢复、可重试；
3. 然后让外部/主动候选通过统一授权进入 Goal；
4. 最后才根据真实负载增加并行 Worker 与独立 workspace。

**最值得借的是生命周期与可靠性，不是“超级Agent”这个名义。**

---

## 7. 官方来源

- [Super-agent 设计探索：迈向更自主的 Agent 系统](https://mp.weixin.qq.com/s/zoS7GlReWPhfCjENGxXCdg)
- [dsh-superagent-prototype README](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/README.md)
- [000 Philosophy](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/000-philosophy.md)
- [001 Domain model](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/001-domain.md)
- [002 Authorization](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md)
- [003 Execution](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md)
- [005 Panel](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/005-panel.md)
- [007 Architecture](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
