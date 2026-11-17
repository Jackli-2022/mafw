# Goal Review Work Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Goal review items carry verifiable source provenance, deduplicate retries, and deterministically reach the Tech Lead plan and Builder execute prompts without changing Goal state ownership.

**Architecture:** Extend the existing gateway review-item row with optional `source_json` and `client_ref`, validate them in `PodReviewService`, and make batch creation idempotent. A new review-work snapshot service captures the unresolved item IDs at plan dispatch, reads that same set at execute, and renders one prompt block through a dedicated `NodeDriver` provider—not ContextManifest or `podContext`. Reject-opening prompts consume the same renderer.

**Tech Stack:** TypeScript, better-sqlite3, Jest, `@mafw/sdk` contract generation, existing `NodeDriver` / `node-prompts`.

**Spec:** `docs/superpowers/specs/2026-11-17-annotation-goal-collaboration-design.md`

## Global Constraints

- Review-item truth stays in the gateway SQLite store; no client-only status authority.
- Only humans create / resolve / reopen / accept; Tech Lead may only mark `responded`.
- `pending` and `responded` are unresolved; only `resolved` is excluded.
- Review items may target only the active revision; old / accepted revisions stay immutable.
- Prompt reads must use the node’s explicit revision, never mutable `goal.activeRevision`.
- Do not inject live review items into ContextManifest, `podContext`, `planFeedback`, `reviewFeedback`, or `reviewFix`.
- The current prompt snapshot is immutable after dispatch; late items wait for the next eligible plan/rework.
- Prompt injection does not schedule rework. No automatic rework loop in this plan.
- Do not expose runtime names or capability flags.
- Tests must prove no silent truncation: oversized review context fails closed.
- Every task follows TDD and ends with an independently testable commit.

## Review Focus

1. **Late item during execute:** an item created after the plan snapshot must not appear in the current execute prompt or quick archive.
2. **Revision isolation:** a rev-2 prompt must use only rev-2 unresolved clones, never old revision rows or duplicate carry rows.
3. **Oversized aggregate:** many large annotations must cause a visible fail-closed error, never silent clipping that drops items.
4. **Response-loss retry:** repeating a review-item batch after the first HTTP response was lost must return the original rows and must not create duplicate rows or events.
5. **Responded semantics:** `responded` remains unresolved and can never resolve itself; acceptance gate and human-only authority stay unchanged.

---

### Task 1: Persist review provenance and client references

**Files:**
- Modify: `gateway/src/core/pod/pod-store.ts:151-170, 450-471, 699-720, 893-910, 1380-1549`
- Test: `gateway/tests/unit/pod-review-provenance-store.test.ts`

**Interfaces:**
- Consumes: existing `PodStore.createReviewItem`, `carryForwardReviewItems`, `ensureColumn`.
- Produces:
  ```ts
  export type PodReviewSource =
    | { kind: 'project'; projectDir: string; root: string; contentVersion: string | null }
    | { kind: 'goal'; projectDir: string; goalId: string; revision: number; root: string; contentVersion: string | null };

  // Added to PodReviewItemRow
  source: PodReviewSource | null;
  clientRef: string | null;
  ```
- Produces: `PodStore.findReviewItemByClientRef(podId, goalId, revision, clientRef): PodReviewItemRow | null`.

- [ ] **Step 1: Write the failing store test**

```ts
test('stores source/clientRef, finds retries, and carries provenance', () => {
  const db = new Database(':memory:');
  const store = new PodStore(db);
  store.enqueueGoal({ id: 'row_1', podId: 'pod_1', goalId: 'g1', now });
  store.setGoalStatus('row_1', 'active', { startedAt: now });
  const source = { kind: 'project' as const, projectDir: 'C:/repo', root: 'C:/repo', contentVersion: 'v1' };
  const item = store.createReviewItem({
    podId: 'pod_1', goalId: 'g1', revision: 1, rel: 'src/a.ts',
    comment: '改这里', sourceJson: JSON.stringify(source), clientRef: 'ann-1', now,
  });
  expect(item.source).toEqual(source);
  expect(item.clientRef).toBe('ann-1');
  expect(store.findReviewItemByClientRef('pod_1', 'g1', 1, 'ann-1')?.id).toBe(item.id);
  store.carryForwardReviewItems({ podId: 'pod_1', goalId: 'g1', fromRevision: 1, toRevision: 2, now });
  expect(store.listReviewItems('pod_1', 'g1', 2)[0].source).toEqual(source);
});
```

