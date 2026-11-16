# Event-centric Workflow 阶段计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把事件层从“通知侧车”升级为 MAFW 的集成中心：所有跨角色事实先进入统一事件面，Lead / Tech Lead / human / memory / desktop 都从同一事实投影；NodeDriver 仍是确定性执行权威。

**Architecture:** 分四阶段推进。Phase 1 先统一 Lead inbox/outbox（立刻消除 `PodEventWake` 与 decision outbox 两条唤醒路径）；Phase 2 引入 Goal lifecycle domain events + 读模型投影；Phase 3 把 NodeDriver 历史变成 append-only event history + snapshot；Phase 4 把 P2.4 外部事件层并入同一条 domain event 面。每个阶段都保持可运行、可回滚。

**Tech Stack:** TypeScript / Node、better-sqlite3、Jest、SolidJS desktop、SSE。

**Spec:**
- `docs/research/2026-11-16-event-layer-as-center.md`
- `docs/research/2026-11-16-always-on-agents-event-layer-research.md`
- `docs/architecture/events.md`
- `docs/architecture/gateway.md`
- `docs/architecture/goal.md`
- `docs/architecture/pod.md`

## Global Constraints

- **不改 NodeDriver 的执行语义**：确定性状态机、重试、watchdog、独立 Reviewer、human-only 验收都保留。
- **不做全量 event sourcing**：Phase 1-2 只做 event-centric integration；Phase 3 才做 workflow Event History + snapshot。
- **不做大爆炸迁移**：每个 Phase 必须独立可运行、可回滚；数据库迁移只做 additive。
- **事件只描述事实，不当命令用**：`goal.created` / `state_change` 这类“事件即命令”的路径在新代码中改成显式 command。
- **at-least-once + 幂等**：所有消费者按 `eventId` / dedupeKey 幂等；不追求 exactly-once。
- **人类注意力是预算**：p1 / p2 / p3 分级、去重、合并、最小间隔；不能把所有事件都推给 Lead。
- **权限不因事件层而放松**：验收、计划批准、方向裁定、审批、purge 仍是 human-only。
- **每阶段结束必须更新 docs/architecture 与 docs/releases，并记录 commit hash。**
- **不 push、不 merge、不发布**，除非用户明确批准。

## Review Focus

这些是 spec 没写死、但最容易被实现者做错的地方；每个都要在对应任务里加测试。

1. **重复投递**：同一 `pod_events` 行同时被 `PodEventWake` 和 decision outbox 投递 → Lead 收到两次。
2. **双写丢失**：Pod/Goal 状态已更新、outbox 未写入（或反之）→ 事件与状态不一致。
3. **重放副作用**：replay 时再次调用 LLM / 发 Lead 消息 / 写 memory。
4. **audience 错路由**：`goal.failed` 只到 human inbox、没唤醒 Lead；或 internal 事件被推到 human。
5. **human-only 绕过**：事件消费者自动 accept / merge / purge，绕过人类门。

---

## 阶段总览

| Phase | 主题 | 交付物 | 退出标准 | 风险 |
|---|---|---|---|---|
| **1** | 一个 Lead inbox/outbox | PodEventWake 只入 outbox；LeadOutbox 统一批量/预算/重试 | Pod event 与 decision 共用一条 outbox；无直接 `promptAsync`；重复率 0 | 中：现有 PodEventWake 预算/测试要迁移 |
| **2** | Goal lifecycle domain events + 投影 | `domain_events` 表、Goal 事件生产、GoalView/attention 投影 | replay 一个 Goal 得到同一 GoalView/attention；state+event 同事务/outbox | 高：跨文件/DB 迁移 |
| **3** | Event History + snapshots | NodeDriver append-only history + snapshot + replay | 任意节点崩溃/重启可从 history 恢复；replay 不重复 side effect | 高：NodeDriver 改造 |
| **4** | 外部事件层统一 | P2.4 source/trigger 产出 domain events；一条 inbox/outbox | GitHub/cron/Pod 事件共用同一投递面；旧语义下线 | 中：外部事件去重/线程投影 |

> 本计划详细到 Phase 1 的 task 级；Phase 2-4 先给交付物、候选 task、验收测试，进入该阶段前再展开成独立 task 计划（避免在未验证 Phase 1 前写死后续接口）。

---

## Phase 1：一个 Lead inbox/outbox

**目标：** `pod_events` 和 decision 都只写入 `event_outbox`；由 `LeadOutbox` 唯一负责批量、预算、最小间隔、重试、sent/failed 记录。

