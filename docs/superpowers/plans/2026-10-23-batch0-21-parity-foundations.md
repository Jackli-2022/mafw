# Batch 0 — 2.1 适配收口与地基 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four Batch 0 gaps: real children tree, immediate agent/model switch, canonical StopReason, and the remaining 2.1 SSE events.

**Architecture:** Keep the 2.1 HTTP surface in `opencode-adapter.ts`; derive children from `/api/session?parentID=`; add two thin gateway routes for switch verbs; map finish/outcome into a canonical `StopReason`; translate the remaining 2.1 events in the existing @2.1 dialect table. Desktop consumes the same canonical events; no new vocabulary.

**Tech Stack:** TypeScript, Node 22, Jest (gateway), node:test + test-shim (desktop/session-ui), SolidJS (desktop renderer).

**Spec:** `docs/superpowers/specs/2026-10-23-batch0-21-parity-foundations-design.md`

## Global Constraints

- 2.1 API base is `/api` + Basic auth (`serveAuthHeaders()`); never bypass `directNative`.
- `session.children` must fail-open to `[]` (no throw into the route).
- Sticky switch routes return `200 {ok:true}` (not 204) because `MafwClient.request` always parses JSON.
- Canonical event names are fixed: `session.diff`, `queue.updated`, `message.updated`, `turn.completed/failed/aborted`. Do not add new event types.
- `StopReason` values: `end_turn | max_tokens | tool_use | refusal | cancelled | error | unknown`.
- No new npm dependency.
- Commits go directly to master; do not touch `docs/superpowers/plans/2026-10-22-workbench-phase2.md` or `docs/superpowers/specs/2026-10-23-b31-per-turn-diff-design.md` (parallel work).

## Review Focus

- **Child session deleted while dock is open** — a stale row must converge to aborted, never stay “running” forever.
- **Subagent tool part arrives without metadata** (input.started) — must not create a fake row; later calls/progress/success may.
- **Switch request fails after optimistic pick** — the pick must roll back; a false “switched” state is worse than no switch.
- **`session.execution.succeeded` with no preceding `session.step.ended`** — stopReason must still be `unknown`, not undefined.
- **`session.diff` payload uses `files` instead of `diff`** — both shapes must reach the desktop diff store.

---

### Task 1: Real children tree + live subagent rows

**Files:**
- Modify: `gateway/src/runtime/contract.ts` (`SessionCreateOpts.parentID?`)
- Modify: `gateway/src/runtime/opencode-adapter.ts` (`create`, `children`)
- Test: `gateway/tests/unit/runtime/opencode-branch.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/subagent-tracker.ts` (`session-created.agent`, `parseAgentFromTitle`)
- Test: `packages/desktop/src/renderer/mafw/subagent-tracker.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/handlers/subagents.ts` (`mapSubagentToolPart`, handler wiring)
- Create/Test: `packages/desktop/src/renderer/mafw/sse/handlers/subagents.test.ts`

**Interfaces:**
- Consumes: `directNative`, `unwrapNative`, `serveAuthHeaders`.
- Produces: `SessionCreateOpts.parentID?: string`; `mapSubagentToolPart(event: any): TrackerEvent | null`; `TrackerEvent` `session-created` gains optional `agent`.

- [ ] **Step 1: Write failing adapter tests**

In `gateway/tests/unit/runtime/opencode-branch.test.ts` add a describe block that stubs `global.fetch`:

```ts
it('children 走 /api/session?parentID= 并解包 {data}', async () => {
  const calls: any[] = [];
  const original = global.fetch;
  (global as any).fetch = async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, json: async () => ({ data: [{ id: 'c1', parentID: 'p1', title: 'child', time: { created: 1, updated: 2 } }] }) } as any;
  };
  try {
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    const out = await client.session.children({ sessionID: 'p1' });
    expect(calls[0].url).toContain('/api/session?parentID=p1');
    expect(calls[0].url).toContain('limit=100');
    expect(out).toEqual([{ id: 'c1', parentID: 'p1', title: 'child', time: { created: 1, updated: 2 } }]);
  } finally { (global as any).fetch = original; }
});

it('create 把 parentID 写进 body', async () => {
  const calls: any[] = [];
  const original = global.fetch;
  (global as any).fetch = async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, json: async () => ({ data: { id: 'c1' } }) } as any;
  };
  try {
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    await client.session.create({ directory: 'C:/work', parentID: 'p1' });
    expect(JSON.parse(calls[0].init.body)).toEqual({ location: { directory: 'C:/work' }, parentID: 'p1' });
  } finally { (global as any).fetch = original; }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd gateway; npx jest tests/unit/runtime/opencode-branch.test.ts -t "children|parentID" --silent`
