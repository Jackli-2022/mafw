# MAFW Pod vs Codex / Kimi / Grok（2026-10）

- 日期：2026-10-31
- 触发：用户要求「梳理一下，和业界 codex、kimi、grok 等对比」
- 前置：`2026-10-31-pod-vs-industry.md`（k8s / CrewAI / Claude Teams）

## 0. 一句话结论

三家都在做**「并行 + 隔离 + 共享约定」**，靠模型或人临场编排；MAFW Pod 做的是**「固定三人 + 确定性流水线 + 结构化验收」**。我们赢在可复现与可审计，输在并发规模与编排弹性。

## 1. 三家 2026 的实际形态

### OpenAI Codex（命令中心 + worktree 并行）

来源：openai.com/codex、Codex app 指南、Codex CLI subagents GA 说明（2026-07）

- **并行单位 = 任务 × worktree**：每个 agent 一个 git worktree，互不覆盖；CLI 侧 subagents 已 GA，可 20+ 并行，**每子代理可单独 resume**
- **共享约定 = AGENTS.md + Skills**：「所有 agent 遵守同一套规则」——文档即团队规范
- **任务式 prompt**（自包含任务，而非连续 chat）；官方/社区推荐模式之一就是「**一个实现线程 + 一个只读 review 线程**」
- 审批：ML + 人工；PostToolUse hooks 可跑任意代码；有 Automations（定时工作流）
- 没有固定角色、没有权威任务板、没有跨 agent 共享记忆（除了仓库里的 md）

### Moonshot Kimi（Agent Swarm：涌现式编排）

来源：Kimi K2.6 技术博客、Kimi 帮助中心 Agent Swarm、第三方评测（2026-04 起；K3 Swarm 延续）

- **K2.6：最多 300 个子代理、单任务 4000 步、比顺序执行快 4.5×**
- 关键词是 **"without predefined roles or manually designed workflows"**：不做角色，不做人工画的流程，由模型（PARL 训练）动态拆解与匹配
- 模型原生多模态（MoonViT）、256K 上下文；Kimi Code CLI / IDE 扩展
- CLI 侧 swarm 以「让你在 prompt 里要求开 subagents」的方式暴露，不是一等公民的编排面板

### xAI Grok（Grok Build：并行探索 + 接管）

来源：x.ai/news/grok-build-cli、xAI multi-agent API 文档、社区试用（2026）

- **Grok Build（CLI，beta）**：并行 subagents、**深 worktree 集成**（子代理各自 worktree）、`-p` headless、**ACP** 支持；TUI 里每个 agent 一栏，`Click: take over` 可直接接管
- **Grok 4.20 multi-agent（API）**：leader agent 编排，**只有 leader 的工具调用与最终回复返回给用户**，子代理中间状态默认加密不外露（`use_encrypted_content` 才带）
- grok-code-fast-1 是专用编码模型，可接任意 OpenAI 兼容编排

## 2. 对比表

| 维度 | Codex | Kimi Swarm | Grok Build | **MAFW Pod** |
|---|---|---|---|---|
| 组织形态 | 任务并行，无固定角色 | **无角色，模型动态拆** | 并行 subagent，无固定角色 | **固定 Lead/Builder/Reviewer** |
| 编排者 | 人 + CLI/app | **模型（PARL）** | leader agent / 人 | **确定性状态机（NodeDriver）** |
| 并发单位 | 任务 × worktree（20+） | 子代理（≤300） | 子代理 × worktree（≤8/session） | **一次一个 goal，wave 内串行** |
| 完成判定 | 人 review / 测试 | 模型自评 | 人 review / 测试 | **产物文件双门 + 逐任务 rubric** |
| 共享约定 | AGENTS.md / Skills | 上下文 + 子代理 profile | ACP / 项目规则 | **Pod 文件 + 谐波记忆 + `[POD HANDOFF]`** |
| 隔离 | git worktree | 子代理上下文隔离 | git worktree | **每个节点一个 runtime 会话** |
| 人机接口 | CLI + app 命令中心 | Web / Kimi Code | TUI（可接管每栏） | **左栏名册 + chatview + 右栏邮箱** |
| 可审计 | 中等（diff + hooks） | 低（swarm 黑箱） | 中（leader 汇总，子代理默认隐藏） | **高（goal_node_runs + 时间线 + 消息日志）** |
| 失败处理 | 人重启/重派 | 模型内部重试 | 人接管 | **attempt+1 + watchdog + artifact 门** |

