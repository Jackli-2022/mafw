# Event Layer (P2.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a domain event layer (`Source → Trigger → Thread → Subscription → Decision → Delivery`) so Standing Goals, Goals and Lead can consume GitHub / cron / internal / webhook events with idempotency, thread affinity and auditable delivery.

**Architecture:** Persist events in the shared gateway SQLite database (`gateway/src/memory/gateway-db.ts`); keep normalization, thread assignment, delivery transitions and retry math as pure functions; `EventLayerService` orchestrates ingress / fan-out / evaluation / delivery. `AutomationEngine` owns polling schedules and emits into the layer; no LLM or network write runs in the ingress path.

**Tech Stack:** TypeScript, better-sqlite3, Node `fetch`, Jest, existing `RouteRegistry` / SDK / SolidJS desktop.

**Spec:** `docs/superpowers/specs/2026-11-10-event-layer-design.md`

## Global Constraints

- `MAFW_EVENT_LAYER` defaults **off**; every public route returns `503 { error: 'event layer disabled' }` when off.
- Ingress (normalize → dedupe → thread → trigger insert) must not call LLM, send network writes, parse large diffs, or hold a long transaction.
- `idempotency_key` is UNIQUE; duplicate delivery must not create a second trigger.
- One external key = one thread: `repo#<number>` for GitHub, `goal:<goalId>` for internal, `cron:<standingGoalId>` for cron.
- `work` subscriptions may create runs; `context` subscriptions are read-only and must never create a run.
- `person` events are never dropped by backpressure; bulk events may be coalesced/dropped only with an audit row.
- High-risk actions (merge / close / delete / protected branch / secrets) always require human confirmation and cannot be auto-approved by the event layer.
- No cross-project event routing; every source/thread carries `project_dir`.
- GitHub first version polls; webhook path must use the same normalize/thread pipeline.

## Review Focus

1. A GitHub delivery retried by the network must not create two triggers or two deliveries — `idempotency_key` and delivery uniqueness must both hold.
2. `pull_request.opened` and a later `synchronize` for the same repo/pr must land in the same thread and preserve order — otherwise Tech Lead sees a fragmented PR.
3. A `context` subscription must receive context but must never invoke the work delivery callback — a bug here silently grants execution rights.
4. A failed trigger insert must not advance the source cursor — otherwise events are lost on restart.
5. Delivery retry must cap at 1 minute and keep failures visible in `event_deliveries` — never silently drop.

---

### Task 1: Event types and SQLite store

**Files:**
- Create: `gateway/src/core/events/event-types.ts`
- Create: `gateway/src/core/events/event-store.ts`
- Modify: `gateway/src/memory/gateway-db.ts` (constructor schema block, near the other `CREATE TABLE IF NOT EXISTS` statements)
- Test: `gateway/tests/unit/events/event-store.test.ts`

