# Neutral Runtime Plan 2 — runtime-core + pi adapter + production switch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production gateway drive a real runtime (pi) exclusively through `RuntimeDefinition` + `RuntimeBus`, with the pi driver living in its own package and no gateway code touching pi's native objects.

**Architecture:** Extract the runtime-neutral kernel types (`canonical-types`, `RawRuntimeEvent`, event mapping, tool-part assembly) into `packages/runtime-core` so a driver package can produce canonical events without importing gateway. Move pi into `adapters/pi` (transport + adapter-events + channels + definition), give the composition root a `createNeutralRuntime(definition)` facade backed by the bus, and switch `gateway/src/index.ts` to resolve every builtin through the loader's neutral registry. opencode keeps its current facade path until Plan 3 and is explicitly marked as the remaining legacy fast path.

**Tech Stack:** TypeScript (CJS gateway, ESM adapter sources bundled by esbuild to CJS), Node test runner for contract/adapter packages, Jest for gateway, npm workspaces + `bundledPackages` staging.

**Spec:** `docs/superpowers/specs/2026-11-09-neutral-runtime-driver-architecture-design.md`

## Sequencing (why this is Plan 2 of 4)

计划拆分依据（2026-11-09 实测）：

- Plan 1（已合并 `3bd61e8b`）：内核 + claude。
- **Plan 2（本文件）**：`runtime-core` 提取、pi 驱动包、`createNeutralRuntime`、组合根切换。
- Plan 3：opencode 驱动包 + v2 channels（MCP / discovery / instructions / PTY / checkpoint / background）真实实现。
- Plan 4：删除 legacy（`legacy/`、旧 `runtime.ts`/`events.ts`、gateway 内 `opencode-*`/`pi/**`）、CI 全量守卫、前端/DTO 中性化。

**为什么不是「pi + opencode + v2 同一份计划」**：pi 需要 4 个内核模块（`normalize` / `event-mapper` / `canonical-types` / `tool-part-assembler`）才能离开 gateway（`event-flow-matrix` 是 gateway 业务矩阵，只有旧的 canonical mapper 需要，留在 gateway）；opencode 是 2.8k 行 + 6 个 v2 surface，且 v2 的真实实现只属于 opencode。`v2 channels 与 v1 同批交付` 指**同一发布**，不是同一份 plan——Plan 2/3/4 全部落地后才发版。

## Global Constraints

- ABI：`api: 1`、`eventApi: 1`；不新增第二个 ABI 版本。
- 无 `native` 分支：`defineRuntime` 输入不得含 `native` 键；kernel 不得出现 runtime 协议名。
- 迁移兼容代码放 adapter 包内，不放 kernel。
- gateway 业务核心不得读取 runtime 原生对象（`registry`、SDK client、原生事件信封）。
- 所有内置 runtime 经 `defineRuntime` 注册；旧 `createRuntime(ctx)` 只保留一个发布周期（Plan 4 删除）。
- 每次改动必须过：`gateway` 全量 jest、目标包 node --test、`npx tsc --noEmit -p tsconfig.json`、根 `npm run build`。
- gateway 依赖安装只在仓库根目录执行（子目录 `npm install` 会 404）。
- 私有 workspace 包不进 registry 依赖；用 `gateway/package.json` 的 `mafw.bundledPackages` + `scripts/stage-plugin-contract.mjs` staging。

## Review Focus

1. **busy 投递**：pi 在回合进行中收到新 prompt 会排队（`followUp`）；中立路径不得丢弃、不得重复投递，也不得阻塞 `sendTurn` 到回合结束。
2. **回合归属**：abort 之后到达的终态事件不得结算下一个回合；每次 `sendTurn` 必须新铸 `turnID`，bus 的 retired-turn 栅栏必须仍生效。
3. **事件双消费者**：watchdog 重订 + 桌面 SSE 同时消费 `global.event()`；单一 async iterator 会吞掉后接入者的事件。
4. **载荷保真**：canonical → AdapterEvent → canonical 往返必须保留 `part.id` / `message.id` / `turnID` / `usage` 字段，否则桌面工具卡与流式光标静默回退。
5. **缺通道**：没有 `messages` channel 的 runtime 必须返回中性 ENODEV/503，不得返回空历史伪装成功。