## 3. 我们已经搭好的七层（本次会话产出的 Pod 栈）

1. **编队**：项目级固定三人 + 身份物化（`IdentityRegistry`），成员状态可读（`available/working/sleeping/retired`）
2. **编排**：`NodeDriver` plan→execute→review→archive，产物双门 + attempt 重试 + watchdog
3. **任务**：waves 投影 → `pod_tasks`；回执 → `review`；**rubric 逐任务收口**（本次新增）
4. **通信**：`pod_messages` 协调日志 + A2A handoff；push/pull 两种投递；**sleeping/retired 不强制 push**（本次新增）
5. **记忆**：Pod 文件（POD/MEMORY/GLOSSARY）+ 谐波记忆（跨项目）
6. **人机面**：左栏名册（待办优先、最近 5 条）/ chatview（可「记入鲸群」）/ 右栏邮箱（发送 + 立即提醒）
7. **审计**：`goal_node_runs`、时间线、投递/已读状态、review rubric

## 4. 三个关键差异与取舍

### 4.1 我们最硬的差异：**可复现的验收**

三家都靠「人看 diff / 模型自评」。Codex 的「一个实现 + 一个 review 线程」是**流程建议**，不产出结构化验收；Kimi 更是把判定交给模型；Grok 让你接管看。

我们这次把 review 变成 `{taskId,result,evidence}` 的强校验 + 产物门：**"够不够好"不再由 LLM 一句话决定**。代价是契约更死、模型要用更多 token 写证据——这正是我们想要的方向（可审计优先）。

### 4.2 我们最大的缺口：**并发与隔离**

Codex/Grok 的洞察是「**任务 × worktree**」——并行不是多开 agent，而是**每个 agent 一个隔离副本**。我们目前：
- 一个活跃 goal，wave 内串行执行
- Builder 只在项目主目录干活（worktree 是**会话级**能力，Pod 没用到）

后果：长任务吞吐低，且 Builder 与人的编辑会互相踩。

### 4.3 我们的取舍：**不做模型原生编排**

Kimi 的 300 agent swarm 与 Grok 的 leader agent 都把"团队长什么样"交给模型。我们固定三人 + 状态机，换来：
- 可预测的成本与轮次（goal 有 maxRounds/cost 预算）
- 可审计的每个节点（谁在什么时候用什么会话做了什么）
- 代价：**领域 specialists（安全/性能/文档）无处安放**——只能复用 Reviewer 一个身份。

## 5. 值得做的两步（按收益/成本）

1. **wave 并行 = 多 Builder × worktree**（借 Codex/Grok）：`waves.json` 里同一 wave 的独立任务可 fan-out 到 N 个并发 Builder 会话，各自 worktree，回执汇总再进 review。我们已有 `worktreeApi` 与 `SessionWorktreeManager`，缺的是 Pod 侧 fan-out 编排 + 合并策略（diff 冲突归 Lead）。
2. **Reviewer 的"证据"落到 UI**：rubric 已产出 `evidence`，但目前只有 gateway 数据——桌面 Goal 时间线还没显示逐任务 pass/fail（本批 deferred）。做完人就能一眼看出"哪个任务没过、凭什么"。

不建议跟的：动态造 300 个子代理（成本不可控、审计困难）、把编排交给模型（与我们的确定性定位冲突）。

## 6. 来源
- Codex: openai.com/codex；Codex app/CLI 指南（2026）；Codex CLI subagents GA 说明（2026-07）
- Kimi: kimi.ai/blog/kimi-k2-6；kimi.com/en/help/agent/agent-swarm（2026-04-20）
- Grok: x.ai/news/grok-build-cli；docs.x.ai multi-agent（grok-4.20-multi-agent）
- 对照：`docs/research/2026-10-31-pod-vs-industry.md`

