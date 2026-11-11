# Project Agent Workbench — Review Items & Forced Acceptance (Plan C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make review opinions first-class, gateway-persisted objects tied to a Goal revision, with a human-only resolve/reopen lifecycle, server-enforced forced-acceptance risk confirmation, and annotation-to-review-item capture from the desktop.

**Architecture:** Add three append-only-friendly tables (`pod_goal_review_items`, `pod_goal_review_item_events`, `pod_goal_acceptances`) to `PodStore`, a `PodReviewService` that owns the status machine, and route + MCP surfaces. Review items belong to one Goal revision; unresolved items are cloned into the next revision when a reject opens it. Acceptance reads unresolved items from the database, refuses silently bypassing them, and records a forced-acceptance audit. Desktop consumes the new DTOs and creates items when annotations are sent to a Goal-bound Tech Lead.

**Tech Stack:** TypeScript, better-sqlite3, gateway routes + MCP tool registry, `@mafw/sdk`, Electron preload IPC, SolidJS, `@mafw/ui/v2`, node --test (desktop/SDK), jest (gateway).

**Spec:** `docs/superpowers/specs/2026-11-11-project-agent-workbench-experience-design.md` (§6.5–6.6, §9, §10, acceptance scenarios 5/8/9/10/13)

## Global Constraints

- Review item truth lives in the gateway DB. Desktop only projects server state; no client-only status.
- Status machine: `pending → responded → resolved`; `reopen` sends `responded`/`resolved` back to `pending`. Tech Lead may only mark `responded`. Only a human may `resolve` or `reopen`.
- `responded` still counts as unresolved for the forced-acceptance gate. Only `resolved` is excluded.
- Review items belong to a Goal revision. Old revision items are immutable and queryable; a new revision receives clones of unresolved items only (`pending`, `origin_item_id`, `origin_revision`).
- Review items are created only by the human desktop action of sending annotations to a Goal-bound Tech Lead. Reviewer PASS/FAIL stays evidence and never auto-creates items.
- Forced acceptance requires `riskAcknowledged: true`, is human-only, records operator kind (`human`), time, and the unresolved item id snapshot, and never resolves those items.
- PASS still never auto-merges; worktree merge remains behind human acceptance.
- After a revision is accepted, its review items are frozen (respond/resolve/reopen return 409).
- Project-scope annotations without a Goal remain plain drafts/chat context; they are not persisted as Goal review items.
- No runtime-name or capability leakage into desktop DTOs; reuse existing `pod.updated` broadcast (`kind: 'review'`).
- UI: no raw `<button>`/`<input>`/bare `title`; use `@mafw/ui/v2` and theme tokens.

## Review Focus

1. **Human-only authority**: create/resolve/reopen and forced acceptance must reject `actorSessionID` requests; Tech Lead can respond but never resolve; post-acceptance mutations are rejected.
2. **Server-side gate**: unresolved count comes from the DB at accept time, not from the client's cached list; `force` without `riskAcknowledged` is 400; audit snapshot matches the set that was visible at acceptance.
3. **Carry-over correctness**: reject opens exactly one new revision, clones unresolved items once, leaves resolved items in the old revision, and a replayed reject does not duplicate clones.
4. **Annotation send atomicity**: idle and queued sends persist items before clearing drafts; persistence failure aborts the send and keeps drafts; retry does not duplicate items.
5. **Status/history integrity**: invalid transitions return 409; events append-only; UI refreshes to server truth after respond/resolve/reopen and after reload.

---

### Task 1: Gateway review-item store

**Files:**
- Modify: `gateway/src/core/pod/pod-store.ts`
- Test: `gateway/tests/unit/pod-review-store.test.ts`

**Interfaces:**
- Consumes: existing `PodStore` constructor and `Database` instance.
- Produces:
  ```ts
  export type PodReviewItemStatus = 'pending' | 'responded' | 'resolved'

  export interface PodReviewItemRow {
    id: string
    podId: string
    goalId: string
    revision: number
    status: PodReviewItemStatus
    rel: string
    startLine: number | null
    endLine: number | null
    code: string
    comment: string
    anchorJson: string | null
    response: string | null
    originItemId: string | null
    originRevision: number | null
    createdAt: string
    updatedAt: string
    respondedAt: string | null
    resolvedAt: string | null
  }

  export interface PodReviewItemEventRow {
    id: string
    podId: string
    goalId: string
    revision: number
    itemId: string
    kind: 'created' | 'responded' | 'resolved' | 'reopened' | 'carried'
    payloadJson: string | null
    createdAt: string
  }

  export interface PodGoalAcceptanceRow {
    id: string
    podId: string
    goalId: string
    revision: number
    forced: boolean
    unresolvedItemIds: string[]
    actorKind: 'human'
    riskAcknowledged: boolean
    mergeCommit: string | null
    acceptedAt: string
  }

  createReviewItem(input: {
    podId: string; goalId: string; revision: number; rel: string;
    startLine?: number | null; endLine?: number | null; code?: string;
    comment: string; anchorJson?: string | null;
    originItemId?: string | null; originRevision?: number | null;
    now: string;
  }): PodReviewItemRow
  getReviewItem(itemId: string): PodReviewItemRow | null
  listReviewItems(podId: string, goalId: string, revision: number): PodReviewItemRow[]
  listUnresolvedReviewItems(podId: string, goalId: string, revision: number): PodReviewItemRow[]
  setReviewItemStatus(input: {
    podId: string; goalId: string; itemId: string;
    from: PodReviewItemStatus[]; to: PodReviewItemStatus;
    response?: string | null; now: string;
  }): boolean
  appendReviewItemEvent(input: {
    podId: string; goalId: string; revision: number; itemId: string;
    kind: PodReviewItemEventRow['kind']; payloadJson?: string | null; now: string;
  }): PodReviewItemEventRow
  listReviewItemEvents(itemId: string): PodReviewItemEventRow[]
  carryForwardReviewItems(input: {
    podId: string; goalId: string; fromRevision: number; toRevision: number; now: string;
  }): number
  recordGoalAcceptance(input: {
    podId: string; goalId: string; revision: number; forced: boolean;
    unresolvedItemIds: string[]; riskAcknowledged: boolean;
    mergeCommit: string | null; now: string;
  }): PodGoalAcceptanceRow
  getGoalAcceptance(podId: string, goalId: string, revision: number): PodGoalAcceptanceRow | null
  ```

- [ ] **Step 1: Write the failing store test**

