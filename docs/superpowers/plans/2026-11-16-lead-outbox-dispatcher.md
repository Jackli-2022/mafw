# Lead Outbox + Dispatcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Lead 的 decision 播报从“event layer 内直接 `promptAsync`”改成“耐久 outbox + 单 dispatcher + 批量/预算/重试”，避免决定一多就刷屏、失败即丢、重启不可恢复。

**Architecture:** `deliverContext` 只负责把已渲染的 decision 消息写入 `event_outbox`（每个 Pod 一个 `chat` channel）；`LeadOutbox` 每 5s 取 pending rows，按 channel 批量合并、按预算/最小间隔节流、解析 Lead session 后一次 `promptAsync`，成功逐行标记 `sent`，失败按退避标记 `failed`。P0 不合并 `PodEventWake`，不实现 read/ack，不加新表。

**Tech Stack:** TypeScript、better-sqlite3、Jest、现有 `EventStore` / `EventOutbox` / `TimerService` / `PodService`。

**Spec:** `docs/research/2026-11-16-always-on-agents-event-layer-research.md` §6 P0

## Global Constraints

- 不改 human-only 门：验收 / 计划批准 / 方向裁定 / 确认决定仍是人类专属。
- `deliverContext` 仍是 **context** 投递，不创建 GoalRun，不给 Lead 执行权。
- 事件层默认开启，Lead outbox 默认开启；不新增必需 env。
- 复用 `event_outbox` / `event_channels`，不新增表。
- 去重键固定 `decision:<recordId>`；同一决定不重复播报。
- 默认预算：`maxPerHour=6`、`maxBatch=5`、`minIntervalMs=60_000`。
- P0 明确不做：`PodEventWake` 合并、agent-set timers、read/ack、watchdog、per-run memory。
- 不改桌面渲染；Lead 消息仍进入现有 chat。

## Review Focus

- 一次 dispatch 合并多条决定时，**每一条**都必须被标记 `sent`；不能只发第一条。
- `promptAsync` 失败时，整批 rows 必须进 `failed` 并可重试；不能标 `sent`。
- 同一 `recordId` 重复 enqueue 不得产生第二条 outbox row。
- 预算/最小间隔只允许**延迟** pending rows，不允许丢弃或标 `sent`。
- gateway 重启后，已 `sent` 的 rows 不得重发；`pending` / 到期 `failed` 必须继续。

---

## File Structure

- Create: `gateway/src/core/lead/lead-outbox-model.ts` — 纯函数：payload 解析、批量选择、消息合并。
- Create: `gateway/src/core/lead/lead-outbox.ts` — `LeadOutbox` service：channel、enqueue、dispatch、timer。
- Create: `gateway/tests/unit/lead/lead-outbox-model.test.ts`
- Create: `gateway/tests/unit/lead/lead-outbox.test.ts`
- Create: `gateway/tests/unit/lead/lead-outbox-wiring.test.ts`
- Modify: `gateway/src/kernel.ts` — construct/start/stop、`deliverContext` 改 enqueue。
- Modify: `docs/architecture/events.md` — 现状加 Lead outbox 段。
- Create: `docs/releases/2026-11-16-lead-outbox-dispatcher.md`

---

### Task 1: Lead outbox batch model

**Files:**
- Create: `gateway/src/core/lead/lead-outbox-model.ts`
- Test: `gateway/tests/unit/lead/lead-outbox-model.test.ts`

**Interfaces:**
- Consumes: `EventOutboxRow` from `../events/event-types`.
- Produces:
  - `type LeadOutboxPriority = 'p1' | 'p2' | 'p3'`
  - `interface LeadOutboxPayload { kind: 'decision'; priority: LeadOutboxPriority; text: string; podId: string; goalId: string | null; recordId: string; createdAt: string }`
  - `interface LeadOutboxPolicy { maxPerHour: number; maxBatch: number; minIntervalMs: number }`
  - `const DEFAULT_LEAD_OUTBOX_POLICY: LeadOutboxPolicy`
  - `function leadOutboxPayload(row: EventOutboxRow): LeadOutboxPayload | null`
  - `function selectLeadOutboxBatch(input: { rows: EventOutboxRow[]; now: number; policy: LeadOutboxPolicy; sentBatchesLastHour: number; lastSentAt: number | null }): { rows: EventOutboxRow[]; reason: 'ok' | 'empty' | 'budget' | 'interval' }`
  - `function renderLeadOutboxBatch(rows: EventOutboxRow[]): string`

