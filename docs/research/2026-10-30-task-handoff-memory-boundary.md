# 任务记忆、显式 Handoff 与长期记忆边界调研

> 日期：2026-10-30
> 范围：2025–2026 年多 Agent 框架、协议与产品；重点回答一个问题：
> **任务信息存 Pod 文件、由 Leader 显式发给 Worker 进入 prompt、长期记忆保持现有检索形式——业界是不是也这么做？**
> 前置调研：`docs/research/2026-10-29-agent-team-swarm-tower-pod.md`

---

## 0. 结论先行

**是，而且这正是主流做法。**

业界成熟系统普遍把四件事分开：

| 层 | 作用 | 典型载体 | 是否进长期记忆 |
|---|---|---|---|
| **任务状态/工件** | 这次任务做到哪、产物是什么 | 共享 task list、文件、artifact、DB | 否 |
| **Handoff 消息** | 把任务上下文显式交给下一个 agent | mailbox、SendMessage、task context、A2A Message | 否 |
| **Agent 工作上下文** | 当前 prompt 里看到什么 | spawn prompt、system blocks、上下文过滤 | 否 |
| **长期记忆** | 跨任务/跨会话可复用的知识 | 向量/图/结构化 memory、memory blocks | 是，但需要显式 capture |

没有一个主流框架会“任务一结束就把整段任务状态自动灌进长期记忆”。它们更常见的路径是：

> **任务状态留在任务工件 → 通过 handoff 把必要上下文交给下一个 agent → 只有被提炼/确认的经验才进入长期记忆。**

你的想法——Pod 文件承载任务、Leader 消息显式带任务信息、记忆仍用现有检索——与这个分层高度一致；真正缺的是 **handoff 的投递与结构化**，而不是记忆层统一。

---

## 1. Claude Code Agent Teams：最接近 Pod 的样本

官方文档（2026）给出的结构：

- 一个 **team lead** + 多个 **teammate**；
- **共享 task list**：pending / in progress / completed，支持依赖与自动 unblock；claim 用文件锁防竞态；
- **Mailbox**：每个 agent 一个 JSON inbox，消息自动投递给收件人，不需要轮询；
- **直接消息**：teammate 之间可以按名字互发，不必经过 lead；
- **上下文隔离**：每个 teammate 独立 context window；spawn 时加载项目上下文（CLAUDE.md/MCP/skills）+ lead 的 spawn prompt，**不继承 lead 的对话历史**；
- **完成通知**：teammate 空闲/失败会自动通知 lead，并附最终答案；
- **结构化协议消息**：计划批准、shutdown 等走同一 mailbox；消息写入失败会报错，不会“假装发出”。

关键启示：

1. **任务状态与消息分开**：task list 是权威状态，mailbox 是上下文交接。
2. **Handoff 是显式消息**：lead 不靠“共享全部 transcript”，而是把任务细节写进 spawn prompt / 后续消息。
3. **消息自动投递**：不是存起来等 worker 自己查。
4. **项目上下文自动加载，团队对话不共享**：既有共享基线，又有独立上下文。
5. **消息不是长期记忆**：teammate 的 mailbox 不会自动变成长期知识。

来源：<https://code.claude.com/docs/en/agent-teams>

---

## 2. OpenAI Agents SDK：Handoff 是“控制权转移 + 历史过滤”

OpenAI Agents SDK 把 handoff 定义为一等原语：

- handoff 后，新 agent **接管当前回合**，默认能看到完整对话历史；
- 可用 `input_filter` / `handoff_history_mapper` 控制“新 agent 看到哪些历史”；
- `RunContextWrapper.context` 承载应用状态和依赖，不塞进消息；
- `agents as tools` 与 `handoffs` 是两种不同模式：前者保留 manager 的最终答复权，后者把控制权交给 specialist；
- `on_handoff`、`input_type` 可携带结构化元数据。

启示：

- **Handoff 不是“发一条聊天消息”那么简单**，它包含：谁接管、看到多少历史、带什么结构化输入、输出给谁。
- **上下文过滤是必需的**：全量历史会带来 token 成本和干扰。
- 这与你的“Leader 显式带上任务信息”一致；业界会把这个信息做成结构化 handoff，而不是自由文本。

