# RSI Design Spec Corrections — Post-Review Action Plan

日期：2026-08-30
状态：待执行
基于：子代理评审报告（3 blockers + 11 majors + 10 minors）

## Executive Summary

评审结论： specs 设计质量良好但**未达实施就绪状态**。3 个 blocker 必须在 Phase 1 实施前解决，11 个 major 应在实施期间同步修正。

## Blockers（必须在 Phase 1 实施前解决）

### B1: Cancel Path Outcome Wiring（取消路径 outcome 接线）

**问题**：`mafw_cancel_goal` → `POST /control {action:'ABORT'}` 分支当前只执行 `destroyAllSessions + patchState`，**完全不到达归档逻辑**，导致取消的 goal 永远不会有 outcome 记录。

**当前代码**（index.ts:2836）：
```typescript
await this.archiveGoal(control.goalId, {
  verdict: 'CANCELLED',
  // ... 其他参数
});
```

**实际问题**：`archiveGoal` 内部调用 `recordOutcome`，但取消路径的 `archiveGoal` 调用缺少必要的上下文参数（如 `reviewFeedback`、`lastError`）。

**修复方案**：
1. 在 `POST /control` 的 ABORT 分支中，确保调用 `archiveGoal` 时传递完整的 `OutcomeInput` 参数
2. 对于取消场景，`verdict` 应为 `'CANCELLED'`，`failure_kind` 应为 `'user_cancel'`
3. 添加测试验证取消路径确实触发 `recordGoalOutcome`

**影响文件**：
- `gateway/src/index.ts`（ABORT 分支）
- `tests/unit/gateway/outcome-recorder.test.ts`（新增测试）

### B2: state.sessions Data Model Redesign（state.sessions 数据模型重新设计）

**问题**：`StateFile.sessions` 是 `Record<string, SessionInfo>` 结构，每 phase 只存一个 session，`startNextLoop` 时清空。这与 Phase 1 设计的 `goal_sessions` 追加式映射表冲突。

**当前实现**（state.ts:40）：
```typescript
sessions: Record<string, SessionInfo>;
```

**设计意图**：Phase 1 需要**所有 session 的完整历史**用于 trajectory 聚合。

**修复方案**：
1. **保留 `StateFile.sessions`** 作为当前活跃 session 的快速访问（兼容现有逻辑）
2. **`goal_sessions` 表作为权威数据源**：所有 session 创建时都追加到 DB（已有 `recordSession` 逻辑）
3. **`recordGoalOutcome` 从 DB 读取**：不依赖 `StateFile.sessions`（当前实现已正确）
4. **清理时机**：`startNextLoop` 清空 `StateFile.sessions` 是正确的（当前 loop 的活跃 session），但 DB 记录永不清空

**验证点**：
- 现有 `recordGoalOutcome` 已从 `db.listGoalSessions()` 读取，不依赖 `StateFile.sessions` ✅
- 需要确认 `recordSession` 在所有 session 创建点都被调用

### B3: Triage Activation Chain Redesign（triage 激活链重新设计）

**问题**：Phase 2 设计中，`POST /api/triage/{id}/confirm` 需要按 `type` 分发：evolution 类 → policy 应用逻辑，goal 类 → 原语义。当前 triage 系统无此分发机制。

**修复方案**：
1. **Phase 1 不涉及 triage 分发**（正确，Phase 1 只建数据层）
2. **Phase 2 实施时**：
   - 扩展 triage item 数据模型，新增 `type: 'goal' | 'evolution'`
   - `POST /api/triage/{id}/confirm` 路由按 `type` 分发
   - evolution 类 confirm 调用 `applyPolicyDiff()` 生成新版本 `policies/v<n>/`

**当前状态**：Phase 1 无需修改，但需在 Phase 2 设计文档中明确接口契约。

---

## Majors（实施期间同步修正）

### M1: Prompt Source File Corrections（prompt 源文件位置修正）

**问题**：注册表中 `plan.prompt` 和 `review.prompt` 的 `currentValueSource` 指向 `core/skills/*/entry.ts` 的本地函数，但 `core/tools/run-plan.ts` 和 `run-review.ts` 存在**漂移副本**（无人调用）。

**修复方案**：
1. **Phase 1 实施时**：删除 `core/tools/run-plan.ts` 和 `run-review.ts` 中的漂移副本
2. **注册表更新**：确认 `currentValueSource` 指向正确的 entry.ts 文件
3. **测试断言**：`registry.test.ts` 中添加 grep 断言验证源文件位置

