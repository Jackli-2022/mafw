# Neutral Runtime Plan 4 — legacy cleanup, guards, frontend audit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the last in-kernel legacy paths (`legacy/` shim, `registerBuiltin`, direct opencode fallback), make file-neutral definitions safe across runtime switches, and lock the neutral boundary with tests.

**Architecture:** The `RuntimeDefinition` + `RuntimeBus` path is already the only production entry (Plans 1–3). Plan 4 deletes the scaffolding that is now unreachable, migrates the tests that still exercised it, and extends the kernel boundary guards. The legacy `createRuntime(ctx)` shim for *external* plugin files stays for one release (generic `adapter-bridge`), and physical `adapters/*` package extraction stays Plan 5.

**Tech Stack:** TypeScript, Jest (gateway), node:test (`packages/runtime-contract` / `runtime-core`), node --test + tsx (desktop).

**Spec:** `docs/superpowers/specs/2026-11-09-neutral-runtime-driver-architecture-design.md` (§9 Phase 4)

## Sequencing

- Plan 1 (merged `3bd61e8b`): kernel + claude.
- Plan 2 (merged `774879b9`): `runtime-core`, pi definition, production switch for pi.
- Plan 3 (merged `c6f2e347`): opencode definition + v2 channels.
- **Plan 4 (this file)**: delete the unlocked legacy surface, extend guards, record the frontend audit.
- Plan 5 (not written): physical `adapters/pi` + `adapters/opencode` packages; `pi-events` native transport; full `gateway/src` protocol-name guard.

## Global Constraints

- ABI: `api: 1`, `eventApi: 1`; no second ABI.
- Kernel files (`adapter-event.ts`, `adapter-event-mapper.ts`, `runtime-bus.ts`, `plugin-entry.ts`, `adapter-bridge.ts`) stay free of runtime names and `payload.properties`.
- Built-in runtimes register only through `registerBuiltinDefinition`; external files may still export the legacy `createRuntime(ctx)` shape for one release.
- Do not delete `gateway/src/runtime/pi/pi-events.ts`: `pi-runtime.ts` still uses `PiEventStream` (native transport is Plan 5).
- Every change must pass: gateway full jest (`--forceExit`), `npm run test:contract`, `npm run test:core`, gateway `tsc` (cwd=gateway), root `npm run build`.

## Review Focus

1. **冷启动不再直连**：删掉 `createRuntime()` 的 `createOpencodeRuntime` 安全网后，loader 未注册 opencode 必须给出清晰的中性错误，不能静默返回半初始化 runtime。
2. **文件插件的重激活**：静态 neutral 文件定义在切走再切回时必须重新求值（不能复用已 `dispose` 的 definition），且同名内置定义仍让位给文件插件。
3. **注册面唯一**：生产代码不得再出现 `runtimeLoader.registerBuiltin(`；TTS 的 `ttsRegistry.registerBuiltin(` 不受影响。
4. **错误文案中性**：缺 surface 的 503 文案不含 runtime 名，kernel 文件不含协议名（注释除外）。
5. **测试迁移保真**：被迁移的 loader 优先级测试必须继续覆盖「文件插件 > 内置定义」和「别名不遮蔽内置名」。

---

### Task 1: Delete the legacy bridge shim

**Files:**
- Modify: `gateway/src/runtime/loader.ts:20`
- Delete: `gateway/src/runtime/legacy/legacy-plugin-bridge.ts`
- Rename: `gateway/tests/unit/runtime/legacy-plugin-bridge.test.ts` → `gateway/tests/unit/runtime/adapter-bridge-legacy-runtime.test.ts`
- Test: renamed test file + `gateway/tests/unit/runtime/loader-builtin-definition.test.ts`

**Interfaces:**
- Consumes: `toRuntimeDefinition` from `./adapter-bridge` (same signature the shim re-exported).
- Produces: no `gateway/src/runtime/legacy/` directory.

- [ ] **Step 1: Repoint the test and loader import**

In the renamed test file, change:

```ts
import { toRuntimeDefinition } from '../../../src/runtime/legacy/legacy-plugin-bridge';
```

to:

```ts
import { toRuntimeDefinition } from '../../../src/runtime/adapter-bridge';
```

In `gateway/src/runtime/loader.ts`, change:

```ts
import { toRuntimeDefinition } from './legacy/legacy-plugin-bridge';
```

to:

```ts
import { toRuntimeDefinition } from './adapter-bridge';
```

- [ ] **Step 2: Delete the shim**

```bash
git mv gateway/tests/unit/runtime/legacy-plugin-bridge.test.ts gateway/tests/unit/runtime/adapter-bridge-legacy-runtime.test.ts
git rm gateway/src/runtime/legacy/legacy-plugin-bridge.ts
```

- [ ] **Step 3: Run the affected tests**

Run: `npx jest tests/unit/runtime/adapter-bridge-legacy-runtime.test.ts tests/unit/runtime/loader-builtin-definition.test.ts --runInBand --forceExit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A gateway/src/runtime/loader.ts gateway/src/runtime/legacy gateway/tests/unit/runtime/adapter-bridge-legacy-runtime.test.ts
git commit -m "refactor(gateway): drop the legacy bridge re-export"
```

---

### Task 2: Remove `registerBuiltin` (legacy in-process registration)

**Files:**
- Modify: `gateway/src/runtime/loader.ts` (`builtins` map, `registerBuiltin`, `get`, `getBuiltinNames`, `getState`, alias check)
- Modify: `gateway/tests/unit/runtime/loader-builtin.test.ts`
- Modify: `gateway/tests/unit/runtime/loader-alias.test.ts`
- Modify: `gateway/tests/unit/runtime-loader-builtins.test.ts`
- Modify: `gateway/tests/unit/runtime-loader-builtin-precedence.test.ts`
- Modify: `gateway/tests/unit/plugins-package-runtime-loader.test.ts`
- Test: `gateway/tests/unit/runtime/neutral-runtime-boundaries.test.ts` (new guard assertions)

**Interfaces:**
- Produces: `RuntimePluginLoader` has no `registerBuiltin` method and no `builtins` map; `getBuiltinNames()` returns `builtinDefinitions` keys only.
- Consumes: `registerBuiltinDefinition(name, factory, { external, capabilities, eventEntry? })` (Plan 3).

- [ ] **Step 1: Write the failing guard test**

Append to `gateway/tests/unit/runtime/neutral-runtime-boundaries.test.ts`:

```ts
it('the loader has no legacy builtin registration API', () => {
  const loader = stripComments(fs.readFileSync(path.join(__dirname, '../../../src/runtime/loader.ts'), 'utf8'));
  expect(loader).not.toMatch(/\bregisterBuiltin\s*\(/);
  expect(loader).not.toMatch(/\bprivate builtins\b/);
});

it('the composition root registers no legacy builtins or direct adapter fallback', () => {
  const index = stripComments(fs.readFileSync(path.join(__dirname, '../../../src/index.ts'), 'utf8'));
  expect(index).not.toMatch(/runtimeLoader\.registerBuiltin\s*\(/);
  expect(index).not.toMatch(/createOpencodeRuntime\s*\(/);
});
```

Add the import at the top:

```ts
import { stripComments } from '../../../../packages/test-shim/comment-strip';
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/runtime/neutral-runtime-boundaries.test.ts --runInBand --forceExit`
Expected: FAIL on the two new assertions.

- [ ] **Step 3: Remove the API and migrate the tests**

In `loader.ts`:
- Delete the `private builtins = new Map<...>()` field.
- Delete the `registerBuiltin(...)` method (lines ~95-104).
- In `get(name)`, delete the final `const builtin = this.builtins.get(name); if (builtin) return ...` block.
- In `getBuiltinNames()`, return `[...this.builtinDefinitions.keys()]`.
- In `getState()`, delete the `for (const [name, b] of this.builtins)` loop (keep the `builtinDefinitions` loop).
- In `loadFile` alias registration, change `!this.builtins.has(stem)` to `!this.builtinDefinitions.has(stem)`.

Rewrite `gateway/tests/unit/runtime/loader-builtin.test.ts` so every case uses `registerBuiltinDefinition` and `resolveBuiltinDefinition` (the `get()` builtin branch is gone):