---

### Task 1: Extract `packages/runtime-core`

**Files:**
- Create: `packages/runtime-core/package.json`, `packages/runtime-core/tsconfig.json`
- Create: `packages/runtime-core/src/{canonical-types,normalize,event-mapper,tool-part-assembler,index}.ts`
- Modify: `gateway/src/runtime/{canonical-types,normalize,event-mapper,tool-part-assembler}.ts` (→ re-export)
- Modify: `package.json`（workspaces 已含 `packages/*`；build 顺序加 runtime-core）
- Modify: `gateway/package.json`（`mafw.bundledPackages` 加 `@mafw/runtime-core`）
- Test: `packages/runtime-core/src/core.test.ts`

**Interfaces:**
- Produces: `@mafw/runtime-core` exports `MafwMessage`, `MafwPart`, `MafwMessageError`, `StopReason`, `isMafwMessage()`, `isMafwPart()`, `RawRuntimeEvent`, `applyEventMappings()`, `EventMappingEntry`, `TranslationHooks`, `TOOL_PRIMITIVE_TYPES`, `coerceOutput()`, `ToolPartAssembler`.
- Consumes: nothing from gateway.

- [ ] **Step 1: Write the failing test**

`packages/runtime-core/src/core.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { isMafwMessage, isMafwPart, applyEventMappings, coerceOutput } from './index.ts';

test('isMafwMessage accepts a flat message and rejects an envelope', () => {
  assert.equal(isMafwMessage({ id: 'm1', sessionID: 's1', role: 'user' }), true);
  assert.equal(isMafwMessage({ info: { id: 'm1' }, parts: [] }), false);
});

test('applyEventMappings maps a declared source type', () => {
  const out = applyEventMappings(
    { payload: { type: 'x.created', properties: { sessionID: 's1' } } },
    {
      eventSource: { typePath: '$.payload.type', sessionIdPath: '$.payload.properties.sessionID' },
      eventMappings: [{ from: 'x.created', to: 'session.created', fields: { info: { const: { id: 's1' } } } }],
    },
    (t) => t === 'session.created',
  );
  assert.equal(out[0].payload.type, 'session.created');
});

test('coerceOutput normalises tool output', () => {
  assert.equal(coerceOutput('x'), 'x');
  assert.equal(coerceOutput({ a: 1 }), JSON.stringify({ a: 1 }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/runtime-core/src/core.test.ts`
Expected: FAIL — `Cannot find module .../index.ts`.

- [ ] **Step 3: Move the four modules and re-export**

`git mv gateway/src/runtime/canonical-types.ts packages/runtime-core/src/canonical-types.ts`（同样处理 `normalize.ts`、`event-mapper.ts`、`tool-part-assembler.ts`），修内部相对 import，然后让旧的 gateway 路径只做再导出：

```ts
// gateway/src/runtime/canonical-types.ts
export * from '@mafw/runtime-core';
```

`packages/runtime-core/src/index.ts` 汇总四个模块的公开符号。包配置照抄 `packages/runtime-contract`（`type: module` 源码 + `tsc` 产 CJS 到 `dist/`，并写 `dist/package.json {type:commonjs}`）。

- [ ] **Step 4: Verify re-export compatibility**

Run: `npx tsc --noEmit -p gateway/tsconfig.json`
Expected: rc=0（旧导入路径不动）。

- [ ] **Step 5: Wire packaging and build order**

根 `build` 在 `runtime-contract` 之后加 `npm run build -w @mafw/runtime-core`，并在 staging 之前；`gateway/package.json` 的 `bundledPackages` 加 `"@mafw/runtime-core": "../packages/runtime-core"`；根 `files` 加 `packages/runtime-core/package.json`、`packages/runtime-core/dist/`；根 `scripts` 加 `"test:core": "node --test \"packages/runtime-core/src/**/*.test.ts\""`，CI 的 `test:contract` 步骤后加 `test:core`。

- [ ] **Step 6: Run tests and build**

Run: `npm run test:core`、`npx jest --runInBand`（gateway 全量）、`npm run build`
Expected: 3/3、全绿、rc=0。

- [ ] **Step 7: Commit**

