# Batch 1 — Portable outputSchema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, inline) for this batch. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a runtime-neutral outputSchema path: `mafw_submit_result` tool + JSON Schema validation + prompt injection + sync retry + goal-node structured results.

**Architecture:** A gateway `StructuredOutputService` holds per-session schema/submission state. `SdkSessionResource` registers the schema and appends an instruction; the model submits through a plugin/pi tool to `/api/structured/submit`. Goal `NodeDriver.completeNode` prefers the validated submission and falls back to existing artifact files.

**Tech Stack:** TypeScript, Jest (gateway), node:test (desktop/plugin? plugin has no test runner), zod (plugin), JSON Schema subset.

**Spec:** `docs/superpowers/specs/2026-10-24-batch1-output-schema-design.md`

## Global Constraints

- No new npm dependency; use the hand-written validator subset in the spec.
- No changes to opencode v2 prompt format (it has no `format`).
- Existing file artifacts remain the fallback; do not delete them.
- Plugin tool must be fail-open when the gateway is unreachable; return a readable failure text, not throw.
- `outputSchema` is additive; prompts without it behave exactly as before.
- Keep `mafw_submit_result` out of the goal artifact schema itself (it is a transport tool).
- Commit to master; do not touch parallel B3.1 docs.

## Review Focus

- Model submits before a schema is registered (history replay) — must return a clear 400 and not store.
- Validator accepts a schema with `$ref` silently — must fail loudly.
- Sync prompt retry loop re-sends the original prompt without the validation error — must include the errors and stop at `retryCount`.
- Goal node has a structured submission but no file — must succeed; both missing must still fail `artifact_missing`.
- Review structured verdict must drive routing; a prose-only review file fallback must still work.
- Plugin/pi tool must send `sessionID` from their own context, never a model-supplied ID.

---

### Task 1: JSON Schema validator

**Files:**
- Create: `gateway/src/runtime/json-schema.ts`
- Test: `gateway/tests/unit/runtime/json-schema.test.ts`

**Interfaces:**
- Produces: `interface ValidationError { path: string; message: string }`; `validateJsonSchema(schema: any, value: any): ValidationError[]`.

- [ ] **Step 1: Write failing tests** covering object/required/additionalProperties, array/items/minItems, enum, anyOf, pattern, integer, `$ref` rejection.

```ts
import { validateJsonSchema } from '../../../src/runtime/json-schema';

test('required + path', () => {
  const errs = validateJsonSchema({
    type: 'object', required: ['id'], properties: { id: { type: 'string' } },
  }, {});
  expect(errs).toEqual([{ path: '$.id', message: 'is required' }]);
});
test('$ref fails loudly', () => {
  expect(validateJsonSchema({ $ref: '#/x' }, {})[0].message).toContain('unsupported');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd gateway; npx jest tests/unit/runtime/json-schema.test.ts --silent`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the subset** exactly as spec §4. Use `path` strings: `$`, `$.key`, `$[0]`. Truncate nothing here (service truncates error text).

- [ ] **Step 4: Run tests**

Run: `cd gateway; npx jest tests/unit/runtime/json-schema.test.ts --silent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/json-schema.ts gateway/tests/unit/runtime/json-schema.test.ts
git commit -m "feat(runtime): add JSON Schema validation subset for structured output"
```

---

### Task 2: StructuredOutputService + HTTP routes

**Files:**
- Create: `gateway/src/runtime/structured-output.ts`
- Create: `gateway/src/routes/structured.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/routes/wave1-handlers.ts`
- Test: `gateway/tests/unit/runtime/structured-output.test.ts`
- Test: `gateway/tests/unit/routes/structured.test.ts`

**Interfaces:**
- `OutputSchemaSpec { name?: string; schema: Record<string, any>; retryCount?: number }`
- `StructuredOutputService.register(sessionID, spec)`, `.submit(sessionID, data): {ok:boolean; errors:string[]}`, `.get(sessionID)`, `.submitted(sessionID)`, `.clear(sessionID)`.
- `structuredInstruction(spec): string`.
- Singleton `structuredOutput`.
- Routes: `POST /api/structured/submit`, `GET /api/sessions/:id/structured`.

- [ ] **Step 1: Write failing service tests**

```ts
const svc = new StructuredOutputService();
svc.register('s1', { name: 'x', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } });
expect(svc.submit('s1', { ok: true })).toEqual({ ok: true, errors: [] });
expect(svc.submitted('s1')).toEqual({ ok: true });
expect(svc.submit('missing', {})).toEqual({ ok: false, errors: ['no active output schema'] });
expect(svc.submit('s1', { ok: 'yes' }).errors[0]).toContain('$.ok');
```

