# Phase 4 · 外部事件层统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (this repo runs inline on `main`) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub / cron / webhook 事件进入同一个 domain log 和同一个 Lead inbox；delivery 的 read/ack/answered 与 `event_outbox` 回执对齐。

**Architecture:** `EventLayerService.ingest` 在写 `event_triggers`（去重）之后追加 `external.*` domain event（`eventId` 由 idempotency key 决定）；`deliverContext` 对外部事件也走 `LeadOutbox`，新增 `external:<triggerId>` 通道；delivery 状态机新增 service 级 receipt API，并镜像到 `event_outbox` 的 `read_at` / `ack_at` / `answered_at`。`event_*` 表仍是外部事件的线程/决策/投递审计，不迁移。

**Tech Stack:** TypeScript、better-sqlite3（JSON1）、Jest、现有 `EventLayerService` / `EventStore` / `LeadOutbox` / `DomainEventStore`。

**Spec:** `docs/superpowers/plans/2026-11-16-event-centric-workflow.md`（Phase 4 + 开放问题）+ `docs/research/2026-11-16-event-layer-as-center.md`。

## Global Constraints

- 在 `main` 上 native 执行；**不 push、不 merge、不发布**，除非用户明确批准。
- TDD：先写 failing test，看它失败，再写最小实现。
- `event_*` 表（sources / threads / triggers / subscriptions / decisions / deliveries）保持兼容，不改语义、不物理删除。
- 外部事件的去重真相仍是 `event_triggers.idempotency_key`；domain event 的 `eventId` 必须由同一个 key 派生，重复 ingest 不产生第二条。
- domain event append 是 fail-open（事件层不能因为日志写入失败而拒绝 ingest）；delivery/outbox 回执必须一致（同一 service 调用）。
- 时间戳走依赖注入的 `now()`；不新增 HTTP 路由（read/ack/answered 的 HTTP 暴露另立计划）。
- 类型门禁：`cd gateway && npx tsc --noEmit -p tsconfig.json`。
- 全量门禁：`cd gateway && npx jest --runInBand --forceExit`，结束必须 `0 failed`。
- 只提交本任务列出的文件；工作树里的并行改动不要 `git add -A`。

## Review Focus

1. **重复 ingest**：同一 `idempotencyKey` 重复到达时，`event_triggers` 和 `domain_events` 都只能有一条，且 `aggregate_version` 不变。
2. **事件层失败隔离**：domain event append 抛错时 ingest 仍成功；delivery 的 receipt 失败必须回滚 delivery 状态（不能“delivery 已读、outbox 未读”）。
3. **Lead 只一条唤醒路径**：外部事件与 Pod event / decision 共用 `LeadOutbox` 的 batch / budget / retry；同一 `triggerId` 只入队一次。
4. **read/ack/answered 对齐**：`event_deliveries` 与 `event_outbox` 的 receipt 时间戳来自同一次调用；非法状态转移必须抛错。
5. **重启恢复**：pending/failed delivery 与 outbox 行在重启后继续投递；达到最大尝试次数的 delivery 进入 `dropped`（死信），不会无限重试。

---

### Task 1: External ingest → domain event

**Files:**
- Create: `gateway/src/core/events/external-domain-event.ts`
- Modify: `gateway/src/core/events/event-layer-service.ts`
- Modify: `gateway/src/kernel.ts`
- Test: `gateway/tests/unit/events/external-domain-event.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function externalEventType(sourceKind: EventSourceKind, kind: string): string
  export function externalDomainEvent(input: {
    envelope: EventEnvelope;
    triggerId: string;
  }): DomainEventInput
  ```
- 映射（固定）：
  - `github` → `external.github.<kind>`
  - `cron` → `external.cron.<kind 去掉前缀 cron.>`（`cron.tick` → `external.cron.tick`）
  - `webhook` → `external.webhook.<kind>`
  - 其他 → `external.<sourceKind>.<kind>`
  - `aggregateType: 'external'`，`aggregateId: envelope.externalKey`
  - `eventId: 'external:' + envelope.idempotencyKey`
  - `audience: 'none'`
  - payload `{ triggerId, sourceId, sourceKind, externalKey, externalId, kind, actor, title, projectDir, occurredAt, data }`
