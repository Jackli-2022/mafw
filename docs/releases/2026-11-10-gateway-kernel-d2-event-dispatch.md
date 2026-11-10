# 2026-11-10 · Gateway 内核 D2 事件分发表（event-dispatch）

- **分支**：`feat/gateway-kernel-d2-event-dispatch`（base `1783c9b3`）
- **计划**：`docs/superpowers/plans/2026-11-10-gateway-kernel-d2-event-dispatch.md`
- **设计**：`docs/superpowers/specs/2026-11-09-gateway-kernel-microkernel-design.md`
  §5.3（拓扑主口径）/ §5.4（seq 空间——降级为「文档 + 测试钉扎」，见 D2-R4）
- **过程记录**：`.superpowers/sdd/2026-11-10-gateway-kernel-d2-event-dispatch/`
  （`progress.md` 台账 + `task-1-2-report.md` / `task-3-report.md` / `task-4-report.md`）

## 交付内容

- **`handleRuntimeEvent` 抽表**：index.ts 里 277 行、~24 块顺序敏感 if 链 → 6 行
  delegator + 37 行 `buildDispatchCtx()`（全 live getter）；链体逐字搬进
  **`gateway/src/runtime/event-dispatch.ts`**。index.ts 净减 ~230 行 + 8 个失效 import。
- **24 段有序表**（`DISPATCH_STAGES`；数组位置即执行顺序，Ruling D2-R1）：
  `nativeDrop → toolPrimitiveDrop → malformedWarn → unknownTypeTelemetry →
  enrichToolIdentity → conformanceTap → goalActivity → turnStartedBusy →
  backgroundJob → approvalPolicy → permissionEnrich → questionRequest →
  identityClearTurn → autoCheckpoint → terminalCleanup → internalFilter →
  partDeltaLog → sessionActivity → trajectoryHandle → compactionFlush →
  budgetStep → modeBDelta → turnIdleAggregate → finalBroadcast`。
- **恰好三段 HALT**（legacy 的 `return`）：`nativeDrop`（`RUNTIME_NATIVE_DROPPED`）、
  `toolPrimitiveDrop`（`TOOL_PRIMITIVE_TYPES`）、`internalFilter`（memoryWorker 链中
  丢弃，仅 turn 三终态放行）。HALT 停掉全部下游 stage。
- **等价契约**：`matches` = legacy 块级 if、`run` = 块体逐字（`this.x` → `ctx.x()`）；
  **零 await**（approval `evaluate` 保持同步，autoCheckpoint / compact flush / queue
  flush 仍 fire-and-forget）；**不加 pipeline 级 try/catch**（legacy 没有，段内各自
  fail-open）。golden（event-replay / opencode-neutral-golden / broadcast-seq /
  event-flow-matrix / idle-attribution）全绿 = 行为等价网。
- **拓扑 + 行为钉扎**：`tests/unit/runtime/event-dispatch.test.ts` 33 条，覆盖 5 条
  Review Focus（内部会话 drop 语义 / 派生先于 passthrough / 终态 4 步微观次序 /
  审批同步 / enrich 先于 tap 快照）+ 矩阵交叉校验 + 恰好三段可 halt。
- **seq 空间钉扎**（D2-R4）：`tests/unit/events/broadcast-seq.test.ts` 新增一条
  「eventBus 扁平发射 → `broadcast()` → `eventStore.append`」混合序列断言
  （扁平 ×2 + 信封 = seq 1/2/3，同一条单调空间）。
- **边界守卫**：`tests/unit/runtime/architecture-boundaries.test.ts` 新增两段——
  `index.ts` 不再含链体（`enrichToolIdentity(` / `applyApprovalPolicy(` /
  `enrichPermissionEvent(` / 两个丢弃门 `.has(` 缺席），只留
  `normalizeOpencodeEvent → runEventPipeline` 接线点；`event-dispatch.ts` 是链体唯一家。
- **注释 / 文档清扫**（Ruling D2-R5）：stale `handleOpencodeEvent` 源码注释 10 处
  （Task 2/3）+ `docs/architecture/{runtime,memory,desktop,goal}.md` 7 处（4 个文件；
  台账预估 6，实际 7）+ `conformance-scenarios.ts:13` 的存量模块指针（`index.ts
  enrichToolClass` → `event-dispatch.ts enrichToolIdentity 段，stage 5`）。

## 本波提交

| # | hash | 内容 |
|---|---|---|
| 1 | `c69bb00d` | `test(gateway): D2 stage-order guard (RED)` — 8 条拓扑守卫，模块缺失即红 |
| 2 | `45ba1809` | `refactor(gateway): extract handleRuntimeEvent into ordered stage table (D2 Task 2)` — 24 段逐字抽取 + comment sweep + 3 个 stale scanner 重指 |
| 3 | `cb12aede` | `test(gateway): pin D2 dispatch topology + drop semantics + recover terminal-set pin (D2 Task 3)` — 30 条（8 + 22 新增）+ 1 条恢复的 `TURN_TERMINALS` 钉子 |
| 4 | `e3af5954` | `test(gateway): harden D2 dispatch pins — sentinel, halt set, exported TURN_TERMINALS (D2 Task 4)` — 断言硬化 + seq 空间钉 + 边界守卫 |
| 5 | 本提交 | `docs(gateway): D2 closeout` — docs 四文件 sweep + `gateway.md` 现状段 + `conformance-scenarios.ts` 指针 + 本记录 |

