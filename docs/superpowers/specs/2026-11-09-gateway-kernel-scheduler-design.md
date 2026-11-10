# Gateway 内核重构：统一调度器（Phase B）

日期：2026-11-09
状态：已实施（2026-11-10，分支 feat/gateway-kernel-scheduler；实现注记见 §9）
前置：Phase A（`concurrency/` 模块提供原语）
关联设计：
- `2026-11-09-gateway-kernel-concurrency-design.md`（Phase A，提供并发原语）
- `2026-11-09-neutral-runtime-driver-architecture-design.md`（驱动层，另一 agent 推进）

## 1. 意图与为什么

Gateway 有 **五套互不相识的调度闸门**，没有优先级、没有抢占、没有统一公平性。所有后台任务与前台 HTTP 请求在同一事件循环竞争，保护方式是散落的 skip / coalesce / reject / drop。

具体问题：
1. **`snapshotBuildInFlight` 用 drop 保护边界路径**——本质是用丢弃代替调度优先级；
2. **cron 管线没有优先级**——decay 和 recall 同级，但紧急度不同；
3. **`actionRegistry` 是全局可变 Map**——注册时机是隐式契约，reload 时不重建；
4. **automation-engine 里 `new HarmonicIndexManager()` 创建非相干副本**——缓存一致性 bug。

**OS 原则**：一个调度器管理所有可运行实体；有优先级、有公平性、有资源上限。

## 2. 现状盘点（五套闸门）

| 调度实体 | 位置 | 触发 | 闸门语义 |
|---|---|---|---|
| `AutomationEngine` | `automation-engine.ts` | cron + eventBus | per-goal cooldown + stateVersion 去重 |
| `PipelineGuard` | `recall/pipeline-guard.ts` | 被 8 个 action 包裹 | per-key in-flight 门 + 30min watchdog |
| `SessionWorkerPool.runExclusive` | `recall/session-worker-pool.ts` L103-112 | 回合级 | single-flight 合并 |
| `RunCoordinator` | `core/run/run-coordinator.ts` | HTTP suspend/resume | `pendingSuspend` Set + 30s TTL |
| `NodeDriver` + `watchdogScan` | `core/goal/driver.ts` / `recovery.ts` | 事件驱动 + setTimeout 链 | 每 goal 互斥 + 30min 超时 |

预算（资源上限）：
- `core/budget-guard.ts`：per-session maxTurns/maxCostUsd
- `recall/pipeline-budget.ts`：LLM 管线日 USD 帽
- `core/pod/pod-budget.ts`：Pod 级 24h 滚动 USD
- `core/pod/pod-event-wake.ts`：Lead 唤醒 6 次/小时

## 3. 目标

创建 `gateway/src/scheduler/` 模块，把五套闸门收敛为 **一个统一调度入口**：

```ts
// task-descriptor.ts
interface TaskDescriptor<T = unknown> {
  /** 全局唯一 id（自动生成或显式指定）。 */
  id: string;
  /** 优先级：前台 > 中台 > 后台 > 空闲。 */
  priority: 'foreground' | 'midground' | 'background' | 'idle';
  /** 资源上限（可选）。 */
  budget?: { maxTurns?: number; maxCostUsd?: number };
  /** 并发互斥 key（可选；同 key 不并发）。 */
  mutexKey?: string;
  /** 超时强制释放。 */
  timeoutMs?: number;
  /** 同 mutexKey 重复提交时的策略。 */
  strategy: 'skip' | 'coalesce' | 'defer-to-idle' | 'queue';
}

// scheduler.ts
class Scheduler {
  submit<T>(task: TaskDescriptor<T>, fn: () => Promise<T>): Promise<T>;
  /** 手动触发后台队列扫描。 */
  sweep(): Promise<void>;
  /** 运行时统计（heartbeat / 诊断面）。 */
  stats(): { queued: number; running: number; byPriority: Record<string, number> };
}
```

## 4. 非目标

- 不改变 cron 表达式或管线频率
- 不引入 worker_threads 或子进程
- 不重构 NodeDriver 的状态机逻辑（Phase B 只管调度入口）
- 不做真正的抢占式调度（Node.js 事件循环不支持）

## 5. 设计

### 5.1 优先级映射

| 现有任务 | 统一后优先级 | 策略 |
|---|---|---|
| recall boundary 100ms 契约 | `foreground` | 无互斥 |
| serve 健康轮询 30s | `foreground` | skip |
| NodeDriver 节点执行 | `foreground` | per-goal mutex |
| RunCoordinator suspend/resume | `foreground` | pendingSuspend guard |
| PodEventWake 扫描 | `midground` | coalesce（合并 pending） |
| snapshot build | `midground` | **defer-to-idle**（不再 drop） |
| AutomationEngine cron 管线 | `background` | per-key guard + skip |
| decay / prune / sweep | `idle` | skip |

### 5.2 统一预算入口

现有三套预算（BudgetGuard / PipelineBudget / PodBudget）**不合并**——它们各自的语义正确。但 Scheduler 在 submit 时统一检查：

```ts
submit(task, fn) {
  if (task.budget) {
    const check = this.budgetChecker(task);
    if (!check.ok) return Promise.reject(new BudgetExceededError(check));
  }
  // ... proceed with concurrency/scheduling
}
```

### 5.3 automation-engine 非相干副本修复

`automation-engine.ts` L209/L217 的 `new HarmonicIndexManager(...)` 改为经 `getLiveIndexManager()` 获取（已有 provider 注入机制，只是这两个 action 漏了）。

### 5.4 actionRegistry 注册时机

- 启动时一次性装配（现有行为）
- `reloadRules()` 时**同时重建** actionRegistry（当前不重建）
- actionRegistry 从全局可变 Map 改为 Scheduler 的内部注册表

