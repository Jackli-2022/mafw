# Pod Collaborative Goal Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Pod's Manager with a persistent project Lead, add a Goal-isolated Tech Lead discussion/planning role, connect Builder Spike and implementation, and close the complete Goal → result → reject → revision loop.

**Architecture:** Keep NodeDriver as the only execution-state writer. Add Pod-level discussion/revision/artifact services that submit structured facts into the existing Goal machine; hidden runtime Sessions are managed by stable role/scope mappings. The desktop uses Goal-scoped navigation and never asks the user to manage Lead or Tech Lead Sessions.

**Tech Stack:** TypeScript, Node.js, better-sqlite3, Jest (gateway/SDK), node:test + SolidJS (desktop), opencode/pi runtime contract, gateway MCP, A2A.

**Spec:** `docs/superpowers/specs/2026-11-02-pod-collaborative-goal-loop-design.md`

## Global Constraints

- Pod roster is exactly `lead | tech_lead | builder | reviewer`; remove unused `curator` from public types.
- Lead replaces Manager. Keep `manager-session` kv key and existing session storage only as internal compatibility; user-facing role is Lead.
- Lead never performs technical solution discussion and never directly implements.
- Tech Lead context is isolated per Goal and continues across revisions of the same Goal.
- Direction review is conditional: only ambiguous direction, major trade-off, or scope disagreement creates human attention.
- Default Spike mode is two-stage: Spike report → Tech Lead Plan/GoalEval → user approval → implementation.
- Full-chain approval is allowed only with explicit continuation/invalidations rules; material changes invalidate approval.
- Goal result is notified after Reviewer PASS; no extra mandatory acceptance click.
- Reject keeps the same Goal, opens a new revision, preserves all previous artifacts, and prioritizes implementation over ordinary queued Goals.
- NodeDriver is the only writer of execution state. LLM roles submit artifacts/facts, never mutate Goal state directly.
- Goal/task/Spike/context state is persisted in Pod files and explicitly injected through prompts; do not auto-write task state to harmonic memory.
- ProbeRequest/ProbeReport stay transport-neutral. V1 runs them through the internal Pod assignment; an A2A adapter can wrap the same payloads later without changing the authoritative files.
- Hidden runtime session ids are never business identity or normal-UI choices.
- Desktop is the complete interaction surface; TUI full Tech Lead UI is out of scope, but SDK/preload contracts must stay typed and in sync.
- Plan/Eval approval is bound to content hashes; changing the approved Plan or GoalEval invalidates approval.
- Every task ends with a commit. Do not combine tasks into one commit.

## Review Focus

- A casual question accidentally treated as a work Goal: expected no Builder/Spike execution, and a wrongly created Goal can be discarded without FAIL/outcome pollution.
- Rejecting a completed Goal corrupts or overwrites the old revision: expected append-only revision history and unchanged old verdict/artifacts.
- Tech Lead context crosses Goal boundaries: expected only Lead-selected explicit references can enter another Goal.
- Probe escapes its declared path/network/credential scope: expected hard refusal or human approval before the action.
- A Plan/Eval changes after approval but the old approved version still executes: expected invalidation and re-approval.

---

## Milestone 1 — Roles, revisions, hidden sessions

### Task 1: Four-role vocabulary and Lead/Tech Lead identities

**Files:**
- Modify: `gateway/src/core/pod/pod-store.ts`
- Modify: `gateway/src/core/pod/pod-service.ts`
- Modify: `gateway/src/core/pod/pod-identity.ts`
- Modify: `gateway/src/runtime/identity-registry.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/desktop/src/renderer/mafw/pod-model.ts`
- Create: `gateway/src/skills/lead-identity.ts`
- Create: `gateway/src/skills/tech-lead-identity.ts`
- Test: `gateway/tests/unit/pod/pod-roles.test.ts`
- Test: `gateway/tests/unit/runtime/identity-registry.test.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-model.test.ts`

**Interfaces:**
- Consumes: existing `PodMemberRole`, `MEMBER_SPECS`, `IdentityRegistry`.
- Produces: `PodMemberRole = 'lead' | 'tech_lead' | 'builder' | 'reviewer'`; `roleForNode(node: 'discussion'|'plan'|'probe'|'execute'|'review'): PodMemberRole`; identities `lead`, `mafw-tech-lead`; `IdentitySpec.deprecated?: boolean`; deprecated `manager` alias resolving to Lead behavior.

- [ ] **Step 1: Write the failing role and identity tests**

```ts
expect(roleForNode('discussion')).toBe('tech_lead')
expect(roleForNode('plan')).toBe('tech_lead')
expect(roleForNode('probe')).toBe('builder')
expect(roleForNode('execute')).toBe('builder')
expect(roleForNode('review')).toBe('reviewer')
expect(registry.list().map((x) => x.name)).toEqual(expect.arrayContaining(['lead', 'mafw-tech-lead']))
expect(registry.get('manager')?.deprecated).toBe(true)
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd gateway && npx jest tests/unit/pod/pod-roles.test.ts tests/unit/runtime/identity-registry.test.ts --runInBand`
Expected: FAIL because `tech_lead`, `roleForNode`, or `mafw-tech-lead` does not exist.

- [ ] **Step 3: Implement the role and identity changes**

Replace `curator` with `tech_lead`; update `ROLE_ORDER`, SDK union, desktop `ROLE_LABEL`/`ROLE_BADGE`, `MEMBER_SPECS`, and `roleForNode` mapping. Add `deprecated?: boolean` to `IdentitySpec`. Add Lead identity using the existing manager policy, and Tech Lead identity with read-only project/web tools plus Pod/memory tools, no `file-edit` and no `shell`. Register `manager` as deprecated metadata that resolves to Lead semantics while existing `manager` sessions remain readable.

- [ ] **Step 4: Run focused backend and desktop tests**

Run: `cd gateway && npx jest tests/unit/pod/pod-roles.test.ts tests/unit/runtime/identity-registry.test.ts --runInBand`
Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod gateway/src/runtime/identity-registry.ts gateway/src/skills gateway/tests/unit/pod/pod-roles.test.ts gateway/tests/unit/runtime/identity-registry.test.ts packages/gateway-sdk/src/types.ts packages/desktop/src/renderer/mafw/pod-model.ts packages/desktop/src/renderer/mafw/pod-model.test.ts
git commit -m "feat(pod): add lead and tech lead roles"
```

### Task 2: Lead replaces Manager and internal sessions are hidden

**Files:**
- Modify: `gateway/src/index.ts`
- Modify: `gateway/src/core/session-visibility.ts`
- Modify: `gateway/src/skills/manager-identity.ts`
- Test: `gateway/tests/unit/session-visibility.test.ts`
- Test: `gateway/tests/unit/manager-session-runtime.test.ts`

**Interfaces:**
- Consumes: Task 1 `lead` identity and `PodMemberRole`.
- Produces: `projectLeadSessionMetadata(): { mafw: { role: 'lead'; pinned: true } }`; manager session metadata/role uses `lead`; `manager-session` kv key remains; hidden-session predicate treats `lead` and `tech-lead` as internal.

- [ ] **Step 1: Write failing visibility and metadata tests**

```ts
expect(isHiddenSession({ metadata: { mafw: { role: 'lead' } } } as any)).toBe(true)
expect(isHiddenSession({ metadata: { mafw: { role: 'tech-lead' } } } as any)).toBe(true)
expect(projectLeadSessionMetadata()).toMatchObject({ mafw: { role: 'lead', pinned: true } })
expect(LEAD_IDENTITY_SYSTEM_PROMPT).toContain('不要展开技术方案')
expect(LEAD_IDENTITY_SYSTEM_PROMPT).toContain('mafw_create_goal')
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd gateway && npx jest tests/unit/session-visibility.test.ts tests/unit/manager-session-runtime.test.ts --runInBand`
Expected: FAIL because Lead/tech-lead sessions are visible and metadata still says manager.

- [ ] **Step 3: Implement Lead adoption**

Keep `readManagerSlot`/`manager-session` key names, but write `role:'lead'`, register internal role `lead`, bind Pod Lead to the Lead identity, and hide both Lead and Tech Lead runtime sessions from normal session lists. Retain `manager`/`manager-archived` read compatibility for existing rows. Update the Lead identity prompt to say it must not perform technical solution discussion; on a work intent it calls `mafw_create_goal`, then points the user to the Goal's Tech Lead.

- [ ] **Step 4: Run tests**

Run: `cd gateway && npx jest tests/unit/session-visibility.test.ts tests/unit/manager-session-runtime.test.ts tests/unit/runtime/identity-registry.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/index.ts gateway/src/core/session-visibility.ts gateway/src/skills/manager-identity.ts gateway/tests/unit/session-visibility.test.ts gateway/tests/unit/manager-session-runtime.test.ts
git commit -m "feat(pod): make lead replace manager"
```

### Task 3: Goal revision persistence

**Files:**
- Modify: `gateway/src/core/pod/pod-store.ts`
- Modify: `gateway/src/memory/gateway-db.ts`
- Test: `gateway/tests/unit/pod/pod-store-revisions.test.ts`
- Test: `gateway/tests/unit/pod/goal-node-runs-revision.test.ts`

**Interfaces:**
- Consumes: existing `PodGoalRow`, `PodStore`, `GatewayDatabase`.
- Produces: `PodGoalRevisionStatus`, `PodGoalRevisionRow`, root `activeRevision`, revision CRUD, revision-aware `goal_node_runs`.

```ts
export type PodGoalRevisionStatus =
  | 'discussing' | 'direction_review' | 'planning' | 'plan_review'
  | 'queued' | 'implementing' | 'reviewing' | 'completed' | 'aborted' | 'discarded'

