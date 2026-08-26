# Goal 编排 RSI — Phase 1：Goal Outcome 观测层设计

日期：2026-08-27（v2，按子代理评审修正）
状态：待审阅
路线：Phase 1（观测层）→ Phase 2（策略包演化闭环）→ Phase 3（源码结构进化）→ Phase 4（远期，optimizer code，仅记录不承诺）

## 1. 背景与目标

让 gateway 的 Goal 编排（LangGraph plan→execute→review 循环 + wave 执行 + automation 触发）具备递归自我改进（RSI）能力。业界共识（DGM、AlphaEvolve、AHE、GEPA）：RSI = 变异算子 × 自动评估器 × 可回滚档案，且**评估器/观测是核心资产，必须先建**。

Phase 1 只做观测，零行为变化：每个 goal 归档时落一行结构化 outcome，打通成本/反馈聚合，埋入策略版本钩子与组件注册表。后续 Phase 的演化循环全部建立在这份数据之上。

### 设计约束（来自调研）

- **三支柱可观测性**（AHE, arXiv:2604.25850）：
  1. Component observability —— 可演化组件有文件级表示，动作空间显式且可回滚
  2. Experience observability —— 分层 drill-down 证据：outcome（顶层聚合）→ lesson/review 报告（中层）→ trajectory 原始事件（底层）
  3. Decision observability —— 每次演化变更附带可证伪的自我声明预测，下一周期验证
- **收益定位实证**（AHE ablation）：可迁移的改进集中在 tools/middleware/结构化参数，而非 prompt 散文——注册表优先包含结构化参数
- **权限在循环之外**（Weng, Harness Engineering for Self-Improvement, 2026.7）：组件注册表与 triage 确认层对 evolver 不可写，防止 evolver 自行扩大动作空间
- **结构化 diff**（ACE 式）：演化变更是字段级 diff，非自由文本替换（Phase 2 约束，schema 现在预留）

## 2. 数据模型

### 2.1 `goal_outcomes` 表（gateway.db，GatewayDatabase）

| 字段 | 类型 | 说明 |
|---|---|---|
| goal_id | TEXT PRIMARY KEY | upsert 幂等：重复归档更新而非报错 |
| project_id | TEXT | |
| verdict | TEXT | `PASS` / `FAIL` / `MAX_RETRIES` / `ERROR` / `CANCELLED` |
| rounds | INTEGER | 实际用的 review 轮数 |
| duration_ms | INTEGER | goal 创建 → 归档；创建时间读 `.mafw/requests/{goalId}.json`（StateFile 无 createdAt） |
| tokens_input | INTEGER | 可空：trajectory 缺失时为 NULL |
| tokens_output | INTEGER | 可空 |
| total_cost | REAL | 可空 |
| tool_error_count | INTEGER | 可空 |
| thumbs_up | INTEGER | 默认 0 |
| thumbs_down | INTEGER | 默认 0 |
| policy_version | TEXT NOT NULL | **goal 创建时快照**（见 §3.2），本期恒为 `builtin-v1` |
| evolution_proposal_id | TEXT | **预留**：该 goal 若跑在某演化变体下，关联提议 id；随 policy 快照在创建时写入 |
| failure_kind | TEXT | `missing_capability` / `bad_plan` / `exec_error` / `review_false_fail` / `max_retries` / `user_cancel` / `archive_error` |
| failure_signature | TEXT | 签名生成器产出：`{failure_kind}:{首个错误工具名}:{模板化错误摘要}`（模板化 = 去 id/数字/路径）。sameSig 的 matchesSignature 只有全串相等，不能直接复用 |
| created_at | TEXT | ISO 时间 |
| archived_at | TEXT | ISO 时间 |

索引：`(policy_version, verdict)`；`(project_id, policy_version)`——fitness 查询按项目分层（避免项目构成漂移冒充策略效果）。

### 2.2 `goal_sessions` 表（归档聚合的数据基础）

评审发现 `state.sessions` 不可用（LangGraph LoopState 无此字段；StateFile 的 sessions 每 phase 只存一个且 `startNextLoop` 清空）。因此新建追加式映射表：

| 字段 | 类型 | 说明 |
|---|---|---|
| goal_id | TEXT | |
| session_id | TEXT | |
| phase | TEXT | `plan` / `execute` / `review` |
| loop | INTEGER | |
| created_at | TEXT | |

PRIMARY KEY (goal_id, session_id)。**追加，永不清空**。

写入点：`recordSession()`（phase-orchestrator.ts）被 mafw-plan/mafw-review/mafw-execute 的 entry 调用——在其现有写 StateFile 逻辑旁追加一行 DB upsert（fail-open）。