```ts
import { defineRuntime } from '@mafw/runtime-contract';
import { RuntimePluginLoader } from '../../../src/runtime/loader';
import { minimalCapabilities } from '../../../src/runtime/contract';

const definition = (name: string) => defineRuntime({
  api: 1,
  name,
  displayName: name,
  preset: 'core',
  transport: {
    createSession: async () => ({ sessionID: 's1' }),
    sendTurn: async (input) => ({ turnID: input.turnID }),
    interruptTurn: async () => {},
    onEvent: () => () => {},
  },
});

it('resolves a builtin definition and exposes it in hub state', async () => {
  const loader = new RuntimePluginLoader(dir);
  loader.registerBuiltinDefinition('my-builtin', async () => definition('my-builtin'), {
    external: true,
    capabilities: { ...minimalCapabilities(), eventStream: true },
  });
  const resolved = await loader.resolveBuiltinDefinition('my-builtin', {});
  expect(resolved?.name).toBe('my-builtin');
  expect(loader.getBuiltinNames()).toContain('my-builtin');
  expect(loader.get('my-builtin')).toBeUndefined();
  expect(loader.getState().find((s) => s.name === 'my-builtin')?.status).toBe('ok');
});

it('file plugins take precedence over a same-name builtin definition', async () => {
  fs.writeFileSync(path.join(dir, 'dup.js'), `module.exports = { name: 'dup', async createRuntime() { return { name: 'dup-file' }; } };`);
  let built = 0;
  const loader = new RuntimePluginLoader(dir);
  loader.registerBuiltinDefinition('dup', async () => { built += 1; return definition('dup-builtin'); }, {
    external: false,
    capabilities: minimalCapabilities(),
  });
  await loader.init();
  const resolved = await loader.resolveBuiltinDefinition('dup', {});
  expect(resolved).toBeDefined();
  expect(built).toBe(0);
});
```

In `loader-alias.test.ts`, remove the `registerBuiltin` call from `makeLoader` and rewrite the “stem alias never shadows a builtin” case:

```ts
test('stem alias never shadows a neutral builtin name', async () => {
  writePlugin(dir, 'pi.js', 'xyz');
  const loader = new RuntimePluginLoader(dir);
  loader.registerBuiltinDefinition('pi', async () => ({}) as any, { external: false, capabilities: {} as any });
  await loader.init();
  expect(loader.has('pi')).toBe(true);
  expect(loader.get('pi')).toBeUndefined();
  expect(loader.get('xyz')).toBeDefined();
});
```

In `runtime-loader-builtins.test.ts`, replace `registerBuiltin` with `registerBuiltinDefinition('pi', async () => ({}) as any, { external: false, capabilities: {} as any })` and assert `getBuiltinNames()` contains `pi`.

In `runtime-loader-builtin-precedence.test.ts`, replace both `registerBuiltin` calls with `registerBuiltinDefinition`; the first case asserts `getBuiltinNames()` contains `opencode` and `get('opencode')` is undefined; the second counts builtin factory calls and asserts `0` after `resolveBuiltinDefinition('opencode', {})`.

In `plugins-package-runtime-loader.test.ts`, replace the competing `registerBuiltin` with `registerBuiltinDefinition` (factory never called) and assert `get('pkg-rt')` still returns the package entry plus `has('pkg-rt') === true`.

- [ ] **Step 4: Run the migrated suites**

Run: `npx jest tests/unit/runtime/loader-builtin.test.ts tests/unit/runtime/loader-alias.test.ts tests/unit/runtime-loader-builtins.test.ts tests/unit/runtime-loader-builtin-precedence.test.ts tests/unit/plugins-package-runtime-loader.test.ts tests/unit/runtime/neutral-runtime-boundaries.test.ts --runInBand --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/loader.ts gateway/tests/unit
git commit -m "refactor(gateway): remove the legacy registerBuiltin API"
```

---

### Task 3: Delete the direct opencode fallback

**Files:**
- Modify: `gateway/src/index.ts` (`createRuntime`, ~2012-2044; unused `OPENCODE_*` imports)
- Test: `gateway/tests/unit/runtime/neutral-runtime-boundaries.test.ts`

**Interfaces:**
- Produces: `createRuntime()` throws `Error("No runtime is registered for '<name>'. Configure runtime.plugin or install a runtime plugin.")` when neither the requested name nor the opencode definition resolves.
- Consumes: `resolveBuiltinDefinition` (all built-ins including opencode).

- [ ] **Step 1: Confirm the guard test is red**