来源：<https://openai.github.io/openai-agents-python/handoffs>

---

## 3. Google A2A：Task / Message / Artifact 三件套

A2A 协议把远程协作拆成：

- **Task**：工作的基本单位，有唯一 ID 和生命周期；
- **Message**：client 与 remote agent 之间的一次通信，包含 role + parts；
- **Artifact**：任务产生的输出（文档、图片、结构化数据），由 parts 组成；
- 协作过程中 agent 可以发消息同步状态、传上下文、回传 artifact；
- 任务可以即时完成，也可以长时间运行，通过状态/artifact 更新保持同步。

启示：

- **任务、消息、产物**是三个不同的对象，不该混成“一个 memory”。
- Handoff 消息可以引用任务和 artifact，而不需要把产物全文塞进 prompt。
- 这正好支持你的“任务存 Pod 文件，消息里带任务信息/指针”的做法。

来源：<https://github.com/a2aproject/A2A/blob/main/docs/specification.md>

---

## 4. CrewAI：Task 自带 description / expected_output / context / output_file

CrewAI 的 Task 模型很接近“工单”：

- `description`：要做什么；
- `expected_output`：完成标准；
- `agent`：谁负责；
- `context`：依赖哪些前序 task 的输出；
- `output_file`：产物落文件；
- `output_json` / `output_pydantic`：结构化输出；
- `guardrail` / `guardrails`：验收门，失败可重试；
- `human_input`：人工复核；
- 另有独立的 **Memory** 系统（统一 Memory class，支持 scope/importance/recency 检索）。

启示：

- **任务上下文靠 task 定义与 context 传递**，不是靠长期记忆召回。
- **产物落文件**，下一步任务按需引用，不需要把全文放进上下文。
- **长期记忆是另一个系统**，与 task 状态分离。
- 你的 Pod task 文件 + Leader 消息 + 现有 memory，正好对应这三块。

来源：<https://docs.crewai.com/en/concepts/tasks>、<https://docs.crewai.com/v1.15.32/en/concepts/memory>

---

## 5. MetaGPT：共享消息池 + SOP + 结构化产物

MetaGPT 的经典设计：

- 把软件公司 SOP 编码进 prompt 序列；
- 每个角色按 schema 产出结构化文档（需求、设计、接口、序列图等）；
- **全局 message pool**：agent 发布结构化消息，其他 agent 透明读取；
- 不需要“问另一个 agent 然后等回复”。

启示：

- **共享池/黑板**适合任务状态与产物；直接消息适合定向 handoff。
- 结构化输出比自由文本更容易被下游消费。
- 这与 Pod 的文件任务板 + mailbox 是同一类设计。

来源：<https://www.ibm.com/think/topics/metagpt>、<https://openreview.net/forum?id=VtmBAGCN7o>

---

## 6. LangGraph：短期记忆 = thread state，长期记忆 = namespace store

LangGraph 的官方区分非常明确：

- **短期记忆**：thread-scoped state，由 checkpointer 持久化；包含消息历史、上传文件、检索文档、生成 artifact；每个 step 读 state；
- **长期记忆**：跨 thread，存在自定义 namespace/store 中；
- 持久化 state 不等于“全部发给模型”；节点自己决定从 state 里取什么进模型上下文。

启示：

- **任务状态是 state，不是 memory**。
- **“保存”与“注入模型”是两件事**：state 可以很大，prompt 只取需要的部分。
- 这对 Pod 很关键：Pod 文件可以完整，handoff prompt 只带任务相关切片。

来源：<https://docs.langchain.com/oss/python/concepts/memory>

---

## 7. Mem0 / Letta：长期记忆靠 scope 和显式写入

### Mem0

Mem0 的多 Agent 记忆按四个维度隔离：

- `user_id`：个人记忆；
- `agent_id`：agent 专属上下文；
- `run_id`：会话隔离；
- `app_id`：应用级默认。

它强调：**scope 决策很难后改，要尽早定对**。多 Agent 系统通常需要“共享用户级上下文 + 每个 agent 自己的 role 记忆”，而不是所有 agent 共用一个无边界库。

### Letta

