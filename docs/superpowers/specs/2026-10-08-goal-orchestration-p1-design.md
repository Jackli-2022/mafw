# Goal 编排 P1：启用 + 节点驱动器重写 + Trace 地基（设计）

> 2026-10-08 · 状态：待评审
> 四期路线的第一期。P1 = 启用（修六断点）+ DFX 数据层；P2 = 前端节点图；P3 = 编排智能化（模板库+动态注册）；P4 = 用户设计器 + 重跑 UI。
> 输入调研：`docs/research/2026-10-08-goal-loop-enablement-survey.md`（现状六断点）、`2026-10-08-industry-agent-loop-survey.md`（业界模式）、`2026-10-08-node-execution-runtime-survey.md`（NodeSpec/身份）、`2026-10-08-node-driver-survey.md`（驱动器现状与可复用件）。

## 1. 问题与目标

goal 编排当前「装配完成、未接线」：langgraph 三节点图存在但六个断点使整链不可运行（starter 缺失、plan 竞态、checkpointer no-op、askUser 断链、complete 无调用方、字段错配）。根因之一是 `promptAsync` 的 runtime 语义分歧（opencode 恒 fire-and-forget / pi idle 阻塞到回合结束，node-driver-survey §1）。

**P1 交付目标**：
1. 合成最小 goal 能端到端跑通 plan→execute→review→archive（含 askUser 中断恢复）
2. 全程节点级可观测（起止/状态/耗时/verdict/关联会话/产物落库）
3. 崩溃安全：gateway 重启后 goal 从 state 恢复续跑，不重置轮数/预算

**非目标**：前端节点图（P2）；编排 agent、模式模板库、动态身份注册（P3）；可视化设计器、重跑 UI（P4）；Claude/Codex runtime adapter（后续期）；langgraph npm 依赖移除（后续清理 PR）。

## 2. 关键决策

| # | 决策 | 依据 |
|---|---|---|
| D1 | **状态机执行器从 langgraph 换成自研 NodeDriver**（state 文件 + 事件驱动重入）。路由纯函数（graph.ts:4-15）搬走保留；checkpointer/interrupt/Command-resume 退役 | 状态真相源本是 state 文件；checkpoint 协议从未成立（putWrites no-op）；业界调研：Claude Stop hook 模式（回合末钩子驱动）优于外部状态机轮询 |
| D2 | **节点身份 = IdentityRegistry 三个内置身份**：`mafw-plan`（deny file-edit/shell，纯只读规划）/ `mafw-execute`（全开）/ `mafw-review`（deny file-edit，只读+bash 跑测试）。复用 v4.21.0 物化 + withIdentityPrompt 绑定 + identity 审批维度，不发明平行 NodeSpec 系统 | IdentitySpec 已覆盖 rolePrompt/policy/model；节点实例参数（预算/schema/promptVars）留在 loop 计划侧（P3 冻结格式，P1 用内置三身份） |
| D3 | **节点完成 = session.idle + 产物校验双门**；不信任单信号 | session.idle 两 runtime 语义统一（node-driver-survey §3）；产物文件是客观证据 |
| D4 | **starter 统一**：四个创建入口收敛「写目标项目 `.mafw/requests/` → goal_created → 监听器补 state + advance」 | 六断点之首；mafw_set_goal 目录错配修复 |
| D5 | **askUser 改 state 驱动**：pendingQuestion 落 state + QuestionLedger asked 落地；应答写 state.userResponse → advance。消除 langgraph Command 依赖 | asked 事件无写入点是现状断链根因；id 化问题文件天然契合 |
| D6 | **legacy skill 链不动**（`core/skills/mafw-*/entry.ts` + `/goal` 插件命令），P1 新链路并行；state 读取双读兼容（round 回退 loop），P1 收尾后删 | 控制单期爆炸半径 |

## 3. 架构