### 2.3 `evolution_proposals` 表（现在建，Phase 2 才开始写）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PRIMARY KEY | |
| requires | TEXT DEFAULT 'policy' | `policy`（Phase 2 数据层）/ `structural`（Phase 3 源码层）——建表时预留，避免 Phase 3 ALTER |
| component_diffs | TEXT (JSON) | 字段级 diff 列表：`[{component_id, field, from, to}]` |
| declared_prediction | TEXT | **可证伪契约**：如"review_false_fail 占比 40% → <25%，窗口 20 goal 或 14 天" |
| rationale | TEXT | evolver 的归因推理摘要 |
| status | TEXT | `proposed` / `approved` / `active` / `validated` / `rejected` / `rolled_back` / `superseded` |
| validation_result | TEXT (JSON) | 对照 declared_prediction 的验证结果 |
| created_at / updated_at | TEXT | |

### 2.4 组件注册表 `gateway/src/orchestration/registry.ts`

声明式枚举可演化组件（Phase 1 只读，不接线行为）：

```typescript
interface OrchestrationComponent {
  id: string;                          // 'review.samematch_threshold'
  kind: 'prompt' | 'threshold' | 'model_route' | 'parameter';
  currentValueSource: string;          // 现值的真实代码位置（须与实际核对）
  evolvablePhase: 2 | 3;               // 哪个 phase 起可演化
}
```

**首期最小集**（不追求穷举，后续增补）：
- `plan.prompt` ← `core/skills/mafw-plan/entry.ts` 本地 buildPlanPrompt（注意：core/tools/run-plan.ts 的同名函数无人调用，是漂移副本）
- `review.prompt` ← `core/skills/mafw-review/entry.ts` 本地 buildReviewPrompt（同上）
- `review.samematch_threshold` ← review.node.ts 硬编码 `>= 2`
- `review.verdict_parse` ← review.node.ts parseReviewVerdict 启发式
- `loop.max_rounds` ← config.loop.maxRounds（默认 3）
- `loop.stuck_timeout` ← config.timeouts.stuckLoopTimeout
- `execute.degradation_l3` ← degradation.ts 的 L3 震荡检查参数

plan/review 的 session 模型当前取 opencode 会话默认模型（session.create 不传 model），**不在首期注册表**——模型路由需要新增接线，连同接线一起作为后续组件登记。

### 2.5 策略版本钩子 `gateway/src/orchestration/policy.ts`

```typescript
export function getActivePolicy(): { version: string; proposalId: string | null } {
  // 读 ~/.mafw/orchestration/active.json 的 { version, proposalId }
  // 缺失/损坏 → 回退 { version: 'builtin-v1', proposalId: null }
}
```

Phase 1 恒返回 builtin-v1；Phase 2 切换策略只写 active.json，不改 Phase 1 代码。

## 3. 数据流与写入点

### 3.1 策略快照（goal 创建时）

评审关键点：归档时读 getActivePolicy() 会把进行中切换的新版本错标给旧 goal。因此 **goal 创建时**（`onGoalCreated`，index.ts）把 `{policy_version, proposal_id}` 快照写入 `.mafw/requests/{goalId}.json`；recordOutcome 读快照，快照缺失才回退 getActivePolicy()。

### 3.2 outcome 写入点（三个真实漏斗，全部接线）

```
① archiveGoal（index.ts，三个归档节点的真实公共漏斗；archive.node.ts 只是 re-export）
     └─ archiveGoal 成功后 → recordOutcome(...)
          archiveGoal 失败（patchState phase='ARCHIVED', error='archive_failed'）
          → 仍 recordOutcome，failure_kind='archive_error'
② mafw_cancel_goal → POST /control {action:'ABORT'} 分支（当前只 destroyAllSessions+patchState）
     └─ 显式调用 recordOutcome(verdict='CANCELLED') + archiveGoal——新接线，取消路径当前完全不到达归档逻辑
③ recordSession()（phase-orchestrator）
     └─ 追加 goal_sessions 行（goal_id, session_id, phase, loop）
```

排除：`chat/graph-runner.ts` 的 stub buildNodeOptions（归档 no-op 路径）不接线。

recordOutcome 聚合逻辑：

```
├─ LoopState / StateFile → verdict / rounds / lastError / reviewFeedback
├─ requests/{goalId}.json → 创建时间（duration_ms）、policy 快照
├─ goal_sessions → 全部 sessionID
│    └─ trajectory_turns 按 sessionID IN (...) 聚合 → tokens / cost / toolErrors
│       （trajectory-store 已有 getSessionTokenSummary 类聚合能力）
├─ 扫 .mafw/feedback/ 与 .mafw/user-feedback/ 两目录（现网两处都可能有数据；
│    按 feedbackId 去重）按 goalId 聚合 → thumbs 计数
├─ failure_signature 生成器 → failure_kind + 首错工具 + 模板化摘要
└─ gateway.db.upsertOutcome(...) ← fail-open：失败只记日志
```