```bash
git add packages/runtime-core gateway/src/runtime package.json gateway/package.json package-lock.json
git commit -m "refactor: extract runtime-neutral core types into @mafw/runtime-core"
```

---

### Task 2: Contract parity for a production switch

**Files:**
- Modify: `packages/runtime-contract/src/channels.ts`
- Modify: `packages/runtime-contract/src/transport.ts`
- Modify: `packages/runtime-contract/src/define-runtime.ts`
- Test: `packages/runtime-contract/src/channels.test.ts` (create)

**Interfaces:**
- Produces:
  - `RuntimeDefinitionInput.external?: boolean`
  - `SendTurnInput.delivery?: 'steer' | 'followup' | 'queue'`
  - `RuntimeChannels.session.{todo,children,summarize,switchAgent,switchModel,setThinkingLevel,permissionList,background}`
  - `RuntimeFactoryContext.policy?: RuntimePolicyHooks`
  - `RuntimePolicyHooks`（`evaluatePermission` / `gateToolCall` / `gatePrompt` / `redactToolResult`，返回 `unknown`，由 adapter 自行窄化）
- Consumes: `RuntimeModelRef`, `ThinkingLevel` from `transport.ts`.

- [ ] **Step 1: Write the failing test**

```ts
test('session channel exposes the parity methods', () => {
  const def = defineRuntime({
    api: 1, name: 'x', displayName: 'X', preset: 'core', transport,
    external: false,
    channels: { session: { todo: async () => [] } },
  });
  assert.equal(def.external, false);
  assert.equal(typeof def.channels!.session!.todo, 'function');
});

test('sendTurn accepts a delivery hint', () => {
  const input: SendTurnInput = { sessionID: 's1', turnID: 't1', text: 'hi', delivery: 'steer' };
  assert.equal(input.delivery, 'steer');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test packages/runtime-contract/src/channels.test.ts`
Expected: FAIL — `external` 不在类型里 / `todo` 不在 `RuntimeChannels.session`。

- [ ] **Step 3: Add the fields and methods**

`session` 通道新增方法一律可选、参数与 `gateway/src/runtime/contract.ts` 的同名 `RuntimeClient.session` 方法一致（`todo(sessionID)`、`children(sessionID)`、`summarize({sessionID,...})`、`switchAgent(sessionID, agent)`、`switchModel(sessionID, RuntimeModelRef)`、`setThinkingLevel(sessionID, ThinkingLevel)`、`permissionList({directory?})`、`background(sessionID)`）。`defineRuntime` 只校验既有必填面，新字段不参与能力派生。

- [ ] **Step 4: Run tests and build**

Run: `npm run test:contract`、`npm run build -w @mafw/runtime-contract`
Expected: 全绿、rc=0。

- [ ] **Step 5: Commit**

```bash
git add packages/runtime-contract
git commit -m "feat(runtime-contract): add production parity surfaces"
```

---

### Task 3: `createNeutralRuntime` — definition-backed AgentRuntime

**Files:**
- Create: `gateway/src/runtime/neutral-runtime.ts`
- Test: `gateway/tests/unit/runtime/neutral-runtime.test.ts`

**Interfaces:**
- Consumes: `RuntimeDefinition`, `RuntimeBus`, `AdapterEvent`.
- Produces:

```ts
export interface NeutralRuntimeHost extends Partial<Pick<AgentRuntime,
  'capabilities' | 'external' | 'getBaseUrl' | 'healthCheck' | 'agentProcess' |
  'config' | 'completion' | 'credentials' | 'resolveEventEntry' | 'activeDialect'>> {}

export interface NeutralRuntimeOptions {
  bus: RuntimeBus;
  host?: NeutralRuntimeHost;
  now?: () => number;
  promptTimeoutMs?: number;   // default 600_000
}

export function createNeutralRuntime(
  definition: RuntimeDefinition,
  options: NeutralRuntimeOptions,
): AgentRuntime;
```

- [ ] **Step 1: Write the failing tests**

测试文件顶部定义两个 helper（本任务内实现，不引入生产代码）：

```ts
function defWith(overrides: Partial<RuntimeTransport>): RuntimeDefinition   // transport + 空 channels + capabilities
async function pendingTurn(): Promise<Array<{ turnID: string }>>            // 捕获最近一次 sendTurn 的入参
```