```
创建入口（mafw_create_goal / mafw_set_goal / 插件 /goal / automation triage）
   │ ①写 request 到目标项目 .mafw/requests/（projectDir 从调用会话 directory 解析）
   ▼
goal_created 监听器（扩 index.ts:2626 分支）
   │ ②补写 state v3（含 policySnapshot）→ NodeDriver.advance
   ▼
┌─ NodeDriver（gateway/src/core/goal/，每 goal 一个状态机实例）──────────┐
│ advance(goalId):  runExclusive 互斥 → 读 state → 路由纯函数定下一节点    │
│   ├─ plan/execute/review: 身份物化确认 → session.create →              │
│   │    onSessionCreated（goal_sessions 落库 + BudgetGuard 挂载）→      │
│   │    void promptAsync(渲染后 prompt).catch(→onNodeError)（不 await）│
│   │    → state.nodeSession={id,phase,startedAt} 落盘 →                 │
│   │    goalNodeListeners.set(sessionID, handler)                       │
│   ├─ askUser: pendingQuestion 落 state + ledger asked → 等外部应答      │
│   └─ archive_*: archiveGoal（现有逻辑原样）                             │
│                                                                       │
│ onSessionIdle: goalNodeListeners 查表 → 读产物文件（NODE_CONFIGS）→    │
│   parseResult 校验 → 写 node_runs + state → session.delete → advance  │
│ onSessionError: lastError 收敛（error 信封 / throw 双形态）→ advance   │
│ watchdog（扩 resumeStaleThreads 周期）: startedAt 超时（默认 30min）→  │
│   session.abort + 同节点重试一次（attempt+1）→ 仍失败 archive_fail     │
└───────────────────────────────────────────────────────────────────────┘
   │ goal_node 事件（SSE 广播） + phase_transition（签名不动）
   ▼
Timeline API（GET /api/goals/:id/timeline）← goal_node_runs ⋈ goal_sessions
```

**零迁移约束**：`phase_transition` 事件签名不变（milestone-push 依赖）；`onSessionCreated` 回调签名不变（BudgetGuard/DB 落库照旧）；NODE_CONFIGS 产物契约不变（路径改 per-loop，格式不变）。

## 4. 执行流细节

**starter**：`mafw_set_goal`/`mafw_create_goal` 接受 projectDir（缺省从调用会话 directory 推导，再缺省 gateway cwd 注册项目列表第一项并 warn）；写完 request 发 `goal_created`；监听器发现无 state → 补写 v3 → advance。

