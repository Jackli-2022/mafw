# T2-4 Instruction Entries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move MAFW's three memory system blocks (memory-guide / user-profile / agent-priors) from per-turn system injection to opencode 2.1 per-session instruction entries, with a gateway-side prompt-time sync and a plugin/pi fallback.

**Architecture:** A gateway `InstructionSyncService` renders the blocks, compares content hashes, and writes/deletes `api/mafw.*` entries before every gateway prompt (250ms hard budget, AbortSignal). A single `GET /api/recall/instructions` endpoint reports actual entry presence (`list`) and returns only missing blocks. The opencode plugin injects only those missing blocks; pi always consumes the endpoint's full blocks. opencode <2.1 / pi / 404 / timeout / gateway-down all fall back to the existing injection paths.

**Tech Stack:** TypeScript, Node 22+, gateway Jest, root plugin Jest, opencode 2.1 experimental HTTP API, better-sqlite3 (smoke DB assertions only).

**Spec:** `docs/superpowers/specs/2026-10-27-t2-instruction-entries-design.md`

## Global Constraints

- Version target: **v4.40.0**; bump with `node scripts/bump-version.mjs 4.40.0`.
- No new runtime dependencies.
- Never write opencode's SQLite tables directly; only use the HTTP instructions API.
- Sync hard budget: **250ms for the whole sync** (render + list + PUT/DELETE); abort and fail-open on timeout.
- 404/405 breaker: **60s cooldown**, not permanent; reset on runtime switch/serve recovery.
- Keep `session.instructions.updated` suppressed in `gateway/src/runtime/opencode-21-events.ts` (`NOISE_TYPES`); do not add a canonical event.
- No desktop/TUI UI changes; no SDK event-union changes.
- TDD: write the failing test, run it and see it fail, implement the minimal code, run it green, commit.
- Native/inline execution on `main`; no push/PR/npm publish without explicit user confirmation.
- Use `edit`/`write` for source and docs; do not use PowerShell `Set-Content` (UTF-8 corruption).
- Do not stage or modify the parallel untracked `docs/superpowers/plans/2026-10-22-workbench-phase2.md`.
- One commit per task; conventional commit messages; leave the worktree clean except intended files.

## Review Focus

These are the input classes/failure modes most likely to bite a real user; each has a pinning test in the task named.

1. **Experimental API disappears after an opencode upgrade (404/405).** Expected: a 60s breaker, plugin falls back to full blocks, prompt still works, breaker retries and clears. Pinned in Task 3 (breaker tests) and Task 5 (endpoint fallback).
2. **Entries partially present (fork, revert, compaction, partial sync).** Expected: `managed=false` only for missing keys; plugin injects only those; present-but-stale keys are reported but not duplicated. Pinned in Task 3 (`inspect` tests) and Task 6 (missing-only test).
3. **A hung serve PUT/list wedges the prompt.** Expected: whole-sync abort within 250ms, prompt proceeds, no cache update, next prompt retries. Pinned in Task 3 (timeout) and Task 4 (wrapper latency).
4. **Gateway unreachable at plugin startup with no cache.** Expected: no throw, bundled `<memory-guide>` still injected; profile/priors omitted. Pinned in Task 6 (gateway-down test).
5. **`recall.instructions.enabled=false` after entries exist.** Expected: sync stops, next gateway prompt lazily deletes the three keys for that session, endpoint returns full blocks, plugin injects. Pinned in Task 3 (disabled test) and Task 5 (disabled response).

---

### Task 0: Commit the approved spec and plan

**Files:**
- Add: `docs/superpowers/specs/2026-10-27-t2-instruction-entries-design.md`
- Add: `docs/superpowers/plans/2026-10-27-t2-instruction-entries.md`

**Interfaces:**
- Consumes: user-approved spec.
- Produces: committed design/plan baseline for the rest of the tasks.

- [ ] **Step 1: Confirm the worktree contains only intended untracked docs**

Run: `git status --short`
Expected: the two T2-4 docs are untracked; the parallel `2026-10-22-workbench-phase2.md` and `2026-10-27-left-rail-visual-polish-design.md` are also untracked and must not be staged.

- [ ] **Step 2: Commit only the T2-4 spec and plan**

```bash
git add docs/superpowers/specs/2026-10-27-t2-instruction-entries-design.md docs/superpowers/plans/2026-10-27-t2-instruction-entries.md
git commit -m "docs: T2-4 instruction entries spec and plan"
```

---

### Task 1: Runtime capability + opencode adapter instructions API

**Files:**
- Modify: `gateway/src/runtime/contract.ts:27-64` (capabilities), `:66-110` (full/minimal), `:317-399` (RuntimeClient.session)
- Modify: `gateway/src/runtime/opencode-adapter.ts:185-205` (`directNative`), `:240-...` (session object)
- Modify: `gateway/src/runtime/validate.ts:41-53` (capability requirement)
- Modify: `gateway/src/index.ts:660-677` (`opencode@v1/@v2` capability overrides)
- Modify: `gateway/tests/unit/runtime/contract.test.ts:8-47`
- Modify: `gateway/tests/unit/runtime/opencode-runtime.test.ts:119`
- Modify: `gateway/tests/unit/runtime/validate-shape.test.ts` (add downgrade case)
- Create: `gateway/tests/unit/runtime/opencode-adapter-instructions.test.ts`

**Interfaces:**
- Consumes: existing `createOpencodeAdapter`, `directNative`, `serveAuthHeaders`.
- Produces:
  ```ts
  instructionsApi?: boolean;
  session.instructions?: {
    list(sessionID: string, opts?: { signal?: AbortSignal }): Promise<Array<{ key: string; value: unknown }>>;
    put(sessionID: string, key: string, value: unknown, opts?: { signal?: AbortSignal }): Promise<void>;
    remove(sessionID: string, key: string, opts?: { signal?: AbortSignal }): Promise<void>;
  };
  ```
  `directNative(path, method, body?, directory?, opts?: { signal?: AbortSignal })`; non-2xx errors carry `status: number`.

- [ ] **Step 1: Write the failing capability/validation tests**

