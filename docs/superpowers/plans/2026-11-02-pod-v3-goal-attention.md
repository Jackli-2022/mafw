# Pod v3: Goal Intake and Attention Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pod a trustworthy project-team entry point: users hand over Goals, leave, return only for real human gates, and see truthful results and evidence.

**Architecture:** Keep the existing deterministic NodeDriver and Pod storage. Add a server-computed Goal stage/attention read model, a shared Goal intake path, explicit pause/cancel semantics, per-recipient message delivery, and frontend surfaces driven only by that read model. Add loop hardening (failure classification, attempt context, one-time approval ids, answer resume targets) without introducing a graph framework.

**Tech Stack:** TypeScript, Node HTTP, better-sqlite3, Jest, SolidJS, `@mafw/sdk`, OpenAPI contract generation, node:test / bun-compatible desktop tests.

**Spec:** `docs/superpowers/specs/2026-11-02-pod-v3-goal-attention-design.md`

## Global Constraints

- Preserve the deterministic `NodeDriver`; do not add LangGraph, Deep Agents, CrewAI, or an LLM-managed graph.
- The only executable user work unit is a Goal. `waves.tasks` are internal plan steps; manual tasks are notes; A2A requests are external requests.
- Attention badge counts only `owner='person'`: plan approval, pending question, non-terminal state error. Unread messages and `resultReady` are separate.
- Terminal results always archive and let the queue continue. Preserve `PASS`, `FAIL`, `MAX_RETRIES`, `ERROR`, `CANCELLED`; never map all terminal failures to `done` or `FAIL`.
- Pending/pull-by-design message delivery is not failure and never creates Goal attention.
- IDs used for write actions are explicit and idempotent: `questionId`, one-time random `approvalId`, task `taskId`.
- Never expose raw `goalId`, `sessionId`, `agentName`, or `sourceKey` as the primary user label; render resolved titles/stages.
- UI uses existing v2 primitives (`ButtonV2`, `TextInputV2`, `TooltipV2`, `LoaderV2`, `ToastV2`); no new raw `<button>`/`<input>`.
- Gateway routes must be registered in `gateway/src/routes/route-catalog.ts`; regenerate contracts with `cd gateway; npm run emit:openapi`; never hand-edit generated OpenAPI.
- Follow TDD: write the failing test, run it, implement, rerun, commit. Do not implement product code before the first failing test in the task.
- Use the `edit`/`write` tools for Chinese source files; do not use PowerShell `Set-Content`/`Get-Content` round-trips.
- Report each delivery with new test count, full-suite count, typecheck/build status, version and commit.
- Preserve unrelated parallel-session changes; stage only files named by the current task.

## Review Focus

- A stale or replayed plan approval must not approve a newer plan; expected behavior is 409 and no state advance.
- A user answer/approval received while paused must survive restart and reach the correct resumed node exactly once.
- A broadcast consumed by one member must remain pending for every other recipient; expected behavior is independent per-recipient delivery.
- A failed or max-retry Goal must never render as completed, and counts must equal the visible filtered list.
- A legacy, partial, or malformed Goal state must produce an honest stage/error instead of a fabricated working/completed state, and missing review evidence must fail closed in the result view.

---

### Task 1: Goal stage and attention pure model

**Files:**
- Create: `gateway/src/core/pod/pod-stage.ts`
- Test: `gateway/tests/unit/pod/pod-stage.test.ts`

**Interfaces:**
- Consumes: nothing from later tasks.
- Produces:

```ts
export type PodGoalVerdict = 'PASS' | 'FAIL' | 'MAX_RETRIES' | 'ERROR' | 'CANCELLED'
export type PodQueueReason = 'active_goal' | 'paused' | 'archived' | 'budget' | 'state_error'
export type PodGoalStageOwner = 'person' | 'team' | 'system'
export type PodGoalStageKind =
  | 'plan_approval' | 'question' | 'blocked' | 'queued'
  | 'working' | 'waiting' | 'ended'
export interface PodGoalStage {
  owner: PodGoalStageOwner
  kind: PodGoalStageKind
  queueReason?: PodQueueReason
  action?: {
    type: 'open_plan_review' | 'open_question' | 'open_goal' | 'open_result'
    goalId: string
    questionId?: string
  }
}
export interface PodGoalStageInput {
  goalId: string
  goalStatus: 'queued' | 'active' | 'done' | 'aborted'
  terminal: boolean
  nextAction: string
  verdict: PodGoalVerdict | null
  planApproval?: { status: 'pending' | 'approved' | 'rejected' } | null
  pendingQuestion?: { questionId: string; node: 'plan' | 'execute' | 'review' } | null
  nodeSession?: unknown | null
  stateMissing?: boolean
  queueReason?: PodQueueReason
}
export interface PodAttentionItem {
  id: string
  goalId: string
  kind: 'plan_approval' | 'question' | 'blocked'
  title: string
  action: NonNullable<PodGoalStage['action']>
}
export function projectPodGoalStage(input: PodGoalStageInput): PodGoalStage
export function projectPodAttention(
  goals: Array<{ goalId: string; title: string; stage: PodGoalStage }>,
): PodAttentionItem[]
```

- [ ] **Step 1: Write the failing tests**

Create tests covering the total priority table:

```ts
test('plan approval outranks question and is the only attention source', () => {
  const stage = projectPodGoalStage({
    goalId: 'g1', goalStatus: 'active', terminal: false, nextAction: 'AWAIT_PLAN_APPROVAL',
    verdict: null, planApproval: { status: 'pending' }, pendingQuestion: { questionId: 'q1', node: 'plan' },
  })
  expect(stage).toMatchObject({ owner: 'person', kind: 'plan_approval' })
  expect(projectPodAttention([{ goalId: 'g1', title: 'Fix Pod', stage }]))
    .toEqual([{ id: 'g1:plan_approval', goalId: 'g1', kind: 'plan_approval', title: 'Fix Pod', action: { type: 'open_plan_review', goalId: 'g1' } }])
})

test('reviewer review is team working, never person', () => {
  expect(projectPodGoalStage({
    goalId: 'g1', goalStatus: 'active', terminal: false, nextAction: 'RUNNING_review',
    verdict: null, nodeSession: { id: 's1', phase: 'review' },
  })).toMatchObject({ owner: 'team', kind: 'working' })
})

test('terminal verdicts remain distinct and never claim success', () => {
  for (const verdict of ['FAIL', 'MAX_RETRIES', 'ERROR', 'CANCELLED'] as const) {
    expect(projectPodGoalStage({
      goalId: 'g1', goalStatus: 'done', terminal: true, nextAction: 'FAILED', verdict,
    })).toMatchObject({ owner: 'system', kind: 'ended' })
  }
})

test('queue reasons are explicit and state errors are person/blocked', () => {
  expect(projectPodGoalStage({
    goalId: 'g1', goalStatus: 'queued', terminal: false, nextAction: 'NEXT_plan',
    verdict: null, queueReason: 'paused',
  })).toMatchObject({ owner: 'team', kind: 'queued', queueReason: 'paused' })
  expect(projectPodGoalStage({
    goalId: 'g1', goalStatus: 'active', terminal: false, nextAction: 'RUNNING_plan',
    verdict: null, stateMissing: true,
  })).toMatchObject({ owner: 'person', kind: 'blocked' })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd gateway; npx jest tests/unit/pod/pod-stage.test.ts --runInBand`
