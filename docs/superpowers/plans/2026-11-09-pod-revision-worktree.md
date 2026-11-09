# Pod Revision Worktree + User Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Pod Goal revision its own Git worktree/branch, keep all Pod nodes on that checkout, and merge it into the project branch only after an explicit one-click user acceptance.

**Architecture:** Gateway owns a `PodWorktreeService` backed by a new `pod_goal_worktrees` table and a revision-scoped Git checkout. Tech Lead and NodeDriver create sessions in that checkout; Reviewer PASS only marks the result ready. `POST /api/pods/:podId/goals/:goalId/accept` validates a human confirmation, commits pending changes, merges with `--no-ff`, and marks the revision merged. Desktop renders both success and failure result pages with all existing evidence plus a code-result card and the single-click accept action on success.

**Tech Stack:** TypeScript, better-sqlite3, simple-git, Jest, SolidJS desktop, gateway SDK/preload.

**Spec:** `docs/superpowers/specs/2026-11-09-pod-revision-worktree-design.md`

## Global Constraints

- One worktree per Pod Goal revision, shared by discussion / plan / execute / review.
- Revision 1 branches from project HEAD; revision N branches from revision N-1's branch when present.
- Worktree path: `<repoRoot sibling>/<repoName>-wt-<safeGoalId>-r<N>`.
- Branch: `mafw/<safeGoalId>-r<N>`; `safeGoalId` only `[A-Za-z0-9._-]`.
- Pod project must equal Git repo root; otherwise return 409 and do not fall back to the main workspace.
- Reviewer PASS does **not** merge. Only the explicit user acceptance endpoint merges.
- Acceptance is human-only: reject requests with `actorSessionID`.
- Acceptance is one click; no second confirmation dialog. The UI shows a persistent warning.
- Commit identity is `MAFW <mafw@localhost>`, `--no-verify`, and `.mafw` is excluded.
- Merge conflicts must run `git merge --abort`; leave the worktree and branch intact.
- Existing result information must remain visible: verdict/assessment, revision history, Goal acceptance, Goal Eval conditions and per-condition results, task evidence, review feedback, artifacts, failure resubmit, and reject input.
- Goal Eval conditions/results are already in the DTO but currently unrendered; this plan renders them.
- Do not add a VM/sandbox to this change.

## Review Focus

- A project directory that is a subdirectory of a repo: must return a clear 409, never create a worktree outside the repo root.
- A worktree directory deleted or recreated between Gateway restarts: `ensure` must reuse an existing branch or recover idempotently.
- A merge blocked by a dirty project workspace or conflicting main branch: must leave main untouched and preserve the worktree.
- A rejected revision: its dirty work must be committed before opening revision N+1, and its old worktree must never be re-offered for acceptance.
- Result-page regressions from adding the code card: existing evidence, failure resubmit, and reject controls must remain.

---

### Task 1: Worktree path rules + persistence

**Files:**
- Create: `gateway/src/core/pod/pod-worktree-path.ts`
- Modify: `gateway/src/core/pod/pod-store.ts`
- Test: `gateway/tests/unit/pod/pod-worktree-path.test.ts`
- Test: `gateway/tests/unit/pod/pod-store.test.ts`

**Interfaces:**
- Produces:
  - `safePodGoalSlug(goalId: string): string`
  - `podWorktreeBranch(goalId: string, revision: number): string`
  - `podWorktreeDir(projectDir: string, goalId: string, revision: number): string`
  - `PodGoalWorktreeStatus = 'active' | 'merged' | 'abandoned' | 'missing'`
  - `PodGoalWorktreeRow`
  - `PodStore.getGoalWorktree(podId, goalId, revision): PodGoalWorktreeRow | null`
  - `PodStore.insertGoalWorktree(input): PodGoalWorktreeRow`
  - `PodStore.updateGoalWorktree(input): PodGoalWorktreeRow | null`

- [ ] **Step 1: Write failing path tests**

Test sanitizes `../x`, keeps `[A-Za-z0-9._-]`, creates `mafw/<safe>-r2`, and places the dir beside the repo root.

- [ ] **Step 2: Run them and verify failure**

Run: `cd gateway && npx jest tests/unit/pod/pod-worktree-path.test.ts --runInBand`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement path helpers**

Use `path.resolve`, repo root basename, and a sanitized goal slug. Never allow empty/path-traversal results.

- [ ] **Step 4: Write failing PodStore worktree tests**