In `gateway/tests/unit/runtime/contract.test.ts`, add `instructionsApi: true` to the `fullCapabilities()` expected object and `instructionsApi: false` to `minimalCapabilities()`. In `gateway/tests/unit/runtime/opencode-runtime.test.ts`, add `instructionsApi: true` to the expected capabilities object. In `gateway/tests/unit/runtime/validate-shape.test.ts`, add:

```ts
it('instructionsApi without session.instructions.{list,put,remove} -> downgraded', () => {
  const rt = OK_RT({ caps: { instructionsApi: true } });
  const v = validateRuntime(rt, 'test');
  expect(v.downgraded.some((i) => i.includes('instructionsApi'))).toBe(true);
  expect((rt as any).capabilities.instructionsApi).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd gateway && npx jest tests/unit/runtime/contract.test.ts tests/unit/runtime/opencode-runtime.test.ts tests/unit/runtime/validate-shape.test.ts --runInBand`
Expected: FAIL — `instructionsApi` missing / not downgraded.

- [ ] **Step 3: Implement the capability and validation**

Add `instructionsApi?: boolean` to `RuntimeCapabilities` with the comment `/** opencode 2.1 per-session instruction entries (experimental) */`. Add `session.instructions` to `RuntimeClient.session` with the exact signature above. `fullCapabilities()` sets `true`; `minimalCapabilities()` sets `false`. Add to `CAPABILITY_REQUIREMENTS`:

```ts
{ cap: 'instructionsApi', label: 'session.instructions.{list,put,remove}', satisfied: (rt) =>
    isObject(rt.session?.instructions) && isFn(rt.session.instructions.list) &&
    isFn(rt.session.instructions.put) && isFn(rt.session.instructions.remove) },
```

In `gateway/src/index.ts`, change the `opencode@v1` and `opencode@v2` `registerBuiltin` capability arguments to `{ ...fullCapabilities(), instructionsApi: false }`; leave `opencode` and `opencode@v21` as `fullCapabilities()`.

- [ ] **Step 4: Run the capability tests to verify they pass**

Run: `cd gateway && npx jest tests/unit/runtime/contract.test.ts tests/unit/runtime/opencode-runtime.test.ts tests/unit/runtime/validate-shape.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Write the failing adapter test**

Create `gateway/tests/unit/runtime/opencode-adapter-instructions.test.ts`. Start with `jest.mock('@opencode-ai/sdk/v2', () => ({ createOpencodeClient: () => ({}) }));` because the real subpath is ESM-only and the gateway Jest mapper points it at a throwing stub. Use a `global.fetch` mock that records `{url, method, body, signal}` and returns:

```ts
const rt = await createOpencodeAdapter({ baseUrl: 'http://serve.test' });
const controller = new AbortController();
const list = await rt.session.instructions!.list('s1', { signal: controller.signal });
```

Assert:
- list URL ends with `/api/experimental/session/s1/instructions/entries`; method `GET`; `Authorization` starts with `Basic `; signal is the passed signal.
- list returns `[{ key: 'k', value: 'v' }]` from `{ data: [...] }`.
- put sends `PUT` and body `{"value":"hello"}` to `/entries/mafw.memory-guide`.
- remove sends `DELETE`.
- a mock `404` response rejects with an error whose `.status === 404`.

- [ ] **Step 6: Run the adapter test to verify it fails**

Run: `cd gateway && npx jest tests/unit/runtime/opencode-adapter-instructions.test.ts --runInBand`
Expected: FAIL — `session.instructions` undefined / `directNative` signature.

- [ ] **Step 7: Implement the adapter methods and error status**

In `opencode-adapter.ts`, change `directNative` to accept `opts?: { signal?: AbortSignal }`, pass `signal: opts?.signal` into `fetch`, and on `!res.ok` throw:

```ts
const err: any = new Error(`opencode native ${path} failed: ${res.status}`);
err.status = res.status;
throw err;
```

Inside the returned `session` object add:

```ts
instructions: {
  list: async (sessionID, opts) => unwrapNative(await directNative(
    `/experimental/session/${sessionID}/instructions/entries`, 'GET', undefined, undefined, opts)),
  put: async (sessionID, key, value, opts) => {
    await directNative(`/experimental/session/${sessionID}/instructions/entries/${encodeURIComponent(key)}`,
      'PUT', { value }, undefined, opts);
  },
  remove: async (sessionID, key, opts) => {
    await directNative(`/experimental/session/${sessionID}/instructions/entries/${encodeURIComponent(key)}`,
      'DELETE', undefined, undefined, opts);
  },
},
```

- [ ] **Step 8: Run the adapter test to verify it passes**

Run: `cd gateway && npx jest tests/unit/runtime/opencode-adapter-instructions.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add gateway/src/runtime/contract.ts gateway/src/runtime/opencode-adapter.ts gateway/src/runtime/validate.ts gateway/src/index.ts gateway/tests/unit/runtime/contract.test.ts gateway/tests/unit/runtime/opencode-runtime.test.ts gateway/tests/unit/runtime/validate-shape.test.ts gateway/tests/unit/runtime/opencode-adapter-instructions.test.ts
git commit -m "feat(runtime): instruction entries capability and adapter"
```

---

### Task 2: Instruction block renderer + MEMORY_GUIDE single source

**Files:**
- Create: `gateway/src/recall/instruction-blocks.ts`
- Modify: `gateway/src/runtime/host-adapter.ts:48-78` (move constant; re-export for compatibility)
- Create: `gateway/tests/unit/recall/instruction-blocks.test.ts`
- Modify: `gateway/tests/unit/runtime/host-adapter.test.ts` (wording assertions)

**Interfaces:**
- Consumes: `handleRecallPinned` / `handleAgentPriors` result shapes (`{profile}`, `{block}`) via injected functions.
- Produces:
  ```ts
  export const MEMORY_GUIDE: string;
  export const INSTRUCTION_KEYS = {
    memoryGuide: 'mafw.memory-guide',
    userProfile: 'mafw.user-profile',
    agentPriors: 'mafw.agent-priors',
  } as const;
  export type InstructionKey = (typeof INSTRUCTION_KEYS)[keyof typeof INSTRUCTION_KEYS];

  export interface InstructionBlocks {
    memoryGuide: string;
    userProfile: string | null;
    agentPriors: string | null;
    errors?: { userProfile?: string; agentPriors?: string };
    revision: string;
  }
  export interface InstructionBlockDeps {
    getPinnedProfile(): Promise<string | null>;
    getAgentPriors(): Promise<string | null>;
  }
  export async function renderInstructionBlocks(deps: InstructionBlockDeps): Promise<InstructionBlocks>;
  ```

- [ ] **Step 1: Write the failing renderer test**

Create `gateway/tests/unit/recall/instruction-blocks.test.ts`:

```ts
import { renderInstructionBlocks, MEMORY_GUIDE, INSTRUCTION_KEYS } from '../../../src/recall/instruction-blocks';

