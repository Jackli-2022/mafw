# `adapters/pi` package + `defineRuntime` (Plan 5B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the pi driver out of `gateway/src` into the `adapters/pi` workspace package and return a real `RuntimeDefinition` (`defineRuntime`), so `gateway/src` only imports the package entry.

**Architecture:** Plan 5A made pi emit `AdapterEvent` natively. Plan 5B moves the implementation across the package boundary: neutral helpers/types move to `runtime-core`/`runtime-contract`, pi files move to `adapters/pi/src`, and `pi-runtime.ts` becomes `createPiDefinition(ctx)` with `transport` + `channels` + `host`. The gateway keeps a tiny CJS shim that requires the adapter entry and registers it with `registerBuiltinDefinition`.

**Tech Stack:** TypeScript, esbuild (CJS bundle like `adapters/claude`), Jest (gateway), node:test optional.

**Spec:** `docs/superpowers/specs/2026-11-09-neutral-runtime-driver-architecture-design.md` §3/§9 Phase 2

## Sequencing

- Plan 5A merged into `main` at `5febe530`.
- **Plan 5B (this file)**: pi package extraction.
- Plan 6: `adapters/opencode`.

## Global Constraints

- `gateway/src` must not import `adapters/pi/src/**`; only the package entry (`@mafw/adapter-pi`) through the shim.
- The adapter may depend on `@mafw/runtime-contract` + `@mafw/runtime-core` only (plus `@earendil-works/pi-coding-agent`); no gateway imports.
- `RuntimeDefinition` remains ABI v1; capabilities stay explicit (`overrides: PI_CAPABILITIES`).
- Old canonical `translatePiEvent`/`PI_EVENT_MAPPINGS` leave `src`; tests use a fixture.
- Gates: gateway full jest (`--forceExit`), gateway `tsc`, root build, contract/core, desktop typecheck.

## Review Focus

1. **包边界**：`adapters/pi` 不 import `gateway/src/**`；gateway 只 import 包入口（shim 的 `require` 是唯一通道）。
2. **能力-实现一致**：`PI_CAPABILITIES` 的每个 true 位在 definition 上都有对应 transport/channel/host；`validateRuntime` 不 hard-fail。
3. **回合/流保真**：Plan 5A 的 native event 行为（mint/override/queue/abort）在 definition 路径不变。
4. **消息/历史**：`channels.messages.list` 返回 `AdapterMessage[]`（含 tool part 归并），与 live id 一致。
5. **打包**：root build → adapter build → stage → gateway build；npm/desktop/deploy-local 都带 `dist/index.js`。

---

### Task 1: Neutral helpers and types

**Files:**
- Create: `packages/runtime-core/src/session-dir.ts`
- Create: `packages/runtime-core/src/media-payload.ts`
- Modify: `packages/runtime-core/src/index.ts`
- Create: `packages/runtime-contract/src/agent-definition.ts`
- Create: `packages/runtime-contract/src/tool-registration.ts`
- Modify: `packages/runtime-contract/src/index.ts`
- Modify: `gateway/src/runtime/session-dir.ts` (re-export)
- Modify: `gateway/src/media/pi-adapter.ts` (re-export `fixMediaPayload`)
- Modify: `gateway/src/runtime/agent-definition.ts` (re-export aliases)
- Test: `packages/runtime-core/src/core.test.ts` (add 2 cases), `packages/runtime-contract/src/contract.test.ts` (type-level only if present)

**Interfaces:**
- Produces: `requireSessionDir`, `resolvePluginProjectDir` from runtime-core; `fixMediaPayload` from runtime-core; `RuntimeAgentDefinition`, `RuntimeAgentPermissions`, `PermissionRule`, `RuntimeToolRegistration` from runtime-contract.
- Consumes: nothing.

- [ ] **Step 1: Move the pure helpers**

Copy the two functions from `gateway/src/runtime/session-dir.ts` into `packages/runtime-core/src/session-dir.ts` (same signatures/comments). Copy `fixMediaPayload` from `gateway/src/media/pi-adapter.ts` into `packages/runtime-core/src/media-payload.ts`. Export both from `runtime-core/src/index.ts`.

- [ ] **Step 2: Add neutral types**

`agent-definition.ts`:

```ts
export type PermissionRule = 'allow' | 'deny' | 'ask';
export interface RuntimeAgentPermissions {
  edit?: PermissionRule;
  bash?: PermissionRule;
  task?: Record<string, PermissionRule>;
  tools?: Record<string, PermissionRule>;
}
export interface RuntimeAgentDefinition {
  description: string;
  mode?: 'primary' | 'subagent' | 'all';
  model?: string;
  temperature?: number;
  color?: string;
  systemPrompt: string;
  permissions: RuntimeAgentPermissions;
  tools?: Record<string, boolean>;
}
```

`tool-registration.ts`:

```ts
export interface RuntimeToolRegistration {
  name: string;
  label?: string;
  description: string;
  parameters: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  execute(params: any, signal?: AbortSignal): Promise<{ text: string; isError?: boolean }>;
}
```

Export both from `runtime-contract/src/index.ts`.

- [ ] **Step 3: Point the gateway at the neutral sources**

- `gateway/src/runtime/session-dir.ts`: `export { requireSessionDir, resolvePluginProjectDir } from '@mafw/runtime-core';`
- `gateway/src/media/pi-adapter.ts`: import `fixMediaPayload` from `@mafw/runtime-core` and re-export it; delete the local function body. Keep `createPiPromptAdapter` unchanged.
- `gateway/src/runtime/agent-definition.ts`: re-export `RuntimeAgentPermissions as AgentPermissions`, `RuntimeAgentDefinition as AgentDefinition`, `PermissionRule` from `@mafw/runtime-contract`, keeping the existing `MafwAgent`/helpers in that file untouched.

- [ ] **Step 4: Run tests + tsc**