## 7. 附加：与 Claude Code Agent Teams 的对比（2026-10）

来源：`code.claude.com/docs/en/agent-teams`、alexop.dev / getclaudeskills / brandonwie / contextstudios 实测（2026-02 起，Opus 4.6 时代）

### 7.1 他们的一等公民

| 构件 | 说明 |
|---|---|
| Team Lead | 创建队伍、派活、审计划、汇总结果的主会话 |
| Teammates | 各自独立的 Claude 实例（**独立 1M 上下文**），默认 3–5 个最实用 |
| Shared task list | 任务有 `pending / in progress / completed` + **依赖追踪与自动解锁**（Ctrl+T 可看） |
| Mailbox | 点对点 + 广播；`SendMessage` 支持 `message` / `broadcast` / `shutdown_request` / `shutdown_response` / `plan_approval_response` |
| 人机 | in-process：面板选中 teammate → Enter → **直接对那个 teammate 说话**；或 tmux 分栏逐窗操作 |

### 7.2 硬限制（官方 Limitations）

- **队伍只存在于一个会话内**：会话结束即散，**不能跨会话 resume**；in-process teammate 中断后无法恢复
- **一个会话只能有一个队**，且**不能嵌套**（teammate 不能再拉 teammate）
- 权限在 spawn 时固定（继承 lead 的模式，之后可改）
- 每个 teammate 独立上下文 → token 成本线性增长；同文件并发编辑不安全

### 7.3 与 MAFW Pod 的对照

| 维度 | Claude Teams | **MAFW Pod** |
|---|---|---|
| 生命周期 | **会话内**，结束即散 | **项目级持久**（身份物化 + goal 队列 + 记忆文件） |
| 角色 | lead 用自然语言现定，无持久身份 | **固定 Lead/Builder/Reviewer**，身份可复用 |
| 任务板 | 共享列表 + 依赖 + 自动解锁 | `pod_tasks`（waves 投影 + 回执 + **rubric 逐任务收口**） |
| 验收 | **无结构化验收**（人看 / lead 判断） | **产物门 + `{taskId,result,evidence}` 强校验** |
| 计划门 | spawn 时要求 plan approval（`plan_approval_response`） | W1 `AWAIT_PLAN_APPROVAL` + 人工批准/驳回（带批注） |
| 消息 | mailbox（DM/broadcast）注入 `<teammate-message>` | `pod_messages` + A2A，注入 `[POD HANDOFF]`：**结构最像** |
| 已读 | markRead 时回 receipt | 只有 `deliveredAt`，**没有 agent 已读回执**（本次裁决不做） |
| 隔离 | 独立上下文，但**同目录**（同文件并发不安全） | 每节点独立 runtime 会话，**同目录** |
| 人机 | TUI 面板选中即对话 / tmux 分栏 | 桌面：左栏名册 + chatview 直聊 + 右栏邮箱 |

### 7.4 结论

**Claude Teams 是和我们最像的一家**：lead + 共享任务列表 + mailbox 三件套几乎一一对应。差别集中在四处，且方向不同：

1. **我们更持久**：他们是会话内的临时编队，我们是项目级常驻（可跨天、跨模型更替）。
2. **我们更硬**：验收从「人/lead 判断」变成产物门 + 逐任务 rubric——这也正是他们最被诟病的"teammate 提前宣称完成"。
3. **他们更灵活**：角色用自然语言现配（"一个架构师、一个测试"），我们固定三人，specialist 无处安放。
4. **他们都缺 worktree 并发隔离**：Codex/Grok 才解决了「多 agent 同改一个仓库」；我们和 Claude 都还在"同目录、靠任务切分避免冲突"。

值得学的：**`plan_approval_response` 这种"消息即审批"的形态**（我们目前是 HTTP 路由 + 桌面浮层，agent 侧无法发起批准请求）；以及**依赖追踪 + 自动解锁**（我们的 waves 只有顺序，任务间显式依赖还没进 `pod_tasks`）。

