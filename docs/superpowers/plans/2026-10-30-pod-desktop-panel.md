# Desktop Pod Panel (Project Pod Lite · Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the desktop「执行 › 鲸群」panel that reads the project Pod over the existing gateway API and refreshes from `pod.updated` without polling.

**Architecture:** A pure model (`pod-model.ts`), a Solid store (`pod-store.ts`), and small composition components under `renderer/mafw/components/`. `MafwShell` owns project scope, SSE event routing, session navigation, the Goal overlay, and the SessionStrip badge. One non-creating lookup route and two SDK methods are added on the backend/API surface; the goal state machine is untouched.

**Tech Stack:** TypeScript, SolidJS, Node 22 test runner (`node:test` + `@mafw/test-shim`), Jest (gateway), `@mafw/sdk`, existing `@mafw/ui` v2 components.

**Spec:** `docs/superpowers/specs/2026-10-30-pod-desktop-panel-design.md`

## Global Constraints

- One Pod per registered project; worktree maps to the parent Pod; `projectDir = benchRoot() ?? currentProject()`.
- **Never auto-create** a Pod on panel open: `lookup` failure (404) means「no Pod」; only the「创建鲸群」button calls `ensure`.
- No polling. Refresh only from `pod.updated` (debounced 200ms) and explicit refresh.
- No new canonical event types; `pod.updated` is the only signal.
- Renderer calls only `window.api`; preload additions must mirror the SDK exactly.
- UI primitives: `ButtonV2`, `TextInputV2`, `SelectV2`, `TooltipV2`, `LoaderV2`, `ToastV2`; no raw `<button>`/`<input>` and no bare `title` attributes. Raw `<textarea>` is allowed (existing overlay precedent).
- All new CSS uses existing tokens (`var(--text-1)`, `var(--border-subtle)`, `var(--bg-inset)`, `var(--r-md)`, …); no new keyframes; no `transition: all`; no raw transition durations (design-contract tests scan the whole stylesheet).
- No changes to `NodeDriver` / goal state machine.
- Tests: gateway `cd gateway && npx jest … --runInBand`; SDK `cd packages/gateway-sdk && node --import tsx --require ../../packages/test-shim/require-hook.cjs --test src/client.test.ts`; desktop `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test <file>`.
- Typecheck gate is `cd packages/desktop && npx tsgo --noEmit -p tsconfig.json`; build gate is `npx electron-vite build`.

## Review Focus

- **Worktree → parent Pod:** `lookup` from a worktree directory must return the same Pod as the registered project root. Test: Task 1.
- **Opening the panel must not create a Pod:** lookup 404 shows the create empty state; no `ensure` call until the button is pressed. Tests: Tasks 1 and 5.
- **Event burst:** six `pod.updated` events for one task mutation may arrive back-to-back; they must coalesce into one refresh. Test: Task 5.
- **Project switch race:** a slow lookup for project A must not overwrite project B. Test: Task 5.
- **Live vs ended session:** a member with an active session opens the live session; only an ended session with `transcriptRef` opens the snapshot. Test: Task 3.
- **Old gateway:** lookup 404 is not an error, but `ensure` 404 shows the unsupported banner once, not a toast loop. Test: Task 5.

---

### Task 1: Non-creating lookup + per-file memory read API

**Files:**
- Modify: `gateway/src/core/pod/pod-service.ts`
- Modify: `gateway/tests/unit/pod/pod-service.test.ts`
- Modify: `gateway/src/routes/pods.ts`
- Modify: `gateway/tests/unit/routes/pods.test.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/gateway-sdk/src/client.test.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/desktop/tests/pod-preload-wiring.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // PodService
  lookup(projectDir: string): PodDetail | null

  // PodNamespace (SDK + preload)
  lookup(projectID: string): Promise<PodDetail>
  readMemoryFile(podID: string, file: 'POD' | 'MEMORY' | 'GLOSSARY'): Promise<{ content: string }>
  ```
- Route contract: `GET /api/projects/:projectId/pod?lookup=1` → 200 `PodDetail` or 404 `{ error: 'pod not found' }`; `GET /api/pods/:podId/memory?file=POD|MEMORY|GLOSSARY` → `{ content }` (route already exists).

- [ ] **Step 1: Write the failing service test**

Append to `gateway/tests/unit/pod/pod-service.test.ts`:
```ts
test('lookup returns the pod for a registered project without creating one', async () => {
  const { service, store, projectDir } = makeService({ registered: ['/proj'] });
  expect(service.lookup(projectDir)).toBeNull();
  const detail = await service.ensure(projectDir);
  expect(service.lookup(projectDir)?.pod.id).toBe(detail.pod.id);
  expect(service.lookup('/not-registered')).toBeNull();
});

test('lookup maps a worktree directory back to the parent pod', async () => {
  const { service, projectDir } = makeService({ registered: ['/proj'] });
  const detail = await service.ensure(projectDir);
  const worktree = path.join(path.dirname(projectDir), `${path.basename(projectDir)}-wt-feature`);
  expect(service.lookup(worktree)?.pod.id).toBe(detail.pod.id);
});
```
Reuse the file's existing fake-store/deps helper; if it doesn't expose `registered`, extend it with `listRegisteredProjectDirs: () => registered`.

- [ ] **Step 2: Run test to verify it fails**

Run:
```text
cd gateway
npx jest tests/unit/pod/pod-service.test.ts --runInBand
```
Expected: FAIL with `service.lookup is not a function`.

- [ ] **Step 3: Implement `lookup` and the route query**