Expected: FAIL because `pod-stage` does not exist.

- [ ] **Step 3: Implement `projectPodGoalStage` and `projectPodAttention`**

Implement the priority table from spec §6.3. Terminal always wins. Missing non-terminal state becomes `blocked`. A queued Goal uses `queueReason`; never invent a reason. Attention excludes terminal Goals, unread messages and result-ready Goals.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd gateway; npx jest tests/unit/pod/pod-stage.test.ts --runInBand`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-stage.ts gateway/tests/unit/pod/pod-stage.test.ts
git commit -m "feat(pod): add deterministic goal stage projection"
```

---

### Task 2: Persist true verdicts and build Pod Goal views

**Files:**
- Modify: `gateway/src/core/pod/pod-store.ts`
- Modify: `gateway/src/core/pod/pod-goal-service.ts`
- Create: `gateway/src/core/pod/pod-view.ts`
- Test: `gateway/tests/unit/pod/pod-goal-service.test.ts`
- Test: `gateway/tests/unit/pod/pod-view.test.ts`

**Interfaces:**
- Consumes: Task 1 `PodGoalStage`, `PodGoalVerdict`, `projectPodGoalStage`.
- Produces:

```ts
export interface PodGoalDescription {
  title: string
  phase: string | null
  nextAction: string
  terminal: boolean
  verdict: PodGoalVerdict | null
  hasResultEvidence: boolean
  planApproval?: { id?: string; status: 'pending' | 'approved' | 'rejected' } | null
  pendingQuestion?: { questionId: string; node: 'plan' | 'execute' | 'review'; questions: string[] } | null
  nodeSession: unknown | null
  lastError: string | null
}
export interface PodGoalView {
  id: string; podId: string; goalId: string
  status: 'queued' | 'active' | 'done' | 'aborted'
  title: string; phase: string | null; verdict: PodGoalVerdict | null
  stage: PodGoalStage; resultReady: boolean
  enqueuedAt: string; startedAt: string | null; endedAt: string | null
}
export interface PodDetailView extends PodDetail {
  goals: PodGoalView[]
  attention: PodAttentionItem[]
}
export function buildPodGoalView(
  row: PodGoalRow,
  description: PodGoalDescription | null,
  queueReason: PodQueueReason | undefined,
): PodGoalView

// PodGoalService additions
describeGoal(goalId: string): PodGoalDescription | null
views(podId: string): PodGoalView[]
attention(podId: string): PodAttentionItem[]
```

- [ ] **Step 1: Write failing store/service/view tests**

Assert additive `verdict` migration, true archive outcome, legacy null, view titles, resultReady, and attention from view goals. Include:

```ts
test('archive preserves MAX_RETRIES instead of done/PASS', async () => {
  seedQueuedGoal(store, { podId: 'pod_1', goalId: 'g1', status: 'active' })
  await svc.onGoalArchived('g1', { verdict: 'MAX_RETRIES' })
  expect(store.getGoalByGoalId('g1')).toMatchObject({ status: 'done', verdict: 'MAX_RETRIES' })
})

test('legacy row without verdict remains ended; resultReady requires evidence', () => {
  expect(buildPodGoalView(legacyRow, { ...legacyDesc, hasResultEvidence: false }, undefined))
    .toMatchObject({ verdict: null, stage: { kind: 'ended' }, resultReady: false })
  expect(buildPodGoalView(legacyRow, { ...legacyDesc, hasResultEvidence: true }, undefined).resultReady).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd gateway; npx jest tests/unit/pod/pod-goal-service.test.ts tests/unit/pod/pod-view.test.ts --runInBand`
Expected: FAIL because `verdict` / `buildPodGoalView` are missing.

- [ ] **Step 3: Implement schema and view**

Add `verdict` with `ensureColumn`; update `setGoalStatus` to accept `{ endedAt?, verdict? }`; `onGoalArchived` writes the supplied verdict, `CANCELLED` maps storage status `aborted`, all other terminal verdicts map `done`. Build views with `projectPodGoalStage`; title falls back to `goalId` only in folded detail, never primary UI. `hasResultEvidence` is true only when state exposes a receipt/review/artifact or a terminal outcome; `resultReady = terminal && hasResultEvidence`. Per-task evidence is loaded separately by Task 5. Add an injected `describeGoal(goalId)` dependency to `PodGoalServiceDeps` (index reads request title/charter/state); `views(podId)` maps rows through `buildPodGoalView`, deriving queue reason from Pod status, budget and missing state. `attention(podId)` returns `projectPodAttention(views)`.

- [ ] **Step 4: Run tests**

Run: `cd gateway; npx jest tests/unit/pod/pod-goal-service.test.ts tests/unit/pod/pod-view.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-store.ts gateway/src/core/pod/pod-goal-service.ts gateway/src/core/pod/pod-view.ts gateway/tests/unit/pod/pod-goal-service.test.ts gateway/tests/unit/pod/pod-view.test.ts
git commit -m "feat(pod): persist goal verdicts and build goal views"
```

---

### Task 3: Shared Goal intake and Pod Goal composer API

**Files:**
- Create: `gateway/src/core/goal/goal-intake.ts`
- Test: `gateway/tests/unit/goal/goal-intake.test.ts`
- Modify: `gateway/src/mcp/handlers/create-goal.ts`
- Modify: `gateway/src/routes/pods.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/pod/pod-goals-create.test.ts`
- Test: `gateway/tests/unit/mcp/create-goal.test.ts` (create if absent)

**Interfaces:**
- Consumes: Task 2 views; existing `PodGoalService.enqueueGoal`.
- Produces:

```ts
export type GoalAuthorization = {
  source: 'desktop' | 'lead' | 'a2a' | 'automation' | 'user'
  requestMode: 'explicit' | 'inferred'
  scope?: string
}
export interface GoalIntakeInput {
  goalId: string
  title: string
  objective?: string
  charter?: string
  acceptance?: string[]
  boundaries?: string[]
  priority?: 'low' | 'medium' | 'high' | 'critical'
  maxLoops?: number
  budget?: { maxTurns?: number; maxCostUsd?: number }
  taskType?: 'feature' | 'bugfix' | 'refactor' | 'research' | 'docs' | 'test' | 'other'
  planReview?: 'auto' | 'manual'
  projectDir?: string
  source?: string
  authorization: GoalAuthorization
}
export interface GoalIntakeResult { goalId: string; charterPath: string; requestPath: string; projectDir: string }
export function createGoalIntake(input: GoalIntakeInput, deps: GoalIntakeDeps): GoalIntakeResult
export function buildGoalCharter(input: Pick<GoalIntakeInput, 'title' | 'objective' | 'acceptance' | 'boundaries'>): string
export function makePodGoalId(now: string, random: () => number): string

// PodGoalService.enqueueGoal returns the queue reason with the existing status.
export interface PodEnqueueResult {
  status: 'started' | 'queued'
  podId: string
  queueReason: PodQueueReason | null
}
// PodRouteDeps gains:
// newGoalId?(): string
// intake?: { create(input: GoalIntakeInput): GoalIntakeResult }
// goals.views(podId), goals.attention(podId)
```

