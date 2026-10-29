# Agent Team / Agent Swarm 组织形态调研：塔、蜂群、鲸群

> 日期：2026-10-29
> 范围：2025–2026 年业界产品、框架、实证研究与 MAFW 映射
> 后续决策：用户选择**项目级鲸群**，v1 为 3 人 Pod Lite（Lead + Builder + Reviewer）；落地设计见 `docs/superpowers/specs/2026-10-29-project-pod-lite-design.md`。
> 结论先行：**塔、蜂群、鲸群不是互斥选项，而是三种组织原型。生产系统几乎都是混合体：塔做治理，鲸群做长期执行，蜂群做弹性并行。**

---

## 0. 先校准三个词

公开资料里没有把“塔 / 鲸群”固定成术语。本文按组织隐喻使用，并把常被混用的 Agent Team / Agent Swarm 放进来对照。

| 原型 | 一句话 | 控制权 | 规模 | 生命周期 | 上下文 | 典型代表 |
|---|---|---|---|---|---|---|
| **塔（Tower）** | 层层委派、逐级汇报的层级组织 | 集中 | 3–10+ | 中/长 | 每层过滤后上传 | Supervisor、Hierarchical、CrewAI hierarchical、goal 的 plan→execute→review |
| **蜂群（Swarm）** | 大量短生命周期 worker 并行分区干活 | 分散或“中央 orchestrator + 分布式 worker” | 10–300+ | 短 | 分片、各自持有 | Kimi Agent Swarm、fan-out、batch research |
| **鲸群（Pod）** | 小而稳、长期协作、共享记忆/方言的团队 | 共享/Lead | 3–7 | 长 | 高共享、高信任 | Claude Code Agent Teams、MiniMax Agent Team、Cursor planner/worker 小队 |

两个校准点：

1. **“Agent Swarm”在产品里通常不是纯去中心化。** Kimi 的 swarm 有主 Agent/orchestrator；Cursor 的 swarm 有 planner 树；Claude 的 Teams 有 lead。真正纯 peer-to-peer 的生产系统很少。
2. **“鲸群”不是“更大的蜂群”。** 自然界里稳定的鲸群通常是小型、多代、长期合作的社会群体（抹香鲸/虎鲸有母系结构和群体方言），更适合比喻“小而稳、共享上下文”的团队；300 个临时 agent 更接近蜂群，而不是鲸群。这个区别对架构设计很关键。

> 因此本文把“Agent Team”主要落在塔/鲸群，把“Agent Swarm”主要落在蜂群；但产品和营销经常混用，读的时候要看**谁有权决定下一步**，而不是看名字。

---

## 1. 一句话结论

多 Agent 的收益不来自“agent 数量”，而来自**组织方式与任务结构的匹配**。同一批模型、同一批题，只换组织方式，效果可以从 **+80.8%** 到 **−70.0%**（arXiv:2512.08296）。生产上最稳的形态不是纯 swarm，而是：

> **中央规划（塔） + 分布式执行（蜂群/鲸群） + 独立验证（verifier） + 共享工件（blackboard）**

---

## 2. 三种原型对照

| 维度 | 塔（Tower） | 蜂群（Swarm） | 鲸群（Pod） |
|---|---|---|---|
| **谁决定下一步** | 上级/规划者 | 调度器或局部规则 | Lead + 成员协商 |
| **任务拆分** | 递归分解，逐层下发 | 按输入/分区横切 | 按角色/专长分工 |
| **通信** | 上行汇报、下行指令 | 分区广播、结果汇总 | 直接消息、共享任务板 |
| **上下文** | 每层只带摘要，易丢细节 | 每个 worker 一个 shard | 共享团队记忆 + 各自笔记 |
| **优势** | 治理、预算、风险控制、可解释 | 吞吐、广度、速度、弹性 | 长期一致性、信任、复用、质量 |
| **失败模式** | 瓶颈、传话游戏、层级僵化 | 群体思维、成本爆炸、合并冲突、验证缺失 | 小团体盲区、扩展性有限、过度耦合 |
| **最适合** | 目标治理、跨团队协调、高风险决策 | 大规模检索、批处理、独立子任务、多视角 | 长期项目、持续迭代、复杂代码库、需要记忆的工作 |
| **不适合** | 高度探索、需要快速试错 | 强顺序依赖、同文件编辑、共享上下文 | 一次性、超大吞吐、无长期价值的任务 |

