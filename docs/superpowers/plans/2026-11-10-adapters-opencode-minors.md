# Plan 6 closeout — fix deferred minors (adapters/opencode)

## Context

Plan 6 moved the opencode driver into `adapters/opencode` and merged to `main`
(`82b5df09`). The final review parked seven minors. This closeout fixes all of
them without reopening the extraction architecture.

Base: `82b5df09` on branch `fix/adapters-opencode-minors`.

## Global constraints

- Adapter source (`adapters/opencode/src`) imports only `@mafw/runtime-contract`,
  `@mafw/runtime-core`, `@opencode-ai/sdk`, `jsonc-parser`, `cross-spawn`, Node
  builtins and local files. No gateway imports.
- Gateway may import the adapter package only through
  `gateway/src/runtime/opencode-adapter.ts`.
- Behaviour parity with the pre-Plan-6 gateway: no user-visible change except
  the documented queue snapshot semantics below.
- TDD where behaviour changes: write/adjust the failing test first, run red,
  implement, run green.
- Do not commit `node_modules` / `dist`. Do not touch generated SDK artifacts
  (`packages/gateway-sdk/contract/openapi.json`, `src/api-schema.gen.ts`).
- Gates: `npm run test:contract`, `npm run test:core`, gateway targeted Jest,
  `cd gateway && npx tsc --noEmit -p tsconfig.json`, root `npm run build`.
- Test commands from repo root unless stated.

## Task 1: event data-plane semantics (queue + background cross-pin)

**Files:**
- Modify: `gateway/src/runtime/adapter-event-mapper.ts`
- Modify: `gateway/src/runtime/adapter-bridge.ts`
- Modify: `adapters/opencode/src/legacy-definition.ts`
- Modify: `gateway/tests/unit/runtime/adapter-event-mapper.test.ts`
- Modify: `gateway/tests/unit/runtime/opencode-events.test.ts`

**Requirements:**
1. `queue.updated` is a **full snapshot** only when `items` is an array.
   - Forward (`mapAdapterEvent`): include `items` only when
     `Array.isArray(data.items)`; omit it when absent or malformed (a 2.1 inbox
     event carries `action`/`item`/`id` but no snapshot, and synthesising
     `items: []` makes the desktop clear the queue).
   - Reverse (`canonicalToAdapterEvent` in both bridge copies): same rule —
     include `items` only when `Array.isArray(props.items)`.
   - Update the existing `adapter-event-mapper` test that asserts absent items
     becomes `[]`; replace with assertions:
     - absent `items` → `properties` has no `items` key;
     - `items: 'not-an-array'` → no `items` key;
     - real array → preserved;
     - round-trip through `canonicalToAdapterEvent` preserves `action`/`item`/`id`
       and omits `items` when absent.
2. Add a v21 inbox regression in `opencode-events.test.ts`: a
   `session.inbox.enqueued` raw event maps through `translateOpencode21Event` to
   canonical `queue.updated` with `action: 'enqueued'`, the item, and **no**
   `items` key.
3. Background event cross-pin: add a test that:
   - `backgroundJobEvent(job)` from `@mafw/runtime-core` emits
     `payload.type === MAFW.backgroundJobUpdated` (from
     `@mafw/runtime-contract`);
   - feeding that type/data through `mapAdapterEvent` yields canonical
     `background.job.updated` with the same `job` object;
   - the v21 `session.next.synthetic` transform (shell metadata) yields the same
     canonical type and job `source/kind/status/sessionID`. Use
     `backgroundJobFromSynthetic` with a shell metadata fixture.

**Steps:**
- [ ] Step 1: update/add tests; run `cd gateway && npx jest --runInBand --forceExit tests/unit/runtime/adapter-event-mapper.test.ts tests/unit/runtime/opencode-events.test.ts`; expect red on the new assertions.
- [ ] Step 2: implement the three source changes.
- [ ] Step 3: rerun the targeted suites green.
- [ ] Step 4: `cd gateway && npx tsc --noEmit -p tsconfig.json`.
- [ ] Step 5: commit `fix(runtime): keep queue snapshots explicit and pin background events`.

## Task 2: remove MCP DTO duplication and PTY casts

**Files:**
- Modify: `gateway/src/runtime/contract.ts`
- Modify: `gateway/src/runtime/adapter-bridge.ts`
- Modify: `adapters/opencode/src/legacy-definition.ts`

**Requirements:**
- In `gateway/src/runtime/contract.ts`, delete the local MCP DTO interfaces
  (`RuntimeMcpStatus`, `RuntimeMcpServer`, `RuntimeMcpServerConfigInput`,
  `RuntimeMcpConfigPreview`, `RuntimeMcpConfigResult`, `RuntimeMcpConfigChannel`)
  and derive them from `@mafw/runtime-contract`:
  - `RuntimeMcpStatus = RuntimeMcpStatusInfo['status']`
  - `RuntimeMcpServer = RuntimeMcpStatusInfo`
  - re-export `RuntimeMcpServerConfigInput`, `RuntimeMcpConfigPreview`,
    `RuntimeMcpConfigResult`, `RuntimeMcpConfigChannel`
  - gateway `RuntimeMcpChannel` = contract channel with `connect`/`disconnect`
    required (`NonNullable<...>`); it must stay assignable wherever the legacy
    `RuntimeClient` is consumed.