Task 3 的「23 条 pins」= 22 条新增 + 1 条恢复的 `TURN_TERMINALS` 定义钉子；加上 Task 1
的 8 条，`event-dispatch.test.ts` 在 Task 3 结束时是 30 条。

## 裁决（D2-R1..R5）

- **D2-R1**：表的顺序 = **数组位置**（单一事实源）；不加冗余 `order: number`，拓扑断言
  用 `stageIndex(name)` 比较。spec §5.3 的 `event → handler → order` 草图按此修正
  （现实是 facet/state 门控 pipeline：一个事件命中约 10 段）。
- **D2-R2**：`EVENT_FLOW_MATRIX` **不加拓扑列**（它只管 per-type 处置）；拓扑归 stage 表，
  两者的一致性由矩阵交叉校验测试钉住（丢弃门命中集 == 矩阵声明的丢弃集）。
- **D2-R3**：五条只写在注释里的次序契约（approval 先于 internal drop / tap 先于 internal
  过滤 / checkpoint 先于 memoryWorker 早退 / terminal 4 步微序 / 派生先于 passthrough）
  全部变成具名可执行断言。
- **D2-R4**：spec §5.4 **降级**——broadcast seq 空间**已经统一**（`broadcast()` 是
  EventStore 唯一 sink；`FLAT_EMITTERS` 扁平发射与 `mafw_event` 信封共用一个 append
  计数器），D2 只做「文档 + 测试钉扎」。**eventBus 是内部 ingress**；**全量消费者迁移**
  （automations / startGoal / advance 改为从 EventStore 回放）另立 spec —— 需要幂等设计
  + 不受 retention 裁剪的影子流（`event_log` 会 prune，今天的消费者不是幂等的）。
- **D2-R5**：`handleOpencodeEvent` → `handleRuntimeEvent` 的 stale 名称清扫（改名发生在
  `e46a75fa`，注释从未跟随）；含 docs 四文件与存量模块指针。

## 测试与门禁

| 门禁 | 结果 |
|---|---|
| `npx tsc --noEmit -p tsconfig.json`（gateway） | **rc=0** |
| `npx jest tests/unit/runtime/ tests/unit/events/ tests/unit/architecture/ tests/unit/routes/conformance.test.ts --no-coverage` | **164 suites / 1543 tests passed, 0 fail** |
| Task 2 全量 sweep（`tests/unit` + `tests/integration`） | **731 suites / 5687 tests passed, 0 fail** |
| SDK contract（`packages/gateway-sdk`） | **4/4 pass** |

Task 4 的断言增量：`event-dispatch.test.ts` 30 → **33**（+3：sentinel 无管线兜底、
halt 集合恰为三段、`nativeDrop < toolPrimitiveDrop`）；`broadcast-seq.test.ts`
8 → **10**（+2）；`architecture-boundaries.test.ts` 29 → **31**（+2）；
`queue-busy-wiring.test.ts` 保持 5（`TURN_TERMINALS` 钉子由源码正则改为读导出值）。

## 简报证伪（brief falsification，记录为真实行为）

Task 3 简报断言「approval `evaluate` 抛错会立刻冒出 `runEventPipeline`（legacy 语义：
throw 断链）」。**源码不是这样**：`applyApprovalPolicy` 把整段评估包在 try/catch 里
（`core/approval/hook.ts:23`，catch 在 `:57-60`，「evaluate failed (fail-open → human)」），
抛错被吞、不富化 `props.mafwPolicy`、链继续到 passthrough 广播。实现者钉了**真实行为**
而不是简报：

1. `a thrown evaluate is fail-open inside the hook: chain still completes`——
   `not.toThrow()`、`properties.mafwPolicy` undefined、passthrough 仍广播；
2. `the pipeline itself has no try/catch`——改用**哨兵段**（临时 push 必抛 stage，
   `try/finally` 弹出）直接钉管线级无兜底；另有 `sessionActivity` 抛错版钉子覆盖
   「抛错即断链、下游不执行」。

若后续要让 approval 层改为传播异常，那是**行为变更**（会破 `applyApprovalPolicy` 的
「宁多问不误放行」fail-open），需单独立项。

## 遗留 / 后续

- **D3（boot / kernel 抽取）**：`broadcast()`、`setupEventBus()`、`subscribeToEvents()`、
  `emitNodeEvent`、RuntimeBus 一律未动（`broadcast-seq.test.ts` 的 index.ts 源码钉子仍
  解析得到）。
- **全量事件消费者迁移**：另立 spec（幂等 + 影子流），D2 不承诺。
- 已知边界：`matches` → `run` 的 TS 窄化用 `as` 重新取形（`DispatchStage` 签名无 per-run
  memo），语义不变；`isMemoryWorker` 在 4 个使用点重算（链同步，与 legacy 局部变量等价）。