**Interfaces:**
- Produces:
```ts
export type EventSourceKind = 'github' | 'cron' | 'internal' | 'webhook'
export type EventDisposition = 'pending' | 'evaluating' | 'accepted' | 'ignored' | 'fanned_out' | 'filtered'
export type EventDeliveryState = 'pending' | 'delivered' | 'read' | 'acknowledged' | 'answered' | 'handed_back' | 'failed' | 'dropped'
export type EventSubscriptionMode = 'work' | 'context'

export interface EventSourceRow {
  id: string; projectDir: string; kind: EventSourceKind; name: string;
  config: Record<string, unknown>; enabled: boolean; cursor: Record<string, unknown>;
  createdAt: string; updatedAt: string;
}
export interface EventThreadRow {
  id: string; sourceId: string; projectDir: string; externalKey: string; title: string;
  state: 'open' | 'closed' | 'archived'; lastTriggerAt: string | null; createdAt: string;
}
export interface EventTriggerRow {
  id: string; sourceId: string; threadId: string; externalId: string; kind: string;
  actor: string | null; payload: Record<string, unknown>;
  occurredAt: string; receivedAt: string; idempotencyKey: string; disposition: EventDisposition;
}
export interface EventSubscriptionRow {
  id: string; threadId: string; subscriberType: 'standing_goal' | 'goal' | 'lead';
  subscriberId: string; mode: EventSubscriptionMode; createdAt: string;
  expiresAt: string | null; droppedAt: string | null;
}
export interface EventDecisionRow {
  id: string; threadId: string; triggerIds: string[]; decision: 'accept' | 'ignore' | 'unavailable';
  mode: 'full' | 'report' | 'action' | 'skip' | null; goalRunId: string | null;
  rationale: string; decidedBy: string | null; createdAt: string;
}
export interface EventDeliveryRow {
  id: string; triggerId: string; subscriptionId: string; state: EventDeliveryState;
  attempts: number; lastError: string | null;
  deliveredAt: string | null; readAt: string | null; ackAt: string | null; answeredAt: string | null;
}
export interface EventChannelRow {
  id: string; threadId: string; kind: 'github_comment' | 'notification' | 'chat';
  address: Record<string, unknown>; createdAt: string;
}
export interface EventOutboxRow {
  id: string; channelId: string; dedupeKey: string; payload: Record<string, unknown>;
  state: 'pending' | 'sent' | 'failed' | 'dropped'; attempts: number;
  nextRetryAt: string | null; lastError: string | null; createdAt: string; updatedAt: string;
}
export interface EventEnvelope {
  projectDir: string; sourceId: string; sourceKind: EventSourceKind;
  externalId: string; externalKey: string; kind: string;
  actor: string | null; payload: Record<string, unknown>;
  occurredAt: string; receivedAt: string; idempotencyKey: string;
  title: string;
}

export class EventStore {
  constructor(db: import('better-sqlite3').Database)
  insertSource(input: { id: string; projectDir: string; kind: EventSourceKind; name: string; config: Record<string, unknown>; now: string }): EventSourceRow
  getSource(id: string): EventSourceRow | null
  listSources(projectDir: string): EventSourceRow[]
  updateSourceCursor(id: string, cursor: Record<string, unknown>, now: string): void
  setSourceEnabled(id: string, enabled: boolean, now: string): void
  ensureThread(input: { id: string; sourceId: string; projectDir: string; externalKey: string; title: string; now: string }): EventThreadRow
  getThread(id: string): EventThreadRow | null
  listThreads(projectDir: string, sourceId?: string): EventThreadRow[]
  insertTrigger(input: Omit<EventTriggerRow, 'disposition'> & { disposition?: EventDisposition }): { row: EventTriggerRow; duplicate: boolean }
  listTriggers(threadId: string): EventTriggerRow[]
  setTriggerDisposition(id: string, disposition: EventDisposition): void
  upsertSubscription(input: Omit<EventSubscriptionRow, 'createdAt' | 'expiresAt' | 'droppedAt'> & { now: string }): EventSubscriptionRow
  listSubscriptions(threadId: string): EventSubscriptionRow[]
  removeSubscription(id: string, now: string): void
  insertDecision(input: Omit<EventDecisionRow, 'createdAt'> & { now: string }): EventDecisionRow
  latestDecision(threadId: string): EventDecisionRow | null
  insertDelivery(input: Omit<EventDeliveryRow, 'attempts' | 'lastError' | 'deliveredAt' | 'readAt' | 'ackAt' | 'answeredAt'>): EventDeliveryRow
  getDelivery(id: string): EventDeliveryRow | null
  listDeliveries(threadId: string): EventDeliveryRow[]
  updateDelivery(id: string, patch: Partial<Pick<EventDeliveryRow, 'state' | 'attempts' | 'lastError' | 'deliveredAt' | 'readAt' | 'ackAt' | 'answeredAt'>>): EventDeliveryRow
  insertChannel(input: Omit<EventChannelRow, 'createdAt'> & { now: string }): EventChannelRow
  getChannel(id: string): EventChannelRow | null
  insertOutbox(input: Omit<EventOutboxRow, 'attempts' | 'nextRetryAt' | 'lastError' | 'createdAt' | 'updatedAt'> & { now: string }): EventOutboxRow
  listOutbox(state?: EventOutboxRow['state']): EventOutboxRow[]
  updateOutbox(id: string, patch: Partial<Pick<EventOutboxRow, 'state' | 'attempts' | 'nextRetryAt' | 'lastError' | 'updatedAt'>>): EventOutboxRow
}
```
- Tables: `event_sources`, `event_threads`, `event_triggers`, `event_subscriptions`, `event_decisions`, `event_deliveries`, `event_channels`, `event_outbox`; indexes from the spec (`event_threads(source_id, external_key)` UNIQUE, `event_triggers(idempotency_key)` UNIQUE, `event_subscriptions(thread_id, subscriber_type, subscriber_id)` UNIQUE, `event_deliveries(trigger_id, subscription_id)` UNIQUE, `event_outbox(channel_id, dedupe_key)` UNIQUE).

- [ ] **Step 1: Write the failing store test**

