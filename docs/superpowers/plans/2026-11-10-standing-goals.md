# Standing Goals (P2.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a Goal a long-lived intent with triggers, run history, budget and Tech Lead triage: every cron/event/manual trigger creates a `GoalRun`, and the Tech Lead decides `goal` / `report` / `action` / `skip`.

**Architecture:** Persist `standing_goals`, `goal_runs` and `goal_run_events` in the shared gateway SQLite database. `StandingGoalService` owns lifecycle, registration with `AutomationEngine` and the P2.4 event layer, dedupe/budget/concurrency, and run execution. `goal` / `report` runs reuse the normal `PodTechLeadService` + `PodGoalService` path; `action` runs use a whitelist executor; `skip` only records.

**Tech Stack:** TypeScript, better-sqlite3, `AutomationEngine` cron rules, P2.4 `EventLayerService`, existing `PodTechLeadService` / `PodGoalService`, SDK / SolidJS desktop.

**Spec:** `docs/superpowers/specs/2026-11-10-standing-goals-design.md`
**Prerequisite:** `docs/superpowers/plans/2026-11-10-event-layer.md` (P2.4). Cron/manual runs must work with the event layer off.

## Global Constraints

- `MAFW_STANDING_GOALS` defaults **off**; routes and MCP tools return `503` / disabled result when off.
- `goal` and `report` are **normal Goals** (`pod_goals` + revision + NodeDriver); no second execution path.
- `report` uses `taskType: 'research'` and must not produce code diffs.
- `action` is a bounded whitelist (`comment` / `label` / `notify`); it does not create a Goal and cannot merge/close/delete.
- High-risk actions always `confirm`; `requiresApproval` may only tighten policy.
- Lead never decides the type; Tech Lead triage decides the run mode.
- Concurrency defaults to 1; same `triggerKey` / open run must not create a second run.
- Budget: per-run and per-day; exhaustion pauses the Standing Goal and raises person attention, never silently drops.
- No cross-project Standing Goals.
- Never show session ids in user-facing UI.

## Review Focus

1. A duplicate GitHub/cron trigger must not create two `GoalRun`s — the unique `trigger_key` and open-run check must both hold.
2. `report` must not accidentally run the code path with a worktree diff — it must be a Goal with `taskType: 'research'`.
3. Budget exhaustion must stop future runs and surface person attention — not just fail one run silently.
4. A `skip` decision must be auditable with a rationale and must not create a session or Goal.
5. Pause must stop future triggers immediately and survive restart; resume must re-register without duplicating cron/event subscriptions.

---

### Task 1: Types and SQLite store

**Files:**
- Create: `gateway/src/core/standing/standing-types.ts`
- Create: `gateway/src/core/standing/standing-store.ts`
- Modify: `gateway/src/memory/gateway-db.ts` (constructor schema block)
- Test: `gateway/tests/unit/standing/standing-store.test.ts`

