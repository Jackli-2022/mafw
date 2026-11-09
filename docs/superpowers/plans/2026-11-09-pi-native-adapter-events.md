# Pi native AdapterEvent transport (Plan 5, phase A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pi runtime emit `AdapterEvent` v1 directly (no canonical envelope round-trip), so the adapter boundary is real and the later `adapters/pi` package move is mechanical.

**Architecture:** `PiEventStream` currently produces canonical `RawRuntimeEvent`; the generic bridge then reverse-maps it to `AdapterEvent`. Phase A moves the translation into pi: raw pi events → `AdapterEvent` (one pure function), plus an `adapter-bridge` `nativeEvents` mode that forwards AdapterEvents and still applies gateway-minted turn IDs. Phase B (separate plan) moves `pi/**` + `pi-runtime.ts` into `adapters/pi` and rewrites the runtime surface to `defineRuntime`.

**Tech Stack:** TypeScript, Jest (gateway), `@mafw/runtime-contract` `AdapterEvent` v1.

**Spec:** `docs/superpowers/specs/2026-11-09-neutral-runtime-driver-architecture-design.md` §7 / §9 Phase 2

## Sequencing

- Plans 1–4 are merged (`56a762a6`).
- **Plan 5A (this file)**: pi native event transport in place. This removes the canonical round-trip and pins the 33-variant event shapes.
- Plan 5B: `adapters/pi` package extraction + `defineRuntime` rewrite (needs shared `AgentDefinition` / `MafwToolRegistration` / auth helpers moved out first).
- Plan 6: `adapters/opencode`.

## Global Constraints

- `AdapterEvent` stays v1 (`api: 1`, `eventApi: 1`); no second ABI.
- Adapter events must pass `validateAdapterEvent`; `id`/`at`/`data` required, turn-scoped events get the gateway-minted `turnID` from the bridge.
- No canonical `payload.properties` in pi's live event path.
- Unknown pi events keep the existing telemetry recorder and are dropped.
- Every change must pass: full gateway jest (`--forceExit`), gateway `tsc` (cwd=gateway), root build.

## Review Focus

1. **回合归属**：pi 的 `turn.started` / 终态 / 工具三原语不带 `turnID`；bridge 必须为它们补 minted id，并在终态消费队列头（含无 `turn.started` 的退化流）。
2. **消息/part 身份**：`message_start` / `message_update` / `message_end` 必须与历史 `normalizePiMessages` 使用同一 `pia_/piu_<timestamp>` + `_t/_r<n>` id，否则 live upsert 与历史重复或错位。
3. **终态三分类**：`agent_end`/`agent_settled` 按最后 assistant 的 `stopReason` 产出 completed/failed/aborted，错误文本不丢。
4. **权限事件**：`permission.asked/replied` 通过 `AdapterEvent` 的 `requestID` + `data.request` 表达，桌面审批卡字段不丢。
5. **无双重翻译**：`nativeEvents: true` 时 bridge 不得再调用 `canonicalToAdapterEvent`；旧 `translatePiEvent` 必须删除或仅剩测试夹具。

---

### Task 1: `adapter-bridge` native event mode

**Files:**
- Modify: `gateway/src/runtime/adapter-bridge.ts`
- Test: `gateway/tests/unit/runtime/adapter-bridge-native-events.test.ts` (create)

**Interfaces:**
- Produces: `AdapterBridgeMeta.nativeEvents?: boolean`; when true, `transport.onEvent` forwards validated `AdapterEvent`s from the legacy runtime's `global.event()` stream, filling `turnID` from the per-session queue.
- Consumes: `validateAdapterEvent` from `../adapter-event`; existing `pendingTurns`/`activeTurns`/`bridgeState`.

- [ ] **Step 1: Write the failing test**