Cover insert, duplicate `(pod_id, goal_id, revision)` idempotence, get, and status/merge-commit update.

- [ ] **Step 5: Add table and methods**

Add `pod_goal_worktrees` near `pod_goal_revisions` in `PodStore` schema:

```sql
CREATE TABLE IF NOT EXISTS pod_goal_worktrees (
  pod_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  dir TEXT NOT NULL,
  branch TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  base_branch TEXT,
  status TEXT NOT NULL,
  merge_commit TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  merged_at TEXT,
  PRIMARY KEY (pod_id, goal_id, revision)
);
```

Map rows with a `goalWorktreeFromRow` helper.

- [ ] **Step 6: Run tests and commit**

Run: `cd gateway && npx jest tests/unit/pod/pod-worktree-path.test.ts tests/unit/pod/pod-store.test.ts --runInBand`
Expected: PASS.

```bash
git add gateway/src/core/pod/pod-worktree-path.ts gateway/src/core/pod/pod-store.ts gateway/tests/unit/pod/pod-worktree-path.test.ts gateway/tests/unit/pod/pod-store.test.ts
git commit -m "feat(pod): add revision worktree persistence"
```

---

### Task 2: PodWorktreeService Git lifecycle

**Files:**
- Create: `gateway/src/core/pod/pod-worktree-service.ts`
- Test: `gateway/tests/unit/pod/pod-worktree-service.test.ts`

**Interfaces:**
- Consumes: Task 1 store methods and path helpers.
- Produces:
  - `PodWorktreeService.ensure(podId, goalId, revision): Promise<PodGoalWorktreeRow>`
  - `PodWorktreeService.get(podId, goalId, revision): PodGoalWorktreeRow | null`
  - `PodWorktreeService.commitPending(podId, goalId, revision): Promise<{ commit: string | null }>`
  - `PodWorktreeService.mergeForAcceptance(podId, goalId, revision): Promise<{ branch: string; mergeCommit: string; mergedAt: string }>`
  - `PodWorktreeService.markAbandoned(podId, goalId, revision): void`

- [ ] **Step 1: Write failing service tests with real temporary Git repos**

Cover:
- `ensure` creates the branch/dir and returns the same row/dir on second call.
- revision 2 bases from revision 1's branch.
- subdirectory project → `PodError` 409 and no worktree.
- `commitPending` excludes `.mafw`, uses MAFW identity, and is a no-op when clean.
- `mergeForAcceptance` merges with `--no-ff`, marks the row merged, removes the worktree, keeps the branch.
- dirty project tracked file → 409 and no merge.
- conflict → merge aborted and worktree retained.
- current branch differs from `base_branch` → 409.

- [ ] **Step 2: Run tests and verify failure**

Run: `cd gateway && npx jest tests/unit/pod/pod-worktree-service.test.ts --runInBand`
Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement `ensure`**

Single-flight per `(podId, goalId, revision)`. Resolve Git top-level and reject any project directory that is not the root. Determine `baseBranch` from the current branch; for revision N>1 inherit the previous revision's `base_branch` and use its branch as `base_ref` when it exists. Create with `git worktree add -b <branch> <dir> <baseRef>`; on DB failure remove the new checkout.

- [ ] **Step 4: Implement commit and merge**

`commitPending` runs `git add -A -- . :(exclude).mafw`, then `git -c user.name=MAFW -c user.email=mafw@localhost commit --no-verify -m 'mafw(pod): <goalId> rev <N>'`.

`mergeForAcceptance` requires a clean tracked project, the recorded base branch checked out, commits the worktree, runs `git merge --no-ff <branch> --no-edit` with MAFW identity, and on failure runs `git merge --abort`. On success store `merge_commit`, mark `merged`, force-remove the worktree, and retain the branch.

- [ ] **Step 5: Run tests and commit**

Run: `cd gateway && npx jest tests/unit/pod/pod-worktree-service.test.ts --runInBand`
Expected: PASS.

```bash
git add gateway/src/core/pod/pod-worktree-service.ts gateway/tests/unit/pod/pod-worktree-service.test.ts
git commit -m "feat(pod): manage revision worktrees safely"
```

---

### Task 3: Put Pod sessions inside the revision worktree

**Files:**
- Modify: `gateway/src/core/pod/pod-tech-lead-service.ts`
- Modify: `gateway/src/core/goal/driver.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/pod/pod-tech-lead-worktree.test.ts`
- Test: `gateway/tests/unit/pod/pod-driver-worktree.test.ts`