**现状：**
- `deliverContext` 已写 `LeadOutbox.enqueueDecision`；
- `PodEventWake.scanInner` 仍然直接 `promptAsync`，有自己的 6/hour + 10min 去重；
- 两条路径互不知道对方是否已经叫过 Lead。

### Task 1：Lead outbox payload 支持 pod-event

**Files:**
- Modify: `gateway/src/core/lead/lead-outbox-model.ts`
- Modify: `gateway/src/core/lead/lead-outbox.ts`
- Test: `gateway/tests/unit/lead/lead-outbox-model.test.ts`
- Test: `gateway/tests/unit/lead/lead-outbox.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LeadOutboxKind = 'decision' | 'pod-event'

  export interface LeadOutboxPayload {
    kind: LeadOutboxKind
    priority: 'p1' | 'p2' | 'p3'
    text: string
    podId: string
    goalId: string | null
    recordId: string   // decision recordId 或 pod event id
    createdAt: string
  }

  // LeadOutbox
  enqueuePodEvent(input: {
    podId: string
    eventId: string
    text: string
    goalId?: string | null
    priority?: 'p1' | 'p2' | 'p3'
  }): EventOutboxRow
  ```
- dedupeKey：decision 仍是 `decision:<recordId>`；pod-event 是 `pod-event:<eventId>`；channel 仍是 `lead:<podId>`。

- [ ] **Step 1: 写 failing test（payload 解析 + 渲染）**

在 `lead-outbox-model.test.ts` 加：
```ts
test('parses a pod-event payload and renders a mixed batch', () => {
  const decision = row({ kind: 'decision', recordId: 'dec_1', text: '[LEAD EVENT] decision' })
  const pod = row({ kind: 'pod-event', recordId: 'evt_1', text: '[POD EVENT] failed' })
  expect(leadOutboxPayload(decision)).toMatchObject({ kind: 'decision' })
  expect(leadOutboxPayload(pod)).toMatchObject({ kind: 'pod-event' })
  const text = renderLeadOutboxBatch([decision, pod])
  expect(text).toContain('2 条待确认')
  expect(text).toContain('[LEAD EVENT] decision')
  expect(text).toContain('[POD EVENT] failed')
})
```
（`row()` 是测试内已有的 outbox row 构造 helper；没有就按 `EventOutboxRow` 形状补一个。）

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/lead/lead-outbox-model.test.ts --runInBand --forceExit`
Expected: FAIL，`leadOutboxPayload` 对 pod-event 返回 null。

- [ ] **Step 3: 实现 payload 扩展**

`lead-outbox-model.ts`：
- `LeadOutboxPayload.kind` 改联合类型；
- `leadOutboxPayload` 接受 `'decision' | 'pod-event'`；
- `renderLeadOutboxBatch`：`text` 用 payload 原文；多条时若全部为 pod-event，前缀 `[POD EVENT]`，否则 `[LEAD EVENT]`；每条 block 保持 `--- N --- <recordId>`。

- [ ] **Step 4: 跑 test 确认通过**

Run: `cd gateway && npx jest tests/unit/lead/lead-outbox-model.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: 写 enqueuePodEvent 的 failing test**

在 `lead-outbox.test.ts` 加：
```ts
test('enqueuePodEvent dedupes by event id and dispatches with decisions', async () => {
  const h = harness()
  h.lead.enqueuePodEvent({ podId: 'pod1', eventId: 'evt1', text: '[POD EVENT] failed', goalId: 'g1', priority: 'p1' })
  h.lead.enqueuePodEvent({ podId: 'pod1', eventId: 'evt1', text: '[POD EVENT] failed', goalId: 'g1', priority: 'p1' })
  h.lead.enqueueDecision({ podId: 'pod1', recordId: 'rec1', text: '[LEAD EVENT] decision' })
  expect(h.store.listOutbox()).toHaveLength(2)
  await h.lead.dispatch()
  expect(h.promptAsync).toHaveBeenCalledTimes(1)
  expect(h.promptAsync.mock.calls[0][0].text).toContain('[POD EVENT] failed')
  expect(h.promptAsync.mock.calls[0][0].text).toContain('[LEAD EVENT] decision')
})
```

