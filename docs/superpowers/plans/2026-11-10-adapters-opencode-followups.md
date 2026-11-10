# Plan 6 follow-ups closeout (adapters/opencode)

## Context

The seven deferred minors were fixed on `fix/adapters-opencode-minors`
(`main` = `eb5f36e5`). The final review left a second, smaller set of
follow-ups in test infrastructure and parity coverage. This plan closes the
actionable ones; the full gateway test-typecheck backlog is explicitly out of
scope (844 pre-existing type errors) and gets a syntax gate plus a narrow typed
gate instead.

Base: `eb5f36e5`. Branch: `fix/adapters-opencode-followups`.

## Global constraints

- Test infrastructure and docs only; no production behaviour change.
- `gateway/src` typecheck and all runtime tests must stay green.
- No dist/node_modules committed; generated SDK artifacts stay untouched.
- Gates: `npm run test:contract`, `npm run test:core`, gateway `tsc`,
  `npm run typecheck:gateway-tests`, targeted Jest, root build.

## Task 1: make the adapter build lock owner-aware

**Files:**
- Modify: `gateway/tests/helpers/adapter-build.ts`
- Modify: `gateway/tests/unit/runtime/adapter-build.test.ts`
- Modify: `gateway/tests/unit/runtime/opencode-package.test.ts`
- Modify: `gateway/tests/integration/plugin-package-e2e.test.ts`

**Requirements:**
1. Lock ownership: after `mkdirSync(.build-lock)`, write
   `.build-lock/owner.json` with `{ token, pid: process.pid, startedAt }`
   (`token` random, e.g. `crypto.randomUUID()`).
2. Release only removes the lock when the owner token still matches; a
   stale-steal followed by the old holder's `finally` must not delete the new
   holder's lock. Release stays idempotent and never throws.
3. Staleness: a lock is stale when the recorded PID is not alive
   (`process.kill(pid, 0)` throws `ESRCH`). If the owner file is unreadable,
   fall back to the age rule (`age > LOCK_STALE_MS`). A live owner is never
   stolen by age. Stale removal re-reads the token before `rm` and aborts if it
   changed.
4. Timing budget: `LOCK_STALE_MS = 60_000`, `LOCK_TIMEOUT_MS = 150_000`,
   `BUILD_TIMEOUT_MS = 120_000`; raise both packaging suite timeouts to
   `300_000`. Pin `stale < lock timeout`, `build timeout < lock timeout`, and
   `lock timeout + build timeout < 300_000`.
5. Tests: dead-PID steal, live-PID no steal, token-mismatch release does not
   delete, stale removal aborts when the token changes, timing constants.

- [ ] Step 1: add failing tests for the new lock decisions/ownership.
- [ ] Step 2: implement owner file + token-checked release/steal.
- [ ] Step 3: run `cd gateway && npx jest --runInBand --forceExit tests/unit/runtime/adapter-build.test.ts tests/unit/runtime/opencode-package.test.ts tests/integration/plugin-package-e2e.test.ts`.
- [ ] Step 4: commit `test(runtime): make the adapter build lock owner-aware`.

## Task 2: gateway test syntax gate + narrow typed gate

**Files:**
- Modify: `gateway/tests/unit/runtime/normalize-oracle.test.ts` (line 78/79 braces)
- Modify: `gateway/tests/unit/runtime/normalize.test.ts` (line 65 brace)
- Modify: `gateway/tests/integration/plugin-package-e2e.test.ts` (`PluginEventFrame` import)
- Create: `gateway/tsconfig.test-types.json`
- Create: `gateway/tests/unit/test-syntax.test.ts`
- Modify: `package.json`, `.github/workflows/ci.yml`

**Requirements:**
1. Fix the three missing `}` braces so `tsc` can parse those files
   (`normalize-oracle.test.ts:78,79`; `normalize.test.ts:65`). Do not change
   test semantics; Jest currently tolerates the parse recovery silently.