- [ ] **Step 1: Write failing tests**

Test shared file contract, authorization, duplicate rejection, no partial files on invalid taskType, route:

```ts
test('composer and MCP create the same request shape', () => {
  const a = createGoalIntake({ ...base, authorization: { source: 'desktop', requestMode: 'explicit' } }, deps())
  const b = createGoalIntake({ ...base, authorization: { source: 'lead', requestMode: 'explicit' } }, deps())
  expect(JSON.parse(fs.readFileSync(a.requestPath, 'utf8'))).toMatchObject({
    acceptance: ['tests pass'], authorization: { source: 'desktop', requestMode: 'explicit' },
  })
  expect(JSON.parse(fs.readFileSync(b.requestPath, 'utf8')).authorization.source).toBe('lead')
})

test('POST /api/pods/:podId/goals returns started and queueReason', async () => {
  const out = await postGoal(deps(), { title: 'Fix Pod', objective: 'Truthful status', acceptance: ['tests pass'] })
  expect(out.status).toBe(200)
  expect(JSON.parse(out.body)).toMatchObject({ status: 'started', queueReason: null, goal: { title: 'Fix Pod' } })
})

test('every detail response exposes goal views and attention, never raw goals', async () => {
  const out = await getPod(deps(), 'pod_1')
  expect(JSON.parse(out.body).goals[0]).toMatchObject({ title: 'Fix Pod', stage: { owner: 'person', kind: 'plan_approval' } })
  expect(JSON.parse(out.body).attention[0].goalId).toBe('g1')
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd gateway; npx jest tests/unit/goal/goal-intake.test.ts tests/unit/pod/pod-goals-create.test.ts --runInBand`
Expected: FAIL because the module and route do not exist.

- [ ] **Step 3: Implement shared intake, route and deps**

Refactor `handleCreateGoal` to call `createGoalIntake`; the MCP handler keeps its response envelope and `eventBus.emit('goal_created')`. Add `POST /api/pods/:podId/goals` before `/api/pods/:podId`; require title and non-empty objective/charter; projectDir comes from the Pod, never request body; authorization is `desktop/explicit`; goal id comes from injected `newGoalId` and `makePodGoalId`. Add `route-catalog` entry `pods.goals.create`. When `actorSessionID` is supplied, require Lead; human requests without an actor remain allowed. Extend `PodRouteDeps.goals` with `enqueueGoal`, `views`, `attention`; use one helper on ensure/lookup/get/update responses to replace raw goals with `PodGoalView` and add `attention`. Extend `PodGoalService.enqueueGoal` return to `{ status, podId, queueReason }`, where queued reasons are `active_goal|paused|archived|budget|state_error`.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest tests/unit/goal/goal-intake.test.ts tests/unit/pod/pod-goals-create.test.ts tests/unit/mcp/create-goal.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/goal-intake.ts gateway/src/mcp/handlers/create-goal.ts gateway/src/routes/pods.ts gateway/src/routes/route-catalog.ts gateway/src/index.ts gateway/tests/unit/goal/goal-intake.test.ts gateway/tests/unit/pod/pod-goals-create.test.ts gateway/tests/unit/mcp/create-goal.test.ts
git commit -m "feat(pod): add shared goal intake and composer api"
```

---

### Task 4: Pause, resume and queued Goal cancellation

**Files:**
- Modify: `gateway/src/core/pod/pod-goal-service.ts`
- Modify: `gateway/src/core/goal/driver.ts`
- Modify: `gateway/src/routes/pods.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/pod/pod-goal-service.test.ts`
- Test: `gateway/tests/unit/goal-driver-completion.test.ts`
- Test: `gateway/tests/unit/pod/pod-pause-routes.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces:

```ts
// PodGoalService
async pause(podId: string): Promise<void>
async resume(podId: string): Promise<boolean>
cancelQueued(podId: string, goalId: string): PodGoalRow

// DriverDeps
canCreateNode?: (goalId: string) => boolean
```

- [ ] **Step 1: Write failing tests**

Cover no new node while paused, no restart during watchdog pause, approval accepted-but-not-advanced, queued cancel, and resume once:

```ts
test('paused Pod does not create the next node, but archive still runs', async () => {
  deps.canCreateNode = () => false
  await driver.advance('g1')
  expect(client.create).not.toHaveBeenCalled()
})

test('queued cancel never creates state or starts a goal', async () => {
  const row = svc.cancelQueued('pod_1', 'g2')
  expect(row).toMatchObject({ status: 'aborted', verdict: 'CANCELLED' })
  expect(store.getGoalByGoalId('g2')?.status).toBe('aborted')
  expect(startGoal).not.toHaveBeenCalledWith('g2', expect.anything())
})

test('paused approval writes decision and resume advances it once', async () => {
  await svc.pause('pod_1')
  await approvePlan('g1')
  expect(loadState('g1').planApproval?.status).toBe('approved')
  expect(advanceGoal).not.toHaveBeenCalled()
  await svc.resume('pod_1')
  expect(advanceGoal).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd gateway; npx jest tests/unit/pod/pod-goal-service.test.ts tests/unit/goal-driver-completion.test.ts tests/unit/pod/pod-pause-routes.test.ts --runInBand`
Expected: FAIL.

- [ ] **Step 3: Implement control gates**

`PodGoalService.pause` sets `paused`; `resume` sets `active`, advances an existing active Goal once, otherwise promotes FIFO. `cancelQueued` only accepts queued rows. Driver `advanceInner` checks `canCreateNode` immediately before `executeNode` for plan/execute/review nodes; askUser and archive remain allowed. Index supplies `canCreateNode` from the Pod status and calls `executeAskUser`/archive without a new session. Route `PATCH /api/pods/:podId` accepts active/paused/archived exactly as before, but active calls `resume`; add `DELETE /api/pods/:podId/goals/:goalId` for queued cancellation and register `pods.goals.cancel` in the catalog. Do not write `POD_PAUSED` into GoalState.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest tests/unit/pod/pod-goal-service.test.ts tests/unit/goal-driver-completion.test.ts tests/unit/pod/pod-pause-routes.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-goal-service.ts gateway/src/core/goal/driver.ts gateway/src/routes/pods.ts gateway/src/routes/route-catalog.ts gateway/src/index.ts gateway/tests/unit/pod/pod-goal-service.test.ts gateway/tests/unit/goal-driver-completion.test.ts gateway/tests/unit/pod/pod-pause-routes.test.ts
git commit -m "feat(pod): add truthful pause and queued cancellation"
```

---

### Task 5: Task kinds, notes and Goal result endpoint

**Files:**
- Modify: `gateway/src/core/pod/pod-task-service.ts`
- Create: `gateway/src/core/pod/pod-result.ts`
- Modify: `gateway/src/core/pod/pod-goal-service.ts`
- Modify: `gateway/src/routes/pods.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Test: `gateway/tests/unit/pod/pod-task-service.test.ts`
- Test: `gateway/tests/unit/pod/pod-result.test.ts`
- Test: `gateway/tests/unit/pod/pod-result-route.test.ts`

