# Annotation Discussion and Goal Delegation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make file annotations lightweight drafts that can be explicitly discussed with Lead / free chat / a Goal Tech Lead, or explicitly delegated as one batch to one Goal, without letting the current tab decide their recipient.

**Architecture:** Keep one local draft store keyed by origin session plus scope, with immutable structured source metadata and two terminal markers (`discussedAt`, `delegatedAt`). Normal composer sends remain plain chat and attach a hidden synthetic annotation-reference part; Goal persistence happens only through a separate delegation executor. A pure delegation planner validates source/target ownership, maps snapshot/approval/result stages to one follow-up action, and uses review-item `clientRef` idempotency from the gateway plan.

**Tech Stack:** TypeScript, SolidJS, Electron IPC, `@mafw/ui/v2`, `@mafw/sdk`, Node test runner with `--conditions=browser`.

**Spec:** `docs/superpowers/specs/2026-11-17-annotation-goal-collaboration-design.md`

**Prerequisite plan:** `docs/superpowers/plans/2026-11-17-goal-review-work-context.md`

## Global Constraints

- Ordinary annotation creation and chat sends never create a Goal or review item.
- Discussion recipients and delegation targets are explicit user choices; active tab may provide a default but never overrides the choice.
- One delegation batch targets one Goal; one Goal may absorb many batches.
- Source provenance is immutable; target Goal/revision is separate and chosen at delegation.
- Goal-source annotations may only target the same Goal’s active/mutable revision in this phase. Cross-Goal transfer still requires Lead’s explicit ContextManifest selection.
- Unsaved source content may be discussed but not delegated. No uncommitted patch is copied into a Goal worktree.
- A review-item retry reuses `clientRef`; it must not create duplicate items or revisions.
- Agent-native composer stays single-surface; do not restore four global chat modes.
- UI uses only `@mafw/ui` v2 components, registered icons, theme tokens; no raw `<button>` / `<input>` / bare `title`.
- Tests run with `--conditions=browser`; TDD for every task.
- No push.

## Review Focus

1. **Async tab switch:** media upload, discussion send, or review-item creation must keep the route captured at click time; a later tab switch cannot change recipient, Goal, or revision.
2. **Wrong-source write:** project content and Goal B content must never silently become Goal A review items.
3. **Discussion purity:** “发给 Lead 解释” must create zero Goals and zero review items; a failed send must leave drafts sendable.
4. **No open Chat:** annotations saved with no active session must persist, remain visible/actionable, and survive restart.
5. **Goal diff:** adding a review draft on a Goal revision diff must never use `previewOnly` or the session `promptAsync` bypass.

---

### Task 1: Scope-aware draft model, lifecycle markers, and IPC patch/find

**Files:**
- Modify: `packages/desktop/src/shared/annotation-types.ts`
- Modify: `packages/desktop/src/shared/annotations.ts`
- Modify: `packages/desktop/src/preload/types.ts`
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/main/ipc.ts`
- Modify: `packages/desktop/src/renderer/mafw/annotation-store.ts`
- Create: `packages/desktop/src/renderer/mafw/annotation-scope.ts`
- Test: `packages/desktop/src/renderer/mafw/annotation-scope.test.ts`
- Test: `packages/desktop/src/shared/annotations.test.ts`
- Test: `packages/desktop/src/renderer/mafw/annotation-store.test.ts`
- Test: `packages/desktop/src/shared/annotations-wiring.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AnnotationSource =
    | { kind: "project"; projectDir: string }
    | { kind: "goal"; projectDir: string; goalId: string; revision: number };

  export type Annotation = {
    // existing fields
    source?: AnnotationSource;
    contentVersion?: string | null;
    capturedDirty?: boolean;
    discussedAt?: number;
    delegatedAt?: number;
    reviewItemIDs?: string[];
  };
  ```
- Produces:
  ```ts
  export function draftOwnerKey(sessionID: string | null, scopeKey: string | null | undefined): string;
  export function annotationSourceFromScopeKey(
    scopeKey: string | null | undefined,
    root: string | null | undefined,
  ): AnnotationSource | null;
  export function annotationInScope(
    annotation: Annotation,
    scopeKey: string | null | undefined,
    root: string | null | undefined,
  ): boolean;
  ```
- Produces in `annotation-store.ts`:
  ```ts
  export function draftsFor(ownerKey: string): Annotation[];
  export function sendableFor(ownerKey: string): Annotation[]; // excludes held/discussed/delegated
  export function patchPending(ownerKey: string, id: string, patch: Partial<Annotation>): void;
  export function annotationsByIDs(ids: readonly string[]): Annotation[];
  export async function hydrateAnnotationsByIDs(ids: readonly string[]): Promise<void>;
  ```
- IPC adds `annotations.patch(sessionID,id,patch)` and `annotations.findByIds(ids)`.

- [ ] **Step 1: Write failing scope and lifecycle tests**

```ts
test('draft owner and source never depend on the active chat tab', () => {
  assert.equal(draftOwnerKey(null, 'goal:C:/repo:g2:r1'), 'draft:goal:C:/repo:g2:r1');
  assert.deepEqual(annotationSourceFromScopeKey('project:C:/repo', 'C:/repo'), {
    kind: 'project', projectDir: 'C:/repo',
  });
  assert.deepEqual(annotationSourceFromScopeKey('goal:C:/repo:g2:r2', 'C:/worktrees/g2-r2'), {
    kind: 'goal', projectDir: 'C:/repo', goalId: 'g2', revision: 2,
  });
});

