# 业界 Agent Loop / Graph 对 MAFW Pod v3 的参考（调研中）

- 日期：2026-11-02
- 状态：调研完成（Codex / Claude / Deep Agents/LangGraph 官方资料与源码对照）
- 目的：定稿 `docs/superpowers/specs/2026-11-02-pod-v3-goal-attention-design.md` 前，核对业界 loop、graph、失败/恢复与人工介入模式。
- 子代理模型：`opencode-go/deepseek-v4.1-flash`

## 问题框架

1. Agentic loop 与 Goal loop 是否是两层，终止条件分别是什么；
2. 规划、执行、评审是图节点、middleware、hook 还是模型自由委派；
3. Review FAIL、技术失败、重试耗尽、max turns/rounds 如何分类；
4. 人工门如何驻留与恢复，输入是否有 id/schema；
5. checkpoint 在哪一级，重跑是否幂等，部分副作用如何保留；
6. 哪些机制能强化 MAFW 现有 NodeDriver，而不是推翻它。

## Deep Agents / LangGraph（已完成）

### 核心结论

- Deep Agents 是固定「模型⇄工具」循环 + middleware 栈，不是确定性多节点图；真正图控制流在 LangGraph StateGraph。
- MAFW plan→execute→review 对应 LangGraph evaluator-optimizer 模式；rubric、产物门、reviewFix 不是 Deep Agents 内置能力。
- 最值得借：
  1. **失败三通道**：retry policy（环境异常）/ error handler（补偿改道）/ 条件边（业务路由）；
  2. **checkpoint 粒度与幂等**：恢复会整个 node 重跑，节点副作用必须幂等；
  3. **显式 interrupt/resume**：恢复输入带 id 与 schema，重复/跨轮/过期应拒绝；
  4. **控制面独立于对话历史**：async task id 放独立 state channel，避免 compaction 丢失；
  5. **attempt 注入 prompt**：让节点知道第几次尝试与上次失败原因，避免复读。

### 反模式

- 不把 recursion_limit 当回合预算（它数 super-step）；
- 不把模型自填 todo 当验收计划；
- 不让 Stop hook 成为唯一完成判据；
- 不在恢复时假设节点内部副作用不会重放。

官方来源：

- <https://docs.langchain.com/oss/python/deepagents/overview>
- <https://docs.langchain.com/oss/python/langgraph/graph-api>
- <https://docs.langchain.com/oss/python/langgraph/persistence>
- <https://docs.langchain.com/oss/python/langgraph/interrupts>
- <https://docs.langchain.com/oss/python/langgraph/fault-tolerance>
- <https://docs.langchain.com/oss/python/langgraph/workflows-agents>

## Claude Code / Agent SDK（已完成）

### 核心结论

- 基础 agentic loop 在模型不再调用工具时结束；Goal/质量的可靠边界仍在 host：maxTurns、budget、权限、schema、TaskCompleted/TeammateIdle gate、workflow return。
- `/goal` 是最接近的公开 Goal loop：外部 evaluator 不用工具，只能依据对话中已出现的证据；具备 not-yet/met/impossible、反 spin、重试/暂停分类。
- Stop hook 有连续 block cap、re-entry flag，且在 maxTurns 边界可能不执行，不能作为唯一记账点。
- 动态 workflow 把「下一步」放进代码和变量，replay 时已完成步骤取缓存，差异步骤及后续重跑。
- 恢复语义必须诚实：中断工具/后台任务不一定恢复；文件部分副作用可能保留；resume 后计数/预算 baseline 要明确。

### 对 MAFW 的直接启示

1. 保留产物优先和 host 完成门；
2. review 增加「不可能/受阻」语义，避免只能 FAIL→无限重规划；
3. Reviewer 应 fresh-context、只读、结构化 verdict，报告没有审批权威；
4. 权限与质量判定分离，agent 消息不能当用户批准；
5. resume 按产物重放并声明重跑/预算基线，不假装进程状态完整回来。

官方来源：

- <https://code.claude.com/docs/en/agent-sdk/agent-loop>
- <https://code.claude.com/docs/en/goal>
- <https://code.claude.com/docs/en/hooks>
- <https://code.claude.com/docs/en/agent-sdk/permissions>
- <https://code.claude.com/docs/en/workflows>
- <https://code.claude.com/docs/en/checkpointing>

## Codex（已完成）

### 核心结论

