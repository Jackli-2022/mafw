# `adapters/opencode` physical extraction (Plan 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the opencode driver out of `gateway/src/runtime/opencode-*` into `adapters/opencode` and register it through `defineRuntime`, without changing the gateway's neutral event/channel contract.

**Architecture:** The extraction has two phases. **6A** neutralizes the generic event-mapping helpers and creates/package-wires `adapters/opencode` while the driver still lives in gateway. **6B** moves the pure opencode modules, assembles the adapter runtime/definition, and replaces the gateway driver files with a fail-soft package shim plus one-release re-export shims. The adapter owns opencode protocol details (dialect, MCP JSONC, instructions, PTY, snapshot/checkpoint, background); gateway keeps the neutral bus/facade/validate/proxy.

**Tech Stack:** TypeScript, esbuild (CJS bundle), Jest (gateway), node:test (`runtime-core`/`runtime-contract`), `@opencode-ai/sdk` v2 (ESM, external), `jsonc-parser`, `cross-spawn`.

**Spec:** `docs/superpowers/specs/2026-11-09-neutral-runtime-driver-architecture-design.md` §3/§9 Phase 3; prior art `docs/superpowers/plans/2026-11-09-neutral-runtime-opencode.md` (Plan 3) and `docs/superpowers/plans/2026-11-10-adapters-pi.md` (Plan 5B).

## Sequencing

- Plan 5B merged; `main` at `f067072c` when this plan was written.
- **6A (Tasks 1–4)** must merge before **6B (Tasks 5–7)** starts.
- **Task 1 is a blocker:** opencode already emits canonical `background.job.updated`, `queue.updated`, `session.diff`, but `canonicalToAdapterEvent()` drops them. Verify this before the physical move; do not carry a known event-loss regression into the package.

## Global Constraints

- `gateway/src` must not import `adapters/opencode/src/**`; only `gateway/src/runtime/opencode-adapter.ts` may `require('@mafw/adapter-opencode')`.
- `adapters/opencode/src` may import only `@mafw/runtime-contract`, `@mafw/runtime-core`, `@opencode-ai/sdk`, `jsonc-parser`, `cross-spawn`, Node builtins, and local files. No `gateway/src` imports.
- Event ABI stays additive. Do not rename/remove existing `AdapterEvent` variants.
- `RuntimeDefinition` stays ABI v1 (`api: 1`, `eventApi: 1`); capabilities stay explicit via `overrides`.
- Keep the gateway reverse proxy's serve Basic auth working through the injection seam chosen in Task 3.
- Gates per task: targeted Jest/node:test, then `cd gateway && npx tsc --noEmit -p tsconfig.json`, root `npm run build`, `npm run test:contract`, `npm run test:core`, gateway full Jest `--forceExit`.

## Review Focus

1. **Dropped opencode events** — `background.job.updated`, `queue.updated`, `session.diff` (and v21 `session.created` property shape) must survive AdapterEvent ↔ canonical round-trip; otherwise background cards, queue inbox and changes dock regress after extraction.
2. **Adaptive dialect** — `adaptive` must probe once at activation/first event, fail safe to v1, and `definition.host.activeDialect` must update; never route v2 native events through v1 mappings.
3. **v2 payload fidelity** — MCP server/config, instructions entries, PTY metadata, checkpoint/diff and background jobs must keep field names after the package boundary (desktop Config, terminal, changes tree depend on them).
4. **Proxy auth / serve lifecycle** — reverse proxy must keep serving `Authorization`/password headers; owned serve must remain child-managed and killed on exit; external mode must not expose `agentProcess`.
5. **Credential/provider fallback** — pre-activation judge/scan paths and plugin contexts must still resolve keys after `auth.ts`/`provider-settings.ts` move; no recursion and no lost auth.json fallback.
6. **Packaging** — ESM-only `@opencode-ai/sdk/v2` must remain a dynamic `import()` in the CJS bundle; adapter must be staged next to the gateway's SDK for both deploy-local and packed-global installs.

---

## Task 1: AdapterEvent coverage for opencode-only canonical events

**Files:**
- Modify: `packages/runtime-contract/src/adapter-event.ts`
- Modify: `packages/runtime-contract/src/adapter-event.test.ts`
- Modify: `gateway/src/runtime/adapter-event-mapper.ts`
- Modify: `gateway/src/runtime/adapter-bridge.ts`
- Test: `gateway/tests/unit/runtime/adapter-event-mapper.test.ts`
- Test: `gateway/tests/unit/runtime/opencode-neutral-golden.test.ts`