it('renders guide + nulls when both sources are empty; revision is 64 hex', async () => {
  const r = await renderInstructionBlocks({ getPinnedProfile: async () => null, getAgentPriors: async () => null });
  expect(r.memoryGuide).toBe(MEMORY_GUIDE);
  expect(r.userProfile).toBeNull();
  expect(r.agentPriors).toBeNull();
  expect(r.errors).toBeUndefined();
  expect(r.revision).toMatch(/^[a-f0-9]{64}$/);
});

it('renders blocks and revision changes when profile changes', async () => {
  const a = await renderInstructionBlocks({ getPinnedProfile: async () => '<user-profile>A</user-profile>', getAgentPriors: async () => '<agent-priors>P</agent-priors>' });
  const b = await renderInstructionBlocks({ getPinnedProfile: async () => '<user-profile>B</user-profile>', getAgentPriors: async () => '<agent-priors>P</agent-priors>' });
  expect(a.userProfile).toContain('A');
  expect(a.agentPriors).toContain('P');
  expect(a.revision).not.toBe(b.revision);
});

it('keeps the guide and records a per-block error when profile throws', async () => {
  const r = await renderInstructionBlocks({ getPinnedProfile: async () => { throw new Error('disk'); }, getAgentPriors: async () => '<agent-priors>P</agent-priors>' });
  expect(r.memoryGuide).toBe(MEMORY_GUIDE);
  expect(r.userProfile).toBeNull();
  expect(r.errors?.userProfile).toContain('disk');
  expect(r.agentPriors).toContain('P');
});