**Interfaces:**
- Consumes: Task 2 views/states; review rubric parser.
- Produces:

```ts
export type PodTaskKind = 'plan' | 'note' | 'external_request'
export function podTaskKindOf(task: Pick<PodTaskRow, 'sourceKey' | 'goalId' | 'externalTaskId'>): PodTaskKind
export interface PodGoalResult {
  goalId: string
  verdict: PodGoalVerdict | null
  resultReady: boolean
  goalAcceptance: string[]
  tasks: Array<{ taskId: string; result: 'pass' | 'fail' | 'skipped'; evidence: string }>
  reviewFeedback: string
  receipt: unknown | null
  artifacts: string[]
}
export function buildPodGoalResult(input: {
  goalId: string
  state: GoalStateV3 | null
  request: Record<string, unknown> | null
  readText(path: string): string | null
}): PodGoalResult

// PodGoalService
result(podId: string, goalId: string): PodGoalResult
```

- [ ] **Step 1: Write failing tests**

Assert kinds, no UI delete gating, result parse, missing evidence fail-closed, and route 404/200:

```ts
test('manual rows are notes and are not executable plan tasks', () => {
  expect(podTaskKindOf({ sourceKey: 'manual:x', goalId: null, externalTaskId: null })).toBe('note')
  expect(podTaskKindOf({ sourceKey: 'wave:w1:task:w1-t1', goalId: 'g1', externalTaskId: 'w1-t1' })).toBe('plan')
  expect(podTaskKindOf({ sourceKey: 'a2a:m1', goalId: 'g1', externalTaskId: null })).toBe('external_request')
})

test('malformed review report yields resultReady true but no fabricated PASS evidence', () => {
  const result = buildPodGoalResult({ goalId: 'g1', state, request, readText: () => '{broken' })
  expect(result.verdict).toBe('FAIL')
  expect(result.tasks).toEqual([])
})

test('result route returns accepted goal evidence and rejects another Pod goal', async () => {
  expect((await getResult(deps(), 'g1')).status).toBe(200)
  expect((await getResult(deps(), 'foreign')).status).toBe(404)
})
```

- [ ] **Step 2: Run failing tests**

Run: `cd gateway; npx jest tests/unit/pod/pod-task-service.test.ts tests/unit/pod/pod-result.test.ts tests/unit/pod/pod-result-route.test.ts --runInBand`
Expected: FAIL because kind/result APIs are missing.

- [ ] **Step 3: Implement kinds and result**

Derive kind; include it in every task returned by the service/routes. Manual creation remains API-compatible but returns kind `note`. Result reads state paths through injected readText, parses rubric with `parseReviewRubric`, and on parse error returns FAIL/empty evidence rather than PASS. Add `GET /api/pods/:podId/goals/:goalId/result` after association check; catalog id `pods.goals.result`.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest tests/unit/pod/pod-task-service.test.ts tests/unit/pod/pod-result.test.ts tests/unit/pod/pod-result-route.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-task-service.ts gateway/src/core/pod/pod-result.ts gateway/src/core/pod/pod-goal-service.ts gateway/src/routes/pods.ts gateway/src/routes/route-catalog.ts gateway/tests/unit/pod/pod-task-service.test.ts gateway/tests/unit/pod/pod-result.test.ts gateway/tests/unit/pod/pod-result-route.test.ts
git commit -m "feat(pod): separate task kinds and expose goal results"
```

---

### Task 6: Per-recipient message delivery

**Files:**
- Modify: `gateway/src/core/pod/pod-store.ts`
- Modify: `gateway/src/core/pod/pod-message-delivery.ts`
- Modify: `gateway/src/routes/pods.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/pod/pod-message-delivery.test.ts`
- Test: `gateway/tests/unit/pod/pod-store.test.ts`

**Interfaces:**
- Consumes: existing messages/members/sessions.
- Produces:

```ts
export interface PodMessageDeliveryRow {
  messageId: string; podId: string; memberId: string
  deliveredAt: string | null; deliveredSessionId: string | null
  status: 'pending' | 'delivered' | 'failed'
  attempts: number; lastError: string | null; nextRetryAt: string | null
}
// PodDetailView gains:
messageHealth: PodMessageDeliveryRow[] // only status='failed'
// PodStore
hasDelivery(messageId: string, memberId: string): boolean
markDeliveryDelivered(messageId: string, memberId: string, sessionId: string, now: string): void
markDeliveryFailed(messageId: string, memberId: string, error: string, now: string): void
listDeliveryFailures(podId: string): PodMessageDeliveryRow[]
```

- [ ] **Step 1: Write failing tests**

Add a three-member broadcast test and legacy migration test:

```ts
test('a broadcast is delivered independently to all three members', async () => {
  const msg = messages.send({ podId, fromMemberId: lead.id, toMemberId: null, kind: 'note', body: 'all' })
  const b = await delivery.pendingForSession(builderSession)
  const r = await delivery.pendingForSession(reviewerSession)
  expect(b).toContain('all')
  expect(r).toContain('all')
  expect(store.hasDelivery(msg.id, builder.id)).toBe(true)
  expect(store.hasDelivery(msg.id, reviewer.id)).toBe(false)
})

test('legacy delivered broadcast does not replay after migration', () => {
  seedLegacyBroadcast({ deliveredAt: '2026-01-01', deliveredSessionId: builderSession })
  const pending = store.listPendingMessages(podId, reviewer.id)
  expect(pending).toEqual([])
})
```

- [ ] **Step 2: Run failing tests**

Run: `cd gateway; npx jest tests/unit/pod/pod-message-delivery.test.ts tests/unit/pod/pod-store.test.ts --runInBand`
Expected: FAIL.

- [ ] **Step 3: Implement delivery table and semantics**

Create `pod_message_deliveries` with PK `(message_id, member_id)` and failure fields. Backfill direct legacy delivery by matching session; for legacy delivered broadcasts insert delivered rows for current members so old messages do not replay. Pending queries exclude only the current member's delivered row. `commitDelivered` resolves the member through `getMemberBySession`; no member/session means no mark. `deliver` and pull delivery failures increment `attempts` and persist `lastError`; success sets `delivered`; three hard failures/dismissed state are health only. Broadcasts never force-push; `notify` requires one recipient, otherwise 400 remains. Mail failures are health rows, never Goal attention; attach `messageHealth` to detail responses from `listDeliveryFailures(podId)`.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest tests/unit/pod/pod-message-delivery.test.ts tests/unit/pod/pod-store.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-store.ts gateway/src/core/pod/pod-message-delivery.ts gateway/src/routes/pods.ts gateway/src/index.ts gateway/tests/unit/pod/pod-message-delivery.test.ts gateway/tests/unit/pod/pod-store.test.ts
git commit -m "feat(pod): deliver messages per recipient"
```

