# Pod A2A Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship A2A-based task handoff for Pod: one Pod A2A agent, structured `message/send` handoffs, Pod-authoritative task state, push/pull delivery, and A2A as the default path for `mafw_pod_message`.

**Architecture:** Add a Pod A2A server (`/a2a/pods/:podId`) built on the existing `@a2a-js/sdk` Media Agent patterns. A bridge maps A2A Message/Task/Artifact to PodStore/TaskService/MessageService; Pod task remains the source of truth. A delivery service pushes to long-lived coordination sessions and injects pending handoffs into NodeDriver node prompts. Long-term harmonic memory is untouched.

**Tech Stack:** TypeScript, Node 22, better-sqlite3, `@a2a-js/sdk` (`AgentCard`, `DefaultRequestHandler`, `JsonRpcTransportHandler`, `TaskStore`), Jest, plugin tools, desktop SDK/preload.

**Spec:** `docs/superpowers/specs/2026-10-30-pod-a2a-handoff-design.md`

## Global Constraints

- **Pod task is authoritative**; A2A Task is a projection. Never create a second task state machine.
- v1 exposes **one A2A agent per Pod**; member routing via `metadata.toMemberId`. No per-member AgentCard.
- `/a2a/pods/*` is **loopback-only**; external auth/federation is v2.
- **No A2A message/task is written to harmonic memory.** Long-term memory stays `mafw_add_memory` / `<recall>`.
- Delivery: coordination sessions get `promptAsync` with `delivery:'queue'`; NodeDriver `plan/execute/review` sessions get pending handoffs at the next prompt, never an extra push turn.
- `mafw_pod_message` defaults to A2A; fall back to REST only when A2A is unavailable (404/network) and record `protocol`.
- A2A version header `A2A-Version: 1.0`; reuse the existing Media Agent implementation patterns; do not change Media `/a2a`.
- Migrations are idempotent (`ALTER TABLE` guarded by `PRAGMA table_info`); no migration framework.
- Every task: write failing test first, watch it fail, implement minimal code, watch it pass; commit.

## Review Focus

- **Task authority drift:** A2A `tasks/get` and Pod board must agree after create/update/cancel; no independent TaskStore state. Tests: Task 3.
- **Duplicate delivery:** the same A2A `messageId` must create one Pod message and deliver once per session. Tests: Task 3 + Task 4.
- **NodeDriver extra turn:** node sessions must not receive an unsolicited `promptAsync` that could trigger `turn.completed`; pending handoff is injected at the next prompt. Tests: Task 4.
- **Cross-Pod access:** a member of Pod A cannot read/send to Pod B; `toMemberId` must belong to the Pod. Tests: Task 3 + Task 5.
- **Artifact traversal:** artifact download must reject `..`, absolute paths, and paths outside the Pod artifact root. Tests: Task 5.
- **Old gateway fallback:** `mafw_pod_message` must fall back to REST when `/a2a/pods/:id` returns 404/network error, without losing the message. Tests: Task 6.

---

### Task 1: A2A mapping and handoff parsing

**Files:**
- Create: `gateway/src/core/pod/pod-a2a-mapping.ts`
- Test: `gateway/tests/unit/pod/pod-a2a-mapping.test.ts`

**Interfaces:**
- Consumes: `Message`, `Part`, `Task`, `TaskState` from `@a2a-js/sdk`; `PodTask`, `PodTaskStatus`, `PodMemberRole` from `./pod-store`.
- Produces:
  ```ts
  export interface PodHandoffInput {
    kind: 'request' | 'review' | 'decision' | 'escalation' | 'note'
    fromMemberId: string | null
    toMemberId: string | null
    podTaskId: string | null
    goalId: string | null
    title: string | null
    expectedOutput: string | null
    contextRefs: string[]
    artifactRefs: string[]
    acceptance: string[]
    body: string
    messageId: string
    contextId: string | null
  }
  export function parseHandoffMessage(message: Message): PodHandoffInput
  export function a2aStateForPodStatus(status: PodTaskStatus): TaskState
  export function podStatusForA2AState(state: TaskState): PodTaskStatus
  export function buildA2AMessage(input: { messageId; contextId; text; data?; metadata? }): Message
  export function buildA2ATask(input: { task: PodTask; podStatus?: string; artifacts?: { artifactId: string; name?: string; parts: Part[] }[] }): Task
  ```