`PodService.lookup`:
```ts
lookup(projectDir: string): PodDetail | null {
  let resolved: string;
  try {
    resolved = this.resolveProjectDir(projectDir);
  } catch {
    return null;
  }
  const pod = this.deps.store.getPodByProject(resolved);
  return pod ? this.get(pod.id) : null;
}
```
`gateway/src/routes/pods.ts`: extend `pods` Pick with `'lookup'`; inside the `projectPod` branch, before the ensure call:
```ts
const lookup = new URL(url, 'http://localhost').searchParams.get('lookup') === '1';
if (method === 'GET' && lookup) {
  const detail = deps.pods.lookup(decode(projectPod[1]));
  if (!detail) throw new PodError(404, 'pod not found');
  sendJson(res, 200, detail);
  return true;
}
```

- [ ] **Step 4: Write the failing route + SDK tests**

Route test in `gateway/tests/unit/routes/pods.test.ts`:
```ts
test('GET /api/projects/:id/pod?lookup=1 returns 404 when the pod is absent', async () => {
  const { deps, res } = makeDeps({ lookup: () => null });
  await handlePods(req('GET', '/api/projects/p1/pod?lookup=1'), res, '/api/projects/p1/pod?lookup=1', deps);
  expect(res.statusCode).toBe(404);
});
```
SDK tests in `packages/gateway-sdk/src/client.test.ts`:
```ts
test('pod.lookup uses the non-creating query and readMemoryFile reads one file', async () => {
  const c = new MafwClient('http://gw:3000');
  fetchMock.mockResolvedValue(okJson({ pod: { id: 'pod_1' } }));
  await c.pod.lookup('p1');
  expect(fetchMock).toHaveBeenLastCalledWith('http://gw:3000/api/projects/p1/pod?lookup=1', expect.anything());
  await c.pod.readMemoryFile('pod_1', 'POD');
  expect(fetchMock).toHaveBeenLastCalledWith('http://gw:3000/api/pods/pod_1/memory?file=POD', expect.anything());
});
```

- [ ] **Step 5: Run tests to verify they fail**

```text
cd gateway
npx jest tests/unit/routes/pods.test.ts --runInBand
cd ../packages/gateway-sdk
node --import tsx --require ../../packages/test-shim/require-hook.cjs --test src/client.test.ts
```
Expected: FAIL (`lookup`/`readMemoryFile` missing).

- [ ] **Step 6: Implement SDK + preload**

`types.ts` `PodNamespace`: add
```ts
lookup(projectID: string): Promise<PodDetail>
readMemoryFile(podID: string, file: 'POD' | 'MEMORY' | 'GLOSSARY'): Promise<{ content: string }>
```
`client.ts`:
```ts
lookup: async (projectID: string): Promise<PodDetail> =>
  this.request<PodDetail>(`/api/projects/${encodeURIComponent(projectID)}/pod?lookup=1`),
readMemoryFile: async (podID: string, file: 'POD' | 'MEMORY' | 'GLOSSARY'): Promise<{ content: string }> =>
  this.request<{ content: string }>(`/api/pods/${encodeURIComponent(podID)}/memory?file=${file}`),
```
`mafw-api.ts`:
```ts
lookup: (projectID) => invoke("pod", "lookup", projectID),
readMemoryFile: (podID, file) => invoke("pod", "readMemoryFile", podID, file),
```
Extend `packages/desktop/tests/pod-preload-wiring.test.ts` to assert `invoke("pod", "lookup"` and `invoke("pod", "readMemoryFile"`.

- [ ] **Step 7: Run tests to verify they pass**

```text
cd gateway
npx jest tests/unit/pod/pod-service.test.ts tests/unit/routes/pods.test.ts --runInBand
cd ../packages/gateway-sdk
node --import tsx --require ../../packages/test-shim/require-hook.cjs --test src/client.test.ts
cd ../desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-preload-wiring.test.ts
```
Expected: PASS.

- [ ] **Step 8: Commit**

```text
git add gateway/src/core/pod/pod-service.ts gateway/src/routes/pods.ts gateway/tests/unit/pod/pod-service.test.ts gateway/tests/unit/routes/pods.test.ts packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/client.test.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/tests/pod-preload-wiring.test.ts
git commit -m "feat(pod): add non-creating lookup and per-file memory read"
```

---

### Task 2: Add the「鲸群」execution section

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/workbench-views.ts`
- Modify: `packages/desktop/src/renderer/mafw/workbench-views.test.ts`
- Modify: `packages/desktop/tests/design-contract.test.ts:803`

**Interfaces:**
- Produces: `ExecutionSection` includes `"pod"`; `EXECUTION_SECTIONS` order is `overview, pod, todos, subagents, background, trajectory`.

- [ ] **Step 1: Update the failing assertions**

In `workbench-views.test.ts`:
```ts
assert.deepEqual(
  EXECUTION_SECTIONS.map((s) => s.label),
  ["概览", "鲸群", "待办", "子代理", "后台", "轨迹"],
);
assert.equal(executionSectionLabel("pod"), "鲸群");
assert.equal(normalizeExecutionSection("pod"), "pod");
```
In `design-contract.test.ts` line ~803, add `"pod"` to the `t` array.

- [ ] **Step 2: Run tests to verify they fail**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/workbench-views.test.ts tests/design-contract.test.ts
```
Expected: FAIL (missing `pod`).

- [ ] **Step 3: Implement**

`workbench-views.ts`:
```ts
export type ExecutionSection = "overview" | "pod" | "todos" | "subagents" | "background" | "trajectory"
...
export const EXECUTION_SECTIONS = [
  { id: "overview", label: "概览" },
  { id: "pod", label: "鲸群" },
  { id: "todos", label: "待办" },
  { id: "subagents", label: "子代理" },
  { id: "background", label: "后台" },
  { id: "trajectory", label: "轨迹" },
] as const
```