```ts
import Database from 'better-sqlite3'
import { EventStore } from '../../../src/core/events/event-store'

test('dedupes triggers by idempotency key and keeps one thread per external key', () => {
  const db = new Database(':memory:')
  const store = new EventStore(db)
  const source = store.insertSource({ id: 's1', projectDir: '/p', kind: 'github', name: 'repo', config: {}, now: '2026-11-10T00:00:00.000Z' })
  const thread = store.ensureThread({ id: 't1', sourceId: source.id, projectDir: '/p', externalKey: 'acme/app#42', title: 'PR 42', now: source.createdAt })
  const trigger = {
    id: 'tr1', sourceId: source.id, threadId: thread.id, externalId: 'd1', kind: 'pr_opened',
    actor: 'alice', payload: { number: 42 }, occurredAt: source.createdAt, receivedAt: source.createdAt,
    idempotencyKey: 'github:d1',
  }
  expect(store.insertTrigger(trigger).duplicate).toBe(false)
  expect(store.insertTrigger({ ...trigger, id: 'tr2' }).duplicate).toBe(true)
  expect(store.listTriggers(thread.id)).toHaveLength(1)
  expect(store.ensureThread({ id: 't2', sourceId: source.id, projectDir: '/p', externalKey: 'acme/app#42', title: 'again', now: source.createdAt }).id).toBe('t1')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/events/event-store.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the schema and store implementation**

Add the eight tables via an exported `ensureEventLayerSchema(db)` helper in `event-store.ts`; call it from both `EventStore`'s constructor (tests use a raw `Database`) and `GatewayDatabase`'s constructor so a fresh gateway DB already has the tables. Use `INSERT OR IGNORE` for triggers/subscriptions/outbox, then read back the row; `duplicate` is `changes === 0`. Parse JSON columns (`config`, `cursor`, `payload`, `triggerIds`, `address`) through small helpers that fall back to `{}` / `[]`.

- [ ] **Step 4: Run test to verify it passes**

Run: same command; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/events/event-types.ts gateway/src/core/events/event-store.ts gateway/src/memory/gateway-db.ts gateway/tests/unit/events/event-store.test.ts
git commit -m "feat(events): add domain event store"
```

---

### Task 2: Normalize events and assign threads

**Files:**
- Create: `gateway/src/core/events/event-normalize.ts`
- Test: `gateway/tests/unit/events/event-normalize.test.ts`

**Interfaces:**
- Consumes: `EventEnvelope`, `EventSourceKind` from Task 1.
- Produces:
```ts
export function normalizeGitHubEvent(input: {
  projectDir: string; sourceId: string; deliveryId: string; event: string; action: string;
  repo: string; number: number; actor: string | null; payload: Record<string, unknown>;
  occurredAt: string; receivedAt: string;
}): EventEnvelope
export function normalizeCronTick(input: {
  projectDir: string; sourceId: string; standingGoalId: string; scheduledAt: string; actualAt: string;
}): EventEnvelope
export function normalizeInternalEvent(input: {
  projectDir: string; sourceId: string; eventId: string; kind: string; aggregateId: string;
  actor: string | null; payload: Record<string, unknown>; occurredAt: string; receivedAt: string;
}): EventEnvelope
```

- [ ] **Step 1: Write failing tests**

```ts
test('maps a PR opened delivery to one repo#number thread', () => {
  const out = normalizeGitHubEvent({
    projectDir: '/p', sourceId: 's1', deliveryId: 'd1', event: 'pull_request', action: 'opened',
    repo: 'acme/app', number: 42, actor: 'alice', payload: { title: 'Fix' },
    occurredAt: '2026-11-10T00:00:00.000Z', receivedAt: '2026-11-10T00:00:01.000Z',
  })
  expect(out).toMatchObject({ kind: 'pr_opened', externalKey: 'acme/app#42', idempotencyKey: 'github:d1' })
})

test('cron ticks use a synthetic cron thread and stable key', () => {
  expect(normalizeCronTick({ projectDir: '/p', sourceId: 's1', standingGoalId: 'sg1', scheduledAt: '2026-11-10T00:00:00.000Z', actualAt: '2026-11-10T00:00:02.000Z' }))
    .toMatchObject({ kind: 'cron_tick', externalKey: 'cron:sg1', idempotencyKey: 'cron:sg1:2026-11-10T00:00:00.000Z' })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/events/event-normalize.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure normalizers**

Map GitHub `pull_request.opened` → `pr_opened`, `pull_request.synchronize` → `pr_sync`, `pull_request.review_submitted` → `pr_review`, `issue_comment.created` → `pr_comment` / `issue_comment` by whether the issue has a `pull_request` field, `issues.opened` → `issue_opened`, `check_run.completed` → `ci_status`. Use `repo#number` as `externalKey`; precedence `github:<deliveryId>` for idempotency. Internal events use `goal:<aggregateId>` or `project:<dir>`; cron uses `cron:<standingGoalId>`.