2. Fix `PluginEventFrame` import in the e2e test: it is declared in
   `gateway/src/plugins/plugin-events.ts`, not re-exported by `package-host.ts`.
3. Add `gateway/tsconfig.test-types.json`:
   `extends ./tsconfig.json`, `noEmit`, `rootDir: ".."`, `module: commonjs`,
   `moduleResolution: node`, `types: ["jest","node"]`, include
   `tests/helpers/**/*.ts`, `tests/unit/runtime/adapter-build.test.ts`,
   `tests/unit/runtime/host-seam-propagation.test.ts`,
   `tests/unit/runtime/opencode-package.test.ts`,
   `tests/integration/plugin-package-e2e.test.ts`. It must be green.
4. Root script `typecheck:gateway-tests`: `cd gateway && npx tsc --noEmit -p tsconfig.test-types.json`;
   add it to the CI workflow next to the existing gateway typecheck.
5. Add `gateway/tests/unit/test-syntax.test.ts`: walk `gateway/tests/**/*.ts`
   (all test-support files, fixtures and helpers included), parse each with the
   TypeScript compiler API (`ts.createSourceFile(..., ScriptKind.TS)`; parse
   diagnostics are populated unconditionally) and fail with file+line for any
   parse diagnostic. This is the gate that would have caught the three
   pre-existing syntax errors; it is not a type gate.
6. Document in the test file why ts-jest's `diagnostics: false` lets parse-recovered
   files run, and that a full test typecheck remains a separate backlog.

- [ ] Step 1: fix syntax/import, add typed config, prove `npm run typecheck:gateway-tests` exit 0.
- [ ] Step 2: add the syntax guard test and show it fails on a temporary broken
      fixture (create a temp file under `tests/`, run, delete), then green.
- [ ] Step 3: wire the CI step and run the gateway full suite.
- [ ] Step 4: commit `test(gateway): add a test syntax gate and narrow typed gate`.

## Task 3: bridge payload parity + packaging input completeness

**Files:**
- Modify: `gateway/tests/unit/runtime/opencode-neutral-golden.test.ts`
- Modify: `gateway/tests/helpers/adapter-build.ts`
- Modify: `gateway/tests/unit/runtime/adapter-build.test.ts`

**Requirements:**
1. Extend the gateway↔adapter bridge parity test to compare canonical
   `payload.type` **and** a normalized `payload.properties` deep-equal for every
   emitted event (strip volatile `id`, `at`, `turnID`, `native`). A payload-only
   drift between the copies must fail.
2. Add `tsconfig.json` to `BUILD_INPUT_FILES` (it shapes `dist/index.d.ts`).
   `package.json` was proposed but is **not** a dist-content input: `build.mjs`
   writes a hard-coded `dist/package.json` and staging copies the source
   manifest; keep it out.
3. Leave the mtime-resolution trade-off and the adapter's internal MCP aliases
   as documented non-issues (no code churn).
4. Pin `BUILD_TIMEOUT_MS < LOCK_TIMEOUT_MS`.
5. Widen the syntax guard to all `gateway/tests/**/*.ts` and fix its header
   comment about the `createSourceFile` argument.

- [ ] Step 1: extend the parity assertion; it must pass on the current identical copies.
- [ ] Step 2: add the two inputs + tests; run the adapter-build suite.
- [ ] Step 3: run the golden + packaging suites.
- [ ] Step 4: commit `test(runtime): pin bridge payload parity and packaging inputs`.

## Final gates

- `npm run build`
- `npm run test:contract`, `npm run test:core`, `npm run test:kit`
- gateway `tsc --noEmit -p tsconfig.json`
- `npm run typecheck:gateway-tests`
- gateway full Jest `--runInBand --forceExit` (isolate known flakes)
- desktop `npx tsgo -b`
- Merge into local `main` after all gates; no push.