```ts
it('routes promptAsync through transport.sendTurn with a minted turn id', async () => {
  const sent: any[] = [];
  const rt = createNeutralRuntime(defWith({ sendTurn: async (i) => { sent.push(i); return { turnID: i.turnID }; } }), { bus });
  await rt.session.promptAsync({ sessionID: 's1', message: 'hi', delivery: 'followup' } as any);
  expect(sent[0].text).toBe('hi');
  expect(sent[0].turnID).toMatch(/^turn_/);
  expect(sent[0].delivery).toBe('followup');
});

it('does not expose channels the runtime lacks', () => {
  const rt = createNeutralRuntime(defWith({}), { bus });
  expect((rt.session as any).todo).toBeUndefined();
});

it('fans out bus events to every global.event consumer', async () => {
  const rt = createNeutralRuntime(defWith({}), { bus });
  const a = collect(rt.global.event());
  const b = collect(rt.global.event());
  bus.dispatch(adapterEvent('turn.completed', { turnID: 't1' }));
  expect((await a)[0].payload.type).toBe('turn.completed');
  expect((await b)[0].payload.type).toBe('turn.completed');
});

it('resolves session.prompt when the turn completes', async () => {
  const rt = createNeutralRuntime(defWith({}), { bus });
  const p = rt.session.prompt({ sessionID: 's1', message: 'hi' } as any);
  const [{ turnID }] = await pendingTurn();
  bus.dispatch(adapterEvent('turn.completed', { turnID, data: { ok: true, usage: { input: 1, output: 2 } } }));
  expect((await p).usage).toEqual({ input: 1, output: 2 });
});

it('maps permissionReply always to allow+always', async () => {
  const calls: any[] = [];
  const rt = createNeutralRuntime(defWith({ respondToRequest: async (...args) => { calls.push(args); return 'allowed-once'; } }), { bus });
  await rt.session.permissionReply!('s1', 'r1', 'always');
  expect(calls[0][2]).toEqual({ behavior: 'allow', always: true });
});

it('dispose stops the transport', async () => {
  let stopped = 0;
  const rt = createNeutralRuntime(defWith({ stop: async () => { stopped += 1; } }), { bus });
  await rt.dispose!();
  expect(stopped).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/runtime/neutral-runtime.test.ts --runInBand`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the mapping**

`session.create` → `transport.createSession` 返回 `{ id: sessionID }`；`promptAsync` 铸 `turn_<seq>` 并 fire-and-forget（不 await 到回合结束，但 await `sendTurn` 的返回）；`abort` → `interruptTurn`；`messages`/`todo`/`children`/`summarize`/`switch*`/`permissionList`/`background`/`fork`/`revert`/`unrevert`/`diff`/`vcs` 全部按通道存在性挂载；`global.event()` 每次调用新建一个由 bus 驱动的 async iterator（广播队列，永不共享迭代器）；`prompt` 收集 `part.updated` + 终态，超时抛错；`dispose` 调 `transport.stop?.()` 再 `host.dispose?.()`。

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/runtime/neutral-runtime.test.ts --runInBand`
Expected: PASS（6/6）。

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`

```bash
git add gateway/src/runtime/neutral-runtime.ts gateway/tests/unit/runtime/neutral-runtime.test.ts
git commit -m "feat(gateway): add definition-backed neutral runtime facade"
```

---

### Task 4: Generalize the adapter bridge and prove canonical round-trip

**Files:**
- Create: `gateway/src/runtime/adapter-bridge.ts`
- Modify: `gateway/src/runtime/legacy/legacy-plugin-bridge.ts` (→ re-export shim, `@deprecated`)
- Test: `gateway/tests/unit/runtime/adapter-bridge.test.ts`

**Interfaces:**
- Produces: `toRuntimeDefinition(runtime: RuntimeClient, meta: AdapterBridgeMeta): RuntimeDefinition`

```ts
export interface AdapterBridgeMeta {
  name: string;
  displayName?: string;
  capabilities?: Partial<RuntimeCapabilities>;
  external?: boolean;
  /** 需要先做方言翻译的原始事件流（opencode）；缺省 = 事件流已是 canonical（pi）。 */
  translate?: { entry: EventMappingEntry; isCanonical: (type: string) => boolean };
}
```

