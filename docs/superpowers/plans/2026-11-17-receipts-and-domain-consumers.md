# Phase 4b · Receipt HTTP + Domain Event Consumers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (this repo runs inline on `main`) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 read / answered 提供人类专用 HTTP 回执（ack 仍只由 Lead 回合写入），并让 Lead 与 Standing Goal 的投递内容来自 domain event。

**Architecture:** 新路由 `POST /api/event-deliveries/:id/read` 与 `POST /api/event-deliveries/:id/answer` 走 `EventLayerService.markDeliveryReceipt`（已有事务与 outbox 镜像）；`ack` 不暴露 HTTP，只由 `turn.completed` 写入。`deliverContext` 的外部分支与 `deliverWork` 的 Standing Goal 分支优先读取 `external:<idempotencyKey>` 的 domain event；查不到（decision/internal）时回退 trigger。Tech Lead 的 evaluate/decision 不变。

**Tech Stack:** TypeScript、现有 `EventLayerService` / `EventStore` / `DomainEventStore`、路由 catalog + OpenAPI 生成、`@mafw/sdk` client/types。

**Spec:** `docs/superpowers/plans/2026-11-17-phase4-external-events-unification.md`（范围说明）+ 本轮两项决策：
read/answered 人类专用、ack 仅内部；Lead + Standing Goal 先迁 domain event 消费者。

## Global Constraints

- 在 `main` 上 native 执行；**不 push、不 merge、不发布**，除非用户明确批准。
- TDD：先写 failing test，看它失败，再写最小实现。
- `ack` 不新增 HTTP 路由；只由 Lead 会话 `turn.completed` 写入，避免人类伪造 Lead 回复。
- `read` / `answered` 路由必须 human-only：`isHumanPrincipal` 失败返回 `403 human_principal_required`，且在读取/写入任何数据之前拒绝。
- Standing Goal 的幂等键保持 `trigger.id`；切换内容来源不得改变事件 id，否则会重复执行。
- domain event 查不到时回退 trigger（decision / internal 没有 `external:*` 事件）。
- 契约链：改 catalog 后必须跑 `gateway` 的 `emit:openapi` + SDK 的 `gen:api`；SDK 新增请求路径必须能映射到 operationId。
- 门禁：`cd gateway && npx tsc --noEmit -p tsconfig.json`；`cd packages/gateway-sdk && npm test`；gateway 全量 `npx jest --runInBand --forceExit` 必须 0 failed。
- 只提交本任务列出的文件；工作树里的并行改动不要 `git add -A`。

## Review Focus

1. **Standing 幂等**：消费 domain event 后 `eventId` 仍是 `trigger.id`；同一 trigger 重放不产生第二个 GoalRun。
2. **Human-only 闸门**：service / local / agent principal 在 route 层就被拒，不能只靠 service 抛错；拒绝发生在任何状态写入之前。
3. **错误映射**：不存在的 delivery → 404；非法转移 → 409；事件层关闭 → 503；错误不留下 outbox 已读而 delivery 未读的半写。
4. **跨线程误读**：domain event 只按 `external:<trigger.idempotencyKey>` 精确查找；查不到必须回退 trigger，不能拿别的线程事件。
5. **契约一致**：SDK 的新方法在 `gateway-paths.json` 有对应 operationId；`contract.test.ts` 不出现 stale path。

---

### Task 1: Domain event lookup + consumer helpers

**Files:**
- Modify: `gateway/src/core/events/domain-event-store.ts`
- Create: `gateway/src/core/events/domain-event-consumer.ts`
- Modify: `gateway/src/core/events/lead-event.ts`
- Test: `gateway/tests/unit/events/domain-event-consumer.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // domain-event-store.ts
  getByEventId(eventId: string): DomainEvent | null

  // domain-event-consumer.ts
  export function domainEventForTrigger(
    events: { getByEventId(eventId: string): DomainEvent | null } | null,
    trigger: EventTriggerRow,
  ): DomainEvent | null

  export function consumerEnvelope(
    trigger: EventTriggerRow,
    event: DomainEvent | null,
  ): { payload: Record<string, unknown>; kind: string }

  // lead-event.ts
  export function renderDomainEvent(event: DomainEvent): string
  ```