- `EventLayerDeps` 新增 `domainEvents?: { append(input: DomainEventInput): unknown }`。
- `ingest`：`source.kind !== 'internal'` 且注入了 `domainEvents` 时 append；**fail-open**：异常只 `deps.log`，不影响 ingest 返回。
- kernel：构造 `EventLayerService` 时传 `domainEvents: this.domainEvents`（Phase 3 已在 initServices 早于 event layer 构造）。

- [ ] **Step 1: 写 failing test**

```ts
import Database from 'better-sqlite3';
import { DomainEventStore } from '../../../src/core/events/domain-event-store';
import { EventStore } from '../../../src/core/events/event-store';
import { EventLayerService } from '../../../src/core/events/event-layer-service';
import { externalDomainEvent } from '../../../src/core/events/external-domain-event';

function setup() {
  const db = new Database(':memory:');
  const store = new EventStore(db);
  store.insertSource({
    id: 'gh', projectDir: '/p', kind: 'github', name: 'gh',
    config: {}, now: '2026-11-17T00:00:00.000Z',
  });
  const domainEvents = new DomainEventStore(db);
  const layer = new EventLayerService({
    store, domainEvents,
    now: () => '2026-11-17T00:00:00.000Z',
    newId: (prefix) => `${prefix}_1`,
    broadcast: () => {},
    enabled: () => true,
    evaluate: async () => ({ decision: 'ignore', rationale: 'test' }),
  });
  return { db, store, domainEvents, layer };
}

const envelope = {
  projectDir: '/p', sourceId: 'gh', sourceKind: 'github' as const,
  externalId: 'issue-1', externalKey: 'acme/repo#1', kind: 'issue',
  actor: 'octocat', payload: { title: 'Bug' },
  occurredAt: '2026-11-17T00:00:00.000Z', receivedAt: '2026-11-17T00:00:00.000Z',
  idempotencyKey: 'gh:acme/repo#1:issue:1', title: 'Bug',
};

test('maps an external event to a domain event', () => {
  expect(externalDomainEvent({ envelope, triggerId: 't1' }))
    .toMatchObject({
      type: 'external.github.issue',
      aggregateType: 'external',
      aggregateId: 'acme/repo#1',
      eventId: 'external:gh:acme/repo#1:issue:1',
      audience: 'none',
    });
});

test('duplicate ingest keeps one trigger and one domain event', () => {
  const h = setup();
  const first = h.layer.ingest(envelope);
  const second = h.layer.ingest(envelope);
  expect(second.duplicate).toBe(true);
  const events = h.domainEvents.listAggregate('external', 'acme/repo#1');
  expect(events).toHaveLength(1);
  expect(events[0].aggregateVersion).toBe(1);
  expect(first.trigger.id).toBe(second.trigger.id);
});

test('internal sources do not append external events', () => {
  const h = setup();
  h.store.insertSource({
    id: 'internal', projectDir: '*', kind: 'internal', name: 'internal',
    config: {}, now: '2026-11-17T00:00:00.000Z',
  });
  h.layer.ingest({ ...envelope, sourceId: 'internal', sourceKind: 'internal', idempotencyKey: 'internal:1' });
  expect(h.domainEvents.listAggregate('external', 'acme/repo#1')).toHaveLength(0);
});
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/events/external-domain-event.test.ts --runInBand --forceExit`
Expected: FAIL — 模块不存在 / `domainEvents` 被忽略。

- [ ] **Step 3: 实现 builder + ingest 接线**

builder 是纯函数。`ingest` 在 `insertTrigger` 之后 append；包 `try/catch` 调 `this.deps.log?.('[EventLayer] domain event append failed: ...')`。