- Remove the now-unnecessary casts:
  - gateway `adapter-bridge.ts`: `channelsV2.mcp = legacy.mcp;` and
    `channelsV2.pty = legacy.pty;`
  - adapter `legacy-definition.ts`: `channelsV2.mcp = legacy.mcp;` and
    `channelsV2.pty = legacy.pty;`
  - Keep casts for discovery/instructions where the legacy types genuinely
    differ.
- No runtime behaviour change; verify with `tsc` and the existing MCP/PTY suites.
- Add a one-line rationale comment above the `queue.updated` reverse mapping in both
  `gateway/src/runtime/adapter-bridge.ts` and
  `adapters/opencode/src/legacy-definition.ts`: 2.1 inbox events carry
  `action`/`item`/`id` but no snapshot, so `items` must stay absent to avoid
  clearing the client queue.
- (Folded from Task 1 review) Keep the two `canonicalToAdapterEvent` copies
  behaviourally identical; no new duplicated logic beyond the existing copy.

**Steps:**
- [ ] Step 1: rewrite the gateway contract block with aliases/re-exports.
- [ ] Step 2: remove the four casts; run `cd gateway && npx tsc --noEmit -p tsconfig.json` (red if aliases are wrong).
- [ ] Step 3: run targeted suites: `tests/unit/runtime/mcp*.test.ts` (if present), `tests/unit/routes/mcp*.test.ts`, `tests/unit/runtime/opencode-*.test.ts`, `tests/unit/terminal*.test.ts`.
- [ ] Step 4: adapter `npx tsc --noEmit -p adapters/opencode/tsconfig.json`.
- [ ] Step 5: commit `refactor(runtime): reuse contract MCP DTOs and drop PTY casts`.

## Task 3: seam, bridge-parity and packaging test hardening

**Files:**
- Modify: `gateway/tests/unit/runtime/opencode-neutral-golden.test.ts`
- Create: `gateway/tests/unit/runtime/host-seam-propagation.test.ts`
- Create: `gateway/tests/helpers/adapter-build.ts`
- Create: `gateway/tests/unit/runtime/adapter-build.test.ts`
- Modify: `gateway/tests/unit/runtime/opencode-package.test.ts`
- Modify: `gateway/tests/integration/plugin-package-e2e.test.ts`

**Requirements:**
1. **Bridge parity** (`opencode-neutral-golden.test.ts`): run the existing
   `RAW` fixture + `fakeRuntime` through the gateway bridge
   (`gateway/src/runtime/adapter-bridge.ts`) as well as the adapter bridge, and
   assert both emit the same canonical type + owner sequence. This pins the two
   copies against drift; no production code change.
2. **Host-seam propagation** (`host-seam-propagation.test.ts`):
   - `createRuntimePluginContext(credentials, { projectDir, rootDir, gatewayPort,
     serve, policy })` returns each field and the same credentials object.
   - Source guard: `gateway/src/index.ts` `activatePluginRuntime` calls
     `createRuntimePluginContext` with `projectDir`, `rootDir`, `gatewayPort`,
     `serve` and `policy` (guard against dropping a seam). Keep it narrow and
     comment why.
3. **Packaging self-sufficiency**:
   - `gateway/tests/helpers/adapter-build.ts` exports `ensureAdapterBuilt()`:
     checks `adapters/opencode/dist/index.js` + `index.d.ts` freshness against
     `src/**/*.ts`, `build.mjs`, `tsconfig.build.json`; runs
     `node adapters/opencode/build.mjs` (cwd adapter dir) only when missing or
     stale; throws with stdout/stderr on failure.
   - Unit-test the freshness predicate with temp dirs (no build).
   - Call `ensureAdapterBuilt()` in `beforeAll` (long timeout) of
     `opencode-package.test.ts` and in the `@mafw/adapter-opencode` staging test
     in `plugin-package-e2e.test.ts`.
   - Running `cd gateway && npx jest ...` without a prior root build must pass.
4. **Cheap test hardening folded from Task 1 review**: in
   `adapter-event-mapper.test.ts`, add positive `items: []` assertions for both
   forward and reverse mapping.
5. **Final-review hardening**: include `dist/package.json` in the build outputs,
   give the build spawn a finite timeout with diagnostics, simplify the adapter's
   redundant `RuntimeMcpChannel & { config? }`, correct the v21 inbox test title,
   and document the queue snapshot semantics in `docs/architecture/runtime.md`.

**Steps:**
- [ ] Step 1: add the parity test; run it (should pass before any production change).
- [ ] Step 2: add the host-seam test; run red if a seam is missing, otherwise green.
- [ ] Step 3: add the build helper + freshness test; wire into both suites.
- [ ] Step 4: prove self-sufficiency: `Rename-Item adapters/opencode/dist dist.bak` → run the two suites → restore. (Never delete the only build without restoring.)
- [ ] Step 5: full targets: `cd gateway && npx jest --runInBand --forceExit tests/unit/runtime/opencode-package.test.ts tests/integration/plugin-package-e2e.test.ts tests/unit/runtime/opencode-neutral-golden.test.ts tests/unit/runtime/host-seam-propagation.test.ts tests/unit/runtime/adapter-build.test.ts`.
- [ ] Step 6: commit `test(runtime): pin bridge parity, host seams and adapter self-build`.

## Final gates

- `npm run build`
- `npm run test:contract`, `npm run test:core`, `npm run test:kit`
- gateway `tsc --noEmit -p tsconfig.json`
- gateway full Jest `--runInBand --forceExit` (rerun known Windows flakes isolated)
- desktop `npx tsgo -b`
- Merge `fix/adapters-opencode-minors` into local `main` after all gates; no push.