- `domainEventForTrigger`：`eventId = 'external:' + trigger.idempotencyKey`；无 key 或未命中 → null。
- `consumerEnvelope`：命中 → `{ payload: event.payload, kind: event.type }`；否则 trigger 原值。
- `renderDomainEvent` 输出：
  ```
  [EVENT]
  type=external.github.issue
  key=<aggregateId>
  source=<payload.sourceKind>
  title: <payload.title>      （缺失则省略）
  actor=<payload.actor>       （缺失则省略）
  处理完即可；需要用户拍板时走 ask 流程。
  ```

- [ ] **Step 1: 写 failing test**

```ts
import Database from 'better-sqlite3';
import { DomainEventStore } from '../../../src/core/events/domain-event-store';
import { domainEventForTrigger, consumerEnvelope } from '../../../src/core/events/domain-event-consumer';
import { renderDomainEvent } from '../../../src/core/events/lead-event';

const trigger = {
  id: 'trigger_1', sourceId: 'wh', threadId: 'th1', externalId: 'e1', kind: 'issue',
  actor: 'octocat', payload: { title: 'Trigger title' },
  occurredAt: '2026-11-17T00:00:00.000Z', receivedAt: '2026-11-17T00:00:00.000Z',
  idempotencyKey: 'wh:delivery-1', disposition: 'accepted',
} as any;

test('finds the external event by trigger idempotency key', () => {
  const store = new DomainEventStore(new Database(':memory:'));
  const event = store.append({
    eventId: 'external:wh:delivery-1',
    type: 'external.webhook.issue', aggregateType: 'external', aggregateId: 'thread-key',
    occurredAt: '2026-11-17T00:00:00.000Z', audience: 'none',
    payload: { sourceKind: 'webhook', title: 'Event title', actor: 'hubot' },
  });
  expect(domainEventForTrigger(store, trigger)?.eventId).toBe(event.eventId);
  expect(consumerEnvelope(trigger, domainEventForTrigger(store, trigger)))
    .toEqual({
      payload: event.payload,
      kind: 'external.webhook.issue',
    });
});

test('falls back to the trigger when the event is missing', () => {
  expect(domainEventForTrigger(null, trigger)).toBeNull();
  expect(consumerEnvelope(trigger, null))
    .toEqual({ payload: trigger.payload, kind: trigger.kind });
});

test('renders an external domain event', () => {
  const text = renderDomainEvent({
    eventId: 'external:wh:1', type: 'external.webhook.issue',
    aggregateType: 'external', aggregateId: 'thread-key', aggregateVersion: 1,
    occurredAt: '2026-11-17T00:00:00.000Z', recordedAt: '2026-11-17T00:00:00.000Z',
    actor: null, correlationId: null, causationId: null, audience: 'none', schemaVersion: 1,
    payload: { sourceKind: 'webhook', title: 'Event title', actor: 'hubot' },
  });
  expect(text).toContain('[EVENT]');
  expect(text).toContain('type=external.webhook.issue');
  expect(text).toContain('key=thread-key');
  expect(text).toContain('title: Event title');
  expect(text).toContain('actor=hubot');
});
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/events/domain-event-consumer.test.ts --runInBand --forceExit`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

`DomainEventStore.getByEventId`：`SELECT * WHERE event_id = ?` → `toEvent`。纯 helpers 如接口；`renderDomainEvent` 不读取 DB。

- [ ] **Step 4: 跑 test 确认通过**

Run: `cd gateway && npx jest tests/unit/events/domain-event-consumer.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/events/domain-event-store.ts gateway/src/core/events/domain-event-consumer.ts gateway/src/core/events/lead-event.ts gateway/tests/unit/events/domain-event-consumer.test.ts
git commit -m "feat(events): resolve domain events for consumers"
```

---

### Task 2: Lead + Standing Goal consume domain events

**Files:**
- Modify: `gateway/src/kernel.ts`
- Test: `gateway/tests/unit/events/domain-event-consumer-wiring.test.ts`

**Interfaces:**
- Consumes: `domainEventForTrigger` / `consumerEnvelope` / `renderDomainEvent`（Task 1）。
- kernel 新增私有方法：
  ```ts
  private externalDomainEventForTrigger(trigger: EventTriggerRow): DomainEvent | null
  ```
  内部 `domainEventForTrigger(this.domainEvents ?? null, trigger)`。