---

### Task 7: Plan structured task contract and Goal acceptance propagation

**Files:**
- Modify: `gateway/src/core/goal/node-prompts.ts`
- Modify: `gateway/src/core/goal/driver.ts`
- Test: `gateway/tests/unit/goal/node-prompts.test.ts`
- Test: `gateway/tests/unit/goal/goal-plan-schema.test.ts`

**Interfaces:**
- Consumes: Task 3 Goal acceptance in `requests/<goalId>.json`.
- Produces: plan JSON Schema accepting both legacy strings and object tasks; plan prompt reads Goal acceptance and requires decomposition.

- [ ] **Step 1: Write failing schema/prompt tests**

```ts
test('plan schema accepts object tasks with acceptance but still accepts legacy strings', () => {
  const schema = planOutputSchema()
  const ok = (tasks: unknown[]) => validateJsonSchema(schema as any, readyWaves(tasks))
  expect(ok([{ title: 'fix', acceptance: ['tests pass'] }])).toBe(true)
  expect(ok(['legacy'])).toBe(true)
  expect(ok([{ title: 'fix', acceptance: 'not-array' }])).toBe(false)
})

test('plan prompt requires decomposing goal acceptance from request', () => {
  const prompt = renderNodePrompt('plan', ctx({ goalAcceptance: ['pods.tasks.delete returns 200'] }))
  expect(prompt).toContain('Goal acceptance')
  expect(prompt).toContain('pods.tasks.delete returns 200')
})
```

- [ ] **Step 2: Run failing tests**

Run: `cd gateway; npx jest tests/unit/goal/node-prompts.test.ts tests/unit/goal/goal-plan-schema.test.ts --runInBand`
Expected: FAIL.

- [ ] **Step 3: Implement schema and prompt**

Extract/export the task item schema from `node-prompts.ts`. `tasks.items` is `anyOf` string or `{ title required, acceptance?: string[] max 20 / 500 chars, taskId?: string }`. Add `goalAcceptance?: string[]` to `NodePromptCtx`; driver reads `request.acceptance` and passes it only to plan. Prompt says goal acceptance must be decomposed into wave task acceptance and is not a replacement for task acceptance. Keep `ensureWaveTaskIds`.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest tests/unit/goal/node-prompts.test.ts tests/unit/goal/goal-plan-schema.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/node-prompts.ts gateway/src/core/goal/driver.ts gateway/tests/unit/goal/node-prompts.test.ts gateway/tests/unit/goal/goal-plan-schema.test.ts
git commit -m "fix(goal): preserve object tasks and goal acceptance"
```

---

### Task 8: Skipped/archive state, Pod memory budget and notify semantics

**Files:**
- Modify: `gateway/src/core/pod/pod-store.ts`
- Modify: `gateway/src/core/pod/pod-task-service.ts`
- Modify: `gateway/src/core/pod/pod-memory-service.ts`
- Modify: `gateway/src/routes/pods.ts`
- Test: `gateway/tests/unit/pod/pod-task-service.test.ts`
- Test: `gateway/tests/unit/pod/pod-memory-service.test.ts`
- Test: `gateway/tests/unit/pod/pod-routes-edit.test.ts`

**Interfaces:**
- Produces: `PodTaskStatus` adds `'skipped'`; memory reservation is a cap not fixed allocation; mailbox notify never uses `force` into a running node.

- [ ] **Step 1: Write failing tests**

```ts
test('skipped is terminal and survives PASS archive', () => {
  const tasks = svc.projectWaves(podId, goalId, planWithTask)
  svc.applyReviewResults(podId, goalId, [{ taskId: 'w1-t1', result: 'skipped' }])
  svc.reconcileArchive(podId, goalId, true)
  expect(svc.list(podId, goalId)[0].status).toBe('skipped')
})

test('unused decisions reserve returns to stable files', () => {
  writeMemory('POD.md', 'p'.repeat(3000))
  writeMemory('POD_MEMORY.md', 'm'.repeat(3000))
  const block = svc.renderContext(podId, 'plan')!
  expect(block.length).toBeLessThanOrEqual(4096)
  expect(block.length).toBeGreaterThan(2600)
  expect(block).toContain('## POD.md')
  expect(block).toContain('## POD_MEMORY.md')
})

test('notify never forces delivery into a running node', async () => {
  await postMessage(deps(), { toMemberId: builder.id, notify: true, ... })
  const opts = (delivery.deliver as jest.Mock).mock.calls.at(-1)?.[1]
  expect(opts?.force).not.toBe(true)
})
```

- [ ] **Step 2: Run failing tests**

Run: `cd gateway; npx jest tests/unit/pod/pod-task-service.test.ts tests/unit/pod/pod-memory-service.test.ts tests/unit/pod/pod-routes-edit.test.ts --runInBand`
Expected: FAIL.

- [ ] **Step 3: Implement state and budget fixes**

Add `skipped` terminal status with no outgoing transitions; map receipt/review skipped to it; archive leaves it unchanged. Allocate memory by first taking at most 1600 chars from recent decisions, then give all unused budget plus normal remainder to POD/POD_MEMORY/glossary in order, with a visible `…[truncated]` marker. Replace route `deliver(..., { force: true })` with `{ force: false }`; coordinator push still uses normal decision, node sessions remain pending for next handoff.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest tests/unit/pod/pod-task-service.test.ts tests/unit/pod/pod-memory-service.test.ts tests/unit/pod/pod-routes-edit.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-store.ts gateway/src/core/pod/pod-task-service.ts gateway/src/core/pod/pod-memory-service.ts gateway/src/routes/pods.ts gateway/tests/unit/pod/pod-task-service.test.ts gateway/tests/unit/pod/pod-memory-service.test.ts gateway/tests/unit/pod/pod-routes-edit.test.ts
git commit -m "fix(pod): align task, memory and notify semantics"
```

---

### Task 9: Structured node failure classification and attempt context

**Files:**
- Create: `gateway/src/core/goal/failure-class.ts`
- Test: `gateway/tests/unit/goal/failure-class.test.ts`
- Modify: `gateway/src/core/goal/state-v3.ts`
- Modify: `gateway/src/core/goal/driver.ts`
- Modify: `gateway/src/core/goal/node-prompts.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/goal-driver-completion.test.ts`
- Test: `gateway/tests/unit/goal/node-prompts.test.ts`

**Interfaces:**
- Produces:

```ts
export type FailureClass = 'retryable_environment' | 'terminal_contract' | 'terminal_session'
export function classifyNodeFailure(input: {
  code: string; node: 'plan' | 'execute' | 'review'; source: 'runtime' | 'artifact'
}): FailureClass

// GoalStateV3 additions
lastFailure: { class: FailureClass; code: string; message: string; node: 'plan' | 'execute' | 'review'; attempt: number; at: string } | null
```

- [ ] **Step 1: Write failing tests**