Run: `npx jest tests/unit/runtime/neutral-runtime-boundaries.test.ts --runInBand --forceExit`
Expected: FAIL on `createOpencodeRuntime(` in `src/index.ts` (the guard was added in Task 2; Task 2 fixes only the `registerBuiltin` half).

- [ ] **Step 2: Delete the fallback block**

In `createRuntime()`, remove everything from `// 最终安全网：loader 未注册 opencode 时直连（不应发生）` through `return this.adoptRuntimeHost(wrappedFallback, fallbackFacade);` and replace with:

```ts
throw new Error(
  `No runtime is registered for '${wanted}'. Configure runtime.plugin or install a runtime plugin.`,
);
```

Remove the now-unused static import:

```ts
import { OPENCODE_EVENT_SOURCE, OPENCODE_V1_EVENT_MAPPINGS, OPENCODE_TRANSFORM_EVENT } from './runtime/opencode-events';
```

(`createRuntimeFacade` remains used by the legacy plugin and neutral branches.)

- [ ] **Step 3: Run tests and typecheck**

Run: `npx jest tests/unit/runtime/neutral-runtime-boundaries.test.ts tests/unit/routes/runtime-switch.test.ts --runInBand --forceExit`
Run: `npx tsc --noEmit -p tsconfig.json` (cwd=gateway)
Expected: PASS, rc=0.

- [ ] **Step 4: Commit**

```bash
git add gateway/src/index.ts
git commit -m "refactor(gateway): remove the direct opencode fallback"
```

---

### Task 4: Rebuild file-neutral definitions on every activation

**Files:**
- Modify: `gateway/src/runtime/loader.ts` (`neutralFileSources`, `reloadNeutralFile`, `resolveBuiltinDefinition`, scan removal)
- Test: `gateway/tests/unit/runtime/loader-neutral-reload.test.ts` (create)

**Interfaces:**
- Produces: `RuntimePluginLoader.resolveBuiltinDefinition(name, ctx)` re-evaluates a file-neutral module before returning it; a disposed definition is never reused.
- Consumes: `loadFile(file, loadedNames)` and `neutralBus.unregister(name)`.

- [ ] **Step 1: Write the failing test**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RuntimePluginLoader } from '../../../src/runtime/loader';

function neutralModule(displayName: string): string {
  return `module.exports = {
    name: 'reloadable',
    api: 1,
    eventApi: 1,
    preset: 'core',
    displayName: ${JSON.stringify(displayName)},
    capabilities: {},
    transport: {
      createSession: async () => ({ sessionID: 's1' }),
      sendTurn: async (input) => ({ turnID: input.turnID }),
      interruptTurn: async () => {},
      onEvent: () => () => {},
    },
  };`;
}