- `parseHandoffMessage` reads `parts`:
  - text part → `body`
  - data part (object) → structured fields; tolerate missing fields
  - `metadata` → `fromMemberId` / `toMemberId` / `podId`
  - reject malformed data (non-object) with `PodError(400, 'invalid handoff data')`.

- [ ] **Step 1: Write failing tests**

```ts
test('parses text + data + metadata into a handoff', () => {
  const msg = buildA2AMessage({
    messageId: 'msg_1',
    contextId: 'pod:p1:goal:g1',
    text: 'do it',
    data: { kind: 'request', taskId: 't1', goalId: 'g1', title: 'T', expectedOutput: 'out', contextRefs: ['a.md'], acceptance: ['test'] },
    metadata: { fromMemberId: 'm_lead', toMemberId: 'm_builder' },
  });
  expect(parseHandoffMessage(msg)).toMatchObject({
    kind: 'request', fromMemberId: 'm_lead', toMemberId: 'm_builder',
    podTaskId: 't1', goalId: 'g1', title: 'T', expectedOutput: 'out',
    contextRefs: ['a.md'], acceptance: ['test'], body: 'do it',
  });
});

test('maps Pod task status to A2A state and back', () => {
  expect(a2aStateForPodStatus('pending')).toBe(TaskState.TASK_STATE_SUBMITTED);
  expect(a2aStateForPodStatus('in_progress')).toBe(TaskState.TASK_STATE_WORKING);
  expect(a2aStateForPodStatus('done')).toBe(TaskState.TASK_STATE_COMPLETED);
  expect(a2aStateForPodStatus('failed')).toBe(TaskState.TASK_STATE_FAILED);
  expect(podStatusForA2AState(TaskState.TASK_STATE_INPUT_REQUIRED)).toBe('blocked');
  expect(podStatusForA2AState(TaskState.TASK_STATE_COMPLETED)).toBe('done');
});
```

- [ ] **Step 2: Run test to verify it fails**

```text
cd gateway
npx jest tests/unit/pod/pod-a2a-mapping.test.ts --runInBand
```
Expected: FAIL (module missing).

- [ ] **Step 3: Implement mapping**

- Use existing media-agent part helpers as reference (`messageToText`, `Part` shapes).
- `buildA2AMessage` creates `Message` with `role: 1` (user), `parts`, `messageId`, `contextId`, `metadata`, empty `referenceTaskIds`.
- `buildA2ATask` sets `id`, `contextId`, `status: { state, timestamp }`, `history: []`, `artifacts: artifacts ?? []`, `metadata: { podStatus }`.
- `podStatusForA2AState`: `submitted→pending`, `working→in_progress`, `input-required/auth-required→blocked`, `completed→done`, `failed/rejected→failed`, `canceled→failed`.

- [ ] **Step 4: Run test to verify it passes**

```text
cd gateway
npx jest tests/unit/pod/pod-a2a-mapping.test.ts --runInBand
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add gateway/src/core/pod/pod-a2a-mapping.ts gateway/tests/unit/pod/pod-a2a-mapping.test.ts
git commit -m "feat(pod): add A2A handoff mapping"
```

---

### Task 2: PodStore A2A links and message fields