边界决策：

- **trajectory TTL 冲突**：collector 每写事件 prune 14 天。goal_sessions 登记过的 session **豁免 prune**（trajectory-store 的 prune 改为只删未登记 session；代价是 goal session 数据长期留存，量级可接受）
- **fail-open**：outcome 写入失败绝不影响归档主流程
- 查不到 trajectory → 成本字段 NULL；无 feedback → thumbs 为 0
- feedback 写入路径分裂（`.mafw/feedback/` vs `.mafw/user-feedback/`，后者基于 process.cwd() 可能写错位置）是存量问题，本期只双扫聚合，统一写入路径列为已知债务
- 多 goal 并发归档：archiveGoal 已有按项目扫 state 的逻辑，recordOutcome 复用其解析出的 projectDir，不重复扫描

## 4. 查询接口

- `GET /api/orchestration/outcomes?policy=&verdict=&project=&limit=` —— dashboard 与 Phase 2 evolver 使用；路由正则遵循 `(?:\?|$)` 模式（AGENTS.md §6.5）
- **不做**：新 MCP 工具（evolver 在 gateway 进程内直接读 db）、桌面 UI（后置）

## 5. 错误处理

- outcome 写入 fail-open：任何异常只记日志，绝不影响归档主流程（对齐 recall/context 哲学）
- upsert 幂等：goal_id 主键，重复归档（如恢复流程重跑）更新同一行
- active.json 损坏 → 回退 `builtin-v1` 并记 warn
- 僵尸 goal（永不归档）：本期不处理，outcome 缺失是可接受的数据形态；Phase 2 evolver 的统计只基于已归档样本

## 6. 测试

- `outcome-recorder.test.ts`：聚合逻辑（goal_sessions/trajectory/feedback 三种数据的有无组合）、upsert 幂等、fail-open、failure_kind/failure_signature 生成规则、快照优先于 getActivePolicy
- `goal-sessions.test.ts`：recordSession 追加语义（跨 loop 不清空）、豁免 prune
- `policy.test.ts`：active.json 缺失 / 损坏 / 正常三分支
- `registry.test.ts`：注册表组件 id 唯一性、每个 currentValueSource 指向真实代码位置（grep 断言）
- 归档接线：fake recordOutcome 验证 archiveGoal 成功/失败、ABORT 取消三条路径都会调用

## 7. 改动清单

| 文件 | 改动 |
|---|---|
| `gateway/src/memory/gateway-db.ts` | +goal_outcomes、goal_sessions、evolution_proposals 表与 CRUD（ALTER 迁移照现有 try/catch 模式） |
| `gateway/src/orchestration/policy.ts` | 新建，~30 行 |
| `gateway/src/orchestration/registry.ts` | 新建，首期最小集 ~80 行 |
| `gateway/src/orchestration/outcome-recorder.ts` | 新建，聚合 + 签名生成 ~180 行 |
| `gateway/src/core/engine/phase-orchestrator.ts` | recordSession 追加 goal_sessions |
| `gateway/src/trajectory/trajectory-store.ts` | prune 豁免已登记 session |
| `gateway/src/index.ts` | onGoalCreated 写 policy 快照；archiveGoal 后调 recordOutcome；ABORT 分支接线；+API 路由 |
| `tests/unit/gateway/` | +4 个测试文件 |
| `AGENTS.md` | 增补三张表与 orchestration 目录说明 |

## 8. Phase 1 退出标准

真实环境跑过若干 goal 后，以下查询能出数：

```sql
SELECT project_id, policy_version, verdict, avg(rounds), avg(total_cost)
FROM goal_outcomes GROUP BY 1,2,3;
```

## 9. 后续 Phase 接口预留（不实施）

- **Phase 2**：evolver cron 读 outcomes + lessons → GEPA 式反思 → evolution_proposals（字段级 diff + declared_prediction）→ evolution 类 triage item 确认 → 写 active.json；策略包数据化（注册表组件现值抽到 `~/.mafw/orchestration/`）
- **Phase 3**：源码结构变体走 self-update，门禁升级为 build + test + smoke goal（回放 benchmark 远期）
- **Phase 4**（仅记录）：optimizer code——evolver 的反思 prompt/提议策略自身进入演化范围；注册表与 triage 确认层**永远**在演化范围之外