- [ ] **Step 4: Run tests to verify they pass**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/workbench-views.test.ts tests/design-contract.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add packages/desktop/src/renderer/mafw/workbench-views.ts packages/desktop/src/renderer/mafw/workbench-views.test.ts packages/desktop/tests/design-contract.test.ts
git commit -m "feat(pod): add pod execution section"
```

---

### Task 3: Pod model (pure helpers)

**Files:**
- Create: `packages/desktop/src/renderer/mafw/pod-model.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-model.test.ts`

**Interfaces:**
- Consumes: `PodDetail`, `PodGoal`, `PodMember`, `PodMemberRole`, `PodSession`, `PodTask`, `PodTaskStatus` from `@mafw/sdk`.
- Produces:
  ```ts
  export const POD_TASK_LANES: readonly { id: PodTaskLane; label: string; statuses: PodTaskStatus[] }[]
  export type PodTaskLane = "todo" | "in_progress" | "review" | "done" | "failed"
  export function groupPodTasks(tasks: PodTask[]): Array<{ id: PodTaskLane; label: string; tasks: PodTask[] }>
  export function podEventPodId(event: unknown): string | null
  export function podEventAction(input: { currentPodId: string | null; projectDir: string | null; event: unknown }): "refresh" | "lookup" | "ignore"
  export function podHttpStatus(err: unknown): number | null
  export function podIsUnsupported(err: unknown): boolean
  export function memberOpenTarget(detail: PodDetail, memberId: string): { kind: "session" | "transcript"; sessionId: string } | null
  export function podRoleForSession(detail: PodDetail | null, sessionID: string): PodMemberRole | null
  export function podMemberName(detail: PodDetail, memberId: string | null): string
  export function podRoleBadge(role: PodMemberRole): string
  export function podRoleLabel(role: PodMemberRole): string
  export function podStatusLabel(status: string): string
  export function podMemberStatusLabel(status: string): string
  export function podTaskStatusLabel(status: PodTaskStatus): string
  export function podGoalStatusLabel(status: string): string
  export function formatPodCost(cost: { spentUsd: number; limitUsd: number } | null): string
  export function podShortTime(iso: string | null, nowMs: number): string
  export function podTaskArtifacts(task: PodTask): string[]
  ```

- [ ] **Step 1: Write the failing test**

`pod-model.test.ts`:
```ts
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import type { PodTaskStatus } from "@mafw/sdk"
import { groupPodTasks, podEventAction, podEventPodId, podIsUnsupported, memberOpenTarget, podRoleBadge, formatPodCost, podShortTime } from "./pod-model"

const task = (id: string, status: PodTaskStatus, updatedAt = "2026-10-30T00:00:00.000Z") => ({
  id, podId: "pod_1", goalId: null, sourceKey: `manual:${id}`, externalTaskId: null, title: id,
  description: null, ownerMemberId: null, status, dependenciesJson: null, artifactRefsJson: null,
  createdAt: "2026-10-30T00:00:00.000Z", updatedAt,
})