Letta 的 agent 由 system prompt + **memory blocks** + messages + tools 组成：

- memory blocks 可 attach/detach，可被多个 agent 共享；
- block 在 context 内（pinned to system prompt），也可有 out-of-context 的 archival/recall；
- 所有消息都存储，压缩/驱逐后仍可通过 API/检索工具取回。

启示：

- 长期记忆需要 **scope** 和 **显式写入**，不是任务日志的自动副本。
- “共享 block”与“私有 block”可以并存；Pod 的共享章程可以类比 shared block，但写入权限要单独治理。

来源：<https://docs.mem0.ai/platform/features/entity-scoped-memory>、<https://mem0.ai/library/agent-memory/multi-agent-memory-systems>、<https://docs.letta.com/v1-sdk/concepts/stateful-agents>

---

## 8. Blackboard / 共享工件：任务上下文不一定靠消息

Blackboard 架构：

- 中央共享工作区，agent 发布/读取部分解；
- 可以是中心协调者分配任务，也可以是 agent 自愿认领；
- 通信是异步、间接的，通过共享状态而非直接消息；
- 难点是冲突控制、轮次/控制壳、状态一致性。

AutoGen 社区也有“共享状态黑板 + propose/validate/commit + 优先级”的实践，用来解决多对话并发写同一任务状态的竞态。

启示：

- **共享工件是 handoff 的补充**：消息适合“叫醒/定向交接”，文件适合“大块上下文/产物”。
- 你的 Pod 文件 + 消息正好覆盖两者：文件是黑板，消息是 handoff。

来源：<https://arxiv.org/html/2510.01285v1>、<https://github.com/microsoft/autogen/discussions/7144>

---

## 9. 其他产品信号（来自前置调研）

- **Anthropic multi-agent research**：子 agent 输出到文件系统，只把轻量引用传回 lead；任务描述包含目标、输出格式、工具/来源、边界。
- **MiniMax Agent Team**：handoff artifact + 共享 notepad/whiteboard + 长期 memory/skills；Leader/Worker/Verifier 状态机。
- **Cursor Agent Swarm**：共享 design docs + Field Guide（自动注入每个 agent 的共享上下文）+ 独立 merge resolver；planner/worker 上下文效率优先。
- **Cognition 反方**：只给子 agent 一句子任务会导致隐含假设不一致；要么共享足够上下文，要么单 agent。**这支持“handoff 要带结构化任务信息 + 工件指针”，而不是一句“去做 X”。**

来源：`docs/research/2026-10-29-agent-team-swarm-tower-pod.md` 及其引用。

---

## 10. 综合：业界实际采用的四层模型

```
┌────────────────────────────────────────────┐
│ 1. 任务状态 / 工件（权威）                    │
│    task list、task 文件、artifact、output_file │
│    生命周期：任务内 / 项目内                   │
└──────────────────┬─────────────────────────┘
                   │ 显式 handoff（消息/任务定义）
                   ▼
┌────────────────────────────────────────────┐
│ 2. Handoff 上下文（定向、结构化、可过滤）      │
│    task description / expected output /      │
│    context refs / artifacts / acceptance     │
└──────────────────┬─────────────────────────┘
                   │ prompt 组装
                   ▼
┌────────────────────────────────────────────┐
│ 3. Agent 工作上下文（当前回合）               │
│    spawn prompt / task block /               │
│    project context / 相关文件切片             │
└──────────────────┬─────────────────────────┘
                   │ 显式 capture / 蒸馏
                   ▼
┌────────────────────────────────────────────┐
│ 4. 长期记忆（跨任务/跨项目）                  │
│    scoped memory、retrieval、consolidation    │
└────────────────────────────────────────────┘
```

**你的模型对应 1 + 2 + 4：**

- Pod 任务文件 = 第 1 层；
- Leader 给 Worker 的消息 = 第 2 层；
- 现有谐波记忆 = 第 4 层；
- 第 3 层是 agent prompt 组装，`<pod-context>` + handoff 块 + `<recall>` 可以共存。

不需要把 1/2 塞进 4；也不需要在 1 里再造一套检索。

---

## 11. 对 MAFW 的直接建议

### 11.1 把 PodMessage 升级为 Handoff Envelope