```ts
import Database from 'better-sqlite3';
import { PodStore } from '../../src/core/pod/pod-store';

const now = '2026-11-11T00:00:00.000Z';

function store(): PodStore {
  return new PodStore(new Database(':memory:'));
}

describe('pod review item store', () => {
  test('creates, lists and transitions an item with append-only events', () => {
    const s = store();
    const item = s.createReviewItem({
      podId: 'pod_1', goalId: 'g1', revision: 1, rel: 'src/a.ts',
      startLine: 3, endLine: 5, code: 'x()', comment: '这里要改', now,
    });
    expect(item.status).toBe('pending');
    expect(s.listReviewItems('pod_1', 'g1', 1).map((row) => row.id)).toEqual([item.id]);

    expect(s.setReviewItemStatus({
      podId: 'pod_1', goalId: 'g1', itemId: item.id,
      from: ['pending'], to: 'responded', response: '已改', now,
    })).toBe(true);
    expect(s.getReviewItem(item.id)?.status).toBe('responded');
    expect(s.setReviewItemStatus({
      podId: 'pod_1', goalId: 'g1', itemId: item.id,
      from: ['pending'], to: 'resolved', now,
    })).toBe(false);

    s.appendReviewItemEvent({
      podId: 'pod_1', goalId: 'g1', revision: 1, itemId: item.id,
      kind: 'created', now,
    });
    expect(s.listReviewItemEvents(item.id).map((event) => event.kind)).toEqual(['created']);
  });

  test('carry-forward clones only unresolved items into the next revision', () => {
    const s = store();
    const open = s.createReviewItem({
      podId: 'pod_1', goalId: 'g1', revision: 1, rel: 'src/a.ts',
      comment: '未解决', now,
    });
    const done = s.createReviewItem({
      podId: 'pod_1', goalId: 'g1', revision: 1, rel: 'src/b.ts',
      comment: '已解决', now,
    });
    s.setReviewItemStatus({
      podId: 'pod_1', goalId: 'g1', itemId: done.id,
      from: ['pending'], to: 'resolved', now,
    });

    expect(s.carryForwardReviewItems({
      podId: 'pod_1', goalId: 'g1', fromRevision: 1, toRevision: 2, now,
    })).toBe(1);

    const rev2 = s.listReviewItems('pod_1', 'g1', 2);
    expect(rev2).toHaveLength(1);
    expect(rev2[0]).toMatchObject({
      status: 'pending', comment: '未解决', originItemId: open.id, originRevision: 1,
    });
    expect(s.listReviewItems('pod_1', 'g1', 1)).toHaveLength(2);
  });

  test('acceptance audit round-trips forced state and snapshot', () => {
    const s = store();
    const record = s.recordGoalAcceptance({
      podId: 'pod_1', goalId: 'g1', revision: 1, forced: true,
      unresolvedItemIds: ['review_1', 'review_2'], riskAcknowledged: true,
      mergeCommit: 'abc1234', now,
    });
    expect(record.forced).toBe(true);
    expect(record.unresolvedItemIds).toEqual(['review_1', 'review_2']);
    expect(s.getGoalAcceptance('pod_1', 'g1', 1)).toEqual(record);
    expect(s.getGoalAcceptance('pod_1', 'g1', 2)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/pod-review-store.test.ts --runInBand`
Expected: FAIL because `createReviewItem` and the tables do not exist.

- [ ] **Step 3: Implement the schema and methods**

Add `CREATE TABLE IF NOT EXISTS` blocks for `pod_goal_review_items`, `pod_goal_review_item_events`, and `pod_goal_acceptances` inside the existing constructor `db.exec` block. Add row mappers that convert snake_case columns to the interfaces. Generate ids with `review_${randomUUID()}` / `review_evt_${randomUUID()}` / `accept_${randomUUID()}` (add `import { randomUUID } from 'crypto'`). `carryForwardReviewItems` selects `status != 'resolved'` rows from `fromRevision`, inserts clones with `status='pending'`, `response=null`, `origin_item_id`, `origin_revision`, and appends a `carried` event per clone. `recordGoalAcceptance` uses `INSERT OR IGNORE` on `(pod_id, goal_id, revision)` then selects the row.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/pod-review-store.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-store.ts gateway/tests/unit/pod-review-store.test.ts
git commit -m "feat(gateway): persist goal review items"
```

---

### Task 2: Review-item service and status machine

**Files:**
- Create: `gateway/src/core/pod/pod-review-service.ts`
- Test: `gateway/tests/unit/pod-review-service.test.ts`

**Interfaces:**
- Consumes: `PodStore`, `PodError`, review-item types from Task 1.
- Produces:
  ```ts
  export const MAX_REVIEW_ITEMS = 50

  export type PodReviewAnchor =
    | { kind: 'quote'; quote: string }
    | { kind: 'jsonPath'; path: string; valueSummary: string }
    | { kind: 'cell'; sheet?: string; ref: string; value: string }
    | { kind: 'region'; x: number; y: number; w: number; h: number; slide?: number }

  export interface PodReviewItem {
    id: string
    podId: string
    goalId: string
    revision: number
    status: PodReviewItemStatus
    rel: string
    startLine: number | null
    endLine: number | null
    code: string
    comment: string
    anchor: PodReviewAnchor | null
    response: string | null
    originItemId: string | null
    originRevision: number | null
    createdAt: string
    updatedAt: string
    respondedAt: string | null
    resolvedAt: string | null
  }

  export interface PodReviewItemInput {
    rel: string
    startLine?: number | null
    endLine?: number | null
    code?: string
    comment: string
    anchor?: PodReviewAnchor
  }

  export interface PodReviewServiceDeps {
    store: PodStore
    now(): string
    notify?(podId: string, kind?: string, goalId?: string): void
    assertTechLeadSession(goalId: string, sessionID: string): void
  }

  export class PodReviewService {
    constructor(deps: PodReviewServiceDeps)
    createItems(podId: string, goalId: string, input: {
      revision?: number
      items: PodReviewItemInput[]
    }): PodReviewItem[]
    list(podId: string, goalId: string, opts?: { revision?: number }): {
      revision: number
      items: PodReviewItem[]
    }
    respond(podId: string, goalId: string, itemId: string, input: {
      sessionID: string
      response: string
    }): PodReviewItem
    resolve(podId: string, goalId: string, itemId: string, opts?: { note?: string }): PodReviewItem
    reopen(podId: string, goalId: string, itemId: string, opts?: { note?: string }): PodReviewItem
    unresolved(podId: string, goalId: string, revision: number): PodReviewItem[]
    acceptance(podId: string, goalId: string, revision: number): PodGoalAcceptanceRow | null
    recordAcceptance(input: {
      podId: string; goalId: string; revision: number;
      unresolvedItemIds: string[]; forced: boolean;
      riskAcknowledged: boolean; mergeCommit: string | null;
    }): PodGoalAcceptanceRow
  }
  ```

- [ ] **Step 1: Write the failing service test**

```ts
import Database from 'better-sqlite3';
import { PodError, PodStore } from '../../src/core/pod/pod-store';
import { PodReviewService } from '../../src/core/pod/pod-review-service';

function setup() {
  const store = new PodStore(new Database(':memory:'));
  // Minimal goal row for active-revision checks (PodStore's real creation API).
  store.enqueueGoal({ id: 'podgoal_1', podId: 'pod_1', goalId: 'g1', now: '2026-11-11T00:00:00.000Z' });
  store.setGoalStatus('podgoal_1', 'active', { startedAt: '2026-11-11T00:00:00.000Z' });
  const techLeadGoals: string[] = [];
  const service = new PodReviewService({
    store,
    now: () => '2026-11-11T00:01:00.000Z',
    assertTechLeadSession: (goalId) => { techLeadGoals.push(goalId); },
  });
  return { store, service, techLeadGoals };
}