- [ ] **Step 4: 跑 test 确认通过**

Run: `cd gateway && npx jest tests/unit/events/external-domain-event.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/events/external-domain-event.ts gateway/src/core/events/event-layer-service.ts gateway/src/kernel.ts gateway/tests/unit/events/external-domain-event.test.ts
git commit -m "feat(events): append domain events for external ingests"
```

---

### Task 2: External events through the Lead inbox

**Files:**
- Modify: `gateway/src/core/lead/lead-outbox-model.ts`
- Modify: `gateway/src/core/lead/lead-outbox.ts`
- Modify: `gateway/src/core/events/lead-event.ts`
- Modify: `gateway/src/kernel.ts`
- Test: `gateway/tests/unit/lead/lead-outbox-external.test.ts`

**Interfaces:**
- `LeadOutboxKind` 扩展为 `'decision' | 'pod-event' | 'external'`。
- 新增：
  ```ts
  // lead-event.ts
  export function renderExternalEvent(trigger: EventTriggerRow, thread: EventThreadRow): string

  // lead-outbox.ts
  enqueueExternal(input: {
    podId: string;
    triggerId: string;
    text: string;
    priority?: LeadOutboxPriority;
  }): EventOutboxRow   // dedupeKey = `external:<triggerId>`, channel `lead:<podId>`
  ```
- `renderLeadOutboxBatch`：全部 external → `[EVENT] N 条待处理`；mixed → 保持 `[LEAD EVENT] N 条待确认`。
- kernel `deliverContext`：
  - `decision.*` → 现有 decision 分支；
  - 其他（external）→ `renderExternalEvent(trigger, thread)` → `enqueueExternal`。
  - 仍只处理 `subscriberType === 'lead' && mode === 'context'`。

- [ ] **Step 1: 写 failing test**

```ts
import Database from 'better-sqlite3';
import { EventStore } from '../../../src/core/events/event-store';
import { EventOutbox } from '../../../src/core/events/event-outbox';
import { LeadOutbox } from '../../../src/core/lead/lead-outbox';
import { leadOutboxPayload, renderLeadOutboxBatch } from '../../../src/core/lead/lead-outbox-model';

test('external items dedupe by trigger and render as [EVENT]', () => {
  const store = new EventStore(new Database(':memory:'));
  const outbox = new EventOutbox({ store, now: () => '2026-11-17T00:00:00.000Z' });
  const lead = new LeadOutbox({
    store, outbox,
    now: () => '2026-11-17T00:00:00.000Z',
    ensureLead: async () => ({ sessionId: 'ses_lead' }),
    promptAsync: async () => {},
    timers: { every: () => ({ clear: () => {} }) },
  });
  const a = lead.enqueueExternal({ podId: 'p1', triggerId: 't1', text: '[EVENT] issue' });
  lead.enqueueExternal({ podId: 'p1', triggerId: 't1', text: '[EVENT] issue' });
  const b = lead.enqueueExternal({ podId: 'p1', triggerId: 't2', text: '[EVENT] cron' });
  expect(store.listOutbox()).toHaveLength(2);
  expect(a.dedupeKey).toBe('external:t1');
  expect(leadOutboxPayload(a)).toMatchObject({ kind: 'external', recordId: 't1' });
  expect(renderLeadOutboxBatch([a, b])).toContain('[EVENT] 2 条待处理');
});
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/lead/lead-outbox-external.test.ts --runInBand --forceExit`
Expected: FAIL — `enqueueExternal` 不存在 / kind 校验拒绝 `external`。

- [ ] **Step 3: 实现 + kernel `deliverContext` 分支**

`leadOutboxPayload` 的 kind 白名单加 `external`；`enqueueExternal` 与 `enqueuePodEvent` 同形，dedupe prefix 不同。`renderExternalEvent` 用 `thread.title` / `thread.externalKey` / `trigger.kind` / `trigger.actor` 渲染 4-6 行。

- [ ] **Step 4: 跑 test + 定向 lead 套件**