Expected: FAIL (children returns `[]`; create body lacks `parentID`).

- [ ] **Step 3: Implement contract + adapter**

`contract.ts`:

```ts
export interface SessionCreateOpts {
  directory: string;
  /** 2.1 原生父子会话（subagent / goal wave）；缺省顶层会话。 */
  parentID?: string;
}
```

`opencode-adapter.ts` `create`:

```ts
const body = await directNative('/session', 'POST', {
  location: { directory: opts.directory },
  ...(opts.parentID ? { parentID: opts.parentID } : {}),
});
```

`children`:

```ts
async children(opts: { sessionID: string }) {
  try {
    const body = await directNative(
      `/session?parentID=${encodeURIComponent(opts.sessionID)}&limit=100`,
      'GET',
    );
    return unwrapNative<any[]>(body) ?? [];
  } catch {
    return [] as any[];
  }
},
```

- [ ] **Step 4: Run adapter tests to verify they pass**

Run: `cd gateway; npx jest tests/unit/runtime/opencode-branch.test.ts -t "children|parentID" --silent`
Expected: PASS.

- [ ] **Step 5: Write failing tracker/handler tests**

In `subagent-tracker.test.ts`:

```ts
test("session-created 显式 agent 覆盖标题解析", () => {
  const rows = applySubagentEvent([], {
    kind: "session-created",
    info: { id: "c1", parentID: "p1", title: "Builder check B3.1 spec", agent: "general" },
  }, 1000);
  expect(rows[0]).toMatchObject({ childID: "c1", agent: "general", title: "Builder check B3.1 spec" });
});
test("parseAgentFromTitle 兼容 2.1 的 (@general subagent) 标题", () => {
  expect(parseAgentFromTitle("调研闭源 CUA 架构 (@general subagent)")).toBe("general");
});
```

Create `subagents.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { mapSubagentToolPart } from "./subagents"

const partEvent = (state: any) => ({
  type: "part.updated",
  properties: {
    sessionID: "parent1",
    part: { type: "tool", tool: "subagent", sessionID: "parent1", state },
  },
})

describe("mapSubagentToolPart", () => {
  test("subagent tool part metadata.sessionID → session-created", () => {
    expect(mapSubagentToolPart(partEvent({
      status: "running",
      input: { description: "Builder check", agent: "general" },
      metadata: { sessionID: "child1", status: "running" },
    }))).toEqual({
      kind: "session-created",
      info: { id: "child1", parentID: "parent1", title: "Builder check", agent: "general" },
    })
  })
  test("没有 metadata.sessionID → null（input.started 不建假行）", () => {
    expect(mapSubagentToolPart(partEvent({ status: "running", input: {} }))).toBeNull()
  })
  test("非 subagent 工具 → null", () => {
    const e = partEvent({ status: "running", metadata: { sessionID: "child1" } })
    e.properties.part.tool = "bash"
    expect(mapSubagentToolPart(e)).toBeNull()
  })
})
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cd packages/desktop; npm test -- --test-name-pattern "显式 agent|2.1 的|mapSubagentToolPart"`
Expected: FAIL (no `agent` override, parser returns 子代理, no `mapSubagentToolPart`).

- [ ] **Step 7: Implement tracker + handler**

`subagent-tracker.ts`:

```ts
export type TrackerEvent =
  | { kind: "session-created"; info: { id: string; parentID: string; title?: string; agent?: string } }
  // ...unchanged...

export function parseAgentFromTitle(title: string): string {
  const paren = /\(@([^\s)]+)\s+subagent\)/i.exec(title)
  if (paren) return paren[1]
  const tail = /@([^\s@]+)\s*$/.exec(title)
  return tail ? tail[1] : DEFAULT_AGENT
}
```

In `case "session-created"`, use `agent: ev.info.agent ?? parseAgentFromTitle(t)`.

`subagents.ts`:

```ts
export function mapSubagentToolPart(event: any): TrackerEvent | null {
  if (event?.type !== "part.updated") return null
  const part = event?.properties?.part
  if (!part || part.type !== "tool") return null
  const tool = String(part.tool ?? part.name ?? "").toLowerCase()
  if (tool !== "subagent" && tool !== "task") return null
  const meta = part.state?.metadata
  const childID = typeof meta?.sessionID === "string" ? meta.sessionID : undefined
  const parentID = typeof part.sessionID === "string" ? part.sessionID : event?.properties?.sessionID
  if (!childID || !parentID) return null
  const input = part.state?.input ?? {}
  return {
    kind: "session-created",
    info: {
      id: childID,
      parentID,
      ...(typeof input.description === "string" && input.description ? { title: input.description } : {}),
      ...(typeof input.agent === "string" && input.agent ? { agent: input.agent } : {}),
    },
  }
}
```

In `handleSubagentEvent`, before the turn-terminal branch:

```ts
if (event.type === "part.updated") {
  const ev = mapSubagentToolPart(event)
  if (ev) deps.subagents.onEvent(ev)
}
```

Keep `return false` so chat-stream still processes the part.

- [ ] **Step 8: Run tracker/handler tests + typecheck**

