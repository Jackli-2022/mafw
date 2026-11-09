# 中性 Runtime Kernel + claude Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the neutral runtime kernel (`runtime-contract` package + gateway mapper/bus) and migrate the claude adapter to it, without a kernel-level `native` branch.

**Architecture:** `packages/runtime-contract` owns the ISA (`AdapterEvent`, `RuntimeTransport`, `RuntimeChannels`, `defineRuntime`). Gateway owns the mapper (`AdapterEvent` → canonical), the runtime bus (dedupe/ordering/hot-plug), and the legacy plugin bridge. `adapters/claude` becomes the first driver: a `RuntimeTransport` wrapping its existing SDK runtime, `RuntimeChannels` for history, and a `defineRuntime` entry. Existing opencode/pi stay on the old path until Plan 2; the legacy bridge keeps old plugins loading.

**Tech Stack:** TypeScript 5.x, Node 24 type stripping (`node --test`), Jest + ts-jest (gateway), existing `@mafw/runtime-kit`, existing `Mafw*` View DTO.

**Spec:** `docs/superpowers/specs/2026-11-09-neutral-runtime-driver-architecture-design.md`

> **Plan series:** This is Plan 1 of 3. Plan 2 covers pi/opencode + v2 channels; Plan 3 covers legacy deletion, CI guards and frontend/DTO neutralization. This plan produces a working kernel + claude driver and keeps old runtimes/plugins working through the legacy bridge.

## Global Constraints

- `adapterApi: 1`, `eventApi: 1`, `channelApi: 1 | 2`.
- No `native` key/branch in `defineRuntime`; compatibility lives in `gateway/src/runtime/legacy/`.
- `AdapterEvent` is the only runtime → gateway event path. `payload.properties` never crosses the adapter boundary (only the gateway mapper may produce it internally).
- `turnID` is minted by gateway and echoed by the adapter in every `turn.*`/`part.*`/`usage.*` event.
- Large payloads use `AttachmentRef`; no base64 in event bodies.
- `gateway/src` outside `adapters/` and `runtime/legacy/` must not contain runtime protocol names.
- Tests must run with `--runInBand` for gateway Jest; adapter tests use `node --test`.

## Review Focus

- Unknown/malformed event must be dropped with telemetry, never reach business/SSE.
- Duplicate or out-of-order events must not double-apply; late turn events must not settle a new turn.
- Legacy plugin bridge must convert old canonical events to `AdapterEvent`, never pass old envelopes through.
- Claude thinking deltas must map to `reasoning`, not `text`; tool deltas must use `field/delta`.
- A missing channel must return unsupported (`ENODEV`/503), never fall back to a runtime-specific path.

---

### Task 1: `packages/runtime-contract` skeleton + AdapterEvent v1

**Files:**
- Create: `packages/runtime-contract/package.json`
- Create: `packages/runtime-contract/tsconfig.json`
- Create: `packages/runtime-contract/src/index.ts`
- Create: `packages/runtime-contract/src/adapter-event.ts`
- Test: `packages/runtime-contract/src/adapter-event.test.ts`

**Interfaces:**
- Produces: `ADAPTER_EVENT_VERSION = 1`
- Produces: `AdapterEvent` (33-variant union, `data: unknown` per variant)
- Produces: `validateAdapterEvent(input: unknown): { ok: true; event: AdapterEvent } | { ok: false; errors: string[] }`

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAdapterEvent } from './adapter-event.ts';

test('accepts a valid part.delta', () => {
  const r = validateAdapterEvent({
    id: 'e1', type: 'part.delta', sessionID: 's1', turnID: 't1',
    at: 1, data: { messageID: 'm1', partID: 'p1', field: 'text', delta: 'hi' },
  });
  assert.equal(r.ok, true);
});

test('rejects unknown type', () => {
  const r = validateAdapterEvent({ id: 'e1', type: 'nope', sessionID: 's1', at: 1, data: {} });
  assert.equal(r.ok, false);
});

test('rejects part.delta without sessionID', () => {
  const r = validateAdapterEvent({ id: 'e1', type: 'part.delta', at: 1, data: {} });
  assert.equal(r.ok, false);
});