**Interfaces:**
- Produces: `AdapterEvent` variants `background.job.updated` (`data.job`), `queue.updated` (`data.items`), `session.diff` (`data.messageID?`, `data.diff`).
- Consumes: existing `MAFW.backgroundJobUpdated` / `MAFW.queueUpdated` / `MAFW.sessionDiff` vocabulary.

- [ ] **Step 1: Write failing mapper tests**

Add cases to `adapter-event-mapper.test.ts` asserting an `AdapterEvent` of each new type maps to the canonical type and preserves `job` / `items` / `diff`.

```ts
expect(mapAdapterEvent({ id: 'e1', type: 'queue.updated', sessionID: 's1', at: 1, data: { items: [{ id: 'q1' }] } } as any).canonical?.payload)
  .toMatchObject({ type: 'queue.updated', properties: { items: [{ id: 'q1' }] } });
```

- [ ] **Step 2: Write failing bridge round-trip test**

In `opencode-neutral-golden.test.ts`, feed a v21 `session.inbox.enqueued`, a background synthetic event and `session.diff`; assert the resulting AdapterEvent list contains the three canonical types (no drops). If v21 `session.created` data is shaped differently from `properties.info`, assert the emitted `session.created` still carries `data.session` or `data.info` with `id`.

- [ ] **Step 3: Run tests to verify red**

Run: `cd gateway && npx jest --runInBand --forceExit tests/unit/runtime/adapter-event-mapper.test.ts tests/unit/runtime/opencode-neutral-golden.test.ts`
Expected: FAIL because the new types are not in `AdapterEvent` / mapper returns `dropped`.

- [ ] **Step 4: Add the variants and mappings**

Add the three names to `AdapterEventType` + the type union, and map both directions in `adapter-event-mapper.ts` / `adapter-bridge.ts`:

```ts
case 'background.job.updated': return { canonical: canonical('background.job.updated', { sessionID: event.sessionID, job: data.job }, event.sessionID) };
case 'queue.updated': return { canonical: canonical('queue.updated', { sessionID: event.sessionID, items: data.items ?? [] }, event.sessionID) };
case 'session.diff': return { canonical: canonical('session.diff', { sessionID: event.sessionID, messageID: data.messageID, diff: data.diff ?? [] }, event.sessionID) };
```

Reverse map the same three in `canonicalToAdapterEvent`; update the `MAFW_RUNTIME_EVENT_NAMES`/canonical set if the vocabulary source requires it.

- [ ] **Step 5: Run tests + contract tests**