test('discussed and delegated drafts are not sendable', () => {
  addPending({ sessionID: 's1', scopeKey: 'project:C:/r', rel: 'a.ts', startLine: 1, endLine: 1, code: 'x', comment: 'a' });
  const id = pendingFor('s1')[0].id;
  patchPending('s1', id, { discussedAt: 10 });
  assert.deepEqual(sendableFor('s1'), []);
  assert.equal(annotationsByIDs([id])[0].discussedAt, 10);
});
```

Add a main-repo test proving `patch` persists known fields without allowing `id/sessionID/createdAt` mutation, and that `findByIds` returns records across session buckets. Add a no-session test: add under `draft:project:C:/repo`, recreate the repo/store from the same KV store, and hydrate that owner key back to the same draft.

- [ ] **Step 2: Run tests to verify they fail**

Run from `packages/desktop`:

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/annotation-scope.test.ts src/renderer/mafw/annotation-store.test.ts src/shared/annotations.test.ts
```

Expected: FAIL because the fields and functions do not exist.

- [ ] **Step 3: Implement model, pure helpers, and IPC**

Add the optional fields and helpers. `sendableFor` excludes `held`, `discussedAt`, and `delegatedAt`; legacy rows without `source` remain readable. Main repo exposes `patch` with an allowlist of mutable annotation fields and `findByIds` scanning all session buckets. Renderer `patchPending` updates local first then write-through IPC; `hydrateAnnotationsByIDs` merges returned records by ID and bumps a single revision.

- [ ] **Step 4: Run tests to verify they pass**

Run the same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/shared/annotation-types.ts packages/desktop/src/shared/annotations.ts packages/desktop/src/preload/types.ts packages/desktop/src/preload/index.ts packages/desktop/src/main/ipc.ts packages/desktop/src/renderer/mafw/annotation-store.ts packages/desktop/src/renderer/mafw/annotation-scope.ts packages/desktop/src/renderer/mafw/annotation-scope.test.ts packages/desktop/src/shared/annotations.test.ts packages/desktop/src/renderer/mafw/annotation-store.test.ts packages/desktop/src/shared/annotations-wiring.test.ts
git commit -m "feat(desktop): model annotation drafts by scope"
```

---

### Task 2: Capture immutable source, file versions, and scope-filtered rail/composer

**Files:**
- Create: `packages/desktop/src/main/fs-version.ts`
- Test: `packages/desktop/src/main/fs-version.test.ts`
- Modify: `packages/desktop/src/main/ipc.ts`
- Modify: `packages/desktop/src/preload/types.ts:26-45`
- Modify: `packages/desktop/src/preload/index.ts:165-180`
- Create: `packages/desktop/src/renderer/mafw/annotation-source.ts`
- Test: `packages/desktop/src/renderer/mafw/annotation-source.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/EditorDock.tsx:89-116, 330-359, 1278-1341, 1738-1782`
- Modify: `packages/desktop/src/renderer/mafw/components/CommentsPill.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx:163-296, 1227-1243`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:3048-3054`

**Interfaces:**
- Produces from preload `fs.version(root, rel)`:
  ```ts
  type FsVersionResult =
    | { ok: true; sha256: string; size: number; mtimeMs: number }
    | { ok: false; reason: 'jail' | 'not-found' | 'io' | 'too-large' };
  ```
- Produces:
  ```ts
  export function textFingerprint(content: string): string;
  export function annotationSourceProblem(annotation: Annotation): string | null;
  export function anchorOccursIn(content: string, annotation: Annotation): boolean;
  ```