**Interfaces:**
- Produces:
```ts
export type StandingState = 'active' | 'paused' | 'stopped'
export type StandingRunMode = 'goal' | 'report' | 'action' | 'skip'
export type StandingRunStatus = 'queued' | 'triaging' | 'running' | 'waiting_person' | 'done' | 'failed' | 'skipped'
export type StandingTriggerType = 'cron' | 'event' | 'manual'

export class StandingGoalError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}

export interface StandingTrigger {
  id: string
  type: StandingTriggerType
  schedule?: string
  timezone?: string
  eventKinds?: string[]
  filter?: Record<string, unknown>
}
export interface StandingTemplate {
  taskType?: 'feature' | 'bug' | 'research' | 'refactor' | 'ops'
  acceptance?: string[]
  boundaries?: string[]
  planReview?: 'auto' | 'manual'
}
export interface StandingBudget {
  perRunTurns?: number
  perRunCostUsd?: number
  perDayCostUsd?: number
}
export interface StandingGoal {
  id: string; projectDir: string; title: string; objective: string
  template: StandingTemplate; triggers: StandingTrigger[]; state: StandingState
  concurrency: number; cooldownMs: number; budget: StandingBudget
  approval: 'auto' | 'plan' | 'confirm'
  createdBy: string | null; createdAt: string; updatedAt: string
  lastRunAt: string | null; nextRunAt: string | null
}
export interface GoalRun {
  id: string; standingGoalId: string; triggerType: StandingTriggerType
  triggerKey: string; payload: Record<string, unknown>; status: StandingRunStatus
  mode: StandingRunMode | null; rationale: string | null
  goalId: string | null; sessionId: string | null; worktree: string | null
  result: Record<string, unknown> | null; costUsd: number | null; tokens: number | null
  startedAt: string | null; endedAt: string | null
}

export class StandingGoalStore {
  constructor(db: import('better-sqlite3').Database)
  insertGoal(input: Omit<StandingGoal, 'createdAt' | 'updatedAt' | 'lastRunAt' | 'nextRunAt'> & { now: string }): StandingGoal
  getGoal(id: string): StandingGoal | null
  listGoals(projectDir: string): StandingGoal[]
  updateGoal(id: string, patch: Partial<Pick<StandingGoal, 'title' | 'objective' | 'template' | 'triggers' | 'concurrency' | 'cooldownMs' | 'budget' | 'approval' | 'nextRunAt'>>, now: string): StandingGoal
  setGoalState(id: string, state: StandingState, now: string): StandingGoal
  insertRun(input: Omit<GoalRun, 'startedAt' | 'endedAt'> & { now: string }): GoalRun
  getRun(id: string): GoalRun | null
  listRuns(standingGoalId: string, limit?: number): GoalRun[]
  updateRun(id: string, patch: Partial<Pick<GoalRun, 'status' | 'mode' | 'rationale' | 'goalId' | 'sessionId' | 'worktree' | 'result' | 'costUsd' | 'tokens' | 'startedAt' | 'endedAt'>>): GoalRun
  findRunByTriggerKey(standingGoalId: string, triggerKey: string): GoalRun | null
  findRunByGoalId(goalId: string): GoalRun | null
  listRunsForDay(projectDir: string, dayStartIso: string): GoalRun[]
  appendRunEvent(runId: string, type: string, payload: Record<string, unknown>, now: string): void
}
```
- Tables: `standing_goals`, `goal_runs` (UNIQUE `trigger_key`), `goal_run_events`; index `(standing_goal_id, created_at desc)`.

- [ ] **Step 1: Write the failing store test**

```ts
test('stores a standing goal and dedupes runs by trigger key', () => {
  const db = new Database(':memory:')
  const store = new StandingGoalStore(db)
  const goal = store.insertGoal({
    id: 'sg1', projectDir: '/p', title: 'Review PRs', objective: 'Review every PR',
    template: { taskType: 'research' }, triggers: [{ id: 'cron1', type: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Shanghai' }],
    state: 'active', concurrency: 1, cooldownMs: 60_000,
    budget: { perRunCostUsd: 1, perDayCostUsd: 5 }, approval: 'plan', createdBy: null,
    now: '2026-11-10T00:00:00.000Z',
  })
  expect(store.getGoal('sg1')).toMatchObject({ title: 'Review PRs', state: 'active' })
  store.insertRun({ id: 'r1', standingGoalId: goal.id, triggerType: 'cron', triggerKey: 'sg1:cron:2026-11-10T01:00:00.000Z', payload: {}, status: 'queued', mode: null, rationale: null, goalId: null, sessionId: null, worktree: null, result: null, costUsd: null, tokens: null, now: '2026-11-10T01:00:01.000Z' })
  expect(store.findRunByTriggerKey('sg1', 'sg1:cron:2026-11-10T01:00:00.000Z')?.id).toBe('r1')
  expect(() => store.insertRun({ ..., id: 'r2' })).toThrow()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/standing/standing-store.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the schema and store implementation**

Add the three tables via an exported `ensureStandingSchema(db)` helper in `standing-store.ts`; call it from both the store constructor and `GatewayDatabase` so tests and a fresh gateway DB agree. Keep JSON columns for `template`, `triggers`, `payload`, `result`. `insertRun` uses the UNIQUE `trigger_key` constraint; the caller handles the duplicate error as a dedupe signal.

- [ ] **Step 4: Run test to verify it passes**

Run: same command; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/standing/standing-types.ts gateway/src/core/standing/standing-store.ts gateway/src/memory/gateway-db.ts gateway/tests/unit/standing/standing-store.test.ts
git commit -m "feat(standing): add standing goal and run store"
```

---

### Task 2: Triggers, dedupe and budget admission

**Files:**
- Create: `gateway/src/core/standing/standing-triggers.ts`
- Test: `gateway/tests/unit/standing/standing-triggers.test.ts`