- Codex CLI、Cloud、Agents SDK 是三种不同控制面；不能把 SDK `max_turns=10` 当 Codex CLI 语义。
- CLI turn 由 host 驱动：模型→工具→模型，直到无 tool call 且无 pending input；用户 steer 可抢占当前 sampling，mailbox 优先级不同。
- 最接近 Pod 的是 **goal extension**：持久 objective/status/token budget，host 在 idle 时发起 continuation turn；模型只能请求 complete/blocked/paused，resume 与限制状态由 host/user 控制。
- host 用计数器强制边界：连续空进展/连续失败可 blocked；token budget 耗尽进入 budget_limited 并要求收尾。
- `/review` 是独立 one-shot session，结构化 findings，但不自动回 execute；parse 失败会降级，不应被误读为验收通过。
- Plan mode 的非修改约束主要是 prompt 层，提醒我们：能力边界最好由工具/权限强制，不靠角色自觉。
- 恢复/挂起不保证 pending input 能重放；handoff/steer 必须有 delivery state。

### 对 MAFW 的直接启示

1. Goal 状态与 transition actor 应由 host 持久化，模型只请求状态变化；
2. plan 应只读，review 独立、结构化、fail closed；
3. loop 需要预算 + no-progress 计数 + 明确耗尽路径；
4. steer/mailbox 必须区分 queued/delivered/failed；
5. MAFW 的逐任务 rubric 与自动 reviewFix 已强于 Codex one-shot review，但失败分类和状态投影需补齐。

源码快照：`openai/codex@a0981298`（2026-11-01）：

- <https://github.com/openai/codex/blob/a09812981de703f18f38015cd5d500ab373f616c/codex-rs/core/src/session/turn.rs>
- <https://github.com/openai/codex/blob/a09812981de703f18f38015cd5d500ab373f616c/codex-rs/ext/goal/src/runtime.rs>
- <https://github.com/openai/codex/blob/a09812981de703f18f38015cd5d500ab373f616c/codex-rs/ext/goal/src/accounting.rs>
- <https://github.com/openai/codex/blob/a09812981de703f18f38015cd5d500ab373f616c/codex-rs/core/src/tasks/review.rs>
- <https://github.com/openai/codex/blob/a09812981de703f18f38015cd5d500ab373f616c/codex-rs/core/src/session/turn_suspension.rs>

## 跨业界综合判断

### 不需要更换 NodeDriver

四家材料都支持同一个方向：**agentic loop 可以交给模型，Goal loop 的边界必须由 host 持有。** MAFW 的确定性路由、产物双门、逐任务 rubric 与同轮 reviewFix 是有效差异，不需要改成自由 manager 或新图框架。

### v3 应补的六个 loop 机制

1. **失败分类**：review 业务失败、可重试环境失败、重试耗尽技术失败、maxRounds 未达成、用户取消分开；
2. **反 spin**：同反馈、空进展、无产物变化不能永远续跑；达到上限进入明确状态；
3. **attempt 上下文**：重试节点看到第几次尝试和上次原因，避免重复策略；
4. **显式 resume**：计划批准带 approvalId，问题带 questionId，重复/跨轮/过期拒绝；
5. **幂等与产物优先**：恢复默认部分副作用已存在，先读工作区/产物，不能假设节点不会重跑；
6. **独立控制面读模型**：Goal/stage/attention/result 由服务端确定性投影，不能只在消息或桌面事件里隐式存在。

### 保留的 MAFW 优势

- 产物门强于「模型说完成」；
- rubric 强于模型自填 todo 和 review parse 失败降级；
- reviewFix 自动回炉强于 one-shot review；
- BudgetGuard/maxRounds/attempt 已有基础，不需要照搬 recursion_limit；
- goal/task 控制面已有数据库和文件，不需要只存对话历史。

## 已定失败/队列语义（用户确认）

- loop 中间 review FAIL：同轮修复一次，再下一轮，不是终态；
- MAX_RETRIES：多轮自主尝试后未达成，归档真实结果，队列继续；
- ERROR：技术/契约失败，归档真实结果，队列继续，可基于反馈重新提交；
- CANCELLED：用户主动取消，不是失败；
- 终态失败进入最近结果，不永久占 attention badge；需要人回答/批准才形成阻塞 attention；
- archive 不得把 ERROR/MAX_RETRIES 全抹成 FAIL。