Run: `cd packages/desktop; npm test -- --test-name-pattern "显式 agent|2.1 的|mapSubagentToolPart"`  
Then: `cd packages/desktop; npx tsc --noEmit` (or the package's typecheck script).
Expected: PASS / rc=0.

- [ ] **Step 9: Commit**

```bash
git add gateway/src/runtime/contract.ts gateway/src/runtime/opencode-adapter.ts gateway/tests/unit/runtime/opencode-branch.test.ts packages/desktop/src/renderer/mafw/subagent-tracker.ts packages/desktop/src/renderer/mafw/subagent-tracker.test.ts packages/desktop/src/renderer/mafw/sse/handlers/subagents.ts packages/desktop/src/renderer/mafw/sse/handlers/subagents.test.ts
git commit -m "feat(runtime+desktop): restore 2.1 children tree and live subagent rows"
```

---

### Task 2: Immediate agent/model switch

**Files:**
- Modify: `gateway/src/runtime/contract.ts` (`switchAgent?`, `switchModel?`)
- Modify: `gateway/src/runtime/opencode-adapter.ts` (implement switch methods)
- Create: `gateway/src/routes/session-switch.ts`
- Modify: `gateway/src/index.ts` (register route before `/api/sessions/:id/children`)
- Create/Test: `gateway/tests/unit/routes/session-switch.test.ts`
- Modify: `packages/gateway-sdk/src/types.ts` (`SessionsNamespace`)
- Modify: `packages/gateway-sdk/src/client.ts` (methods)
- Test: `packages/gateway-sdk/src/client.test.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`, `packages/desktop/src/preload/mafw-types.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx` (`onModelSelect`, `applyAgentSwitch`)

**Interfaces:**
- Produces: `session.switchAgent({sessionID, agent})`, `session.switchModel({sessionID, model:{providerID,modelID}, variant?})`; gateway `POST /api/sessions/:id/agent|model` → `200 {ok:true}`; SDK/preload `sessions.switchAgent(id, agent)` / `sessions.switchModel(id, model)`.

- [ ] **Step 1: Write failing route test**

Create `gateway/tests/unit/routes/session-switch.test.ts` with a fake request/response pair (pattern from other route tests):

```ts
import { handleSessionSwitch } from '../../../src/routes/session-switch';

function fakeRes() {
  const out: any = { status: 0, body: undefined };
  out.writeHead = (s: number) => { out.status = s; };
  out.end = (b: string) => { out.body = b; };
  return out;
}
function fakeReq(method: string, url: string, body?: any) {
  const listeners: Record<string, Function> = {};
  return {
    method, url,
    on(ev: string, cb: Function) { listeners[ev] = cb; if (ev === 'end') cb(); },
    // the route reads via async iterator helper; use the same helper pattern as approvals-respond
  } as any;
}

it('POST /api/sessions/:id/agent forwards switchAgent', async () => {
  const calls: any[] = [];
  const client = { session: { switchAgent: async (o: any) => calls.push(o) } };
  const res = fakeRes();
  const handled = await handleSessionSwitch(fakeReq('POST', '/api/sessions/s1/agent', { agent: 'plan' }), res, { getClient: () => client as any });
  expect(handled).toBe(true);
  expect(calls).toEqual([{ sessionID: 's1', agent: 'plan' }]);
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ ok: true });
});

it('switchAgent 缺失 → 503', async () => { /* client.session = {} */ });
```

If the route helper reads the body via `for await (const chunk of req)`, make the fake request an async iterable or reuse the existing test helper. Follow `session-mutations` style; simplest is to export a pure `parseSwitchRequest(req)` or accept a pre-parsed body. Prefer route signature `handleSessionSwitch(req, res, deps)` with a body reader identical to `session-mutations`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd gateway; npx jest tests/unit/routes/session-switch.test.ts --silent`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement contract + adapter**

```ts
// contract.ts, RuntimeClient.session
switchAgent?(opts: { sessionID: string; agent: string }): Promise<void>;
switchModel?(opts: { sessionID: string; model: { providerID: string; modelID: string }; variant?: string }): Promise<void>;
```

```ts
// opencode-adapter.ts, session object
async switchAgent(opts: { sessionID: string; agent: string }) {
  await directNative(`/session/${opts.sessionID}/agent`, 'POST', { agent: opts.agent });
},
async switchModel(opts: { sessionID: string; model: { providerID: string; modelID: string }; variant?: string }) {
  await switchModel(opts.sessionID, opts.model, opts.variant);
},
```

- [ ] **Step 4: Implement gateway route + register**

`routes/session-switch.ts`:

```ts
import * as http from 'http';
export interface SessionSwitchClientLike {
  session: {
    switchAgent?(opts: { sessionID: string; agent: string }): Promise<void>;
    switchModel?(opts: { sessionID: string; model: { providerID: string; modelID: string }; variant?: string }): Promise<void>;
  };
}
export interface SessionSwitchDeps { getClient: () => SessionSwitchClientLike | null; }
export async function handleSessionSwitch(req: http.IncomingMessage, res: http.ServerResponse, deps: SessionSwitchDeps): Promise<boolean> {
  const m = req.method === 'POST' ? req.url?.match(/^\/api\/sessions\/([^/?]+)\/(agent|model)(?:\?|$)/) : undefined;
  if (!m) return false;
  const [, sessionID, kind] = m;
  const json = (status: number, body: any) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const client = deps.getClient();
  if (!client) { json(503, { error: 'LLM client not available' }); return true; }
  const raw = await new Promise<string>((resolve) => { let s = ''; req.on('data', c => s += c); req.on('end', () => resolve(s)); req.on('error', () => resolve('')); });
  let body: any = {}; try { body = JSON.parse(raw || '{}'); } catch { json(400, { error: 'invalid json' }); return true; }
  try {
    if (kind === 'agent') {
      if (typeof client.session.switchAgent !== 'function') { json(503, { error: 'switchAgent unsupported' }); return true; }
      if (typeof body.agent !== 'string' || !body.agent) { json(400, { error: 'agent is required' }); return true; }
      await client.session.switchAgent({ sessionID, agent: body.agent });
    } else {
      if (typeof client.session.switchModel !== 'function') { json(503, { error: 'switchModel unsupported' }); return true; }
      const model = body.model;
      if (!model?.providerID || !model?.modelID) { json(400, { error: 'model.providerID/modelID required' }); return true; }
      await client.session.switchModel({ sessionID, model: { providerID: model.providerID, modelID: model.modelID }, ...(body.variant ? { variant: body.variant } : {}) });
    }
    json(200, { ok: true });
  } catch (err: any) { json(500, { error: err.message }); }
  return true;
}
```

In `index.ts`, import and call before the children route:

```ts
if (await handleSessionSwitch(req, res, { getClient: () => this.runtime as any })) return;
```

- [ ] **Step 5: Run route tests to verify they pass**

Run: `cd gateway; npx jest tests/unit/routes/session-switch.test.ts --silent`
Expected: PASS.

- [ ] **Step 6: Write failing SDK test**

In `client.test.ts`, add:

```ts
it('switchAgent/switchModel POST the thin routes', async () => {
  const calls: any[] = [];
  const sdk = new MafwClient({ baseUrl: 'http://x', fetch: async (url: string, init: any) => {
    calls.push({ url, init });
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) } as any;
  }});
  await sdk.session.switchAgent({ path: { id: 's1' }, body: { agent: 'plan' } });
  await sdk.session.switchModel({ path: { id: 's1' }, body: { model: { providerID: 'p', modelID: 'm' } } });
  expect(calls[0].url).toContain('/api/sessions/s1/agent');
  expect(JSON.parse(calls[0].init.body)).toEqual({ agent: 'plan' });
  expect(calls[1].url).toContain('/api/sessions/s1/model');
});
```

- [ ] **Step 7: Run SDK test to verify it fails, implement SDK, rerun**

Run: `cd packages/gateway-sdk; npm test -- --test-name-pattern "switchAgent"`
Expected: FAIL, then implement methods and expect PASS.

SDK:

```ts
switchAgent: async (params: { path: { id: string }; body: { agent: string } }): Promise<void> => {
  await this.request(`/api/sessions/${params.path.id}/agent`, { method: 'POST', body: JSON.stringify(params.body) })
},
switchModel: async (params: { path: { id: string }; body: { model: { providerID: string; modelID: string }; variant?: string } }): Promise<void> => {
  await this.request(`/api/sessions/${params.path.id}/model`, { method: 'POST', body: JSON.stringify(params.body) })
},
```

Add the same signatures to `SessionsNamespace` in `types.ts`.

- [ ] **Step 8: Wire preload + desktop**

`mafw-api.ts`:

```ts
switchAgent: (id, agent) => invoke("session", "switchAgent", { path: { id }, body: { agent } }),
switchModel: (id, model) => invoke("session", "switchModel", { path: { id }, body: { model } }),
```

`mafw-types.ts` add:

```ts
switchAgent: (id: string, agent: string) => Promise<void>
switchModel: (id: string, model: { providerID: string; modelID: string }) => Promise<void>
```

`MafwShell.tsx`:

- `onModelSelect`: after `setModelPicks`, call `window.api.mafw.sessions.switchModel(target, { providerID: m.providerID, modelID: m.id }).catch(() => { /* rollback to previous pick + toast */ })`.
- `applyAgentSwitch`: capture `const prev = agentPicks[sid]`; set new value; call `window.api.mafw.sessions.switchAgent(sid, agentKey(a)).catch(() => { setAgentPicks(sid, prev as any); showToastV2({ description: "切换 agent 失败", duration: 2000 }) })`.
- Do not call switch on `onPlanBuildToggle` "default" branch; clearing a pick has no 2.1 endpoint in this batch.

- [ ] **Step 9: Run desktop typecheck/build**

Run: `cd packages/desktop; npx tsgo --noEmit` (or `npm run typecheck`); then `npx electron-vite build`.
Expected: rc=0 / built.

- [ ] **Step 10: Commit**

```bash
git add gateway/src/runtime/contract.ts gateway/src/runtime/opencode-adapter.ts gateway/src/routes/session-switch.ts gateway/src/index.ts gateway/tests/unit/routes/session-switch.test.ts packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/client.test.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/src/preload/mafw-types.ts packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(runtime+desktop): immediate sticky agent/model switch via 2.1 thin routes"
```

---

### Task 3: StopReason + remaining 2.1 SSE events

**Files:**
- Modify: `gateway/src/runtime/contract.ts` (`StopReason`, `PromptResultEnvelope.stopReason?`)
- Modify: `gateway/src/runtime/opencode-adapter.ts` (`prompt` maps `info.finish`)
- Modify: `gateway/src/runtime/opencode-21-events.ts` (succeeded/failed/interrupted/diff/compaction.failed/retry/inbox)
- Test: `gateway/tests/unit/runtime/opencode-21-events.test.ts`
- Test: `gateway/tests/unit/runtime/opencode-branch.test.ts`
- Create: `packages/session-ui/src/util/stop-reason.ts` + `.test.ts`
- Modify: `packages/session-ui/src/components/session-turn.tsx` (non-end_turn hint)
- Create: `packages/desktop/src/renderer/mafw/sse/handlers/queue.ts` (+ test) to consume `queue.updated`
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts` (register queue handler)