```ts
import { toRuntimeDefinition } from '../../../src/runtime/adapter-bridge';

function nativeRuntime(events: any[]) {
  return {
    name: 'pi',
    session: { create: async () => ({ id: 's1' }), promptAsync: async () => {}, abort: async () => {}, messages: async () => ({ data: [] }) },
    global: {
      event: async () => ({
        stream: (async function* () { for (const e of events) yield e; })(),
      }),
    },
    tools: { registerTools() {}, nativeTools: () => [] },
  } as any;
}

const event = (type: string, extra: any = {}) => ({ id: `e_${type}_${Math.random()}`, type, at: Date.now(), data: {}, ...extra });

it('forwards AdapterEvents and fills the minted turn id', async () => {
  const runtime = nativeRuntime([
    event('turn.started', { sessionID: 's1' }),
    event('tool.call', { sessionID: 's1', data: { callID: 'c1', name: 'bash', input: {} } }),
    event('message.updated', { sessionID: 's1', data: { message: { id: 'm1', role: 'assistant', content: [] } } }),
    event('turn.completed', { sessionID: 's1', data: { ok: true } }),
  ]);
  const def = toRuntimeDefinition(runtime, { name: 'pi', nativeEvents: true });
  const seen: any[] = [];
  def.transport.onEvent((e) => seen.push(e));

  await def.transport.sendTurn({ sessionID: 's1', turnID: 't1', text: 'hi' } as any);
  await new Promise((r) => setTimeout(r, 20));

  expect(seen.map((e) => e.type)).toEqual(['turn.started', 'tool.call', 'message.updated', 'turn.completed']);
  expect(seen.every((e) => e.turnID === 't1')).toBe(true);
});

it('drops invalid native events instead of forwarding them', async () => {
  const runtime = nativeRuntime([{ type: 'turn.started' }, event('turn.completed', { sessionID: 's1', data: { ok: true } })]);
  const def = toRuntimeDefinition(runtime, { name: 'pi', nativeEvents: true });
  const seen: any[] = [];
  def.transport.onEvent((e) => seen.push(e));

  await def.transport.sendTurn({ sessionID: 's1', turnID: 't1', text: 'hi' } as any);
  await new Promise((r) => setTimeout(r, 20));

  expect(seen.map((e) => e.type)).toEqual(['turn.completed']);
  expect(seen[0].turnID).toBe('t1');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/runtime/adapter-bridge-native-events.test.ts --runInBand --forceExit`
Expected: FAIL — `nativeEvents` unknown / events dropped or unmapped.

- [ ] **Step 3: Implement**

In `AdapterBridgeMeta`, add:

```ts
/** true = the runtime's global.event() already yields AdapterEvent v1. */
nativeEvents?: boolean;
```

In `toRuntimeDefinition`'s `onEvent`, before the existing `translate` branch:

```ts
if (meta.nativeEvents) {
  const forwardNative = (input: unknown) => {
    if (closed || !input || typeof input !== 'object') return;
    const evt = input as AdapterEvent;
    if (evt.sessionID && evt.type === 'turn.started') {
      const queue = pendingTurns.get(evt.sessionID);
      const next = queue?.shift();
      if (next) activeTurns.set(evt.sessionID, next);
      if (queue && queue.length === 0) pendingTurns.delete(evt.sessionID);
    }
    const override = evt.sessionID
      ? (activeTurns.get(evt.sessionID) ?? pendingTurns.get(evt.sessionID)?.[0])
      : undefined;
    const withTurn = override && !evt.turnID ? { ...evt, turnID: override } : evt;
    const validation = validateAdapterEvent(withTurn);
    if (!validation.ok) return;
    listener(validation.event);
    if (validation.event.type === 'turn.completed' || validation.event.type === 'turn.failed' || validation.event.type === 'turn.aborted') {
      const sid = validation.event.sessionID;
      if (!sid) return;
      bridgeState.turns.delete(sid);
      if (activeTurns.has(sid)) activeTurns.delete(sid);
      else {
        const queue = pendingTurns.get(sid);
        queue?.shift();
        if (queue && queue.length === 0) pendingTurns.delete(sid);
      }
    }
  };
  const sub = (legacy as any).global?.event?.();
  void Promise.resolve(sub).then(async (source: any) => {
    if (!source?.stream) return;
    try {
      for await (const evt of source.stream) forwardNative(evt);
    } catch { /* stream ended */ }
  });
  return () => { closed = true; };
}
```

Import `validateAdapterEvent` and `AdapterEvent` type. Keep the existing canonical path untouched.

- [ ] **Step 4: Run tests + tsc**

Run: `npx jest tests/unit/runtime/adapter-bridge-native-events.test.ts tests/unit/runtime/adapter-bridge.test.ts --runInBand --forceExit`
Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS, rc=0.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/adapter-bridge.ts gateway/tests/unit/runtime/adapter-bridge-native-events.test.ts
git commit -m "feat(gateway): forward native AdapterEvents through the bridge"
```

---

### Task 2: pi raw events → AdapterEvent

**Files:**
- Create: `gateway/src/runtime/pi/pi-adapter-events.ts`
- Test: `gateway/tests/unit/runtime/pi-adapter-events.test.ts` (create)
- Reference: `gateway/src/runtime/pi/pi-events.ts` (old canonical mapping)
- Reference: `gateway/src/runtime/adapter-event-mapper.ts` (canonical shapes)

**Interfaces:**
- Produces: `translatePiAdapterEvent(event: any, sessionID: string): AdapterEvent | null`.
- Consumes: `normalizePiLiveMessage`, `piMessageIdentity`, `piPartId`, `mapPiStopReason` from `pi-message-normalize`; `AdapterEvent` from `@mafw/runtime-contract`.

- [ ] **Step 1: Write the failing test**

Create fixtures for the five event families; assert type + data, and assert that `mapAdapterEvent(native)` reproduces the old canonical output for the same fixture:

```ts
import { mapAdapterEvent } from '../../../src/runtime/adapter-event-mapper';
import { translatePiAdapterEvent } from '../../../src/runtime/pi/pi-adapter-events';

