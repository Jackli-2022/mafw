# Project Pod Lite — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-scoped 3-person Pod backend (roster, task board, mailbox, memory, goal queue, goal-node binding) without changing the existing goal state machine.

**Architecture:** New `gateway/src/core/pod/*` modules own a `PodStore` (SQLite, same GatewayDatabase handle), a `PodService` (identity/roster/lifecycle), a `PodTaskService` (wave projection + receipt sync), a `PodMessageService`, a `PodMemoryService`, and a `PodGoalService` (one active goal + queue). `NodeDriver` gets one optional `podContext` hook; `index.ts` wires session binding, transcript snapshots, archive capture, and queue promotion. REST routes are registry-attached; SDK/preload expose the same surface. One new canonical event, `pod.updated`, drives future UI refresh.

**Tech Stack:** TypeScript, Node 22, better-sqlite3, Jest + ts-jest, existing `RouteRegistry`/OpenAPI contract pipeline, existing `MafwClient`/preload pattern.

**Spec:** `docs/superpowers/specs/2026-10-29-project-pod-lite-design.md`

**Scope:** This plan is **Phase 1 backend only**. The desktop “鲸群” panel is a separate follow-up plan. No goal state-machine rewrite, no Curator, no Task Force, no multi-Pod.

## Global Constraints

- One Pod per registered project; 3 members: `lead`, `builder`, `reviewer`.
- Pod key = canonical project root (`fs.realpathSync`); worktrees map to the parent project; project move/rename does not auto-migrate.
- Reviewer is the existing goal `review` node; no new pre-review gate.
- Node sessions remain owned/deleted by `NodeDriver`; Pod snapshots the transcript before deletion.
- One active goal per Pod; queued goals are created but not started.
- Pod memory is project-scoped under `~/.mafw/pods/<podId>/memory/`; 2–4 KB deterministic context injection; no global harmonic-memory writes from Pod members.
- Only new canonical event: `pod.updated` (payload `{podId, kind}`); no other new event types.
- No agent self-approval for merge/delete/publish/permission changes.
- Never hardcode absolute paths; use `path.join` and the injected `memoryRoot`.

## Review Focus

- **Project/worktree keying:** same project must reuse the same Pod; a worktree must map to its parent Pod. Tests: Task 2 (`pod-identity.test.ts`).
- **Queue bypass:** every `goal_created`/validate path must go through `PodGoalService.enqueueGoal`; a second goal must not start. Tests: Task 5 + Task 7 wiring contract.
- **Session deletion:** transcript snapshot happens before `NodeDriver` deletes a session; no stale `working` member. Tests: Task 2 + Task 7.
- **Reviewer FAIL mapping:** review FAIL must reuse the existing review→next-round flow, and only mark Pod tasks `reopened`. Tests: Task 3 + Task 7.
- **Permissions/cost:** non-member Pod mutations are rejected; Manager ordinary chat is not counted in Pod cost. Tests: Task 11.

---

## Task 1: PodStore schema and CRUD

