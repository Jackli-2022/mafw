# Batch 4 — Durable Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native, inline).

**Goal:** Persisted shell/subagent task entities with five-state lifecycle, poller/reconcile, `task.updated`, task API/SDK, and a gateway-task section in BackgroundDock.

**Architecture:** `TaskStore` persists JSON files under `~/.mafw/tasks`; `TaskService` projects 2.1 shell/subagent state, polls every 2s, emits `task.updated`. Shell access is added as optional `runtime.shell`; subagent tasks reuse Batch 3. Task API is in route-catalog + SDK.

**Spec:** `docs/superpowers/specs/2026-10-26-batch4-durable-task-design.md`

## Global Constraints

- Use `/api/shell` (background), not `/api/session/:sid/shell` (synchronous).
- Task files are atomic (tmp+rename); corrupt files skipped.
- Only state changes persist/emit (`task.updated`), not every poll.
- Parent ownership validated for message/cancel/output.
- No task history deletion in v1.
- Keep local background rows as fallback; gateway tasks are a separate section.
- Do not touch parallel B3.1 docs.

## Review Focus

- Active task after gateway restart with serve also restarted — mark failed lost, never fake working.
- shell `exit` missing while status exited — default failed with clear error.
- cancel on already-terminal task — idempotent, no duplicate event.
- subagent pending question/permission — input_required then back to working.
- task.updated for a task whose parent is unknown — still listed; sessionID optional.
- output cursor beyond size — return empty/truncated correctly.
- corrupt task JSON — startup continues.

---

### Task 1: Shell adapter

**Files:**
- Modify: `gateway/src/runtime/contract.ts` (`RuntimeClient.shell?`)
- Modify: `gateway/src/runtime/opencode-adapter.ts`
- Test: `gateway/tests/unit/runtime/opencode-branch.test.ts`

**Interfaces:**
```ts
shell?: {
  create(opts: { command:string; cwd?:string; timeout?:number; metadata?:Record<string,unknown>; directory?:string }): Promise<any>;
  get(opts: { shellID:string; directory?:string }): Promise<any>;
  output(opts: { shellID:string; directory?:string; cursor?:number; limit?:number }): Promise<any>;
  remove(opts: { shellID:string; directory?:string }): Promise<void>;
}
```
- [x] Implement via `directNative` (`/shell`, `/shell/:id`, `/shell/:id/output?cursor=&limit=`, DELETE). `unwrapNative` each.
- [x] Tests mock global fetch: create body/url, get, output query, remove method.
- [x] `npx tsc --noEmit`; commit `feat(runtime): shell background task API on adapter`.

---

### Task 2: TaskStore + TaskService

**Files:**
- Create: `gateway/src/runtime/task-store.ts`
- Create: `gateway/src/runtime/task-service.ts`
- Test: `gateway/tests/unit/runtime/task-store.test.ts`
- Test: `gateway/tests/unit/runtime/task-service.test.ts`

**Interfaces:**
- `TaskStatus`, `TaskEntity` per spec §4.1.
- `TaskStore(dir)` with `loadAll()`, `save(task)`, `pathOf(id)`.
- `TaskService(deps)` with `init()`, `start()`, `dispose()`, `submit(opts)`, `list(query?)`, `get(id)`, `cancel(id)`, `message(id,message)`, `output(id,{cursor?,limit?})`.
- Deps: `shell?`, `spawnSubagent`, `cancelSubagent`, `messageSubagent`, `getSession`, `pendingInput?`, `emit`, `storeDir`, `now?`.

- [x] **Step 1: Store tests** atomic save/load, corrupt file skipped.
- [x] **Step 2: Service tests** with fake shell/session:
  - submit shell → working; shell get exited 0 → completed + emit once.
  - shell exit 2 → failed; timeout → failed; killed → cancelled.
  - submit subagent → child id; session idle success → completed; pendingInput → input_required → working.
  - cancel idempotent; message only subagent; output only shell; missing external id → failed lost.
  - init loads active task and reconciles.
- [x] **Step 3: Implement store/service** with a 2s `setInterval(...).unref()`; only emit/persist on change.
- [x] **Step 4: run tests; commit** `feat(runtime): durable task store and lifecycle service`.

---

### Task 3: Task routes + SDK

**Files:**
- Create: `gateway/src/routes/tasks.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/routes/wave1-handlers.ts`
- Modify: `gateway/src/index.ts` (construct service, start/stop, inline shell deps)
- Modify: `packages/gateway-sdk/src/client.ts`, `types.ts`
- Tests: `gateway/tests/unit/routes/tasks.test.ts`, `packages/gateway-sdk/src/client.test.ts`, `wave1-handlers.test.ts`, `api-contract` regeneration.