- [ ] **Step 6: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/lead/lead-outbox.test.ts --runInBand --forceExit`
Expected: FAIL，`enqueuePodEvent is not a function`。

- [ ] **Step 7: 实现 `enqueuePodEvent`**

`lead-outbox.ts` 复用 `insertChannel` + `outbox.enqueue`：
```ts
enqueuePodEvent(input): EventOutboxRow {
  const now = this.deps.now()
  const channelId = `lead:${input.podId}`
  this.deps.store.insertChannel({ id: channelId, threadId: '*', kind: 'chat', address: { podId: input.podId }, now })
  return this.deps.outbox.enqueue({
    channelId,
    dedupeKey: `pod-event:${input.eventId}`,
    payload: {
      kind: 'pod-event',
      priority: input.priority ?? 'p2',
      text: input.text,
      podId: input.podId,
      goalId: input.goalId ?? null,
      recordId: input.eventId,
      createdAt: now,
    },
  })
}
```

- [ ] **Step 8: 跑 test 确认通过并提交**

Run: `cd gateway && npx jest tests/unit/lead/lead-outbox-model.test.ts tests/unit/lead/lead-outbox.test.ts --runInBand --forceExit`
Expected: PASS。

```bash
git add gateway/src/core/lead/lead-outbox-model.ts gateway/src/core/lead/lead-outbox.ts gateway/tests/unit/lead/lead-outbox-model.test.ts gateway/tests/unit/lead/lead-outbox.test.ts
git commit -m "feat(lead): support pod events in the unified outbox"
```

### Task 2：PodEventWake 变成 outbox producer

**Files:**
- Modify: `gateway/src/core/pod/pod-event-wake.ts`
- Modify: `gateway/src/core/pod/pod-event-service.ts`（新增 `markWakeQueued`）
- Test: `gateway/tests/unit/pod/pod-event-wake.test.ts`

**Interfaces:**
- `PodEventWakeDeps` 收敛为：
  ```ts
  export interface PodEventWakeDeps {
    events: {
      pendingWakes(podId?: string): PodEventRow[]
      markWakeQueued(id: string, outboxId: string): void
      markWakeSuppressed(id: string): void
      markWakeAttempt?(id: string): void
    }
    enqueue(input: {
      podId: string
      eventId: string
      goalId?: string | null
      text: string
      priority?: 'p1' | 'p2' | 'p3'
    }): { id: string } | Promise<{ id: string }>
    isPodPaused(podId: string): boolean
    now?(): number
    runScan?: (fn: () => Promise<PodEventWakeResult>) => Promise<PodEventWakeResult>
  }
  ```
- 删除 `leadMemberId` / `ensureLead` / `isBusy` / `isSuspended` / `promptAsync` / `deliveryDelivered` / `commitDelivered` / `budget`。
- 新增 `PodEventService.markWakeQueued(id, outboxId)`：写 `wake_state='delivered'`、`wake_session_id='outbox:<id>'`、`wake_at=now`（不新增列）。

- [ ] **Step 1: 重写 failing test 的 harness**

`pod-event-wake.test.ts` 的 harness 改成：
```ts
const enqueued: any[] = []
const queued: Array<[string, string]> = []
const wake = new PodEventWake({
  events: {
    pendingWakes: () => over.pending ?? [ev()],
    markWakeQueued: (id, outboxId) => queued.push([id, outboxId]),
    markWakeSuppressed: () => {},
    markWakeAttempt: () => {},
  },
  enqueue: over.enqueue ?? (async (input) => {
    enqueued.push(input)
    return { id: `outbox_${enqueued.length}` }
  }),
  isPodPaused: () => over.paused ?? false,
  now: () => over.now ?? 1_000_000,
  runScan: over.runScan,
})
```
断言：
```ts
test('enqueues every pending event and marks it queued', async () => {
  const h = harness({ pending: [ev({ id: 'e1' }), ev({ id: 'e2' })] })
  const out = await h.wake.scan('p')
  expect(h.enqueued.map((item) => item.eventId)).toEqual(['e1', 'e2'])
  expect(h.queued).toEqual([['e1', 'outbox_1'], ['e2', 'outbox_2']])
  expect(out.delivered).toBe(2)
})

test('paused pod leaves events pending', async () => {
  const h = harness({ paused: true })
  await h.wake.scan('p')
  expect(h.enqueued).toHaveLength(0)
})

test('enqueue failure leaves the event pending', async () => {
  const h = harness({
    pending: [ev({ id: 'e1' })],
    enqueue: async () => { throw new Error('offline') },
  })
  await h.wake.scan('p')
  expect(h.queued).toHaveLength(0)
})
```
（按实际 harness 形状调整；关键是断言 enqueue + markWakeQueued，不再断言 prompt。）

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/pod/pod-event-wake.test.ts --runInBand --forceExit`
Expected: FAIL（旧 harness 仍用 `promptAsync`，新接口不存在）。