**Files:**
- Create: `gateway/src/core/pod/pod-store.ts`
- Test: `gateway/tests/unit/pod/pod-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PodStatus = 'active' | 'idle' | 'paused' | 'archived';
  export type PodMemberRole = 'lead' | 'builder' | 'reviewer' | 'curator';
  export type PodMemberStatus = 'available' | 'working' | 'waiting' | 'sleeping' | 'retired';
  export type PodGoalStatus = 'queued' | 'active' | 'done' | 'aborted';
  export type PodTaskStatus = 'pending' | 'in_progress' | 'blocked' | 'review' | 'done' | 'failed' | 'reopened';
  export interface PodRow { id: string; projectDir: string; name: string; status: PodStatus; configJson: string; activeGoalId: string | null; createdAt: string; updatedAt: string; }
  export interface PodMemberRow { id: string; podId: string; role: PodMemberRole; displayName: string; agentName: string; modelProvider: string | null; modelId: string | null; status: PodMemberStatus; configJson: string | null; createdAt: string; updatedAt: string; }
  export interface PodGoalRow { id: string; podId: string; goalId: string; status: PodGoalStatus; enqueuedAt: string; startedAt: string | null; endedAt: string | null; }
  export interface PodTaskRow { id: string; podId: string; goalId: string | null; sourceKey: string; externalTaskId: string | null; title: string; description: string | null; ownerMemberId: string | null; status: PodTaskStatus; dependenciesJson: string | null; artifactRefsJson: string | null; createdAt: string; updatedAt: string; }
  export interface PodMessageRow { id: string; podId: string; fromMemberId: string; toMemberId: string | null; kind: string; body: string; createdAt: string; readAt: string | null; }
  export interface PodSessionRow { id: string; podId: string; memberId: string; goalId: string | null; node: string | null; sessionId: string; status: string; transcriptRef: string | null; createdAt: string; endedAt: string | null; }
  export class PodError extends Error { constructor(public status: number, message: string); }
  export class PodStore {
    constructor(db: Database.Database);
    ensurePod(input: { id: string; projectDir: string; name: string; configJson?: string; now: string }): PodRow;
    getPod(id: string): PodRow | null;
    getPodByProject(projectDir: string): PodRow | null;
    findPodIdByGoal(goalId: string): string | null;
    listPods(): PodRow[];
    updatePod(id: string, patch: Partial<Pick<PodRow, 'name' | 'status' | 'configJson' | 'activeGoalId'>>, now: string): void;
    upsertMember(input: Omit<PodMemberRow, 'createdAt' | 'updatedAt'> & { now: string }): PodMemberRow;
    listMembers(podId: string): PodMemberRow[];
    getMemberByRole(podId: string, role: PodMemberRole): PodMemberRow | null;
    getMemberBySession(sessionId: string): PodMemberRow | null;
    enqueueGoal(input: { id: string; podId: string; goalId: string; now: string }): PodGoalRow;
    getGoal(podId: string, goalId: string): PodGoalRow | null;
    getGoalByGoalId(goalId: string): PodGoalRow | null;
    getActiveGoal(podId: string): PodGoalRow | null;
    listGoals(podId: string): PodGoalRow[];
    setGoalStatus(id: string, status: PodGoalStatus, patch: { startedAt?: string; endedAt?: string }): void;
    upsertTask(input: Omit<PodTaskRow, 'createdAt' | 'updatedAt'> & { now: string }): PodTaskRow;
    getTask(id: string): PodTaskRow | null;
    getTaskBySourceKey(podId: string, sourceKey: string): PodTaskRow | null;
    listTasks(podId: string, goalId?: string): PodTaskRow[];
    updateTask(id: string, patch: Partial<Pick<PodTaskRow, 'title' | 'description' | 'ownerMemberId' | 'status' | 'artifactRefsJson' | 'dependenciesJson'>>, now: string): void;
    insertMessage(input: Omit<PodMessageRow, 'createdAt' | 'readAt'> & { now: string }): PodMessageRow;
    listMessages(podId: string, limit?: number): PodMessageRow[];
    markMessageRead(id: string, now: string): void;
    insertSession(input: Omit<PodSessionRow, 'createdAt' | 'endedAt'> & { now: string }): PodSessionRow;
    listSessions(podId: string): PodSessionRow[];
    listActiveSessions(podId: string): PodSessionRow[];
    endSession(sessionId: string, now: string): void;
    insertSnapshot(input: { id: string; podId: string; memberId: string; goalId: string | null; node: string | null; sessionId: string; path: string; now: string }): void;
    getSnapshot(sessionId: string): { path: string } | null;
    listSessionIds(podId: string, sinceEpoch: number): string[];
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `pod-store.test.ts` with temp DB + `new PodStore(db)`:
- `ensurePod` twice with same `projectDir` returns the same `id`; a different project gets a different id.
- `findPodIdByGoal('g1')` returns the pod after `enqueueGoal`; `getGoalByGoalId('g1')` returns the row.
- `upsertMember` + `listMembers` returns 3 rows in role order.
- `enqueueGoal` twice for same `(podId, goalId)` is idempotent; `getActiveGoal` returns only `status='active'`.
- `upsertTask` twice with same `(podId, sourceKey)` updates the row and keeps one row.
- `insertMessage` + `listMessages` returns newest first; `markMessageRead` sets `readAt`.
- `insertSession` + `insertSnapshot` + `endSession` round-trips; `listSessions` includes ended rows, `listActiveSessions` excludes them.
- `listSessionIds` returns distinct session ids.

- [ ] **Step 2: Run test to verify it fails**

Run:
```text
cd gateway
npx jest tests/unit/pod/pod-store.test.ts --runInBand
```
Expected: FAIL with `Cannot find module .../pod-store` / missing methods.

- [ ] **Step 3: Implement `PodStore`**

Follow `gateway/src/events/event-store.ts` (raw `Database` handle, constructor `db.exec`). Add `CREATE TABLE IF NOT EXISTS` + indexes for:
`project_pods`, `pod_members`, `pod_goals`, `pod_tasks`, `pod_messages`, `pod_member_sessions`, `pod_session_snapshots`.
Use `ON CONFLICT` for `ensurePod`, `enqueueGoal`, `upsertTask`; use `UNIQUE(project_dir)`, `UNIQUE(pod_id, goal_id)`, `UNIQUE(pod_id, source_key)`, `UNIQUE(session_id)`.

- [ ] **Step 4: Run test to verify it passes**

Run:
```text
cd gateway
npx jest tests/unit/pod/pod-store.test.ts --runInBand
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add gateway/src/core/pod/pod-store.ts gateway/tests/unit/pod/pod-store.test.ts
git commit -m "feat(pod): add pod store schema and crud"
```

---

## Task 2: Pod identity, ensure/roster, session binding, transcript snapshot

**Files:**
- Create: `gateway/src/core/pod/pod-identity.ts`
- Create: `gateway/src/core/pod/pod-service.ts`
- Test: `gateway/tests/unit/pod/pod-identity.test.ts`
- Test: `gateway/tests/unit/pod/pod-service.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function canonicalProjectDir(projectDir: string): string;
  export function podIdForProject(projectDir: string): string; // pod_<sha1(canonical lowercase)[:12]>
  export function parentProjectDirForWorktree(worktreeDir: string): string | null;
  export function roleForNode(node: 'plan' | 'execute' | 'review'): PodMemberRole;
  export interface PodDetail { pod: PodRow; members: PodMemberRow[]; goals: PodGoalRow[]; tasks: PodTaskRow[]; sessions: PodSessionRow[]; }
  export interface PodServiceDeps {
    store: PodStore;
    now(): string;
    newId(): string;
    broadcast(event: { type: string; properties?: Record<string, unknown>; sessionID?: string }): void;
    getManagerSession(projectDir: string): Promise<string>;
    getSession(sessionID: string): Promise<{ time?: { idle?: number; completed?: number }; parentID?: string }>;
    messages(sessionID: string, limit: number): Promise<unknown[]>;
    memoryRoot: string;
    listRegisteredProjectDirs(): string[];
    ensureMemory?(podId: string, projectName: string): void;
    log?(message: string): void;
  }
  export class PodService {
    constructor(deps: PodServiceDeps);
    async ensure(projectDir: string): Promise<PodDetail>;
    get(podId: string): PodDetail | null;
    getPodIdForGoal(goalId: string): string | null;
    updateStatus(podId: string, status: PodStatus): PodDetail;
    async bindLead(podId: string, managerSessionId: string): Promise<void>;
    bindSession(goalId: string, node: 'plan' | 'execute' | 'review', sessionId: string): PodSessionRow | null;
    async snapshotSession(sessionId: string): Promise<string | null>;
    async reconcile(): Promise<void>;
    memberForSession(sessionId: string): PodMemberRow | null;
  }
  ```

- [ ] **Step 1: Write failing identity test**

`pod-identity.test.ts`:
- `canonicalProjectDir` returns the realpath for a temp directory.
- `podIdForProject` is stable across casing/slashes on Windows and differs for different dirs.
- `parentProjectDirForWorktree('/repo/foo-wt-feature')` → `'/repo/foo'`; non-worktree → `null`.
- `roleForNode('plan') === 'lead'`, `'execute' === 'builder'`, `'review' === 'reviewer'`.

- [ ] **Step 2: Write failing service test**

`pod-service.test.ts` with fake store/session deps:
- `ensure('/tmp/proj')` twice returns one pod + 3 members in `lead,builder,reviewer` order; lead `agentName='manager'`, builder `mafw-execute`, reviewer `mafw-review`; manager coordination session is not duplicated.
- `ensure` calls `getManagerSession` once; `bindLead` creates a `coordination` session row for the manager.
- `bindSession('g1','execute','ses_b')` finds the pod by goal and inserts a session with member role `builder`; member status becomes `working`.
- `getPodIdForGoal('g1')` returns the same pod id; unknown goal → `null`.
- `snapshotSession('ses_b')` writes `<memoryRoot>/<podId>/sessions/ses_b.json` containing the messages, inserts `pod_session_snapshots`, ends the session, and member status returns `available`.
- `reconcile()` ends an active session whose `getSession` throws and logs; it does not throw.

- [ ] **Step 3: Run tests to verify they fail**

```text
cd gateway
npx jest tests/unit/pod/pod-identity.test.ts tests/unit/pod/pod-service.test.ts --runInBand
```
Expected: FAIL (missing modules).

- [ ] **Step 4: Implement identity + service**

`ensure`:
1. Resolve parent project dir: if `listRegisteredProjectDirs()` contains the canonical dir, use it; else `parentProjectDirForWorktree` if the parent is registered.
2. `podIdForProject`, `store.ensurePod`, create members if absent.
3. `getManagerSession(projectDir)` and `bindLead`.
4. `deps.ensureMemory?.(pod.id, pod.name)`.
5. Return `get(podId)`.

`bindSession`: `const podId = store.findPodIdByGoal(goalId); if (!podId) return null;`; map node→role; insert session; set member `working`.

`snapshotSession`: find `store.getMemberBySession` / active session row; `deps.messages(sessionId, 200)`; `fs.mkdirSync(path.join(memoryRoot,podId,'sessions'), {recursive:true})`; write `JSON.stringify({sessionID, messages}, null, 2)`; insert snapshot; `endSession`; set member `available`; emit `pod.updated` kind `member`.

- [ ] **Step 5: Run tests to verify they pass**

```text
cd gateway
npx jest tests/unit/pod/pod-identity.test.ts tests/unit/pod/pod-service.test.ts --runInBand
```
Expected: PASS.

- [ ] **Step 6: Commit**

```text
git add gateway/src/core/pod/pod-identity.ts gateway/src/core/pod/pod-service.ts gateway/tests/unit/pod/pod-identity.test.ts gateway/tests/unit/pod/pod-service.test.ts
git commit -m "feat(pod): add project pod identity and lifecycle"
```

---

## Task 3: Task board projection and receipt sync

**Files:**
- Create: `gateway/src/core/pod/pod-task-service.ts`
- Test: `gateway/tests/unit/pod/pod-task-service.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface WavePlan { waves: Array<{ id: string; title?: string; tasks: string[] }>; }
  export interface GoalReceipt { receipts: Array<{ taskId: string; status: 'done' | 'failed' | 'skipped'; summary?: string; files?: string[] }>; }
  export class PodTaskService {
    constructor(deps: { store: PodStore; now(): string; newId(): string; notify(podId: string): void });
    projectWaves(podId: string, goalId: string, plan: WavePlan): PodTaskRow[];
    applyReceipt(podId: string, goalId: string, receipt: GoalReceipt): PodTaskRow[];
    createManual(podId: string, goalId: string | null, title: string, ownerMemberId?: string): PodTaskRow;
    updateTask(podId: string, taskId: string, patch: { status?: PodTaskStatus; ownerMemberId?: string }): PodTaskRow;
    reopenForReview(podId: string, goalId: string): PodTaskRow[];
    reconcileArchive(podId: string, goalId: string, ok: boolean): void;
    list(podId: string, goalId?: string): PodTaskRow[];
  }
  ```

- [ ] **Step 1: Write failing test**

Use `plan = { waves: [{id:'w1', tasks:['do a','do b']}, {id:'w2', tasks:['do c']}] }`.
- `projectWaves` creates 3 tasks with `sourceKey` `wave:w1:task:0`, `wave:w1:task:1`, `wave:w2:task:0`; `externalTaskId` `w1-t1`, `w1-t2`, `w2-t1`.
- Calling twice updates titles but keeps one row per `sourceKey` and preserves status.
- `applyReceipt({receipts:[{taskId:'w1-t1',status:'done'}]})` sets that task `done`; unknown `w9-t1` is ignored.
- `createManual` uses `sourceKey='manual:<uuid>'` and is not matched by receipts.
- `updateTask` rejects illegal transitions (`done` → `pending`).
- `reopenForReview(podId,'g1')` sets `in_progress`/`done` tasks to `reopened`.
- `reconcileArchive(..., false)` marks open tasks `failed`; `true` leaves them.

- [ ] **Step 2: Run test to verify it fails**

```text
cd gateway
npx jest tests/unit/pod/pod-task-service.test.ts --runInBand
```
Expected: FAIL.

- [ ] **Step 3: Implement `PodTaskService`**

- Projection: `externalTaskId = `${wave.id}-t${index + 1}``; `sourceKey = `wave:${wave.id}:task:${index}``.
- `projectWaves` uses `store.upsertTask`; if a task exists, only update `title`/`goalId`, never reset status.
- `applyReceipt` matches `externalTaskId`; map `done|failed|skipped` to `done|failed|failed`; append files to `artifactRefsJson`.
- `updateTask` allowed transitions: `pending→in_progress|blocked|reopened`, `in_progress→review|blocked|done|failed|reopened`, `blocked→in_progress|failed`, `review→done|reopened`, `reopened→in_progress|failed`, `done/failed` terminal.
- `notify(podId)` on every successful mutation.

- [ ] **Step 4: Run test to verify it passes**

```text
cd gateway
npx jest tests/unit/pod/pod-task-service.test.ts --runInBand
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add gateway/src/core/pod/pod-task-service.ts gateway/tests/unit/pod/pod-task-service.test.ts
git commit -m "feat(pod): project waves into pod task board"
```

---

## Task 4: Mailbox and Pod memory

**Files:**
- Create: `gateway/src/core/pod/pod-message-service.ts`
- Create: `gateway/src/core/pod/pod-memory-service.ts`
- Test: `gateway/tests/unit/pod/pod-message-service.test.ts`
- Test: `gateway/tests/unit/pod/pod-memory-service.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class PodMessageService {
    constructor(deps: { store: PodStore; now(): string; newId(): string; notify(podId: string): void });
    send(input: { podId: string; fromMemberId: string; toMemberId?: string | null; kind: 'note'|'request'|'review'|'decision'|'escalation'; body: string }): PodMessageRow;
    list(podId: string, limit?: number): PodMessageRow[];
    markRead(messageId: string): void;
  }
  export class PodMemoryService {
    constructor(deps: { memoryRoot: string; now(): string });
    memoryDir(podId: string): string;
    ensurePodMemory(podId: string, projectName: string): void;
    renderContext(podId: string, node: 'plan'|'execute'|'review'): string | null;
    captureGoal(podId: string, input: { goalId: string; ok: boolean; reviewFeedback?: string; receiptPath?: string }): string;
  }
  ```

- [ ] **Step 1: Write failing tests**

Message test:
- `send` inserts a row; `toMemberId=null` is broadcast; `list` newest first; `markRead` sets `readAt`; `notify` called once.

Memory test:
- `ensurePodMemory` creates `POD.md`, `POD_MEMORY.md`, `glossary.md` under `<memoryRoot>/<podId>/memory/`; content contains project name.
- `renderContext` returns a string starting `[POD CONTEXT]`, includes `POD.md` and `POD_MEMORY.md` content, and is `<= 4096` chars; missing files → `null` if all missing.
- `captureGoal` writes `decisions/<date>-<goalId>.md` with `ok: true|false` and feedback; returns the path; no global memory call.
- The context block contains the node label (`plan/execute/review`) but not raw file paths.

- [ ] **Step 2: Run tests to verify they fail**

```text
cd gateway
npx jest tests/unit/pod/pod-message-service.test.ts tests/unit/pod/pod-memory-service.test.ts --runInBand
```
Expected: FAIL.

- [ ] **Step 3: Implement services**

Message service is a thin store wrapper; validate non-empty body; `toMemberId` must exist if provided (store lookup); throw `PodError(400)` on invalid.

Memory service:
- `renderContext`: read `POD.md`, `POD_MEMORY.md`, `glossary.md`; join with headings; deterministic truncate to `MAX_CONTEXT_CHARS = 4096`; return `null` when all missing.
- `captureGoal`: ensure dirs; write a small Markdown decision record; no LLM.
- `PodError` class can live in `pod-service.ts` or a new `pod-errors.ts`; export `PodError` with `status`.

- [ ] **Step 4: Run tests to verify they pass**

```text
cd gateway
npx jest tests/unit/pod/pod-message-service.test.ts tests/unit/pod/pod-memory-service.test.ts --runInBand
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add gateway/src/core/pod/pod-message-service.ts gateway/src/core/pod/pod-memory-service.ts gateway/tests/unit/pod/pod-message-service.test.ts gateway/tests/unit/pod/pod-memory-service.test.ts
git commit -m "feat(pod): add pod mailbox and memory"
```

---

## Task 5: One-active-goal queue

**Files:**
- Create: `gateway/src/core/pod/pod-goal-service.ts`
- Test: `gateway/tests/unit/pod/pod-goal-service.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class PodGoalService {
    constructor(deps: {
      store: PodStore;
      pods: PodService;
      startGoal(goalId: string, projectDirHint?: string): Promise<void>;
      resolveProjectDir(goalId: string): string | null;
      now(): string;
      newId(): string;
      notify(podId: string): void;
      budget?: { canStart(podId: string): { ok: boolean; spentUsd: number; limitUsd: number } };
    });
    async enqueueGoal(goalId: string, projectDirHint?: string): Promise<{ status: 'started'|'queued'; podId: string }>;
    async onGoalArchived(goalId: string): Promise<void>;
    list(podId: string): PodGoalRow[];
  }
  ```

- [ ] **Step 1: Write failing test**

Fake store/pods/startGoal:
- First `enqueueGoal('g1','/proj')` creates a queued row, marks it active, calls `startGoal('g1','/proj')`, returns `started`.
- Second `enqueueGoal('g2','/proj')` returns `queued`, does not call `startGoal`.
- `onGoalArchived('g1')` marks g1 `done`, promotes g2 to `active`, calls `startGoal('g2','/proj')`.
- Pod `paused`: `enqueueGoal` returns `queued` and does not start; `onGoalArchived` does not promote.
- `budget.canStart` false: `enqueueGoal` returns `queued` and does not call `startGoal`; true: starts.
- Duplicate `enqueueGoal` for same goal returns existing status and does not double-start.

- [ ] **Step 2: Run test to verify it fails**

```text
cd gateway
npx jest tests/unit/pod/pod-goal-service.test.ts --runInBand
```
Expected: FAIL.

- [ ] **Step 3: Implement `PodGoalService`**

- `enqueueGoal`: `const projectDir = projectDirHint ?? deps.resolveProjectDir(goalId); if (!projectDir) throw new PodError(400,'project not resolved')`; `pods.ensure(projectDir)`; `store.enqueueGoal`; if pod status `paused` or an active goal exists → return `queued`; else set status active + pod.activeGoalId, call `startGoal`, return `started`.
- `onGoalArchived`: `store.getGoalByGoalId(goalId)`; mark done/aborted; clear `activeGoalId`; promote next queued in `enqueuedAt` order.
- Emit `notify(podId)` after state changes.

- [ ] **Step 4: Run test to verify it passes**

```text
cd gateway
npx jest tests/unit/pod/pod-goal-service.test.ts --runInBand
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add gateway/src/core/pod/pod-goal-service.ts gateway/tests/unit/pod/pod-goal-service.test.ts
git commit -m "feat(pod): add one-active-goal queue"
```

---

## Task 6: NodeDriver `podContext` hook

**Files:**
- Modify: `gateway/src/core/goal/driver.ts` (add `podContext` to `DriverDeps`; prepend to `renderNodePrompt` result)
- Test: `gateway/tests/unit/goal-driver-pod.test.ts`

**Interfaces:**
- Consumes: existing `DriverDeps`.
- Produces:
  ```ts
  export interface DriverDeps {
    // ...existing fields
    podContext?: (goalId: string, node: 'plan' | 'execute' | 'review') => string | null;
  }
  ```

- [ ] **Step 1: Write failing test**

Use the existing `goal-driver-harness.ts`. Set `podContext = () => '[POD CONTEXT]\nproject dialect: use pnpm'`. Advance a goal to plan.
- The `promptAsync` call's first text part starts with `[POD CONTEXT]` and still contains the normal plan prompt marker (`waves.json`).
- With `podContext` absent/returning `null`, the prompt is unchanged (starts with the normal plan prompt).

- [ ] **Step 2: Run test to verify it fails**

```text
cd gateway
npx jest tests/unit/goal-driver-pod.test.ts --runInBand
```
Expected: FAIL (unknown dep / no prefix).

- [ ] **Step 3: Implement the hook**

In `executeNode`:
```ts
const podBlock = this.deps.podContext?.(goalId, node) ?? null;
const basePrompt = renderNodePrompt(node, { ... });
const prompt = podBlock ? `${podBlock}\n\n${basePrompt}` : basePrompt;
```
No other behavior changes.

- [ ] **Step 4: Run test to verify it passes**

```text
cd gateway
npx jest tests/unit/goal-driver-pod.test.ts --runInBand
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add gateway/src/core/goal/driver.ts gateway/tests/unit/goal-driver-pod.test.ts
git commit -m "feat(pod): inject pod context into goal nodes"
```

---

## Task 7: Gateway wiring (queue, bind, snapshot, archive, context)

**Files:**
- Modify: `gateway/src/index.ts`
- Create: `gateway/tests/unit/pod/pod-wiring.test.ts` (source-level contract)
- Test: `gateway/tests/unit/pod/pod-wiring.test.ts`

**Interfaces:**
- Consumes: `PodStore`, `PodService`, `PodTaskService`, `PodMessageService`, `PodMemoryService`, `PodGoalService`.
- Produces: gateway fields `podStore`, `podService`, `podTaskService`, `podMessageService`, `podMemoryService`, `podGoalService`; `startGoalDirect` + `startGoal` wrapper.

- [ ] **Step 1: Write failing wiring contract test**

Read `gateway/src/index.ts` and assert:
- contains `new PodStore(` and `new PodService(`.
- `eventBus.on("goal_created"` calls `podGoalService.enqueueGoal`, not `this.startGoal(`.
- validate route calls `podGoalService.enqueueGoal`.
- `onSessionCreated` calls `podService.bindSession`.
- `client.delete` wrapper calls `podService.snapshotSession` before `sdkSession.delete`.
- `archiveGoal` calls `podGoalService.onGoalArchived` and `podMemoryService.captureGoal`.
- driver deps contain `podContext`.
- source contains `startGoalDirect(` and a `startGoal(` wrapper.

- [ ] **Step 2: Run test to verify it fails**

```text
cd gateway
npx jest tests/unit/pod/pod-wiring.test.ts --runInBand
```
Expected: FAIL.

- [ ] **Step 3: Wire in `index.ts`**

- Instantiate after `gatewayDbInstance`/`subagentService`:
  - `PodStore(gatewayDbInstance.getStore())`
  - `PodService({ store, now, newId, broadcast, getManagerSession: (dir) => this.ensureManagerSession(dir, this.mafwDirFor(dir)), getSession: ..., messages: ..., memoryRoot: path.join(os.homedir(), '.mafw', 'pods'), listRegisteredProjectDirs: () => [...this.registeredProjects.keys()], ensureMemory: (podId, name) => this.podMemoryService.ensurePodMemory(podId, name) })`
  - `PodTaskService`, `PodMessageService`, `PodMemoryService`, `PodGoalService` with `startGoal: (id, hint) => this.startGoalDirect(id, hint)`.
- Rename current `startGoal` to `startGoalDirect`; add:
  ```ts
  private async startGoal(goalId: string, projectDirHint?: string): Promise<void> {
    await this.podGoalService.enqueueGoal(goalId, projectDirHint);
  }
  ```
- Update every existing `startGoal(...)` call site to the wrapper; only the `PodGoalService` callback uses `startGoalDirect`.
- `goal_created` event and `/api/work/:goalId/validate` call `this.startGoal` (wrapper).
- In `onSessionCreated` callback: `this.podService?.bindSession(info.goalId, info.phase, info.sessionId)`.
- Wrap `client.delete`:
  ```ts
  delete: async (sid) => {
    await this.podService?.snapshotSession(sid);
    await this.sdkSession.delete(sid);
  }
  ```
- In `archiveGoal` after success/failure: `await this.podGoalService.onGoalArchived(goalId)` and `this.podMemoryService?.captureGoal(...)` (fail-open).
- Driver deps: `podContext: (goalId, node) => { const podId = this.podService?.getPodIdForGoal(goalId); return podId ? this.podMemoryService?.renderContext(podId, node) ?? null : null; }`.
- Hook `goal_node` broadcast: after `this.broadcast(p)`, call a private `onPodGoalNode(p)` that:
  - plan finished → read `state.wavePlanPath` and `podTaskService.projectWaves`.
  - execute finished → read `state.receiptPath` and `podTaskService.applyReceipt`.
  - review finished → read state; if `reviewVerdict==='FAIL'` → `podTaskService.reopenForReview`; if PASS → `podTaskService.reconcileArchive(ok:true)`.
  - Avoid duplicate projection; service methods idempotent.

- [ ] **Step 4: Run wiring test + goal tests**

```text
cd gateway
npx jest tests/unit/pod/pod-wiring.test.ts tests/unit/goal-driver.test.ts tests/unit/goal-driver-completion.test.ts --runInBand
```
Expected: PASS (no goal regressions).

- [ ] **Step 5: Commit**

```text
git add gateway/src/index.ts gateway/tests/unit/pod/pod-wiring.test.ts
git commit -m "feat(pod): wire pod lifecycle into gateway goal flow"
```

---

## Task 8: Gateway REST routes

**Files:**
- Create: `gateway/src/routes/pods.ts`
- Create: `gateway/src/routes/pod-handlers.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/index.ts` (attach handlers)
- Test: `gateway/tests/unit/routes/pods.test.ts`

**Interfaces:**
- Consumes: services from Task 7; `PodService.get`, `PodTaskService`, `PodMessageService`, `PodGoalService`, `PodMemoryService`.
- Produces:
  ```ts
  export interface PodRouteDeps {
    pods: PodService;
    tasks: PodTaskService;
    messages: PodMessageService;
    goals: PodGoalService;
    memory: PodMemoryService;
    access?: { requireMember(sessionId: string, allowed: PodMemberRole[]): PodMemberRow };
    cost(podId: string): Promise<{ spentUsd: number; limitUsd: number }>;
    transcript(podId: string, sessionId: string): Promise<unknown>;
  }
  export function attachPodHandlers(registry: RouteRegistry, deps: PodRouteDeps): void;
  ```

- [ ] **Step 1: Write failing route test**

Mock req/res pattern from `session-run.test.ts`. Assert:
- `GET /api/projects/p1/pod` → 200 `{pod,members,...}`; idempotent; missing project → 404.
- `POST /api/projects/p1/pod` → 201/200.
- `GET /api/pods/pod_1` → 200/404.
- `PATCH /api/pods/pod_1` → 200; invalid status → 400.
- `GET/POST /api/pods/pod_1/tasks`; `PATCH /api/pods/pod_1/tasks/t1`; invalid transition → 409.
- `GET/POST /api/pods/pod_1/messages`.
- `POST /api/pods/pod_1/wake|sleep` → 200; missing pod → 404.
- `GET /api/pods/pod_1/cost`, `/goals`, `/sessions/s1/transcript`.
- Unknown method/path returns `false` (fallthrough).

- [ ] **Step 2: Run test to verify it fails**

```text
cd gateway
npx jest tests/unit/routes/pods.test.ts --runInBand
```
Expected: FAIL.

- [ ] **Step 3: Implement handler + attach**

- `handlePods(req,res,url,deps): Promise<boolean>` with regexes; return `false` if no match.
- JSON body parser with 64KB cap; malformed JSON → 400.
- Mutation bodies accept optional `actorSessionID`; when present, validate via `PodAccess.requireMember`; desktop user actions omit it and are allowed.
- Error mapping: `PodError.status` else 500.
- `attachPodHandlers` registers operationIds:
  `pods.ensure`, `pods.get`, `pods.update`, `pods.tasks.list`, `pods.tasks.create`, `pods.tasks.update`, `pods.messages.list`, `pods.messages.create`, `pods.wake`, `pods.sleep`, `pods.cost`, `pods.goals`, `pods.transcript`.
- Add all operations to `route-catalog.ts` with tags `['pods']`.
- Call `attachPodHandlers(this.routeRegistry, {...})` in `index.ts` after wave handlers.

- [ ] **Step 4: Run route + contract tests**

```text
cd gateway
npx jest tests/unit/routes/pods.test.ts tests/unit/api-contract.test.ts --runInBand
npm run emit:openapi
```
Expected: route tests PASS; contract emits without phantom routes.

- [ ] **Step 5: Commit**

```text
git add gateway/src/routes/pods.ts gateway/src/routes/pod-handlers.ts gateway/src/routes/route-catalog.ts gateway/src/index.ts gateway/tests/unit/routes/pods.test.ts packages/gateway-sdk/contract/gateway-paths.json
git commit -m "feat(pod): add pod REST routes and contract entries"
```

---

## Task 9: SDK + preload namespace

**Files:**
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/gateway-sdk/src/client.test.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Test: `packages/gateway-sdk/src/client.test.ts`
- Test: `packages/desktop/tests/pod-preload-wiring.test.ts`

**Interfaces:**
- Produces `MafwClient.pod` with:
  `ensure(projectID)`, `get(podID)`, `update(podID, body)`, `listTasks(podID)`, `createTask(podID, body)`, `updateTask(podID, taskID, body)`, `listMessages(podID)`, `sendMessage(podID, body)`, `wake(podID)`, `sleep(podID)`, `cost(podID)`, `goals(podID)`, `transcript(podID, sessionID)`.
- Produces preload `window.api.mafw.pod.*` mirroring the same methods via `invoke("pod", ...)`.

- [ ] **Step 1: Write failing SDK tests**

Add one test per method in `client.test.ts` asserting URL + method, e.g.:
```ts
fetchMock.mockResolvedValue(okJson({ pod: { id: 'pod_1' } }))
await c.pod.ensure('p1')
expect(fetchMock).toHaveBeenCalledWith('http://gw:3000/api/projects/p1/pod', expect.objectContaining({ method: 'GET' }))
```
- Assert `c.pod.updateTask('pod_1','t1',{status:'done'})` → `PATCH /api/pods/pod_1/tasks/t1`.
- Assert `c.pod.transcript('pod_1','s1')` → `GET /api/pods/pod_1/sessions/s1/transcript`.

- [ ] **Step 2: Run test to verify it fails**

```text
cd packages/gateway-sdk
node --import tsx --require ../../packages/test-shim/require-hook.cjs --test src/client.test.ts
```
Expected: FAIL (`pod` missing).

- [ ] **Step 3: Implement SDK + preload**

- Add `PodNamespace` interface + DTOs (`PodDetail`, `PodTask`, `PodMessage`, `PodGoal`) in `types.ts`; add `pod: PodNamespace` to `MafwClient`.
- Add `pod` field in `client.ts` using `this.request` with generated `ApiPath`.
- Run:
```text
cd packages/gateway-sdk
npm run gen:api
npm test
```
- Add `pod` to `MafwAPI` in `mafw-types.ts` and `createMafwApi` in `mafw-api.ts`; positional/object args must match SDK exactly.
- Add `packages/desktop/tests/pod-preload-wiring.test.ts` source assertions:
  `mafw-api.ts` contains `pod:` and `invoke("pod", "ensure"`; `mafw-types.ts` contains `pod:`.

- [ ] **Step 4: Run tests to verify they pass**

```text
cd packages/gateway-sdk
npm test
cd ../desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-preload-wiring.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/client.test.ts packages/gateway-sdk/src/api-schema.gen.ts packages/desktop/src/preload/mafw-types.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/tests/pod-preload-wiring.test.ts
git commit -m "feat(pod): expose pod api in sdk and preload"
```

---

## Task 9b: Plugin Pod tools

**Files:**
- Create: `src/tools/pod-status.ts`
- Create: `src/tools/pod-task-create.ts`
- Create: `src/tools/pod-task-update.ts`
- Create: `src/tools/pod-message.ts`
- Create: `src/tools/pod-memory-read.ts`
- Create: `src/tools/pod-memory-write.ts`
- Modify: `src/plugin.ts` (`V1_TOOLS` entries)
- Test: `tests/pod-tools.test.ts`

**Interfaces:**
- Each tool follows the existing `spawn-subagent.ts` shape:
  ```ts
  export interface PodTool { description: string; args: Record<string, z.ZodTypeAny>; execute(args: any, ctx: { sessionID: string; abort?: AbortSignal }): Promise<unknown>; }
  ```
- Tools:
  - `mafw_pod_status { podId?: string }`; when omitted, resolve caller session directory via `GET /api/sessions/:id`, then `GET /api/projects/:projectId/pod`.
  - `mafw_pod_task_create { podId: string; goalId?: string; title: string; ownerMemberId?: string }`
  - `mafw_pod_task_update { podId: string; taskId: string; status?: string; ownerMemberId?: string }`
  - `mafw_pod_message { podId: string; toMemberId?: string; kind: 'note'|'request'|'review'|'decision'|'escalation'; body: string }`
  - `mafw_pod_memory_read { podId: string; node?: 'plan'|'execute'|'review' }`
  - `mafw_pod_memory_write { podId: string; file: 'POD'|'MEMORY'|'GLOSSARY'; content: string }`
- All mutation tools send `actorSessionID: ctx.sessionID` in the JSON body; the route/service uses `PodAccess.requireMember`.
- `mafw_pod_memory_write` is Lead-only; the route enforces it, the tool surfaces 403 as `isError: true`.

- [ ] **Step 1: Write failing tool tests**

`tests/pod-tools.test.ts`:
- mock `global.fetch` with `{ ok: true, json: async () => ({ pod: {...} }) }`;
- `podStatusTool.execute({ podId: 'pod_1' }, { sessionID: 'ses_lead' })` calls `GET /api/pods/pod_1` and returns `title/output/metadata`;
- `podStatusTool.execute({}, { sessionID: 'ses_lead' })` first calls `GET /api/sessions/ses_lead`, then `GET /api/projects/<encoded directory>/pod`;
- `podTaskUpdateTool.execute({ podId:'pod_1', taskId:'t1', status:'done' }, { sessionID:'ses_builder' })` calls `PATCH /api/pods/pod_1/tasks/t1` with `actorSessionID:'ses_builder'`;
- `podMemoryWriteTool` with a 403 response returns `isError:true` and `output` contains `403`;
- each tool returns `isError:true` on fetch rejection.

- [ ] **Step 2: Run test to verify it fails**

```text
cd C:\work\work-loop\opencode-plugin-mafw
node --import tsx --import ./packages/test-shim/register.mjs --test tests/pod-tools.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement tools and register them**

Use `const PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000'` and `BASE = http://127.0.0.1:${PORT}` like `spawn-subagent.ts`.
Add all six to `V1_TOOLS` in `src/plugin.ts`.

- [ ] **Step 4: Run test to verify it passes**

```text
cd C:\work\work-loop\opencode-plugin-mafw
node --import tsx --import ./packages/test-shim/register.mjs --test tests/pod-tools.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add src/tools/pod-*.ts src/plugin.ts tests/pod-tools.test.ts
git commit -m "feat(pod): add plugin pod tools"
```

---

## Task 10: `pod.updated` canonical event

**Files:**
- Modify: `packages/gateway-sdk/src/events.ts`
- Modify: `packages/gateway-sdk/src/events.test.ts`
- Modify: `gateway/src/runtime/mafw-vocabulary.ts`
- Modify: `gateway/src/runtime/event-flow-matrix.ts`
- Modify: `gateway/tests/unit/runtime/vocabulary-sync.test.ts`
- Modify: `gateway/tests/unit/runtime/event-flow-matrix.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/session-events.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/gateway-sdk/src/events.test.ts`, `gateway/tests/unit/runtime/*`, `packages/desktop/src/renderer/mafw/sse/dispatcher.test.ts`

**Interfaces:**
- Produces `"pod.updated"` runtime event with `properties: { podId: string; kind: 'pod'|'member'|'task'|'message'|'memory'|'goal' }`.
- `ShellEventDeps` gains `pod: { onEvent: (event: any) => void }`; `MafwShell` provides a no-op `pod.onEvent` placeholder (the desktop Pod panel plan replaces it with `podRev` refresh).

- [ ] **Step 1: Write failing tests**

- `events.test.ts`: `RUNTIME_EVENT_TYPES` includes `pod.updated`; count becomes 31; `FLAT_EVENT_TYPES` unchanged at 15.
- `vocabulary-sync.test.ts` / matrix test: new type has a row; no missing/stale.
- `dispatcher.test.ts`: a `pod.updated` event calls `deps.pod.onEvent` exactly once and does not fall through to `missTrace`.
- `session-events.test.ts`: `pod.updated` is classified (no compile residual).

- [ ] **Step 2: Run tests to verify they fail**

```text
cd packages/gateway-sdk
node --import tsx --require ../../packages/test-shim/require-hook.cjs --test src/events.test.ts
cd ../../gateway
npx jest tests/unit/runtime/vocabulary-sync.test.ts tests/unit/runtime/event-flow-matrix.test.ts --runInBand
cd ../packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/sse/dispatcher.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement the event end-to-end**

- `events.ts`: add `"pod.updated"` to `RUNTIME_EVENT_TYPES`.
- `mafw-vocabulary.ts`: add `podUpdated: 'pod.updated'`.
- `event-flow-matrix.ts`: row `{ normalizeFacet: [], modeA: 'passthrough', desktop: 'handled', tui: 'ignore' }`.
- `session-events.ts`: add to `ShellHandledType`.
- `dispatcher.ts`: top-level branch before sid dispatch:
  ```ts
  if (event.type === 'pod.updated') { deps.pod.onEvent(event); return }
  ```
- `MafwShell.tsx`: add `sseDeps.pod = { onEvent: () => {} }` placeholder; the UI plan will replace it with a revision bump.
- `PodService`/task/message/memory `notify` calls `deps.broadcast({ type:'pod.updated', properties:{podId, kind} })`.

- [ ] **Step 4: Run tests to verify they pass**

```text
cd packages/gateway-sdk
node --import tsx --require ../../packages/test-shim/require-hook.cjs --test src/events.test.ts
cd ../../gateway
npx jest tests/unit/runtime/vocabulary-sync.test.ts tests/unit/runtime/event-flow-matrix.test.ts --runInBand
cd ../packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/sse/dispatcher.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add packages/gateway-sdk/src/events.ts packages/gateway-sdk/src/events.test.ts gateway/src/runtime/mafw-vocabulary.ts gateway/src/runtime/event-flow-matrix.ts gateway/tests/unit/runtime/vocabulary-sync.test.ts gateway/tests/unit/runtime/event-flow-matrix.test.ts packages/desktop/src/renderer/mafw/session-events.ts packages/desktop/src/renderer/mafw/sse/dispatcher.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/sse/dispatcher.test.ts
git commit -m "feat(pod): add pod.updated canonical event"
```

---

## Task 11: Pod access checks + budget

**Files:**
- Create: `gateway/src/core/pod/pod-access.ts`
- Create: `gateway/src/core/pod/pod-budget.ts`
- Test: `gateway/tests/unit/pod/pod-access.test.ts`
- Test: `gateway/tests/unit/pod/pod-budget.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class PodAccess {
    constructor(store: PodStore);
    requireMember(sessionId: string, allowed: PodMemberRole[]): PodMemberRow; // throws PodError(403)
  }
  export class PodBudget {
    constructor(deps: { store: PodStore; costForSessions(sessionIds: string[], sinceEpoch: number): number; dailyUsd(podId: string): number; nowEpoch(): number });
    canStart(podId: string): { ok: boolean; spentUsd: number; limitUsd: number };
    cost(podId: string): { spentUsd: number; limitUsd: number };
  }
  ```

- [ ] **Step 1: Write failing tests**

- `PodAccess.requireMember('s1',['lead'])` returns Lead; `['builder']` throws 403; unknown session throws 403.
- `PodBudget.canStart` sums only session ids from `store.listSessionIds(podId, sinceEpoch)`; under limit → ok; over limit → false; limit 0 → unlimited.
- Cost 0 when no sessions.

- [ ] **Step 2: Run tests to verify they fail**

```text
cd gateway
npx jest tests/unit/pod/pod-access.test.ts tests/unit/pod/pod-budget.test.ts --runInBand
```
Expected: FAIL.

- [ ] **Step 3: Implement + wire**

- `PodAccess` uses `store.getMemberBySession`.
- `PodBudget.costForSessions` in `index.ts` queries `trajectory_turns`:
  `SELECT COALESCE(SUM(cost),0) AS cost FROM trajectory_turns WHERE session_id IN (...) AND created_at >= ?`.
- `PodGoalService.enqueueGoal` calls `budget.canStart(podId)` before starting; over budget → queue and `pod.updated` kind `goal`.
- REST mutation routes read `actorSessionID` from the body and call `PodAccess.requireMember`; plugin tools send `ctx.sessionID`. `mafw_pod_memory_write` allows only `lead`; task/message allow `lead|builder|reviewer` as appropriate.

- [ ] **Step 4: Run tests to verify they pass**

```text
cd gateway
npx jest tests/unit/pod/pod-access.test.ts tests/unit/pod/pod-budget.test.ts --runInBand
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add gateway/src/core/pod/pod-access.ts gateway/src/core/pod/pod-budget.ts gateway/tests/unit/pod/pod-access.test.ts gateway/tests/unit/pod/pod-budget.test.ts gateway/src/index.ts
git commit -m "feat(pod): add pod role checks and budget gate"
```

---

## Task 12: Backend E2E + full verification

**Files:**
- Create: `gateway/tests/integration/pod-lite.test.ts`
- Modify: `AGENTS.md` (add Pod Lite backend section)
- Test: `gateway/tests/integration/pod-lite.test.ts`

**Interfaces:**
- Consumes all prior tasks.
- Produces an end-to-end backend proof:
  - create temp DB + `PodStore`;
  - `PodService.ensure('/proj')` → 3 members;
  - `PodGoalService.enqueueGoal('g1')` → started; `g2` → queued;
  - `PodTaskService.projectWaves` with 2 waves → 3 tasks;
  - `applyReceipt` marks one done;
  - `PodMessageService.send` + `PodMemoryService.captureGoal` round-trip;
  - `PodGoalService.onGoalArchived('g1')` promotes g2;
  - `PodAccess` rejects non-member; `PodBudget` respects limit.

- [ ] **Step 1: Write failing integration test**

Use temp dirs and a real `PodStore` on a temp SQLite file; fake `startGoal`, fake `getManagerSession`, fake `getSession`, fake `messages`. Assert the sequence above.

- [ ] **Step 2: Run test to verify it fails**

```text
cd gateway
npx jest tests/integration/pod-lite.test.ts --runInBand
```
Expected: FAIL until wiring is complete.

- [ ] **Step 3: Fix integration gaps**

Common gaps: `PodStore.findPodIdByGoal`, `PodService.getPodIdForGoal`, `PodGoalService` promotion order, transcript snapshot path. Keep fixes inside `core/pod/*`; do not change goal state machine.

- [ ] **Step 4: Run backend full suite**

```text
cd gateway
npm test -- --runInBand --forceExit
```
Expected: PASS; record suite/test counts.

- [ ] **Step 5: Run SDK + desktop regression**

```text
cd packages/gateway-sdk
npm test
cd ../desktop
npm test
npx tsgo --noEmit -p tsconfig.json
npx electron-vite build
cd ../..
npm run build
```
Expected: PASS; no UI panel yet, but event/preload changes must not regress.

- [ ] **Step 6: Update AGENTS.md**

Add a “Project Pod Lite backend” bullet with:
- new modules/services,
- one-active-goal queue,
- session transcript snapshots,
- `pod.updated` event,
- test counts,
- commit hash.

- [ ] **Step 7: Commit**

```text
git add AGENTS.md gateway/tests/integration/pod-lite.test.ts
git commit -m "test(pod): add pod lite backend e2e"
```

---

## Execution Notes

- This plan intentionally stops at the backend API/event layer. The desktop “鲸群” panel is a separate plan; it will consume `window.api.mafw.pod.*` and replace the `pod.onEvent` placeholder with a `podRev` refresh.
- Do not add new canonical events beyond `pod.updated`; if a task needs another signal, use the `pod.updated` `kind` field.
- Do not change `NodeDriver`’s session create/delete semantics beyond the `podContext` hook and the `client.delete` wrapper in `index.ts`.
- Keep `PodStore` tables additive; no migration framework is used in this repo.
- `PodStore.findPodIdByGoal(goalId)` and `PodStore.getGoalByGoalId(goalId)` are part of Task 1; do not duplicate goal lookup logic across services.