Add a migration test that creates the legacy table without the columns, instantiates `PodStore`, and asserts both columns exist. Add a uniqueness test for `(pod_id, goal_id, revision, client_ref)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/pod-review-provenance-store.test.ts --runInBand`Expected: FAIL because the columns, type fields, and lookup do not exist.

- [ ] **Step 3: Implement store columns and mapping**

Add `ensureColumn('pod_goal_review_items', 'source_json', 'source_json TEXT')` and `ensureColumn('pod_goal_review_items', 'client_ref', 'client_ref TEXT')`, then create the partial unique index on `(pod_id, goal_id, revision, client_ref) WHERE client_ref IS NOT NULL`.

Parse `source_json` defensively in `reviewItemFromRow`; invalid JSON becomes `null` for old rows, but new writes always receive validated JSON from the service. Include both fields in `CREATE`, `carryForwardReviewItems`, and the row interface.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/pod-review-provenance-store.test.ts --runInBand`Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-store.ts gateway/tests/unit/pod-review-provenance-store.test.ts
git commit -m "feat(gateway): persist review item provenance"
```

---

### Task 2: Make review-item batch creation idempotent and validated

**Files:**
- Modify: `gateway/src/core/pod/pod-review-service.ts:21-185, 203-231`
- Modify: `gateway/tests/unit/pod-review-service.test.ts`
- Modify: `gateway/tests/unit/pod-review-routes.test.ts`

**Interfaces:**
- Consumes: Task 1 store fields and lookup.
- Produces:
  ```ts
  export interface PodReviewItemInput {
    rel: string;
    startLine?: number | null;
    endLine?: number | null;
    code?: string;
    comment: string;
    anchor?: PodReviewAnchor;
    source?: PodReviewSource;
    clientRef?: string;
  }

  // Added to PodReviewItem
  source: PodReviewSource | null;
  clientRef: string | null;
  ```
- Produces: `PodReviewService.createItems` is retry-safe; duplicate `clientRef` in one request is rejected.

- [ ] **Step 1: Write the failing service tests**

```ts
test('retries reuse clientRef rows without duplicate events', () => {
  const { service, store } = setup();
  const source = { kind: 'project' as const, projectDir: 'C:/repo', root: 'C:/repo', contentVersion: 'v1' };
  const first = service.createItems('pod_1', 'g1', {
    items: [{ rel: 'src/a.ts', comment: '改这里', source, clientRef: 'ann-1' }],
  });
  const second = service.createItems('pod_1', 'g1', {
    items: [{ rel: 'src/a.ts', comment: '改这里', source, clientRef: 'ann-1' }],
  });
  expect(second[0].id).toBe(first[0].id);
  expect(store.listReviewItems('pod_1', 'g1', 1)).toHaveLength(1);
  expect(store.listReviewItemEvents(first[0].id)).toHaveLength(1);
});

test('rejects duplicate clientRefs in one batch and invalid source', () => {
  const { service } = setup();
  expect(() => service.createItems('pod_1', 'g1', { items: [
    { rel: 'a.ts', comment: 'a', clientRef: 'same' },
    { rel: 'b.ts', comment: 'b', clientRef: 'same' },
  ] })).toThrow(PodError);
  expect(() => service.createItems('pod_1', 'g1', { items: [
    { rel: 'a.ts', comment: 'a', source: { kind: 'goal', projectDir: 'C:/r' } as any },
  ] })).toThrow(PodError);
});
```