**Interfaces:**
- Produces:
```ts
export function parseStandingTriggers(value: unknown): StandingTrigger[]
export function triggerKeyFor(input: {
  standingGoalId: string
  trigger: StandingTrigger
  scheduledAt?: string
  eventId?: string
  manualId?: string
}): string
export function canStartRun(input: {
  goal: StandingGoal
  openRuns: GoalRun[]
  todayCostUsd: number
  now: string
}): { ok: true } | { ok: false; reason: 'concurrency' | 'budget' | 'cooldown'; message: string }
```

- [ ] **Step 1: Write failing tests**

```ts
test('builds stable keys for cron and event triggers', () => {
  expect(triggerKeyFor({ standingGoalId: 'sg1', trigger: { id: 'c1', type: 'cron' }, scheduledAt: '2026-11-10T01:00:00.000Z' }))
    .toBe('sg1:cron:2026-11-10T01:00:00.000Z')
  expect(triggerKeyFor({ standingGoalId: 'sg1', trigger: { id: 'e1', type: 'event' }, eventId: 'd1' }))
    .toBe('sg1:event:d1')
})

test('blocks concurrency and daily budget', () => {
  const goal = standingGoal({ concurrency: 1, budget: { perDayCostUsd: 2 } })
  expect(canStartRun({ goal, openRuns: [goalRun({ id: 'r1', status: 'running' })], todayCostUsd: 0, now: '2026-11-10T00:00:00.000Z' }))
    .toMatchObject({ ok: false, reason: 'concurrency' })
  expect(canStartRun({ goal, openRuns: [], todayCostUsd: 2, now: '2026-11-10T00:00:00.000Z' }))
    .toMatchObject({ ok: false, reason: 'budget' })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/standing/standing-triggers.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement parsing, keys and admission**

Validate `cron` (schedule + timezone required), `event` (at least one kind), `manual` (no schedule). Reject unknown trigger types with a `StandingGoalError` status 400. Cooldown uses `goal.cooldownMs` compared with the latest run's `startedAt`; concurrency counts `queued/triaging/running/waiting_person`; budget uses `todayCostUsd + (latest open run cost ?? 0)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: same command; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/standing/standing-triggers.ts gateway/tests/unit/standing/standing-triggers.test.ts
git commit -m "feat(standing): parse triggers and enforce admission"
```

---

### Task 3: Triage contract and prompt

**Files:**
- Create: `gateway/src/core/standing/standing-triage.ts`
- Test: `gateway/tests/unit/standing/standing-triage.test.ts`

**Interfaces:**
- Produces:
```ts
export type StandingAction =
  | { type: 'comment'; payload: { body: string; target: string } }
  | { type: 'label'; payload: { target: string; label: string } }
  | { type: 'notify'; payload: { title: string; body: string } }

export interface RunTriage {
  mode: StandingRunMode
  rationale: string
  scope?: string
  requiresApproval?: boolean
  dedupeWithRunId?: string
  action?: StandingAction
}
export function buildStandingTriagePrompt(input: {
  standingGoal: StandingGoal
  trigger: StandingTrigger
  payload: Record<string, unknown>
  recentRuns: GoalRun[]
}): string
export function validateRunTriage(value: unknown): RunTriage
```

- [ ] **Step 1: Write failing tests**

```ts
test('accepts a goal triage and rejects an unknown mode', () => {
  expect(validateRunTriage({ mode: 'goal', rationale: 'new PR' })).toMatchObject({ mode: 'goal' })
  expect(() => validateRunTriage({ mode: 'auto', rationale: 'x' })).toThrow()
})

test('action mode requires a whitelisted action payload', () => {
  expect(validateRunTriage({ mode: 'action', rationale: 'reply', action: { type: 'comment', payload: { body: 'hi', target: 'acme/app#42' } } }))
    .toMatchObject({ mode: 'action' })
  expect(() => validateRunTriage({ mode: 'action', rationale: 'merge', action: { type: 'merge', payload: {} } })).toThrow()
})