**Interfaces:**
- Consumes: `PodWorktreeService.ensure`.
- Produces:
  - `PodTechLeadServiceDeps.worktrees?: Pick<PodWorktreeService, 'ensure'>`
  - `NodeDriverDeps.workdirForRevision?: (goalId: string, revision: number) => Promise<string | null>`

- [ ] **Step 1: Write failing Tech Lead test**

Create a real temp repo, a Pod/goal revision row, and a fake runtime. Assert `createSession` receives the generated worktree directory, not `pod.projectDir`.

- [ ] **Step 2: Write failing driver test**

With a fake `client.create`, assert plan/execute/review session creation uses `workdirForRevision`; probe still uses the probe workspace.

- [ ] **Step 3: Run tests and verify failure**

Run: `cd gateway && npx jest tests/unit/pod/pod-tech-lead-worktree.test.ts tests/unit/pod/pod-driver-worktree.test.ts --runInBand`
Expected: FAIL on the new expectations.

- [ ] **Step 4: Wire Tech Lead and NodeDriver**

In `PodTechLeadService.ensureScopedSession`, call `worktrees.ensure(podId, goalId, revision)` and pass its `dir` to `runtime.createSession`. If ensure fails, keep the existing `sessionError` behavior.

In `NodeDriver.executeNode`, resolve `workdirForRevision` only when creating a new session. If it throws, call `failNode(goalId, '', 'worktree_unavailable', message)` and do not create a main-workspace session. Reused discussion sessions keep their existing cwd.

- [ ] **Step 5: Wire production factory**

In `index.ts`, construct `PodWorktreeService` before `PodGoalService`, inject it into `PodTechLeadService`, and provide:

```ts
workdirForRevision: async (goalId, revision) => {
  const row = this.podStore.getGoalByGoalId(goalId);
  return row ? (await this.podWorktreeService.ensure(row.podId, goalId, revision)).dir : null;
}
```

- [ ] **Step 6: Run tests and commit**

Run: `cd gateway && npx jest tests/unit/pod/pod-tech-lead-worktree.test.ts tests/unit/pod/pod-driver-worktree.test.ts tests/unit/pod/pod-tech-lead-service.test.ts tests/unit/goal-driver-pod.test.ts tests/unit/goal/driver-revisions.test.ts --runInBand`
Expected: PASS.

```bash
git add gateway/src/core/pod/pod-tech-lead-service.ts gateway/src/core/goal/driver.ts gateway/src/index.ts gateway/tests/unit/pod/pod-tech-lead-worktree.test.ts gateway/tests/unit/pod/pod-driver-worktree.test.ts
git commit -m "feat(pod): run Pod sessions in revision worktrees"
```

---

### Task 4: Commit, reject inheritance, result fields, acceptance gating

**Files:**
- Modify: `gateway/src/core/pod/pod-goal-service.ts`
- Modify: `gateway/src/core/pod/pod-result.ts`
- Modify: `gateway/src/core/pod/pod-view.ts`
- Modify: `gateway/src/core/pod/pod-work-stage.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/pod/pod-result-accept.test.ts`
- Test: `gateway/tests/unit/pod/pod-work-stage.test.ts`

**Interfaces:**
- Consumes: `PodWorktreeService.get/commitPending/mergeForAcceptance/markAbandoned`.
- Produces:
  - `PodGoalServiceDeps.worktrees?: Pick<PodWorktreeService, 'get' | 'commitPending' | 'mergeForAcceptance' | 'markAbandoned'>`
  - `PodGoalService.acceptResult(podId, goalId, opts?: { revision?: number }): Promise<PodGoalAcceptResult>`
  - `PodGoalResult.worktree?: PodResultWorktree | null`
  - `PodGoalResult.acceptance?: 'pending' | 'accepted' | 'unavailable'`
  - `PodGoalDescription.accepted?: boolean`
  - `PodGoalView.accepted: boolean`
  - `projectPodWorkBucket({ accepted })` → `ended` when accepted.

- [ ] **Step 1: Write failing result/accept tests**

Cover:
- PASS result exposes branch/base/status and `acceptance: 'pending'`.
- FAIL result has `acceptance: 'unavailable'` and no acceptance.
- `acceptResult` rejects missing/failed results.
- `acceptResult` rejects a non-active revision.
- successful merge returns merge commit and flips the bucket to `ended`.
- repeat acceptance is idempotent.
- reject calls `commitPending` before opening the next revision.
- merged revision cannot be rejected.