Run: `cd gateway && npx jest tests/unit/lead tests/unit/events --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/lead/lead-outbox-model.ts gateway/src/core/lead/lead-outbox.ts gateway/src/core/events/lead-event.ts gateway/src/kernel.ts gateway/tests/unit/lead/lead-outbox-external.test.ts
git commit -m "feat(lead): route external events through the lead outbox"
```

---

### Task 3: Delivery receipts ↔ outbox

**Files:**
- Modify: `gateway/src/core/events/event-types.ts`
- Modify: `gateway/src/core/events/event-store.ts`
- Modify: `gateway/src/core/events/event-layer-service.ts`
- Modify: `gateway/src/kernel.ts`
- Test: `gateway/tests/unit/events/event-delivery-receipts.test.ts`

**Interfaces:**
- `EventOutboxRow` 新增 `answeredAt: string | null`；`event_outbox` additive 列 `answered_at TEXT`。
- 新增：
  ```ts
  // event-layer-service.ts
  markDeliveryReceipt(
    deliveryId: string,
    next: 'read' | 'acknowledged' | 'answered',
  ): EventDeliveryRow

  // event-store.ts
  updateOutboxReceiptByTrigger(
    triggerId: string,
    next: 'read' | 'acknowledged' | 'answered',
    now: string,
  ): number

  /** Lead ack propagated to the external-delivery audit. */
  ackDeliveriesForSession(sessionId: string, now: string): number

  // event-store.ts（已有连接上的事务包装）
  transaction<T>(fn: () => T): T
  ```
- `markDeliveryReceipt`：`getDelivery` → `applyDeliveryTransition`（非法转移抛错）→
  在 `store.transaction(() => { updateOutboxReceiptByTrigger(...); updateDelivery(...) })`
  里同时写 outbox 与 delivery；任一步失败整体回滚。先算 transition 再开事务，非法转移不写任何一行。
- `updateOutboxReceiptByTrigger` SQL：`json_extract(payload, '$.triggerId') = ?` 且 `channel_id LIKE 'lead:%'`；read 只写 `read_at IS NULL` 的行，ack 写 `ack_at`，answered 写 `answered_at`。
- kernel `ackLeadOutboxForSession`：`markOutboxAckedBySession` 后调用 `this.eventLayerStore?.ackDeliveriesForSession(sessionId, now)`。
- `ackDeliveriesForSession` SQL：`trigger_id IN (SELECT json_extract(payload,'$.triggerId') FROM event_outbox WHERE sent_session_id = ? AND ack_at IS NOT NULL)`，只把 `delivered`/`read` 置为 `acknowledged`。

- [ ] **Step 1: 写 failing test**

```ts
test('receipts move the delivery and mirror the outbox timestamps', () => {
  const h = setup();  // EventStore + EventLayerService + 一条 delivered delivery + 一条 lead outbox
  h.service.markDeliveryReceipt('d1', 'read');
  expect(h.store.getDelivery('d1')?.state).toBe('read');
  expect(h.store.getOutbox(h.outboxId)?.readAt).not.toBeNull();

  h.service.markDeliveryReceipt('d1', 'acknowledged');
  expect(h.store.getOutbox(h.outboxId)?.ackAt).not.toBeNull();

  h.service.markDeliveryReceipt('d1', 'answered');
  expect(h.store.getDelivery('d1')?.state).toBe('answered');
  expect(h.store.getOutbox(h.outboxId)?.answeredAt).not.toBeNull();
});

test('invalid transitions throw and change nothing', () => {
  const h = setup();  // delivery 是 delivered
  expect(() => h.service.markDeliveryReceipt('d1', 'answered')).toThrow(/invalid delivery transition/);
  expect(h.store.getDelivery('d1')?.state).toBe('delivered');
  expect(h.store.getOutbox(h.outboxId)?.answeredAt).toBeNull();
});

test('lead session ack propagates to the delivery audit', () => {
  const h = setup();
  h.store.updateOutbox(h.outboxId, { state: 'sent', sentSessionId: 'ses_a', ackAt: '2026-11-17T00:01:00.000Z' });
  expect(h.store.ackDeliveriesForSession('ses_a', '2026-11-17T00:01:00.000Z')).toBe(1);
  expect(h.store.getDelivery('d1')?.state).toBe('acknowledged');
});
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/events/event-delivery-receipts.test.ts --runInBand --forceExit`
Expected: FAIL — 方法/列不存在。