Route test asserts `revision`, `source`, and `clientRef` survive the HTTP body and that `actorSessionID` still returns 403.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest tests/unit/pod-review-service.test.ts tests/unit/pod-review-routes.test.ts --runInBand`Expected: FAIL because source/clientRef are not validated or persisted.

- [ ] **Step 3: Implement validation and idempotent transaction**

Validate `source` shape (`project` vs `goal`, required strings, positive goal revision), cap serialized source at 16 KiB, and cap `clientRef` at 200 characters. Reject duplicate non-empty client refs within one batch before writing. Inside the transaction, first look up each ref; reuse an existing item, otherwise insert and append one `created` event. Emit notification only when at least one row was created. Return results in input order.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest tests/unit/pod-review-service.test.ts tests/unit/pod-review-routes.test.ts --runInBand`Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-review-service.ts gateway/tests/unit/pod-review-service.test.ts gateway/tests/unit/pod-review-routes.test.ts
git commit -m "feat(gateway): make review batches idempotent"
```

---

### Task 3: Extend wire contracts and SDK types

**Files:**
- Modify: `gateway/src/routes/schemas/pod-write.ts:314-332`
- Modify: `gateway/src/routes/schemas/pods.ts:530-559`
- Modify: `packages/gateway-sdk/src/types.ts:1696-1737`
- Modify: `packages/gateway-sdk/src/pod-collaboration.test.ts`
- Generated: `packages/gateway-sdk/contract/openapi.json`, `packages/gateway-sdk/contract/gateway-paths.json`, `packages/gateway-sdk/src/api-schema.gen.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PodReviewSource =
    | { kind: 'project'; projectDir: string; root: string; contentVersion: string | null }
    | { kind: 'goal'; projectDir: string; goalId: string; revision: number; root: string; contentVersion: string | null };

  export interface PodReviewItem {
    // existing fields
    source: PodReviewSource | null;
    clientRef: string | null;
  }

  export interface PodReviewItemInput {
    // existing fields
    source?: PodReviewSource;
    clientRef?: string;
  }
  ```

- [ ] **Step 1: Write the failing SDK test**

```ts
test('createReviewItems forwards revision, source, and clientRef', async () => {
  fetchMock.mockResolvedValue(okJson({ items: [] }));
  const c = new MafwClient('http://gw:3000');
  const source = { kind: 'project' as const, projectDir: 'C:/repo', root: 'C:/repo', contentVersion: 'v1' };
  await c.pod.createReviewItems('pod_1', 'g1', {
    revision: 2,
    items: [{ rel: 'src/a.ts', comment: 'x', source, clientRef: 'ann-1' }],
  });
  expect(JSON.parse(lastCall()[1].body)).toEqual({
    revision: 2,
    items: [{ rel: 'src/a.ts', comment: 'x', source, clientRef: 'ann-1' }],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @mafw/sdk`Expected: FAIL because the SDK type does not expose the fields.

- [ ] **Step 3: Implement schemas, types, and generated contracts**

Add the source schema and optional `clientRef` to the request schema; add non-optional nullable source/clientRef to the response schema. Mirror it in SDK types. Regenerate the gateway contract with `cd gateway && npm run emit:openapi`, then run `npm run build -w @mafw/sdk`; commit all generated artifacts with the source changes.

- [ ] **Step 4: Run tests and contract check**

Run: `npm test -w @mafw/sdk`Expected: PASS.Run: `npm run build -w @mafw/sdk`Expected: rc=0 and generated contract files updated.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/schemas/pod-write.ts gateway/src/routes/schemas/pods.ts packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/pod-collaboration.test.ts packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts
git commit -m "feat(sdk): expose review provenance contracts"
```

---

### Task 4: Capture and render a review-work snapshot

**Files:**
- Create: `gateway/src/core/pod/goal-review-context.ts`
- Test: `gateway/tests/unit/goal-review-context.test.ts`

**Interfaces:**
- Consumes: `PodReviewItem` from `pod-review-service`.
- Produces:
  ```ts
  export interface ReviewWorkSnapshot {
    version: 1;
    revision: number;
    capturedAt: string;
    itemIds: string[];
  }

  export function reviewWorkSnapshotPath(mafwDir: string, goalId: string, revision: number): string;
  export function captureReviewWorkSnapshot(input: {
    path: string; revision: number; items: readonly PodReviewItem[]; now: string;
  }): ReviewWorkSnapshot;
  export function readReviewWorkSnapshot(path: string, revision: number): ReviewWorkSnapshot | null;
  export function renderReviewWorkBlock(input: {
    revision: number; items: readonly PodReviewItem[]; capturedAt: string;
  }): string | null;
  ```

- [ ] **Step 1: Write the failing snapshot/render tests**

```ts
test('renders pending and responded items once as quoted data', () => {
  const block = renderReviewWorkBlock({ revision: 2, capturedAt: now, items: [pending, responded, resolved] });
  expect(block).toContain('review_1');
  expect(block).toContain('改这里');
  expect(block).toContain('已回应但未解决');
  expect(block).not.toContain('resolved_1');
  expect(block).toContain('只有用户能确认解决');
});

test('plan snapshot stays stable and corrupt snapshots fail closed', () => {
  const snapshot = captureReviewWorkSnapshot({ path, revision: 2, items: [pending], now });
  expect(snapshot.itemIds).toEqual([pending.id]);
  expect(readReviewWorkSnapshot(path, 2)?.itemIds).toEqual([pending.id]);
  fs.writeFileSync(path, '{broken');
  expect(() => readReviewWorkSnapshot(path, 2)).toThrow(/snapshot/);
});

test('oversized aggregate fails instead of truncating', () => {
  expect(() => renderReviewWorkBlock({ revision: 1, capturedAt: now, items: [hugeItem] }))
    .toThrow(/review context is too large/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/goal-review-context.test.ts --runInBand`Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement snapshot IO and renderer**

Resolve the snapshot at `path.join(goalArtifactRoot(mafwDir, goalId, revision), 'review-work.json')` so revision 1 keeps the legacy root layout and revision 2+ stays revision-isolated. Write JSON atomically (`tmp` then rename). Read validates `version === 1` and revision equality; missing file returns `null`, corrupt/mismatched file throws. Render only `status !== 'resolved'`, preserve caller order, include status/response/source provenance, escape fenced-code delimiters, and throw when the rendered block exceeds `128 * 1024` characters. Include an explicit line that these are user-authored review items and only the human may resolve them.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/goal-review-context.test.ts --runInBand`Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/goal-review-context.ts gateway/tests/unit/goal-review-context.test.ts
git commit -m "feat(gateway): render review work snapshots"
```

---

### Task 5: Add the review context service and boot provider

**Files:**
- Create: `gateway/src/core/pod/goal-review-work-service.ts`
- Test: `gateway/tests/unit/goal-review-work-service.test.ts`
- Modify: `gateway/src/boot.ts:811-853`

**Interfaces:**
- Consumes: Task 4 exports; `PodReviewService.unresolved(podId, goalId, revision)`.
- Produces:
  ```ts
  export class GoalReviewWorkService {
    constructor(deps: {
      reviews: Pick<PodReviewService, 'unresolved'>;
      mafwDirForGoal(goalId: string): string | null;
      now(): string;
    });
    render(input: {
      podId: string; goalId: string; revision: number; node: 'plan' | 'execute';
    }): string | null;
  }
  ```
- Produces in boot: `reviewItemsContext(goalId, node, revision) => Promise<string | null>`.

- [ ] **Step 1: Write the failing service tests**

```ts
test('plan captures a snapshot and execute reuses it', () => {
  const service = new GoalReviewWorkService({ reviews, mafwDirForGoal: () => dir, now: () => now });
  reviews.unresolved.mockReturnValueOnce([itemA]);
  expect(service.render({ podId: 'pod_1', goalId: 'g1', revision: 2, node: 'plan' })).toContain('review_a');
  reviews.unresolved.mockReturnValueOnce([itemA, itemLate]);
  const execute = service.render({ podId: 'pod_1', goalId: 'g1', revision: 2, node: 'execute' });
  expect(execute).toContain('review_a');
  expect(execute).not.toContain('review_late');
});

test('resolved items leave the frozen set and missing dirs fail closed', () => {
  // same snapshot, resolve itemA, execute returns null for empty membership
  // mafwDirForGoal() -> null throws
});

test('revision 2 renders only current-revision unresolved rows', () => {
  reviews.unresolved.mockReturnValue([rev2Clone]);
  const block = service.render({ podId: 'pod_1', goalId: 'g1', revision: 2, node: 'plan' }) ?? '';
  expect(block).toContain(rev2Clone.id);
  expect(block).not.toContain('review_rev1_origin');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/goal-review-work-service.test.ts --runInBand`Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement plan capture, execute read, and boot wiring**

For `plan`, always write a snapshot (including an empty ID list). For `execute`, read the snapshot; if absent, capture current unresolved items once for legacy recovery. Filter the current unresolved items by snapshot IDs and render in stable store order. Never silently fall back from a corrupt snapshot. Wire the provider in `boot.ts` only when a Pod exists; resolve `mafwDir` from the existing goal-dir cache and call `kernel.podReviewService`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/goal-review-work-service.test.ts --runInBand`Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/goal-review-work-service.ts gateway/tests/unit/goal-review-work-service.test.ts gateway/src/boot.ts
git commit -m "feat(gateway): assemble review work context"
```

---

### Task 6: Inject the snapshot into plan and execute prompts

**Files:**
- Modify: `gateway/src/core/goal/driver.ts:250-306, 490-715`
- Modify: `gateway/src/core/goal/node-prompts.ts:375-442, 521-606`
- Test: `gateway/tests/unit/node-prompts-review-items.test.ts`
- Test: `gateway/tests/unit/goal-driver-review-context.test.ts`

**Interfaces:**
- Consumes: boot provider from Task 5.
- Produces:
  ```ts
  interface DriverDeps {
    reviewItemsContext?: (
      goalId: string,
      node: 'plan' | 'execute',
      revision: number,
    ) => Promise<string | null> | string | null;
  }

  interface NodePromptCtx {
    reviewItemsBlock?: string;
  }
  ```

- [ ] **Step 1: Write the failing prompt and driver tests**

```ts
test('plan and execute render the review block; review does not', () => {
  const ctx = { /* existing fixture */ reviewItemsBlock: '【本批人类评审意见】\n- review_1' };
  expect(renderNodePrompt('plan', ctx)).toContain('review_1');
  expect(renderNodePrompt('execute', ctx)).toContain('review_1');
  expect(renderNodePrompt('review', ctx)).not.toContain('review_1');
});

test('driver passes the in-flight revision and fails closed on provider error', async () => {
  const calls: Array<[string, number]> = [];
  // build the same state fixture used by goal-driver-plan-review.test.ts with active rev 2
  await driver.advance('g1');
  expect(calls).toEqual([['plan', 2]]);
  expect(readGoalState(dir, 'g1')?.lastFailure?.code).toBe('review_context_invalid');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest tests/unit/node-prompts-review-items.test.ts tests/unit/goal-driver-review-context.test.ts --runInBand`Expected: FAIL because the provider and prompt field do not exist.

- [ ] **Step 3: Implement prompt and driver wiring**

In `executeNode`, resolve the review context once for `plan` and `execute` before creating a runtime session. Catch provider errors, call `failBeforeSession` with `review_context_invalid`, and return without dispatching. Pass the block into `renderNodePrompt`. Render it after retry context and before Goal acceptance / execute task instructions. Do not call it for `review` or `probe`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest tests/unit/node-prompts-review-items.test.ts tests/unit/goal-driver-review-context.test.ts --runInBand`Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/driver.ts gateway/src/core/goal/node-prompts.ts gateway/tests/unit/node-prompts-review-items.test.ts gateway/tests/unit/goal-driver-review-context.test.ts
git commit -m "feat(gateway): inject review work into goal prompts"
```

---

### Task 7: Carry review context into reject opening and tighten response semantics

**Files:**
- Modify: `gateway/src/core/pod/pod-goal-service.ts:66-83, 920-945`
- Modify: `gateway/src/skills/tech-lead-identity.ts`
- Test: `gateway/tests/unit/pod-reject-review-context.test.ts`
- Test: existing `gateway/tests/integration/pod-collaboration-loop.test.ts`
- Modify: `docs/architecture/pod.md`

**Interfaces:**
- Consumes: `renderReviewWorkBlock` from Task 4.
- Produces:
  ```ts
  export function buildRejectOpeningPrompt(input: {
    rejectedRevision: number;
    revision: number;
    feedback: string;
    verdict?: string | null;
    reviewItemsBlock?: string | null;
  }): string;
  ```

- [ ] **Step 1: Write the failing reject-opening test**

```ts
test('reject opening carries new revision review items once', () => {
  const prompt = buildRejectOpeningPrompt({
    rejectedRevision: 1,
    revision: 2,
    feedback: '请按批注修改',
    verdict: 'UNREVIEWED',
    reviewItemsBlock: '【本批人类评审意见】\n- review_new · 改这里',
  });
  expect(prompt).toContain('review_new');
  expect(prompt.match(/review_new/g)).toHaveLength(1);
  expect(prompt).toContain('只有用户能确认解决');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/pod-reject-review-context.test.ts --runInBand`Expected: FAIL because the prompt has no review-items input.

- [ ] **Step 3: Implement reject integration and Tech Lead guidance**

After `carryForwardReviewItems`, read unresolved items for the new revision and render them into the opening prompt. Update the Tech Lead identity text to say `responded` requires a concrete explanation or an inspectable change, never a bare acknowledgement, and that only the human resolves. Extend the existing integration test to assert new revision clone IDs appear once in the opening prompt.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest tests/unit/pod-reject-review-context.test.ts tests/unit/pod-review-service.test.ts tests/integration/pod-collaboration-loop.test.ts --runInBand`Expected: PASS.

- [ ] **Step 5: Document current behavior**

Add a short “Goal review work context” subsection to `docs/architecture/pod.md`: source provenance/idempotency, plan snapshot, execute reuse, late items, fail-closed size, and no automatic rework.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/core/pod/pod-goal-service.ts gateway/src/skills/tech-lead-identity.ts gateway/tests/unit/pod-reject-review-context.test.ts gateway/tests/integration/pod-collaboration-loop.test.ts docs/architecture/pod.md
git commit -m "feat(gateway): carry review context into rework"
```

---

### Task 8: Final gateway gates

**Files:**
- No product files unless a gate exposes a defect.

- [ ] **Step 1: Run focused review/prompt suites**

Run: `cd gateway && npx jest tests/unit/pod-review-provenance-store.test.ts tests/unit/pod-review-service.test.ts tests/unit/pod-review-routes.test.ts tests/unit/goal-review-context.test.ts tests/unit/goal-review-work-service.test.ts tests/unit/node-prompts-review-items.test.ts tests/unit/goal-driver-review-context.test.ts tests/unit/pod-reject-review-context.test.ts --runInBand`Expected: all pass.

- [ ] **Step 2: Run gateway typecheck**

Run: `cd gateway && npx tsc --noEmit -p tsconfig.json`Expected: rc=0.

- [ ] **Step 3: Run gateway full suite and SDK suite**

Run: `npm test -- --forceExit`Expected: gateway full suite passes.Run: `cd gateway && npm run schema:coverage`Expected: rc=0.Run: `npm test -w @mafw/sdk`Expected: SDK suite passes.

- [ ] **Step 4: Report counts and commit any gate fix**

Record new test count, full pass count, typecheck, and generated-contract status in the delivery note. Commit only intentional gate fixes; do not fold unrelated workspace changes into this branch.
