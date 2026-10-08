# 节点执行面跨 Runtime 调研（2026-10-08）

> 目的：为 goal 编排节点（plan/execute/review 等）设计**跨 runtime 的执行模型**。未来接入：opencode（v1 现有 + v2 迁移中）、pi-coding-agent（已有插件）、Claude Agent SDK、Codex SDK、dsh（DeepSeek Harness）。
> 姊妹篇：`2026-10-03-agent-runtime-sdk-survey.md`（SDK 形态与认知面，本篇不重复）；`2026-10-08-goal-loop-enablement-survey.md`（goal 编排现状六断点）；`2026-10-08-industry-agent-loop-survey.md`（业界 loop 模式）。
> 来源：code.claude.com/docs/en/agent-sdk/subagents（官方，高置信）、github.com/openai/codex sdk/typescript README（官方，高置信）、既有仓库调研（pi/opencode 实测）。

## 1. 节点执行面六问 × 各 Runtime

| 能力 | opencode v1（现状） | pi（现状） | Claude Agent SDK | Codex SDK | dsh |
|---|---|---|---|---|---|
| **编程接入形态** | serve sidecar + SDK/HTTP | 进程内嵌（ESM 桥） | 库 spawn 二进制，进程内 hooks 回调 | 库 spawn CLI，stdin/stdout JSONL | Cordis 微内核产品（Web/Desktop） |
| **agent 定义** | `agents.install`（frontmatter markdown，manager/memory-curator 先例） | `agentConfigApi: true`（pi agent 定义） | **程序化 `AgentDefinition`**（query options.agents，一等公民，运行时动态工厂模式官方推荐） | ❌ 无——只有 config 覆盖（model/sandbox/permissions）+ AGENTS.md | 插件即一切（kits） |
| **headless 单次执行** | session.create + promptAsync | AgentSession + prompt | `query()` async 迭代（流式消息） | `thread.run()` / `runStreamed()`（结构化事件） | 产品内使用为主 |
| **权限/审批** | agent frontmatter permissions + 审批三档 | nativeApprovals（MafwApprovalExtension） | `tools`/`disallowedTools` 白名单 + permissionMode + allowedTools | config `default_permissions` / `permissions.audit.*`（TOML 覆盖） | 未查证（developer preview） |
| **会话事件流** | SSE（normalize 四信号） | PiEventStream | query() 消息流（assistant/user/result + `parent_tool_use_id` 区分 subagent） | runStreamed 事件（item.completed / turn.completed + usage） | — |
| **模型选择** | per-prompt `body.model` | per-session provider/model | **per-agent `model` 字段**（alias 或 inherit）+ effort 档 | per-thread config 覆盖 | — |

## 2. 关键新事实（本次补齐）

**Claude Agent SDK（最丰富，直接对齐 MAFW 节点需求）**：
- `AgentDefinition`：description/prompt/**tools 白名单**/**model per agent**/skills/memory/mcpServers/**maxTurns**/background/**permissionMode**/**effort**（reasoning 档）——几乎就是 MAFW 节点执行载体需要的一字段一映射
- **动态工厂模式官方推荐**：query 时按运行时条件构造 AgentDefinition（"security-reviewer" 严格度选模型）——即 MAFW 的编排 agent 动态生成节点定义 = 官方endorsed用法
- **预算帽一等公民**：`maxBudgetUsd`（query 级，含 subagent 花费）+ `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`（默认 3）/`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`（默认 20）——与 MAFW BudgetGuard 同构
- **resume subagent**：session_id + agentId 双键恢复；maxTurns 截断标记 partial
- 注意：**install 语义不同**——Claude 是 per-query 传入 agents 参数，不是注册到常驻 server（与 opencode `agents.install` 差异，见 §3）

**Codex SDK（纯编排，瘦核）**：
- Thread/Turn 模型：`run()` 同轮多次续话；`resumeThread()` 持久恢复（`~/.codex/sessions`）
- **`outputSchema`（JSON Schema/Zod）per-turn 结构化输出**——review verdict 的结构化通道，比围栏 JSON 解析更硬
- `local_image` 附件、workingDirectory、env 全控、`--config` TOML 覆盖（含 sandbox/approval/permissions）
- **无 agent 定义、无消息变换**——"节点个性"只能进 prompt + config；即 MAFW 节点在 Codex 上天然降级为「prompt 模板 + 配置档」