## 6. 测试策略（TDD）

- **优先级**：foreground 任务不等 background；background 任务在 foreground 忙时排队
- **策略**：skip 的不执行 / coalesce 的合并结果 / defer-to-idle 的排队 / queue 的 FIFO
- **预算**：超限拒绝 / 不重复触发
- **watchdog**：timeout 强制释放 / 释放后同 key 可再入
- **非相干副本**：automation-engine 的 action 使用 live instance（不是 new 的）
- **actionRegistry 重建**：reloadRules 后 action 可用

## 7. 验收标准

- [ ] `scheduler/` 模块存在且导出 `Scheduler` + `TaskDescriptor`
- [ ] `snapshotBuildInFlight` 的 boolean 互斥丢弃改为 defer-to-idle 排队
- [ ] automation-engine 无直接 `new HarmonicIndexManager`
- [ ] `actionRegistry` 在 `reloadRules()` 时重建
- [ ] `index.ts` 内不再有手写调度闸门（PipelineGuard / runExclusive / snapshotBuildInFlight 的 boolean 全部消费 scheduler）
- [ ] 全量测试绿
- [ ] CI 守卫：`grep -r "inflight\|Inflight\|INFLIGHT" gateway/src/` 只命中 `concurrency/` 和 `scheduler/`

## 8. 留给 builder 的决定

- `defer-to-idle` 的判定条件（当前设想是"事件循环空闲 + 无 foreground 在飞"）
- Scheduler 是否暴露为 HTTP 诊断端点（`/api/scheduler/stats`）
- cron 管线的优先级是每条规则声明还是全局推断

## 9. 实现注记（2026-11-10，Phase B 落地时的裁决）

- **defer-to-idle 判定**：实现为「无 foreground 任务在飞」（`foregroundInFlight === 0`，
  pump 时评估）。Node 无法观测事件循环空闲，完整 idle 语义不可实现；快照构建场景下
  该条件已足够（foreground 在飞≈有交互方在等）。
- **HTTP 诊断端点**：本批不做（路由目录→openapi→SDK 契约链成本不值得），`stats()`
  公开可编程消费；Phase D 诊断面合并时统一暴露。
- **cron 优先级**：全局推断（cron/event → background；user/llm 触发 → foreground——
  交互方在等）。per-rule 声明等规则文件获得 priority 字段后再做。
- **skip 语义**：以 `TaskSkippedError` rejection 表达（非 Guard 的 null 返回）——
  吸取 Phase A M3 的 null 混淆教训；新 API 无历史包袱。
- **边界 recall 不进 scheduler**：100ms 硬契约路径零改动（零新增延迟风险）；
  后果是 defer-to-idle 在生产中由 user/llm 触发的 automation 充当 foreground 消费方。
- **runExclusive 不迁移**：per-session promise-dedup 是并发原语（Phase A 已统一到
  Singleflight），不是调度闸门；路由进全局优先级队列会在并发帽下引入本不存在的
  排队延迟。验收标准中它的条目由 Phase A 的统一达成。
- **NodeDriver / RunCoordinator / PodEventWake 不迁移**（§4 非目标 + pod 域另一
  工作流活跃）：Phase B2 跟进。
- **CI 守卫偏差**：§7 的字面 repo-wide `grep inflight` 无法通过（命中 discovery/
  driver 变量名/另一 agent 活跃文件）；实际守卫按「已迁移文件不得回潮手写闸门」
  的模式钉扎（`gateway/tests/unit/concurrency/regression-guard.test.ts`）。
- **memory:prune 同类修复**：§5.3 只点名 HarmonicIndexManager，但 prune 的
  `new CognitiveGraphManager` 是同一 bug 类（live 实例在 `MemoryService.cognitiveGraph`），
  经 `setGraphProvider` 一并修复。
- **budget 准入为增量**：管线内部 per-LLM-call 检查保留（更细粒度）；scheduler 层
  只是把「跑起来才拒绝」提前为「不启动」，名称与内部 `allow()` 完全一致
  （同一 PipelineBudget 实例，同一天只打一条 deny 日志）。

## 9.1 B2 收口（2026-11-10）

- **5 个 review minors 修复**：M1 `Promise.resolve(fn())` 非 promise 防御、M2 task id
  序号化（`_actionSeq`，Date.now() 1ms 内可撞）、M3 `executeAction` 返回
  `ActionRunStatus`（ran/skipped/timeout/denied/error/missing），`runRuleFromLLM` 消息
  如实反映状态、M4 非 Error throw 的 instanceof 对齐、M5 `maxConcurrent` 钳到 ≥1。
- **NodeDriver mutex → MutexQueue**（`advance` + `withGoalMutex`，+ `MutexQueue.has()`）：
  事件驱动完成模型不适配 scheduler 任务模型，裁决只做原语统一。
  **有意的偏差（终审确认）**：旧 promise-chain 下，`withGoalMutex` 操作 reject（如
  approvePlan 抛 `stale_plan`——正常路径）会「毒化」其后的排队 advance——旧链的
  `.then(() => advanceInner)` 直接跳过 advanceInner 并写一条伪 `driver:` lastError；
  MutexQueue 修复了该毒化，排队的 advance 总是执行。此为改进，无调用方依赖旧行为。
- **PodEventWake scan coalesce**：`runScan` 注入（scheduler midground + coalesce），
  关闭定时器与 notify 并发的双投递竞态。已知边界：midground 扫描在 4 个 background
  槽全忙时可延迟数分钟（60s 定时器重试，事件保持 pending，不涨 wakeAttempts）。
- **RunCoordinator / serve watchdog 不迁**：前者是 409 冲突契约 + 状态机转移，
  后者是带超时的探针循环——都不是调度闸门。