- [ ] **Step 3: 实现 producer**

`pod-event-wake.ts`：
- `scanInner` 只按 `pendingWakes`、`isPodPaused` 过滤；
- 对每个 event 调 `enqueue`，生成单条文本 `renderPodEvent(event)`；
- 成功后 `markWakeQueued(event.id, outbox.id)`；
- 失败保持 pending（不 mark）；
- 删除 budget/dedupe/Lead session 逻辑；
- `renderPodEvent` 复用现有 `[POD EVENT]` 标题、`goal=... kind=...`、title/summary/message 行。

`pod-event-service.ts`：
```ts
markWakeQueued(id: string, outboxId: string): void {
  this.deps.store.updateEventWake(id, {
    wakeState: 'delivered',
    wakeSessionId: `outbox:${outboxId}`,
    wakeAt: this.now(),
  })
}
```

- [ ] **Step 4: 跑 test 确认通过**

Run: `cd gateway && npx jest tests/unit/pod/pod-event-wake.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add gateway/src/core/pod/pod-event-wake.ts gateway/src/core/pod/pod-event-service.ts gateway/tests/unit/pod/pod-event-wake.test.ts
git commit -m "feat(pod): enqueue wake events into the lead outbox"
```

### Task 3：kernel 接线与 wiring test

**Files:**
- Modify: `gateway/src/kernel.ts`（`PodEventWake` 构造块）
- Modify: `gateway/tests/unit/lead/lead-outbox-wiring.test.ts`

- [ ] **Step 1: 写 wiring failing test**

在 `lead-outbox-wiring.test.ts` 加：
```ts
test('PodEventWake enqueues into the Lead outbox and never prompts directly', () => {
  const start = kernel.indexOf('new PodEventWake(')
  expect(start).toBeGreaterThanOrEqual(0)
  const block = kernel.slice(start, kernel.indexOf('startPodEventTimers', start))
  expect(block).toMatch(/enqueuePodEvent/)
  expect(block).toMatch(/markWakeQueued/)
  expect(block).not.toMatch(/promptAsync/)
})
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/lead/lead-outbox-wiring.test.ts --runInBand --forceExit`
Expected: FAIL。

- [ ] **Step 3: 修改 kernel 构造**

`PodEventWake` 构造块改为：
```ts
this.podEventWake = new PodEventWake({
  events: this.podEventService,
  enqueue: async ({ podId, eventId, goalId, text, priority }) => {
    const outbox = this.leadOutbox;
    if (!outbox) throw new Error('lead outbox unavailable');
    return outbox.enqueuePodEvent({ podId, eventId, goalId, text, priority });
  },
  isPodPaused: (podId) => this.podStore?.getPod(podId)?.status === 'paused',
  runScan: (fn) => this.scheduler.submit(
    { priority: 'midground', mutexKey: 'pod-event-wake', strategy: 'coalesce' },
    fn,
  ),
});
```
注意：`leadOutbox` 在更晚初始化，闭包必须 lazy 读取 `this.leadOutbox`，不能在构造时捕获值。

- [ ] **Step 4: 跑 wiring + pod wake test 确认通过**

Run: `cd gateway && npx jest tests/unit/lead/lead-outbox-wiring.test.ts tests/unit/pod/pod-event-wake.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add gateway/src/kernel.ts gateway/tests/unit/lead/lead-outbox-wiring.test.ts
git commit -m "feat(kernel): route pod event wakes through the lead outbox"
```

### Task 4：Phase 1 门禁与文档

- [ ] **Step 1: 跑 gateway 定向测试**

Run:
```bash
cd gateway && npx jest tests/unit/lead tests/unit/pod/pod-event-wake.test.ts tests/unit/pod/pod-event-service.test.ts --runInBand --forceExit
```
Expected: 全绿。

- [ ] **Step 2: 跑 gateway 类型门禁**