**影响文件**：
- `gateway/src/core/tools/run-plan.ts`（删除漂移副本）
- `gateway/src/core/tools/run-review.ts`（删除漂移副本）
- `gateway/src/orchestration/registry.ts`（确认 currentValueSource）

### M2: policy_version Snapshot Timing（policy_version 快照时机）

**问题**：设计文档 §3.1 要求"goal 创建时快照 `{policy_version, proposal_id}`"，但当前 `onGoalCreated` 实现（index.ts:4885）未写入 `policySnapshot` 到 `StateFile`。

**当前代码**（index.ts:4885）：
```typescript
private async onGoalCreated(goalId: string, projectDir: string, mafwDir: string) {
  // ... 其他逻辑
  // 缺少 policySnapshot 写入
}
```

**修复方案**：
1. 在 `onGoalCreated` 中调用 `getActivePolicy(mafwDir)` 并写入 `StateFile.policySnapshot`
2. `recordGoalOutcome` 已正确读取 `state?.policySnapshot ?? null`（outcome-recorder.ts:89）
3. 添加测试验证快照写入和读取

**影响文件**：
- `gateway/src/index.ts`（`onGoalCreated` 方法）
- `tests/unit/gateway/outcome-recorder.test.ts`（快照测试）

### M3: worker.model/review.model Registry Corrections（模型路由组件修正）

**问题**：设计文档指出"plan/review session 的模型取 opencode 会话默认（session.create 不传 model），模型路由组件**连同 session 创建接线一起做**，列后续增补，不在本期"。但注册表未明确标注此限制。

**修复方案**：
1. **注册表注释**：在 `plan.prompt` 和 `review.prompt` 条目添加注释说明模型路由不在本期
2. **Phase 2 实施时**：新增 `plan.model` 和 `review.model` 组件，接线 `session.create` 的 `model` 参数
3. **当前不做**：保持 `session.create({ directory })` 不传 model（兼容现有行为）

### M4: Trajectory TTL Handling（trajectory TTL 处理）

**问题**：设计文档 §3.1 要求"collector 每写事件 prune 14 天。goal_sessions 登记过的 session **豁免 prune**"，但当前 `trajectory-store.ts` 的 prune 逻辑未实现豁免机制。

**修复方案**：
1. **修改 `trajectory-store.ts` 的 prune 逻辑**：
   - 查询 `goal_sessions` 表获取已登记的 session_id 列表
   - 只 prune 未登记的 session（`WHERE session_id NOT IN (SELECT session_id FROM goal_sessions)`）
2. **性能考虑**：`goal_sessions` 表预期行数有限（每个 goal 3-5 个 session），查询开销可接受
3. **测试验证**：已登记 session 不被 prune，未登记 session 正常 prune

**影响文件**：
- `gateway/src/trajectory/trajectory-store.ts`（prune 逻辑）
- `tests/unit/gateway/goal-sessions.test.ts`（豁免测试）

### M5: failure_signature Implementation（failure_signature 实现）

**问题**：设计文档 §2.1 要求 `failure_signature` 格式为 `{failure_kind}:{首个错误工具名}:{模板化错误摘要}`，但当前 `buildFailureSignature`（outcome-recorder.ts:27）实现为 `{failure_kind}:{normalized_error_text}`，缺少**首个错误工具名**。

**当前实现**：
```typescript
export function buildFailureSignature(kind: string | null, text?: string | null): string | null {
  // ... 模板化逻辑
  return norm ? `${kind}:${norm}` : kind;
}
```

**修复方案**：
1. **扩展 `OutcomeInput` 接口**：新增 `firstErrorTool?: string | null` 字段
2. **修改 `buildFailureSignature`**：签名格式改为 `${kind}:${tool}:${norm}`
3. **数据来源**：从 trajectory_turns 查询 `tool_error_count > 0` 的第一个 turn 的 `tool_name`
4. **向后兼容**：旧签名格式仍可查询（`LIKE 'kind:%'`）

**影响文件**：
- `gateway/src/orchestration/outcome-recorder.ts`（签名生成）
- `gateway/src/memory/gateway-db.ts`（trajectory 查询）

### M6: evolution_proposals requires Field（evolution_proposals requires 字段）

**问题**：设计文档 §2.3 要求 `evolution_proposals` 表有 `requires TEXT DEFAULT 'policy'` 字段，但当前建表语句（gateway-db.ts:206）未包含此字段。