- [ ] **Step 4: Run tests to verify they pass**

Run: same command; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/events/event-normalize.ts gateway/tests/unit/events/event-normalize.test.ts
git commit -m "feat(events): normalize external events and assign threads"
```

---

### Task 3: Ingress service

**Files:**
- Create: `gateway/src/core/events/event-layer-service.ts`
- Test: `gateway/tests/unit/events/event-layer-service.test.ts`

**Interfaces:**
- Consumes: `EventStore`, `EventEnvelope`, `normalize*`.
- Produces:
```ts
export interface EventLayerDeps {
  store: EventStore
  now(): string
  newId(prefix: string): string
  broadcast(event: { type: string; properties?: Record<string, unknown> }): void
  enabled(): boolean
  admit?(envelope: EventEnvelope): ReturnType<typeof admitIngress>
  log?(message: string): void
}
export class EventLayerError extends Error {
  constructor(public readonly status: number, message: string)
}
export class EventLayerService {
  constructor(deps: EventLayerDeps)
  createSource(input: { projectDir: string; kind: EventSourceKind; name: string; config: Record<string, unknown> }): EventSourceRow
  setSourceEnabled(id: string, enabled: boolean): EventSourceRow
  listSources(projectDir: string): EventSourceRow[]
  ingest(envelope: EventEnvelope): { trigger: EventTriggerRow; thread: EventThreadRow; duplicate: boolean }
  subscribe(input: { threadId: string; subscriberType: EventSubscriptionRow['subscriberType']; subscriberId: string; mode: EventSubscriptionMode; expiresAt?: string | null }): EventSubscriptionRow
  listSubscriptions(threadId: string): EventSubscriptionRow[]
  listThreads(projectDir: string): EventThreadRow[]
  listTriggers(threadId: string): EventTriggerRow[]
  listDeliveries(threadId: string): EventDeliveryRow[]
}
export function admitIngress(input: {
  queueDepth: number; person: boolean; tokens: number; maxQueueDepth?: number
}): { ok: true } | { ok: false; reason: 'queue_full' | 'rate_limited' }
```
`EventLayerDeps` gains `admit?(envelope: EventEnvelope): ReturnType<typeof admitIngress>`; default allows.

- [ ] **Step 1: Write failing tests**

```ts
test('ingest is idempotent and emits one received event', () => {
  const h = harness()
  const first = h.service.ingest(envelope({ idempotencyKey: 'k1' }))
  const second = h.service.ingest(envelope({ idempotencyKey: 'k1' }))
  expect(first.duplicate).toBe(false)
  expect(second.duplicate).toBe(true)
  expect(h.broadcast).toHaveBeenCalledTimes(1)
  expect(h.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'event.trigger.received' }))
})

test('disabled layer refuses ingest', () => {
  const h = harness({ enabled: () => false })
  expect(() => h.service.ingest(envelope())).toThrow('event layer disabled')
})