export interface PodGoalRevisionRow {
  id: string
  podId: string
  goalId: string
  revision: number
  status: PodGoalRevisionStatus
  verdict: string | null
  directionStatus: 'none' | 'pending' | 'decided'
  directionJson: string | null
  planHash: string | null
  evalHash: string | null
  feedback: string | null
  priority: number
  enqueuedAt: string
  startedAt: string | null
  endedAt: string | null
}
```

- [ ] **Step 1: Write failing persistence tests**

```ts
const rev1 = store.createGoalRevision({ podId, goalId, revision: 1, status: 'discussing', priority: 0, now })
const rev2 = store.createGoalRevision({ podId, goalId, revision: 2, status: 'queued', priority: 10, now })
expect(store.listGoalRevisions(podId, goalId).map((r) => r.revision)).toEqual([1, 2])
expect(store.listQueuedGoalRevisions(podId)[0].revision).toBe(2)
expect(store.getGoal(podId, goalId)?.activeRevision).toBe(1)
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd gateway && npx jest tests/unit/pod/pod-store-revisions.test.ts tests/unit/pod/goal-node-runs-revision.test.ts --runInBand`
Expected: FAIL because the revision table/column and methods do not exist.

- [ ] **Step 3: Implement additive schema and methods**

Add `pod_goal_revisions`, `pod_goals.active_revision`, `pod_goals.priority`, and `goal_node_runs.revision DEFAULT 1` via `ensureColumn`/`CREATE TABLE IF NOT EXISTS`. Existing goals normalize to revision 1. Add methods: `createGoalRevision`, `getGoalRevision`, `listGoalRevisions`, `listQueuedGoalRevisions`, `setGoalRevisionStatus`, `setActiveRevision`, `nextGoalRevision`, `setGoalPriority`. Update `latestNodeAttempt(goalId, revision, loop, node)` and its call sites.

- [ ] **Step 4: Run persistence tests**

Run: `cd gateway && npx jest tests/unit/pod/pod-store-revisions.test.ts tests/unit/pod/goal-node-runs-revision.test.ts --runInBand`
Expected: PASS; legacy rows report revision 1.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-store.ts gateway/src/memory/gateway-db.ts gateway/tests/unit/pod/pod-store-revisions.test.ts gateway/tests/unit/pod/goal-node-runs-revision.test.ts
git commit -m "feat(pod): persist goal revisions"
```

### Task 4: Revision state snapshots and lifecycle service

**Files:**
- Modify: `gateway/src/core/goal/state-v3.ts`
- Create: `gateway/src/core/pod/pod-goal-revision-service.ts`
- Test: `gateway/tests/unit/goal/state-v3-revisions.test.ts`
- Test: `gateway/tests/unit/pod/pod-goal-revision-service.test.ts`

**Interfaces:**
- Consumes: Task 3 store methods and `GoalStateV3`.
- Produces: `GoalStateV3.revision`; `archiveGoalStateForRevision`; `PodGoalRevisionService.openNextRevision(goalId, feedback)`, `.finishRevision(...)`, `.current(goalId)`.

- [ ] **Step 1: Write failing revision-state tests**

```ts
writeGoalState(tmp, 'g1', { revision: 1, nextAction: 'COMPLETED' })
archiveGoalStateForRevision(tmp, 'g1', 1)
expect(fs.existsSync(path.join(tmp, 'state', 'revisions', 'g1', 'rev-1.json'))).toBe(true)
const next = ensureGoalState(tmp, 'g1', { revision: 2, projectDir: '/p', maxRounds: 3 })
expect(next.revision).toBe(2)
expect(loadGoalState(tmp, 'g1')?.revision).toBe(2)
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd gateway && npx jest tests/unit/goal/state-v3-revisions.test.ts tests/unit/pod/pod-goal-revision-service.test.ts --runInBand`
Expected: FAIL because revision is not part of state or snapshot paths.

- [ ] **Step 3: Implement revision state and lifecycle**

Add `revision` with default 1 to normalize/ensure. Archive the active state into `state/revisions/<goalId>/rev-<n>.json` before opening the next revision. Reinitialize the active state for the new revision without deleting archived files. `openNextRevision` closes the current revision as completed/aborted, creates N+1 with `priority` from reject, archives state, and makes it the active revision.

- [ ] **Step 4: Run tests**