- `deliverContext` 外部分支：`const event = this.externalDomainEventForTrigger(trigger)`；
  有事件 → `renderDomainEvent(event)`，否则 `renderExternalEvent(trigger, thread)`。
  入队仍是 `enqueueExternal({ podId, triggerId, text })`。
- `deliverWork` Standing Goal 分支：
  ```ts
  const event = this.externalDomainEventForTrigger(trigger);
  const envelope = consumerEnvelope(trigger, event);
  await this.standingGoals.handleEventTrigger(subscription.subscriberId, {
    eventId: trigger.id,            // 幂等键不变
    payload: envelope.payload,
    kind: envelope.kind,
    projectDir: thread.projectDir,
  });
  ```

- [ ] **Step 1: 写 failing test**

```ts
import * as fs from 'fs';
import * as path from 'path';

const kernel = fs.readFileSync(path.join(__dirname, '../../../src/kernel.ts'), 'utf-8');

test('lead external context prefers the domain event renderer', () => {
  const start = kernel.indexOf('deliverContext: async');
  const block = kernel.slice(start, start + 2200);
  expect(block).toMatch(/externalDomainEventForTrigger/);
  expect(block).toMatch(/renderDomainEvent/);
});

test('standing goal consumes the domain-event envelope with a stable event id', () => {
  const start = kernel.indexOf('deliverWork: async');
  const block = kernel.slice(start, start + 2200);
  expect(block).toMatch(/consumerEnvelope/);
  expect(block).toMatch(/eventId: trigger\.id/);
});
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/events/domain-event-consumer-wiring.test.ts --runInBand --forceExit`
Expected: FAIL — 未接线。

- [ ] **Step 3: 实现 kernel 接线**

`externalDomainEventForTrigger` 放在 `deliverContext` 附近；decision/internal 未命中自然返回 null。`deliverWork` 只对 `standing_goal` 分支使用 envelope；广播保持原样。

- [ ] **Step 4: 跑 test + 定向套件**

Run: `cd gateway && npx jest tests/unit/events tests/unit/lead --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/kernel.ts gateway/tests/unit/events/domain-event-consumer-wiring.test.ts
git commit -m "feat(events): let lead and standing goals consume domain events"
```

---

### Task 3: read / answered receipt routes (human-only)

**Files:**
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/routes/schemas/events.ts`
- Modify: `gateway/src/routes/events.ts`
- Modify: `gateway/src/subsystems/api-routes.ts`
- Test: `gateway/tests/unit/events/event-delivery-receipt-routes.test.ts`

**Interfaces:**
- 路由（catalog）：
  - `POST /api/event-deliveries/:id/read` → `events.deliveries.read`
  - `POST /api/event-deliveries/:id/answer` → `events.deliveries.answer`
  - 请求 `EmptyRequest`；响应 `EventDeliveryReceiptResponse = { delivery: EventDeliveryRowSchema }`
  （把现有 `EventDeliveryRowSchema` 从 `const` 改为 `export const`）
  - errors `[400, 403, 404, 409, 503]`
- `EventRouteDeps` 新增：
  ```ts
  markReceipt?(id: string, next: 'read' | 'answered'): EventDeliveryRow;
  ```
- `handleDeliveryReceipt(input: { id: string; next: 'read' | 'answered' }, deps)`：
  - `gate(deps)` → 503；空 id → 400；
  - `deps.markReceipt` 缺省 → 503；
  - 捕获 `delivery not found` → 404；
  - 捕获 `invalid delivery transition` → 409；
  - 成功 → `{ status: 200, body: { delivery } }`。
- `attachEventRoutes` 的 read/answer handler：
  ```ts
  if (!isHumanPrincipal((req as any).mafwPrincipal)) {
    send(res, humanOnlyDenied());
    return;
  }
  ```
  在读取 body/写库之前执行。
- `api-routes.ts` 注入：
  ```ts
  const eventLayer = deps.eventLayer;
  markReceipt: eventLayer
    ? (id, next) => eventLayer.markDeliveryReceipt(id, next)
    : undefined,
  ```
  事件层关闭时 handler 的 `gate` 先返回 503。

- [ ] **Step 1: 写 failing test**

```ts
import { handleDeliveryReceipt } from '../../../src/routes/events';