- [ ] **Step 2: Run tests and verify failure**

Run: `cd gateway && npx jest tests/unit/pod/pod-result-accept.test.ts tests/unit/pod/pod-work-stage.test.ts --runInBand`
Expected: FAIL.

- [ ] **Step 3: Enrich result and view**

`PodGoalService.result` merges `worktrees.get(...)` into `PodGoalResult.worktree` and derives `acceptance`: merged → accepted; active + acceptable result → pending; otherwise unavailable.

`describeWithRevision` sets `accepted` from the worktree row, and `buildPodGoalView` forwards it. Update `projectPodWorkBucket` to return `ended` for accepted rows before `result_ready`.

- [ ] **Step 4: Implement `acceptResult`**

Require the current active revision, terminal status, trustworthy result, PASS or UNREVIEWED success, and an active worktree. Call `mergeForAcceptance`, notify Pod refresh, and return `{ revision, branch, mergeCommit, mergedAt }`.

- [ ] **Step 5: Commit on finish and reject**

In `finishPodGoal`, call `podWorktreeService.commitPending` after the result is known and before notification. In `PodGoalService.rejectResult`, call `commitPending` before `reopenAfterReject`; on success mark the old worktree `abandoned`. Throw 409 if the revision is already merged.

- [ ] **Step 6: Run tests and commit**

Run: `cd gateway && npx jest tests/unit/pod/pod-result-accept.test.ts tests/unit/pod/pod-work-stage.test.ts tests/unit/pod/pod-result-reject.test.ts tests/unit/pod/pod-goal-priority.test.ts --runInBand`
Expected: PASS.

```bash
git add gateway/src/core/pod/pod-goal-service.ts gateway/src/core/pod/pod-result.ts gateway/src/core/pod/pod-view.ts gateway/src/core/pod/pod-work-stage.ts gateway/src/index.ts gateway/tests/unit/pod/pod-result-accept.test.ts gateway/tests/unit/pod/pod-work-stage.test.ts
git commit -m "feat(pod): gate revision merge on user acceptance"
```

---

### Task 5: Acceptance HTTP route + SDK/preload

**Files:**
- Modify: `gateway/src/routes/pods.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Test: `gateway/tests/unit/pod/pod-accept-route.test.ts`
- Test: `packages/gateway-sdk/src/pod-collaboration.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/pods/:podId/goals/:goalId/accept` body `{ revision?: number; confirm: true }`
  - `PodGoalAcceptResult`
  - `MafwClient.pod.acceptResult(podID, goalID, body)`
  - preload `window.api.mafw.pod.acceptResult(...)`

- [ ] **Step 1: Write failing route tests**

Cover success, `confirm !== true` → 400, `actorSessionID` → 403, stale revision → 409, merge conflict → 409, and response shape.

- [ ] **Step 2: Add route and catalog entry**

Route order: place accept before the generic goal `DELETE` matcher. Add:

```ts
{ method: 'POST', path: '/api/pods/:podId/goals/:goalId/accept', operationId: 'pods.goals.accept', tags: ['pods'] }
```

Update `PodRouteDeps.goals` with `accept`.

- [ ] **Step 3: Write failing SDK test**

Assert the URL, method, and body `{ revision: 1, confirm: true }`.

- [ ] **Step 4: Implement SDK/preload**

Add `PodGoalAcceptResult`, `PodGoalResult.worktree/acceptance`, `PodGoal.accepted`, and the client/preload method.

- [ ] **Step 5: Regenerate contract and run tests**

Run: `cd gateway && npm run emit:openapi`
Run: `cd packages/gateway-sdk && npm test`
Run: `cd gateway && npx jest tests/unit/pod/pod-accept-route.test.ts --runInBand`
Expected: PASS and generated contract contains `pods.goals.accept`.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/routes/pods.ts gateway/src/routes/route-catalog.ts gateway/tests/unit/pod/pod-accept-route.test.ts packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/pod-collaboration.test.ts packages/desktop/src/preload/mafw-types.ts packages/desktop/src/preload/mafw-api.ts packages/gateway-sdk/contract
git commit -m "feat(pod): add user acceptance endpoint"
```

---

### Task 6: Desktop result page — preserve all evidence, add worktree and accept

**Files:**
- Create: `packages/desktop/src/renderer/mafw/pod-result-view-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/PodResultView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx`
- Test: `packages/desktop/src/renderer/mafw/pod-result-view-model.test.ts`

