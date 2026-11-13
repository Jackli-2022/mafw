# Phase 5 剩余范围（automation / goal / storage）

- 日期：2026-11-13
- 状态：介绍 + 范围建议；尚未实现
- 前置：embedding/reranker 已交付，memory 固定为产品能力
- 相关：`docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md` §Phase 5、`docs/research/2026-11-13-phase5-stateful-capabilities-review.md`

## 1. 当前进度

| 能力 | 状态 | 结论 |
|---|---|---|
| memory store/retrieval | 已关闭 | 产品能力，不做 provider、不改逻辑、不分区 |
| embedding/reranker | 已交付 | 模型/API/本地/策略可换；memory 核心不变 |
| automation trigger/action | 未做 | action provider 已有（Phase 2），但未接 live；trigger 仍是闭合 union |
| goal eval/executor | 未做 | `GoalEval` 是纯产品契约；NodeDriver / 路由 / 人类验收固定 |
| storage backend | 未做 | `StorageBackend` 是 async 死接口，无消费者 |

## 2. Automation trigger/action

### 现状

- `gateway/src/automation-engine.ts`：
  - `Trigger = CronTrigger | EventTrigger`（闭合 union）。
  - `CronTrigger { schedule, timezone }`；`EventTrigger { on: string[], perGoalCooldown }`。
  - 引擎拥有 `CronJob` 调度、`eventBus` 监听、cooldown、`stateVersion` 去重、scheduler 预算、`SchedulerLedger`。
  - `ActionHandler` 通过 `registerAction()` 注册；内置 `memory:decay` / `memory:review` / `memory:prune`。
- `gateway/src/kernel-v2/providers/automation.ts`：
  - 已有 `AutomationActionProvider` / `createAutomationCapability()` / conformance kit。
  - 但只存在于 kernel-v2 测试台，live `AutomationEngine` 没有使用它。
- 插件包事件是 `plugin:<pkg>:*`，目前不自动进入 automation 的 `eventBus` trigger 面。

### 剩余工作

1. **Action provider 接 live**
   - `AutomationEngine` 的 action 解析改成通过 `AutomationCapability`（或注入 resolver）。
   - 默认 builtin actions 保持；包 action 通过 registry 注册；失败/缺失 fail-closed 到 `missing`/`failed`，不拖垮 scheduler。
   - 保留 `memory:decay` / `memory:review` / `memory:prune` 的批量写与 budget 语义。

2. **Trigger 只提供定义/事件，不拥有 timer**
   - 推荐新增 `AutomationTriggerSource`：provider 只产出 `{ event, goalId?, payload? }` 或 trigger 定义。
   - cron 解析、CronJob、eventBus、cooldown、stateVersion、budget、enable/disable 仍由 core `AutomationEngine` 拥有。
   - 不允许 provider 持有全局 timer/interval，避免 dispose 泄漏、重复调度、绕过 budget。

3. **插件事件桥接（先决策）**
   - 如果希望包事件触发 automation，需要把 `plugin:<pkg>:*` 事件送入 `eventBus` 或 trigger source。
   - 这可能是比“trigger provider”更小的实现：bridge 只做事件转发，不新增调度权。

### 风险

- provider 拥有 timer → 泄漏/重复执行/绕过 budget。
- 事件桥接没有 goalId/去重 → 同一事件重复触发。
- action provider 缺 live wiring → 又一个“测试台可替换、产品未接线”的假 seam。

### 建议顺序

先做 **action live wiring + plugin event bridge**，再决定是否需要 trigger provider。多数“新 trigger”需求可以通过事件桥接满足，不必开放 timer 所有权。

## 3. Goal eval / executor

### 现状

- `gateway/src/core/goal/goal-eval.ts`：`GoalEval` 纯类型 + `validateGoalEval()`，要求 outcome、至少一个 required condition、每条 condition 有 evidence/method、mapping 只引用真实 condition。
- `gateway/src/core/goal/node-names.ts`：`ExecutableGoalNode = 'plan' | 'probe' | 'execute' | 'review'`；`GoalNodeName` 还包含 `askUser` / `await_plan_approval` / `archive_*`。
- `gateway/src/core/goal/routing.ts`：路由纯函数，状态机由 NodeDriver 持有。
- `gateway/src/core/goal/driver.ts`：节点建会话、prompt、artifact 校验、review、human approval、`planHash`/`evalHash` 绑定。
- 人类验收、Review 逐 task/逐 condition 证据、PASS 不自动 merge 都是硬不变量。