Run: `cd gateway && npx jest tests/unit/goal/state-v3-revisions.test.ts tests/unit/pod/pod-goal-revision-service.test.ts --runInBand`
Expected: PASS; revision 1 archive remains unchanged after revision 2 starts.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/state-v3.ts gateway/src/core/pod/pod-goal-revision-service.ts gateway/tests/unit/goal/state-v3-revisions.test.ts gateway/tests/unit/pod/pod-goal-revision-service.test.ts
git commit -m "feat(pod): add revision state lifecycle"
```

### Task 5: Scoped Session supervisor

**Files:**
- Modify: `gateway/src/core/pod/pod-store.ts`
- Modify: `gateway/src/core/pod/pod-service.ts`
- Create: `gateway/src/core/pod/pod-session-supervisor.ts`
- Test: `gateway/tests/unit/pod/pod-session-supervisor.test.ts`

**Interfaces:**
- Consumes: `pod_member_sessions`, Task 3 revision ids.
- Produces: `PodSessionScope`, `PodSessionLease`, `PodSessionSupervisor.ensure(scope, create)`, `.retire(scope)`, `.current(scope)`; deps may provide `isAlive(sessionId)` so dead leases are retired and rebuilt automatically.

```ts
export interface PodSessionScope {
  podId: string
  memberId: string
  goalId: string | null
  revision: number | null
  kind: 'project' | 'discussion' | 'probe' | 'implementation' | 'review'
}
export interface PodSessionLease { sessionId: string; generation: number; reused: boolean }
```

- [ ] **Step 1: Write failing supervisor tests**

```ts
const first = await supervisor.ensure(scope, async () => 'ses_a')
const second = await supervisor.ensure(scope, async () => 'ses_b')
expect(first).toEqual({ sessionId: 'ses_a', generation: 1, reused: false })
expect(second).toEqual({ sessionId: 'ses_a', generation: 1, reused: true })
const otherRevision = await supervisor.ensure({ ...scope, revision: 2 }, async () => 'ses_c')
expect(otherRevision.sessionId).toBe('ses_c')
const dead = new PodSessionSupervisor({ ...deps, isAlive: async () => false })
expect(await dead.ensure(scope, async () => 'ses_recovered')).toMatchObject({ sessionId: 'ses_recovered', generation: 2 })
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd gateway && npx jest tests/unit/pod/pod-session-supervisor.test.ts --runInBand`
Expected: FAIL because the supervisor and scoped-session columns do not exist.

- [ ] **Step 3: Implement the supervisor**

Add `scope_kind`, `revision`, `generation`, `last_active_at` to `pod_member_sessions` and store methods for active scoped lookup/insert/end. `ensure` reuses a live lease for the exact scope; if `isAlive` reports dead, it ends the stale row, increments generation, and creates a replacement. Otherwise it calls `create`, increments generation, and persists it. Retire ends only the scoped session.

- [ ] **Step 4: Run supervisor tests**

Run: `cd gateway && npx jest tests/unit/pod/pod-session-supervisor.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-store.ts gateway/src/core/pod/pod-service.ts gateway/src/core/pod/pod-session-supervisor.ts gateway/tests/unit/pod/pod-session-supervisor.test.ts
git commit -m "feat(pod): manage scoped internal sessions"
```

### Task 6: DirectionDecision and ContextManifest

**Files:**
- Create: `gateway/src/core/goal/direction-decision.ts`
- Create: `gateway/src/core/goal/context-manifest.ts`
- Create: `gateway/src/core/pod/pod-direction-service.ts`
- Test: `gateway/tests/unit/goal/direction-decision.test.ts`
- Test: `gateway/tests/unit/goal/context-manifest.test.ts`
- Test: `gateway/tests/unit/pod/pod-direction-service.test.ts`

**Interfaces:**
- Consumes: revision store, Goal files.
- Produces: `DirectionOption`, `DirectionDecision`, `renderDirectionBlock`; `ContextManifest`, `buildContextManifest`, `renderContextManifest`; `PodDirectionService.request/decide/markClear`.

- [ ] **Step 1: Write failing direction/context tests**

```ts
const decision = normalizeDirectionDecision({ userWords: '采用 A，禁止改并行架构', optionId: 'A' })
expect(renderDirectionBlock([decision])).toContain('采用 A，禁止改并行架构')
expect(() => buildContextManifest({ required: [ref('goal.md')], optional: [ref('other-goal/secret.md')], allowedCrossGoalRefs: [] }))
  .toThrow('cross-goal reference not allowed')
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd gateway && npx jest tests/unit/goal/direction-decision.test.ts tests/unit/goal/context-manifest.test.ts tests/unit/pod/pod-direction-service.test.ts --runInBand`
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the artifacts and direction service**

Direction is persisted in the revision (`direction_json`) and as a Pod artifact. `request` sets `direction_review`, `decide` records user words/option/reason/source and moves to `planning`, and `markClear` records a decision without creating human attention. ContextManifest always includes the stage's required files, validates optional/cross-Goal refs against an allowlist, and renders a deterministic block.

- [ ] **Step 4: Run tests**

Run: `cd gateway && npx jest tests/unit/goal/direction-decision.test.ts tests/unit/goal/context-manifest.test.ts tests/unit/pod/pod-direction-service.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/direction-decision.ts gateway/src/core/goal/context-manifest.ts gateway/src/core/pod/pod-direction-service.ts gateway/tests/unit/goal/direction-decision.test.ts gateway/tests/unit/goal/context-manifest.test.ts gateway/tests/unit/pod/pod-direction-service.test.ts
git commit -m "feat(pod): add direction decisions and context manifests"
```

## Milestone 2 — Plan, review, and probes

### Task 7: PlanPackage and GoalEval

**Files:**
- Create: `gateway/src/core/goal/goal-eval.ts`
- Create: `gateway/src/core/goal/plan-package.ts`
- Test: `gateway/tests/unit/goal/goal-eval.test.ts`
- Test: `gateway/tests/unit/goal/plan-package.test.ts`

**Interfaces:**
- Consumes: existing `WavePlan` shape.
- Produces: `GoalEval`, `GoalEvalCondition`, `PlanPackage`, `validateGoalEval`, `computePlanPackageHash`.

```ts
export interface GoalEvalCondition {
  id: string
  statement: string
  required: boolean
  evidence: string
  method: string
}
export interface GoalEval {
  outcome: string
  conditions: GoalEvalCondition[]
  failureConditions: string[]
  constraints: string[]
  nonGoals: string[]
  mapping: Record<string, { tasks?: string[]; probes?: string[]; artifacts?: string[] }>
}
export interface PlanPackage { waves: unknown; goalEval: GoalEval }
```

- [ ] **Step 1: Write failing pure tests**

```ts
expect(computePlanPackageHash(pkgA)).toBe(computePlanPackageHash(clone(pkgA)))
expect(computePlanPackageHash(pkgA)).not.toBe(computePlanPackageHash({ ...pkgA, goalEval: changedEval }))
expect(() => validateGoalEval({ ...eval, conditions: [] })).toThrow('goal eval requires at least one condition')
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd gateway && npx jest tests/unit/goal/goal-eval.test.ts tests/unit/goal/plan-package.test.ts --runInBand`
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement schemas and canonical hashing**

Validate unique condition ids, required conditions, mapping ids, and non-empty statements/evidence methods. Hash stable JSON with sorted object keys; the hash must change when waves or GoalEval changes.

- [ ] **Step 4: Run tests**

Run: `cd gateway && npx jest tests/unit/goal/goal-eval.test.ts tests/unit/goal/plan-package.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/goal-eval.ts gateway/src/core/goal/plan-package.ts gateway/tests/unit/goal/goal-eval.test.ts gateway/tests/unit/goal/plan-package.test.ts
git commit -m "feat(goal): define plan packages and goal eval"
```

### Task 8: Goal-level review rubric enforcement

**Files:**
- Modify: `gateway/src/core/goal/review-rubric.ts`
- Modify: `gateway/src/core/goal/node-prompts.ts`
- Test: `gateway/tests/unit/goal/review-rubric-goal-results.test.ts`

**Interfaces:**
- Consumes: Task 7 `GoalEval`.
- Produces: `ReviewGoalResult`, `parseReviewRubric(markdown, taskIds, requiredGoalConditionIds)`, `RubricError.code` including `missing_goal_conditions`.

- [ ] **Step 1: Write failing rubric tests**

```ts
const required = ['g1', 'g2']
expect(() => parseReviewRubric(markdownWith(['g1']), ['t1'], required))
  .toThrow(expect.objectContaining({ code: 'missing_goal_conditions' }))