- EditorDock props add `annotationOwnerKey: string | null` and `onDiscussAnnotations?: (items: Annotation[]) => void`.
- ChatPane props add `annotationOwnerKey: string`, `contentScopeKey: string | null`, `onProcessAnnotations?: (items: Annotation[]) => void`.

- [ ] **Step 1: Write failing source/version/filter tests**

```ts
test('dirty captures are discussable but not delegable', () => {
  const a = annotation({ capturedDirty: true, source: { kind: 'project', projectDir: 'C:/r' } });
  assert.match(annotationSourceProblem(a) ?? '', /保存/);
});

test('anchor lookup is exact and rejects stale source', () => {
  const a = annotation({ startLine: 2, endLine: 2, code: 'const x = 1' });
  assert.equal(anchorOccursIn('line1\nconst x = 1\nline3', a), true);
  assert.equal(anchorOccursIn('line1\nconst x = 2\nline3', a), false);
});

test('file version hashes bytes and refuses escapes', async () => {
  assert.match((await versionFile(okIo, 'C:/repo', 'a.ts')).sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await versionFile(okIo, 'C:/repo', '../secret'), { ok: false, reason: 'jail' });
});
```

Routing tests assert a project draft and a Goal B draft never both appear for Goal A scope, and a draft created with no session uses the `draft:<scopeKey>` owner key.

- [ ] **Step 2: Run tests to verify they fail**

Run from `packages/desktop`:

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/fs-version.test.ts src/renderer/mafw/annotation-source.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement capture and filtering**

`fs-version` resolves inside the registered root jail, rejects files larger than 32 MiB as `too-large`, and returns SHA-256 plus stat metadata. Wire one IPC handler and preload method.

When EditorDock creates an annotation, include `scopeKey`, `root`, `source`, `capturedDirty: f.dirty`, and `contentVersion` for clean text files (`textFingerprint(f.savedContent)`). For previews, MafwShell asynchronously calls `fs.version(root, rel)` and patches `contentVersion`; failure leaves it `null` without losing the draft.

Change `MafwShell.addAnnotation` so no session means `draftOwnerKey(null, scopeKey)`, not return. Use the owner key for marks, rail, held state, and composer counts. Filter `fileAnnotations`, CommentsPill items, and ChatPane pending counts with `annotationInScope`. If the active chat is a Tech Lead for Goal A, hide a Goal B draft from that composer rather than letting it flow into A.

- [ ] **Step 4: Run tests to verify they pass**

Run the same command; expected PASS. Also run the existing:

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/annotation-store.test.ts src/renderer/mafw/annotation-scope.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/fs-version.ts packages/desktop/src/main/fs-version.test.ts packages/desktop/src/main/ipc.ts packages/desktop/src/preload/types.ts packages/desktop/src/preload/index.ts packages/desktop/src/renderer/mafw/annotation-source.ts packages/desktop/src/renderer/mafw/annotation-source.test.ts packages/desktop/src/renderer/mafw/components/EditorDock.tsx packages/desktop/src/renderer/mafw/components/CommentsPill.tsx packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(desktop): capture annotation source provenance"
```

---

### Task 3: Make composer sends discussion-only and record discussed annotations

**Files:**
- Create: `packages/desktop/src/renderer/mafw/annotation-message-part.ts`
- Test: `packages/desktop/src/renderer/mafw/annotation-message-part.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/chat/use-send-message.ts:65-200, 211-390, 483-575`
- Modify: `packages/desktop/src/renderer/mafw/components/turn-queue.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx:1201-1243`
- Test: `packages/desktop/src/renderer/mafw/chat/use-send-message.test.ts`
- Test: `packages/desktop/src/renderer/mafw/components/turn-queue.test.ts`
- Modify: `docs/architecture/desktop.md` annotation section

**Interfaces:**
- Produces:
  ```ts
  export function annotationRefPart(ids: readonly string[]): {
    id: string; type: 'text'; text: string; synthetic: true;
  };
  export function parseAnnotationRefPart(part: unknown): string[];
  ```
- `QueuedTurn` adds `annotationIDs?: string[]`.
- `SendMessageDeps` removes `persistAnnotations`; adds:
  ```ts
  markAnnotationsDiscussed?: (ownerKey: string, ids: readonly string[], at: number) => void;
  ```
- `sendMessage` accepts `opts.annotationIDs?: readonly string[]` for queue replay.

- [ ] **Step 1: Write the failing send tests**

```ts
test('normal send never creates review items and marks drafts only after success', async () => {
  deps.peekAnnotations = () => [annotation];
  deps.markAnnotationsDiscussed = mark;
  await sendMessage();
  assert.equal(mark.calls.length, 0); // before transport resolution
  resolveSend();
  assert.deepEqual(mark.ids, ['ann-1']);
  assert.equal(createReviewCalls.length, 0);
});

