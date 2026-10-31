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