### 选项

**A. GoalEval hook（推荐先做）**

- provider 接收 `{ goalEval, plan, taskResults, evidence }`，返回逐 condition 的 `{ passed, evidence }`。
- core 校验：required condition 全覆盖、证据非空、不得漏项、不得把缺失当 PASS；human accept 仍由人完成。
- 纯函数/可测试，不影响 NodeDriver 状态机。

**B. 现有节点的 executor**

- provider 实现 `plan/probe/execute/review` 的“执行器”，但节点名、路由、artifact 校验、状态机不变。
- 适合换 agent/prompt/模型，不适合新增编排语义。
- 风险高于 A，收益取决于是否有真实替换需求。

**C. 新节点名（不推荐）**

- 会同时影响 routing、artifact 路径、prompts、identity、watchdog、recovery、timeline、desktop 泳道、state v3。
- 等于重做 Goal 编排扩展面，超出 Phase 5 收益。

### 建议

先做 **A（GoalEval hook）**；只有出现“同一节点要换执行器”的真实需求再做 B；不做 C。  
NodeDriver、路由、人类验收、`planHash`/`evalHash`、artifact 校验、review rubric 全部留在 core。

## 4. Storage backend

### 现状

- `gateway/src/core/storage/types.ts`：`StorageBackend` 全是 `Promise` 接口。
- `FileStorage` / `SQLiteStorage` 有实现，但**没有消费者**。
- gateway 实际使用同步 `better-sqlite3`；memory 的 T1 向量也用 SQLite BLOB。

### 选项

**A. 删除（推荐）**

- 删除 `StorageBackend` / `FileStorage` / `SQLiteStorage`。
- Phase 5 不做通用 storage provider；未来有真实需求时再设计 `BlobStore` / `ArchiveStorage`。

**B. 只做非热路径 port**

- 仅用于导出、快照、审计归档、冷备份。
- 不进入 `searchScored` / boundary recall。
- 明确事务、迁移、并发语义，单独命名，不叫 `StorageBackend`。

**C. 把 gateway.db 整体 port 化（拒绝）**

- 会破坏 100ms recall 和同步 SQLite 语义，迁移/回滚复杂一个数量级。

### 建议

**选 A：删除死接口。** 如果未来确实要“存储后端插件”，先按实际场景设计窄接口，不要为死代码造抽象。

## 5. 建议的剩余 Phase 5 顺序

| 子阶段 | 内容 | 估算 |
|---|---|---|
| **5.4 Automation live wiring** | action provider 接 live；plugin event bridge；trigger 只发事件 | 1–2 周 |
| **5.5 GoalEval hook** | 逐 condition 评估 + 证据；human accept 不变 | 1 周（可选） |
| **5.6 Storage cleanup** | 删除 `StorageBackend` 死接口 | 0.5 周 |
| **5.7 G5 drill** | 剩余 provider 的切换/回滚/性能演练 | 1 周 |

如果 automation 只做事件桥接、goal 暂不做、storage 删除，剩余工作量可以压到 **2–3 周**，而不是路线图原来的 6–8 周。

## 6. 需要先定的决策

1. Automation action 是否接 live？如果接，包 action 的权限/审计怎么做？
2. 插件事件是否允许触发 automation？如果允许，走 `eventBus` bridge 还是 trigger provider？
3. Goal 只做 GoalEval hook，还是也要现有节点 executor？是否明确不开放新节点名？
4. `StorageBackend` 删除还是保留为非热路径 port？

## 7. 结论

剩下的 Phase 5 不应该继续“把所有东西 provider 化”：

- **automation** 值得做，但核心是 live wiring + 事件桥接，不是把 cron 交给 provider。
- **goal** 只值得做 GoalEval hook；状态机和人类验收不动。
- **storage** 建议直接删除死接口，不做通用后端。

这样 Phase 5 可以从“6–8 周的有状态迁移”收敛成“2–3 周的剩余接线 + 清理”，风险也低得多。