## 8. 附加：与 CrewAI 的对比（2026-10，v1.15.x）

来源：docs.crewai.com（concepts/crews、concepts/tasks）、CrewAI GitHub、Flows 实践文（2026-10 校验过 1.15.27）

### 8.1 CrewAI 是两层，不是一层

| 层 | 职责 | 关键件 |
|---|---|---|
| **Crew**（自主） | 角色型 agent 协作 | `Agent(role, goal, backstory, tools, memory)` + `Task(description, expected_output, agent, guardrails, output_pydantic/output_json, context/依赖)` + `Process.sequential \| hierarchical` |
| **Flow**（控制） | 事件驱动编排 | `@start` / `@listen` / `@router` + Pydantic 类型化 state + 持久化/分支/重试 |

官方定位一句话：**"Crews supply the intelligence. Flows supply the control flow."**
`hierarchical` 必须给 `manager_llm` 或 `manager_agent`；manager 负责委派 + **按 `expected_output` 校验结果**（可打回重做）。

### 8.2 与 MAFW Pod 的对照

| 维度 | CrewAI | **MAFW Pod** |
|---|---|---|
| 分层 | **Crew（自主）+ Flow（控制）两层** | **一层**：状态机（确定性）+ LLM 节点 |
| 谁决定谁干什么 | 人显式指派，或 hierarchical 的 manager 动态决定 | **代码路由**（plan→execute→review），agent 不决定拓扑 |
| 任务契约 | `description` + `expected_output`（给 manager 的评分标准）+ 可选 `guardrails`（**代码级**校验/变换） | waves 任务（字符串）+ 回执 + **review rubric（逐任务 pass/fail + evidence，强校验）** |
| 结构化产出 | `output_pydantic` / `output_json` | 节点 `outputSchema`（JSON Schema）+ 文件产物双门 |
| 验收者 | manager agent（LLM）或 guardrail 代码 | **确定性校验器**（rubric 覆盖度 + 一致性 + 产物存在） |
| 记忆 | crew `memory=True`：短期（RAG）/长期（SQLite）/实体记忆 | Pod 文件（POD/MEMORY/GLOSSARY）+ 谐波记忆（检索式，跨项目） |
| 持久化 | 需要 Flow + Pydantic state 才有；Crew 本身一次性 `kickoff()` | **项目级持久**：state 文件 + gateway.db + goal 队列 |
| 人机 | Python 代码 + Enterprise/Studio 可视化 + 部署平台 | 桌面三栏（左名册 / chatview / 右邮箱）+ A2A |
| 循环上限 | `max_iter` | `maxRounds` + `attempt` + watchdog |

### 8.3 结论：我们更像「Flow + 固定角色」，不像「Crew」

- CrewAI 的 **Crew** 核心是"让 LLM 决定协作"，我们用**状态机代替 manager**——这与上一份调研里"用确定性替代 LLM 自由裁量"的取舍一致。
- 但 CrewAI 有一点比我们细：**`guardrails` 是任务级的可执行校验**（在任务产出交给下一个任务之前就跑代码验证并给出反馈），我们只在 **review 节点**做一次全量校验。这意味着 execute 阶段的坏回执会一路带到 review 才被打回，浪费一整轮。
- 另一点是 **`output_pydantic`**：他们的任务产出直接是类型化对象；我们的回执是自由 JSON（只校验 `taskId/status` 存在）。

### 8.4 值得借的两件事

1. **任务级 guardrail（execute 侧）**：wave 任务加可选 `verify`（shell 命令或断言），execute 写回执时 gateway 先跑它——失败直接标 `failed`，不必等 review。成本：waves schema 加字段 + 一个受限执行器（复用现有 shell 能力，需白名单/超时）。
2. **回执类型化**：把 `receipts[]` 收成严格 schema（`status` 枚举 + `summary` 必填 + `files` 存在性），像 `output_pydantic` 那样在写盘前拒绝畸形回执。