Run: `cd gateway && npx jest --runInBand --forceExit tests/unit/runtime/adapter-event-mapper.test.ts tests/unit/runtime/opencode-neutral-golden.test.ts && npm run test:contract`
Expected: PASS; no count assertion for the 33-variant union that still expects 33.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime-contract/src/adapter-event.ts packages/runtime-contract/src/adapter-event.test.ts gateway/src/runtime/adapter-event-mapper.ts gateway/src/runtime/adapter-bridge.ts gateway/tests/unit/runtime/adapter-event-mapper.test.ts gateway/tests/unit/runtime/opencode-neutral-golden.test.ts
git commit -m "feat(runtime): cover opencode background, queue and diff events"
```

---

## Task 2: Neutralize event-mapping helpers in `runtime-core`

**Files:**
- Create: `packages/runtime-core/src/path-expr.ts`
- Create: `packages/runtime-core/src/event-mapping.ts`
- Create: `packages/runtime-core/src/canonical-error.ts`
- Create: `packages/runtime-core/src/stop-reason.ts`
- Create: `packages/runtime-core/src/git.ts`
- Create: `packages/runtime-core/src/background-job-events.ts`
- Modify: `packages/runtime-core/src/index.ts`
- Modify: `packages/runtime-core/package.json` (add `@mafw/runtime-contract`)
- Modify gateway re-export shims: `gateway/src/runtime/path-expr.ts`, `event-mapper.ts`, `canonical-error.ts`, `normalize.ts` (`RawRuntimeEvent`), `gateway/src/runtime/contract.ts` (`stopReasonOf`), `gateway/src/core/diff/turn-diff.ts` (`GitRunner`/`defaultGit`), `gateway/src/core/background/background-jobs.ts` (pure helpers)
- Test: `packages/runtime-core/src/event-mapping.test.ts`, `packages/runtime-core/src/background-job-events.test.ts`

**Interfaces:**
- Produces from `@mafw/runtime-core`: `applyEventMappings(raw, entry, isCanonicalType, hooks?)`, `validateEventMappings`, `hasEventDeclarations`, `canonicalIdentity`, `canonicalTypeSet`, `EventMapping`, `EventSourceShape`, `TransformEventFn`, `TranslationHooks`, `EventMappingEntry`, `RawRuntimeEvent`, `canonicalError`, `errorKindOf`, `errorTextOf`, `stopReasonOf`, `GitRunner`, `defaultGit`.
- Gateway continues to export the same names from its existing modules (re-export only).

- [ ] **Step 1: Write failing runtime-core tests**

Port the pure cases from `gateway/tests/unit/runtime/event-mapper.test.ts` (mapping order, default-deny, transformEvent, path template, hooks) and a background-job pure-helper test to `packages/runtime-core/src/*.test.ts`.

- [ ] **Step 2: Run red**

Run: `npm run test:core` (from repo root).
Expected: FAIL — modules not found.

- [ ] **Step 3: Move the pure code**

Copy bodies verbatim; keep `wrapGlobalEventStream` and gateway-only dependencies (`EVENT_FLOW_MATRIX`, `TOOL_PRIMITIVE_TYPES`, tool assembler) in `gateway/src/runtime/event-mapper.ts`. The gateway module re-exports the core symbols and keeps its wrapper.

- [ ] **Step 4: Run core + gateway mapping tests**

Run: `npm run test:core`, `cd gateway && npx jest --runInBand --forceExit tests/unit/runtime/event-mapper.test.ts tests/unit/runtime/event-replay.test.ts tests/unit/runtime/adapter-bridge.test.ts`
Expected: PASS with no import-boundary failures.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime-core gateway/src/runtime gateway/src/core/diff/turn-diff.ts gateway/src/core/background/background-jobs.ts
git commit -m "refactor(runtime): move event mapping helpers into runtime-core"
```

---

## Task 3: Neutral host/contract extensions for serve, proxy and MCP config

**Files:**
- Modify: `packages/runtime-contract/src/transport.ts` (`RuntimeFactoryContext.serve?: { host?: string; port?: number }`)
- Modify: `packages/runtime-contract/src/define-runtime.ts` (`RuntimeHostSurface.proxyHeaders?`, `resolveProviderTransport?`)
- Modify: `packages/runtime-contract/src/channels.ts` (typed MCP config/preview DTOs; PTY metadata)
- Create: `packages/runtime-core/src/runtime-root.ts`
- Create: `packages/runtime-core/src/completion-http.ts`
- Modify gateway shims: `gateway/src/runtime/runtime-root.ts`, `completion-http.ts`, `pty.ts`
- Test: `packages/runtime-contract/src/channels.test.ts`, `packages/runtime-core/src/core.test.ts`, `gateway/tests/unit/runtime/completion-http.test.ts`

**Interfaces:**
- `RuntimeFactoryContext.serve` is optional; absent means adapter default `127.0.0.1:4096`.
- `RuntimeHostSurface.proxyHeaders?(): Record<string,string>` is the only supported way for gateway to obtain serve Basic auth after extraction.
- `RuntimeHostSurface.resolveProviderTransport?(providerID)` returns `{ baseUrl?: string|null; apiKey?: string|null }` for judge/scan paths.
- `httpComplete` takes an explicit `credentials` resolver (no `auth.ts` import).

- [ ] **Step 1: Write failing tests**

Assert `RuntimeFactoryContext` accepts `serve`; `RuntimeHostSurface` accepts `proxyHeaders`; `httpComplete` uses the injected credentials resolver and preserves the existing HTTP fallback.

- [ ] **Step 2: Run red**

Run: `npm run test:contract`, `npm run test:core`, targeted gateway completion test.
Expected: FAIL (types/missing module).

- [ ] **Step 3: Implement the contract/core additions and gateway re-exports**

Keep gateway `runtime-root.ts` / `completion-http.ts` as re-export shims. Move `completion-http`'s auth lookup into a caller-provided resolver; update `recall/index-scan.ts` to pass `() => getProviderApiKey(...)`.

- [ ] **Step 4: Run green**

Run: `npm run test:contract`, `npm run test:core`, `cd gateway && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime-contract packages/runtime-core gateway/src/runtime gateway/src/recall/index-scan.ts
git commit -m "feat(runtime): add serve/proxy host seams and neutral completion helpers"
```

---

## Task 4: `adapters/opencode` package skeleton + build/stage wiring

**Files:**
- Create: `adapters/opencode/package.json`
- Create: `adapters/opencode/build.mjs`
- Create: `adapters/opencode/tsconfig.json`
- Create: `adapters/opencode/src/index.ts` (placeholder exports)
- Modify: `package.json` (root build order, `files`, postinstall stage)
- Modify: `gateway/package.json` (`mafw.bundledPackages`)
- Modify: `scripts/stage-plugin-contract.mjs` (`CONTRACT_PACKAGES`)
- Test: `gateway/tests/integration/plugin-package-e2e.test.ts`
- Test: `gateway/tests/unit/runtime/opencode-package.test.ts`

**Interfaces:**
- Package `@mafw/adapter-opencode`, CJS `dist/index.js`, `dist/index.d.ts`.
- External: `@opencode-ai/sdk`, `@mafw/runtime-contract`, `@mafw/runtime-core`. Bundle: `jsonc-parser`, `cross-spawn`.
- Dynamic `import('@opencode-ai/sdk/v2')` must survive as `import(...)`, not `require(...)`.

- [ ] **Step 1: Write failing packaging test**

Assert `adapters/opencode/dist/index.js` exists after build, exports the placeholder symbols, and the bundle text contains `import(` for the SDK specifier (or a documented dynamic import helper). Extend `plugin-package-e2e` with root `files`, postinstall staging, `bundledPackages`, and peer/optional SDK metadata.

- [ ] **Step 2: Create the package + build script**

Mirror `adapters/pi/build.mjs`; write `dist/package.json` `{"type":"commonjs"}`. Keep the package `private`, peer-optional SDK.

- [ ] **Step 3: Wire root/gateway/stage**

Add `npm run build -w @mafw/adapter-opencode` after adapter-pi; add root `files` and postinstall staging into `gateway/node_modules`; add `bundledPackages` and `CONTRACT_PACKAGES`.

- [ ] **Step 4: Build and verify**

Run: `npm run build -w @mafw/adapter-opencode`, `node scripts/stage-plugin-contract.mjs --node-modules gateway/node_modules`, `cd gateway && npx jest --runInBand --forceExit tests/unit/runtime/opencode-package.test.ts tests/integration/plugin-package-e2e.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add adapters/opencode package.json gateway/package.json scripts/stage-plugin-contract.mjs gateway/tests/unit/runtime/opencode-package.test.ts gateway/tests/integration/plugin-package-e2e.test.ts
git commit -m "build: add the adapter-opencode package skeleton"
```

---

## Task 5: Move pure opencode modules + tests

**Files (move via `git mv`):**
- `gateway/src/runtime/opencode-canonical.ts` → `adapters/opencode/src/canonical.ts`
- `gateway/src/runtime/opencode-events.ts` → `adapters/opencode/src/events.ts`
- `gateway/src/runtime/opencode-21-events.ts` → `adapters/opencode/src/events-21.ts`
- `gateway/src/runtime/opencode-history.ts` → `adapters/opencode/src/history.ts`
- `gateway/src/runtime/opencode-snapshot.ts` → `adapters/opencode/src/snapshot.ts`
- `gateway/src/runtime/opencode-mcp.ts` → `adapters/opencode/src/mcp.ts`
- `gateway/src/runtime/opencode-mcp-config.ts` → `adapters/opencode/src/mcp-config.ts`
- `gateway/src/runtime/mcp-jsonc.ts` → `adapters/opencode/src/mcp-jsonc.ts`
- `gateway/src/runtime/opencode-dialect-probe.ts` → `adapters/opencode/src/dialect-probe.ts`
- `gateway/src/runtime/form-question.ts` → `adapters/opencode/src/form-question.ts`
- `gateway/src/runtime/provider-settings.ts` → `adapters/opencode/src/provider-settings.ts`
- `gateway/src/runtime/auth.ts` → `adapters/opencode/src/auth.ts`
- `gateway/src/runtime/serve-sidecar.ts` → `adapters/opencode/src/serve-sidecar.ts`

**Do not move yet:** `opencode-adapter.ts`, `opencode-runtime.ts`, `opencode-definition.ts` (Task 6).

- [ ] **Step 1: Move files and rewrite imports**

Use adapter-local paths for moved modules; replace gateway `./contract` types with `@mafw/runtime-contract` or a local `types.ts`; use `@mafw/runtime-core` for mapping/canonical helpers; inject logger via `ctx.log` where needed.

- [ ] **Step 2: Update tests**

Update all gateway tests listed in the extraction map (`opencode-adapter`/events/21-events/canonical/history/snapshot/mcp/mcp-config/form-question/serve-sidecar/provider-settings/terminal/runtime-agents-install/checkpoint/diff/background`) to import adapter source. Update mocks for `serve-sidecar`/`auth` to adapter paths.

- [ ] **Step 3: Add gateway one-release re-export shims**

Keep `gateway/src/runtime/auth.ts`, `provider-settings.ts`, `serve-sidecar.ts`, `mcp-jsonc.ts` as thin re-exports from the adapter for existing gateway consumers until Task 7 finishes.

- [ ] **Step 4: Run targeted tests + adapter tsc**

Run: adapter `tsc`, `npx jest --runInBand --forceExit` on the migrated opencode suites, `cd gateway && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A adapters/opencode gateway/src/runtime gateway/tests
git commit -m "refactor(opencode): move pure driver modules into the adapter package"
```

---

## Task 6: Runtime/definition assembly + gateway shim

**Files:**
- Create: `adapters/opencode/src/types.ts` (legacy `OpencodeRuntime`, session option DTOs, completion types)
- Create: `adapters/opencode/src/legacy-definition.ts` (adapter-local bridge copy; see decision below)
- Move: `gateway/src/runtime/opencode-adapter.ts` → `adapters/opencode/src/adapter.ts`
- Move: `gateway/src/runtime/opencode-runtime.ts` → `adapters/opencode/src/runtime.ts`
- Create: `adapters/opencode/src/definition.ts`
- Modify: `adapters/opencode/src/index.ts`
- Create: `gateway/src/runtime/opencode-adapter.ts` (package shim; replaces old implementation)
- Delete: `gateway/src/runtime/opencode-definition.ts`
- Modify: `gateway/src/index.ts` registration/proxy/credential wiring
- Test: `gateway/tests/unit/runtime/opencode-definition.test.ts`, `opencode-runtime.test.ts`, `opencode-wiring.test.ts`, `opencode-neutral-golden.test.ts`

**Interfaces:**
```ts
export type OpencodeVariant = 'adaptive' | 'v1' | 'v2' | 'v21';
export interface OpencodeDefinitionOptions {
  variant: OpencodeVariant;
  baseUrl: string;
  headers?: Record<string, string>;
  registrationName?: string;
  hooks?: TranslationHooks;
}
export interface OpencodeDefinitionDeps {
  runtime?: OpencodeRuntime;
  probe?: (baseUrl: string) => Promise<'v1' | 'v2' | 'v21'>;
  external?: boolean;
}
export async function createOpencodeDefinition(
  ctx: RuntimeFactoryContext,
  opts: OpencodeDefinitionOptions,
  deps?: OpencodeDefinitionDeps,
): Promise<RuntimeDefinition>;
export function opencodeStaticEntry(variant: OpencodeVariant): EventMappingEntry;
export function opencodeCapabilities(variant: OpencodeVariant, external: boolean): RuntimeCapabilities;
```

**Decision:** keep the generic `toRuntimeDefinition` bridge in gateway and copy only the needed generic logic into `adapters/opencode/src/legacy-definition.ts` for Plan 6. Moving the bridge to `runtime-core` is a separate cleanup; it would drag the legacy `AgentRuntime` shape into the adapter package.

- [ ] **Step 1: Write failing definition/wiring tests**

Assert `createOpencodeDefinition(ctx, ...)` returns `api:1`/`eventApi:1`, `external` follows `MAFW_SERVER_SERVE_URL`, adaptive entry resolves to v21 when the probe says v21 and falls back v1 on probe failure, and `agentProcess` is absent in external mode.

- [ ] **Step 2: Move runtime/adapter and replace gateway imports**

`runtime.ts` must use `ctx.serve` for host/port, `ctx.rootDir` for the serve root, `ctx.log` for logging, `ctx.credentials` for auth fallback, and `ctx.policy` where applicable. `definition.ts` returns `host.proxyHeaders` from adapter-local `serveAuthHeaders`.

- [ ] **Step 3: Gateway shim + index wiring**

`gateway/src/runtime/opencode-adapter.ts` becomes the only `require('@mafw/adapter-opencode')` site (fail-soft like `pi-adapter.ts`). `index.ts` passes `ctx` and the selected variant/registration name; proxy uses `runtimeHost.proxyHeaders?.()`; pre-activation judge/scan uses `runtimeHost.resolveProviderTransport` or the shim fallback. Delete the old `opencode-definition.ts`.

- [ ] **Step 4: Run targeted + full gateway tests**

Run: `cd gateway && npx jest --runInBand --forceExit tests/unit/runtime/opencode-*.test.ts tests/unit/opencode-adapter.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; no gateway source imports adapter internals.

- [ ] **Step 5: Commit**

```bash
git add -A adapters/opencode gateway/src gateway/tests
git commit -m "refactor(opencode): load the driver from the adapter package"
```

---

## Task 7: Guards, packaging, docs, final gates

**Files:**
- Modify: `gateway/tests/unit/runtime/neutral-runtime-boundaries.test.ts`
- Modify: `gateway/tests/unit/runtime/dependency-boundary.test.ts`
- Modify: `gateway/tests/unit/runtime/core-runtime-neutrality.test.ts`
- Modify: `gateway/tests/unit/runtime/wire-deletion-guards.test.ts`
- Modify: `docs/architecture/gateway.md`, `docs/architecture/plugin.md`, `docs/architecture/runtime.md`, `docs/guides/runtime-plugin-authoring.md`
- Modify: `gateway/tests/integration/plugin-package-e2e.test.ts`

- [ ] **Step 1: Add guards**

Assert gateway `src/runtime` has no moved `opencode-*` driver files, only `runtime/opencode-adapter.ts` mentions `@mafw/adapter-opencode`/`adapters/opencode`, and the adapter source allowlist holds. Keep the full “no protocol names in gateway/src” guard for a later Phase 4 plan.

- [ ] **Step 2: Docs**

Update the architecture tree/table: opencode is implemented in `adapters/opencode` and loaded via the gateway shim; note `serveAuthHeaders`/`proxyHeaders` seam and the `runtime-core` helper moves.

- [ ] **Step 3: Final gates**

```bash
npm run build
npm run test:contract
npm run test:core
npm run test:kit
cd gateway && npx tsc --noEmit -p tsconfig.json && npx jest --runInBand --forceExit
cd packages/desktop && npx tsgo -b
```

Expected: all green (known Windows worktree/checkpoint flakes must be re-run isolated and reported).

- [ ] **Step 4: Fresh review + merge**

Dispatch a fresh-context reviewer on the full branch; fix Critical/Important; merge to `main` only when the main worktree has no conflicting uncommitted tracked changes.

---

## Self-Review

- Spec §9 Phase 3 coverage: physical move (Task 5/6), adapter-owned dialect/MCP/PTY/checkpoint/background (Tasks 5/6), gateway only generic supervision/proxy (Task 3/6), package/build (Task 4), guards (Task 7).
- Known event-loss gap is fixed before extraction (Task 1).
- `toRuntimeDefinition` remains gateway-side; adapter uses a local copy so the package boundary does not drag `AgentRuntime` into the adapter (documented decision).
- Full Phase 4 protocol-name guards and frontend neutralization are intentionally out of scope.

## Known Boundaries

- Full generic `toRuntimeDefinition`/`AdapterBridge` migration to `runtime-core` is deferred to a follow-up cleanup.
- Full `gateway/src` “no opencode literal” guard is deferred to Phase 4.
- Desktop real-serve smoke (opencode binary, MCP CLI, PTY, checkpoint) remains manual/CI-optional.
- `opencode-history.ts` is reference/golden-only; moving it is mechanical, not a new production channel.
- Credential/provider boundary may need a Plan 6.5 if `resolveProviderTransport` cannot cover all pre-activation judge/scan paths without behavior changes.