test('prompt includes objective, trigger and recent skip reasons', () => {
  const prompt = buildStandingTriagePrompt({ standingGoal, trigger, payload: { number: 42 }, recentRuns: [goalRun({ mode: 'skip', rationale: 'duplicate' })] })
  expect(prompt).toContain('Review every PR')
  expect(prompt).toContain('pr_opened')
  expect(prompt).toContain('duplicate')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/standing/standing-triage.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement prompt and validator**

Prompt sections: `[STANDING GOAL]`, `[TRIGGER]`, `[RECENT RUNS]`, `[BUDGET / APPROVAL]`, ending with “Return JSON only”. Validate `mode` in `goal|report|action|skip`; `rationale` 1–200 chars; `action.type` in `comment|label|notify`; reject `merge|close|delete`; `requiresApproval` may only be `true` (never false when policy requires confirm).

- [ ] **Step 4: Run tests to verify they pass**

Run: same command; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/standing/standing-triage.ts gateway/tests/unit/standing/standing-triage.test.ts
git commit -m "feat(standing): define run triage contract and prompt"
```

---

### Task 4: Service lifecycle and cron registration

**Files:**
- Create: `gateway/src/core/standing/standing-service.ts`
- Modify: `gateway/src/automation-engine.ts` (public standing cron registration)
- Test: `gateway/tests/unit/standing/standing-service.test.ts`

**Interfaces:**
- Consumes: store, triggers, triage.
- Produces:
```ts
export interface StandingGoalServiceDeps {
  store: StandingGoalStore
  now(): string
  newId(prefix: string): string
  registerCron(input: { key: string; schedule: string; timezone: string; standingGoalId: string; triggerId: string }): Promise<{ nextRunAt: string | null }> | { nextRunAt: string | null }
  unregisterCron(key: string): Promise<void> | void
  enabled(): boolean
  log?(message: string): void
  broadcast(event: { type: string; properties?: Record<string, unknown> }): void
}
export class StandingGoalService {
  constructor(deps: StandingGoalServiceDeps)
  create(input: { projectDir: string; title: string; objective: string; template: StandingTemplate; triggers: unknown; concurrency?: number; cooldownMs?: number; budget?: StandingBudget; approval?: StandingGoal['approval']; createdBy?: string | null }): StandingGoal
  update(id: string, patch: Partial<Pick<StandingGoal, 'title' | 'objective' | 'template' | 'triggers' | 'concurrency' | 'cooldownMs' | 'budget' | 'approval'>>): StandingGoal
  list(projectDir: string): StandingGoal[]
  listRuns(standingGoalId: string, limit?: number): GoalRun[]
  pause(id: string): StandingGoal
  resume(id: string): StandingGoal
  stop(id: string): StandingGoal
  reconcile(): Promise<void>
}
```
- `AutomationEngine` gains:
```ts
registerStandingCron(input: { key: string; schedule: string; timezone: string; standingGoalId: string; triggerId: string }): void
unregisterStandingCron(key: string): void
```
  implemented with the existing `draftRule` / `toggleRule` / `deleteRule` and action type `standing_goal:tick`.

- [ ] **Step 1: Write failing tests**

```ts
test('create registers cron keys and pause unregisters them', async () => {
  const h = harness()
  const goal = h.service.create({
    projectDir: '/p', title: 'Daily report', objective: 'Report',
    template: { taskType: 'research' },
    triggers: [{ id: 'c1', type: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Shanghai' }],
  })
  expect(h.registerCron).toHaveBeenCalledWith(expect.objectContaining({ key: 'standing-goal:sg1:c1' }))
  h.service.pause(goal.id)
  expect(h.unregisterCron).toHaveBeenCalledWith('standing-goal:sg1:c1')
  expect(h.store.getGoal(goal.id)?.state).toBe('paused')
})

test('resume re-registers and reconcile repairs missing jobs', async () => {
  const h = harness()
  const goal = h.service.create({ ...base, triggers: [cronTrigger] })
  h.service.pause(goal.id)
  h.service.resume(goal.id)
  h.service.reconcile()
  expect(h.registerCron).toHaveBeenCalledTimes(3)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/standing/standing-service.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement lifecycle and registration**

`create` validates triggers, persists `active`, and registers each cron trigger with key `standing-goal:<id>:<triggerId>`; the returned `nextRunAt` is stored on the goal. `pause`/`stop` unregister all keys; `resume` registers again and refreshes `nextRunAt`. `reconcile` lists all goals and ensures active cron jobs exist / paused-stopped jobs are removed. Event triggers are no-ops in this task (wired in Task 7).

- [ ] **Step 4: Run tests to verify they pass**

Run: same command; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/standing/standing-service.ts gateway/src/automation-engine.ts gateway/tests/unit/standing/standing-service.test.ts
git commit -m "feat(standing): add lifecycle and cron registration"
```

---

### Task 5: Run lifecycle — goal and report

**Files:**
- Modify: `gateway/src/core/standing/standing-service.ts`
- Test: `gateway/tests/unit/standing/standing-runs.test.ts`

**Interfaces:**
- `StandingGoalServiceDeps` gains:
```ts
createTriage(input: { standingGoal: StandingGoal; trigger: StandingTrigger; payload: Record<string, unknown>; recentRuns: GoalRun[] }): Promise<{ sessionId: string; output: unknown }>
createGoal(input: { standingGoal: StandingGoal; run: GoalRun; mode: 'goal' | 'report'; triage: RunTriage }): Promise<{ goalId: string }>
```
- `StandingGoalService` gains:
```ts
runNow(id: string, payload?: Record<string, unknown>, trigger?: StandingTrigger): Promise<GoalRun | null>
handleCronTick(standingGoalId: string, scheduledAt: string, triggerId?: string): Promise<GoalRun | null>
onGoalFinished(goalId: string, outcome: { status: 'done' | 'failed'; costUsd?: number; tokens?: number; result?: Record<string, unknown> }): Promise<void>
```

- [ ] **Step 1: Write failing tests**

```ts
test('cron tick creates one run, triages goal, and creates a normal Goal', async () => {
  const h = harness()
  const goal = h.service.create({ ...base, triggers: [cronTrigger] })
  const run = await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z')
  expect(run).toMatchObject({ status: 'running', mode: 'goal', goalId: 'g1' })
  expect(h.createGoal).toHaveBeenCalledWith(expect.objectContaining({ mode: 'goal' }))
  expect(h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z')).resolves.toBeNull()
})

test('report mode passes research task type, not a code worktree', async () => {
  const h = harness({ triage: { mode: 'report', rationale: 'summary only' } })
  const goal = h.service.create({ ...base, triggers: [cronTrigger] })
  await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z')
  expect(h.createGoal.mock.calls[0][0].mode).toBe('report')
  expect(h.createGoal.mock.calls[0][0].standingGoal.template.taskType).toBe('research')
})

test('concurrency and duplicate trigger create no second run', async () => {
  const h = harness()
  const goal = h.service.create({ ...base, triggers: [cronTrigger] })
  const first = await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z')
  const second = await h.service.handleCronTick(goal.id, '2026-11-10T02:00:00.000Z')
  expect(first).not.toBeNull()
  expect(second).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/standing/standing-runs.test.ts --runInBand --forceExit`
Expected: FAIL — `runNow` / `handleCronTick` not defined.

- [ ] **Step 3: Implement the run lifecycle**

`runNow` checks `canStartRun`, inserts a `queued` run with the trigger key, appends `created`, broadcasts `goal_run.created`, then executes asynchronously: set `triaging`, append `triaged` after validation, call `createTriage`, set `mode`/`rationale`; `skip` → `skipped` + `skipped` audit; `goal`/`report` → `createGoal`, set `running` + `started` audit; `action` → Task 6. If admission fails with `budget`, call `pause(goal.id)` and broadcast `goal_run.budget_exhausted` before returning `null`; `concurrency`/`cooldown` return `null` without pausing. Catch triage failures as `failed` with `lastError` in `result` and a `failed` audit event. `onGoalFinished` updates cost/tokens/result/status, sets `lastRunAt`, appends `finished`, and broadcasts `goal_run.finished`.

- [ ] **Step 4: Run tests to verify they pass**

Run: same command; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/standing/standing-service.ts gateway/tests/unit/standing/standing-runs.test.ts
git commit -m "feat(standing): run triage and create goal/report runs"
```

---

### Task 6: Action mode, skip and approval gate

**Files:**
- Create: `gateway/src/core/standing/standing-actions.ts`
- Modify: `gateway/src/core/standing/standing-service.ts`
- Test: `gateway/tests/unit/standing/standing-actions.test.ts`

**Interfaces:**
- Produces:
```ts
export interface StandingActionDeps {
  notify(input: { title: string; body: string }): Promise<void> | void
  comment(input: { target: string; body: string }): Promise<void> | void
  label(input: { target: string; label: string }): Promise<void> | void
  enabled(): boolean
}
export class StandingActionExecutor {
  constructor(deps: StandingActionDeps)
  execute(action: StandingAction): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }>
}
```
- `StandingGoalServiceDeps` gains `executeAction(action: StandingAction): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }>`.
- `StandingGoalService` gains `approveRun(runId: string): Promise<GoalRun>`.

- [ ] **Step 1: Write failing tests**

```ts
test('notify executes; merge/close/delete are rejected', async () => {
  const exec = new StandingActionExecutor({ notify: jest.fn(), comment: jest.fn(), label: jest.fn(), enabled: () => true })
  expect(await exec.execute({ type: 'notify', payload: { title: 'PR', body: 'new' } })).toMatchObject({ ok: true })
  expect(await exec.execute({ type: 'comment', payload: { target: 'acme/app#1', body: 'hi' } })).toMatchObject({ ok: true })
  expect(await exec.execute({ type: 'merge' as any, payload: {} } as any)).toMatchObject({ ok: false })
})

test('requiresApproval moves action run to waiting_person', async () => {
  const h = harness({ triage: { mode: 'action', rationale: 'reply', requiresApproval: true, action: { type: 'comment', payload: { target: 'acme/app#1', body: 'hi' } } } })
  const goal = h.service.create({ ...base, triggers: [cronTrigger] })
  const run = await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z')
  expect(run).toMatchObject({ status: 'waiting_person', mode: 'action' })
  expect(h.executeAction).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/standing/standing-actions.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the whitelist and approval flow**

Action executor accepts only `comment|label|notify`; any other type returns `{ ok: false, error: 'action not allowed' }`. `notify` broadcasts a system notification through the injected dep. `comment`/`label` require a connected GitHub source with a token; when unavailable the executor returns `{ ok: false, error: 'github source unavailable' }` and the run is marked `failed` with the error visible. `StandingGoalService` sets `waiting_person` when `requiresApproval` is true or `standingGoal.approval === 'confirm'`, storing `result: { pendingTriage: triage }` and broadcasting `goal_run.needs_person`. `approveRun` executes the pending action or resumes the pending `goal`/`report` creation; it returns `409` when the run is not `waiting_person`. `skip` does not call the executor. Three consecutive `failed` runs in the same day also set the Standing Goal to `paused` and broadcast `goal_run.needs_person`.

- [ ] **Step 4: Run tests to verify they pass**

Run: same command; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/standing/standing-actions.ts gateway/src/core/standing/standing-service.ts gateway/tests/unit/standing/standing-actions.test.ts
git commit -m "feat(standing): add action whitelist and approval gate"
```

---

### Task 7: Event layer integration

**Files:**
- Modify: `gateway/src/core/standing/standing-service.ts`
- Modify: `gateway/src/index.ts` (wire event delivery callback)
- Test: `gateway/tests/unit/standing/standing-events.test.ts`

**Interfaces:**
- `StandingGoalServiceDeps` gains:
```ts
subscribeEvents(input: { standingGoal: StandingGoal; trigger: StandingTrigger }): Promise<void> | void
unsubscribeEvents(standingGoalId: string): Promise<void> | void
```
- `StandingGoalService` gains:
```ts
handleEventTrigger(standingGoalId: string, input: { triggerKey: string; payload: Record<string, unknown>; eventId: string }): Promise<GoalRun | null>
```
- Index wiring: P2.4 `EventLayerService` work delivery calls `standingGoalService.handleEventTrigger` with the run's `triggerKey`.

- [ ] **Step 1: Write failing tests**

```ts
test('event subscription creates a run only for work mode', async () => {
  const h = harness()
  const goal = h.service.create({ ...base, triggers: [{ id: 'e1', type: 'event', eventKinds: ['pr_opened'] }] })
  expect(h.subscribeEvents).toHaveBeenCalledTimes(1)
  const run = await h.service.handleEventTrigger(goal.id, { triggerKey: 'sg1:event:d1', eventId: 'd1', payload: { number: 42 } })
  expect(run).toMatchObject({ triggerType: 'event', status: 'running' })
  expect(h.service.handleEventTrigger(goal.id, { triggerKey: 'sg1:event:d1', eventId: 'd1', payload: {} })).resolves.toBeNull()
})

test('event layer off leaves cron/manual working', async () => {
  const h = harness({ eventLayerEnabled: false })
  const goal = h.service.create({ ...base, triggers: [{ id: 'e1', type: 'event', eventKinds: ['pr_opened'] }] })
  expect(h.subscribeEvents).not.toHaveBeenCalled()
  expect(await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z')).toMatchObject({ status: 'running' })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/standing/standing-events.test.ts --runInBand --forceExit`
Expected: FAIL — `handleEventTrigger` not defined.

- [ ] **Step 3: Implement event registration and trigger handling**

For each `event` trigger, subscribe a `work` subscription with `subscriberType: 'standing_goal'`, `subscriberId: standingGoal.id`, filtering on `eventKinds` in the event layer. `handleEventTrigger` uses the supplied `triggerKey`, checks `findRunByTriggerKey` and `canStartRun`, then calls `runNow` with the event payload. Pause/stop unsubscribes; resume/reconcile re-subscribes. The event layer's `deliverWork` callback only fires for `work`, so `context` never creates a run.

- [ ] **Step 4: Run tests to verify they pass**

Run: same command; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/standing/standing-service.ts gateway/src/index.ts gateway/tests/unit/standing/standing-events.test.ts
git commit -m "feat(standing): consume work subscriptions from the event layer"
```

---

### Task 8: Routes, MCP tools and approval

**Files:**
- Create: `gateway/src/routes/standing-goals.ts`
- Create: `gateway/src/mcp/handlers/standing-goals.ts`
- Modify: `gateway/src/routes/route-catalog.ts`, `gateway/src/mcp/tool-registry.ts`, `gateway/src/index.ts`
- Test: `gateway/tests/unit/routes/standing-goals.test.ts`, `gateway/tests/unit/mcp/standing-goals.test.ts`

**Interfaces:**
- HTTP:
```ts
GET  /api/standing-goals?projectDir=
POST /api/standing-goals
PATCH /api/standing-goals/:id
GET  /api/standing-goals/:id/runs
POST /api/standing-goals/:id/pause
POST /api/standing-goals/:id/resume
POST /api/standing-goals/:id/stop
POST /api/standing-goals/:id/run
POST /api/goal-runs/:id/approve
```
- Operation ids: `standingGoals.list`, `standingGoals.create`, `standingGoals.update`, `standingGoals.runs`, `standingGoals.pause`, `standingGoals.resume`, `standingGoals.stop`, `standingGoals.run`, `goalRuns.approve`.
- MCP: `mafw_create_standing_goal`, `mafw_update_standing_goal`, `mafw_list_standing_goals`, `mafw_run_standing_goal`.
- `POST /api/goal-runs/:id/approve` resumes a `waiting_person` run: approved action runs execute the action; approved `goal`/`report` runs continue to `createGoal`.

- [ ] **Step 1: Write failing route tests**

```ts
test('returns 503 when standing goals are off', () => {
  expect(handleListStandingGoals({ projectDir: '/p' }, deps({ enabled: () => false })).status).toBe(503)
})

test('create validates cron and returns the stored goal', () => {
  const out = handleCreateStandingGoal({ projectDir: '/p', title: 'Daily', objective: 'Report', triggers: [{ id: 'c1', type: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Shanghai' }] }, deps())
  expect(out.status).toBe(200)
  expect(out.body.goal).toMatchObject({ title: 'Daily', state: 'active' })
})

test('approve rejects a run that is not waiting_person', () => {
  expect(handleApproveRun({ id: 'r1' }, deps({ run: () => ({ status: 'running' }) })).status).toBe(409)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/routes/standing-goals.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement handlers, catalog, MCP and wiring**

Add route catalog entries and MCP tool schemas. Wire `StandingGoalService` in `MafwScheduler.start()` after `PodTechLeadService` / `PodGoalService` / `EventLayerService`. The `createGoal` adapter:
1. `podTechLeadService.createGoal({ podId, projectDir, title, objective, template fields, handoff: 'none', budget: perRun })`
2. `podStore.setGoalRevisionStatus({ podId, goalId, revision, status: 'planning', now })`
3. `podGoalService.admitReadyGoal(goalId, projectDir)`
4. Return `{ goalId }`.

The triage adapter creates an internal session, sends `buildStandingTriagePrompt`, parses the last JSON object from the output, and deletes the session when triage is done. Register the `standing_goal:tick` action with the automation engine; it calls `handleCronTick`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix gateway -- tests/unit/routes/standing-goals.test.ts tests/unit/mcp/standing-goals.test.ts --runInBand --forceExit`; Expected: PASS.
Run: `cd gateway && npx ts-node --project tsconfig.json scripts/emit-openapi.ts`; Expected: contract regenerated.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/standing-goals.ts gateway/src/mcp/handlers/standing-goals.ts gateway/src/routes/route-catalog.ts gateway/src/mcp/tool-registry.ts gateway/src/index.ts gateway/tests/unit/routes/standing-goals.test.ts gateway/tests/unit/mcp/standing-goals.test.ts packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts
git commit -m "feat(standing): expose HTTP and MCP surfaces"
```

---

### Task 9: SDK, preload and Standing Goals panel

**Files:**
- Modify: `packages/gateway-sdk/src/types.ts`, `packages/gateway-sdk/src/client.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`, `packages/desktop/src/preload/mafw-api.ts`
- Create: `packages/desktop/src/renderer/mafw/components/StandingGoalsPanel.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx`
- Test: `packages/desktop/tests/standing-goals-wiring.test.ts`

**Interfaces:**
- SDK namespace:
```ts
standingGoals: {
  list(input?: { projectDir?: string }): Promise<{ items: StandingGoalView[] }>
  create(input: StandingGoalCreateInput): Promise<{ goal: StandingGoalView }>
  update(id: string, patch: StandingGoalUpdateInput): Promise<{ goal: StandingGoalView }>
  runs(id: string): Promise<{ items: GoalRunView[] }>
  pause(id: string): Promise<{ goal: StandingGoalView }>
  resume(id: string): Promise<{ goal: StandingGoalView }>
  stop(id: string): Promise<{ goal: StandingGoalView }>
  run(id: string): Promise<{ run: GoalRunView }>
  approveRun(id: string): Promise<{ run: GoalRunView }>
}
```

- [ ] **Step 1: Write failing wiring test**

```ts
test('standing goals panel shows one row and run history without session ids', () => {
  const source = read('../src/renderer/mafw/components/StandingGoalsPanel.tsx')
  assert.match(source, /standingGoals\.list/)
  assert.match(source, /standingGoals\.runs/)
  assert.match(source, /next run/i)
  assert.doesNotMatch(source, /ses_[a-zA-Z0-9]+/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix packages/desktop 2>&1 | Select-Object -Last 8`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement SDK/preload and the panel**

`StandingGoalsPanel` lists one row per Standing Goal with title, state, last/next run, success rate, and a run-history expander. Actions: pause/resume/stop/run now; each run shows mode/status/rationale/cost and an “open goal” link when `goalId` exists. Render it in `ProjectWorkView` above `WorkPriorityList`; empty state: “还没有长效目标”.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix packages/desktop 2>&1 | Select-Object -Last 8`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.ts packages/desktop/src/preload/mafw-types.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/src/renderer/mafw/components/StandingGoalsPanel.tsx packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx packages/desktop/tests/standing-goals-wiring.test.ts
git commit -m "feat(desktop): add standing goals panel"
```

---

### Task 10: Integration, docs and release record

**Files:**
- Create: `gateway/tests/integration/standing-goals.test.ts`
- Create: `docs/architecture/standing-goals.md`
- Modify: `docs/architecture/gateway.md` (subsystem map line)
- Create: `docs/releases/2026-11-10-standing-goals.md`

- [ ] **Step 1: Write the failing integration test**

```ts
test('cron trigger -> run -> triage report -> run history', async () => {
  const h = integrationHarness()
  const goal = h.service.create({ projectDir: '/p', title: 'Daily report', objective: 'Report', template: { taskType: 'research' }, triggers: [{ id: 'c1', type: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Shanghai' }] })
  const run = await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z')
  expect(run).toMatchObject({ mode: 'report', status: 'running' })
  expect(h.createGoal).toHaveBeenCalledWith(expect.objectContaining({ mode: 'report' }))
  expect(h.service.listRuns(goal.id)[0]).toMatchObject({ triggerType: 'cron', mode: 'report' })
})

test('budget exhaustion pauses and raises attention', async () => {
  const h = integrationHarness({ cost: 10 })
  const goal = h.service.create({ ...base, budget: { perDayCostUsd: 1 } })
  await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z')
  expect(h.store.getGoal(goal.id)?.state).toBe('paused')
  expect(h.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'goal_run.budget_exhausted' }))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/integration/standing-goals.test.ts --runInBand --forceExit`
Expected: FAIL — fixture or budget behavior missing.

- [ ] **Step 3: Implement the integration fixture and docs**

Use a temp SQLite database, fake triage output, fake `createGoal`, and a fake automation engine that records cron keys. Document the lifecycle, run modes, budget/approval rules, feature flags, and that `goal`/`report` reuse the normal Goal path. Document that event triggers require P2.4 and cron/manual work with it off.

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
git add gateway/tests/integration/standing-goals.test.ts docs/architecture/standing-goals.md docs/architecture/gateway.md docs/releases/2026-11-10-standing-goals.md
git commit -m "test(standing): cover cron to report run; docs and release record"
```