expect(parseReviewRubric(markdownWith(['g1', 'g2']), ['t1'], required).goalResults).toHaveLength(2)
expect(() => parseReviewRubric(markdownWith(['g1', 'g2'], 'fail'), ['t1'], required))
  .toThrow(expect.objectContaining({ code: 'invalid' }))
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd gateway && npx jest tests/unit/goal/review-rubric-goal-results.test.ts --runInBand`
Expected: FAIL because Goal conditions are not parsed/enforced.

- [ ] **Step 3: Implement Goal results parsing**

Add `goalResults[{conditionId,result,evidence}]` to the review schema and parser. Require every required condition exactly once, non-empty evidence, valid result values, and reject `fail` inside a PASS verdict. Keep existing task-ticket behavior and error codes for compatibility.

- [ ] **Step 4: Run parser tests**

Run: `cd gateway && npx jest tests/unit/goal/review-rubric-goal-results.test.ts tests/unit/goal/review-rubric.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/review-rubric.ts gateway/src/core/goal/node-prompts.ts gateway/tests/unit/goal/review-rubric-goal-results.test.ts
git commit -m "feat(goal): enforce goal eval in review"
```

### Task 9: Probe requests, reports, and bounded scheduling

**Files:**
- Create: `gateway/src/core/goal/probe.ts`
- Create: `gateway/src/core/pod/pod-probe-service.ts`
- Create: `gateway/src/core/pod/pod-probe-workspace.ts`
- Modify: `gateway/src/core/pod/pod-store.ts`
- Test: `gateway/tests/unit/goal/probe.test.ts`
- Test: `gateway/tests/unit/pod/pod-probe-service.test.ts`
- Test: `gateway/tests/unit/pod/pod-probe-workspace.test.ts`

**Interfaces:**
- Consumes: `redactSecrets`, revision store.
- Produces: `ProbeRequest`, `ProbeReport`, `validateProbeRequest`, `PodProbeService.request/claim/complete/fail/list`, one running probe per Pod; `ProbeWorkspaceFactory.prepare(projectDir, goalId, probeId)` / `.dispose(workspace)` with a directory outside the main workspace.

```ts
export interface ProbeRequest {
  id: string
  podId: string
  goalId: string
  revision: number
  question: string
  hypothesis: string
  scope: { paths: string[]; commandClasses: string[]; network: boolean; credentials: string[] }
  budget: { maxMinutes: number; maxUsd: number }
  evidenceRequired: string[]
  affects: { planAssertions?: string[]; evalMethods?: string[]; options?: string[] }
}
export interface ProbeReport {
  probeId: string
  conclusion: 'supports' | 'refutes' | 'inconclusive'
  commands: string[]
  keyOutput: string
  repro: string[]
  remainingAssumptions: string[]
  impact: { plan?: string; goalEval?: string }
}
```

- [ ] **Step 1: Write failing probe tests**

```ts
const a = service.request(req('p1'))
const b = service.request(req('p2'))
expect(service.claim(podId)?.id).toBe(a.id)
expect(service.claim(podId)).toBeNull()
service.complete(a.id, report)
expect(service.claim(podId)?.id).toBe(b.id)
expect(service.complete(a.id, { ...report, keyOutput: 'token sk-secret' }).keyOutput).not.toContain('sk-secret')
const workspace = await workspaces.prepare('/repo/project', 'g1', 'p1')
expect(workspace.dir).not.toBe('/repo/project')
await workspaces.dispose(workspace)
expect(fs.existsSync(workspace.dir)).toBe(false)
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd gateway && npx jest tests/unit/goal/probe.test.ts tests/unit/pod/pod-probe-service.test.ts --runInBand`
Expected: FAIL because probe types/service/table do not exist.

- [ ] **Step 3: Implement probe persistence and scheduling**

Add `pod_probes` with request/report JSON and status lifecycle. Validate machine-readable scope, enforce one running probe per Pod, persist reports as files and DB rows, and redact report output before both writes. `PodProbeWorkspaceFactory` creates a temp directory/worktree outside the main workspace and disposes it after report capture; the probe prompt must use that directory as its working directory.

- [ ] **Step 4: Run tests**

Run: `cd gateway && npx jest tests/unit/goal/probe.test.ts tests/unit/pod/pod-probe-service.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/probe.ts gateway/src/core/pod/pod-probe-service.ts gateway/src/core/pod/pod-probe-workspace.ts gateway/src/core/pod/pod-store.ts gateway/tests/unit/goal/probe.test.ts gateway/tests/unit/pod/pod-probe-service.test.ts gateway/tests/unit/pod/pod-probe-workspace.test.ts
git commit -m "feat(pod): persist bounded technical probes"
```

### Task 10: Tech Lead discussion and direct Goal creation

**Files:**
- Create: `gateway/src/core/pod/pod-tech-lead-service.ts`
- Create: `gateway/src/mcp/handlers/pod-goal-direction.ts`
- Modify: `gateway/src/core/goal/goal-intake.ts`
- Modify: `gateway/src/mcp/handlers/create-goal.ts`
- Modify: `gateway/src/mcp/tool-registry.ts`
- Test: `gateway/tests/unit/pod/pod-tech-lead-service.test.ts`
- Test: `gateway/tests/unit/goal/goal-intake-direct.test.ts`
- Test: `gateway/tests/unit/mcp/create-goal-direct.test.ts`
- Test: `gateway/tests/unit/mcp/pod-goal-direction.test.ts`

**Interfaces:**
- Consumes: `createGoalIntake`, Task 5 supervisor, Task 6 ContextManifest/direction, Task 3 revision store.
- Produces: `PodTechLeadService.createGoal(input)`, `.prompt(goalId,text)`, `.history(goalId,limit)`, `.ensureSession(goalId)`; MCP tool `mafw_pod_goal_direction` accepting `{goalId, mode:'clear'|'needs_user'|'decided', userWords?, options?, reason?}`.

- [ ] **Step 1: Write failing Tech Lead tests**

```ts
const created = await service.createGoal({ podId, projectDir, title: 'Pod loop', objective: '实现协作 loop' })
expect(created).toMatchObject({ revision: 1, stage: 'discussing' })
expect(created.sessionID).toBe('ses_tech_lead')
await service.prompt(created.goalId, '先调研现有 Pod')
expect(runtime.promptAsync).toHaveBeenCalledWith(expect.objectContaining({ sessionID: 'ses_tech_lead' }))
expect(runtime.promptAsync.mock.calls[0][0].parts[0]).toContain('[CONTEXT MANIFEST]')
await directionTool.execute({ goalId: created.goalId, mode: 'clear', userWords: '按方案 A' }, { sessionID: created.sessionID })
expect(direction.decide).toHaveBeenCalledWith(expect.objectContaining({ goalId: created.goalId, decision: expect.objectContaining({ userWords: '按方案 A' }) }))
expect(startPlanning).toHaveBeenCalledWith(created.goalId)
await createGoalTool.execute({ title: 'New work', objective: '调研方向' }, { sessionID: leadSession })
expect(techLead.createGoal).toHaveBeenCalled()
expect(startGoalDirect).not.toHaveBeenCalled()
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd gateway && npx jest tests/unit/pod/pod-tech-lead-service.test.ts tests/unit/goal/goal-intake-direct.test.ts --runInBand`
Expected: FAIL because no Tech Lead service exists.

- [ ] **Step 3: Implement direct discussion Goal creation**

Create Goal + revision 1 in `discussing`, ensure the four-member Pod and Tech Lead member, obtain a scoped discussion session through the supervisor, register the hidden session, bind it to the Goal, and send the first prompt with the ContextManifest. `createGoalIntake` keeps source/authorization and never auto-starts NodeDriver for this path; the existing `goal_created` listener must ignore discussion revisions until the direction tool/API explicitly starts planning. When `mafw_create_goal` is invoked by the project Lead, route it to `PodTechLeadService.createGoal`; do not start plan/execute directly. Register `mafw_pod_goal_direction`: only the bound Tech Lead session can call it; `clear` records a decision without attention, `needs_user` persists a DirectionReview and emits attention, `decided` is used after the user supplies a direction. `clear` or `decided` invokes the injected planning starter; `needs_user` does not.

- [ ] **Step 4: Run tests**

Run: `cd gateway && npx jest tests/unit/pod/pod-tech-lead-service.test.ts tests/unit/goal/goal-intake-direct.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-tech-lead-service.ts gateway/src/mcp/handlers/pod-goal-direction.ts gateway/src/mcp/handlers/create-goal.ts gateway/src/core/goal/goal-intake.ts gateway/src/mcp/tool-registry.ts gateway/tests/unit/pod/pod-tech-lead-service.test.ts gateway/tests/unit/goal/goal-intake-direct.test.ts gateway/tests/unit/mcp/create-goal-direct.test.ts gateway/tests/unit/mcp/pod-goal-direction.test.ts
git commit -m "feat(pod): create goals directly with tech lead discussion"
```

### Task 11: Revision-aware Pod stages, views, and results

**Files:**
- Modify: `gateway/src/core/pod/pod-stage.ts`
- Modify: `gateway/src/core/pod/pod-view.ts`
- Modify: `gateway/src/core/pod/pod-result.ts`
- Test: `gateway/tests/unit/pod/pod-stage-revisions.test.ts`
- Test: `gateway/tests/unit/pod/pod-view-revisions.test.ts`
- Test: `gateway/tests/unit/pod/pod-result-goal-eval.test.ts`

**Interfaces:**
- Consumes: Task 3 revision rows, Task 7 GoalEval, Task 8 review Goal results.
- Produces: `PodGoalStage.role`, new stage kinds/actions, `PodGoalView.revision`, `PodGoalResult.goalResults`.

- [ ] **Step 1: Write failing projection tests**

```ts
expect(projectPodGoalStage({ revision: rev('discussing'), direction: null }).kind).toBe('discussing')
expect(projectPodGoalStage({ revision: rev('direction_review', 'pending'), direction: null }))
  .toMatchObject({ owner: 'person', kind: 'direction_review', role: 'tech_lead' })