- [ ] **Step 1: Write the failing model tests**

```ts
import { EventOutboxRow } from '../../../src/core/events/event-types';
import {
  DEFAULT_LEAD_OUTBOX_POLICY,
  leadOutboxPayload,
  renderLeadOutboxBatch,
  selectLeadOutboxBatch,
} from '../../../src/core/lead/lead-outbox-model';

function row(over: Partial<EventOutboxRow> = {}): EventOutboxRow {
  return {
    id: 'o1', channelId: 'lead:pod1', dedupeKey: 'decision:rec1',
    payload: {
      kind: 'decision', priority: 'p2', text: '[LEAD EVENT] one',
      podId: 'pod1', goalId: 'g1', recordId: 'rec1',
      createdAt: '2026-11-16T00:00:00.000Z',
    },
    state: 'pending', attempts: 0, nextRetryAt: null, lastError: null,
    createdAt: '2026-11-16T00:00:00.000Z', updatedAt: '2026-11-16T00:00:00.000Z',
    ...over,
  };
}

test('parses a valid decision payload and rejects malformed ones', () => {
  expect(leadOutboxPayload(row())).toMatchObject({ recordId: 'rec1', priority: 'p2' });
  expect(leadOutboxPayload(row({ payload: {} as any }))).toBeNull();
  expect(leadOutboxPayload(row({ payload: { ...row().payload, kind: 'other' } as any }))).toBeNull();
});

test('selects a batch in priority/created order and enforces maxBatch', () => {
  const rows = [
    row({ id: 'o2', createdAt: '2026-11-16T00:00:02.000Z' }),
    row({ id: 'o1', createdAt: '2026-11-16T00:00:01.000Z' }),
  ];
  const picked = selectLeadOutboxBatch({
    rows, now: Date.parse('2026-11-16T00:00:10.000Z'),
    policy: { ...DEFAULT_LEAD_OUTBOX_POLICY, maxBatch: 1 },
    sentBatchesLastHour: 0, lastSentAt: null,
  });
  expect(picked.reason).toBe('ok');
  expect(picked.rows.map((r) => r.id)).toEqual(['o1']);
});

test('defers on budget or interval without dropping rows', () => {
  const rows = [row()];
  expect(selectLeadOutboxBatch({
    rows, now: 1000, policy: DEFAULT_LEAD_OUTBOX_POLICY,
    sentBatchesLastHour: DEFAULT_LEAD_OUTBOX_POLICY.maxPerHour, lastSentAt: null,
  }).reason).toBe('budget');
  expect(selectLeadOutboxBatch({
    rows, now: 1000, policy: DEFAULT_LEAD_OUTBOX_POLICY,
    sentBatchesLastHour: 0, lastSentAt: 1000 - DEFAULT_LEAD_OUTBOX_POLICY.minIntervalMs + 1,
  }).reason).toBe('interval');
});

test('renders one message for a batch and labels multiple decisions', () => {
  expect(renderLeadOutboxBatch([row()])).toBe('[LEAD EVENT] one');
  const merged = renderLeadOutboxBatch([
    row({ id: 'o1' }),
    row({ id: 'o2', payload: { ...row().payload, recordId: 'rec2', text: '[LEAD EVENT] two' } as any }),
  ]);
  expect(merged).toContain('2 条待确认');
  expect(merged).toContain('rec1');
  expect(merged).toContain('rec2');
});
```

- [ ] **Step 2: Run the model test to verify it fails**

Run: `npx jest --runInBand tests/unit/lead/lead-outbox-model.test.ts`
Expected: FAIL with module/export not found.

- [ ] **Step 3: Implement the model**