describe("pod-model", () => {
  test("groups tasks into five ordered lanes", () => {
    const lanes = groupPodTasks([task("a","pending"), task("b","blocked"), task("c","review"), task("d","done"), task("e","failed"), task("f","reopened")])
    assert.deepEqual(lanes.map(l => l.id), ["todo","in_progress","review","done","failed"])
    assert.deepEqual(lanes.map(l => l.tasks.map(t => t.id)), [["a","f"],["b"],["c"],["d"],["e"]])
  })
  test("event action refreshes a matching pod, looks up when empty, ignores without project", () => {
    const event = { type: "pod.updated", properties: { podId: "pod_1" } }
    assert.equal(podEventPodId(event), "pod_1")
    assert.equal(podEventAction({ currentPodId: "pod_1", projectDir: "/p", event }), "refresh")
    assert.equal(podEventAction({ currentPodId: null, projectDir: "/p", event }), "lookup")
    assert.equal(podEventAction({ currentPodId: null, projectDir: null, event }), "ignore")
  })
  test("detects unsupported gateway from HTTP 404 errors", () => {
    assert.equal(podIsUnsupported(new Error("HTTP 404: Not Found")), true)
    assert.equal(podIsUnsupported(new Error("HTTP 404: project is not registered: /p")), false)
    assert.equal(podIsUnsupported(new Error("HTTP 500: boom")), false)
  })
  test("prefers a live session, falls back to an ended snapshot", () => {
    const detail = {
      members: [{ id: "m1", role: "builder" }],
      sessions: [
        { memberId: "m1", sessionId: "old", endedAt: "2026-10-30T00:00:00.000Z", transcriptRef: "/x.json" },
        { memberId: "m1", sessionId: "live", endedAt: null, transcriptRef: null },
      ],
    } as any
    assert.deepEqual(memberOpenTarget(detail, "m1"), { kind: "session", sessionId: "live" })
    detail.sessions[1].endedAt = "2026-10-30T00:10:00.000Z"
    detail.sessions[1].transcriptRef = "/live.json"
    assert.deepEqual(memberOpenTarget(detail, "m1"), { kind: "transcript", sessionId: "live" })
  })
  test("formats role badges, cost, and short times", () => {
    assert.equal(podRoleBadge("lead"), "L")
    assert.equal(podRoleBadge("builder"), "B")
    assert.equal(podRoleBadge("reviewer"), "R")
    assert.equal(formatPodCost({ spentUsd: 2.4, limitUsd: 20 }), "$2.40 / $20.00")
    assert.equal(formatPodCost({ spentUsd: 2.4, limitUsd: 0 }), "$2.40 / 不限")
    assert.equal(podShortTime("2026-10-30T00:00:00.000Z", Date.parse("2026-10-30T00:00:30.000Z")), "刚刚")
    assert.equal(podShortTime("2026-10-30T00:00:00.000Z", Date.parse("2026-10-30T00:05:00.000Z")), "5m")
    assert.equal(podShortTime("2026-10-29T00:00:00.000Z", Date.parse("2026-10-30T03:00:00.000Z")), "1d")
    assert.equal(podShortTime(null, Date.now()), "")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-model.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `pod-model.ts`**

Rules:
- Lane order is `POD_TASK_LANES`; tasks inside a lane sorted by `createdAt` ascending (stable tie-break by `id`).
- `memberOpenTarget`: live session (`!endedAt`) wins; else the newest ended session with `transcriptRef`; else `null`.
- `podRoleForSession` matches `detail.sessions` then `detail.members`; returns `null` when unknown.
- `podEventPodId` reads `event.properties.podId`, then `event.data.properties.podId`, then `event.podId`.
- `podHttpStatus` parses `/HTTP (\d{3})/` from `err.message`; `podIsUnsupported` is a 404 **excluding** `project is not registered`（未注册项目的 404 不是版本问题）.
- `formatPodCost`: `$x.xx / $y.yy`, or `$x.xx / 不限` when `limitUsd <= 0`; `null` → `—`.
- `podShortTime`: `<60s` 刚刚, `<60m` `Nm`, `<24h` `Nh`, else `Nd`; invalid/null → `""`.

- [ ] **Step 4: Run test to verify it passes**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-model.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add packages/desktop/src/renderer/mafw/pod-model.ts packages/desktop/src/renderer/mafw/pod-model.test.ts
git commit -m "feat(pod): add desktop pod model helpers"
```

---

### Task 4: Transcript snapshot model

**Files:**
- Create: `packages/desktop/src/renderer/mafw/pod-transcript.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-transcript.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PodTranscriptTurn = { role: "user" | "assistant" | "other"; text: string }
  export function transcriptTurns(snapshot: unknown): PodTranscriptTurn[]
  ```

- [ ] **Step 1: Write the failing test**

`pod-transcript.test.ts`:
```ts
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { transcriptTurns } from "./pod-transcript"

describe("transcriptTurns", () => {
  test("renders {info, parts} snapshots", () => {
    const turns = transcriptTurns({ messages: [
      { info: { role: "user" }, parts: [{ type: "text", text: "hello" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "hi" }, { type: "tool", tool: "bash" }] },
    ] })
    assert.deepEqual(turns, [
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi" },
    ])
  })
  test("renders {role, content} snapshots and ignores empty/unavailable", () => {
    assert.deepEqual(transcriptTurns({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: [{ type: "text", text: "b" }] }] }),
      [{ role: "user", text: "a" }, { role: "assistant", text: "b" }])
    assert.deepEqual(transcriptTurns({ messages: [], unavailable: true }), [])
    assert.deepEqual(transcriptTurns(null), [])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-transcript.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `transcriptTurns`**

- Accept `snapshot.messages` or a bare array.
- Role: `message.info?.role ?? message.role ?? "other"`; map `user`/`assistant`, else `other`.
- Text: `parts` text entries (`type === "text"` or a string `text`), or `content` string / content text entries, or `text`.
- Trim, drop empty turns, join multiple text blocks with `\n`.

- [ ] **Step 4: Run test to verify it passes**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-transcript.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add packages/desktop/src/renderer/mafw/pod-transcript.ts packages/desktop/src/renderer/mafw/pod-transcript.test.ts
git commit -m "feat(pod): parse transcript snapshots"
```

---

### Task 5: Pod store (lookup/ensure/refresh/event debounce)

**Files:**
- Create: `packages/desktop/src/renderer/mafw/pod-store.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-store.test.ts`

**Interfaces:**
- Consumes: `PodDetail`, `PodStatus` from `@mafw/sdk`; `podEventAction`, `podIsUnsupported` from `./pod-model`.
- Produces:
  ```ts
  export type PodStoreApi = {
    lookup(projectDir: string): Promise<PodDetail>
    ensure(projectDir: string): Promise<PodDetail>
    get(podId: string): Promise<PodDetail>
    update(podId: string, body: { status: PodStatus }): Promise<PodDetail>
    cost(podId: string): Promise<{ spentUsd: number; limitUsd: number }>
  }
  export type PodStoreTimers = { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void }
  export function createPodStore(api: PodStoreApi, opts?: { debounceMs?: number; timers?: PodStoreTimers })
  export const podStore: ReturnType<typeof createPodStore> // singleton wired to window.api.mafw.pod
  ```
  Store methods/accessors: `open(projectDir)`, `create()`, `refresh()`, `setStatus(status)`, `ingest(event)`, `dispose()`, `detail()`, `cost()`, `loading()`, `error()`, `unsupported()`, `projectDir()`.

- [ ] **Step 1: Write the failing test**

`pod-store.test.ts` with a fake API and immediate timers:
```ts
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createPodStore, type PodStoreApi } from "./pod-store"

const detail = (id: string, projectDir = "/p") => ({ pod: { id, projectDir, status: "active" }, members: [], goals: [], tasks: [], sessions: [] }) as any

function harness(overrides: Partial<PodStoreApi> = {}) {
  const calls: string[] = []
  const api: PodStoreApi = {
    lookup: async (dir) => { calls.push(`lookup:${dir}`); return detail("pod_1", dir) },
    ensure: async (dir) => { calls.push(`ensure:${dir}`); return detail("pod_1", dir) },
    get: async (id) => { calls.push(`get:${id}`); return detail(id) },
    update: async (id, body) => { calls.push(`update:${id}:${body.status}`); return detail(id) },
    cost: async (id) => ({ spentUsd: 1, limitUsd: 10 }),
    ...overrides,
  }
  const timers = { setTimeout: (fn: () => void) => { fn(); return 0 }, clearTimeout: () => {} }
  return { store: createPodStore(api, { debounceMs: 200, timers }), calls }
}

test("open uses lookup and never ensure; create calls ensure once", async () => {
  const { store, calls } = harness()
  await store.open("/p")
  assert.equal(store.detail()?.pod.id, "pod_1")
  assert.deepEqual(calls, ["lookup:/p"])
  await store.create()
  assert.deepEqual(calls, ["lookup:/p", "ensure:/p"])
})

test("lookup 404 is an empty state; ensure 404 is unsupported", async () => {
  const { store } = harness({ lookup: async () => { throw new Error("HTTP 404: Not Found") }, ensure: async () => { throw new Error("HTTP 404: Not Found") } })
  await store.open("/p")
  assert.equal(store.detail(), null)
  assert.equal(store.unsupported(), false)
  await store.create()
  assert.equal(store.unsupported(), true)
})

test("event bursts coalesce into one refresh", async () => {
  // Manual timer: the first two scheduled callbacks are cancelled by the store.
  const calls: string[] = []
  const pending: Array<() => void> = []
  const manual = createPodStore({
    lookup: async () => detail("pod_1"),
    ensure: async () => detail("pod_1"),
    get: async (id) => { calls.push(`get:${id}`); return detail(id) },
    update: async (id) => detail(id),
    cost: async () => ({ spentUsd: 0, limitUsd: 0 }),
  }, {
    debounceMs: 200,
    timers: {
      setTimeout: (fn) => { pending.push(fn); return pending.length },
      clearTimeout: (h) => { pending[(h as number) - 1] = () => {} },
    },
  })
  await manual.open("/p")
  const event = { type: "pod.updated", properties: { podId: "pod_1" } }
  manual.ingest(event); manual.ingest(event); manual.ingest(event)
  for (const fn of pending) fn()
  assert.deepEqual(calls, ["get:pod_1"])
})

test("unknown pod with no detail triggers lookup", async () => {
  const { store, calls } = harness({ lookup: async () => { throw new Error("HTTP 404: Not Found") } })
  await store.open("/p")
  store.ingest({ type: "pod.updated", properties: { podId: "pod_9" } })
  assert.deepEqual(calls, ["lookup:/p", "lookup:/p"])
})

test("late lookup from the previous project is dropped", async () => {
  let resolveA: (v: any) => void = () => {}
  const a = new Promise((resolve) => { resolveA = resolve })
  const { store } = harness({
    lookup: async (dir) => (dir === "/a" ? (a as any) : detail("pod_b", "/b")),
  })
  const opening = store.open("/a")
  await store.open("/b")
  resolveA(detail("pod_a", "/a"))
  await opening
  assert.equal(store.detail()?.pod.id, "pod_b")
})
```

- [ ] **Step 2: Run test to verify it fails**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-store.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `pod-store.ts`**

- `open(dir)`: ignore when `dir === projectDir()` and a detail is already loaded; on project change clear detail/cost/error/unsupported, bump `seq`; call `lookup`; 404 → empty state; other → error.
- `create()`: requires `projectDir()`; calls `ensure`; 404 → `unsupported=true`, error `当前 gateway 不支持 Pod`; success sets detail + cost.
- `refresh()`: calls `get(detail.pod.id)`; failure keeps detail, sets error.
- `setStatus`: calls `update`; updates detail; failure sets error.
- `ingest(event)`: `podEventAction`; `refresh` → schedule `refresh`; `lookup` → schedule `open(projectDir)`; `ignore` → no-op. One pending timer; event bursts collapse into one trailing call.
- After every successful detail load, fetch cost in parallel (failure → cost null).
- Request guard: capture `seq`; only apply responses when still current.
- Singleton `podStore` with `window.api.mafw.pod`.

- [ ] **Step 4: Run test to verify it passes**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-store.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add packages/desktop/src/renderer/mafw/pod-store.ts packages/desktop/src/renderer/mafw/pod-store.test.ts
git commit -m "feat(pod): add pod store with event coalescing"
```

---

### Task 6: Task board + goal queue component

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/PodTaskBoard.tsx`
- Test: `packages/desktop/tests/pod-task-board-wiring.test.ts`

**Interfaces:**
- Consumes: `groupPodTasks`, `podTaskStatusLabel`, `podMemberName`, `podTaskArtifacts` from `../pod-model`; `PodTask`, `PodGoal`, `PodMember` from `@mafw/sdk`.
- Produces:
  ```ts
  export function PodGoalQueue(props: { goals: PodGoal[]; onOpenGoal: (goalId: string) => void })
  export function PodTaskBoard(props: {
    tasks: PodTask[]
    members: PodMember[]
    busy: boolean
    onCreate: (title: string) => Promise<void>
    onOpenGoal: (goalId: string) => void
  })
  ```

- [ ] **Step 1: Write the failing wiring test**

`packages/desktop/tests/pod-task-board-wiring.test.ts`:
```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const src = readFileSync(new URL("../src/renderer/mafw/components/PodTaskBoard.tsx", import.meta.url), "utf8")
test("task board uses model grouping and V2 primitives", () => {
  assert.match(src, /groupPodTasks/)
  assert.match(src, /POD_TASK_LANES|groupPodTasks/)
  assert.match(src, /TextInputV2/)
  assert.match(src, /ButtonV2/)
  assert.match(src, /onCreate/)
  assert.match(src, /onOpenGoal/)
  assert.doesNotMatch(src, /<button[\s>]/)
  assert.doesNotMatch(src, /title=/)
})
```
(Import the file lazily inside the test if the runner needs it to exist first.)

- [ ] **Step 2: Run test to verify it fails**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-task-board-wiring.test.ts
```
Expected: FAIL (file missing).

- [ ] **Step 3: Implement**

- `PodGoalQueue`: active + queued first, then up to 3 recent done/aborted; each row is a `div role="button"` with goal id + status badge; Enter/Space opens.
- `PodTaskBoard`: header with `新建` button; when open, `TextInputV2` + `添加`/`取消`; `onCreate` resolves then closes; catch handled by parent toast.
- Lanes: `groupPodTasks`; lane header `label (count)`; task card shows title, owner name, artifacts count; goalId card clickable to `onOpenGoal`; use `role="button"` + `tabIndex` + keyboard.
- All text via i18n-free Chinese literals.

- [ ] **Step 4: Run test to verify it passes**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-task-board-wiring.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add packages/desktop/src/renderer/mafw/components/PodTaskBoard.tsx packages/desktop/tests/pod-task-board-wiring.test.ts
git commit -m "feat(pod): add task board and goal queue"
```

---

### Task 7: Inbox component

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/PodInbox.tsx`
- Test: `packages/desktop/tests/pod-inbox-wiring.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function PodInbox(props: {
    detail: PodDetail
    busy: boolean
    onSend: (input: { kind: string; toMemberId: string | null; body: string }) => Promise<void>
  })
  ```
- Sender is the `lead` member in `detail.members`; recipient select includes「广播」and the other members.

- [ ] **Step 1: Write the failing wiring test**

Assert file exists and contains `SelectV2`, `TextInputV2` (or `textarea`), `Broadcast/广播`, `kind`, `onSend`, `podMemberName`, and no raw `<button>` / bare `title=`.

- [ ] **Step 2: Run test to verify it fails**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-inbox-wiring.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

- Message list: newest first; row shows `From → To` (or `广播`), kind chip, `podShortTime(createdAt, Date.now())`, body.
- Compose: `SelectV2` for kind (note/request/review/decision/escalation) and recipient (broadcast + members), `<textarea class="mafw-pod-inbox-input">`, send `ButtonV2` disabled when body empty or `busy`.
- On send, call `onSend`; clear body on success; on error show `showToastV2` and keep text.
- No lead → compose hidden with hint `缺少 Lead 成员`.

- [ ] **Step 4: Run test to verify it passes; commit**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-inbox-wiring.test.ts
git add packages/desktop/src/renderer/mafw/components/PodInbox.tsx packages/desktop/tests/pod-inbox-wiring.test.ts
git commit -m "feat(pod): add pod inbox"
```

---

### Task 8: Memory panel component

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/PodMemoryPanel.tsx`
- Test: `packages/desktop/tests/pod-memory-panel-wiring.test.ts`

**Interfaces:**
- Produces: `export function PodMemoryPanel(props: { podId: string })`
- Uses `window.api.mafw.pod.readMemoryFile(podId, file)` and `writeMemory(podId, { file, content })`.

- [ ] **Step 1: Write the failing wiring test**

Assert `readMemoryFile`, `writeMemory`, `showToastV2`, three file labels, `TextInputV2`? (no; textarea allowed), `mafw-pod-memory`, and no raw `<button>`.

- [ ] **Step 2: Run test to verify it fails**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-memory-panel-wiring.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

- Tab bar `POD` / `MEMORY` / `GLOSSARY` using `ButtonV2` with `aria-pressed`.
- Load on tab activation; cache content per file; loading spinner; error text.
- View mode `<pre class="mafw-pod-memory-view">`; empty shows placeholder.
- Edit mode `<textarea class="mafw-pod-memory-editor">`; save/cancel; save disables while busy; toast success/error; on success update cache and leave edit.
- `podId` change resets cache.

- [ ] **Step 4: Run test; commit**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-memory-panel-wiring.test.ts
git add packages/desktop/src/renderer/mafw/components/PodMemoryPanel.tsx packages/desktop/tests/pod-memory-panel-wiring.test.ts
git commit -m "feat(pod): add pod memory panel"
```

---

### Task 9: Transcript overlay

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/PodTranscriptOverlay.tsx`
- Test: `packages/desktop/tests/pod-transcript-overlay-wiring.test.ts`

**Interfaces:**
- Produces: `export function PodTranscriptOverlay(props: { podId: string; sessionId: string; onClose: () => void })`
- Uses `window.api.mafw.pod.transcript(podId, sessionId)` + `transcriptTurns`.

- [ ] **Step 1: Write the failing wiring test**

Assert `pod.transcript`, `transcriptTurns`, `LoaderV2`, `mafw-pod-transcript`, Escape handler, and backdrop click close.

- [ ] **Step 2: Run test to verify it fails**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-transcript-overlay-wiring.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

- Fetch on mount/session change; loading/error states.
- Render turns with role label (用户 / 助手 / 其他) + pre-wrap text.
- Empty →「该会话没有可用快照」.
- Esc and backdrop click close; stop propagation inside the panel.

- [ ] **Step 4: Run test; commit**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-transcript-overlay-wiring.test.ts
git add packages/desktop/src/renderer/mafw/components/PodTranscriptOverlay.tsx packages/desktop/tests/pod-transcript-overlay-wiring.test.ts
git commit -m "feat(pod): add transcript snapshot overlay"
```

---

### Task 10: PodDock composition

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/PodDock.tsx`
- Test: `packages/desktop/tests/pod-dock-wiring.test.ts`

**Interfaces:**
- Consumes: `podStore`, `podMemberName`, `podRoleLabel`, `podStatusLabel`, `podMemberStatusLabel`, `memberOpenTarget`, `formatPodCost`, `podShortTime`; `PodTaskBoard`, `PodGoalQueue`, `PodInbox`, `PodMemoryPanel`, `PodTranscriptOverlay`.
- Produces: `export function PodDock(props: { projectDir: string | null; onOpenSession: (sid: string) => void; onOpenGoal: (goalId: string) => void })`.

- [ ] **Step 1: Write the failing wiring test**

Assert imports and behavior hooks:
```ts
assert.match(src, /podStore\.open/)
assert.match(src, /DockPanelHeader/)
assert.match(src, /DockEmpty/)
assert.match(src, /PodTaskBoard/)
assert.match(src, /PodInbox/)
assert.match(src, /PodMemoryPanel/)
assert.match(src, /PodTranscriptOverlay/)
assert.match(src, /memberOpenTarget/)
assert.doesNotMatch(src, /setInterval/)
assert.doesNotMatch(src, /<button[\s>]/)
```

- [ ] **Step 2: Run test to verify it fails**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-dock-wiring.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

- `createEffect(() => { const dir = props.projectDir; if (dir) void podStore.open(dir) })`.
- Header: `DockPanelHeader title={`鲸群 · ${pod.name}`}`; actions: refresh (disabled while loading), sleep/wake (`podStore.setStatus`), status badge.
- Status line: pod status, active goal id, queued count, cost.
- Members list: role, display name, agent name, status; `memberOpenTarget` on click/Enter/Space; ended target opens local transcript state.
- Sub-panels: `PodGoalQueue`, `PodTaskBoard`, `PodInbox`, `PodMemoryPanel`.
- Create-task `onCreate`: `window.api.mafw.pod.createTask(podId, { title })` then `podStore.refresh()`; error toast.
- Send message: `window.api.mafw.pod.sendMessage(podId, { fromMemberId: lead.id, toMemberId, kind, body })` then `podStore.refresh()`.
- Empty/no-pod/unsupported branches per spec §7; create button calls `podStore.create()`.
- `PodDock` renders nothing modally except transcript overlay.

- [ ] **Step 4: Run test; commit**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-dock-wiring.test.ts
git add packages/desktop/src/renderer/mafw/components/PodDock.tsx packages/desktop/tests/pod-dock-wiring.test.ts
git commit -m "feat(pod): compose pod dock panel"
```

---

### Task 11: Shell wiring + SessionStrip badge + Goal overlay

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ExecutionView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/SessionStrip.tsx`
- Test: `packages/desktop/tests/pod-panel-wiring.test.ts`
- Modify: `packages/desktop/tests/execution-view-wiring.test.ts`

**Interfaces:**
- `ExecutionViewProps` adds `projectDir: string | null`, `onOpenGoal: (goalId: string) => void`, and `onOpenPodSession: (sid: string) => void`.
- `ExecutionView` renders `<PodDock projectDir={props.projectDir} onOpenSession={props.onOpenPodSession} onOpenGoal={props.onOpenGoal} />` in a `mafw-rw-exec-section` with `is-active` for `section === "pod"`.
- `MafwShell` passes `onOpenPodSession={openSessionTab}` (live member sessions open as tabs; do not reuse the subagent back-stack).
- `SessionStrip` adds `podRoleOf?: (sessionId: string) => PodMemberRole | null`.

- [ ] **Step 1: Write the failing wiring test**

`pod-panel-wiring.test.ts`:
```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("shell routes pod.updated, project scope, sessions, goals, and badges", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /sseDeps[\s\S]*pod:\s*\{\s*onEvent:\s*\(event\)\s*=>\s*ingestPodEvent/)
  assert.match(shell, /projectDir=\{benchRoot\(\)/)
  assert.match(shell, /onOpenPodSession=\{openSessionTab\}/)
  assert.match(shell, /podRoleOf=\{/)
  assert.match(shell, /<GoalDetailOverlay/)
  assert.match(shell, /setPodGoalId/)
})
test("execution view renders PodDock in its own section", () => {
  const src = read("src/renderer/mafw/components/ExecutionView.tsx")
  assert.match(src, /<PodDock/)
  assert.match(src, /section === "pod"/)
})
test("SessionStrip accepts a pod role accessor and renders a badge", () => {
  const src = read("src/renderer/mafw/components/SessionStrip.tsx")
  assert.match(src, /podRoleOf/)
  assert.match(src, /mafw-session-pod-badge/)
})
```

- [ ] **Step 2: Run test to verify it fails**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-panel-wiring.test.ts tests/execution-view-wiring.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement wiring**

- `ExecutionView`: add `projectDir`, `onOpenGoal`, `onOpenPodSession`; render `PodDock` section after overview; import `PodDock`.
- `MafwShell`:
  - import `PodDock` not needed; import `ingestPodEvent`, `podRoleForSession` from `./pod-store` / `./pod-model` (choose `podRoleForSession` from model + `podStore.detail()`).
  - replace `pod: { onEvent: () => {} }` with `pod: { onEvent: (event) => ingestPodEvent(event) }`.
  - pass `projectDir={benchRoot() ?? currentProject()}`, `onOpenGoal={(id) => setPodGoalId(id)}`, and `onOpenPodSession={openSessionTab}` to `ExecutionView`.
  - add `const [podGoalId, setPodGoalId] = createSignal<string | null>(null)` and render `<GoalDetailOverlay goalId={podGoalId()} onClose={() => setPodGoalId(null)} onOpenSession={(sid) => openSessionTab(sid)} />` near other overlays.
  - pass `podRoleOf={(id) => podRoleForSession(podStore.detail(), id)}` to `SessionStrip`.
- `SessionStrip`: accept `podRoleOf`; after title render `<Show when={props.podRoleOf?.(s.id)}>` a `TooltipV2` + `<span class="mafw-session-pod-badge">{podRoleBadge(role)}</span>`.

- [ ] **Step 4: Run test; run desktop suite for regressions**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-panel-wiring.test.ts tests/execution-view-wiring.test.ts
npm test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/ExecutionView.tsx packages/desktop/src/renderer/mafw/components/SessionStrip.tsx packages/desktop/tests/pod-panel-wiring.test.ts packages/desktop/tests/execution-view-wiring.test.ts
git commit -m "feat(pod): wire pod panel into shell and session strip"
```

---

### Task 12: Styles + full verification + delivery notes

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/tests/pod-panel-css.test.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces CSS classes: `.mafw-pod-dock`, `.mafw-pod-status`, `.mafw-pod-members`, `.mafw-pod-member`, `.mafw-pod-member-status`, `.mafw-pod-board`, `.mafw-pod-lane`, `.mafw-pod-lane-head`, `.mafw-pod-task`, `.mafw-pod-inbox`, `.mafw-pod-message`, `.mafw-pod-memory`, `.mafw-pod-memory-view`, `.mafw-pod-memory-editor`, `.mafw-pod-transcript`, `.mafw-session-pod-badge`.

- [ ] **Step 1: Write the failing CSS contract test**

```ts
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const css = readFileSync(new URL("../src/renderer/mafw/mafw.css", import.meta.url), "utf8")
const block = (sel: string) => { const i = css.indexOf(sel); if (i < 0) return ""; const a = css.indexOf("{", i); return css.slice(a + 1, css.indexOf("}", a)) }
describe("pod panel css", () => {
  test("board uses an auto-fit grid and tokens", () => {
    assert.match(block(".mafw-pod-board {"), /grid-template-columns: repeat\(auto-fit, minmax\(112px, 1fr\)\)/)
    assert.match(block(".mafw-pod-board {"), /gap: 8px/)
  })
  test("member rows and badge use existing tokens", () => {
    assert.match(block(".mafw-pod-member {"), /var\(--border-subtle\)/)
    assert.match(block(".mafw-session-pod-badge {"), /var\(--accent-soft\)/)
  })
  test("no raw colors in pod blocks", () => {
    for (const sel of [".mafw-pod-dock {", ".mafw-pod-task {", ".mafw-pod-inbox {", ".mafw-pod-memory {"]) {
      assert.doesNotMatch(block(sel), /#[0-9a-f]{3,8}/i, sel)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-panel-css.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Add styles**

- Dock column: `display:flex; flex-direction:column; gap:10px; height:100%; overflow-y:auto; padding:10px 12px;`
- Member rows: card-like with `border: 1px solid var(--border-subtle)`, `border-radius: var(--r-md)`, `background: var(--bg-raised)`, 8px padding; status colors via `var(--accent)` / `var(--warning)` / `var(--text-4)`.
- Board: auto-fit grid `repeat(auto-fit, minmax(112px, 1fr))`; lane header 12px `var(--text-3)`; task card `var(--bg-inset)` + `var(--r-sm)`.
- Inbox/memory/transcript: inset boxes, `--font-data` for memory/transcript, `max-height` scroll regions.
- Badge: 16×16, radius 4px, `font-size: 10px`, accent-soft background.
- No transitions/keyframes. No raw colors. No bare `title` usage.

- [ ] **Step 4: Run contract test**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-panel-css.test.ts tests/design-contract.test.ts
```
Expected: PASS.

- [ ] **Step 5: Full verification**

```text
cd gateway
npx jest tests/unit/pod tests/unit/routes/pods.test.ts --runInBand
cd ../packages/gateway-sdk
npm test
cd ../desktop
npm test
npx tsgo --noEmit -p tsconfig.json
npx electron-vite build
cd ../..
npm run build
```
Expected: all PASS; record suite/test counts.

- [ ] **Step 6: GUI smoke**

Run the desktop dev app and verify at 520 / 640 / 760 dock widths:
- no-Pod project → empty state +「创建鲸群」; no DB row before click;
- create → 3 members;
- real goal run → tasks appear; event refresh without polling;
- member live session opens a tab; ended member opens the transcript snapshot;
- inbox send + memory save round-trip;
- SessionStrip badge visible;
- no horizontal overflow; five lanes collapse to 2 columns at narrow width.

Expected: all pass; note any deviation in the delivery report.

- [ ] **Step 7: Bump the release version**

```text
cd C:\work\work-loop\opencode-plugin-mafw
npm run version:set 4.43.0
npm run version:check
```
Expected: `version:check` exits 0 and all workspace package versions are `4.43.0`.

- [ ] **Step 8: Update `AGENTS.md`**

Add a bullet under §5.5 desktop:「鲸群」panel entry, lookup/ensure semantics, event debounce, components, **v4.43.0 + commit hash + test counts**.

- [ ] **Step 9: Commit**

```text
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/pod-panel-css.test.ts AGENTS.md package.json packages/*/package.json
git commit -m "chore(release): v4.43.0 desktop pod panel"
```

---

## Execution Notes

- Do not add polling; if a refresh seems missing, fix the event path, not a timer.
- Never call `pod.ensure` on mount; only the explicit create action.
- Keep `PodDock` a composition layer; algorithms belong in `pod-model.ts` / `pod-store.ts`.
- Keep all user-visible strings in the existing Chinese UI style; do not introduce emoji in dock panels.
- If the SDK generated types complain about the query suffix, use the existing `ApiPath` query-suffix allowance (see `api-path.ts`), do not cast to `any`.