Run: `cd gateway && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0。

- [ ] **Step 3: 跑 gateway 全量**

Run: `cd gateway && npx jest --runInBand --forceExit`
Expected: 0 failed（如果出现已知 env/flake，先按 `OPENCODE_SERVER_PASSWORD` 清理并单跑复现）。

- [ ] **Step 4: 更新文档**

更新：
- `docs/architecture/events.md`：Lead inbox/outbox 现在由 `LeadOutbox` 统一；`PodEventWake` 只入队。
- `docs/architecture/pod.md`：`wake_state='delivered'` 语义 = 已入 outbox，不等于 Lead 已收到；实际发送看 `event_outbox.state`。
- `docs/releases/2026-11-16-lead-inbox-unification.md`：记录 commit、测试数、指标。

- [ ] **Step 5: 提交文档**

```bash
git add docs/architecture/events.md docs/architecture/pod.md docs/releases/2026-11-16-lead-inbox-unification.md
git commit -m "docs: record lead inbox/outbox unification"
```

**Phase 1 退出标准：**
- `PodEventWake` 不再持有 `promptAsync`；
- Pod event 与 decision 共用 `LeadOutbox` 的 channel/batch/budget/retry；
- 同一 `eventId` 重复 scan 只产生一条 outbox row；
- gateway 全量测试绿；
- 真机：触发一个 `goal.failed` → Lead 只收到一条消息，`event_outbox` 状态 `sent`。

---

## Phase 2：Goal lifecycle domain events + 投影

**目标：** `goal.*` 事实进入统一的 domain event log；`PodGoalView` / attention / presence / inbox 从事件投影；`finishPodGoal` 用 outbox 消除双写。

**候选任务（进入本阶段前展开为 task 计划）：**

1. **Domain event store**
   - 新建 `gateway/src/core/events/domain-event.ts`（envelope）；
   - 新建 `gateway/src/core/events/domain-event-store.ts`（append/list/replay）；
   - 表：`domain_events(event_id PK, type, aggregate_type, aggregate_id, aggregate_version, occurred_at, recorded_at, actor, correlation_id, causation_id, audience, schema_version, payload)`；`UNIQUE(aggregate_type, aggregate_id, aggregate_version)`。
   - 测试：同 aggregate version 幂等；乱序拒绝；replay 按 version 升序。

2. **Goal lifecycle producer**
   - `driver.ts` 在 node start/finish/fail、phase transition、archive 时 append：
     `goal.node.started`, `goal.node.completed`, `goal.node.failed`, `goal.phase.changed`, `goal.failed`, `goal.result`, `goal.accepted`;
   - `kernel.finishPodGoal` 改为：同一 SQLite 事务写 Pod 状态 + domain_events + outbox（文件型 GoalState 用 outbox/补偿）。
   - 测试：state 写入失败 → 无事件；事件写入失败 → 状态回滚或 outbox 保留。

3. **GoalView / attention projector**
   - 新建 `gateway/src/core/pod/goal-view-projector.ts`；
   - 从 domain_events 重建 `PodGoalView`、`PodAttentionItem`；
   - 测试：同一 goal 的 event replay 结果 == 现有 `buildPodGoalView` + `deriveAttention`（parity）。

4. **Desktop 统一投影**
   - `work-overview-model.ts` / `lead-goal-status.ts` / `goal-user-view.ts` 删除重复失败分类，改为消费服务端投影；
   - 测试：`goal.failed` 事件 → Lead 卡「异常」、attention `failed`、用户面红色失败。

**Phase 2 退出标准：**
- 任意 Goal 的 `PodGoalView` / attention 可由 domain_events replay 得到；
- `finishPodGoal` 不再双写；
- 旧 `pod_events` 仍可读，但由 domain event 投影/兼容双读；
- 新增失败/成功/取消事件的 parity 测试。

---

## Phase 3：NodeDriver Event History + snapshots

**目标：** 把 NodeDriver 的当前 state 变成“可重建快照”，Event History 成为工作流恢复真相；LLM/IO 是 Activity，结果入 History，replay 不重复执行。

**候选任务：**

1. **Goal history**
   - 新建 `gateway/src/core/goal/goal-history.ts`：append event、read from version、snapshot version。
   - 事件：`goal.created`, `goal.plan.approved`, `goal.node.scheduled`, `goal.node.started`, `goal.node.completed`, `goal.node.failed`, `goal.artifact.validated`, `goal.review.completed`, `goal.archived`, `goal.question.asked/answered`.
   - 测试：append-only；重复 `eventId` 幂等；version 单调。

2. **Snapshot**
   - 每 N 个事件或节点完成写 `goal_snapshots(goal_id, version, state_json, created_at)`；
   - `loadGoalState` 优先 snapshot + replay tail；
   - 测试：snapshot + tail == full replay。

3. **Driver replay**
   - `driver.advance` 在恢复时先 replay history 到最新，再决定 nextNode；
   - Activity 结果从 history 读取，不重新调 LLM；
   - 测试：模拟崩溃在 execute 后、review 前，重启后不重复 execute Activity。

4. **Replay parity / fault injection**
   - 在 CI 加 `goal-replay.test.ts`：从 event history 重建 state，断言 `phase/verdict/nextNode` 一致；
   - 记录 replay 时长、事件数、snapshot 命中率。

**Phase 3 退出标准：**
- gateway 崩溃后，任意 active Goal 可从 history + snapshot 恢复；
- replay 不重复调用 LLM/写文件/发消息；
- 旧 state 文件可一次性迁移为 snapshot；
- 监控：replay 时长、snapshot 命中率、事件数。

---

## Phase 4：外部事件层统一

**目标：** P2.4 的 GitHub/cron/webhook source 不再维护另一套唤醒语义；它们只生产 domain events，进入同一个 inbox/outbox。

**候选任务：**

1. **Source adapter → domain event**
   - `event_triggers` 保留为外部事件的去重/线程投影；
   - `EventLayerService.ingest` 同时 append domain_event（`external.github.issue`, `external.cron.tick`, ...）；
   - 测试：同一 `idempotency_key` 只产生一个 domain event。

2. **Subscription → consumer**
   - Lead / Tech Lead / Standing Goal 都改为 domain event 订阅；
   - `PodEventWake` 与 decision outbox 的临时路径下线；
   - 测试：同一 GitHub 事件和 Pod 事件走同一 outbox budget/merge。

3. **P2.4 语义收口**
   - `event_decisions` / `event_deliveries` 保留为外部事件的决策/投递审计；
   - 统一 read/ack/answered 状态与 `event_outbox`；
   - 测试：read/ack 状态机、重启恢复、死信。

**Phase 4 退出标准：**
- 一个 GitHub issue、一个 cron tick、一个 `goal.failed` 都进入同一 domain event 面；
- 只有一条 Lead 唤醒/outbox 路径；
- 外部事件与 Pod 事件的预算/去重/暂停语义一致；
- 旧 `event_sources/threads/triggers` API 保持兼容。

---

## 指标（每阶段跟踪）

| 指标 | 定义 | 目标 |
|---|---|---|
| Duplicate delivery | 同一 event 被 Lead 收到两次 | 0 |
| Event/state parity | replay 后 GoalView/attention 与在线状态一致 | 100% |
| Outbox recovery | 重启后 pending/failed 可继续投递 | 100% |
| Time-to-human (p1) | 事件发生 → 人看到可行动消息 | 秒级 |
| Signal-to-noise | Lead 消息中真正需要人的比例 | 逐步提高 |
| Replay side effect | replay 期间重复 LLM/写操作 | 0 |
| Event lag | append → 消费者处理 | p1 < 1s，p2 < 1min |

## 回滚策略

- Phase 1：回滚 commit 即可；`event_outbox` 行是 additive，旧 `pod_events` 不动。
- Phase 2：`domain_events` 是新表；旧 `pod_events`/GoalView 双读；关闭 projector flag 即回退。
- Phase 3：保留 state 文件快照；feature flag `MAFW_GOAL_HISTORY=0` 回退到 state-only。
- Phase 4：外部事件仍写旧 `event_triggers`；关闭 domain adapter 即回退。

## 开放问题（进入 Phase 2 前确认）

1. **已定（2026-11-16）：GoalState 迁进 SQLite**。GoalState / PodStore / `domain_events` 同库，
   state + event 同事务/outbox；现有 `.mafw/state/*.json` 做一次性迁移 + 兼容读取。
2. `domain_events` 与 `pod_events` 是两表还是 `pod_events` 迁为投影？
3. Lead 的 read/ack 语义：Lead 回复算 ack，还是人看到算 read？
4. 是否需要“任意时点 replay Goal”作为产品能力，还是只做崩溃恢复 + 投影重建？
5. Phase 3 是否引入 Temporal 式 Activity/Command 抽象，还是保持 NodeDriver 现有节点函数？

## 执行建议

- **Phase 1 已按 native 在 main 执行**：outbox payload → PodEventWake producer → kernel wiring，
  含 A2A dedupe 与 p1 保留通道；gateway 全量 988/988 绿。
- Phase 2-4 进入前各自写独立 task 计划；Phase 2 先做 SQLite GoalState + domain event store，
  不要在 schema 未定前改投影。