Implement the types and three functions. Rules:
- `leadOutboxPayload` returns null unless `kind === 'decision'`, `text`/`podId`/`recordId` non-empty, priority in `p1|p2|p3`; missing priority defaults `p2`.
- `selectLeadOutboxBatch`: filter valid payloads; sort `p1 < p2 < p3` then `createdAt`; return `budget` before `interval` before selecting; `empty` if no valid rows; take `maxBatch`.
- `renderLeadOutboxBatch`: single row → its `text`; multiple → `[LEAD EVENT] ${n} 条待确认\n\n` + `--- ${i+1} ---\n${text}` joined by blank lines.

- [ ] **Step 4: Run the model test to verify it passes**

Run: `npx jest --runInBand tests/unit/lead/lead-outbox-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/lead/lead-outbox-model.ts gateway/tests/unit/lead/lead-outbox-model.test.ts
git commit -m "feat(lead): add outbox batch model"
```

---

### Task 2: LeadOutbox service

**Files:**
- Create: `gateway/src/core/lead/lead-outbox.ts`
- Test: `gateway/tests/unit/lead/lead-outbox.test.ts`

**Interfaces:**
- Consumes: `EventStore`, `EventOutbox`, `LeadOutboxPolicy`, `leadOutboxPayload`, `selectLeadOutboxBatch`, `renderLeadOutboxBatch`.
- Produces:
  - `interface LeadOutboxDeps { store: EventStore; outbox: EventOutbox; now(): string; newId(prefix: string): string; ensureLead(podId: string): Promise<{ sessionId: string }>; promptAsync(input: { sessionID: string; text: string }): Promise<void>; timers: { every(name: string, ms: number, fn: () => void): { clear(): void } }; policy?: Partial<LeadOutboxPolicy>; log?(message: string): void }`
  - `class LeadOutbox`
    - `start(): void`
    - `stop(): void`
    - `enqueueDecision(input: { podId: string; recordId: string; goalId?: string | null; text: string; priority?: 'p1' | 'p2' | 'p3' }): EventOutboxRow`
    - `dispatch(): Promise<{ sent: number; deferred: number; failed: number }>`
    - `status(): { pending: number; sent: number; failed: number }`

- [ ] **Step 1: Write failing service tests**

```ts
import Database from 'better-sqlite3';
import { EventStore } from '../../../src/core/events/event-store';
import { EventOutbox } from '../../../src/core/events/event-outbox';
import { LeadOutbox } from '../../../src/core/lead/lead-outbox';

function harness() {
  const db = new Database(':memory:');
  const store = new EventStore(db);
  const outbox = new EventOutbox({ store, now: () => '2026-11-16T00:00:05.000Z' });
  const promptAsync = jest.fn(async () => {});
  const lead = new LeadOutbox({
    store, outbox,
    now: () => '2026-11-16T00:00:05.000Z',
    newId: (p) => `${p}_1`,
    ensureLead: async () => ({ sessionId: 'ses_lead' }),
    promptAsync,
    timers: { every: jest.fn(() => ({ clear: jest.fn() })) },
  });
  return { store, outbox, lead, promptAsync };
}

test('enqueueDecision creates one channel row and dedupes by record id', () => {
  const h = harness();
  h.lead.enqueueDecision({ podId: 'pod1', recordId: 'rec1', text: '[LEAD EVENT] one' });
  h.lead.enqueueDecision({ podId: 'pod1', recordId: 'rec1', text: '[LEAD EVENT] one' });
  expect(h.store.listOutbox()).toHaveLength(1);
  expect(h.store.getChannel('lead:pod1')).toMatchObject({ kind: 'chat' });
});

test('dispatch batches pending decisions into one Lead prompt and marks all sent', async () => {
  const h = harness();
  h.lead.enqueueDecision({ podId: 'pod1', recordId: 'rec1', text: '[LEAD EVENT] one' });
  h.lead.enqueueDecision({ podId: 'pod1', recordId: 'rec2', text: '[LEAD EVENT] two' });
  const result = await h.lead.dispatch();
  expect(result.sent).toBe(2);
  expect(h.promptAsync).toHaveBeenCalledTimes(1);
  expect(h.promptAsync.mock.calls[0][0].sessionID).toBe('ses_lead');
  expect(h.store.listOutbox().every((r) => r.state === 'sent')).toBe(true);
});

test('a failed prompt marks every row failed and retryable', async () => {
  const h = harness();
  h.promptAsync.mockRejectedValueOnce(new Error('offline'));
  h.lead.enqueueDecision({ podId: 'pod1', recordId: 'rec1', text: '[LEAD EVENT] one' });
  const result = await h.lead.dispatch();
  expect(result.failed).toBe(1);
  expect(h.store.listOutbox()[0]).toMatchObject({ state: 'failed', lastError: 'offline' });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest --runInBand tests/unit/lead/lead-outbox.test.ts`