### 2.1 塔：把“谁负责”说清楚

塔的核心不是“多”，而是**权限链和预算链**。它解决的是：

- 谁可以把任务拆给谁；
- 谁对最终结果负责；
- 出问题向谁升级；
- 成本/风险在哪一层被截断。

塔的代价是**传话游戏**：每一层都要把上下文压缩成摘要，细节和隐含决策容易丢失。LangGraph 的 supervisor 基准里，supervisor 比 swarm 略差，主要原因就是 sub-agent 不能直接回复用户，supervisor 要做“翻译”，既增加 token 又增加错误。改进后的 supervisor（去掉 handoff 消息、增加 forward_message、调整 tool 命名）把性能拉回了近 50%。

**设计要点**：塔可以存在，但不要让它做所有事；让它负责**规划、预算、升级、验收**，把执行下沉。

### 2.2 蜂群：用广度换时间，但必须有人收口

蜂群的典型形态是“一个 orchestrator + N 个 worker”：

- orchestrator 决定拆不拆、拆几份、谁做；
- worker 各自在独立上下文里执行；
- 结果汇总/验证后交付。

Kimi 的 Agent Swarm 是最典型的规模化样本：K2.5 支持最多 100 个子 Agent、1,500 次工具调用、约 4.5× 加速；K2.6 把上限推到 300 个子 Agent、4,000 次工具调用；训练用 PARL，只训练 orchestrator，子 Agent 冻结，奖励由“最终质量 + 是否真并行 + 子任务完成率”组成。它还强调 **context sharding**：每个子 Agent 只记自己的“笔记本”，只把关键结论汇报给 orchestrator。

蜂群的真正优势不是“人多”，而是：

- **上下文分片**：突破单窗口；
- **广度**：同时探索多个方向；
- **多视角**：结构上制造“建设性分歧”，避免群体思维；
- **弹性**：按任务规模扩缩。

蜂群的代价：

- token 成本近似线性甚至超线性；
- 验证和合并成本高；
- 容易出现“虚假并行”（拆了但没收益）；
- 容易出现 split-brain（两个 planner 对同一问题做了不同决定）；
- 合并冲突、文件争用、任务状态滞后。

**设计要点**：蜂群必须有**中央收口**（规划/验证/预算）和**共享工件**（文件、任务板、设计文档），否则就是“更贵的并发”。

### 2.3 鲸群：小、稳、长期，才是“团队”

鲸群原型的关键词是**持久**：

- 成员稳定，角色清晰；
- 共享记忆、术语、规范；
- 长期协作，能积累“我们以前怎么做”的经验；
- 有 lead，但成员可以直接沟通；
- 质量靠互相 review，而不是靠一个全能的上级。

Claude Code 的 Agent Teams 很接近这个形态：lead + 3–5 个 teammate，共享 task list，teammate 之间可以直接 message；每个 teammate 有独立上下文；lead 固定，不能嵌套团队；实验性、默认关闭；官方明确说 token 成本显著更高，适合研究/评审/新模块/竞争性假设调试，不适合顺序任务、同文件编辑、强依赖任务。

MiniMax 的 Agent Team 也是“鲸群 + 验证”的形态：Leader / Worker / Verifier 三角色，Team Engine 用状态机管理 `producing → verifying → done`，Verifier 和 Worker 是对抗关系；Agent 和人有对等的操作界面；协作靠 handoff artifact、共享 notepad/whiteboard、长期 memory/skills。

**设计要点**：鲸群的价值在“长期复用”和“质量”，不在“规模”。3–5 个专注的 teammate 常常胜过 5 个散的；如果任务需要 50 个 worker，那是蜂群，不是鲸群。