```ts
test('network/provider errors retry, contract/unknown errors terminate', () => {
  expect(classifyNodeFailure({ code: '429', node: 'execute', source: 'runtime' })).toBe('retryable_environment')
  expect(classifyNodeFailure({ code: 'ECONNRESET', node: 'plan', source: 'runtime' })).toBe('retryable_environment')
  expect(classifyNodeFailure({ code: 'artifact_invalid', node: 'review', source: 'artifact' })).toBe('terminal_contract')
  expect(classifyNodeFailure({ code: 'weird_runtime_code', node: 'execute', source: 'runtime' })).toBe('terminal_session')
})

test('retry prompt includes attempt and structured last failure', () => {
  const p = renderNodePrompt('execute', ctx({ attempt: 2, maxAttempts: 2, lastFailure: failure }))
  expect(p).toContain('attempt 2/2')
  expect(p).toContain('429')
})
```

- [ ] **Step 2: Run failing tests**

Run: `cd gateway; npx jest tests/unit/goal/failure-class.test.ts tests/unit/goal-driver-completion.test.ts tests/unit/goal/node-prompts.test.ts --runInBand`
Expected: FAIL.

- [ ] **Step 3: Implement classification and propagation**

Add `lastFailure` normalization to state v3. Change driver listener error callback to accept `{ message, code, source }`; index extracts runtime error code from event and passes it. Classify before failNode. Retryable increments attempt without changing round; if attempts exhausted classify as `terminal_session`. Artifact errors call terminal contract. Persist lastFailure; clear on a valid node artifact. Extend prompt context with attempt/maxAttempts/lastFailure and instruct inspection of existing artifacts/worktree before retry.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest tests/unit/goal/failure-class.test.ts tests/unit/goal-driver-completion.test.ts tests/unit/goal/node-prompts.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/failure-class.ts gateway/src/core/goal/state-v3.ts gateway/src/core/goal/driver.ts gateway/src/core/goal/node-prompts.ts gateway/src/index.ts gateway/tests/unit/goal/failure-class.test.ts gateway/tests/unit/goal-driver-completion.test.ts gateway/tests/unit/goal/node-prompts.test.ts
git commit -m "feat(goal): classify failures and carry attempt context"
```

---

### Task 10: One-time plan approval, answer resume target and no-progress gate

**Files:**
- Modify: `gateway/src/core/goal/state-v3.ts`
- Modify: `gateway/src/core/goal/driver.ts`
- Modify: `gateway/src/core/goal/node-prompts.ts`
- Modify: `gateway/src/routes/goal-plan.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/goal/approval-id.test.ts`
- Test: `gateway/tests/unit/goal/answer-resume.test.ts`
- Test: `gateway/tests/unit/goal/no-progress.test.ts`
- Test: `gateway/tests/unit/goal-plan-routes.test.ts`

**Interfaces:**
- Consumes: Task 9 `lastFailure`.
- Produces:

```ts
// PendingQuestion
resumeNode: 'plan' | 'execute' | 'review'
// planApproval
planApproval: { id: string; status: 'pending' | 'approved' | 'rejected'; round: number; feedback?: string; decidedAt?: string }
// userResponse
userResponse: { questionId: string; answer: string; resumeNode: 'plan' | 'execute' | 'review'; respondedAt: string; consumedByRunId?: number }
// GoalStateV3
noProgressCount: number
lastArtifactDigest?: Record<'plan' | 'execute' | 'review', string>
// DriverDeps
newApprovalId(): string
// Driver methods
approvePlan(goalId: string, approvalId?: string): Promise<boolean>
rejectPlan(goalId: string, feedback: string, approvalId?: string): Promise<boolean>
// GoalPlanDeps / route body
body: { approve?: boolean; feedback?: string; approvalId?: string }
```

- [ ] **Step 1: Write failing tests**

```ts
test('approving a previous plan id is 409 and does not advance', async () => {
  const id = await startPendingApproval()
  await approve(goal, id)
  await expect(approve(goal, id)).resolves.toMatchObject({ status: 409 })
  expect(advance).toHaveBeenCalledTimes(1)
})

test('a withdrawn answer is injected into its declared resume node', async () => {
  await driver.handleAnswer('g1', 'q1', 'use option B')
  expect(loadState('g1')).toMatchObject({ nextNode: 'execute', userResponse: { resumeNode: 'execute' } })
  await driver.advance('g1')
  expect(promptText()).toContain('use option B')
})

test('same artifact/no-progress three times asks a question instead of looping', async () => {
  for (let i = 0; i < 3; i++) await completeNoProgress()
  expect(loadState('g1').pendingQuestion?.questions[0]).toMatch(/no progress/i)
})
```

- [ ] **Step 2: Run failing tests**

Run: `cd gateway; npx jest tests/unit/goal/approval-id.test.ts tests/unit/goal/answer-resume.test.ts tests/unit/goal/no-progress.test.ts tests/unit/goal-plan-routes.test.ts --runInBand`
Expected: FAIL.

- [ ] **Step 3: Implement ids, resume and no-progress**

Generate a random id when a plan produces the approval gate. Route requires `approvalId`; match current pending record and reject stale/replayed/missing ids with 409. Legacy only when stored pending record lacks `id`. `PendingQuestion` creation sets `resumeNode`: plan/review legacy default `plan`; no-progress uses the blocked node. `handleAnswer` writes `nextNode=resumeNode`, no advance while Pod paused. Prompt includes original questions and answer; keep `userResponse` until resumed node produces a valid artifact, then set `consumedByRunId`. Add `noProgressCount` state; increment when the same node/round produces an artifact digest identical to the previous attempt or the same review feedback signature; reset on a changed artifact; at 3 create a pendingQuestion for the current node. Do not count a valid FAIL review with new evidence as no progress.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest tests/unit/goal/approval-id.test.ts tests/unit/goal/answer-resume.test.ts tests/unit/goal/no-progress.test.ts tests/unit/goal-plan-routes.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/state-v3.ts gateway/src/core/goal/driver.ts gateway/src/core/goal/node-prompts.ts gateway/src/routes/goal-plan.ts gateway/src/index.ts gateway/tests/unit/goal/approval-id.test.ts gateway/tests/unit/goal/answer-resume.test.ts gateway/tests/unit/goal/no-progress.test.ts gateway/tests/unit/routes/goal-plan.test.ts
git commit -m "feat(goal): add one-time approvals and resume-aware answers"
```

---

### Task 11: SDK, preload and generated contract

**Files:**
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/gateway-sdk/src/client.test.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts` (if namespace types live here)
- Generated: `packages/gateway-sdk/contract/gateway-paths.json`, `openapi.json`, `src/api-schema.gen.ts`
- Test: `packages/gateway-sdk/src/contract.test.ts` (or existing contract test)

**Interfaces:**
- Consumes: Tasks 1–10 API and DTOs.
- Produces:

```ts
PodGoalStage, PodAttentionItem, PodGoalVerdict, PodQueueReason, PodTaskKind
PodCreateGoalInput = { title: string; objective: string; acceptance?: string[]; boundaries?: string[]; planReview?: 'auto'|'manual' }
PodCreateGoalResult = { goalId: string; status: 'started'|'queued'; queueReason: PodQueueReason|null; goal: PodGoal }
PodTask.status includes 'skipped'; PodTask.kind
PodGoal gains title/phase/verdict/stage/resultReady
PodDetail gains attention/messageHealth
PodNamespace gains:
  createGoal(podID, body): Promise<{ goalId; status; queueReason; goal }>
  result(podID, goalID): Promise<PodGoalResult>
  cancelGoal(podID, goalID): Promise<{ goal: PodGoal }>
  pause(podID): Promise<PodDetail>
  resume(podID): Promise<PodDetail>