test('failed discussion send leaves the annotation sendable', async () => {
  rejectSend(new Error('offline'));
  await sendMessage();
  assert.equal(mark.calls.length, 0);
  assert.equal(sendableFor('s1').length, 1);
});

test('annotation batches force local queue and replay with ids', async () => {
  assert.equal(decideBusyDelivery({ mode: 'send', steerSupported: true, hasMedia: false, hasAnnotations: true }), 'local-queue');
  // queued turn carries annotationIDs; flush passes them to sendMessage
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `packages/desktop`:

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/annotation-message-part.test.ts src/renderer/mafw/chat/use-send-message.test.ts src/renderer/mafw/components/turn-queue.test.ts
```

Expected: FAIL because the send path still persists review items and the ref part does not exist.

- [ ] **Step 3: Implement discussion-only transport**

Remove `persistAnnotations`, `takeAnnotations`, and review-block composition from the composer path. Keep the visible annotation batch in message text. Add a synthetic annotation-reference part containing the annotation IDs to optimistic parts, `chat.sendEnriched.parts`, and the Tech Lead `prompt` parts. Mark annotations discussed only after a successful transport; do not remove their records.

When the session is busy and any annotation is selected, force `local-queue` and carry the exact annotation IDs in `QueuedTurn`. `flushQueue` passes those IDs into `sendMessage`, so later drafts do not join an already queued message. Removing a queued turn leaves its annotations sendable. Update the desktop architecture paragraph that currently says a Tech Lead send creates review items.

- [ ] **Step 4: Run tests to verify they pass**

Run the same command; expected PASS. Then run the existing ChatPane annotation wiring tests and update assertions that required `persistAnnotations`.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/annotation-message-part.ts packages/desktop/src/renderer/mafw/annotation-message-part.test.ts packages/desktop/src/renderer/mafw/chat/use-send-message.ts packages/desktop/src/renderer/mafw/components/turn-queue.ts packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/chat/use-send-message.test.ts packages/desktop/src/renderer/mafw/components/turn-queue.test.ts docs/architecture/desktop.md
git commit -m "feat(desktop): separate annotation discussion from goal work"
```

---

### Task 4: Show annotation references under the discussed message

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/AnnotationMessageRefs.tsx`
- Test: `packages/desktop/src/renderer/mafw/annotation-message-part.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Test: `packages/desktop/src/renderer/mafw/annotation-message-ref-wiring.test.ts`

**Interfaces:**
- Consumes: `parseAnnotationRefPart`, `annotationsByIDs`, `hydrateAnnotationsByIDs`.
- Produces `AnnotationMessageRefs(props: { ids: readonly string[]; onProcess: (items: Annotation[]) => void })`.
- ChatPane prop adds `onProcessAnnotations?: (items: Annotation[]) => void`.

- [ ] **Step 1: Write the failing parser/ref test**

```ts
test('ref part round-trips ids and ignores unrelated synthetic parts', () => {
  const part = annotationRefPart(['ann-1', 'ann-2']);
  assert.deepEqual(parseAnnotationRefPart(part), ['ann-1', 'ann-2']);
  assert.deepEqual(parseAnnotationRefPart({ type: 'text', text: 'hello', synthetic: true }), []);
});

test('discussed annotation remains available after hydration by id', async () => {
  fakeFindByIds.mockResolvedValue([{ ...annotation, discussedAt: 10 }]);
  await hydrateAnnotationsByIDs(['ann-1']);
  assert.equal(annotationsByIDs(['ann-1'])[0].id, 'ann-1');
});
```

Wiring test asserts ChatPane scans only synthetic parts whose text uses the annotation prefix, hydrates missing IDs, and renders one `AnnotationMessageRefs` per user turn.

- [ ] **Step 2: Run test to verify it fails**

Run from `packages/desktop`:

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/annotation-message-part.test.ts src/renderer/mafw/annotation-message-ref-wiring.test.ts
```

Expected: FAIL because the component and wiring do not exist.

- [ ] **Step 3: Implement message projection**

For each user message, collect IDs from its synthetic annotation-ref parts. Hydrate missing records once, then render a compact row: `批注 N 条 · 已讨论` with a v2 button `处理这些批注`. The button passes the actual annotations, excluding any already delegated. Do not treat the ref part as review status or create any Goal automatically.

- [ ] **Step 4: Run tests to verify they pass**

Run the same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/AnnotationMessageRefs.tsx packages/desktop/src/renderer/mafw/annotation-message-part.test.ts packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/annotation-message-ref-wiring.test.ts
git commit -m "feat(desktop): expose discussed annotation references"
```

---

### Task 5: Add explicit discussion destinations and the shared action dialog

**Files:**
- Create: `packages/desktop/src/renderer/mafw/annotation-discussion.ts`
- Test: `packages/desktop/src/renderer/mafw/annotation-discussion.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/AnnotationActionDialog.tsx`
- Test: `packages/desktop/src/renderer/mafw/annotation-action-wiring.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/CommentsPill.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/EditorDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`

**Interfaces:**
- Produces:
  ```ts
  export type DiscussionTarget =
    | { kind: 'lead'; podId: string }
    | { kind: 'free'; sessionID: string }
    | { kind: 'techlead'; podId: string; goalId: string };

  export function chatAcceptsAnnotation(annotation: Annotation, chat: {
    kind: 'free' | 'lead' | 'techlead';
    goalId?: string | null;
  }): boolean;

  export async function deliverAnnotationDiscussion(input: {
    annotations: readonly Annotation[];
    target: DiscussionTarget;
  }, deps: {
    ensureLead(podId: string): Promise<{ sessionId: string }>;
    ensureTechLead(goalId: string): Promise<{ sessionID: string; revision: number }>;
    sendChat(input: { sessionID: string; message: string; parts: unknown[] }): Promise<unknown>;
    sendTechLead(input: { podId: string; goalId: string; text: string; parts: unknown[] }): Promise<unknown>;
    markDiscussed(ids: readonly string[], at: number): void;
  }): Promise<{ sessionID: string }>;
  ```
- `AnnotationActionDialog` begins with a `讨论 / Goal` two-tab shell. This task implements **讨论** only; Task 6 fills Goal.
- Dialog props:
  ```ts
  {
    annotations: Annotation[];
    goals: PodGoal[];
    currentSessionID: string | null;
    currentChatGoalId: string | null;
    busy: boolean;
    onDiscuss(target: DiscussionTarget): Promise<void>;
    onClose(): void;
  }
  ```

- [ ] **Step 1: Write failing routing/delivery tests**

```ts
test('discussion sends one message and never marks before success', async () => {
  const deps = fakeDiscussionDeps();
  await deliverAnnotationDiscussion({ annotations: [projectAnnotation, goalBAnnotation], target: { kind: 'lead', podId: 'pod_1' } }, deps);
  assert.equal(deps.sendChat.calls.length, 1);
  assert.match(deps.sendChat.calls[0].message, /Goal B|src\/b\.ts/);
  assert.deepEqual(deps.markDiscussed.ids, ['ann-1', 'ann-2']);
  assert.equal(deps.sendTechLead.calls.length, 0);
});

test('failed Lead delivery leaves drafts sendable and does not create review items', async () => {
  deps.sendChat.reject(new Error('offline'));
  await assert.rejects(() => deliverAnnotationDiscussion({ annotations: [projectAnnotation], target: { kind: 'lead', podId: 'pod_1' } }, deps));
  assert.equal(deps.markDiscussed.calls.length, 0);
});

test('Goal B annotation is not accepted by Goal A Tech Lead composer', () => {
  assert.equal(chatAcceptsAnnotation(goalBAnnotation, { kind: 'techlead', goalId: 'g1' }), false);
  assert.equal(chatAcceptsAnnotation(goalBAnnotation, { kind: 'techlead', goalId: 'g2' }), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `packages/desktop`:

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/annotation-discussion.test.ts src/renderer/mafw/annotation-action-wiring.test.ts
```

Expected: FAIL because discussion delivery and the dialog do not exist.

- [ ] **Step 3: Implement discussion delivery and entry points**

`deliverAnnotationDiscussion` builds one annotation batch plus a synthetic annotation-ref part, resolves Lead / free / Tech Lead session through injected adapters, sends exactly once, then marks the source IDs discussed. Any failure propagates without marking or creating work. A Tech Lead delivery must use `pod.sendTechLeadMessage`, not `promptAsync`.

MafwShell owns the action request signal. Open it from: CommentsPill `讨论 / 处理` actions, EditorDock annotation rail, and AnnotationMessageRefs. Build recipient choices as explicit rows: project Lead (ensure), current free/Lead session when compatible, source Goal’s Tech Lead when the source is a mutable Goal revision, and “新建自由讨论” when no compatible session. “新建自由讨论” creates a session with the existing no-reveal path, then calls the free-target delivery with that session ID. Do not silently focus a different chat after sending. Use v2 buttons and token styles.

- [ ] **Step 4: Run tests to verify they pass**

Run same command; expected PASS. Add wiring assertions that all three entry points call the same shell action and never call `createReviewItems` from the discussion path.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/annotation-discussion.ts packages/desktop/src/renderer/mafw/annotation-discussion.test.ts packages/desktop/src/renderer/mafw/components/AnnotationActionDialog.tsx packages/desktop/src/renderer/mafw/annotation-action-wiring.test.ts packages/desktop/src/renderer/mafw/components/CommentsPill.tsx packages/desktop/src/renderer/mafw/components/EditorDock.tsx packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): route annotation discussions explicitly"
```

---

### Task 6: Delegate one annotation batch to one Goal

**Files:**
- Create: `packages/desktop/src/renderer/mafw/annotation-delegation.ts`
- Test: `packages/desktop/src/renderer/mafw/annotation-delegation.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/review-item-input.ts`
- Modify: `packages/desktop/src/renderer/mafw/review-item-input.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/AnnotationActionDialog.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/PodGoalComposer.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/desktop/src/renderer/mafw/annotation-delegation-wiring.test.ts`

**Interfaces:**
- Consumes Plan A: `PodReviewItemInput.source`, `.clientRef`, `createReviewItems({revision,...})`.
- Produces:
  ```ts
  export type DelegationFollowUp =
    | { kind: 'notify' }
    | { kind: 'replan'; goalId: string }
    | { kind: 'record-only' }
    | { kind: 'rework'; goalId: string }
    | { kind: 'blocked'; reason: string };

  export function delegationFollowUp(goal: Pick<PodGoal, 'status' | 'stage' | 'resultReady' | 'accepted'>): DelegationFollowUp;
  export function validateDelegationTarget(input: {
    annotations: readonly Annotation[];
    projectDir: string;
    target: { goalId: string; revision?: number; accepted?: boolean; ended?: boolean };
  }): string | null;
  export function eligibleDelegationGoals(goals: readonly PodGoal[], annotations: readonly Annotation[]): PodGoal[];
  export function buildNewGoalDraft(annotations: readonly Annotation[]): {
    title: string; objective: string; acceptance: string[];
  };
  export function reviewInputsForDelegation(annotations: readonly Annotation[]): PodReviewItemInput[];
  export function targetVersionProblem(input: {
    sourceHash: string | null;
    targetHash: string | null;
    textAnchorAvailable: boolean;
  }): string | null;

  export interface DelegationResult {
    goalId: string | null;
    revision: number | null;
    items: PodReviewItem[];
    followUp: DelegationFollowUp | null;
    error: string | null;
  }

  export async function delegateAnnotationBatch(input: {
    annotations: readonly Annotation[];
    projectDir: string;
    target: { podId: string; goalId?: string; revision?: number; newGoal?: boolean };
    goal?: PodGoal | null;
  }, deps: {
    createGoal(input: { title: string; objective: string; acceptance: string[] }): Promise<{ goalId: string; revision: number }>;
    createReviewItems(target: { podId: string; goalId: string; revision: number }, body: {
      revision: number; items: PodReviewItemInput[];
    }): Promise<{ items: PodReviewItem[] }>;
    getPlan(goalId: string): Promise<{ planApproval?: { id?: string } }>;
    rejectPlan(goalId: string, approvalId: string | undefined, feedback: string): Promise<unknown>;
    sendTechLead(input: { podId: string; goalId: string; text: string }): Promise<unknown>;
    rejectResult(podId: string, goalId: string, feedback: string): Promise<{ revision?: number }>;
    markDelegated(ids: readonly string[], reviewItemIDs: readonly string[]): void;
  }): Promise<DelegationResult>;
  ```

  Post-Goal failures return the created `goalId/revision` with `error` instead of throwing. A retry MUST reuse that target Goal, never call `createGoal` again.

- [ ] **Step 1: Write failing planner/executor tests**

```ts
test('follow-up mapping is stable-by-stage', () => {
  assert.deepEqual(delegationFollowUp(goal({ stage: 'discussing' })), { kind: 'notify' });
  assert.deepEqual(delegationFollowUp(goal({ stage: 'plan_approval' })), { kind: 'replan', goalId: 'g1' });
  assert.deepEqual(delegationFollowUp(goal({ stage: 'implementing' })), { kind: 'record-only' });
  assert.deepEqual(delegationFollowUp(goal({ stage: 'result_notified', resultReady: true })), { kind: 'rework', goalId: 'g1' });
  assert.equal(delegationFollowUp(goal({ stage: 'ended' })).kind, 'blocked');
});

test('one batch creates items once with source and clientRef', async () => {
  const out = await delegateAnnotationBatch(input, deps);
  assert.deepEqual(deps.createReviewItems.calls[0].body.items.map(i => i.clientRef), ['ann-1', 'ann-2']);
  assert.deepEqual(deps.createReviewItems.calls[0].body.items[0].source, { kind: 'project', projectDir: 'C:/repo' });
  assert.equal(deps.markDelegated.reviewItemIDs.length, 2);
});

test('goal-source batch cannot target another or terminal goal', () => {
  assert.match(validateDelegationTarget({ annotations: [goalB], projectDir: 'C:/repo', target: { goalId: 'g1' } }) ?? '', /Goal/);
  assert.match(validateDelegationTarget({ annotations: [projectAnnotation], projectDir: 'C:/repo', target: { goalId: 'g1', accepted: true } }) ?? '', /验收/);
  assert.match(validateDelegationTarget({ annotations: [oldGoalB], projectDir: 'C:/repo', target: { goalId: 'g2', revision: 2 } }) ?? '', /revision/);
});

test('dirty source and mismatched binary target are blocked', () => {
  assert.match(annotationSourceProblem({ ...annotation, capturedDirty: true }) ?? '', /保存/);
  assert.match(targetVersionProblem({ sourceHash: 'a', targetHash: 'b', textAnchorAvailable: false }) ?? '', /版本/);
  assert.equal(targetVersionProblem({ sourceHash: 'a', targetHash: 'a', textAnchorAvailable: false }), null);
});
```

Add executor tests for: result rework calls `rejectResult` once; plan approval creates items before `rejectPlan`; a target object captured before a delayed `createReviewItems` is used unchanged even if callers mutate the dialog/current tab; follow-up failure still marks the item IDs delegated and returns the existing `goalId`, so retry cannot create a second Goal or semantic batch; a new-Goal item-creation failure returns `goalId` with `goalId !== null`, and retry passes that id with `newGoal:false`.

- [ ] **Step 2: Run tests to verify they fail**

Run from `packages/desktop`:

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/annotation-delegation.test.ts src/renderer/mafw/review-item-input.test.ts
```

Expected: FAIL because delegation and source/clientRef mapping do not exist.

- [ ] **Step 3: Implement planning and execution**

Extend `reviewInputsFromAnnotations` to keep `source` and set `clientRef = annotation.id`. Implement follow-up mapping exactly as tested. New Goal flow creates a `discussing` Goal before writing items; existing Goal flow validates same project, mutable active revision, and Goal-source ownership. Item creation is one batch. Follow-up order: items → notify/replan/rework; `record-only` stops after creation.

At UI entry, MafwShell verifies source files are saved, `capturedDirty` is false, and the target revision worktree exists (use `pod.result(...).worktree.dir`). Compare source and target with `fs.version`: equal hashes pass directly; different text files pass only when `anchorOccursIn(targetContent, annotation)` finds the unchanged quote/code; different binary files or a missing anchor block the write. If verification fails, keep all drafts and show a concrete message. Do not copy uncommitted content.

Extend `PodGoalComposer` with optional `initialTitle`, `initialObjective`, `initialAcceptance`, and `heading`; prefill from `buildNewGoalDraft`. The Goal tab lists only `eligibleDelegationGoals` and a “新建 Goal” path; source Goal B offers only Goal B. Once a Goal has been created, keep its returned id in the dialog. A failed item write or follow-up returns `error` with that id and shows “评审项已记录，后续动作失败”; retry targets the existing Goal and reuses `clientRef`s rather than creating a second Goal.

- [ ] **Step 4: Run tests to verify they pass**

Run the same command and the new wiring test; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/annotation-delegation.ts packages/desktop/src/renderer/mafw/annotation-delegation.test.ts packages/desktop/src/renderer/mafw/review-item-input.ts packages/desktop/src/renderer/mafw/review-item-input.test.ts packages/desktop/src/renderer/mafw/components/AnnotationActionDialog.tsx packages/desktop/src/renderer/mafw/components/PodGoalComposer.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/annotation-delegation-wiring.test.ts
git commit -m "feat(desktop): delegate annotation batches to goals"
```

---

### Task 7: Enable review drafts on Goal revision diffs

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ChangeSetView.tsx:18-23, 238-270`
- Modify: `packages/desktop/src/renderer/mafw/components/DocumentStage.tsx:12-86`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx:100-135`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:4646-4660, 4720-4740`
- Modify: `packages/desktop/src/renderer/mafw/annotation-scope.ts`
- Test: `packages/desktop/tests/diff-tab-wiring.test.ts`
- Test: `packages/desktop/src/renderer/mafw/annotation-scope.test.ts`

**Interfaces:**
- `ChangeSetViewProps.onAddAnnotation` accepts the full `Annotation` creation payload, including `scopeKey`, `root`, `source`.
- For `doc.source.kind === 'goal'`, `ChangeSetView` renders `DiffReviewPanel` with `previewOnly={false}`, `sessionID=""`, and an annotation callback that derives:
  ```ts
  source = { kind: 'goal', projectDir, goalId: doc.source.goalId, revision: doc.source.revision }
  scopeKey = `goal:${normalizePath(projectDir)}:${goalId}:r${revision}`
  root = doc.root
  ```

- [ ] **Step 1: Write the failing Goal-diff test**

```ts
test('goal change sets accept annotation drafts and never call promptAsync', async () => {
  // render/open a goal ChangeSetDocument with root and revision
  assert.equal(panel.previewOnly, false);
  assert.equal(commentedPayload.source.kind, 'goal');
  assert.equal(commentedPayload.scopeKey, 'goal:C:/repo:g1:r2');
  assert.equal(directPromptCalls.length, 0);
});
```

Add a pure scope test that the same `rel` in project root and goal worktree produces different draft visibility.

- [ ] **Step 2: Run test to verify it fails**

Run from `packages/desktop`:

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/diff-tab-wiring.test.ts src/renderer/mafw/annotation-scope.test.ts
```

Expected: FAIL because Goal diffs are `previewOnly` and carry no source.

- [ ] **Step 3: Implement the Goal diff capture path**

Pass source/root through DocumentStage and WorkbenchShell. Enable comments only for Goal source documents and pass `onSendComment={undefined}` plus `onAddAnnotation`; project/session diff behavior stays unchanged. Composed annotations flow into the normal local draft store and later the same discussion/delegation dialog. Do not call `sessions.promptAsync` from the Goal branch, and do not clear the draft before a successful persistence action.

- [ ] **Step 4: Run tests to verify they pass**

Run the same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/ChangeSetView.tsx packages/desktop/src/renderer/mafw/components/DocumentStage.tsx packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/annotation-scope.ts packages/desktop/tests/diff-tab-wiring.test.ts packages/desktop/src/renderer/mafw/annotation-scope.test.ts
git commit -m "feat(desktop): collect review drafts on goal diffs"
```

---

### Task 8: Documentation and full desktop gates

**Files:**
- Modify: `docs/architecture/desktop.md`
- Modify: `docs/architecture/pod.md` only if Plan A left an integration note incomplete.
- No product code unless a gate exposes a defect.

- [ ] **Step 1: Document the shipped state**

Update the desktop annotation section to describe: local drafts are scope-aware; composer sends are discussion-only; `Lead / free / Tech Lead` recipients are explicit; Goal delegation is a separate batch action; no-session drafts live under `draft:<scopeKey>`; discussion messages carry a hidden annotation-reference part; Goal diff comments create drafts rather than prompts. Keep one paragraph pointing to the approved spec.

- [ ] **Step 2: Run all annotation-focused tests**

Run from `packages/desktop`:

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/annotation-scope.test.ts src/renderer/mafw/annotation-store.test.ts src/renderer/mafw/annotation-source.test.ts src/renderer/mafw/annotation-message-part.test.ts src/renderer/mafw/annotation-message-ref-wiring.test.ts src/renderer/mafw/annotation-discussion.test.ts src/renderer/mafw/annotation-action-wiring.test.ts src/renderer/mafw/annotation-delegation.test.ts src/renderer/mafw/annotation-delegation-wiring.test.ts src/renderer/mafw/review-item-input.test.ts src/renderer/mafw/chat/use-send-message.test.ts tests/diff-tab-wiring.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run typecheck and desktop full suite**

Run from `packages/desktop`:

```bash
npx tsgo --noEmit -p tsconfig.json
npm test
npx electron-vite build
```

Expected: typecheck rc=0, full desktop suite passes, build rc=0.

- [ ] **Step 4: Run relevant SDK/gateway contract checks**

Run from repo root:

```bash
npm test -w @mafw/sdk
```

Expected: passes. Confirm Plan A generated contracts are present and no unrelated generated churn is included.

- [ ] **Step 5: Report and commit docs/gate fixes**

Record new test count, full desktop pass count, typecheck, build, SDK result, and any known deferred items. Commit the documentation and any gate fixes as a separate commit; never include unrelated adapter/gateway/mobile work already dirty in the checkout.