---

## 3. 业界地图

### 3.1 Kimi Agent Swarm：中央 orchestrator + 大规模并行

- **拓扑**：主 Agent（orchestrator）+ 最多 100/300 个子 Agent；不是纯 P2P。
- **数字**：K2.5 100 子 Agent / 1,500 tool calls / 4.5×；K2.6 300 子 Agent / 4,000 tool calls；K3 继续提升。
- **训练**：PARL，orchestrator 学习“何时并行、雇谁、怎么委派”，子 Agent 冻结。
- **上下文**：context sharding，每个子 Agent 独立笔记本，只汇报关键结论。
- **适用**：大规模信息检索、批量下载、多文件处理、长文写作、多视角评审。
- **风险**：成本高；任务必须可拆；质量不一定胜过单 Agent；子 Agent 之间直接协作仍有限。
- **可借鉴**：context sharding；orchestrator 的“关键步骤”指标；用“最终质量 + 并行真实性 + 子任务完成率”防止虚假并行。

来源：Kimi 帮助中心、Kimi 官方 blog、K2.5 技术报告解读。

### 3.2 Claude Code Agent Teams：小团队 + 共享任务板 + 直接消息

- **拓扑**：lead + 3–5 teammates；共享 task list；mailbox；teammate 可直接 message；每个 teammate 独立上下文；lead 固定；无嵌套团队；一个 session 一个 team。
- **状态**：实验性，默认关闭；需要 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`。
- **适用**：研究/评审、新模块/新功能、竞争性假设调试、跨层协调。
- **不适用**：顺序任务、同文件编辑、强依赖任务；官方建议先试研究/评审，再试并行实现。
- **成本**：显著高于单 session；每个 teammate 独立 context window。
- **限制**：in-process teammate 不支持 session resume；任务状态可能滞后；shutdown 可能慢；teammate 不能嵌套团队；teammate 不能代替用户批准权限。
- **可借鉴**：共享 task list + mailbox；3–5 人规模；文件所有权（避免同文件冲突）；hooks 做质量门（TeammateIdle / TaskCreated / TaskCompleted）。
- **一句话**：这是“鲸群”形态，不是大规模蜂群。

来源：Claude Code 官方文档 `code.claude.com/docs/en/agent-teams`。

### 3.3 Anthropic Research：Lead + 并行 subagents

- **拓扑**：LeadResearcher + 多个 Subagent + CitationAgent；orchestrator-worker。
- **数字**：多 Agent 比单 Agent Opus 4 高 **90.2%**；多 Agent 约 **15×** chat token；单 Agent 约 4×；复杂查询时间降低最多 90%；3–5 个 subagent 并行、每个 3+ 工具并行。
- **关键经验**：
  - 任务描述必须包含目标、输出格式、工具/来源、边界；
  - 按复杂度分配 effort（简单 1 agent / 3–10 calls；复杂 >10 subagents）；
  - 子 Agent 输出到文件系统，只把轻量引用传回 lead，避免“传话游戏”；
  - 同步执行是瓶颈；异步是未来方向；
  - 评估用 LLM judge + 人工；先 20 个 query 就能看到效果。
- **可借鉴**：artifact filesystem；context 分片；effort scaling；独立 Citation/Verifier。
- **风险**：15× token；同步等待；协调复杂度随 agent 数增长。

来源：Anthropic Engineering, “How we built our multi-agent research system”, 2025-06-13。

### 3.4 MiniMax Agent Team：Leader / Worker / Verifier + 状态机

- **拓扑**：Leader 拆任务；Worker 执行；Verifier 验收；Team Engine 状态机管理 `producing → verifying → done`；失败回到 producing。
- **关键设计**：
  - Worker 和 Verifier 是对抗关系，避免“自己判自己”；
  - Agent 和人对等的操作界面（用户可以 prompt/spawn/abort/kill，Agent 也可以对另一个 Agent 做同样的事）；
  - handoff artifact + 共享 notepad/whiteboard；
  - 长期 memory/skills 沉淀；
  - “多 Agent 是 runtime，不是 prompt 编排”。
- **成本**：handoff cost、sharing cost、aggregation cost；论文 “Cost of Consensus” 指出同质 debate 可达 isolated self-correction 的 2.1–3.4× token，准确率不一定提升。
- **适用**：长任务、IM 异步、Coding Harness、并行检索、Office 文档流水线。
- **可借鉴**：Leader/Worker/Verifier 三角色；状态机；共享白板；把团队当运行时而不是提示词模板。

来源：MiniMax blog, “MiniMax Agent Team: Built for Long-Running Tasks and Continuous Evolution”, 2026-05-27。

### 3.5 Cursor Agent Swarm：Planner/Worker 树 + 自建 VCS + 共享 Field Guide

- **拓扑**：Planner agents（强模型）递归拆任务；Worker agents（便宜模型）执行；树形分解；不是固定拓扑，而是“形状跟着问题走”。
- **数字**：SQLite 从 835 页文档重建，4 小时内 73%–85%，最终 100% 通过 sqllogictest；1,000 commits/秒；成本 $1,339（Opus 4.8 planner + Composer 2.5 worker）到 $10,565（GPT-5.5 全栈）。
- **关键设计**：
  - Planner 不做实现，Worker 不做规划，上下文效率比并行本身更重要；
  - 自建 VCS 处理高并发；
  - split-brain：planner 自己做设计决策，禁止两个子树决定同一个问题；
  - planner 冲突：共享 design docs + 编译检查引用 + reconciler；
  - merge conflict：中立第三方 agent 解决；
  - megafiles：worker 标记膨胀文件，外部 agent 拆分；
  - ossification：允许“有意的破坏”，让编译器把变更传播到依赖方；
  - review lenses：不同 reviewer 看 transcript/output/codebase，decorrelated lenses 叠加；
  - Field Guide：agent 自己维护的共享上下文，index 自动注入每个 agent；stigmergy。
- **可借鉴**：planner/worker 模型分工；共享设计文档；独立 merge resolver；review lenses；Field Guide。
- **风险**：需要强大的 VCS/合并/观测基础设施；成本跨度大；质量依赖验证。

来源：Cursor blog, “Agent swarms and the new model economics”, 2026-07-20。

### 3.6 OpenAI Agents SDK / LangGraph / AutoGen：原语与拓扑

- **OpenAI Agents SDK**：两种主模式——`agents as tools`（manager 保留最终答复权）和 `handoffs`（ specialist 接管当前回合）；支持 LLM 编排与代码编排；guardrails/tracing。适合做产品内协作，不是大规模独立任务执行。
- **LangGraph**：supervisor / swarm / hierarchical / custom graph；状态可持久化、可暂停/恢复、可人工介入；benchmark 显示 swarm 略优于 supervisor，但 supervisor 更通用、更容易加治理；改进后的 supervisor 可缩小差距。
- **AutoGen**：`RoundRobinGroupChat`、`SelectorGroupChat`、`MagenticOneGroupChat`、`Swarm`；强调 termination conditions、state/resume；官方建议先单 Agent，再团队。
- **共同点**：真正的差异不在 API，而在**谁有权决定下一步、上下文怎么传、什么时候停**。

### 3.7 反方：Cognition “Don’t Build Multi-Agents”

Cognition 的核心论点：

1. **Share context, and share full agent traces, not just individual messages.** 子 Agent 如果只拿到一句子任务，会基于不同隐含假设做出一致性很差的产物。
2. **Actions carry implicit decisions.** 两个子 Agent 各自做决定，最后合并时冲突；这不是“沟通一下”能解决的。
3. **默认用单线程线性 Agent**；上下文不够时，用压缩/摘要模型，而不是直接上多 Agent。
4. 2025 年的多 Agent 协作仍然脆弱；等单 Agent 的沟通能力更强，再解锁更大并行。

这不是否定多 Agent，而是提醒：**不要把“多 Agent”当成上下文工程的替代品**。如果任务需要共享大量隐含决策，塔/蜂群都会比单 Agent 更脆弱。

来源：Cognition blog, “Don’t Build Multi-Agents”, 2025-06-12。

---

## 4. 实证：什么时候多 Agent 真的有用

### 4.1 架构与任务匹配决定成败

arXiv:2512.08296 “Towards a Science of Scaling Agent Systems” 做了 260 个配置、6 个 benchmark、5 种架构（Single / Independent / Centralized / Decentralized / Hybrid）的受控评估：

- 相对单 Agent 的变化范围：**+80.8%**（可分解的金融推理）到 **−70.0%**（顺序规划）。
- **集中式验证**比无中心架构更能抑制错误传播。
- 单 Agent 基线越强，协调带来的边际收益越小。
- 工具密集型任务会承担多 Agent 开销。
- 架构选择能解释 87% 的 held-out 配置。

**含义**：不要问“多 Agent 好不好”，要问“这个任务的结构像什么”。

### 4.2 多 Agent 的甜蜜点

综合 Anthropic / Kimi / Cursor / LangGraph：

- 任务可分解为**独立或弱依赖**的子任务；
- 需要**广度**：多来源、多文档、多假设、多视角；
- 单上下文装不下，需要**分片**；
- 工具体系复杂，需要**专业化**；
- 有**确定性验证**（测试、引用、schema、benchmark）可以收口；
- 任务价值足够高，能覆盖 4×–15× token。

### 4.3 多 Agent 的反例

- 强顺序依赖（先想清楚论点，再找证据，再写结论）；
- 同文件编辑、共享状态频繁冲突；
- 需要大量隐含决策一致性的任务；
- 单 Agent 已经能做好，且成本敏感；
- 没有验证器，只有“多个人投票”；
- 任务太短，协调开销 > 收益。

### 4.4 成本现实

| 来源 | 成本信号 |
|---|---|
| Anthropic | 多 Agent ≈ 15× chat token；单 Agent ≈ 4× |
| Kimi | 100/300 agent 并行，额度消耗数倍；4.5× 速度 |
| Cursor | SQLite 重建 $1,339–$10,565；planner 贵、worker 便宜 |
| MiniMax | handoff/sharing/aggregation 三类成本；同质 debate 2.1–3.4× token |
| LangGraph | supervisor 比 swarm 更费 token（翻译层） |

**结论**：多 Agent 是“用钱买时间/广度/质量”的工具，不是默认架构。

---

## 5. 失败模式清单

| 失败模式 | 症状 | 缓解 |
|---|---|---|
| **群体思维 / 相关错误** | 多个 agent 给出一致但错误的答案 | 独立上下文、不同模型/视角、debate、decorrelated reviewers |
| **传话游戏** | 子 Agent 误解任务，合并时风格/假设冲突 | 共享完整 trace/工件；结构化 handoff；输出 schema |
| **Split-brain** | 两个 planner 对同一问题做了不同决定 | 设计决策上收；共享 design doc；reconciler；编译检查引用 |
| **合并冲突** | 多 agent 改同一文件，互相覆盖 | worktree/文件所有权；merge queue；中立 resolver |
| **任务状态滞后** | 任务显示未完成，实际已完成；依赖被阻塞 | 状态机 + heartbeat + watchdog；确定性完成判定 |
| **验证剧场** | Verifier 走过场，和 Worker 串通 | 独立 verifier；确定性测试；证据链；人工抽检 |
| **成本爆炸** | 无限 spawn、循环重试、上下文膨胀 | max agents / max tokens / max wall time / stop conditions |
| **权限/安全** | teammate 代替用户批准；prompt injection | 最小权限；沙箱；审批边界；审计日志 |
| **不可观测** | 不知道谁做了什么、为什么失败 | per-agent trace、cost、artifact、replay |
| **过度工程** | 3 个 agent 能做的事上了 30 个 | 先单 Agent；3–5 起步；按指标扩 |

---

## 6. 设计手册：从任务形状选拓扑

### 6.1 先问四个问题

1. **任务能不能拆成独立/弱依赖的子任务？**
   - 不能 → 单 Agent 或 pipeline。
2. **子任务之间需不需要共享大量隐含决策？**
   - 需要 → 单 Agent / 小 Pod，不要大 Swarm。
3. **有没有确定性验证？**
   - 没有 → 先补验证，再谈多 Agent。
4. **任务价值能不能覆盖 4×–15× token？**
   - 不能 → 单 Agent。

### 6.2 拓扑选择

| 任务形状 | 推荐拓扑 | 备注 |
|---|---|---|
| 线性步骤、强依赖 | Pipeline / 单 Agent | 不要为了并行而并行 |
| 独立分区、批量处理 | Fan-out / Swarm | 每个 worker 一个 shard；结果 schema |
| 多视角评审、竞争性假设 | Debate / Pod + Verifier | 独立上下文；decorrelated lenses |
| 长期项目、持续迭代 | Pod | 3–7 人；共享记忆/任务板 |
| 跨团队治理、高风险 | Tower | 规划/预算/审批/验收上收 |
| 大型代码库、多文件 | Tower + Pod + Worktree | planner 树 + 文件所有权 + merge queue |
| 大规模检索/文档 | Swarm | context sharding；只回结论 |

### 6.3 七条工程规则

1. **默认单 Agent**；只有任务形状证明需要时才加。
2. **规划集中、执行分散、验证独立**。
3. **共享工件优先于消息传递**：文件、任务板、设计文档、schema。
4. **每个 worker 有明确边界**：目标、输入、输出格式、工具、禁止动作、预算。
5. **验证必须独立**：不能让生产者给自己打分；测试/证据优先。
6. **小团队起步**：3–5 个；需要更大规模时先证明协调收益。
7. **可观测/可恢复**：状态机、trace、cost、artifact、replay、kill switch。

### 6.4 模型经济学

Cursor 的数据很有说服力：

- Planner 用强模型，Worker 用便宜模型；
- Worker 承担 69%–90% 的 token；
- Planner token 少但贵，占总成本约 2/3；
- 同样的质量，成本可以从 $1,339 到 $10,565。

**做法**：把“模糊性”留给强模型（拆解、设计决策、验收标准），把“执行”交给便宜模型；不要把强模型浪费在机械执行上。

---

## 7. 对 MAFW 的映射

### 7.1 MAFW 已经有什么

| 能力 | 现状 | 对应原型 |
|---|---|---|
| Goal 编排 | plan → execute → review → archive；state v3；NodeDriver | 塔 |
| Waves | `waves.json`；按 wave 执行；plan 可人工批准 | 塔 |
| 子代理 | `mafw_spawn_subagent` / message / result / cancel；parentID/depth | 蜂群/塔的叶子 |
| 工作树 | 每会话独立 worktree；删除联动清理 | 蜂群隔离 |
| 审查 | review 节点 + evidence + receipts；W1 计划审阅 | 塔的验收 |
| Manager | 每项目常驻 session；不写代码；只通过 mafw_* 工具操作 | 鲸群 Lead |
| 记忆 | 谐波记忆；pinned/sticky；子代理禁止写全局记忆 | 鲸群共享记忆 |
| 观测 | 子代理 Dock、goal 泳道、trajectory、cost | 可观测性 |
| 运行控制 | run state 软暂停/恢复；checkpoint；budget guard | 塔的治理 |

### 7.2 缺口

| 缺口 | 影响 |
|---|---|
| 没有 team/pod 一等对象 | 无法表达“一个长期团队”，只能临时 spawn |
| 没有共享 task board / mailbox | 子代理是父→子一次性 prompt，缺少多轮协作 |
| 没有 verifier 角色 | review 是 goal 级，不是每个 worker 的独立验收 |
| 没有共享团队记忆 | 子代理不能写全局记忆；团队经验难沉淀 |
| 没有批量 fan-out | 只能逐个 spawn，缺少 batch/partition/aggregate |
| 没有 merge queue / resolver | 多 agent 写代码时冲突处理弱 |
| 没有 pod UI | SubagentDock 只有树，没有 roster/task board/messages/cost |
| 没有多 Agent 评估基线 | 无法证明“加 agent 比单 Agent 更好” |

### 7.3 建议：Tower + Pod + Swarm 三层

```text
┌─────────────────────────────────────────────────────────────┐
│ Tower：Goal 控制面（治理）                                    │
│  charter → plan → 人工批准 → execute(wave) → review → archive │
│  预算 / 风险 / 升级 / 证据 / 人工门                            │
└───────────────────────────┬─────────────────────────────────┘
                            │
        ┌───────────────────┴───────────────────┐
        │                                       │