it('exports the three stable keys', () => {
  expect(INSTRUCTION_KEYS).toEqual({ memoryGuide: 'mafw.memory-guide', userProfile: 'mafw.user-profile', agentPriors: 'mafw.agent-priors' });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd gateway && npx jest tests/unit/recall/instruction-blocks.test.ts --runInBand`
Expected: FAIL — module not found.

- [ ] **Step 3: Move MEMORY_GUIDE and implement the renderer**

Move the `MEMORY_GUIDE` constant from `host-adapter.ts` into `recall/instruction-blocks.ts`; update two phrases:
- `pinned: true（每轮保证注入）` → `pinned: true（常驻披露层，instruction entries 持久注入）`
- `便签板上每轮必见` → `便签板常驻可见，到期自动下架`

In `host-adapter.ts`, replace the constant with `export { MEMORY_GUIDE } from '../recall/instruction-blocks';` (keep the existing import site in `pi-mafw-host-extension.ts` working). Implement `renderInstructionBlocks` with independent try/catch per source, `errors` only on thrown errors, and:

```ts
const revision = crypto.createHash('sha256')
  .update(JSON.stringify({ memoryGuide: MEMORY_GUIDE, userProfile, agentPriors }))
  .digest('hex');
```

- [ ] **Step 4: Run the renderer and host-adapter tests**

Run: `cd gateway && npx jest tests/unit/recall/instruction-blocks.test.ts tests/unit/runtime/host-adapter.test.ts --runInBand`
Expected: PASS (host-adapter still imports `MEMORY_GUIDE`, now re-exported).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/instruction-blocks.ts gateway/src/runtime/host-adapter.ts gateway/tests/unit/recall/instruction-blocks.test.ts gateway/tests/unit/runtime/host-adapter.test.ts
git commit -m "feat(recall): render instruction blocks from one source"
```

---

### Task 3: InstructionSyncService

**Files:**
- Create: `gateway/src/core/instructions/instruction-sync-service.ts`
- Create: `gateway/tests/unit/core/instructions/instruction-sync-service.test.ts`

**Interfaces:**
- Consumes: `InstructionBlocks`, `INSTRUCTION_KEYS`, `InstructionKey` from Task 2; `RuntimeClient.session.instructions` from Task 1.
- Produces:
  ```ts
  export interface InstructionSyncDeps {
    render(signal?: AbortSignal): Promise<InstructionBlocks>;
    getRuntime(): AgentRuntime | null;
    isEnabled(): boolean;
    now?: () => number;
    log?: { info(msg: string): void; warn(msg: string): void };
    syncTimeoutMs?: number;      // default 250
    disabledCooldownMs?: number; // default 60_000
    maxBlockBytes?: number;      // default 16 * 1024
  }
  export class InstructionSyncService {
    constructor(deps: InstructionSyncDeps);
    sync(sessionID: string): Promise<{ managed: boolean; revision?: string; error?: string }>;
    inspect(sessionID: string, blocks: InstructionBlocks): Promise<{
      managed: boolean;
      missing: string[];
      staleKeys: string[];
      reason?: 'capability_absent' | 'disabled' | 'list_failed' | 'breaker';
    }>;
    forget(sessionID: string): void;
    reset(): void;
    diagnostics(): { disabledUntil?: number; disabledReason?: string; lastError?: string };
  }
  ```

- [ ] **Step 1: Write the failing service tests (sync path)**

Create `gateway/tests/unit/core/instructions/instruction-sync-service.test.ts` with a fake runtime:

```ts
function makeRt(store = new Map<string, unknown>()) {
  const calls: string[] = [];
  return {
    calls,
    rt: {
      name: 'opencode', activeDialect: 'v21',
      capabilities: { instructionsApi: true },
      session: { instructions: {
        list: async (_sid: string, _opts?: any) => { calls.push('list'); return [...store].map(([key, value]) => ({ key, value })); },
        put: async (_sid: string, key: string, value: unknown, _opts?: any) => { calls.push('put:' + key); store.set(key, value); },
        remove: async (_sid: string, key: string, _opts?: any) => { calls.push('remove:' + key); store.delete(key); },
      } },
    } as any,
  };
}
const blocks = (over: Partial<any> = {}) => ({
  memoryGuide: '<memory-guide>G</memory-guide>',
  userProfile: '<user-profile>P</user-profile>',
  agentPriors: '<agent-priors>A</agent-priors>',
  revision: 'r1', ...over,
});
```

Tests:
- `first sync puts all three and returns managed; second sync makes no writes` — after first, clear `calls`; second sync `calls` does not include `put`/`remove` (list seed may be cached; assert no put/remove).
- `changed profile only puts profile` — change the render value; assert `put:mafw.user-profile` only.
- `null profile removes profile` — assert `remove:mafw.user-profile`; null priors removes priors.
- `render error keeps the old entry` — seed store with old profile; render `errors.userProfile`; assert no `put`/`remove` for profile, and other blocks sync.
- `seed from list avoids redundant puts` — pre-populate store with the same values; first sync has no `put`.
- `whole sync timeout aborts and does not update cache` — `syncTimeoutMs: 20`, a put returns a promise that rejects on `signal.abort`; assert `managed:false`, `signal.aborted`, and a second sync tries again (calls list again).
- `single-flight` — call `sync` twice; assert one `list` (with fake timers or a deferred promise).
- `404 opens a 60s breaker and reset clears it` — a put throws `Object.assign(new Error('404'), { status: 404 })`; first sync unmanaged; second within cooldown has no list; advance `now` 61s; third succeeds and clears; `reset()` clears immediately.
- `enabled=false removes the three keys and does not render/put` — assert `remove` for all three, no `put`, managed false.
- `maxBlockBytes truncates` — set `maxBlockBytes: 10`, assert stored value length ≤10 and no throw.

- [ ] **Step 2: Run the sync tests to verify they fail**

Run: `cd gateway && npx jest tests/unit/core/instructions/instruction-sync-service.test.ts --runInBand`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service sync path**

Implement with:
- `keysFor(blocks)` returning `[ {key: INSTRUCTION_KEYS.memoryGuide, value: blocks.memoryGuide}, ... ]`.
- `hashOf(value)` = sha256 of the exact string.
- `cache: Map<sessionID, Map<key, hash>>`; `listSeeded: Set<sessionID>`.
- `singleFlight: Map<sessionID, Promise<...>>`; clear in `finally`.
- `AbortController` + `setTimeout`; clear timer in `finally`.
- `directNative` calls receive `{ signal }` through the runtime method's `opts`.
- On `err.status === 404 || 405`, set `disabledUntil = now + disabledCooldownMs`; on success after cooldown, clear.
- `isEnabled()` false → best-effort `remove` all three (catch each), return `{managed:false,error:'disabled'}`.
- `errors.<key>` → skip; `null` without error → remove.
- `signal.aborted` → return `{managed:false,error:'timeout'}` before cache update.
- `getRuntime()` capability/`activeDialect` checks.

- [ ] **Step 4: Run the sync tests to verify they pass**

Run: `cd gateway && npx jest tests/unit/core/instructions/instruction-sync-service.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Write the failing `inspect` tests**

Add to the same file:
- all three present → `managed:true, missing:[], staleKeys:[]`.
- profile absent → `managed:false, missing:['mafw.user-profile']`.
- profile present but different → `managed:true, staleKeys:['mafw.user-profile'], missing:[]`.
- capability absent → `managed:false, missing` all three, `reason:'capability_absent'`.
- list throws → `managed:false`, all missing, `reason:'list_failed'`.
- breaker active → `reason:'breaker'`.
- `enabled=false` → `reason:'disabled'`, all missing.

- [ ] **Step 6: Implement `inspect` and run the full service test**

`inspect` calls `list(sessionID, { signal: AbortSignal.timeout(150) })`, compares string values, and returns the shape above. Run:
`cd gateway && npx jest tests/unit/core/instructions/instruction-sync-service.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add gateway/src/core/instructions/instruction-sync-service.ts gateway/tests/unit/core/instructions/instruction-sync-service.test.ts
git commit -m "feat(gateway): instruction sync service"
```

---

### Task 4: Prompt wrapper + gateway wiring + config

**Files:**
- Create: `gateway/src/runtime/instruction-wrapper.ts`
- Create: `gateway/tests/unit/runtime/instruction-wrapper.test.ts`
- Modify: `gateway/src/index.ts:102` (imports), `:1616-1631` (`wrapRuntimeIdentity`), add private `buildInstructionBlocks()` / `ensureInstructionSync()` near the recall routes
- Modify: `gateway/src/config.ts:299-329` (interface), `:610-629` (defaults)
- Modify: `gateway/tests/unit/runtime/identity-queue-intercept.test.ts` (add composition case)

**Interfaces:**
- Consumes: `InstructionSyncService`, `renderInstructionBlocks`, `handleRecallPinned`, `handleAgentPriors`.
- Produces:
  ```ts
  export function withInstructionSync<T extends { promptAsync(o:any):Promise<any>; prompt(o:any):Promise<any> }>(
    session: T,
    sync: (sessionID: string) => Promise<unknown>,
  ): T;
  ```
  Config: `recall.instructions: { enabled: boolean }` (default `true`).

- [ ] **Step 1: Write the failing wrapper test**

Create `gateway/tests/unit/runtime/instruction-wrapper.test.ts`:

```ts
it('syncs before promptAsync and prompt; other methods pass through', async () => {
  const calls: string[] = [];
  const target = {
    promptAsync: async (o: any) => { calls.push('promptAsync:' + o.sessionID); return { ok: true }; },
    prompt: async (o: any) => { calls.push('prompt:' + o.sessionID); return {}; },
    other: () => 42,
  };
  const wrapped = withInstructionSync(target as any, async (sid) => { calls.push('sync:' + sid); });
  expect(await wrapped.promptAsync({ sessionID: 's1' })).toEqual({ ok: true });
  await wrapped.prompt({ sessionID: 's2' });
  expect(calls).toEqual(['sync:s1', 'promptAsync:s1', 'sync:s2', 'prompt:s2']);
  expect((wrapped as any).other()).toBe(42);
});

it('sync failure never blocks the prompt', async () => {
  const target = { promptAsync: async () => ({ ok: true }), prompt: async () => ({}) };
  const wrapped = withInstructionSync(target as any, async () => { throw new Error('boom'); });
  await expect(wrapped.promptAsync({ sessionID: 's1' })).resolves.toEqual({ ok: true });
});

it('identity queue intercept short-circuits before sync', async () => {
  const calls: string[] = [];
  const target = { promptAsync: async () => { calls.push('target'); return {}; }, prompt: async () => ({}) };
  const synced = withInstructionSync(target as any, async () => { calls.push('sync'); });
  const wrapped = withIdentityPrompt(synced as any, new IdentityState() as any, () => 'test', () => false,
    async () => ({ queued: true }));
  await wrapped.promptAsync({ sessionID: 's1', delivery: 'queue' });
  expect(calls).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd gateway && npx jest tests/unit/runtime/instruction-wrapper.test.ts --runInBand`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the wrapper**

Use the Proxy shape from the spec §4.5: override `promptAsync`/`prompt`, `await sync(o.sessionID)` in a try/catch, delegate everything else with `Reflect.get` + bind.

- [ ] **Step 4: Run the wrapper test to verify it passes**

Run: `cd gateway && npx jest tests/unit/runtime/instruction-wrapper.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Add config and gateway wiring**

Add `instructions: { enabled: boolean }` to `RecallConfig` and `{ enabled: true }` to defaults. In `gateway/src/index.ts`:
- import `InstructionSyncService`, `withInstructionSync`, `renderInstructionBlocks`, `InstructionBlocks`.
- add `private instructionSync?: InstructionSyncService;`.
- add `private async buildInstructionBlocks(): Promise<InstructionBlocks>` using the same deps as the pinned/priors routes (`HarmonicUnitFileStore`, `handleRecallPinned`, `handleAgentPriors`, `new L5Store()`, `getRetrievalEventBuffer().needFor`). If `!this.memoryService`, return `renderInstructionBlocks({ getPinnedProfile: async () => null, getAgentPriors: async () => null })`.
- add `private ensureInstructionSync(): InstructionSyncService` that constructs once with `{ render: (signal) => this.buildInstructionBlocks(), getRuntime: () => this.runtime, isEnabled: () => config.recall.instructions?.enabled !== false, log }`.
- in `wrapRuntimeIdentity`, before wrapping: `this.ensureInstructionSync().reset();`; then `const synced = withInstructionSync(rt.session as any, (sid) => this.instructionSync!.sync(sid));` and pass `synced` to `withIdentityPrompt`.

The private wiring is verified indirectly: `tsc --noEmit`, the wrapper/identity unit tests, and the Task 8 live smoke. Do not add a test that reaches into the private method.

- [ ] **Step 6: Typecheck and run the wrapper/identity tests**

Run:
`cd gateway && npx tsc --noEmit`
`cd gateway && npx jest tests/unit/runtime/instruction-wrapper.test.ts tests/unit/runtime/identity-queue-intercept.test.ts --runInBand`
Expected: PASS and no type errors.

- [ ] **Step 7: Commit**

```bash
git add gateway/src/runtime/instruction-wrapper.ts gateway/src/index.ts gateway/src/config.ts gateway/tests/unit/runtime/instruction-wrapper.test.ts gateway/tests/unit/runtime/identity-queue-intercept.test.ts
git commit -m "feat(gateway): sync instruction entries before prompts"
```

---

### Task 5: `GET /api/recall/instructions` endpoint

**Files:**
- Create: `gateway/src/routes/recall-instructions.ts`
- Create: `gateway/tests/unit/routes/recall-instructions.test.ts`
- Modify: `gateway/src/index.ts` near `:6971` (route registration)

**Interfaces:**
- Consumes: `InstructionBlocks`, `InstructionSyncService.inspect`, `INSTRUCTION_KEYS`.
- Produces:
  ```ts
  export interface RecallInstructionsDeps {
    getBlocks(): Promise<InstructionBlocks>;
    getSync(): Pick<InstructionSyncService, 'inspect'> | null;
  }
  export function buildRecallInstructionsResponse(
    blocks: InstructionBlocks,
    inspected: { managed: boolean; missing: string[]; staleKeys: string[]; reason?: string } | null,
  ): {
    managed: boolean;
    revision: string;
    missing: string[];
    staleKeys: string[];
    reason?: string;
    blocks: Partial<Pick<InstructionBlocks, 'memoryGuide' | 'userProfile' | 'agentPriors'>>;
  };
  export async function handleRecallInstructions(
    req: http.IncomingMessage, res: http.ServerResponse, url: string, deps: RecallInstructionsDeps,
  ): Promise<boolean>;
  ```

- [ ] **Step 1: Write the failing pure-response tests**

Create `gateway/tests/unit/routes/recall-instructions.test.ts`:

```ts
const blocks = { memoryGuide: 'G', userProfile: 'P', agentPriors: 'A', revision: 'r1' };
it('managed true -> no blocks', () => {
  const r = buildRecallInstructionsResponse(blocks, { managed: true, missing: [], staleKeys: [] });
  expect(r).toMatchObject({ managed: true, missing: [], blocks: {} });
});
it('missing profile -> only profile block', () => {
  const r = buildRecallInstructionsResponse(blocks, { managed: false, missing: ['mafw.user-profile'], staleKeys: [] });
  expect(r.blocks).toEqual({ userProfile: 'P' });
  expect(r.missing).toEqual(['mafw.user-profile']);
});
it('stale present -> managed true, staleKeys, no blocks', () => {
  const r = buildRecallInstructionsResponse(blocks, { managed: true, missing: [], staleKeys: ['mafw.user-profile'] });
  expect(r.managed).toBe(true);
  expect(r.staleKeys).toEqual(['mafw.user-profile']);
  expect(r.blocks).toEqual({});
});
it('no sync -> all non-null blocks', () => {
  const r = buildRecallInstructionsResponse(blocks, null);
  expect(r.managed).toBe(false);
  expect(r.blocks).toEqual({ memoryGuide: 'G', userProfile: 'P', agentPriors: 'A' });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd gateway && npx jest tests/unit/routes/recall-instructions.test.ts --runInBand`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure response builder and HTTP handler**

`buildRecallInstructionsResponse` maps `missing` keys to block fields, omits null/error blocks, and returns `blocks: {}` when managed. The HTTP handler parses `sessionID` from the query, calls `deps.getBlocks()`, then `deps.getSync()?.inspect(sessionID, blocks)`; on any error returns `managed:false`, all blocks, `reason:'list_failed'`. Return `true` only for `GET /api/recall/instructions`.

- [ ] **Step 4: Run the route tests to verify they pass**

Run: `cd gateway && npx jest tests/unit/routes/recall-instructions.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Wire the route in `index.ts`**

Add before the `/api/recall/pinned` block:

```ts
if (req.url?.startsWith('/api/recall/instructions') && req.method === 'GET') {
  const { handleRecallInstructions } = require('./routes/recall-instructions');
  const handled = await handleRecallInstructions(req, res, req.url, {
    getBlocks: () => this.buildInstructionBlocks(),
    getSync: () => this.instructionSync ?? null,
  });
  if (handled) return;
}
```

- [ ] **Step 6: Verify route + target suite**

Run: `cd gateway && npx jest tests/unit/routes/recall-instructions.test.ts tests/unit/routes/agent-priors.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add gateway/src/routes/recall-instructions.ts gateway/src/index.ts gateway/tests/unit/routes/recall-instructions.test.ts
git commit -m "feat(gateway): recall instructions endpoint"
```

---

### Task 6: opencode plugin fallback

**Files:**
- Create: `src/hooks/instruction-blocks.ts`
- Modify: `src/plugin.ts:32-34`, `:199-201`
- Modify: `src/hooks/memory-guide.ts` (comment: fallback-only)
- Delete: `src/hooks/user-profile.ts`, `src/hooks/agent-priors.ts`
- Modify: `tests/plugin-v2.test.ts:238-301`

**Interfaces:**
- Consumes: `GET /api/recall/instructions?sessionID=...` response from Task 5.
- Produces:
  ```ts
  export async function instructionBlocksSystemHook(
    input: { sessionID?: string },
    output: { system?: string[] },
  ): Promise<any>;
  ```

- [ ] **Step 1: Write the failing plugin tests**

In `tests/plugin-v2.test.ts`, replace the old "appends memory-guide..." test with:

```ts
it('managed=false injects only the missing blocks in guide -> profile -> priors order', async () => {
  const { fetchMock } = makeFetch([
    ['/api/recall/instructions', { managed: false, missing: ['mafw.user-profile'], blocks: {
      memoryGuide: '<memory-guide>G</memory-guide>',
      userProfile: '<user-profile>P</user-profile>',
      agentPriors: null,
    } }],
    ['/api/recall/context', { pointers: null }],
  ]);
  global.fetch = fetchMock as any;
  const { ctx, regs } = makeCtx(mkdtempDir());
  await (mafwPlugin as any).setup(ctx);
  const event = { sessionID: 'ses_missing', system: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] };
  await regs.sessionHooks.context(event);
  const texts = event.system.map((p: any) => String(p.text));
  expect(texts).toContain('<memory-guide>G</memory-guide>');
  expect(texts).toContain('<user-profile>P</user-profile>');
  expect(texts.some((t) => t.includes('<agent-priors>'))).toBe(false);
});

it('managed=true injects none of the three blocks', async () => {
  const { fetchMock } = makeFetch([
    ['/api/recall/instructions', { managed: true, missing: [], staleKeys: [], blocks: {} }],
    ['/api/recall/context', { pointers: null }],
  ]);
  global.fetch = fetchMock as any;
  const { ctx, regs } = makeCtx(mkdtempDir());
  await (mafwPlugin as any).setup(ctx);
  const event = { sessionID: 'ses_managed', system: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] };
  await regs.sessionHooks.context(event);
  const texts = event.system.map((p: any) => String(p.text));
  expect(texts.some((t) => t.includes('<memory-guide>'))).toBe(false);
  expect(texts.some((t) => t.includes('<user-profile>'))).toBe(false);
  expect(texts.some((t) => t.includes('<agent-priors>'))).toBe(false);
});

it('gateway unavailable with no cache injects only the bundled memory guide', async () => {
  global.fetch = jest.fn(async () => { throw new Error('gateway down'); }) as any;
  const { ctx, regs } = makeCtx(mkdtempDir());
  await (mafwPlugin as any).setup(ctx);
  const event = { sessionID: 'ses_down_2', system: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] };
  await regs.sessionHooks.context(event);
  const texts = event.system.map((p: any) => String(p.text));
  expect(texts.some((t) => t.includes('<memory-guide>'))).toBe(true);
  expect(texts.some((t) => t.includes('<user-profile>'))).toBe(false);
  expect(texts.some((t) => t.includes('<agent-priors>'))).toBe(false);
});

it('gateway unavailable after managed=true does not inject blocks', async () => {
  const realNow = Date.now();
  let now = realNow;
  const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  const { fetchMock } = makeFetch([
    ['/api/recall/instructions', { managed: true, missing: [], staleKeys: [], blocks: {} }],
    ['/api/recall/context', { pointers: null }],
  ]);
  global.fetch = fetchMock as any;
  const { ctx, regs } = makeCtx(mkdtempDir());
  await (mafwPlugin as any).setup(ctx);
  const first = { sessionID: 'ses_cached_true', system: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] };
  await regs.sessionHooks.context(first);
  now += 6000; // bypass the 5s fresh cache, stay inside the 10min last-good window
  global.fetch = jest.fn(async () => { throw new Error('gateway down'); }) as any;
  const second = { sessionID: 'ses_cached_true', system: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'y' }] }] };
  await regs.sessionHooks.context(second);
  nowSpy.mockRestore();
  const texts = second.system.map((p: any) => String(p.text));
  expect(texts.some((t) => t.includes('<memory-guide>'))).toBe(false);
  expect(texts.some((t) => t.includes('<user-profile>'))).toBe(false);
  expect(texts.some((t) => t.includes('<agent-priors>'))).toBe(false);
});