**节点 prompt 模板**（替换 `/skill mafw-*` 裸文本）：goalId、loop/round、charter 指针、上轮 review verdict/feedback、**产物绝对路径 + 格式示例**（receipts/waves/review md 结构）注入；review 模板要求围栏 JSON verdict（```mafw-review 围栏，复用 review-parser.ts；responseFormat schema 通道为后续 runtime 增强，P1 围栏+校验足够）。

**loop 路由**（从 graph.ts 搬走的纯函数，语义不变）：review 后 lastError→archive_fail / PASS→archive_success / round≥maxRounds（默认 3，config maxRounds）→archive_max_retries / pendingQuestion→askUser / 否则回 plan。同签名 FAIL ≥2（Jaccard≥0.7，signature-detector.ts）挂 pendingQuestion，上限 3。round 在 review 节点完成后 +1，先判 verdict 再判 maxRounds（修现状边界）。

**产物契约**：receipts 改 `receipts/{goalId}/loop-{N}-receipt.json`（不再覆盖）；waves.json 单文件保留（plan 每轮重写属预期）；reviews 维持 `reviews/{goalId}-loop{N}.md`。

**askUser 全链路**：node 写 ledger asked + pendingQuestion 落 state → milestone 通知（复用 ASKING_USER 白名单）→ `mafw_list_pending_questions` 列出 → `mafw_answer_question` / `POST /api/goals/:goalId/questions/:qid/respond` 写 state.userResponse + ledger answered → advance。manager 可自治代答。

## 5. DFX 数据层

**goal_node_runs 表**（gateway.db）：

```sql
CREATE TABLE goal_node_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id TEXT NOT NULL, project_id TEXT NOT NULL,
  loop INTEGER NOT NULL, node TEXT NOT NULL, attempt INTEGER DEFAULT 1,
  session_id TEXT,                    -- askUser 为 null
  status TEXT NOT NULL,               -- running|succeeded|failed|timeout|aborted
  started_at TEXT NOT NULL, finished_at TEXT,
  outcome TEXT,                       -- review: PASS/FAIL；execute: receipts 摘要
  error TEXT,
  tokens_input INTEGER, tokens_output INTEGER, cost_usd REAL  -- 收尾从 trajectory 按会话快照 best-effort
);
CREATE INDEX idx_node_runs_goal ON goal_node_runs(goal_id, loop);
```

写入点收敛两处：advance 启动 INSERT；完成/失败/超时 UPDATE。watchdog 重试 = 新行（attempt 区分，保留失败历史）。

**goal_node 事件**（新 canonical，SSE 广播）：`{goalId, projectDir, loop, node, transition: started|finished|failed|timeout, at, durationMs?, verdict?, error?, attempt}`。P1 只发不消费（desktop 忽略 goal 事件现状保持，P2 接）。

**state v3**（NodeDriver 为唯一写入方）：`{version:'3', goalId, phase, round（规范名，废弃 loop 写入）, maxRounds, currentWave, totalWaves, nodeSession, pendingQuestion, userResponse, sessions, nextAction, artifacts, error, updatedAt, stateVersion, policySnapshot}`。读取双读兼容（round ?? loop）过渡。

**Timeline API**：`GET /api/goals/:id/timeline` → `{goal, nodes[]（node_runs ⋈ goal_sessions 富化 title/duration/cost/sessionId）, artifacts{wavesPath, receipts[], reviews[]}, outcome?}`。SDK `goals.timeline()`。数据形状 P1 冻结。

**测量面**：节点级看 goal_node_runs；goal 级看 goal_outcomes（已有，不动）。两层不混。

## 6. 恢复与幂等

**崩溃恢复**（扩 recoverState，启动时）：扫非终态 state → 无 nodeSession 直接 advance；有 nodeSession：**先查产物**（gateway 死亡期间可能已完成 → 视为完成推进）→ 未出现再探会话（session.get 能力门降级：活且 idle / 不存在）→ 节点重试 attempt+1（attempt≥2 → archive_fail）。

**幂等三保险**：runExclusive per-goal 互斥；advance 入口查最新 running 行（有存活会话即返回）；状态只在受互斥保护的监听回调里改（goal_node 事件只通知不驱动）。

**取消**：`/control ABORT` 与 `mafw_cancel_goal` 维持现有归档链（CANCELLED + outcome）；NodeDriver 新增：终态时清 goalNodeListeners + abort running 会话（fail-open）。

**节点重跑**（DFX）：`POST /api/goals/:id/nodes/:runId/retry`（薄路由 + deps 注入）。review/askUser（只读）直接重跑；execute 过 destructive 确认门（重跑=再执行一遍写操作，prompt 注入上轮 diff 摘要供 agent 自行判断收敛点）。完成后走正常路由。

## 7. 错误处理

- 错误分类（node_runs.status / goal_outcomes.failure_kind 聚合）：`timeout | session_error | artifact_missing | artifact_invalid | budget_exhausted`
- 驱动器全回调 try/catch，异常落 state.lastError → archive_fail 路由，绝不崩 gateway；advance 自身崩溃由 watchdog 下轮自愈
- promptAsync 不 await（`void promise.catch(→onNodeError)`）——消解 pi 阻塞语义分歧
- runtime 能力差异兜底：会话探测缺失 → 产物 + watchdog 兜底；pi 无 session.error → idle + watchdog 覆盖；error 信封/pi throw 双形态统一收敛为 lastError

## 8. 测试策略（TDD 先行）

- **单测**：路由纯函数（从 graph 测试搬）、NodeDriver 状态机（fake 事件注入：idle/error/超时/产物缺失/产物非法）、watchdog、恢复重放（state fixture → 断言 advance 决策，含「产物已出现视为完成」分支）、retry destructive 门、state v3 双读
- **集成**（fake runtime：stub session.create/promptAsync/event stream）：端到端 plan→execute→review→archive；askUser 中断→应答→恢复；模拟崩溃（丢内存态从 state 重建）；watchdog 超时→重试→archive_fail
- **回归**：milestone-push、goal-snapshot、mafw_get_goal_status、dashboard getGoals、QuestionLedger 既有路由
- 交付时报告新增测试数与全量通过数

## 9. 交付清单（12 项）

1. `mafw-plan/execute/review` 三身份注册（IdentityRegistry + 权限梯度）
2. NodeDriver 模块 `gateway/src/core/goal/`（driver / node-runs / recovery / retry）——index.ts 只薄接线
3. starter 收敛（goal_created 监听 + projectDir 解析）
4. askUser state 驱动（QuestionLedger asked 落地）
5. goal_node_runs 表 + goal_node 事件 + timeline API
6. receipts per-loop 分文件
7. state v3 + round 规范（双读过渡）
8. watchdog + 崩溃恢复
9. retry API（execute destructive 门）
10. langgraph invoke 路径退役（buildExecutionGraph/onGoalCreated/handleComplete/checkpointer 替换删除）
11. legacy skill 链不动（`/goal` 插件命令继续可用）
12. 死代码标注 deprecated（GraphRunner / core/plugin.ts / poll.ts / core/mcp/tools.ts；物理删除单独 PR）

## 10. 风险与开放问题

- **产物靠 prompt 协议约定**：agent 不写 receipt → artifact_missing。缓解：模板显式路径+格式示例+重试；长期看 P3 的 outputSchema 通道
- **execute 重跑副作用**：destructive 门 + diff 摘要注入缓解；重跑语义文档明示
- **身份物化与 agent md 漂移**：v4.21.0 已处理（同一 builder 派生），无新增风险
- **多 goal 并发**：P1 支持多 goal 各自状态机（互斥是 per-goal），但 worktree 隔离是 P3+（phase3 spec M12 遗留，主分支名硬编码问题不在 P1 修）
- 开放问题（P1 实现时定）：watchdog 默认超时值（30min 起步可配）；goal_node 事件是否进 EVENT_FLOW_MATRIX（建议进）
