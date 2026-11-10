# Goal 形态：同一路径上的三种模式

> 2026-11-10 · Phase P0.5（横切 Goal 入口）
> 父设计：`docs/superpowers/specs/2026-11-10-lead-techlead-thread-handoff-design.md`
> 关联：`2026-11-10-standing-goals-design.md`（长期模式）
> 目标：Goal 只有一条执行路径；Quick / Standard / Standing 是同一路径上的模式，不是第二套执行器。

## 1. 背景

现有 Goal 只有一种形态：`discussing → plan/eval → Builder → Reviewer`。这对重构、功能、跨文件修复是对的，
但用户说「改个 typo」「查一下这个 API」「跑一下这个命令」时，全套 Pod 太重。

第一版设计曾提出独立的 `quick_goals` 表 + Quick Worker；这是**错的**：

- 两套执行路径（Quick Worker / NodeDriver）会重复预算、权限、diff、审计、升级逻辑；
- 两套状态机（quick_goals / pod_goal_revisions）会分叉；
- 用户/UI 要区分「这是 Quick 还是 Standard」，又把类型判断推回给人；
- 升级（Quick → Standard）要跨表迁移，容易丢上下文。

现有代码已经有正确的接缝：**`PlanStrategy = 'quick' | 'collaborative'`**（`core/goal/plan-package.ts`）。
quick plan 只允许一个 task、不能请求 probe、跳过 plan approval、跳过独立 Reviewer，Builder 执行
（`driver.ts` / `routing.ts`）。P0.5 只需让 Tech Lead 在 triage 时选这个 strategy。

## 2. 目标 / 非目标

### 目标

- **一条执行路径**：所有 Goal 都走 `pod_goals` + `pod_goal_revisions` + NodeDriver + worktree。
- **三种模式**：`quick` / `standard` / `standing`，由 Tech Lead triage 决定。
- **Quick = strategy `quick`**：一个 task、无 probe、跳过 plan approval、跳过独立 Reviewer；Builder 执行；
  diff / 预算 / 审计 / 权限共用。
- **Standard = strategy `collaborative`**：plan approval + Builder + Reviewer。
- **Standing = 长期模板 + GoalRun**；每个 run 仍创建普通 Goal，走同一路径。
- 升级：Quick plan 发现复杂 → 同一 Goal 开新 revision、切 collaborative；不换执行器、不丢上下文。
- 用户不需要选模式；Lead 也不判断模式；只有 Tech Lead triage 写模式。

### 非目标

- 不新增 `quick_goals` 表、Quick Worker、第二套 scheduler。
- 不让 Quick 绕过权限 / sandbox / 高风险 confirm。
- 不改 NodeDriver 的 plan/execute/review 语义，只选 strategy。
- 不做 proactive auto。

### 反目标

- 两套执行路径，预算 / diff / 审计各写一遍。
- Quick 悄悄改多文件 / 高风险代码，没有 diff 审阅。
- 升级跨表迁移丢上下文。
- 用户被问「Quick 还是 Standard」。

## 3. 模型

```
User
  │
  ▼
Lead（只判断可执行；不判断模式）
  │  Work Request（discussing Goal + 当前话题）
  ▼
Tech Lead triage（写 goal_mode）
  ├─ quick    → strategy='quick'    → plan(1 task) → Builder → archive_unreviewed
  ├─ standard → strategy='collaborative' → plan/eval → approval → Builder → Reviewer
  └─ standing → StandingGoal（模板 + trigger）→ GoalRun → 同一路径
```

- `goal_mode` 存在 `pod_goal_revisions`（每次 revision 可重判；升级就是新 revision）。
- `PlanStrategy` 仍存在 plan artifact（`strategy: 'quick' | 'collaborative'`）；triage 决定它。
- 没有第二张 Goal 表；没有第二个 worker。

OS 映射：

| OS | MAFW |
|---|---|
| 进程 + 调度 | 同一 Goal / NodeDriver 路径 |
| 调度策略 / nice | `goal_mode` / `PlanStrategy` |
| 快速 syscall 路径 | quick strategy（仍在内核里） |
| daemon / cron | standing mode |
| upcall / 升级 | quick → collaborative 新 revision |

## 4. Triage 策略

### 入口：Lead 只判断「是否可执行」

Lead **不区分模式**。它只做两件事：

- 纯对话 / 解释 / 查询 → 直接回答，不建 Goal。
- 有可执行意图 → 创建 Work Request（`discussing` Goal），带当前话题上下文。