不借：`hierarchical` 的 LLM manager（与我们的确定性定位冲突，且 CrewAI 社区长期抱怨 manager 委派不稳）、crew 一次性 `kickoff()` 的生命周期（我们要项目级常驻）。

## 9. 总表：MAFW Pod 的优势与劣势（对 Codex / Kimi / Grok / Claude / CrewAI）

> 汇总自本文 §1–§8 与 `2026-10-31-pod-vs-industry.md`。判断标准是"用户实际得到什么"，不是功能清单长度。

### 9.1 优势（按可辩护程度排序）

| # | 优势 | 具体是什么 | 谁没有 |
|---|---|---|---|
| 1 | **确定性验收** | 产物文件双门 + `{taskId,result,evidence}` rubric 强校验；"够不够好"不由 LLM 一句话决定 | Codex/Grok 靠人看 diff；Kimi 模型自评；CrewAI 靠 manager（LLM）；Claude 靠 lead/人 |
| 2 | **项目级持久** | 身份物化 + goal 队列 + Pod 记忆，跨会话/跨天/跨模型更替 | Claude Teams 只活一个会话、不可 resume；CrewAI 一次性 kickoff；Codex/Kimi/Grok 是任务/会话级 |
| 3 | **可审计** | `goal_node_runs` 每次 attempt 一行 + 时间线 + 消息日志 + 投递状态 | Kimi swarm 近乎黑箱；Grok 子代理中间状态默认隐藏；Codex 只有 diff |
| 4 | **硬边界** | `maxRounds=3` / 节点 attempt=2 / `sameSigCount` 提问 / BudgetGuard / PipelineBudget | 大多靠"模型自觉"或人工盯；Kimi 300 agent 成本不可控 |
| 5 | **人机面成型** | 左栏名册（待办优先）+ chatview 直聊 + 右栏邮箱（贴条/立即提醒）+ 「记入鲸群」显式提升 | Codex/Grok 是 TUI/CLI；Kimi 是 Web；Claude 是 TUI 分栏——桌面三栏是我们的形态差异 |
| 6 | **协议标准化** | A2A `message/send` / AgentCard / artifact，外部 agent 可接入 | 多数家用私有消息格式（CrewAI 委派工具、Claude inbox JSON） |

### 9.2 劣势（按影响排序）

| # | 劣势 | 现状 | 对手怎么做 |
|---|---|---|---|
| 1 | **没有并行与隔离** | 单活跃 goal，wave 内串行，Builder 在主目录干活 | Codex 20+ 并行（worktree）；Grok ≤8/session（worktree）；Kimi 300 子代理 |
| 2 | **固定三人，无 specialist** | 安全/性能/文档只能复用 Reviewer | Claude 用自然语言现配角色；CrewAI 任意 agent 列表 |
| 3 | **成员上下文用完即弃** | Builder/Reviewer 每节点新建，交接靠文件与 `[POD HANDOFF]` | Claude 每 teammate 独立 1M 上下文且会话内连续 |
| 4 | **任务图太弱** | waves 只有顺序，无依赖/自动解锁 | CrewAI 任务依赖 + 自动解锁；Claude 共享任务列表同理 |
| 5 | **生态与集成薄** | 无 skill 市场、无 headless/CI SDK、无云端沙箱 | Codex Skills+Automations；Grok ACP+`-p`；CrewAI Enterprise/Flow 部署 |
| 6 | **单机单进程** | 依赖本地 gateway + serve；并发受本机资源限 | Codex/Kimi 有云端沙箱与弹性 |

### 9.3 一句话

我们的优势集中在 **"可复现、可审计、有边界"**，劣势集中在 **"并行、弹性、生态"**。前者是我们主动选的（用确定性换自主性），后者多数还没做（不是设计冲突）。

最高 ROI 的两步：**① wave fan-out 到多 Builder × worktree**（补最大劣势，且我们已有 worktreeApi）、**② rubric evidence 上桌面**（把已有优势变成用户可感知）。