describe('PodReviewService', () => {
  test('creates items on the active revision only', () => {
    const { service } = setup();
    const items = service.createItems('pod_1', 'g1', {
      items: [{ rel: 'src/a.ts', startLine: 2, endLine: 2, code: 'x', comment: '改这里' }],
    });
    expect(items[0].status).toBe('pending');
    expect(items[0].revision).toBe(1);
    expect(() => service.createItems('pod_1', 'g1', {
      revision: 2,
      items: [{ rel: 'src/a.ts', comment: '旧版' }],
    })).toThrow(PodError);
  });

  test('Tech Lead can respond, only human transitions resolve/reopen', () => {
    const { service, techLeadGoals } = setup();
    const [item] = service.createItems('pod_1', 'g1', {
      items: [{ rel: 'src/a.ts', comment: '改这里' }],
    });
    const responded = service.respond('pod_1', 'g1', item.id, {
      sessionID: 'ses_tl', response: '已改，见 rev1',
    });
    expect(responded.status).toBe('responded');
    expect(techLeadGoals).toEqual(['g1']);

    expect(() => service.respond('pod_1', 'g1', item.id, {
      sessionID: 'ses_other', response: 'again',
    })).toThrow(PodError);

    expect(service.resolve('pod_1', 'g1', item.id, { note: '确认解决' }).status).toBe('resolved');
    expect(service.reopen('pod_1', 'g1', item.id, { note: '又出现了' }).status).toBe('pending');
  });

  test('resolved items cannot be responded to; invalid transitions are 409', () => {
    const { service } = setup();
    const [item] = service.createItems('pod_1', 'g1', {
      items: [{ rel: 'src/a.ts', comment: '改这里' }],
    });
    service.resolve('pod_1', 'g1', item.id);
    try {
      service.respond('pod_1', 'g1', item.id, { sessionID: 'ses_tl', response: 'late' });
      throw new Error('expected 409');
    } catch (error) {
      expect((error as PodError).status).toBe(409);
    }
  });

  test('items are frozen after acceptance', () => {
    const { service } = setup();
    const [item] = service.createItems('pod_1', 'g1', {
      items: [{ rel: 'src/a.ts', comment: '改这里' }],
    });
    service.recordAcceptance({
      podId: 'pod_1', goalId: 'g1', revision: 1,
      unresolvedItemIds: [item.id], forced: true,
      riskAcknowledged: true, mergeCommit: 'abc1234',
    });
    expect(() => service.resolve('pod_1', 'g1', item.id)).toThrow(PodError);
    expect(() => service.respond('pod_1', 'g1', item.id, { sessionID: 'ses_tl', response: 'late' })).toThrow(PodError);
  });
});
```

If `store.createGoal` needs a different signature, use the existing helper the store already exposes in tests; do not add a test-only API.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/pod-review-service.test.ts --runInBand`
Expected: FAIL because `pod-review-service` does not exist.

- [ ] **Step 3: Implement `PodReviewService`**

Rules:
- Map store rows to the service-facing `PodReviewItem` (parse `anchorJson` into `anchor`, omit `anchorJson`) in one private helper used by every read method.
- `createItems`: resolve revision to `input.revision ?? goal.activeRevision`; require `revision === goal.activeRevision`; require 1–50 items; validate non-empty `rel`/`comment` and size limits (`comment <= 4000`, `rel <= 1000`, `code <= 20000`, serialized anchor <= 8000); stringify `item.anchor` before storing; create rows and `created` events in one pass; `notify(podId, 'review', goalId)`.
- `respond`: `assertTechLeadSession(goalId, sessionID)`; require non-empty `response <= 4000`; item must belong to the active revision; require acceptance-free revision; transition `pending|responded → responded`; append `responded`; notify.
- `resolve`/`reopen`: same active/frozen checks; transitions `pending|responded → resolved` and `responded|resolved → pending`; append `resolved`/`reopened` with note payload; notify.
- Throw `new PodError(404, ...)` for missing Goal/item, `409` for invalid transition/frozen revision, `400` for validation.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/pod-review-service.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-review-service.ts gateway/tests/unit/pod-review-service.test.ts
git commit -m "feat(gateway): add review item state machine"
```

---

### Task 3: Routes, acceptance gate, and revision carry-over

**Files:**
- Modify: `gateway/src/routes/pods.ts`
- Modify: `gateway/src/routes/pod-handlers.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/subsystems/api-routes.ts`
- Modify: `gateway/src/core/pod/pod-goal-service.ts`
- Modify: `gateway/src/core/pod/pod-goal-revision-service.ts`
- Modify: `gateway/src/kernel.ts`
- Test: `gateway/tests/unit/pod-review-routes.test.ts`
- Test: `gateway/tests/unit/pod-accept-review-gate.test.ts`
- Test: `gateway/tests/unit/pod-revision-review-carry.test.ts`

**Interfaces:**
- Consumes: `PodReviewService` (Task 2), `PodStore` (Task 1).
- Produces:
  - Routes:
    - `GET /api/pods/:podId/goals/:goalId/review-items?revision=N` → `{ revision, items }`
    - `POST /api/pods/:podId/goals/:goalId/review-items` body `{ revision?, items: PodReviewItemInput[] }` → `{ items }`
    - `POST /api/pods/:podId/goals/:goalId/review-items/:itemId/resolve` body `{ note? }` → `{ item }`
    - `POST /api/pods/:podId/goals/:goalId/review-items/:itemId/reopen` body `{ note? }` → `{ item }`
  - `PodGoalServiceDeps.reviews?: Pick<PodReviewService, 'unresolved' | 'recordAcceptance' | 'acceptance'>` (use `import type` to avoid a runtime service cycle)
  - `acceptResult(podId, goalId, opts: { revision?: number; force?: boolean; riskAcknowledged?: boolean })`
  - `PodGoalRevisionService` calls `store.carryForwardReviewItems` inside `openNextRevision` after the new revision row is created.

- [ ] **Step 1: Write the failing route test**

```ts
import * as http from 'http';
import { handlePods, type PodRouteDeps } from '../../src/routes/pods';

function mockRes() {
  const res: any = {
    status: 0,
    body: '',
    writeHead(s: number) { this.status = s; },
    end(b?: string) { this.body = b ?? ''; },
  };
  return res as http.ServerResponse & { status: number; body: string };
}