expect(projectPodGoalStage({ revision: rev('reviewing') })).toMatchObject({ owner: 'team', role: 'reviewer' })
expect(buildPodGoalView(row({ activeRevision: 2 }), desc({ revision: 2 }), null)).toMatchObject({ revision: 2 })
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd gateway && npx jest tests/unit/pod/pod-stage-revisions.test.ts tests/unit/pod/pod-view-revisions.test.ts tests/unit/pod/pod-result-goal-eval.test.ts --runInBand`
Expected: FAIL because current stages only understand plan/execute/review.

- [ ] **Step 3: Implement the projection**

Add `role`, `discussing`, `direction_review`, `planning`, `probing`, `implementing`, `reviewing`, `result_notified`; keep terminal/blocked precedence. Direction review is person attention only while pending. `PodGoalResult` carries revision, Goal conditions, and per-condition evidence; missing/malformed evidence remains fail-closed.

- [ ] **Step 4: Run projection tests**

Run: `cd gateway && npx jest tests/unit/pod/pod-stage-revisions.test.ts tests/unit/pod/pod-view-revisions.test.ts tests/unit/pod/pod-result-goal-eval.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-stage.ts gateway/src/core/pod/pod-view.ts gateway/src/core/pod/pod-result.ts gateway/tests/unit/pod/pod-stage-revisions.test.ts gateway/tests/unit/pod/pod-view-revisions.test.ts gateway/tests/unit/pod/pod-result-goal-eval.test.ts
git commit -m "feat(pod): expose revision aware stage and result"
```

### Task 12: Revision-aware NodeDriver and Tech Lead session reuse

**Files:**
- Modify: `gateway/src/core/goal/state-v3.ts`
- Modify: `gateway/src/core/goal/driver.ts`
- Modify: `gateway/src/core/goal/node-prompts.ts`
- Modify: `gateway/src/core/goal/routing.ts`
- Create: `gateway/src/core/goal/node-names.ts`
- Test: `gateway/tests/unit/goal/driver-revisions.test.ts`
- Test: `gateway/tests/unit/goal/node-artifacts-revisions.test.ts`

**Interfaces:**
- Consumes: revision-aware DB/state and `PodTechLeadService.ensureSession`.
- Produces: `DriverDeps.existingNodeSession?(goalId, node, revision): string | null`; revision in node runs/events; per-revision artifact paths.

- [ ] **Step 1: Write failing driver tests**

```ts
const deps = fakeDriverDeps({ existingNodeSession: () => 'ses_tech_lead' })
await driver.advance('g1')
expect(deps.client.create).not.toHaveBeenCalled()
expect(deps.client.promptAsync).toHaveBeenCalledWith(expect.objectContaining({ sessionID: 'ses_tech_lead' }))
expect(deps.db.insertNodeRun).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }))
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd gateway && npx jest tests/unit/goal/driver-revisions.test.ts tests/unit/goal/node-artifacts-revisions.test.ts --runInBand`
Expected: FAIL because driver has no revision or session-reuse hook.

- [ ] **Step 3: Implement revision-aware execution**

Add revision to state, node runs, approval, events, and artifact paths. For `plan`, ask `existingNodeSession` first and reuse the Tech Lead discussion session; register the run/session binding without creating a new runtime session. Keep legacy callers working with revision default 1.

- [ ] **Step 4: Run driver tests**

Run: `cd gateway && npx jest tests/unit/goal/driver-revisions.test.ts tests/unit/goal/node-artifacts-revisions.test.ts tests/unit/goal/driver.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/state-v3.ts gateway/src/core/goal/driver.ts gateway/src/core/goal/node-prompts.ts gateway/src/core/goal/routing.ts gateway/src/core/goal/node-names.ts gateway/tests/unit/goal/driver-revisions.test.ts gateway/tests/unit/goal/node-artifacts-revisions.test.ts
git commit -m "feat(goal): make driver revision aware"
```

### Task 13: PlanPackage in planning and approval hashes

**Files:**
- Modify: `gateway/src/core/goal/node-prompts.ts`
- Modify: `gateway/src/core/goal/driver.ts`
- Modify: `gateway/src/core/pod/pod-task-service.ts`
- Modify: `gateway/src/routes/goal-plan.ts`
- Test: `gateway/tests/unit/goal/plan-package-driver.test.ts`
- Test: `gateway/tests/unit/pod/plan-approval-hash.test.ts`

**Interfaces:**
- Consumes: Task 7 `PlanPackage`, Task 12 revision driver.
- Produces: plan output containing `waves + goalEval`; `planApproval.planHash/evalHash`; task edits clear approval.

- [ ] **Step 1: Write failing approval tests**

```ts
await driver.approvePlan('g1', approvalId)
expect(state().planApproval).toMatchObject({ status: 'approved', planHash: expectedPlanHash, evalHash: expectedEvalHash })
await expect(driver.approvePlan('g1', approvalId, { planHash: 'stale' }))
  .rejects.toMatchObject({ code: 'stale_plan' })