Lead 不数文件、不评估风险、不问「快还是正式」；模式标签只由 Tech Lead 写，Lead 只读展示。

### 形态：Tech Lead 判断

Tech Lead 在 `discussing` 阶段通过 triage 工具写 `goal_mode`：

- `quick`：一个 task；无 probe；plan approval auto；独立 Reviewer 跳过；
- `standard`：collaborative；plan approval；Builder；Reviewer；
- `standing`：创建 StandingGoal（模板 + trigger）；后续 run 走同一路径。

Tech Lead 内部判据（不暴露给 Lead）：

| 信号 | Quick | Standard |
|---|---|---|
| 文件数 | 0–1 | ≥2 或跨模块 |
| 动作 | 查询 / 解释 / 格式化 / typo / 单文件小改 | 功能 / 重构 / 迁移 / 依赖升级 |
| 风险 | 只读 / 低风险 | 权限 / 数据 / 安全 / 破坏性 |
| 歧义 | 低 | 中高 |
| 用户措辞 | 「快速」「顺手」「就改一下」 | 「设计」「重构」「正式」 |
| 验收 | 肉眼可验 | 需要测试 / rubric / 人工批准 |

规则：

- 不确定 → Standard（安全优先）。
- 高风险 → Standard + confirm；Quick 不允许。
- 用户显式「快点」/「走正式流程」是输入信号，最终由 Tech Lead 判断。
- `planReview: 'manual'` 强制 collaborative（现有行为）；Quick 不能手动批准。

### 执行中：升级

- Quick plan / Builder 发现：改动超出 1 个文件 / 需要计划 / 测试失败原因复杂 / 触碰高风险路径
  → 同一 Goal 开新 revision（`goal_mode: standard`，`strategy: collaborative`），保留已有 diff / 上下文。
- 不跨表迁移；不重复问；旧 revision append-only 保留。

### 用户覆盖

- Lead 可以转达 Tech Lead 的建议：「这比预想复杂，转正式？」
- 用户说「升级 / 走正式流程」→ Tech Lead 开新 revision 切 standard；说「快点」→ 仍由 Tech Lead 判断。

## 5. 数据模型

### `pod_goal_revisions` 增加列

```sql
ALTER TABLE pod_goal_revisions ADD COLUMN goal_mode TEXT NOT NULL DEFAULT 'standard';
```

- 值：`quick | standard | standing`。
- `ensureColumn('pod_goal_revisions', 'goal_mode', "goal_mode TEXT NOT NULL DEFAULT 'standard'")`，
  放在 `PodStore` 构造函数现有 `ensureColumn` 调用旁。
- `PodGoalRevisionRow` / `createGoalRevision` / `setGoalRevisionStatus` 带上 `goalMode`。
- `PodGoalView` 增加 `goalMode`，桌面显示 badge。

### Plan artifact

- 仍用现有 `PlanStrategy`；`validatePlanPackage` 校验 quick = 一个 task、无 probe。
- Triage 写 `goal_mode='quick'` 后，plan prompt / validator 强制 `strategy:'quick'`。

### Standing

- `standing_goals` / `goal_runs` 保留（P2.5）；每个 run 创建普通 Goal + revision，
  `goal_mode` 由 Tech Lead triage 决定（quick / standard）。

### 删除

- 不创建 `quick_goals` 表。
- 不新增 Quick Worker service / session scope。

## 6. Tech Lead triage：扩展现有 direction

**不新增 `mafw_goal_triage`**；扩展现有 `mafw_pod_goal_direction`，一次调用同时决定方向和模式：

```ts
interface PodGoalDirectionArgs {
  goalId: string;
  mode: 'clear' | 'needs_user' | 'decided';
  goalMode?: 'quick' | 'standard' | 'standing';
  userWords?: string;
  optionId?: string;
  options?: DirectionOptionInput[];
  reason?: string;
  sessionID?: string;
}
```

行为：

- 校验调用者是 goal-bound Tech Lead（`assertTechLeadSession`）。
- `goalMode` 缺省 = `standard`；写 revision `goal_mode`。
- `quick`：要求 `planReview !== 'manual'`；写 `goal_mode='quick'` 后照常 `clear/decided` → planning；
  plan prompt / validator 强制 quick。
- `standard`：现有行为。
- `standing`：创建 StandingGoal（P2.5）；P0.5 先返回 `501 not_supported`，不启动 planning。
- `requiresApproval` 只能加严；高风险仍 confirm。
- 记录 rationale；Lead 只读展示 badge。

