# Runtime Contract Coverage Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the runtime contract into a single-source coverage manifest with static/behavioral coverage, manifest-driven validation, and a versioned JSON export for runtime-plugin authors.

**Architecture:** A typed TypeScript manifest (surfaces × directions × obligations × domains, plus capabilities/events/presets) lives in `gateway/src/runtime/`. A pure coverage engine probes a `ContractSubject` (runtime + loader declaration + dialect) and produces per-surface status. `validate.ts` becomes a projection of the manifest; `GET /api/runtime/contract` and an emit script expose the same data as JSON in the SDK contract directory. Claude adapter tests prove the coverage report catches both missing methods and shallow implementations.

**Tech Stack:** TypeScript, Node 22, Jest (gateway), node --test + tsx (SDK), esbuild (claude adapter tests), existing lightweight JSON-schema validator.

**Spec:** `docs/superpowers/specs/2026-10-30-runtime-contract-coverage-manifest-design.md`

**Scope of this plan:** P0 + P1 backend/SDK/claude. Config UI, live conformance expansion, `mafw plugin-check` CLI, and generated docs are follow-up plans (listed at the end).

## Global Constraints

- **No new runtime capability flags** in this plan (`mediaInputApi`, `thinkingLevelApi`, `turnOutputSchemaApi`, `toolVisibilityApi` are expressed as `optional` + behavior/conformance).
- `required` set stays: 11 session methods (`create/promptAsync/prompt/messages/get/delete/abort/list/todo/children/summarize`) + `tools.registerTools` + `tools.nativeTools` + `global.event` when `eventStream` + `provider.list`/`app.agents`/`config.get|update` when `providerConfigApi`.
- opencode/pi **effective capabilities must not gain new hard failures or downgrades**; new notes are allowed. Claude may downgrade as documented in the spec §1.
- JSON output path is `packages/gateway-sdk/contract/runtime-contract.json`; schema is `packages/gateway-sdk/contract/runtime-contract.schema.json`.
- `contractVersion` starts at `2026.10.0`; `schemaVersion` is `1`.
- Every new file gets a focused Jest test (gateway) or node --test (SDK). Run the targeted test first, then the full suite before the final commit.
- Commit after every task. Do not commit unrelated user changes.
- Gateway typecheck command: `cd gateway && npx tsc --noEmit -p tsconfig.json`.
- SDK test command: `cd packages/gateway-sdk && npm test`.
- Full gateway suite: `cd gateway && npx jest --runInBand`.

## Review Focus

These are the failure modes most likely to bite; each has a test in the owning task.

1. **Declaration surfaces live on loader meta, not on `rt`.** A coverage engine that only walks `rt` will mark `plugin.eventSource/eventMappings/transformEvent` missing for opencode/pi and downgrade `eventStream` at activation. Test: Task 5 declaration probe + Task 6 eventStream parity.
2. **`nativeApprovals` is an AND-group of one.** `permissionList` missing must stay a warning, not downgrade `nativeApprovals`; otherwise desktop approvals disappear. Test: Task 6.
3. **`providerConfigApi` is hard when declared.** Missing `provider.list`/`app.agents`/`config.get|update` must be a hard failure, not a warning; otherwise the settings page breaks at runtime. Test: Task 6.
4. **`eventStream` without translations is downgraded by the loader.** The manifest must not double-downgrade or skip it. Test: Task 6 + Task 10 (claude has declarations).
5. **`attested` is not `present`.** `turnBudgetApi`, `checkpointApi`, `runStateApi` cannot be probed; they must appear under `unverified`, never as covered. Test: Task 5.
6. **Behavior probes are not presence probes.** `prompt.result.usage`/`prompt.parts.file` need a fake-SDK or conformance run; a presence probe would falsely mark them present. Test: Task 11.

---

### Task 1: Manifest types + invariant validator

**Files:**
- Create: `gateway/src/runtime/contract-manifest-types.ts`
- Create: `gateway/src/runtime/contract-manifest.ts`
- Test: `gateway/tests/unit/runtime/contract-manifest.test.ts`

**Interfaces:**
- Consumes: nothing (pure types + validation).
- Produces:
  - `ContractDirection`, `ContractObligation`, `ContractDomain`, `Verification`, `CapabilityKind`, `PresetId`, `SurfaceStatus`
  - `ContractSurface`, `ContractCapability`, `ContractEvent`, `CognitionVerb`, `ContractPreset`, `RuntimeContractManifest`
  - `CONTRACT_VERSION: string`, `SCHEMA_VERSION: 1`
  - `buildRuntimeContractManifest(): RuntimeContractManifest`
  - `validateManifest(m: RuntimeContractManifest): string[]`

- [ ] **Step 1: Write the failing test**

Create `gateway/tests/unit/runtime/contract-manifest.test.ts`:

```ts
import {
  buildRuntimeContractManifest,
  validateManifest,
  type RuntimeContractManifest,
} from '../../../src/runtime/contract-manifest';

function fixture(overrides: Partial<RuntimeContractManifest> = {}): RuntimeContractManifest {
  return {
    schemaVersion: 1,
    contractVersion: 'test',
    generatedFrom: 'gateway/src/runtime/contract-manifest.ts',
    domains: [{ id: 'session', title: 'Session', description: '' }],
    surfaces: [],
    capabilities: [],
    events: [],
    cognition: [],
    presets: [],
    ...overrides,
  };
}

describe('runtime contract manifest invariants', () => {
  it('accepts an empty well-formed manifest', () => {
    expect(validateManifest(fixture())).toEqual([]);
  });

  it('rejects duplicate surface ids', () => {
    const errors = validateManifest(fixture({
      surfaces: [
        { id: 'session.create', title: 'create', direction: 'gateway->runtime', domain: 'session', obligation: 'required', verification: 'presence', implementation: 'session.create', probe: ['session', 'create'], consumer: 'test', impact: 'x' },
        { id: 'session.create', title: 'create again', direction: 'gateway->runtime', domain: 'session', obligation: 'required', verification: 'presence', implementation: 'session.create', probe: ['session', 'create'], consumer: 'test', impact: 'x' },
      ],
    }));
    expect(errors.join('\n')).toMatch(/duplicate surface id/i);
  });

  it('rejects gated without capability and requiredWhen on non-required', () => {
    const errors = validateManifest(fixture({
      surfaces: [
        { id: 'session.fork', title: 'fork', direction: 'gateway->runtime', domain: 'branch', obligation: 'gated', verification: 'presence', implementation: 'session.fork', probe: ['session', 'fork'], consumer: 'test', impact: 'x' },
        { id: 'session.update', title: 'rename', direction: 'gateway->runtime', domain: 'session', obligation: 'optional', requiredWhen: { capabilities: ['eventStream'] }, verification: 'presence', implementation: 'session.update', probe: ['session', 'update'], consumer: 'test', impact: 'x' },
      ],
    }));
    expect(errors.join('\n')).toMatch(/gated.*capability/i);
    expect(errors.join('\n')).toMatch(/requiredWhen.*required/i);
  });

  it('rejects behavior/conformance/attested surfaces without their probe data', () => {
    const errors = validateManifest(fixture({
      surfaces: [
        { id: 'prompt.result.usage', title: 'usage', direction: 'gateway->runtime', domain: 'prompt', obligation: 'optional', verification: 'behavior', implementation: 'prompt', consumer: 'test', impact: 'x' },
        { id: 'turn.terminal', title: 'terminal', direction: 'gateway->runtime', domain: 'events', obligation: 'optional', verification: 'conformance', implementation: 'event', consumer: 'test', impact: 'x' },
        { id: 'turnBudget', title: 'budget', direction: 'gateway->runtime', domain: 'prompt', obligation: 'gated', capability: 'turnBudgetApi', verification: 'attested', implementation: 'prompt', consumer: 'test', impact: 'x' },
      ],
    }));
    expect(errors.join('\n')).toMatch(/behavior.*behavior id/i);
    expect(errors.join('\n')).toMatch(/conformance.*scenario/i);
  });

  it('rejects a preset that references an unknown surface', () => {
    const errors = validateManifest(fixture({
      presets: [{ id: 'core', title: 'Core', description: '', requiredSurfaces: ['missing.surface'], capabilities: [] }],
    }));
    expect(errors.join('\n')).toMatch(/unknown surface/i);
  });

  it('builds a complete manifest object', () => {
    const m = buildRuntimeContractManifest();
    expect(m.schemaVersion).toBe(1);
    expect(m.contractVersion).toBe('2026.10.0');
    expect(m.generatedFrom).toBe('gateway/src/runtime/contract-manifest.ts');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/contract-manifest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the types and validator**

Create `gateway/src/runtime/contract-manifest-types.ts` with the type aliases/interfaces exactly as in the spec §6.1–§6.6. Keep `PresetId` and `SurfaceStatus` exported from this file.

Create `gateway/src/runtime/contract-manifest.ts`:

```ts
import type { RuntimeContractManifest } from './contract-manifest-types';