- [ ] **Step 3: 实现列、receipt API、kernel 传播**

`applyDeliveryTransition` 已存在，直接复用。`updateOutbox` 的 patch 类型加 `answeredAt`；`toOutbox` 映射新列。

- [ ] **Step 4: 跑 test 确认通过**

Run: `cd gateway && npx jest tests/unit/events/event-delivery-receipts.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/events/event-types.ts gateway/src/core/events/event-store.ts gateway/src/core/events/event-layer-service.ts gateway/src/kernel.ts gateway/tests/unit/events/event-delivery-receipts.test.ts
git commit -m "feat(events): mirror delivery receipts into the lead outbox"
```

---

### Task 4: Dead letters + restart recovery

**Files:**
- Modify: `gateway/src/core/events/event-layer-service.ts`
- Test: `gateway/tests/unit/events/event-delivery-deadletter.test.ts`

**Interfaces:**
- `EventLayerDeps.maxDeliveryAttempts?: number`（默认 5）。
- `evaluate` 与 `retryDueDeliveries` 的失败分支：`attempts >= max` → `updateDelivery(state: 'dropped', lastError: 'dead-letter: ...')`，否则保持 `failed` + backoff。
- 重启恢复：`failed` + 到期 `nextRetryAt` 的 delivery 在下次 `evaluate` 时重试（现有 `retryDueDeliveries`），测试覆盖“重启后一次重试成功”。

- [ ] **Step 1: 写 failing test**

`setup(opts?: { maxDeliveryAttempts?: number; failFirst?: number })` 构建真实 `EventStore` +
`EventLayerService`：一个 webhook source、一个 thread、一个 trigger、一个 `lead` context 订阅、
一条 delivery；`deliverContext` 用 mock，`failFirst` 表示前 N 次抛错。

```ts
test('a delivery drops as dead-letter after max attempts', async () => {
  const h = setup({ deliverContext: async () => { throw new Error('lead offline'); }, maxDeliveryAttempts: 2 });
  await h.service.evaluate(h.threadId);
  await h.service.evaluate(h.threadId);  // 第二次失败 → 死信
  expect(h.store.getDelivery(h.deliveryId)?.state).toBe('dropped');
  expect(h.store.getDelivery(h.deliveryId)?.lastError).toContain('dead-letter');
});

test('an overdue failed delivery retries once after restart', async () => {
  const h = setup({ failFirst: 1 });
  await h.service.evaluate(h.threadId);
  expect(h.store.getDelivery(h.deliveryId)?.state).toBe('failed');
  // 模拟重启：nextRetryAt 拨到过去，新的 service 实例 evaluate
  h.store.updateDelivery(h.deliveryId, { nextRetryAt: '2000-01-01T00:00:00.000Z' });
  await h.restartedService.evaluate(h.threadId);
  expect(h.store.getDelivery(h.deliveryId)?.state).toBe('delivered');
});
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/events/event-delivery-deadletter.test.ts --runInBand --forceExit`
Expected: FAIL — 无 `maxDeliveryAttempts`，无限 failed。

- [ ] **Step 3: 实现死信阈值**

在 `evaluate` 的 catch 与 `retryDueDeliveries` 的 catch 统一走一个私有 `failDelivery(delivery, error)`，按 attempts 决定 `failed` 还是 `dropped`。`dropped` 时 `nextRetryAt: null`。

- [ ] **Step 4: 跑 test 确认通过**