- [ ] **Step 1: Write the failing test**

```ts
const RUNTIME_CANONICAL_EVENTS = [
  'session.created', 'session.updated', 'session.deleted',
  'session.compacting', 'session.compacted',
  'turn.started', 'turn.completed', 'turn.failed', 'turn.aborted',
  'message.updated', 'part.updated', 'part.delta', 'part.complete',
  'permission.asked', 'permission.replied',
  'question.asked', 'question.replied', 'question.rejected',
  'plan.updated', 'usage.updated',
  'tool.call', 'tool.delta', 'tool.result',
] as const;

it.each(RUNTIME_CANONICAL_EVENTS)('round-trips %s', (type) => {
  const canonical = sampleCanonical(type);
  const adapter = canonicalToAdapterEvent(canonical)!;
  const mapped = mapAdapterEvent(adapter);
  expect(mapped.dropped).toBeUndefined();
  expect(mapped.canonical?.payload.type).toBe(canonical.payload.type);
});

it('keeps ids and usage through the round-trip', () => {
  const canonical = sampleCanonical('part.delta');
  const back = mapAdapterEvent(canonicalToAdapterEvent(canonical)!).canonical!;
  expect(back.payload.properties).toMatchObject({
    messageID: canonical.payload.properties.messageID,
    partID: canonical.payload.properties.partID,
    delta: canonical.payload.properties.delta,
  });
});

it('applies dialect translation before reverse-mapping when asked', () => { /* translate.entry 生效 */ });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/runtime/adapter-bridge.test.ts --runInBand`
Expected: FAIL — module not found.

- [ ] **Step 3: Move the bridge and extend coverage**

把 `canonicalToAdapterEvent` / `toRuntimeDefinition` 从 `legacy/` 移到 `adapter-bridge.ts`，补 `session.compacting`、`session.compacted`、`part.removed`、`message.removed`、`turn.retrying/waiting/cap_exhausted`、`runtime.notice` 的反映射；`translate` 存在时先按 entry 翻译再反映射。`legacy-plugin-bridge.ts` 只保留 `export * from '../adapter-bridge'` 与 `@deprecated` 注释（Plan 4 删除）。

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/runtime/adapter-bridge.test.ts tests/unit/runtime/legacy-plugin-bridge.test.ts --runInBand`
Expected: 两条都 PASS（旧文件测试仍绿）。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/adapter-bridge.ts gateway/src/runtime/legacy/legacy-plugin-bridge.ts gateway/tests/unit/runtime/adapter-bridge.test.ts
git commit -m "feat(gateway): promote the legacy bridge to a generic adapter bridge"
```

---

### Task 5: `adapters/pi` package — transport, events, channels, definition

**Files:**
- Create: `adapters/pi/package.json`, `adapters/pi/build.mjs`, `adapters/pi/src/index.ts`
- Create: `adapters/pi/src/transport.ts`, `adapters/pi/src/adapter-events.ts`, `adapters/pi/src/channels.ts`, `adapters/pi/src/definition.ts`
- Move: `gateway/src/runtime/pi/*.ts` **除 `pi-events.ts`** → `adapters/pi/src/`（`pi-events.ts` 留作 legacy 路径，Plan 4 删除）
- Move: `gateway/src/runtime/plugins/pi-runtime.ts` → `adapters/pi/src/runtime.ts`
- Test: `adapters/pi/tests/{transport,channels,definition}.test.ts`

**Interfaces:**
- Consumes: `@mafw/runtime-contract`, `@mafw/runtime-core`, `@earendil-works/pi-coding-agent`.
- Produces:
  - `name = 'pi'`, `capabilities`（沿用 `PI_CAPABILITIES`）
  - `createPiDefinition(ctx: RuntimeFactoryContext, deps?: PiRuntimeDeps): Promise<RuntimeDefinition>`
  - `createRuntimeDefinition(ctx)`（loader 入口）
  - `createRuntime(ctx)`（`@deprecated`，一个发布周期）
  - `PiSessionRegistry`、`normalizePiMessages`、`piAgentConfig`（gateway 侧 `runtime/pi` 旧路径改为再导出，Plan 4 删除；`runtime/pi/pi-events.ts` 保留）