function deps(over: Partial<any> = {}) {
  return {
    enabled: () => true,
    markReceipt: (id: string, next: 'read' | 'answered') => ({
      id, triggerId: 't1', subscriptionId: 's1', state: next,
      attempts: 0, lastError: null, deliveredAt: null, readAt: null,
      ackAt: null, answeredAt: null, nextRetryAt: null,
    }),
    ...over,
  } as any;
}

test('read and answer return the updated delivery', () => {
  expect(handleDeliveryReceipt({ id: 'd1', next: 'read' }, deps()).status).toBe(200);
  expect(handleDeliveryReceipt({ id: 'd1', next: 'answered' }, deps()).status).toBe(200);
});

test('maps disabled / missing / not-found / invalid transitions', () => {
  expect(handleDeliveryReceipt({ id: 'd1', next: 'read' }, deps({ enabled: () => false })).status).toBe(503);
  expect(handleDeliveryReceipt({ id: '', next: 'read' }, deps()).status).toBe(400);
  expect(handleDeliveryReceipt({ id: 'd1', next: 'read' }, deps({ markReceipt: undefined })).status).toBe(503);
  expect(handleDeliveryReceipt({ id: 'd1', next: 'read' }, deps({
    markReceipt: () => { throw new Error('delivery not found: d1'); },
  })).status).toBe(404);
  expect(handleDeliveryReceipt({ id: 'd1', next: 'answered' }, deps({
    markReceipt: () => { throw new Error('invalid delivery transition: delivered -> answered'); },
  })).status).toBe(409);
});

test('read route rejects non-human principals before writing', async () => {
  const handlers = new Map<string, Function>();
  const registry = { attachHandler: (id: string, fn: Function) => handlers.set(id, fn) } as any;
  let writes = 0;
  attachEventRoutes(registry, deps({
    markReceipt: (id: string) => { writes += 1; return { id } as any; },
  }));
  const res: any = { statusCode: 0, writeHead(code: number) { this.statusCode = code; }, end() {} };
  await handlers.get('events.deliveries.read')!({ mafwPrincipal: { kind: 'service' } }, res);
  expect(res.statusCode).toBe(403);
  expect(writes).toBe(0);
});
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/events/event-delivery-receipt-routes.test.ts --runInBand --forceExit`
Expected: FAIL — handler 不存在。

- [ ] **Step 3: 实现 handler + catalog + attach 包装**

catalog 放在 `events.deliveries.list` 之后；schema 复用 `EventDeliveryRowSchema`。`attachEventRoutes` 加两个 handler，human 闸门在 `deps.markReceipt` 之前。`api-routes.ts` 注入 `markReceipt`。

- [ ] **Step 4: 跑 test + 契约生成**

Run: `cd gateway && npx jest tests/unit/events/event-delivery-receipt-routes.test.ts --runInBand --forceExit`
Run: `cd gateway && npx ts-node --project tsconfig.json scripts/emit-openapi.ts`
Expected: PASS；`gateway-paths.json` 新增两条 operation。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/route-catalog.ts gateway/src/routes/schemas/events.ts gateway/src/routes/events.ts gateway/src/subsystems/api-routes.ts packages/gateway-sdk/contract/gateway-paths.json gateway/tests/unit/events/event-delivery-receipt-routes.test.ts
git commit -m "feat(events): expose human read and answered receipts"
```

---

### Task 4: SDK methods + contract gate