const liveMessage = { role: 'assistant', timestamp: 1700000000123, content: [{ type: 'text', text: 'hello' }], stopReason: 'stop' };

it('maps agent_start / agent_end to turn lifecycle', () => {
  const started = translatePiAdapterEvent({ type: 'agent_start' }, 's1')!;
  expect(started.type).toBe('turn.started');
  expect(started.sessionID).toBe('s1');

  const done = translatePiAdapterEvent({ type: 'agent_end', messages: [liveMessage] }, 's1')!;
  expect(done.type).toBe('turn.completed');
  expect(mapAdapterEvent(done).canonical?.payload?.type).toBe('turn.completed');

  expect(translatePiAdapterEvent({ type: 'agent_end', messages: [{ ...liveMessage, stopReason: 'error', errorMessage: 'boom' }] }, 's1')!.type).toBe('turn.failed');
  expect(translatePiAdapterEvent({ type: 'agent_end', messages: [{ ...liveMessage, stopReason: 'aborted' }] }, 's1')!.type).toBe('turn.aborted');
});

it('maps message and delta events with stable ids', () => {
  const start = translatePiAdapterEvent({ type: 'message_start', sessionID: 's1', message: liveMessage }, 's1')!;
  expect(start.type).toBe('message.updated');
  const msg = (start.data as any).message;
  expect(msg.id).toBe('pia_1700000000123');

  const delta = translatePiAdapterEvent({
    type: 'message_update', sessionID: 's1', message: liveMessage,
    assistantMessageEvent: { type: 'text_delta', delta: 'hi', contentIndex: 0 },
  }, 's1')!;
  expect(delta.type).toBe('part.delta');
  expect(delta.data).toMatchObject({ messageID: 'pia_1700000000123', partID: 'pia_1700000000123_t1', field: 'text', delta: 'hi' });
});

it('maps tools and permissions', () => {
  expect(translatePiAdapterEvent({ type: 'tool_execution_start', sessionID: 's1', toolCallId: 'c1', toolName: 'bash', args: { command: 'ls' } }, 's1')!.data)
    .toMatchObject({ callID: 'c1', name: 'bash', input: { command: 'ls' } });
  const asked = translatePiAdapterEvent({ type: 'permission.asked', sessionID: 's1', requestId: 'r1', toolName: 'bash', args: {}, risk: 'low' }, 's1')!;
  expect(asked.type).toBe('permission.asked');
  expect(asked.requestID).toBe('r1');
  expect((asked.data as any).request.toolName).toBe('bash');
});