```ts
PodMessage {
  fromMemberId
  toMemberId
  kind: 'request' | 'review' | 'decision' | 'escalation' | 'note'
  goalId?: string
  taskId?: string
  title?: string
  expectedOutput?: string
  contextRefs?: string[]     // 文件/previous message/task id
  artifactRefs?: string[]    // 产物路径
  acceptance?: string[]      // 验收条件
  body: string
  deliveredAt?: string
  deliveredSessionId?: string
  readAt?: string
}
```

不是所有消息都要这么重；`kind:'request'` 的任务交接用结构化字段，`note` 保持自由文本。

### 11.2 投递：push + pull 分流

| 收件人 | 策略 |
|---|---|
| coordination（Lead/Manager 长驻） | `promptAsync` 推送，`delivery:'queue'` |
| plan / execute / review（NodeDriver session） | 不额外推一轮；下一次 node prompt 以 pending handoff 注入 |
| 无 session | 保持 pending，绑定时重放 |

理由：NodeDriver 的完成判定是 `turn.completed + 产物文件`；额外消息回合会干扰节点语义。Claude Code 的 mailbox 自动投递、OpenAI handoff 控制权转移，都说明“投递”是必需的，但投递方式要匹配执行器。

### 11.3 幂等与状态

- 同一 `(messageId, sessionId)` 只投一次；
- `deliveredAt` 在 prompt 接受后写；
- 失败保持 pending；
- `readAt` / ack 由 Worker 回复或任务状态更新驱动；
- 新 session 绑定可重放未投递消息，但不重放已投递历史。

### 11.4 长期记忆仍然显式

- handoff 消息不进谐波记忆；
- Worker 认为值得长期保留，自己调 `mafw_add_memory`；
- 任务归档后，可选的 post-task distillation 只写“泛化后的教训”，带 `source_pod/source_goal/verified`；
- 不做“消息自动入全局记忆”。

### 11.5 评估指标

- handoff 完整率（目标/输出/约束/工件是否齐）；
- 重复工作率（Worker 是否重新探索已给信息）；
- 投递延迟 / 失败重放率；
- 额外 token（handoff 块 vs 全量 transcript）；
- 任务完成率 / 返工率；
- 跨 Pod 泄漏（消息/记忆是否串项目）。

---

## 12. 结论

你的直觉和业界一致：**任务记忆留在任务工件（Pod 文件），用显式消息把任务信息送进 agent prompt，长期记忆仍走现有检索。** 业界没有把“任务状态”当“长期记忆”自动沉淀；它们把任务、handoff、工作上下文、长期记忆分成四层。

MAFW 当前缺的不是 Memory Fabric，而是 **Pod handoff 的结构化与投递**。先把这件事做好，再谈 Curator/Task Force，顺序更稳。

---

## 13. 来源

- Claude Code Agent Teams：<https://code.claude.com/docs/en/agent-teams>
- OpenAI Agents SDK Handoffs：<https://openai.github.io/openai-agents-python/handoffs>
- Google A2A Specification：<https://github.com/a2aproject/A2A/blob/main/docs/specification.md>
- CrewAI Tasks：<https://docs.crewai.com/en/concepts/tasks>
- CrewAI Memory：<https://docs.crewai.com/v1.15.32/en/concepts/memory>
- MetaGPT（IBM 概览）：<https://www.ibm.com/think/topics/metagpt>
- MetaGPT 论文：<https://openreview.net/forum?id=VtmBAGCN7o>
- LangGraph Memory：<https://docs.langchain.com/oss/python/concepts/memory>
- Mem0 Entity-Scoped Memory：<https://docs.mem0.ai/platform/features/entity-scoped-memory>
- Mem0 Multi-Agent Memory：<https://mem0.ai/library/agent-memory/multi-agent-memory-systems>
- Letta Stateful Agents：<https://docs.letta.com/v1-sdk/concepts/stateful-agents>
- Blackboard 论文：<https://arxiv.org/html/2510.01285v1>
- AutoGen 共享状态讨论：<https://github.com/microsoft/autogen/discussions/7144>
- 前置团队形态调研：`docs/research/2026-10-29-agent-team-swarm-tower-pod.md`