**Interfaces:**
- Produces: `type StopReason = ...`; `PromptResultEnvelope.stopReason?: StopReason`; `turn.completed.properties.stopReason`; `turn.failed.properties.errorCode`; `turn.aborted.properties.stopReason`; `session.diff.properties.diff`; `queue.updated.properties.{sessionID,item?,id?,action}`; `message.updated.properties.info.retry`.

- [ ] **Step 1: Write failing StopReason tests**

In `opencode-21-events.test.ts`:

```ts
test('execution.succeeded 带 finish=length → stopReason=max_tokens', () => {
  const out = apply(evt('session.execution.succeeded', { sessionID: 's1', finish: 'length' }))[0].payload;
  expect(out.type).toBe('turn.completed');
  expect(out.properties.stopReason).toBe('max_tokens');
});
test('先 step.ended(finish=stop) 再 succeeded → end_turn', () => {
  apply(evt('session.step.ended', { sessionID: 's1', assistantMessageID: 'm1', finish: 'stop' }));
  const out = apply(evt('session.execution.succeeded', { sessionID: 's1' }))[0].payload;
  expect(out.properties.stopReason).toBe('end_turn');
});
test('execution.interrupted → turn.aborted stopReason=cancelled', () => {
  const out = apply(evt('session.execution.interrupted', { sessionID: 's1' }))[0].payload;
  expect(out).toMatchObject({ type: 'turn.aborted', properties: { sessionID: 's1', stopReason: 'cancelled' } });
});
test('failed 带 errorCode', () => {
  const out = apply(evt('session.execution.failed', { sessionID: 's1', error: { type: 'provider.auth', message: 'forbidden' } }))[0].payload;
  expect(out.properties.errorCode).toBe('provider.auth');
});
```