Run: `npm run test:core`, `npm run test:contract`, `npx tsc --noEmit -p tsconfig.json` (cwd=gateway), `npm run build`.
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime-core packages/runtime-contract gateway/src/runtime/session-dir.ts gateway/src/media/pi-adapter.ts gateway/src/runtime/agent-definition.ts
git commit -m "refactor: move pi-shared helpers into the neutral packages"
```

---

### Task 2: `adapters/pi` package skeleton

**Files:**
- Create: `adapters/pi/package.json`
- Create: `adapters/pi/build.mjs`
- Create: `adapters/pi/src/index.ts` (temporary re-export)
- Modify: `package.json` (root build order)
- Modify: `gateway/package.json` (`mafw.bundledPackages`)
- Modify: `scripts/stage-plugin-contract.mjs` (`CONTRACT_PACKAGES`)

**Interfaces:**
- Produces: `@mafw/adapter-pi` CJS entry `dist/index.js` with `createPiDefinition(ctx)` and `PI_CAPABILITIES`.
- Consumes: `@mafw/runtime-contract`, `@mafw/runtime-core`.

- [ ] **Step 1: Package manifest**

```json
{
  "name": "@mafw/adapter-pi",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "node build.mjs"
  },
  "dependencies": {
    "@mafw/runtime-contract": "*",
    "@mafw/runtime-core": "*"
  },
  "devDependencies": {
    "esbuild": "^0.25.12"
  }
}
```

- [ ] **Step 2: Build script**

Mirror `adapters/claude/build.mjs`: esbuild `src/index.ts` → `dist/index.js`, `platform:node`, `target:node22`, `format:cjs`, `bundle:true`, `external: ['@earendil-works/pi-coding-agent','@mafw/runtime-contract','@mafw/runtime-core']`, `define: {'import.meta.url':'__filename'}`, write `dist/package.json` `{"type":"commonjs"}`. Also run `tsc --emitDeclarationOnly` into `dist` (or a small hand-written `dist/index.d.ts` re-export) so the gateway shim can typecheck without `any`.

- [ ] **Step 3: Build/stage wiring**

- Root `package.json` `build`: add `npm run build -w @mafw/adapter-pi` after `runtime-core` and before `tsc`.
- `gateway/package.json` `mafw.bundledPackages`: add `"@mafw/adapter-pi": "../adapters/pi"`.
- `scripts/stage-plugin-contract.mjs` `CONTRACT_PACKAGES`: add `{ name: '@mafw/adapter-pi', sourceDir: path.join(repoRoot, 'adapters', 'pi') }`.

- [ ] **Step 4: Temporary entry + build**

`src/index.ts`: `export const PI_CAPABILITIES = {}; export async function createPiDefinition(): Promise<never> { throw new Error('not wired yet'); }`

Run: `npm run build -w @mafw/adapter-pi`, `node scripts/stage-plugin-contract.mjs --node-modules gateway/node_modules`, `npm run build`.
Expected: `gateway/node_modules/@mafw/adapter-pi/dist/index.js` exists; build rc=0.

- [ ] **Step 5: Commit**

```bash
git add adapters/pi package.json gateway/package.json scripts/stage-plugin-contract.mjs
git commit -m "build: add the adapter-pi package skeleton"
```

---

### Task 3: Move pi source + split the old canonical mapping

**Files:**
- Move: `gateway/src/runtime/pi/*` → `adapters/pi/src/*`
- Move: `gateway/src/runtime/plugins/pi-runtime.ts` → `adapters/pi/src/runtime.ts`
- Create: `gateway/tests/fixtures/pi-canonical-events.ts` (copy of the old mapping)
- Modify: pi files' imports (contract/runtime-core/local)
- Modify: `gateway/tests/unit/runtime/pi-events.test.ts`, `history-exit-golden.test.ts`, `neutral-replay-golden.test.ts`

**Interfaces:**
- Produces: adapter-local modules `pi-events.ts` (stream only), `pi-adapter-events.ts`, `pi-session.ts`, `pi-message-normalize.ts`, `pi-approval-*`, `pi-provider.ts`, `pi-policy.ts`, `pi-agent-config.ts`, `pi-session-storage.ts`, `pi-mafw-host-extension.ts`, `runtime.ts`.
- Consumes: Task 1 neutral types/helpers.

- [ ] **Step 1: Move files**

```bash
mkdir -p adapters/pi/src
git mv gateway/src/runtime/pi/* adapters/pi/src/
git mv gateway/src/runtime/plugins/pi-runtime.ts adapters/pi/src/runtime.ts
```

- [ ] **Step 2: Split `pi-events.ts`**

Keep only `PiEventStream` + `setPiUnknownRecorder` (re-export from `pi-adapter-events`). Copy the old `PI_EVENT_SOURCE`/`PI_EVENT_MAPPINGS`/`piTransformEvent`/`translatePiEvent` block into `gateway/tests/fixtures/pi-canonical-events.ts`, changing relative imports to `../../src/runtime/...`.

Update:
- `pi-events.test.ts` → import from `../../fixtures/pi-canonical-events` (relative from `tests/unit/runtime`).
- `history-exit-golden.test.ts` → same.
- `neutral-replay-golden.test.ts` → same.

- [ ] **Step 3: Rewrite imports in the moved files**

- `../adapter-event` → `@mafw/runtime-contract`
- `../contract` types (`ThinkingLevel`, `MafwToolRegistration`) → `@mafw/runtime-contract` `ThinkingLevel` + `RuntimeToolRegistration`
- `../agent-definition` → `@mafw/runtime-contract` `RuntimeAgentDefinition`/`RuntimeAgentPermissions`
- `../canonical-types` / `../tool-part-assembler` (`coerceOutput`) → `@mafw/runtime-core`
- keep local imports (`./pi-*`)
- delete `pi-definition.ts` (the gateway shim replaces it)
- `runtime.ts` imports `../loader`/`../auth`/`../config`/`../media/pi-adapter`/`../session-dir`/`../contract`; replace with `RuntimeFactoryContext`, `ctx.credentials`, `ctx.gatewayPort`/`ctx.projectDir`, `fixMediaPayload`/`requireSessionDir` from runtime-core, and local types. Remove the auth.json fallback (host credentials are authoritative); `authPath` stays only as a test dep if needed.

- [ ] **Step 4: Typecheck the adapter source**

Run: `npx tsc --noEmit --strict --esModuleInterop --moduleResolution node --module commonjs --target ES2022 --skipLibCheck adapters/pi/src/index.ts` (temporary; the real build is Task 4).
Expected: imports resolve; no `gateway/` path.

- [ ] **Step 5: Commit**

```bash
git add -A adapters/pi gateway/src/runtime/pi gateway/src/runtime/plugins/pi-runtime.ts gateway/tests
git commit -m "refactor(pi): move the driver into adapters/pi"
```

---

### Task 4: `createPiDefinition` (transport + channels + host)

**Files:**
- Rewrite: `adapters/pi/src/runtime.ts`
- Rewrite: `adapters/pi/src/index.ts`
- Test: `adapters/pi/tests/definition.test.ts` (node:test) or gateway Jest

**Interfaces:**
- Produces: `createPiDefinition(ctx: RuntimeFactoryContext, deps?: PiRuntimeDeps): Promise<RuntimeDefinition>`; `PI_CAPABILITIES: RuntimeCapabilities`.
- Consumes: the moved registry/stream/translator.

- [ ] **Step 1: Write the failing test**

```ts
const def = await createPiDefinition(ctx, { loadPi: async () => fakePi });
assert.equal(def.name, 'pi');
assert.equal(def.external, true);
assert.equal(typeof def.transport.createSession, 'function');
assert.equal(typeof def.channels?.messages?.list, 'function');
assert.equal(typeof def.channels?.session?.fork, 'function');
assert.equal(def.capabilities.sessionApi, true);
assert.equal(def.capabilities.steerApi, true);
assert.equal(def.capabilities.discoveryApi, false);
```

- [ ] **Step 2: Implement the mapping**

Transport:
- `createSession({directory})` → `requireSessionDir(directory, ctx.projectDir)` → `registry.create(dir, {model:{provider,modelID}})` → `{sessionID:id}`.
- `sendTurn(input)` → convert `input.parts` (text or file with `ref.url`/`ref.path` or legacy `url`) via `partsToPromptInput`; `registry.promptAsync`; return `{turnID: input.turnID}`.
- `steer(sessionID, text, parts)` → `promptAsync(..., delivery:'steer')`; return `'steered'`.
- `interruptTurn` → `registry.abort`.
- `respondToRequest(sessionID, requestID, decision)` → `registry.permissionReply(...)`; map to `RequestOutcome`.
- `onEvent(listener)` → `eventStream.stream()` fan-out; return unsubscribe.
- `stop` → `registry.disposeAll()` + `eventStream.dispose()`.

Channels:
- `tools` → `registry.setToolFactory` + `PI_NATIVE_TOOLS`.
- `session` list/listByDirectory/get/update/delete/abort/todo/children/summarize/setThinkingLevel/permissionList.
- `messages.list` → `registry.messages` + `normalizePiMessages`; `normalize`.
- `providers.list` → `translateProviders(await modelRuntime())`.
- `agents.list` → `piAgentConfig.list()` mapped to `{id,label:id,source:'runtime',selectable:true}`; `install`/`remove`.
- `branch.fork` → `registry.fork` → `{sessionID:id}`; `revert`.
- `mediaSession.create` → `{sessionID}`.
- omit `question`/`diff`/`shell`/`background`/`mcp`/`discovery`/`instructions`/`snapshotTree`/`pty`.

Host:
- `config.get/update` → `translateConfigGet/Update`.
- `credentials.getApiKey` → `ctx.credentials?.getApiKey ?? null`.
- `completion` → the current `complete` implementation.
- `healthCheck` → `modelRuntime` probe.
- `getBaseUrl` → `http://127.0.0.1:${ctx.gatewayPort ?? 3000}`.

Definition:
```ts
return defineRuntime({
  api: 1, name: 'pi', displayName: 'pi', preset: 'autonomous',
  external: true,
  transport,
  channels,
  host,
  semantics: { ... },
  overrides: PI_CAPABILITIES,
});
```

- [ ] **Step 3: Run the definition test + build**

Run: adapter test, `npm run build -w @mafw/adapter-pi`, stage.
Expected: green; `dist/index.js` exports both symbols.

- [ ] **Step 4: Commit**

```bash
git add adapters/pi
git commit -m "feat(pi): return a RuntimeDefinition from the adapter"
```

---

### Task 5: Gateway wiring + test migration

**Files:**
- Create: `gateway/src/runtime/pi-adapter.ts` (CJS shim)
- Modify: `gateway/src/index.ts` (registration + `setPiUnknownRecorder`)
- Modify: `gateway/src/media/media-runtime-executor.ts` if it imported pi runtime
- Delete: `gateway/src/runtime/pi-definition.ts` (already moved)
- Update: all gateway pi tests imports to `../../../../adapters/pi/src/...`; integration test to the definition transport/channels.

**Interfaces:**
- Produces: `createPiDefinition`/`PI_CAPABILITIES`/`setPiUnknownRecorder` from the shim.
- Consumes: `@mafw/adapter-pi`.

- [ ] **Step 1: Shim**

```ts
import type { RuntimeCapabilities, RuntimeDefinition, RuntimeFactoryContext } from '@mafw/runtime-contract';
interface AdapterPiModule {
  createPiDefinition(ctx: RuntimeFactoryContext): Promise<RuntimeDefinition>;
  PI_CAPABILITIES: RuntimeCapabilities;
  setPiUnknownRecorder(fn: ((type: string) => void) | undefined): void;
}
const mod = require('@mafw/adapter-pi') as AdapterPiModule;
export const createPiDefinition = mod.createPiDefinition;
export const PI_CAPABILITIES = mod.PI_CAPABILITIES;
export const setPiUnknownRecorder = mod.setPiUnknownRecorder;
```

- [ ] **Step 2: Registration**

In `index.ts`, replace the `createPiDefinition` import from `./runtime/pi/pi-definition` with `./runtime/pi-adapter`; replace `setPiUnknownRecorder` import from `./runtime/pi/pi-events` with the shim. Keep the `registerBuiltinDefinition('pi', (ctx) => createPiDefinition(ctx), { external:false, capabilities: PI_CAPABILITIES })` call.

- [ ] **Step 3: Test migration**

Update paths; rewrite `pi-native-approvals` to use `createPiDefinition(ctx, {loadPi:...})` and `definition.transport.createSession`/`respondToRequest`/`channels.session.permissionList`. If direct registry access is needed, export `createPiState(ctx, deps)` from the adapter (test seam) and use it.

- [ ] **Step 4: Run gateway tests**

Run: `npm test -- --forceExit`, `npx tsc --noEmit -p tsconfig.json`.
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add gateway/src gateway/tests
git commit -m "refactor(gateway): load pi from the adapter package"
```

---

### Task 6: Guards + docs + final gates

**Files:**
- Modify: `gateway/tests/unit/runtime/neutral-runtime-boundaries.test.ts`
- Modify: `docs/guides/runtime-plugin-authoring.md` / `docs/architecture/gateway.md`
- Test: full gates

- [ ] **Step 1: Guards**

Assert `gateway/src` has no `runtime/pi` directory, no `plugins/pi-runtime` file, and no import of `adapters/pi/src`. Keep the `pi-adapter.ts` shim as the only import site.

- [ ] **Step 2: Docs**

Update the gateway architecture table: `pi` is `@mafw/adapter-pi`; update the authoring guide's §2.6 with the package path.

- [ ] **Step 3: Gates**

```bash
npm run build
npm run test:contract
npm run test:core
cd gateway && npx tsc --noEmit -p tsconfig.json && npm test -- --forceExit
npm run typecheck -w @mafw/desktop
```

- [ ] **Step 4: Fresh review + merge**

Dispatch a reviewer; fix Critical/Important; merge only when `main` is clean (otherwise leave the branch ready).

---

## Self-Review

- Spec §3/§9 Phase 2: package boundary (Task 2/3), `defineRuntime` (Task 4), gateway entry-only import (Task 5), guards (Task 6).
- Plan 5A's native event behavior is preserved because `pi-events.ts`/`pi-adapter-events.ts` move unchanged; only the runtime wrapper changes.
- `pi-events` old canonical mapping is removed from `src` and moved to test fixtures (Task 3).
- Packaging covers root build, stage, gateway bundle, deploy-local via `bundledPackages`.

## Known Boundaries

- `usage.updated`, `session.created/deleted`, `question.*` remain Plan 6.
- `plan.updated`: pi has no native plan source today (only `registry.todo()`); the surface stays unimplemented until a producer exists.
- `adapters/opencode` remains Plan 7.
- `@earendil-works/pi-coding-agent` stays an external runtime dependency (not bundled) to keep the adapter bundle small.