await tasks.editPlanTask(podId, taskId, { title: 'changed' })
expect(state().planApproval?.status).toBe('pending')
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd gateway && npx jest tests/unit/goal/plan-package-driver.test.ts tests/unit/pod/plan-approval-hash.test.ts --runInBand`
Expected: FAIL because plan output has no GoalEval/hash binding.

- [ ] **Step 3: Implement PlanPackage plan flow**

Change the plan output schema to require `waves + goalEval`, validate with Task 7, write both per-revision paths, and record both hashes on plan approval. `approvePlan` recomputes and compares hashes. Any task edit, new task, deletion, or plan artifact rewrite invalidates approval. `GET /plan` includes GoalEval, hashes, and revision.

- [ ] **Step 4: Run tests**

Run: `cd gateway && npx jest tests/unit/goal/plan-package-driver.test.ts tests/unit/pod/plan-approval-hash.test.ts tests/unit/routes/goal-plan.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/node-prompts.ts gateway/src/core/goal/driver.ts gateway/src/core/pod/pod-task-service.ts gateway/src/routes/goal-plan.ts gateway/tests/unit/goal/plan-package-driver.test.ts gateway/tests/unit/pod/plan-approval-hash.test.ts
git commit -m "feat(goal): bind plan approval to plan and eval"
```

## Milestone 3 — Spike execution and result loop

### Task 14: Two-stage Spike orchestration

**Files:**
- Modify: `gateway/src/core/goal/node-prompts.ts`
- Modify: `gateway/src/core/goal/driver.ts`
- Modify: `gateway/src/core/goal/routing.ts`
- Modify: `gateway/src/core/goal/node-names.ts`
- Modify: `gateway/src/core/approval/policy-service.ts`
- Modify: `gateway/src/core/approval/hook.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/goal/driver-probe.test.ts`
- Test: `gateway/tests/unit/goal/probe-scope-guard.test.ts`

**Interfaces:**
- Consumes: Task 9 probe service/workspace, Task 13 PlanPackage, Builder identity.
- Produces: plan output union `ready | need_probe`; `probe` node; probe report artifacts; re-plan after report; `ProbeScopeGuard.evaluate(request, action): 'allow'|'ask'|'deny'` enforced before tool approval.

- [ ] **Step 1: Write failing two-stage tests**

```ts
planModel.reply({ status: 'need_probe', probes: [probeRequest('p1')] })
await driver.advance('g1')
expect(state().nextNode).toBe('probe')
expect(runtime.promptAsync).toHaveBeenCalledWith(expect.objectContaining({ agent: 'mafw-execute' }))
probeResult.complete('p1', supportsReport)
await driver.advance('g1')
expect(state().nextNode).toBe('plan')
expect(state().probeRefs).toEqual(['p1'])
expect(state().planApproval?.status ?? 'none').not.toBe('approved')
expect(ProbeScopeGuard.evaluate(probe('p1'), action({ path: '/repo/project/src/a.ts' }))).toBe('deny')
expect(ProbeScopeGuard.evaluate(probe('p1'), action({ network: true }))).toBe('ask')
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd gateway && npx jest tests/unit/goal/driver-probe.test.ts --runInBand`
Expected: FAIL because `need_probe`/probe node are not recognized.

- [ ] **Step 3: Implement the default Spike flow**

Extend plan output with `need_probe` and validated `ProbeRequest[]`. On `need_probe`, create a `probe` node run, create the isolated probe workspace, prompt Builder with the request and workspace, wait for the report artifact, dispose the workspace, append reports to the plan context, and re-enter plan. Do not expose plan approval until a final `ready` PlanPackage exists. Map the active probe session to its ProbeRequest and run `ProbeScopeGuard` before approval evaluation: actions outside the declared paths/commands/network/credentials return `ask` or `deny`; internal-session auto-approval must not override this guard.

- [ ] **Step 4: Run tests**

Run: `cd gateway && npx jest tests/unit/goal/driver-probe.test.ts tests/unit/goal/routing.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/node-prompts.ts gateway/src/core/goal/driver.ts gateway/src/core/goal/routing.ts gateway/src/core/goal/node-names.ts gateway/src/core/approval/policy-service.ts gateway/src/core/approval/hook.ts gateway/src/index.ts gateway/tests/unit/goal/driver-probe.test.ts gateway/tests/unit/goal/probe-scope-guard.test.ts
git commit -m "feat(goal): run probes before final planning"
```

### Task 15: Conditional full-chain Spike approval

**Files:**
- Modify: `gateway/src/core/goal/plan-package.ts`
- Modify: `gateway/src/core/goal/node-prompts.ts`
- Modify: `gateway/src/core/goal/driver.ts`
- Test: `gateway/tests/unit/goal/full-chain-approval.test.ts`

**Interfaces:**
- Consumes: Task 14 probe flow.
- Produces: `PlanApprovalMode = 'two_stage' | 'full_chain'`; `probeContinuationRules`; invalidation result.

- [ ] **Step 1: Write failing full-chain tests**

```ts
const full = planPackage({ approvalMode: 'full_chain', continuation: { p1: { supports: 'continue', refutes: 'reapprove', inconclusive: 'reapprove' } } })
await driver.approvePlan('g1', id, { planHash: hash(full) })
expect(state().planApproval?.status).toBe('approved')
await driver.recordProbe('p1', { conclusion: 'refutes' })
expect(state().planApproval?.status).toBe('pending')
expect(state().nextNode).toBe('plan')
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd gateway && npx jest tests/unit/goal/full-chain-approval.test.ts --runInBand`
Expected: FAIL because only two-stage flow exists.

- [ ] **Step 3: Implement conditional whole-plan approval**

PlanPackage may include `approvalMode: 'full_chain'` plus a rule map from probe id/conclusion to `continue | reapprove`. Approve this exact package before probes. If every probe result resolves to `continue`, proceed to implementation without another plan gate; any `reapprove`, unexpected result, changed hash, or scope change marks approval pending and returns to planning.

- [ ] **Step 4: Run tests**

Run: `cd gateway && npx jest tests/unit/goal/full-chain-approval.test.ts tests/unit/goal/plan-package.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/plan-package.ts gateway/src/core/goal/node-prompts.ts gateway/src/core/goal/driver.ts gateway/tests/unit/goal/full-chain-approval.test.ts
git commit -m "feat(goal): support conditional full-chain approval"
```

### Task 16: Result notification, reject, and revision priority

**Files:**
- Modify: `gateway/src/core/pod/pod-goal-service.ts`
- Modify: `gateway/src/core/pod/pod-goal-revision-service.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/pod/pod-result-reject.test.ts`
- Test: `gateway/tests/unit/pod/pod-goal-priority.test.ts`

**Interfaces:**
- Consumes: Task 4 revision service, Task 11 result view.
- Produces: `PodGoalService.notifyResult(podId, goalId)`, `.rejectResult(podId, goalId, feedback)`, revision priority ordering.

- [ ] **Step 1: Write failing result/reject tests**

```ts
await service.notifyResult(podId, 'g1')
expect(events).toContainEqual(expect.objectContaining({
  type: 'pod.updated',
  properties: { podId, kind: 'result', goalId: 'g1' },
}))
const rejected = await service.rejectResult(podId, 'g1', '方向不对，重新讨论')
expect(rejected).toMatchObject({ goalId: 'g1', revision: 2, status: 'discussing' })
expect(store.getGoal(podId, 'g1')?.activeRevision).toBe(2)
expect(store.listQueuedGoalRevisions(podId)[0].goalId).toBe('g1')
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd gateway && npx jest tests/unit/pod/pod-result-reject.test.ts tests/unit/pod/pod-goal-priority.test.ts --runInBand`
Expected: FAIL because reject/revision result flow does not exist.

- [ ] **Step 3: Implement result and reject flow**

On PASS, keep the revision completed and emit one result notification event; do not create attention. Reject archives the current state, starts revision N+1 in `discussing`, restores the Tech Lead session for the Goal, stores feedback as a DirectionDecision input, and gives the revision priority. Never rewrite or unarchive an older revision.

- [ ] **Step 4: Run tests**

Run: `cd gateway && npx jest tests/unit/pod/pod-result-reject.test.ts tests/unit/pod/pod-goal-priority.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-goal-service.ts gateway/src/core/pod/pod-goal-revision-service.ts gateway/src/index.ts gateway/tests/unit/pod/pod-result-reject.test.ts gateway/tests/unit/pod/pod-goal-priority.test.ts
git commit -m "feat(pod): close result reject revision loop"
```

### Task 17: Wire ContextManifest into every worker prompt

**Files:**
- Modify: `gateway/src/core/goal/driver.ts`
- Modify: `gateway/src/index.ts`
- Create: `gateway/src/mcp/handlers/pod-context-select.ts`
- Modify: `gateway/src/mcp/tool-registry.ts`
- Test: `gateway/tests/unit/goal/context-manifest-wiring.test.ts`
- Test: `gateway/tests/unit/mcp/pod-context-select.test.ts`

**Interfaces:**
- Consumes: Task 6 `buildContextManifest`, existing `podContext`.
- Produces: `DriverDeps.contextBlock?(goalId,node,revision): string | null`; `PodContextSelectionService.select({goalId,revision,refs}, actorSessionID)`; MCP tool `mafw_pod_goal_context`; prompt contains baseline + Lead-selected refs only.

- [ ] **Step 1: Write failing context tests**

```ts
const block = await deps.contextBlock('g1', 'execute', 2)
expect(block).toContain('goal.md')
expect(block).not.toContain('other-goal/private-discussion')
const prompt = renderNodePrompt('execute', { ...ctx, manifestBlock: block! })
expect(prompt.indexOf('[CONTEXT MANIFEST]')).toBeLessThan(prompt.indexOf('## Task'))
await expect(contextSelect.execute({ goalId: 'g1', revision: 1, refs: [otherGoalPrivateRef] }, { sessionID: leadSession }))
  .rejects.toThrow('cross-goal reference not allowed')
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd gateway && npx jest tests/unit/goal/context-manifest-wiring.test.ts --runInBand`
Expected: FAIL because driver still uses only ad-hoc `podContext`.

- [ ] **Step 3: Implement deterministic manifest injection**

Build the manifest before every node/probe prompt. Include automatically required Goal/revision files, apply Lead-selected optional/cross-Goal refs through the allowlist, and reject missing/sensitive refs. Register `mafw_pod_goal_context` so only the bound project Lead can append/remove optional refs for a Goal revision; Tech Lead/Builder/Reviewer cannot widen their own context. Keep `[POD HANDOFF]` and Pod memory after the manifest block. Persist the manifest path/hash for recovery.

- [ ] **Step 4: Run tests**

Run: `cd gateway && npx jest tests/unit/goal/context-manifest-wiring.test.ts tests/unit/pod/pod-message-delivery.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/driver.ts gateway/src/index.ts gateway/src/mcp/handlers/pod-context-select.ts gateway/src/mcp/tool-registry.ts gateway/tests/unit/goal/context-manifest-wiring.test.ts gateway/tests/unit/mcp/pod-context-select.test.ts
git commit -m "feat(goal): inject explicit worker context manifests"
```

## Milestone 4 — API and SDK

### Task 18: Collaboration routes, SDK, and preload

**Files:**
- Modify: `gateway/src/routes/pods.ts`
- Modify: `gateway/src/routes/pod-handlers.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/routes/goal-plan.ts`
- Create: `gateway/src/routes/pod-collaboration.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`
- Test: `gateway/tests/integration/pod-collaboration-routes.test.ts`
- Test: `packages/gateway-sdk/tests/pod-collaboration.test.ts`
- Test: `packages/desktop/tests/pod-preload-wiring.test.ts`

**Interfaces:**
- Consumes: Tasks 10-16 services.
- Produces: routes and SDK methods:
  - `POST /api/pods/:podId/goals` → direct discussion Goal
  - `GET /api/pods/:podId/goals/:goalId/tech-lead`
  - `POST /api/pods/:podId/goals/:goalId/tech-lead/messages`
  - `POST /api/pods/:podId/goals/:goalId/direction-decision`
  - `GET/POST /api/pods/:podId/goals/:goalId/probes`
  - `POST /api/pods/:podId/goals/:goalId/reject`
  - `GET /api/pods/:podId/goals/:goalId/revisions`
  - plan response includes `goalEval`, `planHash`, `evalHash`, `revision`.

- [ ] **Step 1: Write failing contract tests**

```ts
const created = await client.pod.createGoal(podId, { title: 'Loop', objective: '实现' })
expect(created).toMatchObject({ status: 'discussing', podId, goalId: expect.any(String) })
expect((await client.pod.techLead(podId, created.goalId)).sessionID).toBeTruthy()
await client.pod.sendTechLeadMessage(podId, created.goalId, '讨论方向')
expect((await client.pod.rejectResult(podId, created.goalId, '打回')).revision).toBe(2)
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd gateway && npx jest tests/integration/pod-collaboration-routes.test.ts --runInBand`
Run: `cd packages/gateway-sdk && npm test`
Expected: FAIL on missing routes/SDK methods.

- [ ] **Step 3: Implement routes and clients**

Add handlers with the same validation/error conventions as `pods.ts`. Register every operation in `route-catalog.ts`, regenerate the OpenAPI contract with `npm run emit:openapi`, and mirror types/methods through SDK and preload. Do not hand-edit generated contract files.

- [ ] **Step 4: Run contract and preload tests**

Run: `cd gateway && npx jest tests/integration/pod-collaboration-routes.test.ts tests/unit/api-contract --runInBand`
Run: `cd packages/gateway-sdk && npm test`
Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-preload-wiring.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes gateway/tests/integration/pod-collaboration-routes.test.ts packages/gateway-sdk packages/desktop/src/preload packages/desktop/tests/pod-preload-wiring.test.ts gateway/gateway-paths.json
git commit -m "feat(pod): expose collaboration APIs"
```