**Files:**
- Modify: `gateway/src/core/pod/pod-store.ts`
- Test: `gateway/tests/unit/pod/pod-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PodA2ALinkRow {
    id: string; podId: string; localKind: 'task' | 'message'; localId: string;
    a2aId: string; contextId: string | null; createdAt: string;
  }
  // PodStore
  linkA2A(input: { id: string; podId: string; localKind: 'task'|'message'; localId: string; a2aId: string; contextId?: string | null; now: string }): void
  getA2ALink(podId: string, localKind: 'task'|'message', localId: string): PodA2ALinkRow | null
  getA2ALocalId(podId: string, localKind: 'task'|'message', a2aId: string): string | null
  listA2ALinks(podId: string, localKind?: 'task'|'message'): PodA2ALinkRow[]
  ```
- `PodMessageRow` adds:
  ```ts
  protocol: string | null
  externalMessageId: string | null
  partsJson: string | null
  deliveredAt: string | null
  deliveredSessionId: string | null
  ```
- `insertMessage` accepts the new optional fields; `listMessages` returns them.

- [ ] **Step 1: Write failing tests**

```ts
test('links a Pod task to an A2A task and finds it both ways', () => {
  const pod = store.ensurePod({ id: 'pod_1', projectDir: '/p', name: 'P', now: NOW });
  store.linkA2A({ id: 'l1', podId: pod.id, localKind: 'task', localId: 'pt1', a2aId: 'a2a_1', contextId: 'c1', now: NOW });
  expect(store.getA2ALink(pod.id, 'task', 'pt1')?.a2aId).toBe('a2a_1');
  expect(store.getA2ALocalId(pod.id, 'task', 'a2a_1')).toBe('pt1');
});

test('stores A2A message fields and dedupes by external message id', () => {
  const pod = store.ensurePod({ id: 'pod_1', projectDir: '/p', name: 'P', now: NOW });
  const m = store.insertMessage({
    id: 'm1', podId: pod.id, fromMemberId: 'lead', toMemberId: null, kind: 'request', body: 'x',
    protocol: 'a2a', externalMessageId: 'a2a_m1', partsJson: '[]', now: NOW,
  });
  expect(store.listMessages(pod.id)[0]).toMatchObject({ protocol: 'a2a', externalMessageId: 'a2a_m1' });
  expect(() => store.insertMessage({ ...m, id: 'm2', now: NOW })).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

```text
cd gateway
npx jest tests/unit/pod/pod-store.test.ts --runInBand
```
Expected: FAIL (schema/methods missing).

- [ ] **Step 3: Implement schema + CRUD**

- `pod_a2a_links` with `UNIQUE(pod_id, local_kind, local_id)` and `UNIQUE(pod_id, local_kind, a2a_id)`.
- Add `pod_messages` columns via `PRAGMA table_info` guard then `ALTER TABLE`.
- Add `UNIQUE(pod_id, external_message_id)`? SQLite cannot add a unique constraint via ALTER; create a unique index where `external_message_id IS NOT NULL`.
- `insertMessage` includes new fields; duplicate external id throws.

- [ ] **Step 4: Run test + existing pod store tests**

```text
cd gateway
npx jest tests/unit/pod/pod-store.test.ts --runInBand
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add gateway/src/core/pod/pod-store.ts gateway/tests/unit/pod/pod-store.test.ts
git commit -m "feat(pod): add A2A link and message fields"
```

---

### Task 3: PodA2ATaskStore + PodA2ABridge

**Files:**
- Create: `gateway/src/core/pod/pod-a2a-task-store.ts`
- Create: `gateway/src/core/pod/pod-a2a-bridge.ts`
- Test: `gateway/tests/unit/pod/pod-a2a-bridge.test.ts`

**Interfaces:**
- `PodA2ATaskStore implements TaskStore`:
  ```ts
  constructor(deps: { bridge: PodA2ABridge });
  save(task: Task, context: ServerCallContext): Promise<void>;
  load(taskId: string, context: ServerCallContext): Promise<Task | undefined>;
  list(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse>;
  ```
- `PodA2ABridge`:
  ```ts
  constructor(deps: {
    store: PodStore; tasks: PodTaskService; messages: PodMessageService;
    access?: PodAccess; delivery?: PodMessageDelivery; now(): string; newId(): string;
    log?(message: string): void;
  });
  async sendMessage(podId: string, message: Message, opts?: { actorSessionID?: string }): Promise<Task | Message>;
  getTask(podId: string, a2aTaskId: string): Task | null;
  cancelTask(podId: string, a2aTaskId: string): Task | null;
  ```
- Behavior:
  - Parse handoff; verify `metadata.podId === podId`; verify `toMemberId` is in pod; actor role if supplied.
  - `kind:'request'`: upsert Pod task by `podTaskId` or create manual task; link A2A task ID; store message; call delivery.
  - Other kinds: store message only; return a Message.
  - Idempotency: if `externalMessageId` exists, return the linked task/message and do not re-deliver.
  - `getTask`/`cancelTask` resolve link → Pod task; no link → 404.

- [ ] **Step 1: Write failing tests**

```ts
test('message/send creates a Pod task, link, and message', async () => {
  const { bridge, store, pod, lead, builder } = makeBridge();
  const task = await bridge.sendMessage(pod.id, handoffMessage({ to: builder.id, taskId: 't1' }));
  expect(task).toMatchObject({ id: expect.any(String), status: { state: TaskState.TASK_STATE_SUBMITTED } });
  expect(store.getTask('t1')).toMatchObject({ title: 'T', status: 'pending' });
  expect(store.listMessages(pod.id)[0]).toMatchObject({ protocol: 'a2a', externalMessageId: 'msg_1' });
  expect(store.getA2ALink(pod.id, 'task', 't1')?.a2aId).toBe(task.id);
});

test('repeated messageId is idempotent', async () => {
  const first = await bridge.sendMessage(pod.id, msg);
  const second = await bridge.sendMessage(pod.id, msg);
  expect(second.id).toBe(first.id);
  expect(store.listMessages(pod.id)).toHaveLength(1);
});

test('getTask maps Pod status; cancel updates the Pod task', async () => {
  const task = await bridge.sendMessage(pod.id, msg);
  store.updateTask('t1', { status: 'in_progress' }, NOW);
  expect(bridge.getTask(pod.id, task.id)?.status?.state).toBe(TaskState.TASK_STATE_WORKING);
  expect(bridge.cancelTask(pod.id, task.id)?.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
  expect(store.getTask('t1')?.status).toBe('failed');
});

test('rejects a member from another pod and unknown toMemberId', async () => {
  await expect(bridge.sendMessage(otherPod.id, msg)).rejects.toMatchObject({ status: 403 });
  await expect(bridge.sendMessage(pod.id, handoffMessage({ to: 'nope' }))).rejects.toMatchObject({ status: 400 });
});
```

- [ ] **Step 2: Run test to verify it fails**

```text
cd gateway
npx jest tests/unit/pod/pod-a2a-bridge.test.ts --runInBand
```
Expected: FAIL.

- [ ] **Step 3: Implement task store + bridge**

- `PodA2ATaskStore.load` → `bridge.getTask`; `save` → no-op (Pod task is authority; reject direct external writes unless `metadata.podStatus` update flows through bridge); `list` → map Pod tasks (filter by contextId).
- `sendMessage` order: parse → access → idempotency → task upsert → link → message → delivery → return task/message.
- Use `PodError` for 400/403/404.
- Delivery failures are logged, not fatal (message remains pending).

- [ ] **Step 4: Run test + pod task/store tests**

```text
cd gateway
npx jest tests/unit/pod/pod-a2a-bridge.test.ts tests/unit/pod/pod-task-service.test.ts tests/unit/pod/pod-store.test.ts --runInBand
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add gateway/src/core/pod/pod-a2a-task-store.ts gateway/src/core/pod/pod-a2a-bridge.ts gateway/tests/unit/pod/pod-a2a-bridge.test.ts
git commit -m "feat(pod): add A2A bridge and task store"
```

---

### Task 4: PodMessageDelivery (push / pull / pending)

**Files:**
- Create: `gateway/src/core/pod/pod-message-delivery.ts`
- Test: `gateway/tests/unit/pod/pod-message-delivery.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DeliveryDecision = 'push' | 'pull' | 'pending';
  export class PodMessageDelivery {
    constructor(deps: {
      store: PodStore;
      getSession(sessionId: string): Promise<{ directory?: string } | null>;
      promptAsync(input: { sessionID: string; message: string; delivery?: 'queue' }): Promise<void>;
      log?(message: string): void;
    });
    decide(messageId: string): DeliveryDecision;
    async deliver(messageId: string): Promise<'delivered' | 'pending' | 'skipped'>;
    async pendingForSession(sessionId: string): Promise<string | null>;
    render(message: PodMessageRow): string;
  }
  ```
- `decide`: coordination session → push; plan/execute/review session → pull; no active session → pending.
- `deliver`: already delivered → skipped; pending/pull → no prompt; push → prompt + mark `delivered_at` / `delivered_session_id`.
- `pendingForSession`: find member by session, unread pending messages, render one block, mark delivered, return block.
- Render format:
  ```
  [POD HANDOFF]
  goal: g123 / task: w1-t2
  from: Lead → Builder
  title: ...
  expected: ...
  context: ...
  acceptance:
  - ...
  <body>
  ```

- [ ] **Step 1: Write failing tests**

```ts
test('pushes to a coordination session once and marks delivered', async () => {
  const { delivery, store, prompts, messageId } = makeDelivery({ node: 'coordination' });
  expect(await delivery.deliver(messageId)).toBe('delivered');
  expect(prompts).toEqual([expect.objectContaining({ delivery: 'queue', message: expect.stringContaining('[POD HANDOFF]') })]);
  expect(store.listMessages('pod_1')[0].deliveredAt).toBeTruthy();
  expect(await delivery.deliver(messageId)).toBe('skipped');
});

test('node session stays pending and is injected at the next prompt', async () => {
  const { delivery, store, prompts, messageId } = makeDelivery({ node: 'execute' });
  expect(await delivery.deliver(messageId)).toBe('pending');
  expect(prompts).toHaveLength(0);
  const block = await delivery.pendingForSession('ses_builder');
  expect(block).toContain('[POD HANDOFF]');
  expect(store.listMessages('pod_1')[0].deliveredAt).toBeTruthy();
  expect(await delivery.pendingForSession('ses_builder')).toBeNull();
});

test('no active session keeps the message pending', async () => {
  const { delivery, messageId } = makeDelivery({ node: null });
  expect(await delivery.deliver(messageId)).toBe('pending');
});
```

- [ ] **Step 2: Run test to verify it fails**

```text
cd gateway
npx jest tests/unit/pod/pod-message-delivery.test.ts --runInBand
```
Expected: FAIL.

- [ ] **Step 3: Implement**

- Use `store.getMemberBySession(sessionId)` + `store.listSessions(podId)`; active session = `!endedAt`.
- Coordination nodes push; plan/execute/review pull.
- `markMessageDelivered` method on PodStore (add if missing).
- Keep delivery failure fail-open: message stays pending, log.

- [ ] **Step 4: Run test + store tests**

```text
cd gateway
npx jest tests/unit/pod/pod-message-delivery.test.ts tests/unit/pod/pod-store.test.ts --runInBand
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add gateway/src/core/pod/pod-message-delivery.ts gateway/tests/unit/pod/pod-message-delivery.test.ts gateway/src/core/pod/pod-store.ts
git commit -m "feat(pod): add handoff delivery"
```

---

### Task 5: Pod A2A agent, routes, AgentCard, artifacts

**Files:**
- Create: `gateway/src/core/pod/pod-a2a-agent.ts`
- Create: `gateway/src/core/pod/pod-a2a-artifacts.ts`
- Create: `gateway/src/routes/pod-a2a.ts`
- Test: `gateway/tests/unit/pod/pod-a2a-agent.test.ts`
- Test: `gateway/tests/unit/routes/pod-a2a.test.ts`

**Interfaces:**
- `PodA2AAgent`:
  ```ts
  constructor(deps: { bridge: PodA2ABridge; pod: PodRow; baseUrl: string; artifactRoot: string });
  get agentCard(): AgentCard;
  handleJsonRpc(payload: unknown, headers: Record<string, string>): Promise<{ status: number; headers: Record<string,string>; body: string }>;
  getArtifact(id: string): { path: string; contentType: string } | null;
  ```
- Routes:
  ```ts
  export function attachPodA2ARoutes(registry: RouteRegistry, deps: { getAgent(podId: string): PodA2AAgent | null }): void;
  ```
  - `POST /a2a/pods/:podId` JSON-RPC
  - `GET /a2a/pods/:podId/.well-known/agent-card.json`
  - `GET /a2a/pods/:podId/artifacts/:id`
- `AgentCard` fields: name `pod-<podId>`, description, url, version `1.0.0`, protocolVersion `1.0`, capabilities `{ streaming: true, pushNotifications: false }`, defaultInputModes `['text','data','file']`, defaultOutputModes `['text','artifact']`, skills handoff/status.

- [ ] **Step 1: Write failing agent test**

```ts
test('agent card advertises handoff and the JSON-RPC endpoint', () => {
  const agent = makeAgent();
  expect(agent.agentCard.name).toContain('pod-');
  expect(agent.agentCard.capabilities?.streaming).toBe(true);
  expect(agent.agentCard.skills?.map((s) => s.id)).toContain('pod.handoff');
});

test('message/send returns a task for kind=request and tasks/get round-trips', async () => {
  const send = await agent.handleJsonRpc(jsonRpc('message/send', { message: handoffMessage(...) }), { 'a2a-version': '1.0' });
  expect(send.status).toBe(200);
  const task = JSON.parse(send.body).result;
  expect(task.status.state).toBe(TaskState.TASK_STATE_SUBMITTED);
  const get = await agent.handleJsonRpc(jsonRpc('tasks/get', { id: task.id }), { 'a2a-version': '1.0' });
  expect(JSON.parse(get.body).result.id).toBe(task.id);
});
```

- [ ] **Step 2: Write failing route/artifact test**

```ts
test('card is served and traversal is rejected', async () => {
  const card = await call('GET', '/a2a/pods/pod_1/.well-known/agent-card.json');
  expect(card.status).toBe(200);
  const bad = await call('GET', '/a2a/pods/pod_1/artifacts/..%2F..%2Fetc%2Fpasswd');
  expect(bad.status).toBe(400);
});
```

- [ ] **Step 3: Run tests to verify they fail**

```text
cd gateway
npx jest tests/unit/pod/pod-a2a-agent.test.ts tests/unit/routes/pod-a2a.test.ts --runInBand
```
Expected: FAIL.

- [ ] **Step 4: Implement agent/routes/artifacts**

- Build `AgentExecutor` with `DefaultRequestHandler` + `JsonRpcTransportHandler` + `PodA2ATaskStore`.
- `execute` calls `bridge.sendMessage(podId, ctx.userMessage, { actorSessionID: metadata.actorSessionID })`; publish `AgentEvent.task` or `AgentEvent.message`.
- `cancelTask` calls `bridge.cancelTask`.
- Artifacts: `PodA2AArtifactStore` under `<memoryRoot>/<podId>/artifacts/`; `resolveArtifact` realpath + prefix check; reject `..`/absolute; MIME from extension.
- Loopback check: reuse gateway's loopback guard if available; otherwise check `req.socket.remoteAddress`.

- [ ] **Step 5: Run tests + media A2A regression**

```text
cd gateway
npx jest tests/unit/pod/pod-a2a-agent.test.ts tests/unit/routes/pod-a2a.test.ts tests/unit/gateway/media-agent.test.ts --runInBand
```
Expected: PASS.

- [ ] **Step 6: Commit**

```text
git add gateway/src/core/pod/pod-a2a-agent.ts gateway/src/core/pod/pod-a2a-artifacts.ts gateway/src/routes/pod-a2a.ts gateway/tests/unit/pod/pod-a2a-agent.test.ts gateway/tests/unit/routes/pod-a2a.test.ts
git commit -m "feat(pod): add A2A agent and routes"
```

---

### Task 6: Wiring + `mafw_pod_message` default A2A + SDK types

**Files:**
- Modify: `gateway/src/index.ts` (construct bridge/delivery/agent, attach routes)
- Modify: `src/tools/pod-message.ts` (A2A first, REST fallback)
- Test: `tests/pod-tools.test.ts`
- Modify: `packages/gateway-sdk/src/types.ts` (PodMessage new fields)
- Modify: `packages/gateway-sdk/src/client.ts` (if new method needed)
- Test: `packages/gateway-sdk/src/client.test.ts` (if method added)
- Modify: `packages/desktop/src/preload/mafw-api.ts` (if method added)

**Interfaces:**
- `PodMessageService`/`PodStore` expose `markMessageDelivered`.
- `mafw_pod_message`:
  ```ts
  // 1) POST /a2a/pods/:podId JSON-RPC message/send
  // 2) on 404/network error: POST /api/pods/:podId/messages (existing REST)
  // 3) return metadata.protocol = 'a2a' | 'rest'
  ```
- `PodMessage` SDK adds `protocol?`, `externalMessageId?`, `deliveredAt?`, `deliveredSessionId?`.

- [ ] **Step 1: Write failing tool tests**

```ts
test('pod message defaults to A2A and reports protocol', async () => {
  fetchMock.mockResolvedValueOnce(okJson({ jsonrpc: '2.0', result: { id: 'task_1' } }));
  const out = await podMessageTool.execute({ podId: 'pod_1', kind: 'request', body: 'do' }, { sessionID: 'ses_lead' });
  expect(fetchMock.mock.calls[0][0]).toContain('/a2a/pods/pod_1');
  expect(out.metadata.protocol).toBe('a2a');
});

test('falls back to REST when A2A is unavailable', async () => {
  fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
  fetchMock.mockResolvedValueOnce(okJson({ message: { id: 'm1' } }));
  const out = await podMessageTool.execute({ podId: 'pod_1', kind: 'note', body: 'x' }, { sessionID: 'ses_lead' });
  expect(fetchMock.mock.calls[1][0]).toContain('/api/pods/pod_1/messages');
  expect(out.metadata.protocol).toBe('rest');
});
```

- [ ] **Step 2: Run test to verify it fails**

```text
cd C:\work\work-loop\opencode-plugin-mafw
node --import tsx --import ./packages/test-shim/register.mjs --test tests/pod-tools.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Wire + implement**

- `index.ts`: instantiate `PodMessageDelivery`, `PodA2ABridge`, `PodA2AAgent` per Pod on demand; `attachPodA2ARoutes`.
- `podContext`/node prompt: include `delivery.pendingForSession(sessionId)` for node sessions.
- `mafw_pod_message`: A2A JSON-RPC first; fallback REST; body includes `data` part.
- SDK types: add message fields; no new endpoint required.

- [ ] **Step 4: Run tool tests + gateway pod tests**

```text
node --import tsx --import ./packages/test-shim/register.mjs --test tests/pod-tools.test.ts
cd gateway
npx jest tests/unit/pod tests/unit/routes/pod-a2a.test.ts --runInBand
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add gateway/src/index.ts src/tools/pod-message.ts tests/pod-tools.test.ts packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/client.test.ts packages/desktop/src/preload/mafw-api.ts
git commit -m "feat(pod): default pod handoff to A2A"
```

---

### Task 7: Desktop A2A status display

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/PodInbox.tsx`
- Modify: `packages/desktop/src/renderer/mafw/pod-model.ts`
- Test: `packages/desktop/tests/pod-inbox-wiring.test.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-model.test.ts`

**Interfaces:**
- `pod-model` adds `podMessageProtocolLabel(message): 'A2A' | 'REST' | null` and `podMessageDeliveryLabel(message): '已投递' | '待投递' | null`.
- PodInbox shows a small protocol/delivery chip for `kind:'request'` messages.

- [ ] **Step 1: Write failing tests**

```ts
test('labels A2A and delivery state', () => {
  expect(podMessageProtocolLabel({ protocol: 'a2a' } as any)).toBe('A2A');
  expect(podMessageDeliveryLabel({ deliveredAt: null } as any)).toBe('待投递');
  expect(podMessageDeliveryLabel({ deliveredAt: '2026-10-30T00:00:00Z' } as any)).toBe('已投递');
});
```

- [ ] **Step 2: Run test to verify it fails**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-model.test.ts tests/pod-inbox-wiring.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

- Add helpers + chips in `PodInbox`; no raw buttons/title.
- Keep existing layout.

- [ ] **Step 4: Run tests**

```text
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-model.test.ts tests/pod-inbox-wiring.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add packages/desktop/src/renderer/mafw/components/PodInbox.tsx packages/desktop/src/renderer/mafw/pod-model.ts packages/desktop/src/renderer/mafw/pod-model.test.ts packages/desktop/tests/pod-inbox-wiring.test.ts
git commit -m "feat(pod): show A2A handoff status"
```

---

### Task 8: E2E + full verification + docs

**Files:**
- Create: `gateway/tests/integration/pod-a2a.test.ts`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write failing E2E test**

Use a real temp DB + PodStore + bridge + delivery with a fake session; sequence:
1. ensure Pod + 3 members;
2. `message/send` request → Pod task + message + link;
3. duplicate message id → one message;
4. coordination delivery → prompt contains `[POD HANDOFF]`;
5. node delivery → pending; `pendingForSession` returns block;
6. tasks/get maps status; cancel;
7. foreign pod 403;
8. no memory write (assert no `mafw_add_memory` call in fake deps).

- [ ] **Step 2: Run test to verify it fails**

```text
cd gateway
npx jest tests/integration/pod-a2a.test.ts --runInBand
```
Expected: FAIL until wiring complete.

- [ ] **Step 3: Fix integration gaps**

Keep fixes inside `core/pod/*`; do not change goal state machine.

- [ ] **Step 4: Full gates**

```text
cd gateway
npm test -- --runInBand --forceExit
cd ../packages/gateway-sdk
npm test
cd ../desktop
npm test
npx tsgo --noEmit -p tsconfig.json
npx electron-vite build
cd ../../
npm run build
```
Expected: PASS; record counts.

- [ ] **Step 5: Update AGENTS.md**

Add a bullet: A2A Pod handoff, endpoint, default `mafw_pod_message`, delivery semantics, test counts, commits.

- [ ] **Step 6: Commit**

```text
git add gateway/tests/integration/pod-a2a.test.ts AGENTS.md
git commit -m "test(pod): add A2A handoff e2e"
```

---

## Execution Notes

- Do not let A2A Task become a second task store; `PodA2ATaskStore.save` is a projection/no-op; all writes go through `PodA2ABridge`.
- Do not push to NodeDriver node sessions; use `pendingForSession` at prompt build.
- A2A is not memory: do not call `mafw_add_memory` from the bridge/delivery.
- Reuse MediaAgent's `@a2a-js/sdk` patterns; keep `/a2a` untouched.
- If `@a2a-js/sdk` types differ from the plan, adapt the mapping layer, not the Pod domain.