Run: `cd gateway && npx jest tests/unit/events/event-delivery-deadletter.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/events/event-layer-service.ts gateway/tests/unit/events/event-delivery-deadletter.test.ts
git commit -m "feat(events): dead-letter external deliveries after max attempts"
```

---

### Task 5: 文档、门禁与真机验收

**Files:**
- Modify: `docs/architecture/events.md`
- Create: `docs/releases/2026-11-17-external-events-unification.md`

- [ ] **Step 1: 更新架构文档**

`events.md` 增补：
- `external.*` domain event 映射与 `external:<idempotencyKey>` 幂等；
- 外部事件也走 `LeadOutbox`（`external:<triggerId>`，`[EVENT]` 批量头）；
- delivery receipt ↔ outbox `read_at` / `ack_at` / `answered_at` 的对应；
- 死信阈值（默认 5 次）与重启重试；
- `event_*` 表仍是外部事件的线程/决策/投递审计。

- [ ] **Step 2: 写 release note**

`docs/releases/2026-11-17-external-events-unification.md`：版本 `v5.1.0`、commit 列表（提交后回填）、
测试数、边界（HTTP receipt 路由未做 / 外部事件仍以 event_* 为去重真相 / 旧 API 不变）、回滚。

- [ ] **Step 3: 全量门禁**

Run: `cd gateway && npx tsc --noEmit -p tsconfig.json`
Run: `cd gateway && Remove-Item Env:OPENCODE_SERVER_PASSWORD -ErrorAction SilentlyContinue; npx jest --runInBand --forceExit`
Expected: tsc exit 0；全量 0 failed。

- [ ] **Step 4: 构建**

Run: `cd gateway && npm run build`
Expected: `dist/release.json` 更新，无 TS 错误。

- [ ] **Step 5: 真机验收（记录结果）**

重启后：
1. 创建一个临时 webhook source，向 `POST /api/event-sources/:id/webhook` 发送同一 body 两次
   （同 idempotency key）→ `event_triggers` 1 条、`domain_events` 1 条 `external.webhook.*`；
2. 给该线程建 Lead context 订阅并触发 evaluate → `event_outbox` 出现
   `external:<triggerId>` 行；
3. 用 service 级 receipt 调用（脚本）把 delivery 置 read/ack/answered →
   `event_outbox.read_at/ack_at/answered_at` 同步；
4. 清理临时 source/thread/trigger/outbox/domain event 行。

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/events.md docs/releases/2026-11-17-external-events-unification.md
git commit -m "docs: record phase 4 external events unification"
```

---

## Phase 4 退出标准

- 同一外部 `idempotencyKey` 重复 ingest 只产生一条 trigger 与一条 `external.*` domain event。
- 外部事件与 decision / Pod event 共用 `LeadOutbox` 的 batch / budget / retry，且按 `triggerId` 去重。
- delivery 的 read/ack/answered 与 `event_outbox` 回执同一次调用落库；非法转移抛错。
- Lead 会话 ack 会传播到对应外部 delivery 的 `acknowledged`。
- 失败 delivery 达到阈值进入 `dropped`（死信），未达阈值重启后继续重试。
- `event_*` 旧 API 行为不变；gateway 全量 0 failed，`tsc` / `build` 通过。

**范围说明：** read/ack/answered 的 HTTP 路由与 SDK 契约不在本计划内；本阶段只交付 service 级
receipt API + outbox 对齐。对外暴露需要单独的 API 计划（route catalog / schemas / SDK）。

**范围说明（相对父计划）：** 父计划写「Lead / Tech Lead / Standing Goal 都改为 domain event
订阅」。本阶段不重写订阅机制：外部事件的线程/订阅/决策仍由 `event_*` 承担（Tech Lead 的
evaluate 语义不变），domain log 作为统一事实面与 Lead inbox 的入口。把 Tech Lead/Standing
Goal 的消费者改成直接读 domain events 需要独立的评估计划（涉及决策权限与幂等边界）。