export const SCHEMA_VERSION = 1 as const;
export const CONTRACT_VERSION = '2026.10.0';

export function buildRuntimeContractManifest(): RuntimeContractManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    contractVersion: CONTRACT_VERSION,
    generatedFrom: 'gateway/src/runtime/contract-manifest.ts',
    domains: [],
    surfaces: [],
    capabilities: [],
    events: [],
    cognition: [],
    presets: [],
  };
}

export function validateManifest(m: RuntimeContractManifest): string[] {
  // structural checks only: duplicate ids, gated/capability, requiredWhen,
  // verification probe fields, preset surface refs, preset reverse index.
  // Completeness (every capability key) is asserted in Task 4.
  return [];
}
```

Implement `validateManifest` with these exact error substrings (tests depend on them):
`duplicate surface id`, `gated surface ... capability`, `requiredWhen ... required`, `behavior ... behavior id`, `conformance ... scenario`, `unknown surface`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/contract-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/contract-manifest-types.ts gateway/src/runtime/contract-manifest.ts gateway/tests/unit/runtime/contract-manifest.test.ts
git commit -m "feat(runtime): add contract manifest types and invariant validator"
```

---

### Task 2: Core surfaces (meta/session/branch/process/provider)

**Files:**
- Create: `gateway/src/runtime/contract-surfaces-core.ts`
- Modify: `gateway/src/runtime/contract-manifest.ts`
- Test: `gateway/tests/unit/runtime/contract-manifest.test.ts`

**Interfaces:**
- Consumes: `ContractSurface` from Task 1.
- Produces: `CORE_SURFACES: ContractSurface[]`.

- [ ] **Step 1: Write the failing tests**

Append to `contract-manifest.test.ts`:

```ts
import { CORE_SURFACES } from '../../../src/runtime/contract-surfaces-core';

function surface(id: string) {
  return buildRuntimeContractManifest().surfaces.find((s) => s.id === id);
}

describe('core surfaces', () => {
  it('covers loader metadata as declaration/plugin probes', () => {
    expect(surface('plugin.name')).toMatchObject({ obligation: 'required', verification: 'presence', probe: ['plugin', 'name'] });
    expect(surface('plugin.createRuntime')).toMatchObject({ obligation: 'required', probe: ['plugin', 'createRuntime'] });
    expect(surface('plugin.eventMappings')).toMatchObject({ obligation: 'gated', capability: 'eventStream', probe: ['declaration', 'eventMappings'] });
  });

  it('covers the 11 required session methods', () => {
    for (const id of ['session.create', 'session.promptAsync', 'session.prompt', 'session.messages', 'session.get', 'session.delete', 'session.abort', 'session.list', 'session.todo', 'session.children', 'session.summarize']) {
      expect(surface(id)).toMatchObject({ obligation: 'required', verification: 'presence' });
    }
  });

  it('marks rename optional and branch surfaces gated', () => {
    expect(surface('session.update')).toMatchObject({ obligation: 'optional', probe: ['session', 'update'] });
    expect(surface('branch.fork')).toMatchObject({ obligation: 'gated', capability: 'sessionBranchApi' });
    expect(surface('branch.checkpoint')).toMatchObject({ obligation: 'gated', capability: 'checkpointApi', verification: 'attested' });
  });

  it('marks provider methods conditionally required', () => {
    expect(surface('provider.list')).toMatchObject({
      obligation: 'required',
      requiredWhen: { capabilities: ['providerConfigApi'] },
    });
    expect(surface('provider.config')).toMatchObject({ obligation: 'required', requiredWhen: { capabilities: ['providerConfigApi'] } });
  });

  it('marks health/base-url advisory and process restart gated', () => {
    expect(surface('process.healthCheck')).toMatchObject({ obligation: 'advisory' });
    expect(surface('process.restart')).toMatchObject({ obligation: 'gated', capability: 'agentProcessApi' });
  });

  it('exposes CORE_SURFACES without duplicate ids', () => {
    const ids = CORE_SURFACES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/contract-manifest.test.ts`
Expected: FAIL — `CORE_SURFACES` undefined / surface not found.

- [ ] **Step 3: Implement `CORE_SURFACES` and assemble it**

Create `gateway/src/runtime/contract-surfaces-core.ts` with the exact surface rows from spec §7 (meta/session/branch/process/provider). Use small helpers to keep the data readable:

```ts
const req = (id: string, implementation: string, probe: string[], consumer: string, impact: string): ContractSurface => ({
  id, title: id, direction: 'gateway->runtime', domain: 'session',
  obligation: 'required', verification: 'presence',
  implementation, probe, consumer, impact,
});
```

Then add the rows. Required ids (exact):
`plugin.name`, `plugin.createRuntime`, `plugin.capabilities`, `plugin.eventSource`, `plugin.eventMappings`, `plugin.transformEvent`,
`session.create`, `session.promptAsync`, `session.prompt`, `session.messages`, `session.get`, `session.delete`, `session.abort`, `session.list`, `session.todo`, `session.children`, `session.summarize`,
`session.delete.persisted`, `session.update`, `session.listByDirectory`, `session.worktree`, `session.switchAgent`, `session.switchModel`, `session.setThinkingLevel`, `session.shell`,
`branch.fork`, `branch.revert`, `branch.unrevert`, `branch.diff`, `branch.vcs`, `branch.checkpoint`, `branch.runState`,
`process.getBaseUrl`, `process.healthCheck`, `process.restart`, `process.spawnServe`, `process.killServe`, `process.resolveEventEntry`, `process.activeDialect`,
`provider.list`, `provider.app.agents`, `provider.config`.

Modify `contract-manifest.ts` to spread `CORE_SURFACES` into `surfaces`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/contract-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/contract-surfaces-core.ts gateway/src/runtime/contract-manifest.ts gateway/tests/unit/runtime/contract-manifest.test.ts
git commit -m "feat(runtime): add core contract surfaces"
```

---

### Task 3: Agent surfaces (prompt/events/tools/approval/identity/discovery/mcp/cognition/media/usage)

**Files:**
- Create: `gateway/src/runtime/contract-surfaces-agent.ts`
- Modify: `gateway/src/runtime/contract-manifest.ts`
- Test: `gateway/tests/unit/runtime/contract-manifest.test.ts`

**Interfaces:**
- Consumes: `ContractSurface` from Task 1.
- Produces: `AGENT_SURFACES: ContractSurface[]`.

- [ ] **Step 1: Write the failing tests**

Append:

```ts
import { AGENT_SURFACES } from '../../../src/runtime/contract-surfaces-agent';