Expected: FAIL with module/export not found.

- [ ] **Step 3: Implement `LeadOutbox`**

Rules:
- `enqueueDecision`: ensure channel `lead:<podId>` via `store.insertChannel({ id, threadId: '*', kind: 'chat', address: { podId }, now })`; call `outbox.enqueue({ channelId, dedupeKey: 'decision:' + recordId, payload: { kind:'decision', priority: input.priority ?? 'p2', text, podId, goalId: input.goalId ?? null, recordId, createdAt: now } })`.
- `dispatch`: single-flight; group `outbox.pending()` by `channelId`; per channel track `batchTimes` in memory (prune >1h), `lastSentAt`; use `selectLeadOutboxBatch`; on `budget`/`interval` increment deferred and continue; on `empty` skip; resolve `podId` from payload; if missing, `markFailed` all; `ensureLead`; `promptAsync`; on success `markSent` each + record batch time; on error `markFailed` each + log.
- `start`: idempotent `timers.every('lead:outbox', 5000, () => { void this.dispatch(); })`; `stop`: clear handle and null it.
- `status`: count `listOutbox('pending'|'sent'|'failed')`.

- [ ] **Step 4: Run to verify pass**

Run: `npx jest --runInBand tests/unit/lead/lead-outbox.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/lead/lead-outbox.ts gateway/tests/unit/lead/lead-outbox.test.ts
git commit -m "feat(lead): add outbox dispatcher"
```

---

### Task 3: Wire kernel `deliverContext` to the outbox

**Files:**
- Modify: `gateway/src/kernel.ts` (imports, field, `initServices`, `deliverContext`, `stop`)
- Test: `gateway/tests/unit/lead/lead-outbox-wiring.test.ts`

**Interfaces:**
- Consumes: `LeadOutbox`.
- Produces: kernel `private leadOutbox?: LeadOutbox`; `deliverContext` calls `leadOutbox.enqueueDecision`; kernel starts/stops it.

- [ ] **Step 1: Write the failing wiring test**