## Milestone 5 — Desktop experience

### Task 19: Lead Goal card and hidden Tech Lead tab

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/LeftDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WelcomeHome.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/PodTechLeadInvite.tsx`
- Modify: `packages/desktop/src/renderer/mafw/pod-store.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-tech-lead-invite.test.ts`
- Test: `packages/desktop/tests/lead-entry-wiring.test.ts`
- Test: `packages/desktop/tests/pod-tech-lead-wiring.test.ts`

**Interfaces:**
- Consumes: Task 18 `pod.techLead(podId, goalId)`, existing `manager.session(projectDir)` compatibility endpoint.
- Produces: `leadEntryLabel(): 'Lead'`; `PodTechLeadInvite({ goalId, title, onOpen })`; `MafwShell.openTechLead(goalId)` opens a Goal-labeled ChatPane for the hidden session.

- [ ] **Step 1: Write failing UI logic tests**

```ts
assert.deepEqual(techLeadInvite({ stage: { kind: 'discussing', role: 'tech_lead' } }, 'g1'), {
  goalId: 'g1', label: '与 Tech Lead 讨论'
})
assert.equal(techLeadTabTitle('Pod loop'), 'Tech Lead · Pod loop')
assert.equal(leadEntryLabel(), 'Lead')
assert.match(readFileSync(leftDockPath, 'utf8'), /Lead/)
assert.doesNotMatch(readFileSync(welcomePath, 'utf8'), />Manager</)
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-tech-lead-invite.test.ts tests/pod-tech-lead-wiring.test.ts`
Expected: FAIL because the invite/tab helpers do not exist.

- [ ] **Step 3: Implement the Lead-to-Tech-Lead entry**

Rename the visible Manager entry to Lead while keeping the compatibility API/kv key internal. Do not remove the fixed Lead entry even though Lead sessions are hidden from the normal session list. When the active chat session is the project Lead and a Goal is in `discussing`, render a `PodTechLeadInvite` above the composer. Clicking it calls `pod.techLead(podId, goalId)`, opens the returned session with the Goal-scoped title, and does not show the runtime id. Keep the underlying session out of LeftDock/session lists.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-tech-lead-invite.test.ts tests/pod-tech-lead-wiring.test.ts`
Run: `cd packages/desktop && npx tsgo --noEmit -p tsconfig.json`
Expected: PASS and rc=0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/components/LeftDock.tsx packages/desktop/src/renderer/mafw/components/WelcomeHome.tsx packages/desktop/src/renderer/mafw/components/PodTechLeadInvite.tsx packages/desktop/src/renderer/mafw/pod-store.ts packages/desktop/src/renderer/mafw/pod-tech-lead-invite.test.ts packages/desktop/tests/lead-entry-wiring.test.ts packages/desktop/tests/pod-tech-lead-wiring.test.ts
git commit -m "feat(desktop): open tech lead from lead chat"
```

### Task 20: Goal stage, direction, probe, and Plan/Eval UI

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/GoalDetailOverlay.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/PlanReviewOverlay.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/plan-render.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/plan-review-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/PodAttentionList.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/PodDirectionPanel.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/PodProbePanel.tsx`
- Test: `packages/desktop/src/renderer/mafw/components/plan-review-eval.test.ts`
- Test: `packages/desktop/src/renderer/mafw/components/pod-direction-probe.test.ts`
- Test: `packages/desktop/tests/pod-collab-ui-wiring.test.ts`