describe('agent surfaces', () => {
  it('covers prompt inputs and separates presence from behavior', () => {
    expect(surface('prompt.parts.text')).toMatchObject({ obligation: 'required', verification: 'presence' });
    expect(surface('prompt.parts.file')).toMatchObject({ obligation: 'optional', verification: 'behavior' });
    expect(surface('prompt.result.usage')).toMatchObject({ obligation: 'optional', verification: 'behavior' });
  });

  it('covers event surfaces with presets', () => {
    expect(surface('events.global')).toMatchObject({ obligation: 'required', requiredWhen: { capabilities: ['eventStream'] } });
    expect(surface('events.turn.terminal')).toMatchObject({ obligation: 'optional', presets: expect.arrayContaining(['conversation']) });
    expect(surface('events.part.tool')).toMatchObject({ obligation: 'optional', presets: expect.arrayContaining(['desktop']) });
  });

  it('covers tools and approvals', () => {
    expect(surface('tools.registerTools')).toMatchObject({ obligation: 'required', verification: 'presence' });
    expect(surface('tools.nativeTools')).toMatchObject({ obligation: 'required', verification: 'presence' });
    expect(surface('approval.permissionReply')).toMatchObject({ obligation: 'gated', capability: 'nativeApprovals' });
    expect(surface('approval.permissionList')).toMatchObject({ obligation: 'gated', capability: 'nativeApprovals' });
  });

  it('covers identity/discovery/mcp/cognition/media/usage', () => {
    expect(surface('identity.agents.install')).toMatchObject({ obligation: 'gated', capability: 'agentConfigApi' });
    expect(surface('discovery.list')).toMatchObject({ obligation: 'gated', capability: 'discoveryApi' });
    expect(surface('mcp.list')).toMatchObject({ obligation: 'gated', capability: 'mcpApi' });
    expect(surface('cognition.observe')).toMatchObject({ obligation: 'optional', presets: expect.arrayContaining(['conversation']) });
    expect(surface('media.tools')).toMatchObject({ obligation: 'optional', presets: expect.arrayContaining(['desktop']) });
    expect(surface('usage.event')).toMatchObject({ obligation: 'optional' });
  });

  it('exposes AGENT_SURFACES without duplicate ids', () => {
    const ids = AGENT_SURFACES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/contract-manifest.test.ts`
Expected: FAIL — `AGENT_SURFACES` undefined.

- [ ] **Step 3: Implement `AGENT_SURFACES`**

Create `contract-surfaces-agent.ts` with the rows from spec §7. Required ids (exact):
`prompt.parts.text`, `prompt.parts.file`, `prompt.agent`, `prompt.model`, `prompt.variant`, `prompt.system`, `prompt.thinkingLevel`, `prompt.delivery.steer`, `prompt.expectReply`, `prompt.maxTurns`, `prompt.maxCostUsd`, `prompt.outputSchema`, `prompt.result.finish`, `prompt.result.stopReason`, `prompt.result.usage`,
`events.global`, `events.envelope`, `events.turn.terminal`, `events.part.text`, `events.part.tool`, `events.usage`, `events.compaction`, `events.permission`, `events.question`,
`tools.registerTools`, `tools.nativeTools`, `tools.annotations`, `tools.structuredResult`, `tools.normalizeMessages`, `tools.outOfProcess`,
`approval.permissionReply`, `approval.permissionList`, `approval.question`,
`identity.agents.install`, `identity.agents.remove`, `identity.prompt.agent`,
`discovery.list`, `discovery.loadSkill`,
`mcp.list`, `mcp.connect`, `mcp.disconnect`, `mcp.config.preview`, `mcp.config.apply`, `mcp.config.remove`, `mcp.config.restore`,
`cognition.observe`, `cognition.injectContext`, `cognition.injectSystem`, `cognition.tools`, `cognition.gate`, `cognition.rewrite`,
`media.tools`, `usage.prompt`, `usage.event`.

Modify `contract-manifest.ts` to spread `AGENT_SURFACES` into `surfaces`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/contract-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/contract-surfaces-agent.ts gateway/src/runtime/contract-manifest.ts gateway/tests/unit/runtime/contract-manifest.test.ts
git commit -m "feat(runtime): add agent contract surfaces"
```

---

### Task 4: Capabilities, presets, and event projection

**Files:**
- Create: `gateway/src/runtime/contract-capabilities.ts`
- Create: `gateway/src/runtime/contract-presets.ts`
- Create: `gateway/src/runtime/contract-events.ts`
- Modify: `gateway/src/runtime/contract-manifest.ts`
- Test: `gateway/tests/unit/runtime/contract-manifest.test.ts`

**Interfaces:**
- Consumes: `ContractCapability`, `ContractPreset`, `ContractEvent`, `PresetId` from Task 1; `MAFW_RUNTIME_EVENT_NAMES` from `./mafw-vocabulary`; `EVENT_FLOW_MATRIX` from `./event-flow-matrix`.
- Produces:
  - `CONTRACT_CAPABILITIES: ContractCapability[]`
  - `CONTRACT_PRESETS: ContractPreset[]`
  - `CONTRACT_EVENTS: ContractEvent[]`
  - `buildEventsSection(): ContractEvent[]`

- [ ] **Step 1: Write the failing tests**

Append:

```ts
import { fullCapabilities, minimalCapabilities } from '../../../src/runtime/contract';
import { CONTRACT_CAPABILITIES } from '../../../src/runtime/contract-capabilities';
import { CONTRACT_PRESETS } from '../../../src/runtime/contract-presets';
import { CONTRACT_EVENTS } from '../../../src/runtime/contract-events';
import { MAFW_RUNTIME_EVENT_NAMES } from '../../../src/runtime/mafw-vocabulary';

describe('capabilities, presets, events', () => {
  it('has one capability entry per RuntimeCapabilities key', () => {
    const keys = Object.keys(fullCapabilities()).sort();
    const ids = CONTRACT_CAPABILITIES.map((c) => c.id).sort();
    expect(ids).toEqual(keys);
    for (const key of Object.keys(minimalCapabilities())) {
      expect(CONTRACT_CAPABILITIES.some((c) => c.id === key)).toBe(true);
    }
  });

  it('keeps nativeApprovals as an AND-group of permissionReply', () => {
    const cap = CONTRACT_CAPABILITIES.find((c) => c.id === 'nativeApprovals')!;
    expect(cap.requires).toEqual(['approval.permissionReply']);
    expect(cap.unlocks).toEqual(expect.arrayContaining(['approval.permissionList']));
  });

  it('keeps sessionStorageApi gated on listByDirectory and eventStream declaration-free', () => {
    expect(CONTRACT_CAPABILITIES.find((c) => c.id === 'sessionStorageApi')!.requires).toEqual(['session.listByDirectory']);
    expect(CONTRACT_CAPABILITIES.find((c) => c.id === 'eventStream')!.requires).toEqual([]);
  });

  it('presets reference existing surfaces and declare capabilities', () => {
    const surfaceIds = new Set(buildRuntimeContractManifest().surfaces.map((s) => s.id));
    for (const preset of CONTRACT_PRESETS) {
      for (const id of preset.requiredSurfaces) expect(surfaceIds.has(id)).toBe(true);
      for (const cap of preset.capabilities) expect(Object.keys(fullCapabilities())).toContain(cap);
    }
    expect(CONTRACT_PRESETS.map((p) => p.id)).toEqual(['core', 'conversation', 'autonomous', 'desktop']);
  });

  it('events cover the canonical runtime vocabulary exactly once', () => {
    const types = CONTRACT_EVENTS.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
    for (const type of MAFW_RUNTIME_EVENT_NAMES) expect(types).toContain(type);
  });

  it('event metadata carries family/terminal/requiredFields', () => {
    const turn = CONTRACT_EVENTS.find((e) => e.type === 'turn.completed')!;
    expect(turn.family).toBe('lifecycle');
    expect(turn.terminal).toBe(true);
    expect(turn.requiredFields).toContain('sessionID');
    expect(CONTRACT_EVENTS.find((e) => e.type === 'part.updated')!.family).toBe('message');
    expect(CONTRACT_EVENTS.find((e) => e.type === 'permission.asked')!.family).toBe('approval');
    expect(CONTRACT_EVENTS.find((e) => e.type === 'usage.updated')!.family).toBe('usage');
    expect(CONTRACT_EVENTS.find((e) => e.type === 'session.compacted')!.family).toBe('compaction');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/contract-manifest.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three data modules**

`contract-capabilities.ts`: one entry for each of the 23 keys. `requires`/`unlocks` must reference surface ids from Tasks 2–3. Use `kind`:
- `feature`: eventStream, nativeApprovals, questionApi, diffApi, worktreeApi, checkpointApi, runStateApi, discoveryApi, mcpApi, mcpConfigApi, completionApi, sessionBranchApi, revertUndoApi.
- `transport`: steerApi, instructionsApi.
- `strategy`: sessionStorageApi, agentConfigApi, mcpConfigApi.
- `trust`: turnBudgetApi.
- `informational`: perLlmCallTransform.
- `revertUndoApi`: feature.

`contract-presets.ts`: the four presets from spec §5.3. `core` includes the 11 session surfaces + tools + meta; `conversation` adds `events.global`, `events.turn.terminal`, `events.part.text`, `prompt.result.usage`; `autonomous` adds approvals/questions + `prompt.maxTurns`; `desktop` adds identity/discovery/mcp/branch/cognition/media.

`contract-events.ts`: `buildEventsSection()` maps `MAFW_RUNTIME_EVENT_NAMES` to `ContractEvent` rows. Family mapping by prefix (turn → lifecycle, part/message → message, permission → approval, question → question, plan/run/session.config/session.checkpoint → state, usage → usage, session.compact* → compaction, plugin:* → custom). Required fields: `turn.*` → `['sessionID']`, `part.updated` → `['part']`, `message.updated` → `['message']`, `permission.asked`/`question.asked` → `['requestId','sessionID']`, `session.created/updated` → `['info.id']`. Use `terminal: true` for `turn.completed/failed/aborted`. Set `producers: ['runtime']` for runtime events, `['gateway']` for gateway-synthesized (`usage.updated`, `queue.updated`, `session.config`, `session.checkpoint`, `run.updated`, `task.updated`, `pod.updated`).

Assemble all three in `contract-manifest.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/contract-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/contract-capabilities.ts gateway/src/runtime/contract-presets.ts gateway/src/runtime/contract-events.ts gateway/src/runtime/contract-manifest.ts gateway/tests/unit/runtime/contract-manifest.test.ts
git commit -m "feat(runtime): add contract capabilities, presets, and event metadata"
```

---

### Task 5: Coverage engine

**Files:**
- Create: `gateway/src/runtime/coverage.ts`
- Test: `gateway/tests/unit/runtime/coverage.test.ts`

**Interfaces:**
- Consumes: `RuntimeContractManifest`, `ContractSurface`, `Verification`, `PresetId` from Task 1; `EventMappingEntry` from `./event-mapper`; `AgentRuntime` from `./contract`.
- Produces:
  - `ContractSubject` (see spec §6.7)
  - `RuntimeCoverage`, `SurfaceStatus`, `BehaviorResult`
  - `probePasses(subject: ContractSubject, surface: ContractSurface): boolean`
  - `computeCoverage(subject: ContractSubject, manifest: RuntimeContractManifest): RuntimeCoverage`
  - `applyBehaviorResults(coverage: RuntimeCoverage, results: BehaviorResult[]): RuntimeCoverage`

- [ ] **Step 1: Write the failing tests**

Create `coverage.test.ts`:

```ts
import { computeCoverage, applyBehaviorResults, probePasses, type ContractSubject } from '../../../src/runtime/coverage';
import { buildRuntimeContractManifest } from '../../../src/runtime/contract-manifest';
import { fullCapabilities, minimalCapabilities } from '../../../src/runtime/contract';

function fakeRuntime(over: any = {}) {
  const session: any = {};
  for (const m of ['create', 'promptAsync', 'prompt', 'messages', 'get', 'delete', 'abort', 'list', 'todo', 'children', 'summarize']) session[m] = async () => ({});
  return {
    name: 'fake',
    capabilities: { ...minimalCapabilities(), ...over },
    session,
    global: { event: async () => ({ stream: (async function* () {})() }) },
    provider: { list: async () => ({ all: [], connected: [], default: {} }) },
    app: { agents: async () => [] },
    config: { get: async () => ({}), update: async (c: any) => c },
    tools: { registerTools: async () => {}, nativeTools: () => [] },
    getBaseUrl: () => 'http://127.0.0.1:1',
    ...over,
  } as any;
}

const manifest = buildRuntimeContractManifest();

describe('coverage engine', () => {
  it('marks required presence surfaces present for a full fake runtime', () => {
    const c = computeCoverage({ rt: fakeRuntime(), source: 'active' }, manifest);
    expect(c.static.surfaces['session.create'].status).toBe('present');
    expect(c.static.surfaces['tools.registerTools'].status).toBe('present');
    expect(c.static.surfaces['events.global'].status).toBe('present');
  });

  it('marks a missing gated surface missing without mutating capabilities', () => {
    const rt = fakeRuntime({ capabilities: { ...fullCapabilities(), sessionBranchApi: true } });
    const c = computeCoverage({ rt, source: 'active' }, manifest);
    expect(c.static.surfaces['branch.fork'].status).toBe('missing');
    expect(rt.capabilities.sessionBranchApi).toBe(true);
  });

  it('probes declaration surfaces from the subject declaration bag', () => {
    const rt = fakeRuntime({ capabilities: { ...fullCapabilities(), eventStream: true } });
    const withDecl = computeCoverage({
      rt, source: 'file',
      declaration: { eventSource: { typePath: '$.type' }, eventMappings: [] },
      plugin: { name: 'x', createRuntime: () => {} },
    }, manifest);
    expect(withDecl.static.surfaces['plugin.eventMappings'].status).toBe('present');
    expect(withDecl.static.surfaces['plugin.createRuntime'].status).toBe('present');
    const withoutDecl = computeCoverage({ rt, source: 'file' }, manifest);
    expect(withoutDecl.static.surfaces['plugin.eventMappings'].status).toBe('missing');
  });

  it('keeps attested surfaces unverified', () => {
    const c = computeCoverage({ rt: fakeRuntime({ capabilities: { ...fullCapabilities(), turnBudgetApi: true } }), source: 'active' }, manifest);
    expect(c.static.surfaces['prompt.maxTurns'].status).toBe('unverified');
    expect(c.static.unverified.some((u) => u.id === 'prompt.maxTurns')).toBe(true);
  });

  it('marks cognition surfaces unverified (gateway serves the endpoint)', () => {
    const c = computeCoverage({ rt: fakeRuntime(), source: 'active' }, manifest);
    expect(c.static.surfaces['cognition.observe'].status).toBe('unverified');
  });

  it('applies behavior results without overwriting presence results', () => {
    const c = computeCoverage({ rt: fakeRuntime(), source: 'active' }, manifest);
    const next = applyBehaviorResults(c, [{ surfaceId: 'prompt.result.usage', status: 'failed', detail: 'missing usage' }]);
    expect(next.behavioral?.failed).toContain('prompt.result.usage');
    expect(next.static.surfaces['prompt.result.usage'].status).toBe('unverified');
  });

  it('probePasses supports rt/declaration/plugin prefixes', () => {
    const subject: ContractSubject = {
      rt: fakeRuntime(),
      source: 'file',
      declaration: { eventMappings: [] },
      plugin: { createRuntime: () => {} },
    };
    const s = buildRuntimeContractManifest().surfaces;
    expect(probePasses(subject, s.find((x) => x.id === 'session.create')!)).toBe(true);
    expect(probePasses(subject, s.find((x) => x.id === 'plugin.eventMappings')!)).toBe(true);
    expect(probePasses(subject, s.find((x) => x.id === 'plugin.createRuntime')!)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/coverage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `coverage.ts`**

Implement:
- `probePasses`: split `surface.probe[0]` into `rt` / `declaration` / `plugin`; value must be a function (for methods) or a non-null value (for declarations). Walk the rest of the path null-safely.
- `computeCoverage`: initialize `declared = rt.capabilities`, `effective = { ...rt.capabilities }`; for each surface:
  - if `verification !== 'presence'` → `unverified` with reason (`attested`, `behavior-not-run`, `cognition`);
  - presence + probePasses → `present`; else `missing`.
  - `gated` + capability false → `missing` (do not mutate effective).
  - aggregate presets/obligations/missing/unverified/notes.
- `applyBehaviorResults`: clone coverage, set `behavioral` arrays; do not mutate `static.surfaces`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/coverage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/coverage.ts gateway/tests/unit/runtime/coverage.test.ts
git commit -m "feat(runtime): add contract coverage engine"
```

---

### Task 6: Manifest-driven validation

**Files:**
- Modify: `gateway/src/runtime/validate.ts`
- Test: `gateway/tests/unit/runtime/validate-coverage.test.ts`

**Interfaces:**
- Consumes: `computeCoverage`, `ContractSubject`, `RuntimeCoverage` from Task 5; `buildRuntimeContractManifest` from Task 4.
- Produces: `RuntimeValidation` gains `staticCoverage?: RuntimeCoverage`; `validateRuntime(rt, source, subject?)` where `subject?: Omit<ContractSubject, 'rt'>`.

- [ ] **Step 1: Write the failing tests**

Create `validate-coverage.test.ts`:

```ts
import { validateRuntime } from '../../../src/runtime/validate';
import { fullCapabilities, minimalCapabilities } from '../../../src/runtime/contract';

function fakeRuntime(over: any = {}) {
  const session: any = {};
  for (const m of ['create', 'promptAsync', 'prompt', 'messages', 'get', 'delete', 'abort', 'list', 'todo', 'children', 'summarize']) session[m] = async () => ({});
  return {
    name: 'fake',
    capabilities: { ...minimalCapabilities(), ...over },
    session,
    global: { event: async () => ({}) },
    provider: { list: async () => ({ all: [], connected: [], default: {} }) },
    app: { agents: async () => [] },
    config: { get: async () => ({}), update: async (c: any) => c },
    tools: { registerTools: async () => {}, nativeTools: () => [] },
    getBaseUrl: () => 'http://127.0.0.1:1',
    ...over,
  } as any;
}

describe('manifest-driven validateRuntime', () => {
  it('does not hard-fail global.event when eventStream is false', () => {
    const rt = fakeRuntime({ global: undefined });
    expect(validateRuntime(rt, 'test').hard).toEqual([]);
  });

  it('hard-fails global.event when eventStream is true', () => {
    const rt = fakeRuntime({ capabilities: { ...fullCapabilities(), eventStream: true }, global: undefined });
    expect(validateRuntime(rt, 'test').hard.join('\n')).toMatch(/events\.global/);
  });

  it('hard-fails providerConfigApi sub-methods', () => {
    const rt = fakeRuntime({ capabilities: { ...fullCapabilities(), providerConfigApi: true }, provider: undefined });
    expect(validateRuntime(rt, 'test').hard.join('\n')).toMatch(/provider\.list/);
  });

  it('downgrades a capability only when its requires surface is missing', () => {
    const rt = fakeRuntime({ capabilities: { ...fullCapabilities(), sessionBranchApi: true } });
    const v = validateRuntime(rt, 'test');
    expect(v.downgraded.join('\n')).toMatch(/sessionBranchApi/);
  });

  it('keeps nativeApprovals when permissionReply exists but permissionList is missing', () => {
    const rt = fakeRuntime({
      capabilities: { ...fullCapabilities(), nativeApprovals: true },
      session: { ...fakeRuntime().session, permissionReply: async () => true },
    });
    const v = validateRuntime(rt, 'test');
    expect(v.downgraded.join('\n')).not.toMatch(/nativeApprovals/);
    expect(v.warnings.join('\n')).toMatch(/approval\.permissionList/);
  });

  it('warns for optional session.update but does not downgrade', () => {
    const v = validateRuntime(fakeRuntime(), 'test');
    expect(v.warnings.join('\n')).toMatch(/session\.update/);
    expect(v.staticCoverage?.static.surfaces['session.update'].status).toBe('missing');
  });

  it('returns static coverage', () => {
    const v = validateRuntime(fakeRuntime(), 'test');
    expect(v.staticCoverage?.runtime).toBe('fake');
    expect(v.staticCoverage?.static.surfaces['session.create'].status).toBe('present');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/validate-coverage.test.ts`
Expected: FAIL — `staticCoverage` undefined / old hard behavior.

- [ ] **Step 3: Rewrite `validate.ts` as a manifest projection**

Keep the existing `RuntimeValidation` shape, add `staticCoverage?: RuntimeCoverage`. Implement:
1. Basic shape checks (`rt` object, `name`, `capabilities`).
2. `const subject = { rt, ...optsSubject, source: optsSubject?.source ?? 'active' }`.
3. `const coverage = computeCoverage(subject, buildRuntimeContractManifest())`.
4. For each surface with `verification === 'presence'`:
   - `required` + `requiredWhenSatisfied` + missing → `hard.push(...)` with `surface.id` and `impact`.
   - `gated` + capability true + surface in `capability.requires` + missing → `downgrade(cap, impact)` (write `effectiveCaps` copy once).
   - `gated` + capability true + not in `requires` + missing → `warnings.push(...)`.
   - `optional`/`advisory` missing → `warnings.push(...)`.
5. `attested`/`behavior`/`conformance` → no activation probe; add note to warnings only for attested.
6. Return `{ hard, downgraded, warnings, staticCoverage: coverage }`.

Preserve the current hard checks for `tools.registerTools`/`nativeTools` and `session` core; they are `required` surfaces, so the loop covers them. Keep the `source` prefix in messages.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/validate-coverage.test.ts tests/unit/runtime/validate-shape.test.ts`
Expected: PASS. If existing `validate-shape.test.ts` expectations change, update them only where the spec explicitly changes semantics (no new hard/downgrade for opencode/pi).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/validate.ts gateway/tests/unit/runtime/validate-coverage.test.ts gateway/tests/unit/runtime/validate-shape.test.ts
git commit -m "feat(runtime): drive activation validation from contract manifest"
```

---

### Task 7: Gateway wiring + `GET /api/runtime/contract`

**Files:**
- Modify: `gateway/src/index.ts` (runtime coverage field; `applyRuntimeValidation` signature/call sites; `runtimeDeps`)
- Modify: `gateway/src/routes/runtime-switch.ts` (`contract` deps + handler + coverage in GET)
- Modify: `gateway/src/routes/wave2-handlers.ts` (attach `runtime.contract`)
- Modify: `gateway/src/routes/route-catalog.ts` (register route)
- Test: `gateway/tests/unit/runtime/runtime-contract-route.test.ts`

**Interfaces:**
- Consumes: `RuntimeContractManifest` from Task 4; `RuntimeCoverage` from Task 5; `RuntimeValidation.staticCoverage` from Task 6.
- Produces:
  - `RuntimeSwitchDeps.contract?: () => { manifest: RuntimeContractManifest; coverage: RuntimeCoverage | null }`
  - `handleRuntimeContract(req, res, deps)` in `routes/runtime-switch.ts`
  - `GET /api/runtime` response gains `active.coverage`
  - route catalog entry `runtime.contract`

- [ ] **Step 1: Write the failing route tests**

Create `runtime-contract-route.test.ts`:

```ts
import { handleRuntimeContract, handleRuntimeGet } from '../../../src/routes/runtime-switch';
import { buildRuntimeContractManifest } from '../../../src/runtime/contract-manifest';

function fakeRes() {
  const out: any = { status: 0, body: '' };
  out.writeHead = (s: number) => { out.status = s; };
  out.end = (b: string) => { out.body = b; };
  return out;
}

const coverage = { runtime: 'fake', contractVersion: '2026.10.0', static: { declared: {}, effective: {}, presets: {}, obligations: {}, surfaces: {}, missing: [], unverified: [], notes: [] } };

describe('runtime contract routes', () => {
  it('GET /api/runtime includes active.coverage', async () => {
    const res = fakeRes();
    await handleRuntimeGet({} as any, res as any, {
      runtimeName: () => 'fake',
      runtimeCaps: () => ({ sessionApi: true }),
      envOverride: () => false,
      contractCoverage: () => coverage,
    } as any);
    expect(JSON.parse(res.body).active.coverage).toEqual(coverage);
  });

  it('GET /api/runtime/contract returns manifest + coverage', async () => {
    const res = fakeRes();
    await handleRuntimeContract({} as any, res as any, {
      contract: () => ({ manifest: buildRuntimeContractManifest(), coverage }),
    } as any);
    const body = JSON.parse(res.body);
    expect(body.manifest.schemaVersion).toBe(1);
    expect(body.coverage).toEqual(coverage);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/runtime-contract-route.test.ts`
Expected: FAIL — `handleRuntimeContract` not exported / coverage missing.

- [ ] **Step 3: Implement the handler and wiring**

`routes/runtime-switch.ts`:
```ts
export interface RuntimeSwitchDeps {
  ...
  /** Active runtime coverage (GET /api/runtime.active.coverage). */
  contractCoverage?: () => RuntimeCoverage | null;
  /** Contract manifest + coverage for GET /api/runtime/contract. */
  contract?: () => { manifest: RuntimeContractManifest; coverage: RuntimeCoverage | null };
}

export async function handleRuntimeContract(_req, res, deps: Pick<RuntimeSwitchDeps, 'contract'>): Promise<void> {
  if (!deps.contract) { res.writeHead(503, ...); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(deps.contract()));
}
```
`handleRuntimeGet` adds `coverage: deps.contractCoverage ? deps.contractCoverage() : null` under `active`.

`wave2-handlers.ts`: import `handleRuntimeContract`; attach `registry.attachHandler('runtime.contract', H(async (req,res) => handleRuntimeContract(req,res, gw.runtimeDeps())))`.

`route-catalog.ts`: add `{ method: 'GET', path: '/api/runtime/contract', operationId: 'runtime.contract', tags: ['runtime'] }` near the other runtime routes.

`index.ts`:
- Add `private runtimeCoverage: RuntimeCoverage | null = null;`
- Change `applyRuntimeValidation(rt, source, fatal, subject?: Omit<ContractSubject,'rt'>): RuntimeValidation`; call `validateRuntime(rt, source, subject)`, store `this.runtimeCoverage = v.staticCoverage ?? null`, keep logging.
- In `activatePluginRuntime`, build subject from `plugin`:
  ```ts
  const subject = {
    declaration: { eventSource: plugin.eventSource, eventMappings: plugin.eventMappings, transformEvent: plugin.transformEvent },
    plugin: { name, createRuntime: plugin.createRuntime, external: plugin.external },
    dialect: (rt as any).activeDialect,
    source: 'active' as const,
  };
  this.applyRuntimeValidation(rt, name, fatal, subject);
  ```
- In fallback/direct path, pass `{ plugin: { name: 'opencode', createRuntime: undefined, external }, source: 'active' }`.
- `runtimeDeps()` adds:
  ```ts
  contractCoverage: () => this.runtimeCoverage,
  contract: () => ({ manifest: buildRuntimeContractManifest(), coverage: this.runtimeCoverage }),
  ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/runtime-contract-route.test.ts tests/unit/runtime/validate-coverage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/index.ts gateway/src/routes/runtime-switch.ts gateway/src/routes/wave2-handlers.ts gateway/src/routes/route-catalog.ts gateway/tests/unit/runtime/runtime-contract-route.test.ts
git commit -m "feat(runtime): expose contract manifest and coverage"
```

---

### Task 8: SDK client + OpenAPI route

**Files:**
- Create: `packages/gateway-sdk/src/runtime-contract.ts`
- Modify: `packages/gateway-sdk/src/client.ts` (runtime namespace)
- Modify: `gateway/src/routes/route-catalog.ts` (already in Task 7; verify)
- Generated: `packages/gateway-sdk/contract/gateway-paths.json`, `packages/gateway-sdk/contract/openapi.json`, `packages/gateway-sdk/src/api-schema.gen.ts`
- Test: `packages/gateway-sdk/src/client.test.ts`, `packages/gateway-sdk/src/types.test.ts`

**Interfaces:**
- Consumes: `RuntimeContractManifest`, `RuntimeCoverage` JSON shape from Task 4/5.
- Produces: `runtime.contract(): Promise<{ manifest: RuntimeContractManifest; coverage: RuntimeCoverage | null }>`.

- [ ] **Step 1: Write the failing SDK tests**

In `client.test.ts`, add a test next to the existing `runtime.get + runtime.switch hit their routes` test (around line 804). The file already has a module-level `fetchMock` and `okJson` helper; use them:

```ts
test("runtime.contract hits /api/runtime/contract", async () => {
  fetchMock.mockResolvedValue(okJson({ manifest: { schemaVersion: 1 }, coverage: null }))
  const c = new MafwClient()
  const res = await c.runtime.contract()
  expect((fetchMock as any).mock.calls[0][0]).toContain("/api/runtime/contract")
  expect(res.manifest.schemaVersion).toBe(1)
})
```

In `types.test.ts` add `expect(typeof c.runtime.contract).toBe("function")` next to the existing `runtime.get` assertion (line ~100).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/gateway-sdk && npm test`
Expected: FAIL — `runtime.contract` is not a function.

- [ ] **Step 3: Implement the SDK types and method**

Create `packages/gateway-sdk/src/runtime-contract.ts` with the JSON DTOs (mirror of the gateway types; keep `$schema`/`$comment` out). At minimum:
```ts
export interface RuntimeContractManifest {
  schemaVersion: number
  contractVersion: string
  generatedFrom: string
  domains: Array<{ id: string; title: string; description: string }>
  surfaces: Array<Record<string, unknown>>
  capabilities: Array<Record<string, unknown>>
  events: Array<Record<string, unknown>>
  cognition: Array<Record<string, unknown>>
  presets: Array<Record<string, unknown>>
}
export interface RuntimeCoverage {
  runtime: string
  contractVersion: string
  static: Record<string, unknown>
  behavioral?: Record<string, unknown>
}
export interface RuntimeContractResponse {
  manifest: RuntimeContractManifest
  coverage: RuntimeCoverage | null
}
```
Add to `client.ts`:
```ts
contract: async (): Promise<import('./runtime-contract').RuntimeContractResponse> => {
  return this.request('/api/runtime/contract')
},
```
Run:
```bash
cd gateway && npm run emit:openapi
cd packages/gateway-sdk && npm run gen:api
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/gateway-sdk && npm test`
Expected: PASS. Also run `cd gateway && npx jest --runInBand tests/unit/api-contract.test.ts` to confirm the catalog/OpenAPI freshness.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway-sdk/src/runtime-contract.ts packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/client.test.ts packages/gateway-sdk/src/types.test.ts packages/gateway-sdk/contract/gateway-paths.json packages/gateway-sdk/contract/openapi.json packages/gateway-sdk/src/api-schema.gen.ts
git commit -m "feat(sdk): add runtime.contract client method"
```

---

### Task 9: JSON emit + schema + freshness

**Files:**
- Create: `gateway/scripts/emit-runtime-contract.ts`
- Create: `packages/gateway-sdk/contract/runtime-contract.json` (generated)
- Create: `packages/gateway-sdk/contract/runtime-contract.schema.json`
- Modify: `gateway/package.json` (script `emit:runtime-contract`)
- Test: `gateway/tests/unit/runtime/contract-manifest-freshness.test.ts`

**Interfaces:**
- Consumes: `buildRuntimeContractManifest()` from Task 4; `validateJsonSchema` from `src/runtime/json-schema`.
- Produces: the JSON artifact + schema; `npm run emit:runtime-contract`.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildRuntimeContractManifest } from '../../../src/runtime/contract-manifest';
import { validateJsonSchema } from '../../../src/runtime/json-schema';

const CONTRACT = join(__dirname, '..', '..', '..', '..', 'packages', 'gateway-sdk', 'contract', 'runtime-contract.json');
const SCHEMA = join(__dirname, '..', '..', '..', '..', 'packages', 'gateway-sdk', 'contract', 'runtime-contract.schema.json');

describe('runtime contract JSON freshness', () => {
  it('checked-in JSON matches the TypeScript source', () => {
    const raw = JSON.parse(readFileSync(CONTRACT, 'utf-8'));
    const { $comment, $schema, ...manifest } = raw;
    expect(manifest).toEqual(buildRuntimeContractManifest());
  });

  it('schema validates the manifest', () => {
    const schema = JSON.parse(readFileSync(SCHEMA, 'utf-8'));
    expect(validateJsonSchema(schema, buildRuntimeContractManifest())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/contract-manifest-freshness.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Implement the emitter and schema**

`gateway/scripts/emit-runtime-contract.ts`:
```ts
import * as fs from 'fs';
import * as path from 'path';
import { buildRuntimeContractManifest } from '../src/runtime/contract-manifest';

const out = {
  $comment: 'Auto-generated by gateway/scripts/emit-runtime-contract.ts from gateway/src/runtime/contract-manifest.ts — do not edit by hand; rerun the script after manifest changes.',
  $schema: './runtime-contract.schema.json',
  ...buildRuntimeContractManifest(),
};
const dest = path.join(__dirname, '..', '..', 'packages', 'gateway-sdk', 'contract', 'runtime-contract.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', 'utf-8');
console.log(`[emit-runtime-contract] ${out.surfaces.length} surfaces → ${path.relative(process.cwd(), dest)}`);
```
Add to `gateway/package.json`:
```json
"emit:runtime-contract": "ts-node --project tsconfig.json scripts/emit-runtime-contract.ts"
```
Write a flat schema (no `$ref`/`$defs`, so `validateJsonSchema` can consume it): top-level `type: object`, `required: [schemaVersion, contractVersion, generatedFrom, domains, surfaces, capabilities, events, cognition, presets]`, `properties` with arrays and minimal item shapes (`additionalProperties: true`).

Run: `cd gateway && npm run emit:runtime-contract`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/contract-manifest-freshness.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/scripts/emit-runtime-contract.ts gateway/package.json gateway/tests/unit/runtime/contract-manifest-freshness.test.ts packages/gateway-sdk/contract/runtime-contract.json packages/gateway-sdk/contract/runtime-contract.schema.json
git commit -m "feat(runtime): emit versioned runtime contract JSON"
```

---

### Task 10: Claude adapter static coverage acceptance

**Files:**
- Create: `gateway/tests/unit/runtime/claude-adapter-coverage.test.ts`
- Reference: `gateway/tests/unit/runtime/claude-adapter-acceptance.test.ts` (esbuild bundling pattern)

**Interfaces:**
- Consumes: `RuntimePluginLoader` from `src/runtime/loader`; `computeCoverage` from Task 5; `buildRuntimeContractManifest` from Task 4; `createClaudeRuntime` from `adapters/claude/src/runtime`.
- Produces: a coverage test proving the claude gaps are visible.

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { build } from 'esbuild';
import { RuntimePluginLoader } from '../../../src/runtime/loader';
import { computeCoverage } from '../../../src/runtime/coverage';
import { buildRuntimeContractManifest } from '../../../src/runtime/contract-manifest';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

describe('claude adapter static coverage', () => {
  it('lists the documented missing surfaces', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-coverage-'));
    await build({
      entryPoints: [join(REPO_ROOT, 'adapters/claude/src/index.ts')],
      bundle: true, platform: 'node', target: 'node22', format: 'cjs',
      define: { 'import.meta.url': '__filename' },
      outfile: join(dir, 'claude.js'), logLevel: 'silent',
    });
    const loader = new RuntimePluginLoader(dir);
    loader.setCanonicalTypes(new Set(Object.keys((await import('../../../src/runtime/event-flow-matrix')).EVENT_FLOW_MATRIX)));
    await loader.scan();
    const entry = loader.get('claude')!;
    const rt = await entry.createRuntime({} as any);
    const coverage = computeCoverage({
      rt, source: 'file',
      declaration: { eventSource: entry.eventSource, eventMappings: entry.eventMappings, transformEvent: entry.transformEvent },
      plugin: { name: 'claude', createRuntime: entry.createRuntime, external: entry.external },
    }, buildRuntimeContractManifest());
    const missing = coverage.static.missing.map((m) => m.id);
    expect(missing).toEqual(expect.arrayContaining([
      'session.update', 'branch.fork', 'branch.diff',
      'approval.permissionReply', 'discovery.list', 'mcp.list', 'identity.agents.install',
    ]));
    expect(coverage.static.surfaces['session.create'].status).toBe('present');
    rmSync(dir, { recursive: true, force: true });
  }, 120_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/claude-adapter-coverage.test.ts`
Expected: FAIL — coverage/missing modules not found or claude gaps not listed.

- [ ] **Step 3: Implement the test harness**

Use the esbuild pattern from `claude-adapter-acceptance.test.ts`. If `entry.createRuntime` needs a fake ctx, pass the same fake as the acceptance test (`fetch`, `log`, `pluginConfig`, `gatewayPort`, `events`). The claude `createRuntime` imports the real SDK; bundle includes it, but `create` does not spawn, so the test is offline.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/claude-adapter-coverage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/unit/runtime/claude-adapter-coverage.test.ts
git commit -m "test(runtime): score claude adapter against contract coverage"
```

---

### Task 11: Claude adapter fake-SDK behavior probes

**Files:**
- Create: `gateway/tests/unit/runtime/claude-adapter-behavior.test.ts`
- Reference: `adapters/claude/tests/runtime.test.ts` (fake SDK pattern)

**Interfaces:**
- Consumes: `createClaudeRuntime` from `adapters/claude/src/runtime`; `applyBehaviorResults` from Task 5.
- Produces: deterministic behavior results for `prompt.result.usage`, `prompt.parts.file`, `tools.registerTools`, `session.delete.persisted`, `session.todo/children/summarize`.

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { build } from 'esbuild';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
let createClaudeRuntime: any;
let bundleDir: string;

beforeAll(async () => {
  bundleDir = mkdtempSync(join(tmpdir(), 'claude-behavior-'));
  const outfile = join(bundleDir, 'runtime.js');
  await build({
    entryPoints: [join(REPO_ROOT, 'adapters/claude/src/runtime.ts')],
    bundle: true, platform: 'node', target: 'node22', format: 'cjs',
    outfile, logLevel: 'silent',
  });
  createClaudeRuntime = require(outfile).createClaudeRuntime;
}, 120_000);

afterAll(() => {
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

function fakeSdk(script: any[] = []) {
  const calls: any[] = [];
  return {
    calls,
    async query(args: any) {
      calls.push(args);
      const messages = script;
      return {
        async *[Symbol.asyncIterator]() { for (const m of messages) yield m; },
        interrupt() {},
      };
    },
    async listSessions() { return []; },
    async getSessionMessages() { return [{ uuid: 'a1', role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]; },
  };
}

describe('claude adapter behavior gaps', () => {
  it('detects missing prompt usage and dropped media parts', async () => {
    const sdk = fakeSdk([{ type: 'result', subtype: 'success', session_id: 'S', usage: { input_tokens: 3 }, total_cost_usd: 0.01 }]);
    const rt = createClaudeRuntime({ sdk: sdk as any });
    const s = await rt.session.create({ directory: 'C:/tmp/proj' });
    const result = await rt.session.prompt({ sessionID: s.id, parts: [{ type: 'file', url: 'data:image/png;base64,AA==', mime: 'image/png' }] });
    await new Promise((r) => setTimeout(r, 10)); // prompt() returns before spawn() awaits query()
    expect(result.usage).toBeUndefined();
    expect(sdk.calls[0].prompt).toBe('');
    expect(rt.session.children).toBeDefined();
    expect(await rt.session.children({ sessionID: s.id })).toEqual([]);
  });

  it('detects the MCP stub in registerTools', async () => {
    const sdk = fakeSdk();
    const rt = createClaudeRuntime({ sdk: sdk as any });
    const s = await rt.session.create({ directory: 'C:/tmp/proj' });
    await rt.tools.registerTools(() => [{ name: 'x', description: 'x', parameters: {}, execute: async () => ({ text: 'ok' }) }]);
    await rt.session.prompt({ sessionID: s.id, message: 'hi' });
    await new Promise((r) => setTimeout(r, 10));
    const mcp = sdk.calls[0].options.mcpServers?.mafw;
    expect(mcp?.__mafwStub).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/claude-adapter-behavior.test.ts`
Expected: FAIL — behavior expectations not met (or import path).

- [ ] **Step 3: Add a `runClaudeBehaviorProbes()` helper**

Create `adapters/claude/tests/behavior-probes.ts` (or put it in the test) that returns a `BehaviorResult[]` with the expected failed surface ids. Do not change the adapter's runtime behavior in this task; the point is to prove the gaps are detectable. If the adapter's `prompt` returns before the query finishes, use `promptAsync` + wait for `turn.completed` to inspect usage; keep the test deterministic with the fake SDK.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/claude-adapter-behavior.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/unit/runtime/claude-adapter-behavior.test.ts
git commit -m "test(runtime): add claude fake-SDK behavior probes"
```

---

### Task 12: Document the coverage manifest for plugin authors

**Files:**
- Modify: `.opencode/skills/runtime-plugin-authoring/SKILL.md`
- Test: `gateway/tests/unit/runtime/session-dir-docs.test.ts` style docs test (create `runtime-contract-docs.test.ts`)

**Interfaces:**
- Consumes: `buildRuntimeContractManifest()` from Task 4.
- Produces: a docs test that fails if the authoring guide references a surface id that does not exist.

- [ ] **Step 1: Write the failing docs test**

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildRuntimeContractManifest } from '../../../src/runtime/contract-manifest';

describe('runtime plugin authoring docs', () => {
  it('only references known contract surface ids', () => {
    const doc = readFileSync(join(__dirname, '..', '..', '..', '..', '.opencode', 'skills', 'runtime-plugin-authoring', 'SKILL.md'), 'utf-8');
    const ids = new Set(buildRuntimeContractManifest().surfaces.map((s) => s.id));
    const referenced = [...doc.matchAll(/`((?:plugin|session|branch|process|provider|prompt|events|tools|approval|identity|discovery|mcp|cognition|media|usage)\.[a-z0-9.]+)`/g)].map((m) => m[1]);
    for (const id of referenced) expect(ids.has(id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/runtime-contract-docs.test.ts`
Expected: FAIL — new doc references are absent or ids mismatch.

- [ ] **Step 3: Add the authoring section**

Add a short “覆盖清单（Coverage Manifest）” section near “第一步：理解能力分级”, with:
- Where the JSON lives (`packages/gateway-sdk/contract/runtime-contract.json`);
- How to read `surfaces[].obligation/verification/impact`;
- The four presets and the command to check coverage (`GET /api/runtime/contract` for now; `mafw plugin-check` is P2);
- A note that `behavior`/`conformance` surfaces are not verified at activation.

Keep the old Tier table for now, but mark it as legacy and point to the manifest as the source of truth. Do not paste the full surface list (the JSON is the list).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/runtime/runtime-contract-docs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .opencode/skills/runtime-plugin-authoring/SKILL.md gateway/tests/unit/runtime/runtime-contract-docs.test.ts
git commit -m "docs(runtime): document coverage manifest for plugin authors"
```

---

## Final verification

- [ ] `cd gateway && npx tsc --noEmit -p tsconfig.json` → rc=0.
- [ ] `cd gateway && npx jest --runInBand` → all suites pass.
- [ ] `cd packages/gateway-sdk && npm test` → all tests pass.
- [ ] `cd gateway && npm run emit:runtime-contract && npx jest --runInBand tests/unit/runtime/contract-manifest-freshness.test.ts` → PASS.
- [ ] `cd gateway && npm run emit:openapi && cd ../packages/gateway-sdk && npm run gen:api && cd ../.. && git diff --stat` → only expected generated files changed.
- [ ] `GET /api/runtime/contract` and `GET /api/runtime` smoke (start gateway or use handler tests) → manifest + `active.coverage` present.

## Follow-up plans (not in this plan)

1. **P2 live conformance expansion**: `ScenarioDef.covers`, approval/discovery/branch/media/usage scenarios, `behavioral` coverage populated by `POST /api/runtime/conformance`.
2. **P2 `mafw plugin-check` CLI**: `[name]` + `--module <path>`, deterministic API probes, exit code on required failure.
3. **P1 Config UI**: `packages/desktop/src/renderer/mafw/runtime-coverage.ts` + `RuntimeCoverageCard` in Config → Runtime card.
4. **P2 docs generation**: replace the legacy Tier table with a generated table from the manifest.
5. **P3 `mafw plugin-init`**: scaffold from a preset.

## Self-review notes

- Spec coverage: P0/P1 backend, SDK, JSON, claude static/behavior, docs are covered. Config UI, live conformance, CLI, and generated docs are explicitly deferred.
- Type consistency: `ContractSubject` is defined once in Task 5 and used by `validate.ts` Task 6 and `runtimeDeps` Task 7; `RuntimeCoverage` is defined in Task 5 and used by the route/SDK tasks.
- Review Focus items each map to a test: declaration (Task 5), nativeApprovals (Task 6), providerConfigApi (Task 6), eventStream (Task 6 + Task 10), attested (Task 5), behavior vs presence (Task 11).