it('caches the endpoint for 5s per session', async () => {
  const { fetchMock, calls } = makeFetch([
    ['/api/recall/instructions', { managed: true, missing: [], staleKeys: [], blocks: {} }],
    ['/api/recall/context', { pointers: null }],
  ]);
  global.fetch = fetchMock as any;
  const { ctx, regs } = makeCtx(mkdtempDir());
  await (mafwPlugin as any).setup(ctx);
  for (const text of ['a', 'b']) {
    await regs.sessionHooks.context({ sessionID: 'ses_cache', system: [], messages: [{ role: 'user', content: [{ type: 'text', text }] }] });
  }
  expect(calls.filter((c) => c.url.includes('/api/recall/instructions'))).toHaveLength(1);
});
```

- [ ] **Step 2: Run the plugin tests to verify they fail**

Run: `npx jest tests/plugin-v2.test.ts --runInBand`
Expected: FAIL — old hook still calls `/api/recall/pinned`/`priors`.

- [ ] **Step 3: Implement the new hook**

Create `src/hooks/instruction-blocks.ts`:
- `GATEWAY_PORT` same pattern as other hooks.
- `CACHE_TTL_MS = 5000`, `LAST_GOOD_TTL_MS = 10 * 60 * 1000`.
- `records: Map<string, { at: number; managed: boolean; blocks: any }>`.
- If a record exists and `Date.now() - record.at < CACHE_TTL_MS`, use it without fetching.
- Otherwise `fetch` with `AbortController` 200ms.
- On success: store `{at: Date.now(), managed, blocks}`; if `!managed`, push `blocks.memoryGuide`, `blocks.userProfile`, `blocks.agentPriors` in order (skip null/empty) to `output.system`.
- On failure: if record within 10min:
  - `managed=true` → return;
  - `managed=false` → push cached blocks.
  Else → call `memoryGuideHook({}, output)` (bundled guide).
- Never throw.

- [ ] **Step 4: Wire the context hook**

In `src/plugin.ts`, remove `userProfileSystemHook` / `agentPriorsSystemHook` imports; add `instructionBlocksSystemHook`; replace the three lines with:

```ts
await instructionBlocksSystemHook({ sessionID }, sysOut);
```

Keep `memoryGuideHook` import because the new hook uses it for the no-cache fallback (or import `buildMemoryGuide` and push directly). Delete the two old hook files.

- [ ] **Step 5: Run the plugin tests to verify they pass**

Run: `npx jest tests/plugin-v2.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/instruction-blocks.ts src/hooks/memory-guide.ts src/plugin.ts tests/plugin-v2.test.ts
git rm src/hooks/user-profile.ts src/hooks/agent-priors.ts
git commit -m "feat(plugin): instruction blocks fallback"
```

---

### Task 7: pi fallback via the same endpoint

**Files:**
- Modify: `gateway/src/runtime/host-adapter.ts:143-210` (`CognitionClient` + `createCognitionClient`)
- Modify: `gateway/src/runtime/pi/pi-mafw-host-extension.ts:118-124`
- Modify: `gateway/tests/unit/runtime/host-adapter.test.ts`
- Modify: `gateway/tests/unit/runtime/pi-mafw-host-extension.test.ts`

**Interfaces:**
- Consumes: `GET /api/recall/instructions?sessionID=...`.
- Produces:
  ```ts
  fetchInstructionBlocks(): Promise<{
    memoryGuide: string;
    userProfile: string | null;
    agentPriors: string | null;
  } | null>;
  ```

- [ ] **Step 1: Write the failing host-adapter test**

Add to `gateway/tests/unit/runtime/host-adapter.test.ts`:

```ts
it('fetchInstructionBlocks GETs the session endpoint and returns blocks', async () => {
  const calls: string[] = [];
  const client = createCognitionClient({
    sessionId: 's1', baseUrl: 'http://gw',
    fetchImpl: async (url: any) => { calls.push(String(url)); return { ok: true, json: async () => ({ managed: false, blocks: { memoryGuide: 'G', userProfile: 'P', agentPriors: 'A' } }) } as any; },
  });
  const b = await client.fetchInstructionBlocks();
  expect(calls[0]).toContain('/api/recall/instructions?sessionID=s1');
  expect(b).toEqual({ memoryGuide: 'G', userProfile: 'P', agentPriors: 'A' });
});
it('fetchInstructionBlocks fail-open -> null', async () => { /* fetch throws */ });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd gateway && npx jest tests/unit/runtime/host-adapter.test.ts --runInBand`
Expected: FAIL — method missing.

- [ ] **Step 3: Implement the client method**

Add to `CognitionClient` and `createCognitionClient`:

```ts
async fetchInstructionBlocks() {
  const j = await getJson(`/api/recall/instructions?sessionID=${encodeURIComponent(sessionId)}`, COGNITION_CONTRACT.pinnedTimeoutMs);
  return j?.blocks?.memoryGuide ? j.blocks : null;
}
```

- [ ] **Step 4: Write the failing pi extension test**

In `pi-mafw-host-extension.test.ts`, change the `before_agent_start` case to stub `fetchInstructionBlocks` returning three blocks and assert all three appear. Add a failure case where `fetchInstructionBlocks` returns null and assert `MEMORY_GUIDE` appears, profile/priors do not.

- [ ] **Step 5: Run the pi tests to verify they fail**

Run: `cd gateway && npx jest tests/unit/runtime/pi-mafw-host-extension.test.ts --runInBand`
Expected: FAIL — old code calls `fetchPinnedProfile`.

- [ ] **Step 6: Implement the pi extension**

Replace the `before_agent_start` body:

```ts
let extra = MEMORY_GUIDE;
const blocks = await client.fetchInstructionBlocks();
if (blocks) {
  const parts = [blocks.memoryGuide, blocks.userProfile, blocks.agentPriors]
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  if (parts.length > 0) extra = parts.join('\n\n');
}
return { systemPrompt: `${event?.systemPrompt ?? ''}\n\n${extra}` };
```

- [ ] **Step 7: Run host-adapter + pi tests to verify they pass**

Run: `cd gateway && npx jest tests/unit/runtime/host-adapter.test.ts tests/unit/runtime/pi-mafw-host-extension.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add gateway/src/runtime/host-adapter.ts gateway/src/runtime/pi/pi-mafw-host-extension.ts gateway/tests/unit/runtime/host-adapter.test.ts gateway/tests/unit/runtime/pi-mafw-host-extension.test.ts
git commit -m "feat(pi): instruction blocks fallback"
```

---

### Task 8: Live smoke script

**Files:**
- Create: `gateway/scripts/smoke-instruction-entries.mjs`

**Interfaces:**
- Consumes: gateway `POST /api/session`, `POST /api/session/:id/config`, `POST /api/session/:id/promptAsync`, `GET /api/sessions/:id/messages`, `GET /api/experimental/session/:id/instructions/entries`, `GET /api/recall/instructions`, `POST /api/sessions/:id/fork`, `DELETE /api/session/:id`; `better-sqlite3` for read-only `instruction_entry.time_updated` assertions.
- Produces: console lines `[instr-smoke] PASS/FAIL <name>` and exit code 1 on any failure.

- [ ] **Step 1: Write the script skeleton and first failing check**

Mirror `gateway/scripts/smoke-data-parts.mjs`: temp git repo under `os.tmpdir()`, create session, set mode `full-access` and model `gateway/volcengine/deepseek-v4.1-flash`, send a prompt, poll assistant (timeout 90s). First check: `GET /api/runtime` has `active.capabilities.instructionsApi === true`; if not, print SKIP and exit 0.

- [ ] **Step 2: Add entries/endpoint checks**

After the first prompt:
1. `GET /api/experimental/session/{sid}/instructions/entries` → data contains all three `mafw.*` keys with non-empty string values.
2. `GET /api/recall/instructions?sessionID=` → `managed:true`, `missing:[]`, `revision` non-empty.
3. Read `instruction_entry.time_updated` for the three keys from `~/.local/share/opencode/opencode.db` read-only.
4. Send a second prompt; wait for completion; re-read `time_updated`; assert unchanged.
5. Delete `mafw.user-profile` via the experimental API; `GET /api/recall/instructions` → `managed:false`, `missing:["mafw.user-profile"]`, blocks only profile.
6. Send a third prompt; assert endpoint `managed:true` again and the profile entry is restored.
7. Fork the session; `GET` entries on the fork contains the three keys.
8. Cleanup: delete the fork session, delete the temp session, delete the three entries if the session delete failed, remove the temp dir. Print `[instr-smoke] done failures=<n>`.

- [ ] **Step 3: Run the smoke against the live gateway**

Run: `node gateway/scripts/smoke-instruction-entries.mjs`
Expected: all PASS; exit 0. If the model call fails due to credits, the sync still runs before the prompt; the script should treat assistant completion as non-fatal for the entry checks (log `assistant error; entries still checked`).

- [ ] **Step 4: Manual checklist (document in the script header, not automated)**

- pinned change: add a pinned marker via `/api/memory/add`, prompt, confirm `<user-profile>` contains it; unpin afterward.
- compaction: `POST /api/session/:id/summarize`, confirm entries still present.
- pi fallback: switch runtime to pi, confirm `before_agent_start` injects the three blocks (conformance `cognition-inject`).
- `enabled=false`: set `recall.instructions.enabled: false`, prompt, confirm entries deleted and endpoint returns full blocks; restore true.

- [ ] **Step 5: Commit**

```bash
git add gateway/scripts/smoke-instruction-entries.mjs
git commit -m "test(instructions): live smoke for instruction entries"
```

---

### Task 9: Version, delivery record, full gates

**Files:**
- Modify: `package.json` + workspace versions via `node scripts/bump-version.mjs 4.40.0`
- Modify: `docs/superpowers/specs/2026-10-27-t2-instruction-entries-design.md` (status + delivery record)
- Modify: `AGENTS.md` (append T2-4 entry at the end of §5.5, before `### 5.6`)