**Interfaces:**
- Consumes: Task 18 plan/probe/direction DTOs and `pod.updated`.
- Produces: `renderPlanPackage(plan)` including GoalEval/probe evidence/hash; direction pending/decided panel; probe report cards.

- [ ] **Step 1: Write failing renderer tests**

```ts
assert.match(renderPlanPackage(pkg), /Goal Eval/)
assert.match(renderPlanPackage(pkg), /g1: 用户可以从 Lead 创建 Goal/)
assert.match(renderPlanPackage(pkg), /Probe p1 · supports/)
assert.equal(directionAction({ status: 'pending', options: [] }).label, '记录方向决定')
assert.equal(probeBadge({ conclusion: 'refutes' }), '否定假设')
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/plan-review-eval.test.ts src/renderer/mafw/components/pod-direction-probe.test.ts`
Expected: FAIL because Plan review only renders waves.

- [ ] **Step 3: Implement the collaboration surfaces**

Render Plan, GoalEval conditions, evidence mapping, Spike requests/reports, unverified assumptions, Plan/Eval hashes, and revision in the review overlay. Add the direction decision panel and probe report cards. Direction attention uses the existing `PodAttentionList`; high-risk Spike approval uses the same approval surface. Do not add raw `<button>`/`<input>` or raw `title` attributes.

- [ ] **Step 4: Run component, design-contract, and type tests**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/plan-review-eval.test.ts src/renderer/mafw/components/pod-direction-probe.test.ts tests/pod-collab-ui-wiring.test.ts tests/design-contract.test.ts`
Run: `cd packages/desktop && npx tsgo --noEmit -p tsconfig.json`
Expected: PASS and rc=0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components packages/desktop/tests/pod-collab-ui-wiring.test.ts
git commit -m "feat(desktop): review goal eval and probes"
```

### Task 21: Result notification, reject, and revision history UI

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/PodResultPanel.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/PodTaskBoard.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/GoalDetailOverlay.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/PodDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/pod-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/pod-rail-badge.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-result-reject.test.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-rail-badge.test.ts`
- Test: `packages/desktop/tests/pod-result-revision-wiring.test.ts`

**Interfaces:**
- Consumes: Task 18 `rejectResult`, result/revision DTOs, `pod.updated kind:'result'`.
- Produces: result notification, Goal/Revision badges, `PodResultPanel` reject feedback, revision history.

- [ ] **Step 1: Write failing result UI tests**

```ts
assert.equal(resultStatus({ verdict: 'PASS', revision: 2 }), 'revision 2 · 已通过')
assert.equal(rejectButtonLabel({ status: 'completed' }), '打回并继续讨论')
assert.equal(podResultBadge({ resultReady: true, viewed: false }), 'result')
assert.equal(podResultBadge({ resultReady: true, viewed: true }), null)
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-result-reject.test.ts src/renderer/mafw/pod-rail-badge.test.ts`
Expected: FAIL because result/revision/reject UI does not exist.

- [ ] **Step 3: Implement the result loop**

On a result event, show an OS notification if the window is hidden and a distinct result dot in the rail while unviewed. Open the result from the notification. Add a reject action with feedback; after success, open the same Goal’s Tech Lead tab at the new revision. Show revision numbers in queue/detail and preserve old revision history. Do not count unread/result as human-blocking attention.

- [ ] **Step 4: Run focused tests and build**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-result-reject.test.ts src/renderer/mafw/pod-rail-badge.test.ts tests/pod-result-revision-wiring.test.ts`
Run: `cd packages/desktop && npx tsgo --noEmit -p tsconfig.json && npx electron-vite build`
Expected: PASS, rc=0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw packages/desktop/tests/pod-result-revision-wiring.test.ts
git commit -m "feat(desktop): complete result reject revision loop"
```

## Milestone 6 — End-to-end verification

### Task 22: Integration coverage, migration checks, and authoritative docs

**Files:**
- Create: `gateway/tests/integration/pod-collaboration-loop.test.ts`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-11-02-pod-collaborative-goal-loop-design.md` status after implementation
- Test: `gateway/tests/integration/pod-collaboration-loop.test.ts`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: one end-to-end scenario proving the complete loop and a migration test for old three-role/legacy manager data.

- [ ] **Step 1: Write the failing end-to-end scenario**

```ts
const created = await http.createGoal({ title: 'Loop', objective: '实现端到端协作' })
await http.sendLeadToTechLead(created, '先调研，必要时跑探针')
await http.completeProbe(created, { conclusion: 'supports' })
const plan = await http.finishPlan(created, { goalEval: requiredEval })
await http.approvePlan(created, plan.hash)
await http.completeImplementation(created)
const result = await http.finishReview(created, { verdict: 'PASS' })
expect(result).toMatchObject({ revision: 1, verdict: 'PASS' })
const rejected = await http.reject(created, '方向不对，继续讨论')
expect(rejected.revision).toBe(2)
expect(await http.oldRevision(created, 1)).toMatchObject({ verdict: 'PASS' })
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd gateway && npx jest tests/integration/pod-collaboration-loop.test.ts --runInBand`
Expected: FAIL until all vertical slices are wired.

- [ ] **Step 3: Implement the remaining glue and migration**

Use old 3-role Pods with revision default 1 and Lead/Manager compatibility. Verify old manager sessions are hidden, old goals still load, no old revision artifact is overwritten, and ContextManifest never leaks another Goal. Update AGENTS.md with the authoritative architecture and exact test counts after all gates pass.

- [ ] **Step 4: Run the full required verification**

Run: `cd gateway && npm test -- --runInBand --forceExit`
Run: `cd gateway && npx tsc --noEmit -p tsconfig.json`
Run: `npm run test:desktop`
Run: `cd packages/desktop && npx tsgo --noEmit -p tsconfig.json`
Run: `cd packages/desktop && npx electron-vite build`
Run: `cd packages/gateway-sdk && npm test`
Run: `npm run build`
Expected: all tests pass, typecheck/build rc=0. If a parallel-session WIP failure is encountered, record the exact suites and do not claim the gate passed.

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/integration/pod-collaboration-loop.test.ts AGENTS.md docs/superpowers/specs/2026-11-02-pod-collaborative-goal-loop-design.md
git commit -m "test(pod): verify collaborative goal loop end to end"
```

---

## Plan Self-Review

- **Spec coverage:** role model and Lead replacement: Tasks 1-2; Goal revisions and hidden sessions: Tasks 3-5; direction/context: Tasks 6 and 17; PlanPackage/GoalEval: Tasks 7 and 13; independent review: Task 8 and 11; Spike modes A/B: Tasks 9, 14, 15; result/reject/loop: Task 16; API/SDK: Task 18; desktop entry and pages: Tasks 19-21; verification/migration/docs: Task 22.
- **Step scan:** every task has a failing test, a run-to-fail command, an implementation step, a pass command, and a commit. Implementation steps name files and exact public contracts; internal bodies remain the implementer's work.
- **Type consistency:** `PodMemberRole`, `PodGoalRevisionStatus`, `PodGoalRevisionRow`, `PodSessionScope`, `DirectionDecision`, `ContextManifest`, `GoalEval`, `PlanPackage`, `ProbeRequest`, `ProbeReport`, `PodDirectionService`, `PodProbeService`, `PodTechLeadService`, and `planApproval.{planHash,evalHash}` are reused with the same names across tasks.
- **Review focus coverage:** casual-question/discard is covered by Task 2/10 and result UI Task 21; revision append-only by Tasks 4/16; Goal context isolation by Tasks 6/17; probe scope by Task 9/14; stale approval by Task 13.
- **Proportion:** this plan intentionally stops at interfaces and tests, not full implementations; the 22 tasks follow the spec's milestones rather than restating the program.