test('allows session-less runtime.notice', () => {
  const r = validateAdapterEvent({ id: 'e1', type: 'runtime.notice', at: 1, data: { level: 'info', message: 'ok' } });
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/runtime-contract/src/adapter-event.test.ts`
Expected: FAIL with "Cannot find module './adapter-event.ts'".

- [ ] **Step 3: Create the package and implement the union + validator**

`package.json`:

```json
{
  "name": "@mafw/runtime-contract",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "node --test src"
  }
}
```

`tsconfig.json`: `target ES2022`, `module NodeNext`, `moduleResolution NodeNext`, `declaration true`, `outDir dist`, `strict true`, `include ["src/**/*"]`.

`adapter-event.ts` defines the 33 types exactly as the spec §7.2. `data` is `unknown`; the validator only checks the envelope and the required identity fields per type:

- `id` non-empty string, `type` in the closed set, `at` finite number.
- `sessionID` required for every type except `runtime.notice` / `runtime.error`.
- `turn.*` / `usage.*` / `tool.*` require `turnID` where the spec says so.
- `permission.*` / `question.*` require `requestID`.
- `native` optional object with non-empty `source`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/runtime-contract/src/adapter-event.test.ts`
Expected: PASS 4/4.

- [ ] **Step 5: Link and build the package**

Run: `npm install`
Expected: root workspaces recognize `packages/runtime-contract`.

Run: `npm run build -w @mafw/runtime-contract`
Expected: `packages/runtime-contract/dist/index.js` and `index.d.ts` exist.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime-contract
git commit -m "feat(runtime-contract): add AdapterEvent v1 and validator"
```

---

### Task 2: Transport, Channels, defineRuntime

**Files:**
- Create: `packages/runtime-contract/src/transport.ts`
- Create: `packages/runtime-contract/src/channels.ts`
- Create: `packages/runtime-contract/src/define-runtime.ts`
- Modify: `packages/runtime-contract/src/index.ts`
- Test: `packages/runtime-contract/src/define-runtime.test.ts`

**Interfaces:**
- Produces: `RuntimeTransport`, `RuntimeChannels`, `RuntimeChannelsV2`, `RuntimeDefinition`
- Produces: `RuntimeFactoryContext` (`gatewayPort` / `rootDir` / `projectDir` / `pluginConfig` / `credentials` / `log`; structural, no gateway imports)
- Produces: `defineRuntime(input): RuntimeDefinition`
- Produces: `deriveCapabilities(def): RuntimeCapabilities` (the existing gateway capability keys, as a structural clone)

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { defineRuntime } from './define-runtime.ts';

const transport = {
  createSession: async () => ({ sessionID: 's1' }),
  sendTurn: async () => ({ turnID: 't1' }),
  interruptTurn: async () => {},
  onEvent: () => () => {},
};

test('minimal transport derives sessionApi + eventStream only', () => {
  const def = defineRuntime({ api: 1, name: 'x', displayName: 'X', preset: 'core', transport });
  assert.equal(def.capabilities.sessionApi, true);
  assert.equal(def.capabilities.eventStream, true);
  assert.equal(def.capabilities.steerApi, false);
  assert.equal(def.capabilities.nativeApprovals, false);
});

test('steer adds steerApi and promptWhileBusy', () => {
  const def = defineRuntime({
    api: 1, name: 'x', displayName: 'X', preset: 'conversation',
    transport: { ...transport, steer: async () => 'steered' },
  });
  assert.equal(def.capabilities.steerApi, true);
  assert.equal(def.capabilities.promptWhileBusy, true);
});

test('question channel adds questionApi', () => {
  const def = defineRuntime({
    api: 1, name: 'x', displayName: 'X', preset: 'autonomous', transport,
    channels: { question: { list: async () => [], reply: async () => {}, reject: async () => {} } },
  });
  assert.equal(def.capabilities.questionApi, true);
});

test('rejects an unsupported api', () => {
  assert.throws(() => defineRuntime({ api: 2 as any, name: 'x', displayName: 'X', preset: 'core', transport }));
});

test('rejects a native key', () => {
  assert.throws(() => defineRuntime({ api: 1, name: 'x', displayName: 'X', preset: 'core', transport, native: {} } as any));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/runtime-contract/src/define-runtime.test.ts`
Expected: FAIL with "defineRuntime is not a function".

- [ ] **Step 3: Implement the types and `defineRuntime`**

- `transport.ts` mirrors spec §5 plus the `sendTurn` fields and `AdapterPartInput`/`AttachmentRef` from §5.1.
- `channels.ts` mirrors spec §6 and §6.1 (`RuntimeChannels`, `RuntimeChannelsV2`). For Plan 1, v2 payloads that live in gateway today (`McpServerStatus`, `RuntimeDiscoverySnapshot`, `RuntimeMcpConfigChannel`, `RuntimePtyChannel`, `MafwBackgroundJob`) are structural placeholders; Plan 2 replaces them with the shared DTO types. The method names and shapes stay.
- `define-runtime.ts`:
  - validates `api === 1`, `eventApi === 1`, `channelApi` in `{1,2}`;
  - throws if `native` key is present;
  - derives capabilities from transport/channels/preset as spec §8 table;
  - returns `{ ...input, capabilities }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/runtime-contract/src/define-runtime.test.ts`
Expected: PASS 5/5.

- [ ] **Step 5: Export from `index.ts` and build**

Run: `npm run build -w @mafw/runtime-contract`
Expected: build passes.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime-contract
git commit -m "feat(runtime-contract): add transport, channels and defineRuntime"
```

---

### Task 3: Gateway re-export + AdapterEvent mapper

**Files:**
- Create: `gateway/src/runtime/adapter-event.ts` (re-export from `@mafw/runtime-contract`)
- Create: `gateway/src/runtime/adapter-event-mapper.ts`
- Modify: `gateway/package.json` (add `"@mafw/runtime-contract": "*"`)
- Modify: `package.json` (root build: build `@mafw/runtime-contract` before gateway)
- Test: `gateway/tests/unit/runtime/adapter-event-mapper.test.ts`

**Interfaces:**
- Produces: `mapAdapterEvent(event: AdapterEvent): MappedAdapterEvent`
- Produces: `MappedAdapterEvent = { canonical?: RawRuntimeEvent; internal?: InternalAdapterEvent; dropped?: { reason: string } }`
- Consumes: `RawRuntimeEvent` from `./normalize`, `isMafwPart`/`isMafwMessage` from `./canonical-types`.

- [ ] **Step 1: Write the failing test**

```ts
import { mapAdapterEvent } from '../../../src/runtime/adapter-event-mapper';

function ev(type: string, data: any, extra: any = {}) {
  return { id: 'e1', type, sessionID: 's1', at: 1, data, ...extra } as any;
}

it('maps part.delta to canonical part.delta', () => {
  const out = mapAdapterEvent(ev('part.delta', { messageID: 'm1', partID: 'p1', field: 'text', delta: 'hi' }, { turnID: 't1' }));
  expect(out.canonical?.payload.type).toBe('part.delta');
  expect(out.canonical?.payload.properties.delta).toBe('hi');
});

it('maps session.status into session.updated', () => {
  const out = mapAdapterEvent(ev('session.status', { status: 'busy' }));
  expect(out.canonical?.payload.type).toBe('session.updated');
  expect(out.canonical?.payload.properties.info).toEqual({ id: 's1', status: 'busy' });
});

it('maps turn.completed and keeps usage internal', () => {
  const out = mapAdapterEvent(ev('turn.completed', { ok: true, usage: { input: 1, output: 2 } }, { turnID: 't1' }));
  expect(out.canonical?.payload.type).toBe('turn.completed');
  expect(out.internal?.type).toBe('turn.completed');
});

it('keeps turn.retrying internal-only', () => {
  const out = mapAdapterEvent(ev('turn.retrying', { attempt: 1, delayMs: 1000, reason: '429' }, { turnID: 't1' }));
  expect(out.canonical).toBeUndefined();
  expect(out.internal?.type).toBe('turn.retrying');
});

it('maps turn-scoped runtime.error to turn.failed', () => {
  const out = mapAdapterEvent(ev('runtime.error', { message: 'boom', retryable: true }, { turnID: 't1' }));
  expect(out.canonical?.payload.type).toBe('turn.failed');
});

it('drops malformed part.updated', () => {
  const out = mapAdapterEvent(ev('part.updated', { part: { type: 'tool' } }));
  expect(out.dropped).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/runtime/adapter-event-mapper.test.ts --runInBand`
Expected: FAIL with "Cannot find module ... adapter-event-mapper".

- [ ] **Step 3: Implement the mapper**

- `adapter-event.ts` re-exports the contract types.
- Mapper switch covers all 33 variants. For `part.updated`/`message.updated`, validate with `isMafwPart`/`isMafwMessage`; invalid → `dropped`.
- `session.status` → canonical `session.updated` `{ info: { id, status } }`.
- `turn.completed/failed/aborted` → canonical same type + `internal` copy for usage/trajectory.
- `turn.retrying/waiting/cap_exhausted/runtime.notice/shell.updated` → internal only.
- `runtime.error` with `turnID` → canonical `turn.failed`; without → internal.
- `tool.call/delta/result` → canonical same-type envelopes (existing assembler consumes them).
- `part.completed` → canonical `part.complete`.
- `permission.*`/`question.*` → canonical same-type with `properties` built from `data`.
- `data.updated` → canonical `part.updated` with `part.type = data-<name>`.
- Add `npm run build -w @mafw/runtime-contract &&` as the first step of the root `build` script (before the gateway build).
- Add `"@mafw/runtime-contract": "*"` to `gateway/package.json` dependencies.

- [ ] **Step 3b: Link the workspace package**

Run: `npm install`
Expected: `node_modules/@mafw/runtime-contract` resolves to `packages/runtime-contract`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/runtime/adapter-event-mapper.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd gateway && npx tsc --noEmit -p tsconfig.json`
Expected: rc=0.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/runtime/adapter-event.ts gateway/src/runtime/adapter-event-mapper.ts gateway/tests/unit/runtime/adapter-event-mapper.test.ts gateway/package.json
git commit -m "feat(gateway): map AdapterEvent v1 to canonical events"
```

---

### Task 4: RuntimeBus

**Files:**
- Create: `gateway/src/runtime/runtime-bus.ts`
- Test: `gateway/tests/unit/runtime/runtime-bus.test.ts`

**Interfaces:**
- Produces: `class RuntimeBus`
  - `register(def: RuntimeDefinition): void`
  - `unregister(name: string): void`
  - `dispatch(event: AdapterEvent): void`
  - `subscribe(listener: (mapped: MappedAdapterEvent & { runtimeName: string }) => void): () => void`
  - `stats(): { unknown: number; duplicate: number; stale: number; dropped: number }`
  - `flush(): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
import { RuntimeBus } from '../../../src/runtime/runtime-bus';

function fakeDef(onEvent: (l: any) => () => void) {
  return {
    api: 1, eventApi: 1, name: 'fake', displayName: 'Fake', preset: 'core',
    transport: {
      createSession: async () => ({ sessionID: 's1' }),
      sendTurn: async () => ({ turnID: 't1' }),
      interruptTurn: async () => {},
      onEvent,
    },
    capabilities: {},
  } as any;
}

it('stamps runtime name and delivers mapped events', () => {
  const bus = new RuntimeBus();
  const seen: any[] = [];
  bus.subscribe((m) => seen.push(m));
  bus.register(fakeDef(() => () => {}));
  bus.dispatch({ id: 'e1', type: 'turn.started', sessionID: 's1', turnID: 't1', at: 1, data: {} } as any);
  expect(seen[0].runtimeName).toBe('fake');
  expect(seen[0].canonical.payload.type).toBe('turn.started');
});

it('drops duplicate ids', () => {
  const bus = new RuntimeBus();
  bus.register(fakeDef(() => () => {}));
  const e = { id: 'e1', type: 'turn.started', sessionID: 's1', turnID: 't1', at: 1, data: {} } as any;
  bus.dispatch(e); bus.dispatch(e);
  expect(bus.stats().duplicate).toBe(1);
});

it('drops unknown types', () => {
  const bus = new RuntimeBus();
  bus.register(fakeDef(() => () => {}));
  bus.dispatch({ id: 'e1', type: 'nope', sessionID: 's1', at: 1, data: {} } as any);
  expect(bus.stats().unknown).toBe(1);
});

it('drops events from a retired turn', () => {
  const bus = new RuntimeBus();
  const seen: any[] = [];
  bus.subscribe((m) => seen.push(m));
  bus.register(fakeDef(() => () => {}));
  bus.dispatch({ id: 'e1', type: 'turn.completed', sessionID: 's1', turnID: 't1', at: 1, data: { ok: true } } as any);
  bus.dispatch({ id: 'e2', type: 'turn.completed', sessionID: 's1', turnID: 't1', at: 2, data: { ok: true } } as any);
  expect(seen.filter((m) => m.canonical?.payload.type === 'turn.completed')).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/runtime/runtime-bus.test.ts --runInBand`
Expected: FAIL with "Cannot find module ... runtime-bus".

- [ ] **Step 3: Implement `RuntimeBus`**

- Event ids: per-session LRU Set (default 2048).
- `seq`: if provided, drop `seq <= lastSeq` for that session.
- Retired turns: after `turn.completed/failed/aborted`, record turnID; later events for that turn are stale.
- Unknown type → `stats.unknown++`; invalid → `stats.dropped++`.
- `register` subscribes to `def.transport.onEvent`; `unregister` calls the unsubscribe.
- `subscribe` delivers `{ ...mapped, runtimeName }`.
- `flush()` awaits pending microtasks (delta merge is Plan 2; v1 can be a no-op resolved promise).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/runtime/runtime-bus.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/runtime-bus.ts gateway/tests/unit/runtime/runtime-bus.test.ts
git commit -m "feat(gateway): add neutral runtime bus"
```

---

### Task 5: Legacy plugin bridge

**Files:**
- Create: `gateway/src/runtime/legacy/legacy-plugin-bridge.ts`
- Test: `gateway/tests/unit/runtime/legacy-plugin-bridge.test.ts`

**Interfaces:**
- Produces: `toRuntimeDefinition(legacy: AgentRuntime, meta: { name: string; displayName?: string }): RuntimeDefinition`
- Produces: `canonicalToAdapterEvent(evt: RawRuntimeEvent): AdapterEvent | null` (core 20 events only)

- [ ] **Step 1: Write the failing test**

```ts
import { toRuntimeDefinition } from '../../../src/runtime/legacy/legacy-plugin-bridge';

function legacy() {
  const listeners = new Set<(e: any) => void>();
  return {
    name: 'old',
    session: {
      create: async () => ({ id: 's1' }),
      promptAsync: async () => {},
      abort: async () => {},
      messages: async () => ({ data: [] }),
    },
    global: { event: async () => ({ stream: (async function* () {})() }) },
    tools: { registerTools() {}, nativeTools: () => [] },
    onEvent(listener: any) { listeners.add(listener); return () => listeners.delete(listener); },
    emit(e: any) { for (const l of listeners) l(e); },
  } as any;
}

it('wraps a legacy runtime and converts core canonical events', () => {
  const old = legacy();
  const def = toRuntimeDefinition(old, { name: 'old' });
  const got: any[] = [];
  def.transport.onEvent((e) => got.push(e));
  old.emit({ payload: { type: 'turn.completed', properties: { sessionID: 's1', turnID: 't1' } } });
  expect(got[0].type).toBe('turn.completed');
  expect(got[0].data).toBeDefined();
});

it('exposes legacy channels it has, unsupported otherwise', async () => {
  const def = toRuntimeDefinition(legacy(), { name: 'old' });
  expect(await def.channels?.messages?.list('s1')).toEqual({ data: [] });
  expect(def.channels?.branch).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/runtime/legacy-plugin-bridge.test.ts --runInBand`
Expected: FAIL.

- [ ] **Step 3: Implement the bridge**

- `transport.createSession` → `legacy.session.create`.
- `sendTurn` → `legacy.session.promptAsync`, returns the gateway turnID.
- `interruptTurn` → `legacy.session.abort`.
- `respondToRequest` → `legacy.session.permissionReply`; map `once/always/reject`.
- `onEvent` → subscribe to `legacy.global.event()` if available; also use `legacy.onEvent` if present.
- `canonicalToAdapterEvent` covers: session.created/updated/deleted, turn.started/completed/failed/aborted, message.updated, part.updated/delta/complete, permission.asked/replied, question.asked/replied/rejected, plan.updated, usage.updated.
- No runtime-name branches; the bridge only knows the old ABI shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/runtime/legacy-plugin-bridge.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/legacy/legacy-plugin-bridge.ts gateway/tests/unit/runtime/legacy-plugin-bridge.test.ts
git commit -m "feat(gateway): add legacy runtime plugin bridge"
```

---

### Task 6: claude transport

**Files:**
- Create: `adapters/claude/src/transport.ts`
- Modify: `adapters/claude/src/runtime.ts`
- Modify: `adapters/claude/src/events.ts`
- Modify: `adapters/claude/tests/events.test.ts`
- Modify: `adapters/claude/tests/runtime.test.ts` (keep it green while `runtime.ts` becomes a thin compatibility wrapper or is replaced)
- Modify: `adapters/claude/package.json` (add `@mafw/runtime-contract` dependency)
- Modify: `package.json` (workspaces add `adapters/*`; root build adds adapter build before gateway)
- Test: `adapters/claude/tests/transport.test.ts`

**Interfaces:**
- Produces: `createClaudeTransport(deps: ClaudeRuntimeDeps): RuntimeTransport`
- Consumes: `defineRuntime` types from `@mafw/runtime-contract`.

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeTransport } from '../src/transport.ts';

function sdk(messages: any[]) {
  return {
    query: async () => ({
      async *[Symbol.asyncIterator]() { for (const m of messages) yield m; },
      interrupt() {},
    }),
    listSessions: async () => [],
    getSessionMessages: async () => [],
  } as any;
}

test('createSession returns a session id', async () => {
  const t = createClaudeTransport({ sdk: sdk([]) });
  const { sessionID } = await t.createSession({ directory: 'C:/tmp' });
  assert.ok(sessionID);
});

test('sendTurn emits turn.started and turn.completed', async () => {
  const t = createClaudeTransport({ sdk: sdk([
    { type: 'system', subtype: 'init', session_id: 'raw1' },
    { type: 'result', subtype: 'success', session_id: 'raw1' },
  ]) });
  const { sessionID } = await t.createSession({ directory: 'C:/tmp' });
  const events: any[] = [];
  t.onEvent((e) => events.push(e));
  await t.sendTurn({ sessionID, turnID: 't1', text: 'hi' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(events.find((e) => e.type === 'turn.started')?.turnID, 't1');
  assert.equal(events.find((e) => e.type === 'turn.completed')?.turnID, 't1');
});

test('thinking delta maps to reasoning', async () => {
  const t = createClaudeTransport({ sdk: sdk([
    { type: 'stream_event', session_id: 'raw1', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hm' } } },
  ]) });
  const { sessionID } = await t.createSession({ directory: 'C:/tmp' });
  const events: any[] = [];
  t.onEvent((e) => events.push(e));
  await t.sendTurn({ sessionID, turnID: 't1', text: 'hi' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(events.find((e) => e.type === 'part.delta')?.data.field, 'reasoning');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd adapters/claude && node --test tests/transport.test.ts`
Expected: FAIL with "Cannot find module '../src/transport.ts'".

- [ ] **Step 3: Implement `createClaudeTransport`**

- Move `spawn`, `sessions`, `tracker`, `bus` wiring from `runtime.ts` into `transport.ts`.
- `sendTurn` launches `spawn` in the background, returns `{ turnID }` immediately.
- `onEvent` subscribes to the existing bus; the bus now emits `AdapterEvent` via `events.ts`.
- `events.ts` maps `assistant/user/stream_event/result/system` to `AdapterEvent` (not canonical envelopes).
- Fix `field:'reasoning'` and `tool.delta` `field/delta`.
- Update `adapters/claude/tests/events.test.ts` to assert the new `AdapterEvent` type/data shapes (the existing canonical assertions no longer apply).
- Keep `runtime.ts` as a thin compatibility wrapper exposing `createClaudeRuntime` for the existing `runtime.test.ts` and the legacy bridge; the new path uses `transport.ts` directly.
- `createSession`, `interruptTurn`, `snapshot` implement the transport.
- Add `"@mafw/runtime-contract": "*"` to `adapters/claude/package.json`; add `"adapters/*"` to root `workspaces`; add `npm run build -w @mafw/adapter-claude &&` before the gateway build in the root `build` script.

- [ ] **Step 3b: Link the adapter workspace**

Run: `npm install`
Expected: `node_modules/@mafw/adapter-claude` and `node_modules/@mafw/runtime-contract` resolve. If npm warns about the nested `adapters/claude/package-lock.json` / `node_modules`, remove the nested lockfile and re-run; the workspace root owns the lock.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd adapters/claude && node --test tests/transport.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add adapters/claude/src/transport.ts adapters/claude/src/runtime.ts adapters/claude/src/events.ts adapters/claude/tests/events.test.ts adapters/claude/tests/runtime.test.ts adapters/claude/tests/transport.test.ts adapters/claude/package.json package.json package-lock.json
git commit -m "feat(adapter-claude): add neutral RuntimeTransport"
```

---

### Task 7: claude channels + defineRuntime entry

**Files:**
- Create: `adapters/claude/src/channels.ts`
- Modify: `adapters/claude/src/index.ts`
- Test: `adapters/claude/tests/index.test.ts`

**Interfaces:**
- Produces: `createClaudeDefinition(ctx: RuntimeFactoryContext, deps?: { sdk?: ClaudeSdk }): Promise<RuntimeDefinition>`
- Produces: `createClaudeChannels(sdk): RuntimeChannels`
- Produces: `createRuntimeDefinition(ctx)` (loader entry; forwards to `createClaudeDefinition`)

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeDefinition, createRuntimeDefinition } from '../src/index.ts';

const fakeSdk = {
  query: async () => ({ async *[Symbol.asyncIterator]() {}, interrupt() {} }),
  listSessions: async () => [],
  getSessionMessages: async () => [],
} as any;

test('creates a defineRuntime definition with api 1', async () => {
  const def = await createClaudeDefinition({ gatewayPort: 3000 } as any, { sdk: fakeSdk });
  assert.equal(def.api, 1);
  assert.equal(def.eventApi, 1);
  assert.equal(def.name, 'claude');
  assert.equal(def.capabilities.sessionApi, true);
  assert.equal(def.capabilities.eventStream, true);
  assert.equal(def.capabilities.nativeApprovals, false);
});

test('has a messages channel', async () => {
  const def = await createClaudeDefinition({ gatewayPort: 3000 } as any, { sdk: fakeSdk });
  const data = await def.channels!.messages!.list('s1');
  assert.ok(Array.isArray(data.data));
});

test('exports the async loader entry', () => {
  assert.equal(typeof createRuntimeDefinition, 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd adapters/claude && node --test tests/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement channels + async definition factory**

- `channels.ts` wraps `sdk.listSessions/getSessionMessages` and the existing `normalizeClaudeHistory`.
- `index.ts` exports `createClaudeDefinition(ctx, deps?)`:
  - if `deps.sdk` is absent, dynamically `import('@anthropic-ai/claude-agent-sdk')`;
  - build transport/channels;
  - return `defineRuntime({ api:1, name:'claude', displayName:'Claude Code', preset:'conversation', transport, channels })`.
- Export `createRuntimeDefinition(ctx)` forwarding to `createClaudeDefinition(ctx)`.
- Keep the existing `createRuntime(ctx)` export as a deprecated wrapper (for `plugin-check`/old tests); remove it in Plan 3. The loader prefers `createRuntimeDefinition`.
- Keep `sampleEvents` for `plugin-check`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd adapters/claude && node --test tests/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add adapters/claude/src/channels.ts adapters/claude/src/index.ts adapters/claude/tests/index.test.ts
git commit -m "feat(adapter-claude): expose defineRuntime entry and channels"
```

---

### Task 8: Loader integration, golden comparison, guards

**Files:**
- Create: `gateway/src/runtime/plugin-entry.ts`
- Modify: `gateway/src/runtime/loader.ts`
- Modify: `gateway/tests/unit/runtime/architecture-boundaries.test.ts`
- Test: `gateway/tests/unit/runtime/plugin-entry.test.ts`
- Test: `gateway/tests/unit/runtime/claude-adapter-golden.test.ts`

**Interfaces:**
- Produces: `resolvePluginEntry(exported: unknown): { kind: 'neutral'; definition: RuntimeDefinition } | { kind: 'factory'; factory: (ctx: any) => Promise<RuntimeDefinition> } | { kind: 'legacy'; runtime: AgentRuntime }`
- Consumes: `RuntimeDefinition` from `@mafw/runtime-contract`
- Loader accepts neutral definitions, async `createRuntimeDefinition` factories, and legacy plugins (via bridge).

- [ ] **Step 1: Write the failing golden test**

```ts
import { mapAdapterEvent } from '../../../src/runtime/adapter-event-mapper';
import { createClaudeTransport } from '../../../../adapters/claude/src/transport';

const raw = [
  { type: 'system', subtype: 'init', session_id: 's1' },
  { type: 'assistant', session_id: 's1', uuid: 'm1', message: { content: [{ type: 'text', text: 'hi' }] } },
  { type: 'result', subtype: 'success', session_id: 's1' },
];

const tick = () => new Promise((r) => setTimeout(r, 0));

function fakeSdk(messages: any[]) {
  return {
    query: async () => ({
      async *[Symbol.asyncIterator]() { for (const m of messages) yield m; },
      interrupt() {},
    }),
    listSessions: async () => [],
    getSessionMessages: async () => [],
  } as any;
}

it('new AdapterEvent path preserves the pinned canonical sequence', async () => {
  const t = createClaudeTransport({ sdk: fakeSdk(raw) });
  const { sessionID } = await t.createSession({ directory: 'C:/tmp' });
  const events: any[] = [];
  t.onEvent((e) => events.push(e));
  await t.sendTurn({ sessionID, turnID: 't1', text: 'hi' });
  await tick();

  const newTypes = events
    .map((e) => mapAdapterEvent(e).canonical?.payload.type)
    .filter((type): type is string => Boolean(type) && type !== 'turn.started');

  expect(newTypes).toEqual(['session.created', 'message.updated', 'part.updated', 'turn.completed']);
});
```

The expected sequence is captured from the pre-migration `adapters/claude/tests/events.test.ts`; `turn.started` is synthesized by the transport tracker, not by the pure transform, so it is filtered.

- [ ] **Step 1b: Add the plugin-entry test**

```ts
import { resolvePluginEntry } from '../../../src/runtime/plugin-entry';

it('recognizes a neutral definition', () => {
  const def = { api: 1, eventApi: 1, name: 'x', transport: {} };
  expect(resolvePluginEntry(def)).toEqual({ kind: 'neutral', definition: def });
});

it('recognizes an async createRuntimeDefinition factory', () => {
  const factory = async () => ({ api: 1, eventApi: 1, name: 'x', transport: {} });
  expect(resolvePluginEntry({ createRuntimeDefinition: factory }).kind).toBe('factory');
});

it('recognizes a legacy createRuntime export', () => {
  const legacy = { createRuntime: async () => ({}), capabilities: {} };
  expect(resolvePluginEntry(legacy).kind).toBe('legacy');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build -w @mafw/runtime-contract && cd gateway && npx jest tests/unit/runtime/claude-adapter-golden.test.ts tests/unit/runtime/plugin-entry.test.ts --runInBand`
Expected: FAIL for the missing modules/assertions (not for workspace resolution).

- [ ] **Step 3: Implement plugin-entry + loader integration + guards**

- `plugin-entry.ts`: `resolvePluginEntry` checks `api === 1 && transport`; then `createRuntimeDefinition`; else `createRuntime`.
- `loader.ts`: neutral entry → `RuntimeBus.register`; factory entry → `await factory(ctx)` → `RuntimeBus.register`; legacy entry → `toRuntimeDefinition` → `RuntimeBus.register`.
- `architecture-boundaries.test.ts`: add assertions that `gateway/src/runtime` has no `opencode|pi|claude` protocol identifiers and no `payload.properties` outside `adapter-event-mapper`.
- Add a test that `defineRuntime` source has no `native` key.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build -w @mafw/runtime-contract && cd gateway && npx jest tests/unit/runtime/claude-adapter-golden.test.ts tests/unit/runtime/plugin-entry.test.ts tests/unit/runtime/architecture-boundaries.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Typecheck + full gateway tests + build**

Run: `cd gateway && npx tsc --noEmit -p tsconfig.json`
Expected: rc=0.

Run: `cd gateway && npm test`
Expected: all gateway suites pass (the loader/runtime tests may need fixture updates).

Run: `npm run build`
Expected: rc=0 (adapters build before gateway after the root build script is updated).

- [ ] **Step 6: Commit**

```bash
git add gateway/src/runtime/loader.ts gateway/tests/unit/runtime/claude-adapter-golden.test.ts gateway/tests/unit/runtime/architecture-boundaries.test.ts
git commit -m "feat(gateway): load neutral runtime definitions and guard boundaries"
```

---

## Self-Review

- Spec coverage: Plan 1 covers kernel (Tasks 1–4), legacy shim (Task 5), claude driver (Tasks 6–7), loader/golden/guards (Task 8). Plan 2 covers pi/opencode + v2 channels; Plan 3 covers legacy deletion/frontend.
- Type consistency: `AdapterEvent` envelope, `RuntimeTransport.sendTurn` fields, `RuntimeChannels` names, `defineRuntime` shape are defined in Tasks 1–2 and consumed unchanged in Tasks 3–8.
- Review focus: unknown/malformed drop (Task 4), duplicate/stale drop (Task 4), legacy bridge conversion (Task 5), claude reasoning/tool delta (Task 6), missing channel (Task 2/5).
- Proportion: tasks specify signatures and tests; implementation bodies are left to the engineer except where the spec fixes exact values.