**Interfaces:**
- Consumes: all previous tasks.
- Produces: v4.40.0, green gates, delivery record.

- [ ] **Step 1: Run the full test matrix and build**

Run:
```bash
cd gateway && npx jest --runInBand
cd .. && npx jest --runInBand
npm run build
npm run test:tui
npm test -w @mafw/sdk
npm test -w @mafw/session-ui
npm run test:desktop
npm run typecheck -w @mafw/desktop
npm run typecheck -w @mafw/session-ui
```
Expected: all green. Record the new test count and each suite's pass count.

- [ ] **Step 2: Run the smoke**

Run: `node gateway/scripts/smoke-instruction-entries.mjs`
Expected: all automated checks PASS; record which manual checks were done.

- [ ] **Step 3: Bump version**

Run: `node scripts/bump-version.mjs 4.40.0`
Run: `node scripts/bump-version.mjs --check`
Expected: `all versions in sync: 4.40.0`.

- [ ] **Step 4: Write delivery record**

In the spec header, change status to `已交付 v4.40.0`; append a `## 9. 交付记录` section with:
- commits (one line each)
- test counts (gateway / root plugin / SDK / session-ui / desktop / TUI)
- smoke result (automated n/n + manual list)
- known boundaries (direct TUI stale window, mixed-version duplicate risk, export/import excludes entries).