test('person events are admitted even when the queue is full', () => {
  expect(admitIngress({ queueDepth: 100, person: true, tokens: 0, maxQueueDepth: 100 })).toEqual({ ok: true })
  expect(admitIngress({ queueDepth: 100, person: false, tokens: 10, maxQueueDepth: 100 }))
    .toMatchObject({ ok: false, reason: 'queue_full' })
  expect(admitIngress({ queueDepth: 0, person: false, tokens: 0, maxQueueDepth: 100 }))
    .toMatchObject({ ok: false, reason: 'rate_limited' })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/events/event-layer-service.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ingest / subscription / read methods**

`ingest` calls `deps.admit?.(envelope) ?? { ok: true }`; a false result throws `EventLayerError(429, reason)` and writes no trigger. It then calls `store.ensureThread` with `externalKey`, inserts the trigger, updates thread `last_trigger_at`, and broadcasts only for a non-duplicate. `admitIngress` treats `person` events as always admitted; non-person events check the thread queue cap first and the source token bucket second. `createSource` inserts a source (default enabled) and `setSourceEnabled` updates it. `subscribe` uses `store.upsertSubscription`; `list*` delegate to the store.

- [ ] **Step 4: Run tests to verify they pass**

Run: same command; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/events/event-layer-service.ts gateway/tests/unit/events/event-layer-service.test.ts
git commit -m "feat(events): add idempotent ingress and subscriptions"
```

---

### Task 4: Fan-out and Tech Lead evaluation

**Files:**
- Create: `gateway/src/core/events/event-evaluator.ts`
- Modify: `gateway/src/core/events/event-layer-service.ts`
- Test: `gateway/tests/unit/events/event-fanout.test.ts`

**Interfaces:**
- Produces:
```ts
export interface EventEvaluationInput {
  thread: EventThreadRow
  triggers: EventTriggerRow[]
  subscriptions: EventSubscriptionRow[]
  recentDecisions: EventDecisionRow[]
}
export interface EventDecision {
  decision: 'accept' | 'ignore' | 'unavailable'
  mode?: 'full' | 'report' | 'action' | 'skip'
  rationale: string
  requiresApproval?: boolean
}
export type EventEvaluator = (input: EventEvaluationInput) => Promise<EventDecision>
```
- `EventLayerDeps` gains `evaluate: EventEvaluator` and `deliverWork?(input: { thread; trigger; subscription; decision }): Promise<void>`.
- `EventLayerService.fanOut(threadId): EventDeliveryRow[]` and `EventLayerService.evaluate(threadId): Promise<EventDecisionRow | null>`.

- [ ] **Step 1: Write failing tests**

```ts
test('work and context both get deliveries, but only work invokes execution', async () => {
  const h = harness()
  h.service.subscribe({ threadId: 't1', subscriberType: 'standing_goal', subscriberId: 'sg1', mode: 'work' })
  h.service.subscribe({ threadId: 't1', subscriberType: 'lead', subscriberId: 'lead1', mode: 'context' })
  h.service.ingest(envelope({ idempotencyKey: 'k1' }))
  const deliveries = h.service.fanOut('t1')
  expect(deliveries).toHaveLength(2)
  await h.service.evaluate('t1')
  expect(h.deliverWork).toHaveBeenCalledTimes(1)
  expect(h.deliverWork.mock.calls[0][0].subscription.mode).toBe('work')
})

test('same trigger set is evaluated once', async () => {
  const h = harness()
  h.service.ingest(envelope({ idempotencyKey: 'k1' }))
  const first = await h.service.evaluate('t1')
  const second = await h.service.evaluate('t1')
  expect(second?.id).toBe(first?.id)
  expect(h.evaluate).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/events/event-fanout.test.ts --runInBand --forceExit`
Expected: FAIL — `fanOut` / `evaluate` not defined.

- [ ] **Step 3: Implement fan-out and evaluation**

`fanOut` creates one delivery per subscription for every `pending` trigger, sets trigger disposition to `fanned_out`, and broadcasts `event.thread.updated`. `evaluate` collects `pending`/`fanned_out` triggers, returns the latest decision when the same trigger-id set was already decided, otherwise calls `deps.evaluate`, inserts the decision, marks accepted/ignored, calls `deps.deliverWork` for `work` subscriptions only, and broadcasts `event.decision.made`.

- [ ] **Step 4: Run tests to verify they pass**

Run: same command; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/events/event-evaluator.ts gateway/src/core/events/event-layer-service.ts gateway/tests/unit/events/event-fanout.test.ts
git commit -m "feat(events): fan out subscriptions and persist Tech Lead decisions"
```

---

### Task 5: Delivery state machine, channel outbox and retry

**Files:**
- Create: `gateway/src/core/events/event-delivery.ts`
- Create: `gateway/src/core/events/event-outbox.ts`
- Test: `gateway/tests/unit/events/event-delivery.test.ts`, `gateway/tests/unit/events/event-outbox.test.ts`

**Interfaces:**
- Produces:
```ts
export const DELIVERY_STATES: readonly EventDeliveryState[]
export function canTransition(from: EventDeliveryState, to: EventDeliveryState): boolean
export function nextRetryDelayMs(attempt: number): number // 2s → 1min
export function applyDeliveryTransition(
  current: EventDeliveryRow,
  next: EventDeliveryState,
  now: string,
): Pick<EventDeliveryRow, 'state' | 'deliveredAt' | 'readAt' | 'ackAt' | 'answeredAt'>

export function nextChannelRetryAt(attempt: number, now: string): string // 5s → 300s
export class EventOutbox {
  constructor(deps: { store: EventStore; now(): string })
  enqueue(input: { channelId: string; dedupeKey: string; payload: Record<string, unknown> }): EventOutboxRow
  markSent(id: string): EventOutboxRow
  markFailed(id: string, error: string): EventOutboxRow
  pending(): EventOutboxRow[]
}
```

- [ ] **Step 1: Write failing tests**

```ts
test('allows the delivery lifecycle and rejects backwards moves', () => {
  expect(canTransition('pending', 'delivered')).toBe(true)
  expect(canTransition('delivered', 'read')).toBe(true)
  expect(canTransition('read', 'acknowledged')).toBe(true)
  expect(canTransition('acknowledged', 'answered')).toBe(true)
  expect(canTransition('answered', 'pending')).toBe(false)
})

test('retry backs off from 2s to a 1min cap', () => {
  expect(nextRetryDelayMs(1)).toBe(2_000)
  expect(nextRetryDelayMs(2)).toBe(4_000)
  expect(nextRetryDelayMs(10)).toBe(60_000)
})

test('outbox retries channel sends and keeps the failure visible', () => {
  const db = new Database(':memory:')
  const store = new EventStore(db)
  const outbox = new EventOutbox({ store, now: () => '2026-11-10T00:00:00.000Z' })
  const row = outbox.enqueue({ channelId: 'ch1', dedupeKey: 'pr42:comment', payload: { body: 'hi' } })
  expect(row.state).toBe('pending')
  expect(outbox.markFailed(row.id, 'offline').state).toBe('failed')
  expect(outbox.pending()).toHaveLength(0)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/events/event-delivery.test.ts tests/unit/events/event-outbox.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement transitions, retry math and outbox**

Allowed chain: `pending → delivered → read → acknowledged → answered`; `pending/delivered/read/acknowledged → failed/dropped`; `failed → pending` only for an explicit retry. Timestamp is written only for the state being entered. Channel retry is `5s * 2^(attempt-1)` capped at 300s; `failed` rows stay visible and `pending()` returns only retryable rows whose `nextRetryAt` has passed.

- [ ] **Step 4: Run tests to verify they pass**

Run: same command; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/events/event-delivery.ts gateway/src/core/events/event-outbox.ts gateway/tests/unit/events/event-delivery.test.ts gateway/tests/unit/events/event-outbox.test.ts
git commit -m "feat(events): add delivery state machine and channel outbox"
```

---

### Task 6: GitHub source poller

**Files:**
- Create: `gateway/src/core/events/sources/github-source.ts`
- Test: `gateway/tests/unit/events/github-source.test.ts`

**Interfaces:**
- Produces:
```ts
export interface GitHubSourceConfig {
  repo: string; token?: string; labels?: string[]; branches?: string[]; authors?: string[];
  cursor?: { issuesSince?: string; commentsSince?: string; reviewsSince?: string; checksSince?: string };
}
export interface GitHubPollResult {
  envelopes: EventEnvelope[]
  cursor: NonNullable<GitHubSourceConfig['cursor']>
}
export async function pollGitHubSource(input: {
  projectDir: string; sourceId: string; config: GitHubSourceConfig;
  fetchImpl?: typeof fetch; now(): string;
}): Promise<GitHubPollResult>
```

- [ ] **Step 1: Write failing tests**

```ts
test('normalizes an opened PR and advances the issue cursor', async () => {
  const fetchImpl = jest.fn(async () => ({
    ok: true,
    json: async () => [{
      number: 42, title: 'Fix', state: 'open', updated_at: '2026-11-10T00:00:02.000Z',
      created_at: '2026-11-10T00:00:00.000Z', user: { login: 'alice' },
      pull_request: { html_url: 'https://github.com/acme/app/pull/42' },
    }],
  })) as any
  const out = await pollGitHubSource({
    projectDir: '/p', sourceId: 's1', config: { repo: 'acme/app' },
    fetchImpl, now: () => '2026-11-10T00:00:03.000Z',
  })
  expect(out.envelopes[0]).toMatchObject({ kind: 'pr_opened', externalKey: 'acme/app#42' })
  expect(out.cursor.issuesSince).toBe('2026-11-10T00:00:02.000Z')
})

test('ignores bot authors and filtered labels', async () => {
  const fetchImpl = jest.fn(async () => ({
    ok: true,
    json: async () => [{ number: 1, title: 'x', user: { login: 'dependabot[bot]' }, pull_request: {}, labels: [] }],
  })) as any
  const out = await pollGitHubSource({ projectDir: '/p', sourceId: 's1', config: { repo: 'acme/app', authors: ['alice'] }, fetchImpl, now: () => '2026-11-10T00:00:00.000Z' })
  expect(out.envelopes).toEqual([])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/events/github-source.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the poller**

Use `fetchImpl` for `GET https://api.github.com/repos/{repo}/issues?state=all&sort=updated&direction=asc&since=...`, `GET /repos/{repo}/issues/comments?since=...`, `GET /repos/{repo}/pulls?state=all&sort=updated&direction=asc`, and `GET /repos/{repo}/actions/runs?created=>=...` (CI). Normalize through Task 2. Filter `labels` / `branches` / `authors`, drop `[bot]` actors unless explicitly allowed. Cursor is written only after the caller persists the envelopes.

- [ ] **Step 4: Run tests to verify they pass**

Run: same command; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/events/sources/github-source.ts gateway/tests/unit/events/github-source.test.ts
git commit -m "feat(events): poll GitHub sources with cursor and filters"
```

---

### Task 7: Route surface, feature gate and wiring

**Files:**
- Create: `gateway/src/routes/events.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/routes/events.test.ts`

**Interfaces:**
- Produces route handlers:
```ts
export interface EventRouteDeps {
  enabled(): boolean
  sources: { list(projectDir: string): EventSourceRow[]; create(input: unknown): EventSourceRow; setEnabled(id: string, enabled: boolean): void }
  threads: { list(projectDir: string, sourceId?: string): EventThreadRow[]; triggers(threadId: string): EventTriggerRow[]; subscriptions(threadId: string): EventSubscriptionRow[] }
  subscribe(input: unknown): EventSubscriptionRow
  unsubscribe(id: string): void
  deliveries(threadId: string): EventDeliveryRow[]
  webhook(sourceId: string, headers: Record<string, string | undefined>, body: unknown): Promise<{ accepted: boolean; duplicate?: boolean }>
}
```
- Routes: `GET/POST /api/event-sources`, `PATCH /api/event-sources/:id`, `GET /api/event-threads`, `GET /api/event-threads/:id/triggers`, `GET/POST /api/event-threads/:id/subscriptions`, `DELETE /api/event-subscriptions/:id`, `GET /api/event-deliveries`, `POST /api/event-sources/:id/webhook`.
- Operation ids: `events.sources.list`, `events.sources.create`, `events.sources.patch`, `events.threads.list`, `events.threads.triggers`, `events.threads.subscriptions.list`, `events.threads.subscriptions.create`, `events.subscriptions.delete`, `events.deliveries.list`, `events.webhook.receive`.

- [ ] **Step 1: Write failing route tests**

```ts
test('returns 503 when the event layer is off', () => {
  expect(handleListSources({ projectDir: '/p' }, deps({ enabled: () => false })).status).toBe(503)
})

test('creates a source and rejects an unknown kind', () => {
  expect(handleCreateSource({ kind: 'nope' }, deps()).status).toBe(400)
  expect(handleCreateSource({ kind: 'github', projectDir: '/p', name: 'repo', config: { repo: 'acme/app' } }, deps()).status).toBe(200)
})

test('webhook verifies the HMAC signature', async () => {
  const out = await handleWebhook({ id: 's1' }, { 'x-hub-signature-256': 'bad' }, {}, deps())
  expect(out.status).toBe(401)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/routes/events.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement handlers, catalog and wiring**

Add routes to `route-catalog.ts`; wire `EventLayerService` in `MafwScheduler.start()` after `automationEngine` is constructed and before `automationEngine.start()`. Register a GitHub poll action `event:github_poll` and a cron action `event:cron_tick`; they call `pollGitHubSource` / `normalizeCronTick` and `ingest`. Subscribe to the internal `eventBus` events (`goal.created`, `goal.phase`, `goal.result`, `memory.*`, `presence.*`) and ingest them as `internal` source envelopes; a source poll failure broadcasts `event.source.error`. The GitHub action reads `source.cursor`, ingests every envelope, and only calls `store.updateSourceCursor` after all ingests succeed; a failed ingest leaves the cursor unchanged so the next poll retries. Gate all routes with `MAFW_EVENT_LAYER === '1'`. Webhook uses `crypto.createHmac('sha256', secret)` and timing-safe compare.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix gateway -- tests/unit/routes/events.test.ts --runInBand --forceExit`; Expected: PASS.
Run: `cd gateway && npx ts-node --project tsconfig.json scripts/emit-openapi.ts`; Expected: route count increases and the contract regenerates.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/events.ts gateway/src/routes/route-catalog.ts gateway/src/index.ts gateway/tests/unit/routes/events.test.ts packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts
git commit -m "feat(events): expose event source, thread and delivery APIs"
```

---

### Task 8: SDK, preload and developer diagnostics

**Files:**
- Modify: `packages/gateway-sdk/src/types.ts`, `packages/gateway-sdk/src/client.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`, `packages/desktop/src/preload/mafw-api.ts`
- Create: `packages/desktop/src/renderer/mafw/components/EventLayerSection.tsx`
- Modify: `packages/desktop/src/renderer/mafw/pages/Config.tsx`
- Test: `packages/desktop/tests/event-layer-wiring.test.ts`

**Interfaces:**
- View types (mirror the server rows; hide secrets/tokens):
```ts
export type EventSourceView = Pick<EventSourceRow, 'id' | 'kind' | 'name' | 'enabled' | 'cursor' | 'updatedAt'>
export type EventThreadView = Pick<EventThreadRow, 'id' | 'sourceId' | 'externalKey' | 'title' | 'state' | 'lastTriggerAt'>
export type EventTriggerView = Pick<EventTriggerRow, 'id' | 'kind' | 'actor' | 'occurredAt' | 'disposition'>
export type EventSubscriptionView = Pick<EventSubscriptionRow, 'id' | 'subscriberType' | 'subscriberId' | 'mode' | 'createdAt'>
export type EventDeliveryView = Pick<EventDeliveryRow, 'id' | 'state' | 'attempts' | 'lastError' | 'deliveredAt' | 'answeredAt'>
```
- SDK namespace:
```ts
events: {
  sources(input?: { projectDir?: string }): Promise<{ items: EventSourceView[] }>
  createSource(input: { projectDir: string; kind: 'github' | 'webhook'; name: string; config: Record<string, unknown> }): Promise<EventSourceView>
  setSourceEnabled(id: string, enabled: boolean): Promise<{ ok: boolean }>
  threads(input?: { projectDir?: string; sourceId?: string }): Promise<{ items: EventThreadView[] }>
  triggers(threadId: string): Promise<{ items: EventTriggerView[] }>
  subscriptions(threadId: string): Promise<{ items: EventSubscriptionView[] }>
  subscribe(threadId: string, input: { subscriberType: string; subscriberId: string; mode: 'work' | 'context' }): Promise<EventSubscriptionView>
  unsubscribe(id: string): Promise<{ ok: boolean }>
  deliveries(threadId: string): Promise<{ items: EventDeliveryView[] }>
}
```

- [ ] **Step 1: Write failing wiring test**

```ts
test('developer event section reads sources and deliveries without session ids', () => {
  const source = read('../src/renderer/mafw/components/EventLayerSection.tsx')
  assert.match(source, /events\.sources/)
  assert.match(source, /events\.deliveries/)
  assert.doesNotMatch(source, /ses_[a-zA-Z0-9]+/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix packages/desktop 2>&1 | Select-Object -Last 8`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement SDK/preload and the read-only diagnostics section**

Add the SDK calls and preload bridges. `EventLayerSection` lists sources, threads and deliveries with a refresh button, no mutations except source enable/disable. Render it from `ConfigPage` under a developer-only section. Never render `session_id` / raw tokens.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix packages/desktop 2>&1 | Select-Object -Last 8`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.ts packages/desktop/src/preload/mafw-types.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/src/renderer/mafw/components/EventLayerSection.tsx packages/desktop/src/renderer/mafw/pages/Config.tsx packages/desktop/tests/event-layer-wiring.test.ts
git commit -m "feat(events): expose SDK and developer diagnostics"
```

---

### Task 9: Integration, docs and release record

**Files:**
- Create: `gateway/tests/integration/event-layer.test.ts`
- Create: `docs/architecture/events.md`
- Modify: `docs/architecture/gateway.md` (subsystem map line)
- Create: `docs/releases/2026-11-10-event-layer.md`

- [ ] **Step 1: Write the failing integration test**

```ts
test('PR opened -> one thread -> work delivery -> Tech Lead accept -> delivery audit', async () => {
  const h = integrationHarness()
  h.service.ingest(normalizeGitHubEvent({ ...base, action: 'opened' }))
  h.service.subscribe({ threadId: 't1', subscriberType: 'standing_goal', subscriberId: 'sg1', mode: 'work' })
  h.service.fanOut('t1')
  await h.service.evaluate('t1')
  expect(h.service.listThreads('/p')).toHaveLength(1)
  expect(h.service.listDeliveries('t1')[0]).toMatchObject({ state: 'delivered' })
  expect(h.deliverWork).toHaveBeenCalledTimes(1)
  expect(h.store.latestDecision('t1')).toMatchObject({ decision: 'accept' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/integration/event-layer.test.ts --runInBand --forceExit`
Expected: FAIL — missing fixture or behavior.

- [ ] **Step 3: Implement the integration fixture and docs**

Use a temp SQLite database and a fake evaluator that returns `{ decision: 'accept', mode: 'full', rationale: 'new PR' }`. Document the ingress/softirq split, tables, feature flags, and the deferred `reviews/CI` polling extensions.

- [ ] **Step 4: Run the full gate**

Run:
```bash
npm test --prefix gateway -- --runInBand --forceExit --testTimeout=30000
npm test -w @mafw/sdk
npm test --prefix packages/desktop
npx jest --runInBand --forceExit
cd gateway && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/integration/event-layer.test.ts docs/architecture/events.md docs/architecture/gateway.md docs/releases/2026-11-10-event-layer.md
git commit -m "test(events): cover PR ingress to delivery; docs and release record"
```