In `opencode-branch.test.ts`:

```ts
it('prompt maps finish to stopReason', async () => {
  // mock directNative via global.fetch: prompt POST 200 {}, wait 200 {}, message list 200 {data:[{type:'assistant', finish:'length', content:[]}]}
  const out = await client.session.prompt({ sessionID: 's1', message: 'hi' });
  expect(out.stopReason).toBe('max_tokens');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd gateway; npx jest tests/unit/runtime/opencode-21-events.test.ts tests/unit/runtime/opencode-branch.test.ts -t "stopReason|errorCode|interrupted" --silent`
Expected: FAIL.

- [ ] **Step 3: Implement StopReason in contract + adapter**

```ts
export type StopReason = 'end_turn' | 'max_tokens' | 'tool_use' | 'refusal' | 'cancelled' | 'error' | 'unknown';

export function stopReasonOf(finish?: string): StopReason {
  switch (finish) {
    case 'stop': return 'end_turn';
    case 'length': return 'max_tokens';
    case 'tool-calls': return 'tool_use';
    case 'content-filter': return 'refusal';
    case 'error': return 'error';
    default: return finish ? 'unknown' : 'unknown';
  }
}
```

Add `stopReason?: StopReason` to `PromptResultEnvelope`; adapter `prompt` returns `stopReason: stopReasonOf(info?.finish)`.

- [ ] **Step 4: Move succeeded/failed out of the mapping table into transform**

Remove these rows from `OPENCODE_21_EVENT_MAPPINGS`:

```ts
{ from: 'session.execution.succeeded', ... },
{ from: 'session.execution.failed', ... },
```

Add a module-level `lastFinish = new Map<string, string>()`.

In `translateOpencode21Event`:

```ts
case 'session.step.ended': {
  if (data.sessionID && data.finish) lastFinish.set(data.sessionID, data.finish);
  // existing step-finish part...
}
case 'session.execution.succeeded': {
  const finish = data.finish ?? lastFinish.get(data.sessionID);
  lastFinish.delete(data.sessionID);
  return eventOf(raw, MAFW.turnCompleted, { sessionID: data.sessionID, stopReason: stopReasonOf(finish), ...(finish ? { finish } : {}) });
}
case 'session.execution.failed': {
  lastFinish.delete(data.sessionID);
  return eventOf(raw, MAFW.turnFailed, { sessionID: data.sessionID, error: data.error?.message ?? 'turn failed', errorCode: data.error?.type ?? 'unknown', stopReason: 'error' });
}
case 'session.execution.interrupted':
  return eventOf(raw, MAFW.turnAborted, { sessionID: data.sessionID, stopReason: 'cancelled' });
```

Import `stopReasonOf` from `contract` (or a small `stop-reason.ts` in gateway runtime to avoid pulling the whole contract; either is fine — use `contract.ts` for single source).

- [ ] **Step 5: Implement SSE mappings**

Add to `translateOpencode21Event`:

```ts
case 'session.diff':
  return eventOf(raw, MAFW.sessionDiff, { sessionID: data.sessionID, diff: data.diff ?? data.files ?? [] });
case 'session.compaction.failed':
  return eventOf(raw, MAFW.sessionCompacted, { sessionID: data.sessionID, status: 'failed', error: data.error?.message ?? data.error ?? 'compaction failed', reason: data.reason });
case 'session.retry.scheduled':
  return eventOf(raw, MAFW.messageUpdated, { info: { id: data.assistantMessageID, sessionID: data.sessionID, role: 'assistant', retry: { attempt: data.attempt, at: data.at ?? raw.created, error: data.error } } });
case 'session.inbox.enqueued':
case 'session.inbox.delivered':
case 'session.inbox.update':
case 'session.inbox.cancel':
case 'session.inbox.cancelled':
case 'session.inbox.delivery.changed':
  return eventOf(raw, MAFW.queueUpdated, {
    sessionID: data.sessionID,
    action: type.slice('session.inbox.'.length),
    ...(data.item ? { item: data.item } : {}),
    ...(data.id ? { id: data.id } : {}),
  });
```

Remove `session.inbox.enqueued/delivered` and `session.retry.scheduled` from `NOISE_TYPES`.

- [ ] **Step 6: Run event tests**

Add assertions for diff/compaction/retry/inbox:

```ts
test('session.diff → canonical session.diff (diff or files)', () => {
  expect(apply(evt('session.diff', { sessionID: 's1', diff: [{ file: 'a.ts' }] }))[0].payload)
    .toMatchObject({ type: 'session.diff', properties: { sessionID: 's1', diff: [{ file: 'a.ts' }] } });
  expect(apply(evt('session.diff', { sessionID: 's1', files: [{ file: 'b.ts' }] }))[0].payload.properties.diff)
    .toEqual([{ file: 'b.ts' }]);
});
test('compaction.failed / retry / inbox', () => {
  expect(apply(evt('session.compaction.failed', { sessionID: 's1', error: { message: 'boom' } }))[0].payload)
    .toMatchObject({ type: 'session.compacted', properties: { status: 'failed', error: 'boom' } });
  expect(apply(evt('session.retry.scheduled', { sessionID: 's1', assistantMessageID: 'm1', attempt: 2 }))[0].payload)
    .toMatchObject({ type: 'message.updated', properties: { info: { retry: { attempt: 2 } } } });
  expect(apply(evt('session.inbox.enqueued', { sessionID: 's1', item: { id: 'q1' } }))[0].payload)
    .toMatchObject({ type: 'queue.updated', properties: { action: 'enqueued', item: { id: 'q1' } } });
});
```