- [ ] **Step 2: Implement service + instruction**

`structuredInstruction` returns the exact block from spec §3.4, schema `JSON.stringify(spec.schema)`, truncating nothing (the prompt is the source). Errors are capped at 20 / 300 chars.

- [ ] **Step 3: Add route catalog + handlers**

Catalog:
```ts
{ method: 'POST', path: '/api/structured/submit', operationId: 'structured.submit', tags: ['session'] },
{ method: 'GET', path: '/api/sessions/:id/structured', operationId: 'session.structured', tags: ['session'] },
```
Wave1 attach:
```ts
registry.attachHandler('structured.submit', H(async (req, res) => handleStructuredSubmit(req, res, { service: structuredOutput })));
registry.attachHandler('session.structured', H(async (_req, res, params) => handleStructuredGet(res, params.id, { service: structuredOutput })));
```

- [ ] **Step 4: Route tests** for 200/400/404, missing data, invalid data; run `npx jest tests/unit/routes/structured.test.ts --silent`.

- [ ] **Step 5: Regenerate contract** `npm run emit:openapi` (gateway) + `npm run gen:api` (SDK) after the catalog changes; run `npx jest tests/unit/api-contract.test.ts --silent`.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/runtime/structured-output.ts gateway/src/routes/structured.ts gateway/src/routes/route-catalog.ts gateway/src/routes/wave1-handlers.ts gateway/tests/unit/runtime/structured-output.test.ts gateway/tests/unit/routes/structured.test.ts packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts
git commit -m "feat(runtime): structured output service and submit/get routes"
```

---

### Task 3: `mafw_submit_result` tools (plugin + pi)

**Files:**
- Create: `src/tools/submit-result.ts`
- Modify: `src/plugin.ts` (import, V1_TOOLS, pass `isError`)
- Modify: `gateway/src/runtime/mafw-tools.ts` (pi tool)
- Test: `gateway/tests/unit/runtime/mafw-tools.test.ts` (or existing tool test file) for the pi tool HTTP call.

**Interfaces:**
- Plugin tool `mafw_submit_result` args `{data: object}`; posts `{sessionID: ctx.sessionID, data}` to `/api/structured/submit`.
- Pi tool same HTTP path via `makeExecute({sessionId})`.
- Failure returns `isError: true` and validation errors; success returns a short confirmation.

- [ ] **Step 1: Implement plugin tool** with `zod` and the existing `MAFW_SERVER_API_PORT` pattern. `adaptToolExecute` passes `isError` through.

- [ ] **Step 2: Register plugin tool** in `V1_TOOLS`.

- [ ] **Step 3: Add pi tool** to `mafw-tools.ts` `TOOL_DEFS`; execute POST `/api/structured/submit`; return `ok`/`fail`.

- [ ] **Step 4: Test** the pi tool handler with a mocked `fetch`; assert `sessionId` is sent, not model-supplied. Plugin tool is covered by typecheck/build (no test runner); keep it thin.

- [ ] **Step 5: Commit**

```bash
git add src/tools/submit-result.ts src/plugin.ts gateway/src/runtime/mafw-tools.ts gateway/tests/unit/runtime/mafw-tools.test.ts
git commit -m "feat(tools): add mafw_submit_result for portable structured output"
```

---

### Task 4: Prompt wiring + sync retry

**Files:**
- Modify: `gateway/src/runtime/contract.ts` (`OutputSchemaSpec`, `SessionPromptOpts.outputSchema`, `PromptResultEnvelope.structured/structuredError`)
- Modify: `gateway/src/resources/sdk-session.ts` (`promptAsync` 6th param, `prompt` 4th param, register + instruction + sync validate/retry)
- Modify: `gateway/src/index.ts` (`promptAsync` route body, `prompt` route body, goal client pass-through)
- Modify: `packages/gateway-sdk/src/types.ts` (prompt options; additive)
- Test: `gateway/tests/unit/resources/sdk-session-structured.test.ts`

**Interfaces:**
- `SessionPromptOpts.outputSchema?: OutputSchemaSpec`.
- `SdkSessionResource.promptAsync(sessionID, message, parts?, agent?, model?, outputSchema?)`.
- `SdkSessionResource.prompt(sessionID, parts, system?, outputSchema?)` returns `{parts, structured?, structuredError?}`.

- [ ] **Step 1: Write failing sdk-session test**

Fake client:
```ts
const calls: any[] = [];
const client = { session: { prompt: async (o: any) => { calls.push(o); return { parts: [{ type:'text', text: JSON.stringify({ok:true}) }] }; } } };
const svc = new StructuredOutputService();
const sdk = new SdkSessionResource(client);
const out = await sdk.prompt('s1', [{type:'text',text:'do it'}], undefined, { name:'x', schema:{type:'object',required:['ok'],properties:{ok:{type:'boolean'}}} });
expect(calls[0].parts.at(-1).text).toContain('[MAFW STRUCTURED OUTPUT]');
expect(out.structured).toEqual({ok:true});
```
Also test invalid text + `retryCount:1` re-prompts once with the validation error, and exhaustion returns `structuredError`.

- [ ] **Step 2: Implement** `register` + instruction append; after result, `submitted` → return; else parse fenced JSON, `submit`; if invalid and retries remain, call prompt again with a correction text; cap retries at 3.

- [ ] **Step 3: Wire routes** `promptAsync`/`prompt` bodies to pass `outputSchema`; goal client passes it (Task 5).

- [ ] **Step 4: Run tests + gateway tsc**; then commit.

```bash
git add gateway/src/runtime/contract.ts gateway/src/resources/sdk-session.ts gateway/src/index.ts gateway/tests/unit/resources/sdk-session-structured.test.ts packages/gateway-sdk/src/types.ts
git commit -m "feat(runtime): outputSchema registration and sync validation/retry"
```

---

### Task 5: Goal node schemas + NodeDriver structured preference

**Files:**
- Modify: `gateway/src/core/goal/node-prompts.ts` (`nodeOutputSchema`)
- Modify: `gateway/src/core/goal/driver.ts` (`GoalRuntimeClient.outputSchema?`, `structured?`; completeNode preference)
- Modify: `gateway/src/index.ts` (goal client supplies `structured` and passes outputSchema)
- Test: `gateway/tests/unit/core/goal/node-output-schema.test.ts`
- Test: existing `driver` completion tests — add structured-preferred case.

**Interfaces:**
- `nodeOutputSchema(node: 'plan'|'execute'|'review'): OutputSchemaSpec`.
- `GoalRuntimeClient.promptAsync(opts & { outputSchema?: OutputSchemaSpec })`.
- `GoalRuntimeClient.structured?(sessionID): Promise<unknown | null>`.

- [ ] **Step 1: Define schemas** in `node-prompts.ts` for plan (ready | need_clarification via `anyOf`), execute receipt, review verdict.
- [ ] **Step 2: Driver**:
  - `startNode` passes `outputSchema: nodeOutputSchema(node)`.
  - `completeNode`: `const submitted = await this.deps.client.structured?.(sessionID) ?? null;` if `!submitted && !exists(file)` → fail `artifact_missing`; parse `submitted ?? JSON.parse(file)`; review verdict from `submitted` when present.
- [ ] **Step 3: index.ts** goal client: `structured: async (sid) => structuredOutput.submitted(sid) ?? null`, and pass `opts.outputSchema` to `sdkSession.promptAsync`.
- [ ] **Step 4: Tests** schema validation; driver structured-only plan/review; both missing still artifact_missing.
- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/node-prompts.ts gateway/src/core/goal/driver.ts gateway/src/index.ts gateway/tests/unit/core/goal/node-output-schema.test.ts gateway/tests/unit/core/goal/*driver*
git commit -m "feat(goal): schema-gated node results with file fallback"
```

---

### Task 6: Verification + deploy

- [ ] Run gateway full `npx jest --runInBand --silent` (known flakes isolated).
- [ ] Run SDK `npm test`, desktop `npm test`, session-ui `npm test`, TUI `npm test` (contract types additive; should stay green).
- [ ] Build gateway/SDK/desktop/root; pack/install/restart gateway.
- [ ] Live smoke:
  - create scratch session; prompt with an outputSchema via `/api/session/:id/prompt` (sync) or plugin tool; verify `structured`.
  - `GET /api/sessions/:id/structured`.
  - goal driver test with a fake structured submission (unit-level; no real goal LLM burn unless needed).
- [ ] Update spec/plan status + commit.

## Self-Review

- [x] Spec coverage: validator, service, routes, plugin/pi tools, prompt injection, sync retry, goal preference, fallback.
- [x] Failure modes: no schema, invalid data, no submission, `$ref`, retry exhaustion, file fallback.
- [x] No new dependencies; no opencode changes; existing artifacts preserved.