describe('file-neutral definitions', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-neutral-reload-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('re-evaluates the module on every activation', async () => {
    const file = path.join(dir, 'reloadable.js');
    fs.writeFileSync(file, neutralModule('one'));
    const loader = new RuntimePluginLoader(dir);
    await loader.init();

    const first = await loader.resolveBuiltinDefinition('reloadable', {});
    expect(first?.displayName).toBe('one');

    fs.writeFileSync(file, neutralModule('two'));
    const second = await loader.resolveBuiltinDefinition('reloadable', {});
    expect(second?.displayName).toBe('two');
    expect(second).not.toBe(first);
    expect(second!.transport).not.toBe(first!.transport);
  });

  it('file-neutral wins over a same-name builtin definition', async () => {
    fs.writeFileSync(path.join(dir, 'reloadable.js'), neutralModule('file'));
    let built = 0;
    const loader = new RuntimePluginLoader(dir);
    loader.registerBuiltinDefinition('reloadable', async () => { built += 1; return {} as any; }, {
      external: false,
      capabilities: {} as any,
    });
    await loader.init();

    const resolved = await loader.resolveBuiltinDefinition('reloadable', {});
    expect(resolved?.displayName).toBe('file');
    expect(built).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/runtime/loader-neutral-reload.test.ts --runInBand --forceExit`
Expected: FAIL — second `displayName` is still `one` (cached definition).

- [ ] **Step 3: Implement the reload**

In `loader.ts`:

```ts
/** Source file for each neutral definition loaded from a plugin file. */
private readonly neutralFileSources = new Map<string, string>();
```

In `loadFile`, the `entry.kind === 'neutral'` branch sets `this.neutralFileSources.set(name, file)`; any non-neutral branch deletes `this.neutralFileSources.delete(name)`.

In `scan()`’s removal block, add `this.neutralFileSources.delete(prev.name)`.

Add:

```ts
/** Static file definitions cannot be revived after dispose; re-evaluate the module. */
private async reloadNeutralFile(name: string): Promise<void> {
  const file = this.neutralFileSources.get(name);
  if (!file) return;
  this.neutralBus.unregister(name);
  this.neutralDefinitions.delete(name);
  this.fileNeutral.delete(name);
  await this.loadFile(file, new Set());
}
```

Change `resolveBuiltinDefinition`’s precedence block to:

```ts
if (this.fileNeutral.has(name)) {
  await this.reloadNeutralFile(name);
  return this.getNeutral(name, ctx);
}
if (this.factories.has(name) || this.legacyModules.has(name)) {
  return this.getNeutral(name, ctx);
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/runtime/loader-neutral-reload.test.ts tests/unit/runtime/opencode-lifecycle.test.ts tests/unit/runtime/loader-builtin-definition.test.ts --runInBand --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/loader.ts gateway/tests/unit/runtime/loader-neutral-reload.test.ts
git commit -m "fix(gateway): rebuild file-neutral definitions per activation"
```

---

### Task 5: Extend the kernel boundary guards

**Files:**
- Modify: `gateway/tests/unit/runtime/neutral-runtime-boundaries.test.ts`
- Test: same file

**Interfaces:**
- Consumes: `stripComments` from `packages/test-shim/comment-strip`.
- Produces: guards for legacy directory, kernel runtime names, neutral error text, `payload.properties` scope.

- [ ] **Step 1: Extend `NEUTRAL_FILES` and the name check**

```ts
const NEUTRAL_FILES = [
  'adapter-event.ts',
  'adapter-event-mapper.ts',
  'adapter-bridge.ts',
  'runtime-bus.ts',
  'plugin-entry.ts',
];
```

Name matching must use comment-stripped text:

```ts
const text = stripComments(fs.readFileSync(full, 'utf8'));
if (FORBIDDEN.test(text)) offenders.push(file);
```

- [ ] **Step 2: Add the remaining guards**

```ts
it('removed the legacy bridge shim', () => {
  expect(fs.existsSync(path.join(__dirname, '../../../src/runtime/legacy'))).toBe(false);
});

it('missing-surface errors stay runtime-neutral', () => {
  const access = stripComments(fs.readFileSync(path.join(__dirname, '../../../src/runtime/runtime-access.ts'), 'utf8'));
  expect(FORBIDDEN.test(access)).toBe(false);
});
```

- [ ] **Step 3: Run the guard suite**

Run: `npx jest tests/unit/runtime/neutral-runtime-boundaries.test.ts --runInBand --forceExit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add gateway/tests/unit/runtime/neutral-runtime-boundaries.test.ts
git commit -m "test: extend the neutral runtime boundary guards"
```

---

### Task 6: Docs and frontend audit record

**Files:**
- Modify: `docs/architecture/gateway.md` (builtin table row)
- Modify: `docs/guides/runtime-plugin-authoring.md` (new section before `## 3.`)
- Modify: `.superpowers/sdd/2026-11-09-neutral-runtime-cleanup/progress.md` (audit findings; not committed)

**Interfaces:**
- Produces: docs that describe `registerBuiltinDefinition` + `defineRuntime` as the only built-in path, and a recorded frontend audit.
- Consumes: the desktop guard `packages/desktop/src/renderer/mafw/experience-boundaries.test.ts` (already scans all `src/`).

- [ ] **Step 1: Update the builtin table row**

In `docs/architecture/gateway.md`, replace the ASCII substring:

```text
runtime：`registerBuiltin('opencode'/'pi')`
```

with:

```text
runtime：`registerBuiltinDefinition('opencode'/'pi')`（`defineRuntime` 定义 + `RuntimeBus`）
```

- [ ] **Step 2: Add the neutral definition section to the guide**

Insert before the heading that starts with `## 3.`:

```markdown
## 2.6 中性 RuntimeDefinition（v5.1+）

内置 runtime 与新的第三方 runtime 统一走 `defineRuntime` 形状（`@mafw/runtime-contract`）：

```js
module.exports = {
  api: 1,
  eventApi: 1,
  name: 'my-runtime',
  displayName: 'My Runtime',
  preset: 'conversation',
  transport: {
    createSession: async ({ directory }) => ({ sessionID: '...' }),
    sendTurn: async ({ sessionID, turnID, text }) => ({ turnID }),
    interruptTurn: async ({ sessionID }) => {},
    onEvent: (listener) => { /* ... */ return () => {}; },
  },
  channels: { /* session/events/tools/approvals/... 中立方法，见 §2 */ },
  channelsV2: { /* mcp/discovery/instructions/pty/checkpoint/background */ },
  host: { /* config/credentials/completion/healthCheck/getBaseUrl/agentProcess */ },
};
```

- `transport` 只负责回合协议；所有非事件面走 `channels`（v1）或 `channelsV2`（v2）。
- 事件必须是 `AdapterEvent`（33 个变体）；原生信封翻译在 adapter 内完成，gateway 不认原生字段。
- 旧的 `module.exports = { name, capabilities, createRuntime(ctx) }` 仍可用一个发布周期（generic bridge 包裹），新代码请直接导出 definition。
- `registerBuiltinDefinition` 是 gateway 内部注册面；外部插件只需导出上面的对象。
```

- [ ] **Step 3: Record the frontend audit**

Append to `.superpowers/sdd/2026-11-09-neutral-runtime-cleanup/progress.md`:

```text
Frontend audit (Plan 4): packages/desktop/src/renderer/mafw/experience-boundaries.test.ts already scans
all src/ for runtimeName/runtimeCaps/*Api reads, wire history shapes and SDK imports; it passes without
changes. Two literal "opencode" occurrences are not runtime branches:
- src/main/install-state.ts:6 — filesystem artifact directory name (install-state detection).
- src/renderer/mafw/pages/Config.tsx:1730 — config nav key (Diagnostics whitelist).
No frontend code change is required in Plan 4.
```

- [ ] **Step 4: Verify docs + desktop guard**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/experience-boundaries.test.ts` (cwd=`packages/desktop`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/gateway.md docs/guides/runtime-plugin-authoring.md
git commit -m "docs: describe the neutral runtime definition path"
```

---

### Task 7: Full gates, fresh review, merge

**Files:** none (verification only)

- [ ] **Step 1: Run the full gates**

Run from repo root:

```bash
npm run build
npm run test:contract
npm run test:core
```

Run from `gateway/`:

```bash
npx tsc --noEmit -p tsconfig.json
npm test -- --forceExit
```

Run from the repo root:

```bash
npm run typecheck -w @mafw/desktop
npm test -w @mafw/desktop
```

Expected: all green (gateway ≥641 suites / 5033 tests minus deleted legacy cases, contract 15/15, core 3/3, desktop guard green, typecheck rc=0).

- [ ] **Step 2: Fresh-context review**

Dispatch a general subagent with the branch diff `c6f2e347..HEAD` and the plan/spec paths; require findings by severity and a merge verdict. Fix every Critical/Important, re-run the gates.

- [ ] **Step 3: Merge**

```bash
git switch main
git merge feat/neutral-runtime-cleanup --no-edit
```

Re-run the gateway full suite on `main` after the merge; do not push/deploy/release.

---

## Self-Review

- Spec §9 Phase 4 coverage: legacy bridge (Task 1), `registerBuiltin` (Task 2), direct fallback (Task 3), guards (Task 5), docs/frontend (Task 6). `pi-events` and physical adapter packages are explicitly Plan 5.
- Type consistency: `registerBuiltinDefinition` signature is the Plan 3 one; `resolveBuiltinDefinition` and `neutralFileSources` are used only in Task 4.
- Review Focus mapping: cold start → Task 3; reactivation → Task 4; unique registration → Task 2/5; neutral errors → Task 5; test migration fidelity → Task 2.

## Known Boundaries

- `pi-events.ts` stays (used by `pi-runtime.ts`); pi native AdapterEvent transport is Plan 5.
- External file/package plugins may still export `createRuntime(ctx)`; the generic `adapter-bridge` shim stays for one release.
- A neutral file plugin that fails to re-require on activation is removed from the bus and falls back like a missing plugin.
- Full `gateway/src` protocol-name grep remains Plan 5 (pi/opencode implementations are still in the gateway).