**Files:**
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/gateway-sdk/src/api-schema.gen.ts`（`gen:api` 产物）
- Modify: `packages/gateway-sdk/contract/openapi.json`（`gen:api` 产物）
- Test: `packages/gateway-sdk/src/client.test.ts`

**Interfaces:**
- `EventsNamespace` 新增：
  ```ts
  readDelivery(id: string): Promise<{ delivery: EventDeliveryView }>
  answerDelivery(id: string): Promise<{ delivery: EventDeliveryView }>
  ```
- 实现：
  ```ts
  readDelivery: (id) => this.request(`/api/event-deliveries/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  answerDelivery: (id) => this.request(`/api/event-deliveries/${encodeURIComponent(id)}/answer`, { method: 'POST' }),
  ```

- [ ] **Step 1: 写 failing test**

在 `client.test.ts` 的 events 段加：

```ts
test("events.readDelivery posts to the receipt route", async () => {
  const calls: string[] = []
  const fetchImpl = async (url: any, init?: any) => {
    calls.push(`${init?.method ?? 'GET'} ${String(url)}`)
    return new Response(JSON.stringify({ delivery: { id: 'd1' } }), { status: 200 })
  }
  const c = new MafwClient({ baseUrl: 'http://x', fetchImpl: fetchImpl as any })
  const out = await c.events.readDelivery('d1')
  expect(out.delivery.id).toBe('d1')
  expect(calls).toContain('POST http://x/api/event-deliveries/d1/read')
})
```

（`answerDelivery` 同形。）

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd packages/gateway-sdk && npm test`
Expected: FAIL — 方法不存在。

- [ ] **Step 3: 实现 + 重新生成契约**

Run: `cd packages/gateway-sdk && npm run gen:api`
然后加 types/client 方法。

- [ ] **Step 4: 跑 SDK 测试 + 契约门禁**

Run: `cd packages/gateway-sdk && npm test`
Expected: PASS（含 `contract.test.ts` 的 path→operationId 校验）。

- [ ] **Step 5: Commit**

```bash
git add packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/client.test.ts packages/gateway-sdk/src/api-schema.gen.ts packages/gateway-sdk/contract/openapi.json
git commit -m "feat(sdk): add event delivery read and answer receipts"
```

---

### Task 5: 文档、门禁与真机验收

**Files:**
- Modify: `docs/architecture/events.md`
- Create: `docs/releases/2026-11-17-receipts-and-domain-consumers.md`

- [ ] **Step 1: 更新架构文档**

- `read` / `answered` 的人类 HTTP 路由；`ack` 仍只由 Lead 回合写入。
- Lead / Standing Goal 从 domain event 取内容；decision/internal 回退 trigger。
- Standing 幂等键保持 `trigger.id`。

- [ ] **Step 2: 写 release note**

版本 `v5.1.0`、commit 列表、测试数、边界（ack 无 HTTP / Tech Lead 未迁）、回滚
（删两条路由 + consumer helper 回退 trigger）。

- [ ] **Step 3: 全量门禁**

Run: `cd gateway && npx tsc --noEmit -p tsconfig.json`
Run: `cd packages/gateway-sdk && npx tsc --noEmit -p tsconfig.json`
Run: `cd gateway && Remove-Item Env:OPENCODE_SERVER_PASSWORD -ErrorAction SilentlyContinue; npx jest --runInBand --forceExit`
Expected: 全部 0 failed。

- [ ] **Step 4: 构建**

Run: `cd gateway && npm run build`
Run: `cd packages/gateway-sdk && npm run build`
Expected: 通过。

- [ ] **Step 5: 真机验收**

重启后：
1. 用临时 webhook source 造一条 external delivery（复用 Phase 4 流程）；
2. 用 human token 调 `POST /api/event-deliveries/:id/read` → 200，outbox `read_at` 落库；
3. 调 `POST .../answer` → 200，outbox `answered_at` 落库；
4. 不带 human token 调 read → 403 `human_principal_required`；
5. 清理合成数据。

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/events.md docs/releases/2026-11-17-receipts-and-domain-consumers.md
git commit -m "docs: record receipt routes and domain event consumers"
```

---

## Phase 4b 退出标准

- `POST /api/event-deliveries/:id/read|answer` 人类专用，返回更新后的 delivery；错误映射 400/403/404/409/503。
- `ack` 没有 HTTP 路由；Lead 回合仍自动写入。
- Lead 外部播报与 Standing Goal 投递内容来自 `external:*` domain event；缺失时回退 trigger。
- Standing 幂等键仍是 `trigger.id`，重放不产生第二个 GoalRun。
- SDK 暴露 `readDelivery` / `answerDelivery`，契约门禁通过。
- gateway 全量 0 failed；gateway + SDK `tsc` / `build` 通过。