Run: `cd gateway; npx jest tests/unit/runtime/opencode-21-events.test.ts --silent`
Expected: PASS.

- [ ] **Step 7: Add session-ui stop-reason helper + turn hint**

`stop-reason.ts`:

```ts
export type StopReason = 'end_turn' | 'max_tokens' | 'tool_use' | 'refusal' | 'cancelled' | 'error' | 'unknown';
const LABELS: Record<StopReason, string> = {
  end_turn: '',
  max_tokens: '达到输出上限',
  tool_use: '',
  refusal: '内容被过滤',
  cancelled: '已停止',
  error: '回合出错',
  unknown: '',
};
export function stopReasonLabel(reason?: string | null): string { return reason ? (LABELS as any)[reason] ?? '' : '' }
export function isAbnormalStop(reason?: string | null): boolean { return !!reason && reason !== 'end_turn' && reason !== 'tool_use' }
```

Test:
```ts
test('abnormal labels', () => { expect(stopReasonLabel('max_tokens')).toBe('达到输出上限'); expect(isAbnormalStop('end_turn')).toBe(false); expect(isAbnormalStop('cancelled')).toBe(true) })
```

`session-turn.tsx`: add a memo:

```ts
const stopReason = createMemo(() => {
  const last = assistantMessages().at(-1)
  return (last as any)?.stopReason ?? (last as any)?.finish ?? ''
})
```

Add after the assistant content/error block:

```tsx
<Show when={isAbnormalStop(stopReason())}>
  <div data-slot="session-turn-stop-reason">{stopReasonLabel(stopReason())}</div>
</Show>
```

If the message info has `finish` raw (`length`), map it through `stopReasonOf` first; export `stopReasonOf` from the helper or map raw finish in the memo.

- [ ] **Step 8: Add queue handler to avoid unhandled SSE warnings**

`handlers/queue.ts`:

```ts
import type { SidHandler } from "../dispatcher"
export const handleQueueEvent: SidHandler = (event, _sid, deps) => {
  if (event.type !== "queue.updated") return false
  deps.core.trace(event, "chat:queue")
  return true
}
```

Register in `dispatcher.ts` before `handleChatStreamEvent` (or after; no other handler consumes `queue.updated`). Add a small test only if the dispatcher test harness makes it cheap; otherwise rely on the handler test? Create `queue.test.ts` with a fake deps object and assert true for `queue.updated`, false otherwise.

- [ ] **Step 9: Run gateway + session-ui + desktop tests**

Run:
```bash
cd gateway; npx jest tests/unit/runtime/opencode-21-events.test.ts tests/unit/runtime/opencode-branch.test.ts --silent
cd packages/session-ui; npm test
cd packages/desktop; npm test
```
Expected: all green (gateway known laya flake only on full suite; these files don't touch it).

- [ ] **Step 10: Commit**

```bash
git add gateway/src/runtime/contract.ts gateway/src/runtime/opencode-adapter.ts gateway/src/runtime/opencode-21-events.ts gateway/tests/unit/runtime/opencode-21-events.test.ts gateway/tests/unit/runtime/opencode-branch.test.ts packages/session-ui/src/util/stop-reason.ts packages/session-ui/src/util/stop-reason.test.ts packages/session-ui/src/components/session-turn.tsx packages/desktop/src/renderer/mafw/sse/handlers/queue.ts packages/desktop/src/renderer/mafw/sse/handlers/queue.test.ts packages/desktop/src/renderer/mafw/sse/dispatcher.ts
git commit -m "feat(runtime+session-ui): canonical stop reasons and remaining 2.1 SSE events"
```

---

## Self-Review

- [x] Children: adapter + contract + tracker + handler + tests.
- [x] Sticky: contract + adapter + route + SDK + preload + renderer + tests.
- [x] StopReason: contract + adapter + events + session-ui + tests.
- [x] SSE: diff / compaction.failed / interrupted / retry / inbox mapped; queue handler consumes.
- [x] Failure modes: children fail-open, no metadata → no row, switch rollback, unknown stop reason, diff `files` fallback.
- [x] No new vocabulary, no new dependency, no per-turn diff semantics.
