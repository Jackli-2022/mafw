# Neutral Runtime Plan 3 — opencode definition + v2 channels

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive opencode through the neutral `RuntimeDefinition` + `RuntimeBus` path (all four dialect names), with v2 channels (MCP / discovery / instructions / PTY / checkpoint / background) carrying real typed payloads instead of `unknown`.

**Architecture:** Mirror Plan 2's shape: keep the opencode implementation in the gateway, wrap it with the generic adapter bridge, and register definitions from the composition root. The dialect entry is resolved once at definition creation (adaptive) or pinned per variant; the bridge translates then reverse-maps, so the bus and mapper stay the single canonical seam. v2 channel types move from structural placeholders to concrete neutral DTOs.

**Tech Stack:** TypeScript, Jest (gateway), node:test (`packages/runtime-contract`), npm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-09-neutral-runtime-driver-architecture-design.md`

## Sequencing

- Plan 1 (merged `3bd61e8b`): kernel + claude.
- Plan 2 (merged `774879b9`): `runtime-core`, pi definition, production switch for pi.
- **Plan 3 (this file)**: opencode definition + v2 channels. Physical adapter packages (`adapters/pi`, `adapters/opencode`) remain in Plan 4 with legacy deletion, because opencode's runtime imports `serve-sidecar` / `provider-settings` / `auth` / `pty` / `agent-definition` / `config`.
- Plan 4: delete legacy (`legacy/`, `pi-events`, `createRuntime` shims), CI guards, frontend/DTO neutralization, optional package extraction.

## Global Constraints

- ABI: `api: 1`, `eventApi: 1`; no second ABI.
- No `native` branch; kernel files stay free of runtime names.
- Adapter-owned details (dialect probe, MCP JSONC, PTY frames, instructions entries) stay behind channels.
- Every change must pass: gateway full jest (`--forceExit`), `npm run test:contract`, gateway `tsc` (cwd=gateway), root build.

## Review Focus

1. **方言漂移**：adaptive 名称必须在激活时解析一次真实方言；解析失败回退 `@v1`，不得让 v2 原生流走 v1 映射（`message.updated` 全丢）。
2. **能力-实现一致**：opencode 全能力表（`mcpConfigApi` / `instructionsApi` / `pty` / `checkpointApi` / `background`）必须都能在定义上找到对应通道，`validateRuntime` 不得 hard-fail。
3. **v2 载荷保真**：MCP 服务器列表、instructions entries、PTY 会话信息经通道往返后字段不丢（桌面 Config / 终端依赖字段名）。
4. **回合归属**：opencode 忙碌时 `delivery:'steer'` 仍走网关队列语义；minted turn id 必须覆盖 native id。
5. **缺通道中性降级**：没有 `pty`/`mcp` 的 runtime 仍返回 503，不得因 v2 类型收紧而出现 undefined 崩溃。

---

### Task 1: v2 channel concrete types

**Files:**
- Modify: `packages/runtime-contract/src/channels.ts`
- Modify: `packages/runtime-contract/src/index.ts`
- Test: `packages/runtime-contract/src/channels-v2.test.ts` (create)

**Interfaces:**
- Produces: `RuntimeMcpStatus`, `RuntimeMcpServer`, `RuntimeMcpChannel`, `RuntimeDiscoveryCommand`, `RuntimeDiscoverySkill`, `RuntimeDiscoveryResult`, `RuntimeDiscoveryChannel`, `RuntimeInstructionEntry`, `RuntimePtyInfo`, `RuntimePtyConnection`, `RuntimePtyChannel`, `RuntimeSnapshotTreeChannel`, `RuntimeBackgroundChannel`; `RuntimeChannelsV2` fields typed with them.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```ts
test('v2 channels accept concrete payloads', async () => {
  const def = defineRuntime({
    api: 1, name: 'x', displayName: 'X', preset: 'core', transport,
    channelsV2: {
      mcp: { list: async () => [{ name: 'mafw', status: 'connected', type: 'remote' }] },
      discovery: { list: async () => ({ commands: [], skills: [], warnings: [] }) },
      instructions: { list: async () => [], put: async () => {}, remove: async () => {} },
      pty: { create: async () => ({ id: 'p1' }), connect: async () => ({ id: 'p1', url: 'ws://x' }), resize: async () => {}, remove: async () => {} },
      checkpoint: { snapshotTree: async () => null },
      background: { toBackground: async () => {} },
    },
  });
  assert.equal((await def.channelsV2!.mcp!.list())[0].status, 'connected');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc --noEmit --strict --esModuleInterop --allowImportingTsExtensions --module commonjs --moduleResolution node --target ES2022 --skipLibCheck packages/runtime-contract/src/channels-v2.test.ts`
Expected: FAIL — `status`/`url` not in the placeholder types.

- [ ] **Step 3: Type the channels**

Replace `unknown` payloads with the DTOs above. Keep all methods optional except `mcp.list`/`instructions.list|put|remove`; PTY frames stay `unknown` (`decodeInbound`/`encodeInput`), only metadata is typed. `defineRuntime` does not derive new capability bits from v2 methods (capabilities stay explicit).

- [ ] **Step 4: Run tests + build**

Run: `npm run test:contract`, `npm run build -w @mafw/runtime-contract`
Expected: pass, rc=0.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime-contract
git commit -m "feat(runtime-contract): type the v2 runtime channels"
```

---

### Task 2: opencode definition (four dialect names)

**Files:**
- Create: `gateway/src/runtime/opencode-definition.ts`
- Modify: `gateway/src/index.ts`（registration）, `gateway/src/runtime/loader.ts`（no change expected）
- Test: `gateway/tests/unit/runtime/opencode-definition.test.ts`

**Interfaces:**
- Produces:

```ts
export type OpencodeVariant = 'adaptive' | 'v1' | 'v2' | 'v21';
export interface OpencodeDefinitionOptions { variant: OpencodeVariant; baseUrl: string; headers?: Record<string, string> }
export async function createOpencodeDefinition(opts: OpencodeDefinitionOptions): Promise<RuntimeDefinition>
```

- Consumes: `createOpencodeRuntime`, `toRuntimeDefinition`, `fullCapabilities`, `probeOpencodeDialect`, native entry constants.

- [ ] **Step 1: Write the failing test**

```ts
it('builds an adaptive definition and resolves the dialect once', async () => {
  const def = await createOpencodeDefinition({ variant: 'adaptive', baseUrl: 'http://127.0.0.1:4096' }, { runtime: fakeRuntime({ dialect: 'v2' }) });
  expect(def.name).toBe('opencode');
  expect(def.capabilities.mcpApi).toBe(true);
  expect((def as any).translate.entry.eventMappings.length).toBeGreaterThan(0);
});

it('pins v21 mappings for the v21 variant', async () => {
  const def = await createOpencodeDefinition({ variant: 'v21', baseUrl: 'http://x' }, { runtime: fakeRuntime() });
  expect((def as any).translate.entry.eventSource.typePath).toBe('$.type');
});

it('falls back to v1 when the dialect probe fails', async () => { /* probe rejects → v1 entry */ });
```

Test seam: second argument `deps?: { runtime?: AgentRuntime; probe?: () => Promise<'v1'|'v2'> }`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/runtime/opencode-definition.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

- `adaptive`: `dialectProbe: true`; entry = `await runtime.resolveEventEntry?.()`; on throw → `OPENCODE_V1_EVENT_MAPPINGS`.
- `v1`/`v2`/`v21`: pinned entries; `dialectProbe: false`.
- capabilities: `fullCapabilities()`; when `MAFW_SERVER_SERVE_URL` set → `agentProcessApi: false`; v1/v2 → `instructionsApi: false`, `discoveryApi: false`.
- `external: !!process.env.MAFW_SERVER_SERVE_URL`.
- `translate: { entry, isCanonical }`.

- [ ] **Step 4: Register definitions in `index.ts`**

Replace the four `registerBuiltin(...)` calls with `registerBuiltinDefinition(name, () => createOpencodeDefinition({ variant, ...sdkSnapshot }), { external, capabilities })`; keep names `opencode`, `opencode@v1`, `opencode@v2`, `opencode@v21`. Keep `sdkSnapshot` header cloning.

- [ ] **Step 5: Run tests**

Run: `npx jest tests/unit/runtime/opencode-definition.test.ts tests/unit/routes/runtime-switch.test.ts --runInBand --forceExit`、`npx tsc --noEmit -p tsconfig.json`（cwd=gateway）
Expected: pass, rc=0.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/runtime/opencode-definition.ts gateway/src/index.ts gateway/tests/unit/runtime/opencode-definition.test.ts
git commit -m "feat(gateway): add the opencode neutral definition"
```

---

### Task 3: golden replay — raw fixture, old path vs neutral path

**Files:**
- Test: `gateway/tests/unit/runtime/opencode-neutral-golden.test.ts`

**Interfaces:**
- Consumes: `tests/fixtures/events/runtime-raw-session.jsonl`, `applyEventMappings`, `toRuntimeDefinition`, `RuntimeBus`.

- [ ] **Step 1: Write the failing test**

```ts
const raw = readJsonl('tests/fixtures/events/runtime-raw-session.jsonl');
const entry = { eventSource: OPENCODE_EVENT_SOURCE, eventMappings: OPENCODE_V1_EVENT_MAPPINGS, transformEvent: OPENCODE_TRANSFORM_EVENT };
const legacy = raw.flatMap((e) => applyEventMappings(e, entry, (t) => !!EVENT_FLOW_MATRIX[t]));

it('neutral replay reproduces the translated sequence', async () => {
  const neutral = await replayThroughDefinition(raw, entry);
  expect(neutral.map((e) => e.payload.type)).toEqual(legacy.map((e) => e.payload.type));
  expect(neutral.map((e) => e.sessionID)).toEqual(legacy.map((e) => e.sessionID));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/runtime/opencode-neutral-golden.test.ts --runInBand --forceExit`
Expected: FAIL — module/test missing.

- [ ] **Step 3: Implement the replay helper in the test**

Fake runtime's `global.event()` yields the raw fixture lines; definition via `toRuntimeDefinition(..., { translate: { entry, isCanonical } })`; register on a bus; collect canonical; wait until count reaches legacy length (2s timeout).

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/runtime/opencode-neutral-golden.test.ts --runInBand --forceExit`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/unit/runtime/opencode-neutral-golden.test.ts
git commit -m "test: pin opencode neutral replay against the translated fixture"
```

---

### Task 4: v2 surface parity (MCP / discovery / instructions / PTY / checkpoint / background)

**Files:**
- Test: `gateway/tests/unit/runtime/opencode-v2-parity.test.ts`

**Interfaces:**
- Consumes: `createNeutralRuntime`, `toRuntimeDefinition`.

- [ ] **Step 1: Write the failing test**

```ts
it('exposes every v2 surface on the neutral runtime', async () => {
  const rt = neutralize(fakeRuntime({
    mcp: { list: async () => [{ name: 'mafw', status: 'connected' }], connect: async () => true, disconnect: async () => true },
    discovery: { list: async () => ({ commands: [{ name: 'goal' }], skills: [], warnings: [] }) },
    snapshotTree: { locate: async () => null },
    pty: { create: async () => ({ id: 'p1' }), connect: async () => ({ id: 'p1', url: 'ws://x' }) },
    instructions: { list: async () => [{ key: 'mafw.memory-guide', value: { text: 'g' } }] },
    background: { toBackground: async () => {} },
  }));
  expect((await rt.mcp!.list())[0].status).toBe('connected');
  expect((await rt.discovery!.list({ directory: '/p' })).commands[0].name).toBe('goal');
  expect((await rt.session.instructions!.list('s1'))[0].key).toBe('mafw.memory-guide');
  expect(await rt.pty!.connect({ id: 'p1' })).toMatchObject({ url: 'ws://x' });
  expect(await rt.snapshotTree!.locate({ start: 'a', end: 'b' })).toBeNull();
  await rt.session.background!({ sessionID: 's1' });
});

it('passes validateRuntime with the opencode capability set', async () => { /* hard === [] */ });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/runtime/opencode-v2-parity.test.ts --runInBand --forceExit`
Expected: FAIL — surface missing / module missing.

- [ ] **Step 3: Fix whatever the test exposes**

Expected gaps: `snapshotTree.locate` naming (`channelsV2.checkpoint` currently carries `snapshotTree`), `mcp.config` (mcpConfigApi) passthrough, and `validateRuntime` requiring `config`/`completion` (host from bridge). Adjust the neutral runtime mapping (not the test) so the typed surface matches `RuntimeClient`.

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/runtime/opencode-v2-parity.test.ts --runInBand --forceExit`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/unit/runtime/opencode-v2-parity.test.ts gateway/src/runtime/neutral-runtime.ts
git commit -m "test: pin v2 channel parity on the neutral path"
```

---

### Task 5: composition-root parity (dry-event / conformance / hub)

**Files:**
- Modify: `gateway/src/index.ts`（`dryEventDeps`）
- Test: `gateway/tests/unit/runtime/opencode-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('opencode definitions are visible to the composition root', () => {
  const src = read('src/index.ts');
  expect(src).toContain("registerBuiltinDefinition('opencode'");
  expect(src).toContain("'opencode@v21'");
  expect(src).not.toMatch(/registerBuiltin\('opencode'/);
});

it('dry-event resolves the dialect entry from the definition', () => {
  const defs = loader.getNeutralDefinitions();
  const entry = dryEventDepsFor(defs).getPluginEventEntry('opencode');
  expect(entry?.eventMappings?.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/runtime/opencode-wiring.test.ts --runInBand --forceExit`
Expected: FAIL.

- [ ] **Step 3: Implement**

`getPluginEventEntry(name)` first asks the neutral definition's `translate.entry` (expose `entry` on the definition or a runtime accessor), then falls back to `loader.get(name)`. `hasPlugin` already uses `has()`.

- [ ] **Step 4: Run tests + full gates**

Run: `npx jest tests/unit/runtime/opencode-wiring.test.ts --runInBand --forceExit`, then `npm test -- --forceExit`, `npx tsc --noEmit -p tsconfig.json`, root `npm run build`.
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/index.ts gateway/tests/unit/runtime/opencode-wiring.test.ts
git commit -m "feat(gateway): expose opencode definition entries to dry-event"
```

---

## Self-Review

- Spec §9 Phase 3 “opencode” 覆盖：Task 2（定义 + 四方言）、Task 3（golden）、Task 4（v2 channels 真实载荷）、Task 5（组合根一致性）。物理包移动见 Sequencing（Plan 4）。
- 类型一致性：v2 DTO 只在 Task 1 定义，Task 2/4 消费；`OpencodeVariant` 只在 Task 2 定义。
- 每个 Review Focus 都有归属测试：方言→Task 2、能力一致→Task 4、v2 载荷→Task 4、回合归属→Task 3（turn id 对比）、缺通道→Task 4。

## Known Boundaries

- 物理 `adapters/opencode` 包与 legacy 删除仍在 Plan 4。
- adaptive 的方言只在定义创建时解析一次；热切换仍重建 runtime。
- PTY 帧仍是 `unknown`（只类型化元数据）。