- [ ] **Step 1: Write the failing test**

`adapters/pi/tests/transport.test.ts`:

```ts
test('promptAsync starts a turn and the registry stream is translated', async () => {
  const t = createPiTransport({ registry: fakeRegistry });
  const events: AdapterEvent[] = [];
  t.onEvent((e) => events.push(e));
  await t.sendTurn({ sessionID: 's1', turnID: 't1', text: 'hi' });
  fakeRegistry.emit({ type: 'message_end', role: 'assistant', text: 'ok' });
  assert.equal(events.some((e) => e.type === 'part.updated'), true);
});

test('busy prompt is queued, not dropped', async () => { /* 第二次 sendTurn 立即返回，回合结束后队列 flush */ });

test('abort interrupts and retires the turn', async () => { /* interruptTurn → registry.abort + 后续同 turn 事件被 tracker 丢弃 */ });
```

`adapters/pi/tests/definition.test.ts`:

```ts
test('definition declares pi capabilities and no external process', async () => {
  const def = await createPiDefinition(fakeCtx);
  assert.equal(def.name, 'pi');
  assert.equal(def.external, false);
  assert.equal(def.capabilities.nativeApprovals, true);
  assert.equal(def.capabilities.instructionsApi, false);
});

test('policy hooks are wired into the registry from ctx.policy', async () => {
  const def = await createPiDefinition({ ...fakeCtx, policy: { evaluatePermission: () => ({ decision: 'allow' }) } });
  assert.equal(fakeRegistry.permissionEvaluator != null, true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd adapters/pi && node --test tests/*.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Move and adapt**

- 移动 pi 源文件（`pi-events.ts` 除外）；把 `../normalize` / `../event-mapper` / `../canonical-types` / `../tool-part-assembler` 改为 `@mafw/runtime-core`。
- `pi-runtime.ts` 的 gateway 依赖替换：`requireSessionDir` → 本地断言（缺 directory 抛错）；`readOpencodeAuth`/`DEFAULT_AUTH_PATH` → 只保留 `ctx.credentials` + 本地 auth.json 读取副本（`src/auth.ts`）；`config.server.apiPort`/`config.raw.paths.projectDir` → `ctx.gatewayPort` / `ctx.projectDir`；`fixMediaPayload` → `src/media-payload.ts`。
- `transport.ts` 包装 `PiSessionRegistry`：`createSession` / `sendTurn`（`promptAsync`，busy 走 registry 队列）/ `interruptTurn` / `respondToRequest`（`ApprovalBridge`）/ `steer` / `snapshot` / `onEvent`。`onEvent` **不复用** `PiEventStream`（它产 canonical）：registry 的 `emitEvent` 直接喂 `adapter-events.ts`，由后者产 `AdapterEvent`。
- `adapter-events.ts` 把 pi 原生事件 → `AdapterEvent`（`turn.started` 由 tracker 合成，终态复位）。
- `channels.ts` 覆盖 `session`（list/get/update/delete/abort/todo/children/summarize/switchAgent/switchModel/setThinkingLevel/permissionList/fork/revert）、`messages.normalize`、`providers`、`agents`、`question` 缺席（pi 无 question API）。

- [ ] **Step 4: Update gateway imports**

`gateway/src/runtime/pi/index.ts` 与 `gateway/src/runtime/plugins/pi-runtime.ts` 改为再导出（`export * from '@mafw/adapter-pi'`），`gateway/src/index.ts` 的 `createPiRuntime`/`PI_CAPABILITIES` 导入保持可用。

- [ ] **Step 5: Build and test**

Run: `cd adapters/pi && node --test tests/*.test.ts && npm run build`、`npx tsc --noEmit -p gateway/tsconfig.json`、`npx jest tests/unit/runtime/pi-events.test.ts tests/integration/pi-native-approvals.test.ts --runInBand`
Expected: 适配器全绿、build rc=0、gateway 旧测试仍绿。

- [ ] **Step 6: Commit**

```bash
git add adapters/pi gateway/src/runtime/pi gateway/src/runtime/plugins/pi-runtime.ts package-lock.json
git commit -m "feat(adapter-pi): move the pi driver into its own package"
```

---

### Task 6: Loader registers builtin definitions

**Files:**
- Modify: `gateway/src/runtime/loader.ts`
- Modify: `gateway/src/runtime/plugin-entry.ts`（factory 定义校验）
- Test: `gateway/tests/unit/runtime/loader-builtin-definition.test.ts`

**Interfaces:**
- Produces:
  - `registerBuiltinDefinition(name: string, factory: (ctx: any) => Promise<RuntimeDefinition>, meta: { external: boolean; capabilities: RuntimeCapabilities }): void`
  - `resolveBuiltinDefinition(name: string, ctx: any): Promise<RuntimeDefinition | undefined>`
- Consumes: `RuntimeBus.register`.

- [ ] **Step 1: Write the failing test**

```ts
it('registers a lazy builtin definition and exposes it on the bus', async () => {
  const loader = new RuntimePluginLoader(tmp);
  loader.registerBuiltinDefinition('fake', async () => definition, { external: false, capabilities: definition.capabilities });
  const def = await loader.resolveBuiltinDefinition('fake', {});
  expect(def?.name).toBe('fake');
  expect(loader.getRuntimeBus().stats()).toBeDefined();
});

it('caches one definition per name', async () => {
  let calls = 0;
  loader.registerBuiltinDefinition('fake', async () => { calls += 1; return definition; }, meta);
  await loader.resolveBuiltinDefinition('fake', {});
  await loader.resolveBuiltinDefinition('fake', {});
  expect(calls).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/runtime/loader-builtin-definition.test.ts --runInBand`
Expected: FAIL — method missing.

- [ ] **Step 3: Implement**

builtin 定义与文件插件定义共用 `neutralDefinitions`/`neutralFactories`/`neutralBus`；`get(name)`（旧签名）对 builtin 返回一个 `createRuntime` 包装：解析定义 → `createNeutralRuntime`（延迟 require 避免循环依赖）。

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/runtime/loader-builtin-definition.test.ts tests/unit/runtime/loader.test.ts tests/unit/runtime/loader-builtin.test.ts --runInBand`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/loader.ts gateway/src/runtime/plugin-entry.ts gateway/tests/unit/runtime/loader-builtin-definition.test.ts
git commit -m "feat(gateway): register builtin runtimes as neutral definitions"
```

---

### Task 7: Composition root runs pi through the neutral bus

**Files:**
- Modify: `gateway/src/index.ts`
- Modify: `gateway/src/runtime/runtime-facade.ts`（`neutral: true` 跳过方言包装）
- Test: `gateway/tests/unit/runtime/neutral-wiring.test.ts`

**Interfaces:**
- Consumes: `neutral-runtime.ts`, `loader.resolveBuiltinDefinition`, `adapter-bridge.toRuntimeDefinition`.
- Produces: `createRuntimeFacade(raw, options & { neutral?: boolean })`；neutral 时 `global.event` 直通（不再 `wrapDialectEventStream`），`rewireEvents()` 返回 `'neutral'`。

- [ ] **Step 1: Write the failing test**

```ts
it('createRuntimeFacade with neutral:true does not translate events twice', async () => {
  const raw = neutralRuntimeStub();
  const facade = await createRuntimeFacade(raw, { neutral: true, entry: {} as any, isCanonical: () => true });
  const evt = await first(facade.global.event());
  expect(evt.payload.type).toBe('turn.completed');
});

it('gateway source wires pi through resolveBuiltinDefinition', () => {
  const src = readFileSync(join(GATEWAY, 'src', 'index.ts'), 'utf8');
  expect(src).toContain('resolveBuiltinDefinition');
  expect(src).not.toMatch(/\(rawRuntime as any\)\.registry/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/runtime/neutral-wiring.test.ts --runInBand`
Expected: FAIL。

- [ ] **Step 3: Switch activation**

- `pi` 改为 `registerBuiltinDefinition('pi', (ctx) => createPiDefinition(ctx), { external: false, capabilities: PI_CAPABILITIES })`，其中 `ctx` 由 `createRuntimePluginContext(creds, { projectDir, rootDir, gatewayPort, policy: this.runtimePolicyHooks() })` 构造（Task 2 的 `RuntimeFactoryContext.policy`）。
- `activatePluginRuntime` 先尝试 `resolveBuiltinDefinition(name, ctx)`（内置），再走文件插件；成功则 `createNeutralRuntime(def, { bus, host })` 得到 raw，后续 `applyRuntimeValidation` / `activateRuntimeTools` / `wrapRuntimeIdentity` / facade 不变。
- `createRuntimeFacade(..., { neutral: true })`。
- 删除 `wirePiPermissionEvaluator` / `wirePiCognition`，改由 `runtimePolicyHooks()` 通过 `ctx.policy` 注入（`evaluatePermission` / `gateToolCall` / `gatePrompt` / `redactToolResult`）。
- opencode 四个方言名暂时保留旧路径，函数上方加 `// Plan 3: opencode adapter` 标记。

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/runtime/neutral-wiring.test.ts tests/unit/runtime/pi-events.test.ts --runInBand`、`npx jest --runInBand`（全量）
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/index.ts gateway/src/runtime/runtime-facade.ts gateway/tests/unit/runtime/neutral-wiring.test.ts
git commit -m "feat(gateway): drive pi through the neutral runtime bus"
```

---

### Task 8: Golden replay — old path vs neutral path

**Files:**
- Test: `gateway/tests/unit/runtime/neutral-replay-golden.test.ts`

**Interfaces:**
- Consumes: `adapter-bridge.toRuntimeDefinition`, `neutral-runtime.createNeutralRuntime`, pi fixtures.

- [ ] **Step 1: Write the failing test**

```ts
const piRaw = readJsonl('tests/fixtures/events/pi-raw-turn.jsonl');

it('pi neutral path reproduces the legacy canonical sequence', async () => {
  const legacy = piRaw.flatMap((e) => applyPiMappings(e));           // 旧路径
  const neutral = await replayThroughDefinition(piRaw);              // 定义 → bus → canonical
  expect(neutral.map((e) => e.payload.type)).toEqual(legacy.map((e) => e.payload.type));
  expect(neutral.map(pickIdentity)).toEqual(legacy.map(pickIdentity)); // turnID/sessionID/part.id
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/runtime/neutral-replay-golden.test.ts --runInBand`
Expected: FAIL — fixture 不存在。

- [ ] **Step 3: Record the fixture and implement the replay**

用 `adapters/pi/tests` 里的 fake registry 生成一段真实形状的 pi 事件流（`message_start` / `message_update` / `tool_call` / `tool_result` / `message_end` / `turn_end`），写入 `gateway/tests/fixtures/events/pi-raw-turn.jsonl`；`replayThroughDefinition` 用 `toRuntimeDefinition` + `createNeutralRuntime` 驱动。

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/runtime/neutral-replay-golden.test.ts --runInBand`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/fixtures/events/pi-raw-turn.jsonl gateway/tests/unit/runtime/neutral-replay-golden.test.ts
git commit -m "test: pin pi neutral replay against the legacy canonical sequence"
```

---

## Self-Review

- Spec §9 Phase 2（pi）覆盖：Task 5（包）、Task 6/7（注册与生产）、Task 8（golden）。`question.*` 显式缺席已在 Task 5 声明。
- Spec §9 Phase 3/4/5 与 v2 channels 明确移出本计划，理由见 Sequencing。
- 类型一致性：`RuntimePolicyHooks` 只在 Task 2 定义、Task 7 注入、Task 5 消费；`AdapterBridgeMeta` 只在 Task 4 定义、Task 5/7 使用。
- 每个 Review Focus 都有归属测试：busy→Task 5、回合归属→Task 3/5、双消费者→Task 3、载荷保真→Task 4/8、缺通道→Task 3。

## Known Boundaries

- opencode 在本计划末尾仍走旧 facade 路径（Plan 3 迁移）。
- `adapters/pi` 的 `auth.ts` 是 gateway `runtime/auth.ts` 的副本；Plan 4 统一。
- `pi-agent-config` 写入全局 agent 目录属于 adapter 职责，仍经 `ctx` 的项目根解析。
- gateway 内 `runtime/pi/**` 旧路径在本计划保留为再导出；Plan 4 删除。