## 7. 执行（复用现有）

| 模式 | plan | approval | 执行 | review |
|---|---|---|---|---|
| Quick | 1 task，无 probe，`strategy:'quick'` | 跳过（auto） | Builder | 跳过独立 Reviewer（`archive_unreviewed`） |
| Standard | collaborative，可 probe | 人工 plan approval | Builder | 独立 Reviewer rubric |
| Standing run | 由 triage 定 quick/standard | 同对应模式 | 同对应模式 | 同对应模式 |

- Quick 的 diff / 预算 / 审计 / 权限与 Standard 共用。
- Quick 不允许 `planReview:'manual'`；要人工批准就升 standard。
- Quick 不能请求 probe；发现需要调研 → 升 standard。

## 8. UI

- Goal 卡片 / GoalDetail：显示 `Quick` / `Standard` / `Standing` badge（来自 `goalMode`）。
- Lead 状态卡：只显示模式 badge + stage；不显示 session。
- 不做「Quick 任务」独立分组；同一个 Goal 列表，按模式过滤即可。
- 升级提示：GoalDetail 显示「Tech Lead 建议转正式」+ 一键。

## 9. 安全与预算

- Quick 仍受 sandbox / approval / 高风险 confirm 约束。
- Quick 预算：沿用 Goal `budget`（maxTurns / maxCostUsd）；默认更小，但不新增机制。
- Quick 的 diff 必须可审阅；不自动 merge。
- 高风险动作永不走 Quick；直接 Standard + confirm。
- 审计：同一 `pod_goals` / `pod_goal_revisions` / receipts；不新增表。

## 10. 失败模式

| 失败 | 处理 |
|---|---|
| Quick 误判复杂 | 同一 Goal 新 revision 切 standard；保留 diff / 上下文 |
| Quick plan 产出多个 task | validator 拒绝；Tech Lead 改 standard |
| Quick 触碰高风险 | 拒绝；升 standard + confirm |
| 预算耗尽 | 现有 BudgetGuard；不静默 |
| 用户不满意 | 新 revision / 打回；同一路径 |
| Lead 误判可执行 | 用户可说「先别做」；Lead 不建 Goal |
| 模式字段丢失 | 默认 `standard`；不降级安全 |

## 11. 测试与验收

### 单元

- `PodStore.ensureColumn`：旧 DB 加 `goal_mode`，默认 `standard`。
- `createGoalRevision` / `setGoalRevisionStatus`：`goalMode` 持久化。
- `mafw_goal_triage`：caller 校验、mode 枚举、rationale、requiresApproval 只能加严。
- `validatePlanPackage`：quick = 1 task、无 probe；多 task 拒绝。
- `routeAfterExecute`：quick → `archive_unreviewed`；standard → review。

### 集成

- Tech Lead triage quick → plan 1 task → Builder → 无 Reviewer → 结果。
- Quick 发现复杂 → 新 revision standard → plan approval → Builder → Reviewer。
- Standard 路径不变。
- 高风险 quick 请求 → 拒绝 / 升 standard + confirm。
- 旧 Goal 默认 `standard`，行为不变。

### GUI

- Goal 卡片 badge；GoalDetail 升级提示；无 session id。
- 900 / 1280 宽度正常。

### 指标

- Quick 占比（简单任务 >50%）；
- Quick 升级率 / 误判率；
- Quick 平均完成时间 / 成本；
- 无第二套执行路径的重复代码。

## 12. 迁移与开关

- `goal_mode` 列 migration；旧行默认 `standard`。
- 开关 `MAFW_GOAL_MODES`（默认开，灰度）；关闭时 Tech Lead 不写模式，全部 standard。
- 不创建 `quick_goals`；不迁移任何表。
- Standing Goal 仍按 P2.5 单独建表（长期模板），但其 run 走同一 Goal 路径。

## 13. 开放问题

1. **已决：扩展现有 `mafw_pod_goal_direction` 加 `goalMode`**，不新增 `mafw_goal_triage`；一次调用决定方向 + 模式。
2. Quick 的默认预算是否更小？建议沿用 Goal budget，默认值由 Tech Lead 设置。
3. Quick 是否允许 2 个 task？建议严格 1 个；多 task 升 standard。
4. Standing 的 run 是否允许 quick？建议允许，由 Tech Lead triage 决定。