In `AGENTS.md`, append one bullet at the end of §5.5 (anchor `### 5.6`) with spec path, version, commits, test counts, smoke result, and the same known boundaries.

- [ ] **Step 5: Final cleanliness check**

Run:
```bash
git status --short
git diff --stat
```
Expected: only intended files; the parallel untracked workbench plan is still untracked and not staged. Do not push.

- [ ] **Step 6: Commit**

```bash
git add package.json packages/*/package.json gateway/package.json docs/superpowers/specs/2026-10-27-t2-instruction-entries-design.md docs/superpowers/plans/2026-10-27-t2-instruction-entries.md AGENTS.md
git commit -m "docs: delivery record for T2-4 instruction entries (v4.40.0)"
```

---

## Self-Review Notes

- Spec coverage: §4.2 renderer → Task 2; §4.3 sync → Task 3; §4.4 capability/adapter → Task 1; §4.5 wrapper/wiring → Task 4; §4.6 endpoint/plugin/pi → Tasks 5/6/7; §4.8 fallback modes → Tasks 3/5/6; §4.9 observability → Tasks 3/5; §5 tests/smoke → Tasks 3–9; §6 risks → delivery record.
- Type consistency: `InstructionBlocks`, `INSTRUCTION_KEYS`, `InstructionSyncService`, `withInstructionSync`, `fetchInstructionBlocks`, `buildRecallInstructionsResponse` are defined once and referenced consistently.
- Execution note: native/inline was the established method for this repo; each task is independently testable but tasks 3–5 share interfaces, so native execution is recommended over parallel subagents.