┌───────▼──────────────┐              ┌─────────▼──────────────┐
│ Pod：长期项目团队     │              │ Swarm：wave 内弹性并行   │
│ 3–7 人，持久          │              │ N 个短生命周期 worker    │
│ Lead + 专家 + Verifier│              │ 分区输入 + context shard │
│ 共享 task board/记忆  │              │ 输出 schema + 聚合       │
│ 直接消息 + 共享工件   │              │ 不写全局记忆             │
└───────┬──────────────┘              └─────────┬──────────────┘
        │                                       │
        └───────────────┬───────────────────────┘
                        │
              ┌─────────▼─────────┐
              │ 共享工件 / 证据链  │
              │ 文件、测试、设计文档 │
              │ 任务板、review 记录 │
              └───────────────────┘
```

**Tower（已有，保留）**
- Goal 状态机、waves、plan approval、budget、review、evidence。
- 不把 goal 编排替换成 swarm；塔负责“做不做、做到什么程度、谁验收”。

**Pod（建议新增）**
- 每项目/每 goal 一个持久团队：Lead（Manager 或专门 Team Lead）+ 2–5 个专家 + 1 个 Verifier。
- 共享 `TEAM_MEMORY.md`（只读给成员，Lead 写）；共享 task board；mailbox；artifact 目录。
- 适用：长期项目、跨会话迭代、复杂代码库、需要“记住上次怎么做的”工作。
- 规模：3–7；不要超过 10。

**Swarm（建议新增为 wave 执行模式）**
- `wave.executionMode: single | fanout | pod`。
- `fanout`：同一模板 + 分区输入 → N 个 worker → 聚合；适合批量研究/评审/文档。
- `pod`：Lead + Worker + Verifier 的小团队；适合复杂 wave。
- 每个 worker 有独立 context shard、输出 schema、预算；只回结论/工件引用。
- 默认 3–5 个；上限可配；不要默认 100+。

**Verification（贯穿）**
- Pod 级 Verifier 独立于 Worker；goal 级 review 保留。
- 确定性测试/证据优先；Verifier 不能只看 Worker 的自述。
- 高风险动作（合并、覆盖、发布）必须人工门。

**Memory**
- Pod：`TEAM_MEMORY.md` + OKF；Lead 写，成员读。
- Swarm：不写全局记忆；只回结论/工件；由 Lead 决定是否沉淀。
- 沿用现有规则：子代理不调用 `mafw_add_memory`。

**Safety**
- max agents / max tokens / max cost / max wall time；
- 文件所有权 + worktree + merge queue；
- 权限最小化；teammate 不能代替用户批准；
- kill switch + 可恢复状态。

### 7.4 分阶段落地

| 阶段 | 内容 | 风险 | 验收 |
|---|---|---|---|
| **Phase 0** | 多 Agent 评估基线：同一批任务跑单 Agent / Tower / Tower+Fanout / Tower+Pod；记录 pass rate、时间、token、成本、冲突、人工介入 | 低 | 有数据证明哪种拓扑适合哪类任务 |
| **Phase 1** | Wave fan-out：只读/研究/评审类任务，复用 `mafw_spawn_subagent`，3–5 worker，输出 schema + 聚合 | 低 | 比单 Agent 快/好，成本可接受 |
| **Phase 2** | Pod：Lead + Worker + Verifier；共享 task board、TEAM_MEMORY、mailbox；3–7 人 | 中 | 长期项目复用、冲突率、恢复率 |
| **Phase 3** | 动态 swarm：按预算/任务动态扩缩；上限 10–20，不追求 300 | 高 | 只有 Phase 1/2 指标证明才做 |

**不建议**：一上来做 100+ agent、纯 P2P、无 verifier、无预算的 swarm。这是 demo 形态，不是生产形态。

### 7.5 评估指标

- **效果**：pass rate / verdict / 人工评分 / 引用准确率 / 测试通过率。
- **效率**：wall time / time-to-first-useful-result / token / cost。
- **协作**：冲突率 / 重试率 / 任务状态滞后 / 人工介入次数 / 恢复成功率。
- **质量**：Verifier 捕获率 / 返工率 / 回归率。
- **经济**：每成功任务成本 / 每 token 产出 / planner:worker 成本比。
- **规模**：agent 数 vs 收益曲线（找拐点）。

A/B 设计：同一任务、同一模型、同一工具、同一预算，只换拓扑；至少 20–50 个任务，按任务类型分层（研究、代码评审、多文件重构、批量文档、调试）。

### 7.6 风险

- **状态机复杂度**：Pod/Swarm 会引入更多状态和事件；不要污染现有 goal 状态机，最好作为 wave 内部执行器。
- **子代理能力缺口**：现有 subagent 是父→子 prompt + result，没有多轮 peer messaging；Pod 需要 mailbox/task board。
- **成本失控**：必须有硬预算和 kill switch。
- **记忆污染**：Worker 不写全局记忆；团队记忆由 Lead 收口。
- **UI 复杂度**：SubagentDock 需要升级为 Pod 视图（roster/task board/messages/cost）。
- **安全**：多 agent 的权限边界、prompt injection、工具滥用。
- **过度工程**：如果 3 个 agent 能解决，不要上 10 个。

---

## 8. 开放问题

1. 你说的“塔 / 鲸群”是**组织隐喻**，还是某个具体产品/框架的名字？
2. 这次调研是为了**MAFW 功能设计**，还是纯行业扫盲？
3. 主要任务类型：代码（多文件/重构/评审）还是研究/知识工作？
4. 目标规模：3–5 人小团队，还是 100+ 大规模并行？
5. 成本容忍度：愿意为速度/广度付 4×–15× token 吗？
6. 时间线：先做评估基线，还是直接做 Pod/Fanout？

---

## 9. 来源

- Kimi Agent Swarm 帮助中心：https://www.kimi.com/zh-cn/help/agent/agent-swarm
- Kimi 官方 blog “Kimi Introduces Agent Swarm”：https://www.kimi.com/blog/agent-swarm
- Kimi K2.6 / K3 相关 blog：https://www.kimi.com/blog/kimi-k2-6
- Claude Code Agent Teams 文档：https://code.claude.com/docs/en/agent-teams
- Anthropic “How we built our multi-agent research system”：https://www.anthropic.com/engineering/multi-agent-research-system
- LangChain “Benchmarking Multi-Agent Architectures”：https://blog.langchain.com/benchmarking-multi-agent-architectures/
- arXiv:2512.08296 “Towards a Science of Scaling Agent Systems”：https://arxiv.org/abs/2512.08296
- Cognition “Don’t Build Multi-Agents”：https://cognition.ai/blog/dont-build-multi-agents
- MiniMax Agent Team blog：https://www.minimax.io/blog/minimax-agent-team-long-running-1779893953
- Cursor “Agent swarms and the new model economics”：https://cursor.com/blog/agent-swarm-model-economics
- OpenAI Agents SDK orchestration：https://openai.github.io/openai-agents-python/multi_agent/
- AutoGen Teams：https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html
- Team Topologies key concepts：https://teamtopologies.com/key-concepts
- 知乎《Multi-agent 的新趋势，从 Agent Team 到 Agent Swarm》：https://zhuanlan.zhihu.com/p/2069524382196691517

> 注：公开资料中“塔 / 鲸群”没有统一术语；本文的三种原型是分析框架，不是业界标准分类。若你有具体出处，我可以按原文校准。