**当前建表**：
```sql
CREATE TABLE IF NOT EXISTS evolution_proposals (
  id TEXT PRIMARY KEY,
  component_diffs TEXT,
  declared_prediction TEXT,
  rationale TEXT,
  status TEXT,
  validation_result TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

**修复方案**：
1. **ALTER TABLE 添加字段**：`ALTER TABLE evolution_proposals ADD COLUMN requires TEXT DEFAULT 'policy'`
2. **迁移逻辑**：在 `GatewayDatabase` 初始化时执行（照现有 try/catch 模式）
3. **Phase 2 使用**：`requires='policy'`（数据层）或 `requires='structural'`（源码层）

### M7: GoalWorktreeManager Generalization（GoalWorktreeManager 泛化）

**问题**：当前 `GoalWorktreeManager` 硬编码：
- 分支名：`goal/${goalId}`（不支持 `evolve/${proposalId}`）
- mergeBase：`main`（本仓库主分支是 `master`）
- 清理策略：archive 成功即删分支（结构演化要求失败分支保留）

**当前代码**（goal-worktree-manager.ts:46）：
```typescript
const branch = `goal/${goalId}`;
// ...
await this.git.checkout('main');
// ...
await this.git.deleteBranch(info.branch);
```

**修复方案**：
1. **参数化构造函数**：
   ```typescript
   constructor(projectDir: string, options?: {
     branchPrefix?: string;      // 默认 'goal'
     mergeBase?: string;         // 默认探测实际分支
     cleanupStrategy?: 'delete' | 'keep';  // 默认 'delete'
   })
   ```
2. **分支名参数化**：`prepare()` 接受 `branchName` 参数（覆盖默认 `${branchPrefix}/${id}`）
3. **mergeBase 自适应**：探测 `master` 或 `main`（`git symbolic-ref refs/remotes/origin/HEAD` 或 fallback）
4. **清理策略参数化**：`archive()` 接受 `cleanup?: boolean` 参数

**影响文件**：
- `gateway/src/core/engine/goal-worktree-manager.ts`（泛化）
- `tests/unit/gateway/goal-worktree-manager.test.ts`（新增测试）

### M8: Verification Window Statistical Methods（验证窗口统计方法）

**问题**：设计文档 §4.3 要求"占比类预测要求效应量门槛（变化 ≥10pp）"，但未定义具体的统计检验方法（如卡方检验、Fisher 精确检验）。

**修复方案**：
1. **Phase 2 实施时**：实现 `validator.ts` 时明确统计方法
2. **建议方法**：
   - 小样本（n < 30）：Fisher 精确检验
   - 大样本（n ≥ 30）：卡方检验或 z 检验
   - 效应量：Cohen's h 或绝对差值
3. **当前 Phase 1**：无需修改，但需在 Phase 2 设计文档中补充统计方法细节

### M9: Evolver Cron Guard Isolation（evolver cron guard 隔离）

**问题**：设计文档 §3.1 要求"evolve 用独立锁"，但当前 `pipeline-rules.ts` 的 `runPipelineGuarded` 是全局布尔锁，turn-compress 积压会让 evolver 静默缺席。

**修复方案**：
1. **Phase 2 实施时**：实现 per-action 独立 guard
   ```typescript
   const actionGuards: Map<string, boolean> = new Map();
   
   async function runActionGuarded(action: string, fn: () => Promise<void>) {
     if (actionGuards.get(action)) {
       log.info(`[Pipeline] ${action} already running, skipping`);
       return;
     }
     actionGuards.set(action, true);
     try {
       await fn();
     } finally {
       actionGuards.set(action, false);
     }
   }
   ```
2. **延迟重试**：evolver 被跳过后，延迟 30min 重试一次（`setTimeout`）
3. **当前 Phase 1**：无需修改

### M10: Rollback State Machine Completion（回滚状态机完成）

**问题**：设计文档 §4.4 要求"自动回滚写回上一版本 active.json"，但未定义回滚状态机的完整流程（如回滚失败后的处理）。

**修复方案**：
1. **Phase 2 实施时**：实现完整的回滚状态机
   ```
   active → rolling_back → rolled_back (成功)
                       ↓
                  rollback_failed (失败，需人工干预)
   ```
2. **回滚失败处理**：
   - 记录错误到 `evolution_proposals.validation_result`
   - 生成 triage item 通知人工
   - 系统继续使用当前策略（不崩溃）
3. **当前 Phase 1**：无需修改

### M11: recordOutcome Timing Fix（recordOutcome 时机修正）

**问题**：设计文档 §3.2 要求"archiveGoal 成功后 → recordOutcome(...)"，但当前实现（index.ts:4447）在 `archiveGoal` **内部**调用 `recordOutcome`，导致归档失败时 outcome 丢失。

**当前代码**（index.ts:4447）：
```typescript
const { recordGoalOutcome } = await import('./orchestration/outcome-recorder.js');
recordGoalOutcome(this.getGatewayDb(), {
  // ... 参数
});
```

**修复方案**：
1. **移动 `recordGoalOutcome` 调用到 `archiveGoal` 外部**：
   ```typescript
   try {
     await this.archiveGoal(goalId, { verdict, ... });
     recordGoalOutcome(db, { goalId, verdict, ... });
   } catch (err) {
     // 归档失败仍记录 outcome（failure_kind='archive_error'）
     recordGoalOutcome(db, { goalId, verdict: 'ERROR', failure_kind: 'archive_error', ... });
   }
   ```
2. **确保所有归档路径都调用 `recordGoalOutcome`**：
   - 成功路径 ✅
   - 失败路径 ✅（failure_kind='archive_error'）
   - 取消路径 ✅（B1 修复）

**影响文件**：
- `gateway/src/index.ts`（`archiveGoal` 方法重构）

---

## Minors（可延后处理）

1. **m1**: `goal_outcomes.created_at` 应为 goal 创建时间（已实现，从 request snapshot 读取）
2. **m2**: `goal_outcomes.archived_at` 应为归档时间（已实现，`new Date().toISOString()`）
3. **m3**: 注册表 `review.verdict_parse` 的 `currentValueSource` 应指向具体函数（当前指向文件）
4. **m4**: `evolution_proposals` 表缺少 `project_id` 字段（Phase 2 需要，可 ALTER 添加）
5. **m5**: 设计文档 §6 测试清单缺少 `outcome-recorder.test.ts` 的具体测试用例
6. **m6**: `aggregateFeedback` 扫描两个目录（`.mafw/feedback` 和 `.mafw/user-feedback`），应统一写入路径（列为已知债务）
7. **m7**: `buildFailureSignature` 的模板化逻辑可能过度归一化（如去除所有数字），需调优
8. **m8**: `goal_sessions` 表缺少 `loop` 字段的索引（查询时可能需要）
9. **m9**: 设计文档 §8 退出标准的 SQL 查询缺少 `WHERE` 条件（如时间范围）
10. **m10**: `GoalWorktreeManager` 的中文注释编码问题（显示为乱码）

---

## 实施顺序建议

### Phase 1 实施前（Blockers）
1. **B1**: 修复取消路径 outcome 接线（1-2 小时）
2. **B2**: 验证 state.sessions 数据模型兼容性（1 小时，主要是测试）
3. **B3**: 确认 Phase 2 triage 分发接口契约（文档更新，0.5 小时）

### Phase 1 实施期间（Majors）
1. **M1**: 删除漂移副本 + 注册表验证（1 小时）
2. **M2**: 实现 policySnapshot 写入（1 小时）
3. **M5**: 完善 failure_signature 实现（2 小时）
4. **M6**: ALTER TABLE 添加 requires 字段（0.5 小时）
5. **M11**: 重构 recordOutcome 调用时机（2 小时）
6. **M4**: 实现 trajectory prune 豁免（2 小时）

### Phase 2 实施前（Majors）
7. **M7**: 泛化 GoalWorktreeManager（3 小时）
8. **M8**: 补充验证窗口统计方法文档（1 小时）
9. **M9**: 实现 per-action guard（2 小时）
10. **M10**: 实现回滚状态机（3 小时）

### 可延后（Minors）
- m1-m10：在 Phase 2/3 实施期间逐步修正

---

## 验证清单

Phase 1 实施完成后，需验证：

1. ✅ 取消路径触发 `recordGoalOutcome`（verdict='CANCELLED', failure_kind='user_cancel'）
2. ✅ `onGoalCreated` 写入 `policySnapshot` 到 StateFile
3. ✅ `recordGoalOutcome` 从 `goal_sessions` 表读取 session 列表
4. ✅ `failure_signature` 包含首个错误工具名
5. ✅ `evolution_proposals` 表有 `requires` 字段
6. ✅ trajectory prune 豁免已登记 session
7. ✅ 所有测试通过（`npm test -- --runInBand --forceExit`）

---

## 下一步行动

1. **立即执行**：B1（取消路径修复）— 这是最紧急的 blocker
2. **今日完成**：B2 + B3 验证
3. **本周完成**：M1-M6 + M11（Phase 1 核心修正）
4. **下周规划**：M7-M10（Phase 2 准备工作）

需要我开始执行 B1（取消路径修复）吗？