**Catalog:**
```
POST /api/tasks (tasks.submit)
GET /api/tasks (tasks.list)
GET /api/tasks/:id (tasks.get)
POST /api/tasks/:id/cancel (tasks.cancel)
POST /api/tasks/:id/message (tasks.message)
GET /api/tasks/:id/output (tasks.output)
```
- [x] Handlers read JSON, validate, map 404/400/503 (shell unsupported).
- [x] SDK `tasks` namespace + types; tests for URLs/query.
- [x] Construct `TaskService` in index with deps:
  - `shell: this.runtime?.shell` (capability absent → 503 on shell submit)
  - `spawnSubagent: (o) => this.subagentService.spawn(o)`
  - `cancelSubagent/messageSubagent/getSession/pendingInput`
  - `emit: (task) => this.broadcast({type:'task.updated', task, sessionID: task.parentSessionID})`
  - `storeDir: path.join(mafwDir,'tasks')`
- [x] `await taskService.init()` + `start()` after services init; `dispose()` in stop.
- [x] children/subagent integration unchanged.
- [x] Regenerate contract/SDK; run tests; commit `feat(runtime): durable task API and SDK`.

---

### Task 4: `task.updated` event + desktop task store/dock

**Files:**
- Modify: `gateway/src/runtime/mafw-vocabulary.ts`
- Modify: `packages/gateway-sdk/src/events.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts` (+ test deps)
- Create: `packages/desktop/src/renderer/mafw/task-store.ts` (+ test)
- Modify: `packages/desktop/src/renderer/mafw/components/BackgroundDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx` (deps + initial fetch)
- Modify: `packages/desktop/src/preload/mafw-api.ts`, `mafw-types.ts`

- [x] Add `task.updated` to vocabulary + SDK union (vocabulary-sync test).
- [x] Dispatcher top-level:
  ```ts
  if (event.type === 'task.updated') { deps.tasks.onEvent(event.properties?.task ?? event.task); return }
  ```
  Add `tasks` dep; update dispatcher test makeDeps.
- [x] `task-store.ts`: signal rows, `ingestTask`, `fetchTasks` (SDK), `cancelTask`.
- [x] BackgroundDock: gateway tasks section (kind/status/title/time; cancel for working/input_required; open subagent child via existing prop).
- [x] MafwShell: `tasks: { onEvent: ingestTask }`; fetch on mount/SSE reconnect.
- [x] Tests: task store upsert/sort, dispatcher task.updated. Run desktop tests/build; commit `feat(desktop): durable gateway tasks in BackgroundDock`.

---

### Task 5: Tools (minimal)

**Files:**
- Create: `src/tools/task-submit.ts`, `task-list.ts`, `task-cancel.ts`, `task-message.ts`
- Modify: `src/plugin.ts`, `gateway/src/runtime/mafw-tools.ts`, `tool-classes.ts`
- Tests: tool count 10→14; handler HTTP tests.

- [x] Tools call `/api/tasks` with ctx session as parent; list/cancel/message.
- [x] Annotations: submit/message/cancel non-readonly; list read-only.
- [x] Update counts/names in mafw-tools/pi/routes tests; commit `feat(tools): durable task tools`.

---

### Task 6: Live verification + deploy

- [x] Full gateway/desktop/SDK/session-ui/TUI; root build.
- [x] Deploy; live:
  1. `POST /api/tasks {kind:'shell', parentSessionID, command:'echo task-ok'}`; poll list completed; output includes.
  2. `sleep 30` task cancel → cancelled.
  3. subagent task prompt "reply exactly: task-child" → completed; child result.
  4. Restart gateway; list still contains terminal tasks; active lost marked failed.
- [x] Update spec/plan status; report.

## Verification (v4.32.0, 2026-10-26)

- gateway: 364 suites / **2607 pass**; desktop: 344 suites / **1421 pass**; SDK **144**; session-ui **89**; TUI **224** (223 pass, 1 smoke skip).
- desktop `tsgo --noEmit` rc=0; `electron-vite build` ok; root `npm run build` ok.
- live: shell task completed + output; output survives gateway restart (64KB snapshot); cancel → cancelled; subagent completed + message reopen (`task-child-3`); active `sleep 60` after restart → failed(`lost_after_restart`); global SSE `task.updated`; `/api/tools` 14 + `mafw_task_submit` execute.
- implementation commits: `05b4d781`, `b2d8e640`, `ea86d227`, `6b0e61dc`, `a8a5c997`; release commit v4.32.0.

## Self-Review

- [x] Five states, persistence, reconcile, event, API, SDK, desktop, tools.
- [x] Failure modes: lost shell, missing exit, idempotent cancel, pending input, corrupt JSON, cursor, message-reopen race, shell output snapshot.
- [x] No new task history deletion; native/local background rows preserved.
- **Known limitation**: local API is loopback-only without per-session auth; task id random + parent-filtered list; ownership enforcement deferred to gateway auth.
