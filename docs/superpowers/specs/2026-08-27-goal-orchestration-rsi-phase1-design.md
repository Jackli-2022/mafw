# Goal 编排 RSI — Phase 1：Goal Outcome 观测层设计

日期：2026-08-27
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
| duration_ms | INTEGER | goal 创建 → 归档 |
| tokens_input | INTEGER | 可空：trajectory 缺失时为 NULL |
| tokens_output | INTEGER | 可空 |
| total_cost | REAL | 可空 |
| tool_error_count | INTEGER | 可空 |
| thumbs_up | INTEGER | 默认 0 |
| thumbs_down | INTEGER | 默认 0 |
| policy_version | TEXT NOT NULL | 本期恒为 `builtin-v1` |
| failure_kind | TEXT | `missing_capability` / `bad_plan` / `exec_error` / `review_false_fail` / `max_retries` / `user_cancel` |
| failure_signature | TEXT | sameSig 签名 / lastError 摘要（供 Phase 2 聚类失败模式） |
| evolution_proposal_id | TEXT | **预留**：该 goal 若跑在某演化变体下，关联提议 id（Phase 1 恒为 NULL） |
| created_at | TEXT | ISO 时间 |
| archived_at | TEXT | ISO 时间 |

索引：`(policy_version, verdict)`——Phase 2 fitness 查询（"策略 A vs B 的 PASS 率/轮数/成本对比"）是一条 SQL。

### 2.2 `evolution_proposals` 表（现在建，Phase 2 才开始写）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PRIMARY KEY | |
| component_diffs | TEXT (JSON) | 字段级 diff 列表：`[{component_id, field, from, to}]` |
| declared_prediction | TEXT | **可证伪契约**：如"review_fail 类失败率 40% → <25%" |
| rationale | TEXT | evolver 的归因推理摘要 |
| status | TEXT | `proposed` / `approved` / `active` / `validated` / `rejected` / `rolled_back` |
| validation_result | TEXT (JSON) | 下一周期对照 declared_prediction 的验证结果 |
| created_at / updated_at | TEXT | |

### 2.3 组件注册表 `gateway/src/orchestration/registry.ts`

声明式枚举全部可演化组件（Phase 1 只读，不接线行为）：

```typescript
interface OrchestrationComponent {
  id: string;                          // 'review.samematch_threshold'
  kind: 'prompt' | 'threshold' | 'model_route' | 'parameter';
  currentValueSource: string;          // 现值来自哪里（代码位置/config 键）
  evolvablePhase: 2 | 3;               // 哪个 phase 起可演化
}
```

首期登记（穷举现状，不遗漏）：mafw-plan prompt、mafw-review prompt、sameSig 升级阈值（review.node.ts 硬编码 ≥2）、maxRounds 默认（config.loop.maxRounds=3）、worker/review 模型路由（config.recall.workerModel 等）、wave 划分启发式（mafw-plan 内）。

### 2.4 策略版本钩子 `gateway/src/orchestration/policy.ts`

```typescript
export function getActivePolicy(): { version: string } {
  // 读 ~/.mafw/orchestration/active.json 的 { version }
  // 缺失/损坏 → 回退 'builtin-v1'
}
```

Phase 1 恒返回 `builtin-v1`；Phase 2 切换策略只写 active.json 数据文件，不改 Phase 1 代码——数据面与控制面从此分离。

## 3. 数据流与写入点

```
archive.node.ts（archiveSuccess/archiveFail/archiveMaxRetries 共用 archiveGoal 之前）
  └─ recordOutcome(state)                     ← 唯一新调用点
       ├─ LoopState        → verdict / rounds / lastError / reviewFeedback
       ├─ state.sessions   → 各 phase 的 sessionID（recordSession 已在维护）
       │      └─ 按 sessionID 聚合 trajectory turns → tokens / cost / toolErrors
       ├─ 扫 .mafw/user-feedback/*.json 按 goalId → thumbs 计数
       ├─ getActivePolicy().version
       └─ gateway.db.upsertOutcome(...)       ← fail-open：失败只记日志
```

归档节点是唯一新调用点；`mafw_cancel_goal` 的取消路径同样调用 recordOutcome（verdict=`CANCELLED`）。

边界决策：

- **trajectory 不改表、不改采集路径**：goal→session 映射已在 state.sessions，归档时反查聚合。给 trajectory 加 goal_id 列留作后续（仅当需要实时按 goal 看成本）
- **失败归因**：由 recordOutcome 按 state（lastError 来源节点、reviewVerdict、rounds vs maxRounds）规则推断，不调 LLM
- 查不到 trajectory → 成本字段 NULL；无 feedback 目录 → thumbs 为 0

## 4. 查询接口

- `GET /api/orchestration/outcomes?policy=&verdict=&limit=` —— dashboard 与 Phase 2 evolver 使用
- **不做**：新 MCP 工具（evolver 在 gateway 进程内直接读 db）、桌面 UI（后置）

## 5. 错误处理

- outcome 写入 fail-open：任何异常只记日志，绝不影响归档主流程（对齐 recall/context 哲学）
- upsert 幂等：goal_id 主键，重复归档（如恢复流程重跑）更新同一行
- active.json 损坏 → 回退 `builtin-v1` 并记 warn

## 6. 测试

- `outcome-recorder.test.ts`：聚合逻辑（state/trajectory/feedback 三种数据的有无组合）、upsert 幂等、fail-open（db 抛错不影响归档）、failure_kind 推断规则
- `policy.test.ts`：active.json 缺失 / 损坏 / 正常三分支
- `registry.test.ts`：注册表组件 id 唯一性、每个组件的 currentValueSource 可解析
- archive 节点集成：注入 fake recordOutcome，验证三个归档节点都会调用

## 7. 改动清单

| 文件 | 改动 |
|---|---|
| `gateway/src/memory/gateway-db.ts` | +goal_outcomes、evolution_proposals 表与 CRUD |
| `gateway/src/orchestration/policy.ts` | 新建，~30 行 |
| `gateway/src/orchestration/registry.ts` | 新建，组件声明 ~80 行 |
| `gateway/src/orchestration/outcome-recorder.ts` | 新建，聚合逻辑 ~150 行 |
| `gateway/src/index.ts` | buildNodeOptions 注入 recordOutcome（3 个归档节点）+ API 路由 |
| `tests/unit/gateway/` | +3 个测试文件 |
| `AGENTS.md` | 增补 goal_outcomes / evolution_proposals 表与 orchestration 目录说明 |

## 8. Phase 1 退出标准

真实环境跑过若干 goal 后，以下查询能出数：

```sql
SELECT policy_version, verdict, avg(rounds), avg(total_cost)
FROM goal_outcomes GROUP BY policy_version, verdict;
```

## 9. 后续 Phase 接口预留（不实施）

- **Phase 2**：evolver cron（`orchestration:evolve`，照 reflect 模式注册 actionRegistry）读 outcomes + lessons → GEPA 式反思 → 写 evolution_proposals（字段级 diff + declared_prediction）→ triage 确认 → 写 active.json；策略包数据化（把注册表内组件的现值抽到 `~/.mafw/orchestration/`）
- **Phase 3**：源码结构变体走 self-update，门禁升级为 build + test + goal 回放 benchmark（候选形态参考 LoopsBench, arXiv:2608.00267）
- **Phase 4**（仅记录）：optimizer code——evolver 的反思 prompt/提议策略自身进入演化范围（参考 Self-Harness、Promptbreeder）；注册表与 triage 确认层**永远**在演化范围之外