**Interfaces:**
- Consumes: `PodGoalResult.worktree`, `acceptance`, `goalConditions`, `goalResults`.
- Produces:
  - `podResultAcceptanceView(result): { actionable: boolean; label: string; tone: 'success' | 'failure' | 'neutral' }`
  - `podResultWorktreeRows(result): Array<{ label: string; value: string; tone?: 'warning' | 'danger' }>`
  - `podResultConditionRows(result): Array<{ id: string; statement: string; required: boolean; result: string; evidence: string }>`
  - `onAccept?: () => Promise<PodGoalAcceptResult | null>` prop on `PodResultView`.

- [ ] **Step 1: Write failing model tests**

Cover success `pending`, failure `unavailable`, merged `accepted`, missing worktree, Goal Eval pairing, and unknown condition IDs.

- [ ] **Step 2: Run tests and verify failure**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-result-view-model.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement model helpers**

Keep rendering decisions out of the component. Unknown Goal Eval results render as “未判定”, never as pass.

- [ ] **Step 4: Refactor `PodResultView`**

Render, in order:
1. verdict/assessment;
2. revision history;
3. code-result card (`branch`, `target`, `status`, note);
4. Goal acceptance;
5. Goal Eval conditions and per-condition results;
6. task evidence;
7. Review feedback;
8. artifacts;
9. failure resubmit when failed;
10. reject textarea/button;
11. acceptance button only when `acceptance === 'pending'`.

The success accept button calls `props.onAccept` once, disables while pending, and updates the local accepted state from the returned merge commit. No second confirmation dialog.

- [ ] **Step 5: Add `acceptGoal` in `GoalDetailPanel`**

Resolve `podId`/`goalId`, call `window.api.mafw.pod.acceptResult(podId, goalId, { confirm: true })`, show a success/failure toast, refresh `podStore`, and reload detail/collaboration.

- [ ] **Step 6: Run tests and build**

Run: `cd packages/desktop && npm test`
Run: `cd packages/desktop && npx tsgo --noEmit -p tsconfig.json`
Run: `cd packages/desktop && npx electron-vite build`
Expected: PASS / exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/pod-result-view-model.ts packages/desktop/src/renderer/mafw/pod-result-view-model.test.ts packages/desktop/src/renderer/mafw/components/PodResultView.tsx packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx
git commit -m "feat(desktop): show Pod revision evidence and acceptance"
```

---

### Task 7: Artifact resolution, wiring guards, docs, full verification

**Files:**
- Modify: `gateway/src/core/pod/pod-a2a-artifacts.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/pod/pod-a2a-artifacts.test.ts`
- Modify: `AGENTS.md`
- Test: `gateway/tests/unit/pod/pod-wiring.test.ts`

**Interfaces:**
- `PodA2AArtifactStore` accepts a dynamic roots resolver so the active revision worktree is searched before `projectDir`.

- [ ] **Step 1: Write failing artifact test**

Create a temp repo/worktree; a ref present only in the worktree resolves before merge and falls back to project after the worktree is removed.

- [ ] **Step 2: Implement dynamic root resolution**

Allow `PodA2AArtifactStore` to receive a roots resolver that returns `{ worktreeDir?, projectDir?, artifactRoot? }`. Index resolves the current revision's active worktree row; merged/missing rows omit the worktree root.

- [ ] **Step 3: Update wiring guards and docs**

Update `pod-wiring.test.ts` to assert `PodWorktreeService` is constructed and injected. Add the worktree/acceptance behavior to `AGENTS.md` after implementation is verified.

- [ ] **Step 4: Run full verification**

Run:
- `cd gateway && npx jest --runInBand --forceExit`
- `cd packages/gateway-sdk && npm test`
- `cd packages/desktop && npm test`
- `cd packages/desktop && npx tsgo --noEmit -p tsconfig.json`
- `cd packages/desktop && npx electron-vite build`
- `cd gateway && npx tsc --noEmit -p tsconfig.json`
- `cd gateway && npm run emit:openapi`

Expected: all tests pass, contract regenerated, typechecks/build exit 0.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-a2a-artifacts.ts gateway/src/index.ts gateway/tests/unit/pod/pod-a2a-artifacts.test.ts gateway/tests/unit/pod/pod-wiring.test.ts AGENTS.md
git commit -m "feat(pod): resolve artifacts from revision worktrees"
```