**dsh**：官方文档站本次未取得有效内容（fetch 空）；既有调研结论维持——developer preview、Cordis 微内核、插件即产品，**不可作为嵌入式节点 runtime**，观察名单。

## 3. 对 MAFW 节点执行模型的设计含义

### 3.1 结论：NodeSpec（runtime 中立的节点规格）而不是「选一个载体」

「真 agent 定义 vs 纯 prompt 模板」是**伪二选一**——它是每个 runtime 的实现细节。正确抽象：

```
NodeSpec（gateway 侧持久化，loop 计划的组成部分）:
{
  node: 'review',
  rolePrompt: string,          // 节点职责系统提示词（模板，含 goalId/loop 上下文注入位）
  tools?: string[],            // 工具白名单（plan 只读 / execute 可写 —— 权限梯度表阶段）
  model?: string,              // 模型 hint（reviewer 用小快模型）
  effort?, maxTurns?, maxCostUsd?,   // 节点级预算（Claude AgentDefinition 同构字段）
  outputSchema?: object        // 结构化产物 schema（review verdict）
}
```

各 runtime adapter 翻译 NodeSpec：

| Runtime | 翻译方式 |
|---|---|
| opencode v1 | `agents.install` 注册（启动时）+ session.create 指定 agent |
| pi | `agentConfigApi` 安装 + AgentSession |
| **Claude Agent SDK** | **不 install——session/prompt 时注入 `options.agents`**（动态工厂），工具白名单/模型/预算直接映射 |
| Codex SDK | 降级：rolePrompt 进 turn prompt，model/sandbox 进 config 覆盖，outputSchema 用 per-turn schema；无工具白名单（用 config permissions 近似） |

**契约影响**：`agentConfigApi` 的 install 语义不能照搬到 Claude——NodeSpec 必须由 gateway 持有，runtime adapter 在**会话创建/prompt 时**翻译注入（install 型与 at-prompt 型两种实现策略）。这正好与「LLM 设计 + 状态机执行」匹配：loop 计划 JSON（含 NodeSpec 列表）是 gateway 的持久产物，runtime 只消费。

### 3.2 Tier 分级（节点执行承载能力）

- **Tier 2（完整）**：opencode v1/v2、pi、Claude Agent SDK——真 agent 定义 + 权限梯度 + per-agent 模型 + 预算
- **Tier 1（降级可用）**：Codex SDK——prompt 模板 + config 档 + outputSchema；无 install/无消息变换（认知面也缺，只能靠 MCP）
- **观察**：dsh——developer preview，不嵌入

### 3.3 顺带收获

- **结构化 verdict 通道**：Codex `outputSchema` per-turn + MAFW 已有 `CompletionRequest.responseFormat`（json_schema）→ review verdict 可升级为 schema 约束输出，围栏 JSON 解析作 fallback（能力门模式）
- **预算语义对齐**：Claude `maxBudgetUsd` 含 subagent 花费——MAFW BudgetGuard 的 goal 级预算 + NodeSpec 节点级预算两层结构与其同构，字段名可直接对齐减少翻译损耗
- **Claude subagent 输出扫描**（control-tag 中和）提示：节点产物若含指令样文本会被 runtime 防护改写——结构化产物（schema JSON/文件路径指针）优于自由文本回传

## 4. 对 P1 设计的直接输入

P1（启用+trace 地基）中节点执行载体的答案：

1. **NodeSpec 抽象进 loop 计划格式**（P3 提前定义接口，P1 先用 plan/execute/review 三个内置 NodeSpec 实例）
2. opencode v1 路径：`agents.install` 注册三个节点 agent（参照 manager 先例，权限梯度：plan 只读、execute 可写、review 只读+bash）——替换 `/skill mafw-*` 裸文本
3. 节点 prompt = NodeSpec.rolePrompt 模板渲染（goalId/loop/charter 指针/产物路径注入），不再依赖会话自由发挥
4. review verdict：`responseFormat`（opencode 支持）+ 围栏 fallback；为 Codex/Claude runtime 预留 outputSchema 同语义通道
5. 跨 runtime 适配器（Claude/Codex）是 P1 非目标，但 NodeSpec 字段设计以本次调研的映射表为准，避免将来破坏性迁移