it('drops unknown events', () => {
  expect(translatePiAdapterEvent({ type: 'mystery' }, 's1')).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/runtime/pi-adapter-events.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure translator**

One switch, one event per call. Required shapes:
- `agent_start` → `{ type:'turn.started', sessionID, data:{} }`
- `agent_end`/`agent_settled` → completed `{ ok:true }`, failed `{ error:{kind:'unknown',message}, retryable:false }`, aborted `{ reason:'aborted' }`
- `message_start`/`message_end` → `message.updated` data `{ message }` via `normalizePiLiveMessage` (skip non-assistant start; skip null)
- `message_update` → `part.delta` only when `assistantMessageEvent.type` is `text_delta`/`thinking_delta`, delta non-empty, integer `contentIndex` ≥ 0, and `piMessageIdentity` exists
- `turn_start`/`turn_end` → `part.updated` `{ part:{ id, sessionID, messageID, type:'step-start'|'step-finish' } }`
- `tool_execution_start/update/end` → `tool.call` `{callID,name,input}`, `tool.delta` `{callID,field:'output',delta}`, `tool.result` `{callID,ok:!isError,output,error?}`
- `permission.asked` → `{ requestID: requestId, data:{ request:{ sessionID, requestId, toolName, args, risk } } }`
- `permission.replied` → `{ requestID, data:{ reply: approved?'once':'reject', source:'user' } }`
- `session_before_compact`/`session_compact` → `session.compacting`/`session.compacted` (only when called directly; the registry also emits these)
- unknown → `piUnknownRecorder?.(type)` then `null`

Every returned event: `id: pi_<counter>`, `at: Date.now()`, `sessionID`, `data` object (never undefined). Use a module-level counter (deterministic per process).

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/runtime/pi-adapter-events.test.ts --runInBand --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/pi/pi-adapter-events.ts gateway/tests/unit/runtime/pi-adapter-events.test.ts
git commit -m "feat(pi): translate raw events to AdapterEvent v1"
```

---

### Task 3: Switch the pi stream and emitters to AdapterEvent

**Files:**
- Modify: `gateway/src/runtime/pi/pi-events.ts`
- Modify: `gateway/src/runtime/pi/pi-session.ts`
- Modify: `gateway/src/runtime/pi/pi-approval-extension.ts`
- Modify: `gateway/src/runtime/pi/pi-definition.ts`
- Modify: `gateway/tests/integration/pi-native-approvals.test.ts`
- Test: `gateway/tests/unit/runtime/pi-adapter-events.test.ts`, `adapter-bridge-native-events.test.ts`

**Interfaces:**
- Produces: `PiEventStream` emits `AdapterEvent`; `push(event: AdapterEvent)`; `translatePiAdapterEvent` is the only translation.
- Consumes: Task 1 native bridge mode, Task 2 translator.

- [ ] **Step 1: Update `PiEventStream`**

- `listeners: Set<(evt: AdapterEvent) => void>`
- `onEvent`: `const translated = translatePiAdapterEvent(evt, id); if (translated) ...`
- `stream(): AsyncIterable<AdapterEvent>`, `push(event: AdapterEvent)`.
- Delete `PI_EVENT_SOURCE`, `PI_EVENT_MAPPINGS`, `piTransformEvent`, `translatePiEvent`, `messageEnvelope`, and the canonical imports (`RawRuntimeEvent`, `applyEventMappings`, `EVENT_FLOW_MATRIX`, `TOOL_PRIMITIVE_TYPES`). Keep `piUnknownRecorder`.

- [ ] **Step 2: Update direct emitters**

In `pi-session.ts`, type `emitEvent` as `(event: AdapterEvent) => void`; replace:

```ts
this.emitEvent({ payload: { type: 'session.compacting', properties: { sessionID: id } } });
```

with:

```ts
this.emitEvent({ id: `pi_compact_start_${id}`, type: 'session.compacting', sessionID: id, at: Date.now(), data: {} });
```

and the compacted equivalent. In `pi-approval-extension.ts`, emit:

```ts
emitEvent({
  id: `pi_perm_asked_${requestId}`,
  type: 'permission.asked',
  sessionID: gatewaySessionId,
  requestID: requestId,
  at: Date.now(),
  data: { request: { sessionID: gatewaySessionId, requestId, toolName, args, risk } },
});
```

and `permission.replied` `{ requestID, data:{ reply, source:'user' } }`. Remove the `RawRuntimeEvent` import.

- [ ] **Step 3: Opt the pi definition into native events**

In `pi-definition.ts`, pass `nativeEvents: true` to `toRuntimeDefinition`. Remove any `translate` assumption (there is none today).

- [ ] **Step 4: Update the integration test**

Replace `translatePiEvent(rawEvent, 'pi_test')` with `translatePiAdapterEvent(rawEvent, 'pi_test')`, then `mapAdapterEvent(...)` before `normalizeOpencodeEvent`. Keep the assertions on `permission.asked/replied` fields.

- [ ] **Step 5: Run pi tests + full gateway**

Run: `npx jest tests/unit/runtime/pi-adapter-events.test.ts tests/unit/runtime/adapter-bridge-native-events.test.ts tests/integration/pi-native-approvals.test.ts --runInBand --forceExit`
Then: `npm test -- --forceExit`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/runtime/pi gateway/tests
git commit -m "refactor(pi): emit AdapterEvent natively"
```

---

### Task 4: Gates, review, merge

- [ ] **Step 1: Full gates**

```bash
# repo root
npm run build
npm run test:contract
npm run test:core
# gateway
npx tsc --noEmit -p tsconfig.json
npm test -- --forceExit
```

- [ ] **Step 2: Fresh-context review** of `56a762a6..HEAD` with the plan/spec; fix Critical/Important, re-run gates.

- [ ] **Step 3: Merge to `main`** (only when the main worktree is clean; otherwise leave the branch ready and report).

---

## Self-Review

- Spec §7/§9 Phase 2 coverage: native event set (Task 2), turn attribution (Task 1), stream/emitters (Task 3), gates.
- `defineRuntime` package extraction is explicitly Plan 5B, not silently claimed here.
- Review Focus mapping: turn attribution → Task 1; message ids → Task 2; terminal classification → Task 2; permissions → Task 2/3; no double translation → Task 1/3.

## Known Boundaries

- `pi-runtime.ts` still returns `AgentRuntime`; `adapters/pi` + `defineRuntime` is Plan 5B.
- `usage.updated` is not emitted by pi yet (pi's `turn_end` has no usage in this path); it remains a Plan 5B item.
- The bridge still uses canonical→AdapterEvent for opencode; `nativeEvents` is additive.