function mockReq(method: string, body?: any): http.IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = { method, on(ev: string, fn: Function) { (listeners[ev] ??= []).push(fn); } };
  setImmediate(() => {
    if (body !== undefined) for (const fn of listeners['data'] ?? []) fn(JSON.stringify(body));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as http.IncomingMessage;
}

async function call(deps: PodRouteDeps, method: string, url: string, body?: any) {
  const res = mockRes();
  await handlePods(mockReq(method, body), res, url, deps);
  return { status: res.status, json: res.body ? JSON.parse(res.body) : null };
}

test('review item routes are human-only and list by revision', async () => {
  const calls: string[] = [];
  const deps = {
    pods: { get: () => ({ pod: { id: 'pod_1' } }) },
    reviews: {
      list: (podId: string, goalId: string, opts: any) => ({ revision: opts?.revision ?? 1, items: [] }),
      createItems: (...args: any[]) => { calls.push('create'); return []; },
      resolve: (...args: any[]) => { calls.push('resolve'); return { id: 'review_1', status: 'resolved' }; },
      reopen: (...args: any[]) => { calls.push('reopen'); return { id: 'review_1', status: 'pending' }; },
    },
  } as any as PodRouteDeps;

  expect((await call(deps, 'GET', '/api/pods/pod_1/goals/g1/review-items?revision=2')).status).toBe(200);
  expect((await call(deps, 'POST', '/api/pods/pod_1/goals/g1/review-items', {
    items: [], actorSessionID: 'ses_agent',
  })).status).toBe(403);
  expect((await call(deps, 'POST', '/api/pods/pod_1/goals/g1/review-items/review_1/resolve', {
    actorSessionID: 'ses_agent',
  })).status).toBe(403);
  expect((await call(deps, 'POST', '/api/pods/pod_1/goals/g1/review-items/review_1/resolve', {})).status).toBe(200);
  expect(calls).toEqual(['resolve']);
});
```

- [ ] **Step 2: Write the failing acceptance-gate test**

Use a real in-memory `PodStore`, real `PodGoalService`, and stubs:
```ts
const reviews = {
  unresolved: () => [{ id: 'review_1' }, { id: 'review_2' }],
  recordAcceptance: (input: any) => { recorded = input; return input; },
  acceptance: () => null,
};
const worktrees = { get: () => ({ status: 'active' }), mergeForAcceptance: async () => ({ branch: 'b', mergeCommit: 'abc', mergedAt: now }) };
// acceptResult(..., {}) -> 409; acceptResult(..., { force: true }) -> 400;
// acceptResult(..., { force: true, riskAcknowledged: true }) -> 200 and recorded.unresolvedItemIds = ['review_1','review_2'].
```

- [ ] **Step 3: Write the failing carry-over test**

Real in-memory store + `PodGoalRevisionService` with a temp `resolveMafwDir`:
```ts
store.enqueueGoal({ id: 'podgoal_1', podId: 'pod_1', goalId: 'g1', now });
store.setGoalStatus('podgoal_1', 'active', { startedAt: now });
store.createGoalRevision({ podId: 'pod_1', goalId: 'g1', revision: 1, status: 'completed', verdict: 'PASS', enqueuedAt: now });
store.setActiveRevision('pod_1', 'g1', 1);
const revisions = new PodGoalRevisionService({
  store,
  resolveMafwDir: () => tmpMafwDir,
  now: () => now,
  resultForGoal: () => ({ goalId: 'g1', revision: 1, verdict: 'PASS', resultReady: true } as any),
});
// create one pending + one resolved item, then:
await revisions.openNextRevision('g1', 'feedback', { expectedRevision: 1 });
// assert revision 2 has exactly one pending clone; revision 1 still has both rows.
```
Run this scenario twice with `expectedRevision: 1` and assert the second call is stale and does not add clones.

- [ ] **Step 4: Run the three tests to verify they fail**

Run: `cd gateway && npx jest tests/unit/pod-review-routes.test.ts tests/unit/pod-accept-review-gate.test.ts tests/unit/pod-revision-review-carry.test.ts --runInBand`
Expected: FAIL on missing routes, gate, and carry-over.

- [ ] **Step 5: Implement routes, gate, carry-over, wiring**

- Add the four review operations to `route-catalog.ts` (`pods.goals.reviewItems`, `.create`, `.resolve`, `.reopen`) and to `attachPodHandlers`'s `operationIds` list.
- Add `reviews?: PodReviewService` to `PodRouteDeps`; match routes before the generic `/goals/:goalId` handlers. For create/resolve/reopen: if body has `actorSessionID`, throw `PodError(403, 'review items are human-only')`. List accepts optional `revision` and validates positive integer.
- Patch `PodGoalService.acceptResult`: read `unresolved` from `deps.reviews`; if non-empty and `force !== true` → `PodError(409, 'unresolved review items: N')`; if `force && riskAcknowledged !== true` → `PodError(400, 'riskAcknowledged:true is required')`; after merge call `recordAcceptance` with ids and `forced = unresolved.length > 0`; return merged result plus `forced` and `unresolvedReviewItemIds`.
- Patch route accept body: validate `force`/`riskAcknowledged` are booleans when present and pass through.
- In `openNextRevision`, after `createGoalRevision` and before `setActiveRevision`, call `store.carryForwardReviewItems({ podId, goalId, fromRevision: previous.revision, toRevision: openedRevision, now })`. The existing `expectedRevision` check already makes replays no-op, so clones cannot duplicate.
- In `kernel.ts`: construct `this.podReviewService = new PodReviewService({ store: this.podStore, now: ..., notify: ..., assertTechLeadSession: (goalId, sessionID) => this.podTechLeadService.assertTechLeadSession(goalId, sessionID) })` before `PodGoalService`; inject into `PodGoalServiceDeps.reviews`. Add `podReviewService` to `ApiRouteDeps` and its `apiRouteDeps()` getter; pass it from `api-routes.ts` into `attachPodHandlers`'s `PodRouteDeps.reviews`.

- [ ] **Step 6: Run the three tests to verify they pass**

Run the Step 4 command. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add gateway/src/routes/pods.ts gateway/src/core/pod/pod-goal-service.ts gateway/src/core/pod/pod-goal-revision-service.ts gateway/src/kernel.ts gateway/tests/unit/pod-review-routes.test.ts gateway/tests/unit/pod-accept-review-gate.test.ts gateway/tests/unit/pod-revision-review-carry.test.ts
git commit -m "feat(gateway): gate acceptance on review items"
```

---

### Task 4: Result audit, MCP respond tool, Tech Lead guidance

**Files:**
- Modify: `gateway/src/core/pod/pod-result.ts`
- Modify: `gateway/src/core/pod/pod-goal-service.ts`
- Create: `gateway/src/mcp/handlers/pod-review-respond.ts`
- Modify: `gateway/src/mcp/tool-registry.ts`
- Modify: `gateway/src/runtime/tool-classes.ts`
- Modify: `gateway/src/skills/tech-lead-identity.ts`
- Test: `gateway/tests/unit/pod-review-respond-tool.test.ts`
- Test: extend `gateway/tests/unit/pod-accept-review-gate.test.ts`

**Interfaces:**
- Consumes: `PodReviewService` (Task 2).
- Produces:
  ```ts
  export interface PodGoalAcceptanceView {
    forced: boolean
    acceptedAt: string
    unresolvedReviewItemIds: string[]
  }
  // PodGoalResult gains:
  acceptanceRecord?: PodGoalAcceptanceView | null
  ```
  MCP tool `mafw_pod_review_respond` args `{ goalId: string; itemId: string; response: string; sessionID: string }`, returning `{ success: true, itemId, status: 'responded' }`.

- [ ] **Step 1: Write the failing MCP handler test**

```ts
import { handlePodReviewRespond } from '../../src/mcp/handlers/pod-review-respond';

test('review respond tool requires a Tech Lead session and forwards the response', async () => {
  const calls: any[] = [];
  const services = {
    podReview: {
      respond: (podId: string, goalId: string, itemId: string, input: any) => {
        calls.push({ podId, goalId, itemId, input });
        return { id: itemId, status: 'responded' };
      },
    },
    podStore: { getGoalByGoalId: (goalId: string) => ({ podId: 'pod_1', goalId }) },
  };
  const result = await handlePodReviewRespond({
    goalId: 'g1', itemId: 'review_1', response: '已改', sessionID: 'ses_tl',
  }, services as any);
  expect(result.isError).toBeFalsy();
  expect(calls[0].input).toEqual({ sessionID: 'ses_tl', response: '已改' });
});
```

Also add an acceptance-record assertion to the gate test: after forced accept, `getGoalAcceptance` exists and `result.acceptanceRecord?.forced === true`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/pod-review-respond-tool.test.ts --runInBand`
Expected: FAIL because the handler does not exist.

- [ ] **Step 3: Implement result audit + MCP tool**

- Add `PodGoalAcceptanceView` to `pod-result.ts` and `acceptanceRecord?: PodGoalAcceptanceView | null` to `PodGoalResult`.
- In `PodGoalService.result()`, query `deps.reviews?.acceptance(podId, goalId, revision)` and map to `{ forced, acceptedAt, unresolvedReviewItemIds }`.
- Handler resolves deps from `services.podReview` and `services.podStore` (Goal → podId), calls `respond`, and returns the same `ok`/`fail` shape as `pod-goal-direction`.
- Register the definition (description: Tech Lead-only response to a review item; cannot resolve) and handler; add `mafw_pod_review_respond: { readOnlyHint: false, destructiveHint: false }` to `tool-classes.ts`.
- Add one sentence to `tech-lead-identity.ts`: when a user message references review item ids, address each and call `mafw_pod_review_respond`; never claim an item is resolved.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest tests/unit/pod-review-respond-tool.test.ts tests/unit/pod-accept-review-gate.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-result.ts gateway/src/core/pod/pod-goal-service.ts gateway/src/mcp/handlers/pod-review-respond.ts gateway/src/mcp/tool-registry.ts gateway/src/runtime/tool-classes.ts gateway/src/skills/tech-lead-identity.ts gateway/tests/unit/pod-review-respond-tool.test.ts gateway/tests/unit/pod-accept-review-gate.test.ts
git commit -m "feat(gateway): expose review responses to tech lead"
```

---

### Task 5: SDK types, client, and generated contract

**Files:**
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Generated (commit intentionally): `packages/gateway-sdk/contract/gateway-paths.json`, `packages/gateway-sdk/contract/openapi.json`, `packages/gateway-sdk/src/api-schema.gen.ts`
- Test: `packages/gateway-sdk/src/pod-collaboration.test.ts`

**Interfaces:**
- Consumes: routes from Task 3, DTO additions from Task 4.
- Produces:
  ```ts
  export type PodReviewItemStatus = 'pending' | 'responded' | 'resolved'
  export type PodReviewAnchor =
    | { kind: 'quote'; quote: string }
    | { kind: 'jsonPath'; path: string; valueSummary: string }
    | { kind: 'cell'; sheet?: string; ref: string; value: string }
    | { kind: 'region'; x: number; y: number; w: number; h: number; slide?: number }

  export interface PodReviewItem {
    id: string; podId: string; goalId: string; revision: number
    status: PodReviewItemStatus; rel: string
    startLine: number | null; endLine: number | null; code: string; comment: string
    anchor: PodReviewAnchor | null
    response: string | null
    originItemId: string | null; originRevision: number | null
    createdAt: string; updatedAt: string
    respondedAt: string | null; resolvedAt: string | null
  }

  export interface PodReviewItemInput {
    rel: string
    startLine?: number | null
    endLine?: number | null
    code?: string
    comment: string
    anchor?: PodReviewAnchor
  }

  export interface PodReviewItemList { revision: number; items: PodReviewItem[] }
  ```
  `PodNamespace` gains:
  ```ts
  reviewItems(podID: string, goalID: string, opts?: { revision?: number }): Promise<PodReviewItemList>
  createReviewItems(podID: string, goalID: string, body: { revision?: number; items: PodReviewItemInput[] }): Promise<{ items: PodReviewItem[] }>
  resolveReviewItem(podID: string, goalID: string, itemID: string, body?: { note?: string }): Promise<{ item: PodReviewItem }>
  reopenReviewItem(podID: string, goalID: string, itemID: string, body?: { note?: string }): Promise<{ item: PodReviewItem }>
  ```
  `acceptResult` body gains `force?: boolean; riskAcknowledged?: boolean`; `PodGoalAcceptResult` gains `forced?: boolean; unresolvedReviewItemIds?: string[]`; `PodGoalResult` gains `acceptanceRecord?: PodGoalAcceptanceRecord | null`.

- [ ] **Step 1: Write the failing SDK test**

Append to `pod-collaboration.test.ts`:
Use the file's existing `fetchMock` / `okJson` / `lastCall` harness:
```ts
test('pod.reviewItems/create/resolve/reopen use the review routes', async () => {
  fetchMock.mockResolvedValue(okJson({ revision: 2, items: [], item: { id: 'review_1' } }))
  const c = new MafwClient('http://gw:3000')
  await c.pod.reviewItems('pod_1', 'g1', { revision: 2 })
  expect(lastCall()[0]).toBe('http://gw:3000/api/pods/pod_1/goals/g1/review-items?revision=2')

  await c.pod.createReviewItems('pod_1', 'g1', { items: [{ rel: 'src/a.ts', comment: 'x' }] })
  expect(lastCall()[0]).toBe('http://gw:3000/api/pods/pod_1/goals/g1/review-items')
  expect(lastCall()[1]?.method).toBe('POST')

  await c.pod.resolveReviewItem('pod_1', 'g1', 'review_1', { note: 'ok' })
  expect(lastCall()[0]).toBe('http://gw:3000/api/pods/pod_1/goals/g1/review-items/review_1/resolve')

  await c.pod.reopenReviewItem('pod_1', 'g1', 'review_1')
  expect(lastCall()[0]).toBe('http://gw:3000/api/pods/pod_1/goals/g1/review-items/review_1/reopen')
})

test('acceptResult forwards forced acceptance flags', async () => {
  fetchMock.mockResolvedValue(okJson({ podId: 'pod_1', goalId: 'g1', revision: 1, branch: 'b', mergeCommit: 'c', mergedAt: 'now' }))
  const c = new MafwClient('http://gw:3000')
  await c.pod.acceptResult('pod_1', 'g1', { revision: 1, confirm: true, force: true, riskAcknowledged: true })
  expect(JSON.parse(String(lastCall()[1]?.body))).toEqual({
    revision: 1, confirm: true, force: true, riskAcknowledged: true,
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/gateway-sdk && npm test`
Expected: FAIL because the namespace methods do not exist.

- [ ] **Step 3: Implement SDK methods and catalog entries**

Catalog entries were added in Task 3. Implement client methods with `encodeURIComponent` and the `revision` query. Add types and extend `PodGoalResult` / `PodGoalAcceptResult`.

- [ ] **Step 4: Regenerate the contract**

Run:
```bash
cd gateway && npm run emit:openapi
cd ../packages/gateway-sdk && npm run gen:api
```
Then run `cd gateway && npx jest tests/unit/api-contract.test.ts --runInBand`.
Expected: PASS; generated files show the four operations.

- [ ] **Step 5: Run SDK tests**

Run: `cd packages/gateway-sdk && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/routes/route-catalog.ts packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/pod-collaboration.test.ts packages/gateway-sdk/contract/gateway-paths.json packages/gateway-sdk/contract/openapi.json packages/gateway-sdk/src/api-schema.gen.ts
git commit -m "feat(sdk): expose goal review items"
```

---

### Task 6: Desktop preload API

**Files:**
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/desktop/src/preload/types.ts`
- Test: `packages/desktop/tests/preload-pod-review.test.ts`

**Interfaces:**
- Consumes: SDK methods from Task 5.
- Produces: `window.api.mafw.pod.reviewItems/createReviewItems/resolveReviewItem/reopenReviewItem`, and `acceptResult` body type with `force`/`riskAcknowledged`.

- [ ] **Step 1: Write the failing preload contract test**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const api = readFileSync(new URL('../src/preload/mafw-api.ts', import.meta.url), 'utf8')
const types = readFileSync(new URL('../src/preload/types.ts', import.meta.url), 'utf8')

test('preload exposes review item methods through the pod namespace', () => {
  for (const method of ['reviewItems', 'createReviewItems', 'resolveReviewItem', 'reopenReviewItem']) {
    assert.match(api, new RegExp(`${method}:`))
    assert.match(types, new RegExp(`${method}[:\\(]`))
  }
  assert.match(api, /acceptResult: \(podID, goalID, body\)/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/preload-pod-review.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement preload methods**

Add named methods near the existing `acceptResult`:
```ts
reviewItems: (podID, goalID, opts) => invoke('pod', 'reviewItems', podID, goalID, opts),
createReviewItems: (podID, goalID, body) => invoke('pod', 'createReviewItems', podID, goalID, body),
resolveReviewItem: (podID, goalID, itemID, body) => invoke('pod', 'resolveReviewItem', podID, goalID, itemID, body),
reopenReviewItem: (podID, goalID, itemID, body) => invoke('pod', 'reopenReviewItem', podID, goalID, itemID, body),
```
Mirror the types in `preload/types.ts`. No main-process change is needed because `mafw-invoke` forwards to the SDK namespace.

- [ ] **Step 4: Run test to verify it passes**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/preload/mafw-api.ts packages/desktop/src/preload/types.ts packages/desktop/tests/preload-pod-review.test.ts
git commit -m "feat(desktop): expose review items to renderer"
```

---

### Task 7: Review-item model and result section component

**Files:**
- Create: `packages/desktop/src/renderer/mafw/pod-review-model.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-review-model.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/PodReviewItems.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/src/renderer/mafw/pod-review-wiring.test.ts`

**Interfaces:**
- Consumes: `PodReviewItem` from `@mafw/sdk`.
- Produces:
  ```ts
  export function reviewStatusLabel(status: PodReviewItemStatus): string
  export function reviewCounts(items: readonly PodReviewItem[]): { unresolved: number; resolved: number }
  export function orderReviewItems(items: readonly PodReviewItem[]): PodReviewItem[] // unresolved first, newest last
  export function canResolveReviewItem(item: PodReviewItem): boolean // pending|responded
  export function canReopenReviewItem(item: PodReviewItem): boolean // responded|resolved
  export function reviewAcceptAction(input: { actionable: boolean; unresolved: number }):
    | { kind: 'accept'; label: '验收并合并到主分支' }
    | { kind: 'handle'; label: '先处理意见' }
  export function forcedAcceptReady(input: { acknowledged: boolean; unresolved: number }): boolean
  ```
  `PodReviewItems` props:
  ```ts
  {
    items: readonly PodReviewItem[]
    busy: boolean
    accepted: boolean
    onResolve(item: PodReviewItem): void
    onReopen(item: PodReviewItem): void
  }
  ```

- [ ] **Step 1: Write the failing model test**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PodReviewItem } from '@mafw/sdk'
import {
  canReopenReviewItem, canResolveReviewItem, forcedAcceptReady,
  orderReviewItems, reviewAcceptAction, reviewCounts, reviewStatusLabel,
} from './pod-review-model'

function item(over: Partial<PodReviewItem>): PodReviewItem {
  return {
    id: 'review_1', podId: 'pod_1', goalId: 'g1', revision: 1,
    status: 'pending', rel: 'src/a.ts', startLine: 1, endLine: 1,
    code: 'x', comment: '改这里', anchor: null, response: null,
    originItemId: null, originRevision: null,
    createdAt: '2026-11-11T00:00:00.000Z', updatedAt: '2026-11-11T00:00:00.000Z',
    respondedAt: null, resolvedAt: null, ...over,
  }
}

test('counts and labels distinguish responded from resolved', () => {
  const items = [item({ id: 'a' }), item({ id: 'b', status: 'responded' }), item({ id: 'c', status: 'resolved' })]
  assert.deepEqual(reviewCounts(items), { unresolved: 2, resolved: 1 })
  assert.equal(reviewStatusLabel('pending'), '待处理')
  assert.equal(reviewStatusLabel('responded'), '已回应')
  assert.equal(reviewStatusLabel('resolved'), '已解决')
  assert.deepEqual(orderReviewItems(items).map((row) => row.id), ['a', 'b', 'c'])
})

test('action transitions are human-only projections', () => {
  assert.equal(canResolveReviewItem(item({ status: 'responded' })), true)
  assert.equal(canResolveReviewItem(item({ status: 'resolved' })), false)
  assert.equal(canReopenReviewItem(item({ status: 'resolved' })), true)
  assert.equal(canReopenReviewItem(item({ status: 'pending' })), false)
})

test('unresolved items steer acceptance to handling first', () => {
  assert.deepEqual(reviewAcceptAction({ actionable: true, unresolved: 2 }), { kind: 'handle', label: '先处理意见' })
  assert.deepEqual(reviewAcceptAction({ actionable: true, unresolved: 0 }), { kind: 'accept', label: '验收并合并到主分支' })
  assert.equal(forcedAcceptReady({ acknowledged: false, unresolved: 2 }), false)
  assert.equal(forcedAcceptReady({ acknowledged: true, unresolved: 2 }), true)
})
```

- [ ] **Step 2: Write the failing wiring test**

```ts
const component = readFileSync(join(import.meta.dirname, 'components/PodReviewItems.tsx'), 'utf8')
const css = readFileSync(join(import.meta.dirname, 'mafw.css'), 'utf8')

test('review item section uses V2 primitives and theme tokens', () => {
  assert.match(component, /ButtonV2/)
  assert.match(component, /reviewStatusLabel/)
  assert.match(component, /确认解决/)
  assert.match(component, /重新打开/)
  assert.doesNotMatch(component, /<button/)
  assert.doesNotMatch(component, /<input/)
  assert.doesNotMatch(component, /\stitle=/)
  assert.match(css, /\.mafw-pod-review\s*\{[^}]*var\(--/)
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-review-model.test.ts src/renderer/mafw/pod-review-wiring.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement model, component, and CSS**

Component renders a section titled `评审意见（未解决 N）`, lists ordered items with status badge, rel/lines, comment, response when present, and buttons `确认解决` / `重新打开` gated by `canResolveReviewItem`/`canReopenReviewItem` and `accepted` (disabled after acceptance). Use `DockEmpty`/`DockBanner` if empty/error patterns are needed. Add token-only CSS classes `.mafw-pod-review*`.

- [ ] **Step 5: Run tests to verify they pass**

Run the Step 3 command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/pod-review-model.ts packages/desktop/src/renderer/mafw/pod-review-model.test.ts packages/desktop/src/renderer/mafw/components/PodReviewItems.tsx packages/desktop/src/renderer/mafw/pod-review-wiring.test.ts packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): render goal review items"
```

---

### Task 8: Result integration and forced acceptance

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/PodResultView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/src/renderer/mafw/pod-result-review-wiring.test.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-review-model.test.ts` (extend)

**Interfaces:**
- Consumes: `PodReviewItems`, model helpers, preload API (Task 6).
- Produces:
  - `PodResultView` props: `onAccept?: (opts?: { force?: boolean; riskAcknowledged?: boolean }) => Promise<PodGoalAcceptResult | null>`
  - Internal state: `reviewItems`, `reviewBusy`, `forceOpen`, `riskAck`.
  - `GoalDetailPanel.acceptGoal(opts?)` forwards `force`/`riskAcknowledged` to `pod.acceptResult`.

- [ ] **Step 1: Write the failing wiring test**

```ts
test('result view loads review items and gates acceptance on unresolved items', () => {
  const src = readFileSync(join(import.meta.dirname, 'components/PodResultView.tsx'), 'utf8')
  assert.match(src, /pod\.reviewItems\(/)
  assert.match(src, /PodReviewItems/)
  assert.match(src, /reviewAcceptAction/)
  assert.match(src, /forcedAcceptReady/)
  assert.match(src, /riskAcknowledged/)
  assert.match(src, /force: true/)
  assert.match(src, /先处理意见/)
  assert.match(src, /确认风险并强制验收/)
  assert.match(src, /onAccept\?\.\(\{ force: true, riskAcknowledged: true \}\)/)
})

test('goal detail forwards forced acceptance flags', () => {
  const src = readFileSync(join(import.meta.dirname, 'components/GoalDetailPanel.tsx'), 'utf8')
  assert.match(src, /acceptGoal = async \(opts\?: \{ force\?: boolean; riskAcknowledged\?: boolean \}\)/)
  assert.match(src, /confirm: true, \.\.\.opts/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-result-review-wiring.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement result integration**

- In the load effect, fetch `window.api.mafw.pod.reviewItems(podId, goalId, activeRevision() ?? undefined)` alongside result/revisions; failure is fail-open empty list.
- Render `<PodReviewItems>` before the acceptance block. `accepted` = `result.acceptance === 'accepted' || worktree merged || acceptanceRecord exists`. Resolve/reopen call the API, then refresh items; show toast on error.
- Add a `refreshReviewItems()` helper used after resolve/reopen and after accept.
- Acceptance area:
  - `reviewAcceptAction({ actionable: view.actionable, unresolved })`: `handle` shows a button `先处理意见` that reveals/focuses the review section; `accept` keeps the existing one-click button.
  - When `handle`, also show an outline button `确认风险并强制验收`; clicking reveals an inline panel with the unresolved list, `CheckboxV2` label `我已了解这些意见未解决，并接受合并风险`, and a confirm button disabled until `forcedAcceptReady`.
  - Confirm calls `props.onAccept({ force: true, riskAcknowledged: true })`; success clears the panel and updates result locally (existing merge state), then refreshes review items.
  - If the non-forced accept returns HTTP 409 (a new item appeared after the last fetch), refresh review items and open the forced panel with a toast: `出现新的未解决意见，请处理或确认风险后强制验收`.
  - Show `acceptanceRecord?.forced` as a note: `已强制验收（N 条未解决意见）`.
- `GoalDetailPanel.acceptGoal` accepts opts and sends `{ confirm: true, ...opts }`.
- Add token-only CSS for the forced panel.

- [ ] **Step 4: Run test to verify it passes**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Run the existing result/acceptance tests**

Run:
```text
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-result-view-model.test.ts src/renderer/mafw/pod-result-diff-wiring.test.ts tests/goal-detail-unified.test.ts tests/pod-collaboration-ui-wiring.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/PodResultView.tsx packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/pod-result-review-wiring.test.ts packages/desktop/src/renderer/mafw/pod-review-model.test.ts
git commit -m "feat(desktop): add forced acceptance flow"
```

---

### Task 9: Annotation-to-review-item capture on send

**Files:**
- Create: `packages/desktop/src/renderer/mafw/review-item-input.ts`
- Test: `packages/desktop/src/renderer/mafw/review-item-input.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/chat/use-send-message.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Test: `packages/desktop/src/renderer/mafw/chat/use-send-message.test.ts`
- Test: `packages/desktop/src/renderer/mafw/chat/annotation-review-wiring.test.ts`

**Interfaces:**
- Consumes: `Annotation` (desktop shared type), `PodReviewItemInput` (SDK), `PodReviewItem` (SDK).
- Produces:
  ```ts
  export function reviewInputsFromAnnotations(items: readonly Annotation[]): PodReviewItemInput[]
  export function reviewItemPromptBlock(items: readonly PodReviewItem[]): string
  ```
  `useSendMessage` deps add:
  ```ts
  peekAnnotations?: (sid: string) => Annotation[]
  persistAnnotations?: (items: Annotation[]) => Promise<string>
  ```
  ChatPane provides both; `persistAnnotations` returns `reviewItemPromptBlock(created.items)` or `''`.

- [ ] **Step 1: Write the failing pure test**

```ts
test('annotations map to review inputs without session-only fields', () => {
  const inputs = reviewInputsFromAnnotations([{
    id: 'ann-1', sessionID: 's1', rel: 'src/a.ts', startLine: 3, endLine: 5,
    code: 'x()', comment: '这里要改', createdAt: 1,
    anchor: { kind: 'quote', quote: '原文' },
    imageDataUrl: 'data:image/png;base64,xxx',
    scopeKey: 'project:x', root: 'C:\\x',
  }])
  expect(inputs).toEqual([{
    rel: 'src/a.ts', startLine: 3, endLine: 5, code: 'x()',
    comment: '这里要改', anchor: { kind: 'quote', quote: '原文' },
  }])
})

test('prompt block names each item so the Tech Lead can respond', () => {
  const block = reviewItemPromptBlock([{ id: 'review_1', rel: 'src/a.ts', comment: '这里要改' } as any])
  expect(block).toContain('review_1')
  expect(block).toContain('mafw_pod_review_respond')
})
```

- [ ] **Step 2: Write the failing send-path test**

Extend `use-send-message.test.ts` with an idle-path case:
```ts
test('persists annotations before clearing drafts; failure aborts send', async () => {
  // deps.pendingAnnotationCount -> 1, peekAnnotations -> [annotation], persistAnnotations -> throw
  // call sendMessage(); expect sessions.promptAsync not called, takeAnnotations not called, sending false
})
test('successful persistence adds the item block to the message', async () => {
  // persistAnnotations -> '已登记 1 条评审项：review_1'
  // expect promptAsync message to contain that block and takeAnnotations called
})
```
Use the existing fake deps harness in that file.

- [ ] **Step 3: Run tests to verify they fail**

Run:
```text
cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/review-item-input.test.ts src/renderer/mafw/chat/use-send-message.test.ts src/renderer/mafw/chat/annotation-review-wiring.test.ts
```
Expected: FAIL.

- [ ] **Step 4: Implement capture**

- `review-item-input.ts` maps only review fields; drop `id`, `sessionID`, `createdAt`, `imageDataUrl`, `scopeKey`, `root`.
- In `use-send-message`, add `peekAnnotations`/`persistAnnotations` deps. In both the busy queue path and the idle path, **before** clearing input/drafts and before the existing `takeAnnotations` call: peek annotations; if non-empty and `persistAnnotations` exists, `await` it (catch → `showToastV2` and return without clearing). Then take annotations as today and append the returned block to the message text. Move the idle path's `setInput("")`/attachment clearing below this staging step; the slash-command path stays unchanged (commands do not consume annotations).
- In `ChatPane`, provide:
  ```ts
  peekAnnotations: (sid) => pendingFor(sid),
  persistAnnotations: async (items) => {
    const target = await Promise.resolve(props.techLeadTarget?.() ?? null)
    if (!target) return ""
    const created = await window.api.mafw.pod.createReviewItems(target.podId, target.goalId, {
      items: reviewInputsFromAnnotations(items),
    })
    return reviewItemPromptBlock(created.items)
  },
  ```
- Source/wiring test asserts ChatPane passes both deps and that `persistAnnotations` uses `createReviewItems`.

- [ ] **Step 5: Run tests to verify they pass**

Run the Step 3 command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/review-item-input.ts packages/desktop/src/renderer/mafw/review-item-input.test.ts packages/desktop/src/renderer/mafw/chat/use-send-message.ts packages/desktop/src/renderer/mafw/chat/use-send-message.test.ts packages/desktop/src/renderer/mafw/chat/annotation-review-wiring.test.ts packages/desktop/src/renderer/mafw/components/ChatPane.tsx
git commit -m "feat(desktop): persist annotations as review items"
```

---

### Task 10: Docs, gates, and live smoke

**Files:**
- Modify: `docs/architecture/desktop.md`
- Modify: `docs/architecture/pod.md`
- Modify: `docs/reference/tools.md`
- Test: run all gates; no new test file.

- [ ] **Step 1: Document the current state**

- `desktop.md`: result review section, unresolved-first acceptance, forced acceptance risk confirmation, annotation capture only in Goal-bound Tech Lead sends.
- `pod.md`: review item tables/status machine, revision carry-over, acceptance audit, human-only rules.
- `tools.md`: `mafw_pod_review_respond`.

- [ ] **Step 2: Run focused gateway tests**

```bash
cd gateway && npx jest tests/unit/pod-review-store.test.ts tests/unit/pod-review-service.test.ts tests/unit/pod-review-routes.test.ts tests/unit/pod-accept-review-gate.test.ts tests/unit/pod-revision-review-carry.test.ts tests/unit/pod-review-respond-tool.test.ts tests/unit/api-contract.test.ts --runInBand
```

- [ ] **Step 3: Run all gateway tests**

```bash
npm test
```
Expected: 0 failures. Record the pass count.

- [ ] **Step 4: Run SDK and desktop gates**

```bash
cd packages/gateway-sdk && npm test
cd ../desktop && npm test
cd ../desktop && npx tsgo --noEmit -p tsconfig.json
cd ../gateway && npx tsc --noEmit -p tsconfig.json
cd ../packages/desktop && node ../../node_modules/electron-vite/bin/electron-vite.js build
```
Expected: all rc=0; record desktop total.

- [ ] **Step 5: Live smoke**

Restart the gateway (new code) and dev app. In a disposable git project:
1. Create a Goal and make its result viewable (reuse the Plan B fixture approach if no real result exists).
2. In the Goal scope, create 2 annotations and send them to the Tech Lead; verify both become `待处理` review items and the message contains their ids.
3. Use the MCP tool or a stub Tech Lead session to respond to one; verify it becomes `已回应` and remains unresolved.
4. Resolve one and reopen it; verify `已解决 → 待处理`, old revision remains unchanged.
5. With unresolved items, click accept: verify the primary action is `先处理意见`; force acceptance requires the checkbox; confirm; verify `acceptanceRecord.forced` is true, the unresolved items remain unresolved, and the merge succeeded.
6. Reject a revision with an unresolved item; verify revision N+1 contains a pending clone with origin, and revision N still has the original.
7. Reload: review states and forced-acceptance note persist.
8. Verify an agent session cannot create/resolve/reopen (403) and cannot force accept (403).

Record the result and screenshot under `.mafw/qa/`.

- [ ] **Step 6: Commit docs**

```bash
git add docs/architecture/desktop.md docs/architecture/pod.md docs/reference/tools.md
git commit -m "docs: record goal review items and forced acceptance"
```

---

## Self-review notes

- Spec §9.1–9.3 covered by Tasks 1–4 and 8–9; §6.5–6.6 by Tasks 3, 8; acceptance scenarios 5/8/9/10/13 by Tasks 1–9; scenario 15 remains out of scope (separate slice).
- Review Focus items map to tests: human-only (Tasks 3, 9), server gate (Task 3), carry-over (Task 3), annotation atomicity (Task 9), transition/immutability (Tasks 2, 3).
- `responded` counts as unresolved, `resolved` does not; forced acceptance records the snapshot and never mutates items.
- Old revision items are never updated; carry-over creates new rows. Replayed reject is already guarded by `expectedRevision`, so clones cannot duplicate.
- Desktop has no agent/MCP path to resolve or accept; the only write is the human preload call.
- Project-scope annotations stay non-persistent; only Goal-bound Tech Lead sends create review items.
- SDK generated artifacts are intentionally committed; no other generated noise.