```ts
import * as fs from 'fs';
import * as path from 'path';

const kernel = fs.readFileSync(path.join(__dirname, '../../../src/kernel.ts'), 'utf-8');

test('decision context delivery enqueues into the Lead outbox', () => {
  const block = kernel.slice(
    kernel.indexOf('deliverContext:'),
    kernel.indexOf('log: (message) => log.warn(message)', kernel.indexOf('deliverContext:')),
  );
  expect(block).toMatch(/enqueueDecision/);
  expect(block).not.toMatch(/promptAsync/);
});

test('kernel constructs and starts/stops the Lead outbox', () => {
  expect(kernel).toMatch(/new LeadOutbox\(/);
  expect(kernel).toMatch(/leadOutbox\.start\(\)/);
  expect(kernel).toMatch(/leadOutbox\?\.stop\(\)/);
  expect(kernel).toMatch(/'lead:outbox'/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest --runInBand tests/unit/lead/lead-outbox-wiring.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement kernel wiring**

- Import `LeadOutbox` and `EventOutbox`.
- Add `private leadOutbox?: LeadOutbox`.
- After event layer construction:
  ```ts
  this.leadOutbox = new LeadOutbox({
    store: eventStore,
    outbox: new EventOutbox({ store: eventStore, now: () => new Date().toISOString() }),
    now: () => new Date().toISOString(),
    newId: (prefix) => `${prefix}_${randomUUID()}`,
    ensureLead: (podId) => this.podService!.ensureLead(podId),
    promptAsync: async ({ sessionID, text }) => {
      await this.runtime!.session.promptAsync({ sessionID, parts: [{ type: 'text', text }] });
    },
    timers: this.timers,
    log: (message) => log.info(message),
  });
  this.leadOutbox.start();
  ```
- In `deliverContext`: replace `ensureLead`/`promptAsync` with:
  ```ts
  const message = renderLeadDecisionEvent(trigger);
  if (!message) return;
  const payload = trigger.payload as Record<string, unknown>;
  this.leadOutbox!.enqueueDecision({
    podId: subscription.subscriberId,
    recordId: String(payload?.recordId ?? trigger.externalId),
    goalId: typeof payload?.goalId === 'string' ? payload.goalId : null,
    text: message,
  });
  ```
  (If `leadOutbox` is undefined, throw so the delivery is retried.)
- In `stop()`: call `this.leadOutbox?.stop(); this.leadOutbox = undefined;` before `timers.disposeAll()`.

- [ ] **Step 4: Run wiring test + existing event tests**

Run: `npx jest --runInBand tests/unit/lead/lead-outbox-wiring.test.ts tests/unit/events tests/integration/event-layer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/kernel.ts gateway/tests/unit/lead/lead-outbox-wiring.test.ts
git commit -m "feat(lead): route decision announcements through outbox"
```

---

### Task 4: Docs + full gates

**Files:**
- Modify: `docs/architecture/events.md`
- Create: `docs/releases/2026-11-16-lead-outbox-dispatcher.md`

- [ ] **Step 1: Document the new path**

Add to `docs/architecture/events.md`:
- `deliverContext` → `LeadOutbox` → `event_outbox` (`chat` channel per Pod) → dispatcher every 5s.
- batch/budget: `maxBatch=5`, `maxPerHour=6`, `minInterval=60s`; failures retry with the existing outbox backoff.
- P0 non-goals: PodEventWake merge, read/ack, timers, watchdog.

Release note: commits, behavior, test counts, rollout/restart note.

- [ ] **Step 2: Run full gateway gates**

Run: `npx jest --runInBand --forceExit`
Expected: all suites pass (current baseline 953 suites / 7688 passed / 2 skipped; new tests increase the count).
Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit docs**

```bash
git add docs/architecture/events.md docs/releases/2026-11-16-lead-outbox-dispatcher.md
git commit -m "docs: record Lead outbox dispatcher"
```

---

### Task 5: Live drill

- [ ] **Step 1: Build and restart gateway**

```bash
cd gateway && npm run build
```

Write `~/.mafw/pending-restart.json` with `{ target:'gateway', action:'restart', commit:<hash> }`; wait for health.

- [ ] **Step 2: Create one self-test agent decision**

Use `POST /api/decisions` with `source:'agent'` and a clearly labeled question. Expected:
- `event_outbox` gets one `pending` row for `lead:<podId>`;
- dispatcher sends within ~5s;
- row becomes `sent`;
- Lead chat contains the `[LEAD EVENT]` message;
- `event_deliveries` row is `delivered`.

- [ ] **Step 3: Shelve the test decision**

Use the human token and `POST /api/decisions/:id/shelve` so it does not stay pending.

- [ ] **Step 4: Verify no duplicate**

Re-run the dispatcher / wait one tick; `event_outbox` still has exactly one row for `decision:<recordId>` and no second Lead message.

---

## Self-Review

- **Spec coverage:** P0 in the research doc = Lead announcements through a durable outbox with dispatcher/budget/merge. Tasks 1–3 implement it; Task 4 documents; Task 5 drills.
- **Step scan:** each step has a concrete test/command and expected result; no “handle edge cases” placeholders.
- **Type consistency:** `LeadOutboxPayload`, `LeadOutboxPolicy`, `LeadOutboxDeps`, `LeadOutbox.dispatch/enqueueDecision` are consistent across tasks.
- **Review Focus:** batch completeness, failure retry, dedupe, budget defer, restart — each has a test in Task 1/2; the live drill covers restart/duplicate behavior.
- **Proportion:** plan is smaller than the research spec; implementation bodies are left to the engineer except the model rules and kernel wiring signatures.