// GoalNamespace approval signatures change:
  approvePlan(goalId, approvalId): Promise<{ success: boolean }>
  rejectPlan(goalId, approvalId, feedback): Promise<{ success: boolean }>
```

- [ ] **Step 1: Write failing SDK tests**

Test request paths/body and type presence:

```ts
await c.pod.createGoal('pod_1', { title: 'Fix', objective: 'Truthful', acceptance: ['tests pass'], planReview: 'manual' })
expect(fetchMock).toHaveBeenLastCalledWith('http://gw:3000/api/pods/pod_1/goals', expect.objectContaining({ method: 'POST' }))
await c.pod.result('pod_1', 'g1')
expect(fetchMock).toHaveBeenLastCalledWith('http://gw:3000/api/pods/pod_1/goals/g1/result', expect.anything())
await c.pod.cancelGoal('pod_1', 'g2')
expect(fetchMock).toHaveBeenLastCalledWith('http://gw:3000/api/pods/pod_1/goals/g2', expect.objectContaining({ method: 'DELETE' }))
await c.goals.approvePlan('g1', 'pa_123')
expect(JSON.parse((fetchMock.mock.calls.at(-1)! as any[])[1].body)).toEqual({ approve: true, approvalId: 'pa_123' })
```

- [ ] **Step 2: Run failing tests**

Run: `cd packages/gateway-sdk; npm test`
Expected: FAIL because methods/types are missing.

- [ ] **Step 3: Implement SDK and preload; regenerate contract**

Run `cd gateway; npm run emit:openapi`. Add exact types mirroring route DTOs; update preload `pod` methods; do not hand-edit generated schema. Keep old `sleep/wake` methods but mark deprecated in comments.

- [ ] **Step 4: Run SDK/contract tests and build**

Run: `cd packages/gateway-sdk; npm test; npm run build`
Expected: PASS, rc=0.
Run: `cd gateway; npx jest tests/unit/api-contract.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/client.test.ts packages/gateway-sdk/contract/gateway-paths.json packages/gateway-sdk/contract/openapi.json packages/gateway-sdk/src/api-schema.gen.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/src/preload/mafw-types.ts
git commit -m "feat(sdk): expose pod goal intake and stage dto"
```

---

### Task 12: Desktop Pod logic and Goal composer

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pod-model.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-model.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/pod-store.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-store.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/PodGoalComposer.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/PodDock.tsx`

**Interfaces:**
- Consumes: Task 11 SDK/preload types.
- Produces:

```ts
// pod-model.ts
export function podStageLabel(stage: PodGoalStage): string
export function podStageTone(stage: PodGoalStage): 'person' | 'team' | 'system'
export function podGoalResultLabel(verdict: PodGoalVerdict | null): string
export function attentionCount(detail: Pick<PodDetail, 'attention'>): number
export function planTaskOnly(tasks: PodTask[]): PodTask[]
export function noteTasksOnly(tasks: PodTask[]): PodTask[]
// PodGoalComposer props
{ busy: boolean; activeGoalId: string | null; initial?: {
  title: string; objective?: string; acceptance?: string[]
}; onCreate(input: {
  title: string; objective: string; acceptance: string[]; boundaries: string[]; planReview: 'auto'|'manual'
}): Promise<boolean> }
// PodStoreApi gains
createGoal(podID: string, body: PodCreateGoalInput): Promise<PodCreateGoalResult>
result(podID: string, goalID: string): Promise<PodGoalResult>
cancelGoal(podID: string, goalID: string): Promise<{ goal: PodGoal }>
pause(podID: string): Promise<PodDetail>
resume(podID: string): Promise<PodDetail>
```

- [ ] **Step 1: Write failing pure tests**

```ts
test('stage labels never expose internal goal ids', () => {
  expect(podStageLabel({ owner: 'person', kind: 'plan_approval' })).toBe('等待你批准计划')
  expect(podStageLabel({ owner: 'team', kind: 'working' })).toBe('团队工作中')
  expect(podStageLabel({ owner: 'system', kind: 'ended' })).toBe('已结束')
})
test('attention count excludes unread and result-ready', () => {
  expect(attentionCount({ attention: [{ id: 'a', goalId: 'g', kind: 'question', title: 'Q', action: { type: 'open_question', goalId: 'g' } }] })).toBe(1)
})
test('notes are not plan tasks', () => {
  const tasks = [task({ kind: 'note' }), task({ kind: 'plan' }), task({ kind: 'external_request' })]
  expect(planTaskOnly(tasks).map((t) => t.kind)).toEqual(['plan'])
  expect(noteTasksOnly(tasks).map((t) => t.kind)).toEqual(['note'])
})
```

- [ ] **Step 2: Run failing tests**

Run: `cd packages/desktop; node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-model.test.ts src/renderer/mafw/pod-store.test.ts`
Expected: FAIL for missing exports.

- [ ] **Step 3: Implement composer and store methods**

Add `createGoal`, `result`, `cancelGoal`, `pause`, `resume` to `PodStoreApi` and store. Keep monotonic seq and refresh debounce. Composer: `TextInputV2` title, multiline objective, optional acceptance/boundaries (one per line), `SwitchV2` for planReview; submit disabled while busy/empty; success clears and refreshes; 409/400 text is actionable. Add it above "需要你" in PodDock. Change status toggle to pause/resume only; remove active↔idle semantics. Empty state CTA becomes "创建鲸群并交代第一个目标" and opening a newly created Pod focuses the composer.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w @mafw/desktop`
Expected: PASS.
Run: `cd packages/desktop; npx tsgo --noEmit -p tsconfig.json`
Expected: rc=0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/pod-model.ts packages/desktop/src/renderer/mafw/pod-model.test.ts packages/desktop/src/renderer/mafw/pod-store.ts packages/desktop/src/renderer/mafw/pod-store.test.ts packages/desktop/src/renderer/mafw/components/PodGoalComposer.tsx packages/desktop/src/renderer/mafw/components/PodDock.tsx
git commit -m "feat(desktop): add pod goal composer and stage logic"
```

---

### Task 13: Desktop attention, tasks, results and rail

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/PodAttentionList.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/PodResultPanel.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/PodDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/PodTaskBoard.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/PodRailFace.tsx`
- Modify: `packages/desktop/src/renderer/mafw/pod-rail-face-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/pod-rail-badge.ts`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/src/renderer/mafw/pod-rail-face-model.test.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-rail-badge.test.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-model.test.ts`

**Interfaces:**
- Consumes: Tasks 11–12.
- Produces:

```ts
// pod-rail-badge.ts
export function podRailBadge(input: { attention: PodAttentionItem[]; unread: number }): number
// pod-rail-face-model.ts
export function railView(detail: PodDetailView): {
  todoCount: number
  todoItems: PodTask[]
  reviewCount: number
  recentResults: PodGoal[]
}
// pod-model.ts
export function goalQueueRow(goal: Pick<PodGoal, 'title' | 'verdict' | 'stage'>): string
```

- [ ] **Step 1: Write failing tests**

```ts
test('rail badge counts attention only, not unread or resultReady', () => {
  expect(podRailBadge({ attention: [{}, {}], unread: 5 })).toBe(2)
})
test('goal queue renders title and true verdicts', () => {
  expect(goalQueueRow({ title: 'Fix Pod', verdict: 'MAX_RETRIES' })).toBe('Fix Pod · 达到轮次上限')
  expect(goalQueueRow({ title: 'Bad', verdict: 'FAIL' })).not.toContain('完成')
})
test('counts equal the filtered items they open', () => {
  const view = railView(detailWith({ attention: 2, notes: 1, planTasks: 3 }))
  expect(view.todoCount).toBe(view.todoItems.length)
})
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -w @mafw/desktop`
Expected: FAIL.

- [ ] **Step 3: Implement UI**

PodDock gets local `工作 / 团队 / 记忆` tabs (not a long single scroll). “工作” face: Goal composer; attention list; current Goal title/stage/action; plan tasks for selected active Goal; recent results; notes. Team face keeps members/sessions/inbox and mailbox health; memory face keeps project memory. `PodTaskBoard` removes five-lane mixed board: plan tasks only for current Goal, notes separate, external requests labelled; edit/delete visibility uses kind + editable stage, not click-then-409. Result panel shows verdict, original Goal acceptance, per-task rubric/evidence, artifacts, feedback; parse failure shows a warning, not a PASS. For terminal FAIL/MAX_RETRIES/ERROR, a “基于失败反馈重新提交” action opens the composer prefilled with the original title and review feedback as objective; it creates a new Goal, never revives the old one. Rail face shows attention first, current Goal title/stage, team working/reviewing, recent results; no raw IDs/agent names; unread separate. Badge only attention. Add CSS for new sections, preserving theme tokens and reduced motion.

- [ ] **Step 4: Run tests, typecheck and build**

Run: `npm test -w @mafw/desktop`
Expected: PASS.
Run: `cd packages/desktop; npx tsgo --noEmit -p tsconfig.json; npx electron-vite build`
Expected: rc=0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/PodAttentionList.tsx packages/desktop/src/renderer/mafw/components/PodResultPanel.tsx packages/desktop/src/renderer/mafw/components/PodDock.tsx packages/desktop/src/renderer/mafw/components/PodTaskBoard.tsx packages/desktop/src/renderer/mafw/components/PodRailFace.tsx packages/desktop/src/renderer/mafw/components/PodGoalQueue.tsx packages/desktop/src/renderer/mafw/pod-rail-face-model.ts packages/desktop/src/renderer/mafw/pod-rail-face-model.test.ts packages/desktop/src/renderer/mafw/pod-rail-badge.ts packages/desktop/src/renderer/mafw/pod-rail-badge.test.ts packages/desktop/src/renderer/mafw/pod-model.test.ts packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): make pod goal and attention first"
```

---

### Task 14: Integration verification and documentation

**Files:**
- Test: `gateway/tests/integration/pod-v3.test.ts`
- Modify: `CONTEXT.md`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-11-02-pod-v3-goal-attention-design.md` only if implementation reveals a decision reversal (otherwise no edit)

**Interfaces:**
- Consumes: all previous tasks.

- [ ] **Step 1: Write the failing end-to-end test**

Create a temp registered project and actual gateway Pod services with fake runtime. Assert:

```ts
test('goal -> plan approval -> pause -> resume -> terminal failure -> next queued goal', async () => {
  const created = await createPodGoal(podId, { title: 'First', objective: '...', planReview: 'manual' })
  expect(stage('First').kind).toBe('plan_approval')
  await pause(podId)
  await approve(goalId, approvalId)
  expect(state(goalId).nextAction).toBe('NEXT_execute')
  await resume(podId)
  await driveToReview(goalId, 'FAIL', 'MAX_RETRIES')
  expect(view(goalId)).toMatchObject({ verdict: 'MAX_RETRIES', resultReady: true })
  expect((await createPodGoal(podId, secondGoal)).status).toBe('started')
})
```

- [ ] **Step 2: Run it to verify failure**

Run: `cd gateway; npx jest tests/integration/pod-v3.test.ts --runInBand`
Expected: FAIL before final wiring is complete.

- [ ] **Step 3: Fix integration gaps and document**

Update `CONTEXT.md` Pod section with: Goal as only executable user work, notes, true verdicts, pause semantics, attention categories. Add one AGENTS.md batch entry with commits, tests, typecheck/build. Do not claim deployment or release.

- [ ] **Step 4: Run full verification**

Run: `cd gateway; npx tsc --noEmit`
Expected: rc=0.
Run: `cd gateway; npm test -- --runInBand --forceExit`
Expected: all suites/tests PASS.
Run: `npm test -w @mafw/desktop`
Expected: all tests PASS.
Run: `cd packages/desktop; npx tsgo --noEmit -p tsconfig.json; npx electron-vite build`
Expected: rc=0.
Run: `cd packages/gateway-sdk; npm test; npm run build`
Expected: all PASS, build rc=0.
Run: `cd gateway; npx jest tests/unit/api-contract.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/integration/pod-v3.test.ts CONTEXT.md AGENTS.md
git commit -m "test(pod): verify v3 goal and attention lifecycle"
```

---

## Self-Review

- Spec coverage:
  - Goal intake/composer → Tasks 3, 12.
  - Stage/attention/DTO/verdict → Tasks 1, 2, 11, 13.
  - Pause/cancel/resume → Tasks 4, 10.
  - Task kinds/notes/results → Tasks 5, 13.
  - Delivery correctness → Task 6.
  - Plan schema/skipped/memory/notify → Tasks 7, 8.
  - Failure classification/attempt/no-progress/approval/answer → Tasks 9, 10.
  - Attention badge vs unread/results, tabs and resubmit flow → Task 13.
  - Message health (without Goal attention) → Task 6.
  - Contracts/UI/docs → Tasks 11–14.
- Type consistency: `PodGoalVerdict`, `PodGoalStage`, `PodGoalStageInput`, `PodGoalDescription`, `PodGoalView`, `PodDetailView`, `PodEnqueueResult`, `PodTaskKind`, `PodGoalResult`, `PodMessageDeliveryRow`, `PodCreateGoalInput`, `PodCreateGoalResult`, `lastFailure`, `approvalId`, `resumeNode`, `consumedByRunId` are defined before consumers.
- Review Focus mappings:
  - stale approval → Task 10.
  - paused answer → Tasks 4, 10.
  - broadcast fan-out → Task 6.
  - failed/count contradictions → Tasks 1, 2, 13.
  - malformed state/evidence → Tasks 1, 5, 13.
