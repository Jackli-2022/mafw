# 业界 Agent Loop 编排调研：Codex / Claude Code / DeepAgents / LangGraph（2026-10-08）

> 目的：为 MAFW goal/loop 编排的正式启用与 agent 自治化提供业界参照。
> 姊妹篇：本仓库现状调研 `2026-10-08-goal-loop-enablement-survey.md`（六个断点清单）。
> 来源：codex-rs/docs/protocol_v1.md、openai.com codex 发布博客、code.claude.com docs（agent-loop/goal/checkpointing/permission-modes/hooks/sub-agents）、claude.com dynamic-workflows 博客、blog.langchain.com/deep-agents、docs.langchain.com/oss/python/langgraph（checkpointers/interrupts）、anthropic.com/engineering/building-effective-agents、openai.github.io/openai-agents-python（handoffs/guardrails）。置信度：均为官方一手资料。

## 1. OpenAI Codex

- **协议三层**：SQ/EQ 队列 + Session/Task/Turn 三层模型（`codex-rs/docs/protocol_v1.md`）。**Turn 无输出即终止**——loop 的最小粒度是 turn，终止条件就是"这一轮什么都没产出"
- **恢复 = response_id 书签**：不靠完整状态机 checkpoint，靠 response id 书签续接对话历史
- **自治度 = approval_policy × sandbox 二维矩阵**：审批强度与沙箱隔离是两个正交旋钮，不是单一开关
- **审查 = 独立 Guardian agent**：审批/审查是独立 agent 而非主循环内省
- **plan/review 是"模式"而非固定阶段**：不是状态机的必经节点
- cloud task 跑完才交人审（异步任务语义）

## 2. Claude Code / Claude Agent SDK

- **模型自主循环**：没有预定义 phase 状态机，主循环就是 LLM 自主工具循环
- **plan 是只读权限模式**，不是一个阶段——阶段差异用权限梯度表达
- **`/goal` 机制（最值得直接借鉴）**：session 级 **Stop hook** + **独立小模型 evaluator**，产出三值 verdict `met / not-yet / impossible`；带无进展检测与错误分类恢复。loop 续跑由回合末钩子驱动，不靠外部调度器
- **dynamic workflows**：`agent() / parallel() / pipeline()` 现场生成编排，编排不是静态图而是代码
- **adversarial verification**：对抗式验证作为质量门
- **checkpoint 按 prompt 粒度快照文件**

## 3. Deep Agents（LangChain）

- **核心论断**：朴素 agent（LLM 循环调工具）是 shallow 的；deep agent 算法相同，差异在四支柱。**loop 驱动 = 纯 LLM 自主循环，不是图状态机**
- 四支柱：
  1. **Planning tool（write_todos）= no-op 工具**——"this doesn't do anything"，价值在把计划锚定进上下文防跑偏
  2. **Subagents**——`task` 工具隔离上下文窗口
  3. **文件系统**——长任务草稿纸 + subagent 共享工作区 + 大输出 offload
  4. **详细 system prompt**——"Prompting matters still!"
- 三层栈：LangGraph（图运行时）→ `create_agent`（最小 harness）→ Deep Agents（opinionated harness）。**选型共识：agent loop 形状够用就别上图，只在 loop 形状本身需要定制时才降到 LangGraph**

## 4. LangGraph loop 原语（checkpoint/interrupt 正确语义）

- **两层存储**：checkpoints（super-step 快照：channel_values/versions/versions_seen + parent 指针）+ **writes（节点级增量）**。`put_writes` 是 no-op → 崩溃恢复粒度退化为整 super-step 重跑
- **interrupt/resume 协议**：`interrupt()` 抛异常挂起 → `Command(resume=v)` 同 thread_id 重入 → **节点从头重跑**（不是从 interrupt 行继续）→ 副作用必须在 interrupt 之后或幂等；多 interrupt 按索引匹配；禁止节点内 while 循环 interrupt（校验重试走 conditional edge）
- **durability 三档**：exit / async / sync
- 教训：`get_tuple` 按 id 精确查找坏了会**静默**把状态重建成空——恢复必须做存在性断言，坏即报错

## 5. Anthropic「Building Effective Agents」+ OpenAI Agents SDK

- **Workflows vs Agents**：预定义代码路径 vs LLM 动态指挥。找最简单方案，只在复杂度有 demonstrable 收益时加
- **Evaluator-optimizer**：生成-评估成环，仅在评估标准明确且迭代有可度量改进时有效
- **必须有停止条件且是一等公民**（AutoGen 显式 TerminationCondition 同理）
- **OpenAI guardrail 三区位置**（回答"验证者挂哪里"）：input（首个 agent 前）/ output（最终输出后）/ tool（每次工具调用前后）；**blocking 模式**先跑完 guardrail 再放行，防昂贵副作用已发生；**拒绝时状态卫生**：被拒产物不进 session，已完成工具调用对保留可重放

## 6. 对 MAFW goal 编排的借鉴点（对照现状六断点）

1. **putWrites 必须真实现**（或显式放弃图内恢复改 state 文件驱动）。对 MAFW 更尖锐：execute 节点内是一次长会话——wave 完成记录应作为 pending write 持久化，恢复不重跑已完成 wave
2. **节点边界设在副作用边界上**：plan 节点发 promptAsync 是可重复副作用，入口须幂等短路（"本 step 已有 durable write 则跳过"）
3. **askUser 照抄 Command(resume=) 契约**：MAFW 的 id 化问题文件（`.mafw/user-questions/{id}.json`）天然契合，缺的是接回图恢复语义
4. **图做骨架、LLM loop 做肉，别颠倒**：图只管 phase 转移/门控/durable execution；execute 节点内的 opencode 会话本来就是自主循环，是对的——不要把 wave 内每步建模成图节点
5. **plan 用"上下文锚"就够**（write_todos 是 no-op 也有效）：MAFW 已有 state.json + charter 指针模式（决策本体在记忆，state 只存索引），保持，别升级成图节点化 plan
6. **review = 独立 evaluator + 结构化 verdict + blocking 语义**（Claude /goal 三值 met/not-yet/impossible 直接可抄）；补拒绝时状态卫生（失败 loop 证据保留但 verdict 标 FAIL）
7. **loop 续跑用回合末钩子驱动**（Claude Stop hook 模式）而非外部轮询/调度器——天然契合 MAFW 事件流（session.idle + 产物校验）
8. **停止条件一等公民 + 恢复语义显式**：loop 计数进 durable state（重启 ≠ 预算重置漏洞）；恢复时对 state 做存在性/版本断言，坏即报错而非静默从零开始；自治度用**权限梯度表阶段**（Claude 模式）而非全局开关

## 7. 综合判断

业界两个极端：**Claude/Codex 是"模型自主循环 + 权限/钩子约束"**（图最薄），**LangGraph 是"图状态机 + durable execution"**（图最厚），Deep Agents 明确说"够用就别上图"。MAFW 的 goal 编排想同时拿到两边的好处：**phase 门控与人在回路走图（薄骨架），phase 内部走自主会话（厚肉）**——与业界收敛方向一致。启用时的关键取舍是断点④（FileCheckpointer）：要么补齐 langgraph writes 层，要么诚实改为"state 文件 + 事件驱动重入"（后者更贴近 Claude Stop hook 模式，工作量更小，且 MAFW 的实际状态真相源本来就在 state 文件）。
