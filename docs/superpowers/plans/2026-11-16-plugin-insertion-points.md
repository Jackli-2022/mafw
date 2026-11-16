# E12 插件插入点标准化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `plugin.json.contributes` 成为可执行的声明约束，并让 tools / observers 两个插入点在默认配置下真正生效。

**Architecture:** 三层改动，互不侵入。纯层（`package-manifest.ts` + `package-validator.ts`）负责把声明归一化并做集合比对；接线层（`package-host.ts`）把已归一化的声明传给两条激活路径并补 `http: false` 检查；开关层（`runtime/v2-live.ts`）把 kernel-v2 桥从 opt-in 改成 opt-out。actions / events 的 bag 生命周期、http 的 revision 退役、untrusted worker 的能力白名单全部不动。

**Tech Stack:** TypeScript、Jest（gateway）、`@mafw/plugin-contract`（DTO + 校验）、Node `fs`（测试用临时目录包）。

**Spec:** `docs/superpowers/specs/2026-11-16-plugin-insertion-points-design.md`

## Global Constraints

- 契约包 `packages/plugin-contract` **不改**：`validatePluginManifestContributes` 已存在。
- v1 包（`apiVersion` 缺省或 1）的 contributes 校验失败只能是 **warning**，绝不能拒绝激活。
- 未声明某个面时，该面**不做任何限制**（向后兼容），这是硬要求。
- 声明是**上界不是清单**：声明了但没注册必须成功（条件注册合法）。
- 错误信息必须是稳定字符串，包含在被测错误里（见各任务断言），不要改写措辞。
- 不动 `boot.ts` 的启动装配顺序。
- 不改 `~/.mafw/plugins` 目录结构，不动 `docs/architecture/goal.md` 相关代码。
- 提交信息遵循仓库风格：`feat(plugin): ...`。

## Review Focus

- **v1 包带脏 contributes**：此前该字段被完全忽略，现在必须仍然激活成功，只多一条 `legacy-contributes:` warning。→ Task 1 步骤 1 第 3 例。
- **声明了但未注册**（条件注册）：不得因“声明多、实际少”失败。→ Task 1 步骤 1 第 5 例。
- **untrusted worker 绕过**：worker 返回了未声明的 action，必须在 worker 白名单之后仍被声明层拦下。→ Task 2 步骤 1 第 3 例。
- **运维显式关闭**：`MAFW_KERNEL_V2_TOOLS=0` 必须是“关掉且报错”，不是静默 no-op。→ Task 3 步骤 1 第 2/4 例。
- **默认开启不得引入空转**：0 个 observer 时每条 canonical 事件不得排队。→ Task 3 步骤 1 第 5 例。

---

### Task 1: 纯层——contributes 归一化与集合比对

**Files:**
- Modify: `gateway/src/plugins/package-manifest.ts`（`NormalizedPackageManifest` 增加 `contributes`；`parsePackageManifest` 读取并校验）
- Modify: `gateway/src/plugins/package-validator.ts`（`buildActivatedContributions` 增加第 4 参数；新增 `enforceDeclared`）
- Test: `gateway/tests/unit/plugins/package-manifest.test.ts`
- Test: `gateway/tests/unit/plugins/package-validator.test.ts`

**Interfaces:**
- Produces: `NormalizedPackageManifest.contributes?: PluginManifestContributes`（来自 `@mafw/plugin-contract`）
- Produces: `buildActivatedContributions(packageName: string, contributions: UnifiedPluginContributions, canonicalTypes: ReadonlySet<string>, declared?: PluginManifestContributes): BuildActivatedContributionsResult`
- 错误文案（逐字）：`action "<name>" is not declared in plugin.json contributes.gateway.actions`、`event "<type>" is not declared in plugin.json contributes.gateway.events`、`tool "<name>" is not declared in plugin.json contributes.gateway.tools`

- [ ] **Step 1: 写失败的测试（manifest 层 3 例 + validator 层 4 例）**

在 `gateway/tests/unit/plugins/package-manifest.test.ts` 的 `describe('package manifest v2')` 内追加：

```ts
it('normalizes a valid contributes block', () => {
  const result = parsePackageManifest({
    name: 'demo', apiVersion: 2,
    contributes: { gateway: { actions: ['ping'], http: false } },
  });
  expect(result.ok).toBe(true);
  expect(result.manifest?.contributes?.gateway?.actions).toEqual(['ping']);
  expect(result.manifest?.contributes?.gateway?.http).toBe(false);
});

it('rejects an invalid contributes block at apiVersion 2', () => {
  const result = parsePackageManifest({
    name: 'demo', apiVersion: 2,
    contributes: { gateway: { actions: 'ping' } },
  });
  expect(result.ok).toBe(false);
  expect(result.errors.join('; ')).toContain('contributes');
});

it('downgrades an invalid contributes block to a warning at apiVersion 1', () => {
  const result = parsePackageManifest({
    name: 'demo',
    contributes: { gateway: { actions: 'ping' } },
  });
  expect(result.ok).toBe(true);
  expect(result.manifest?.contributes).toBeUndefined();
  expect(result.warnings.some((w) => w.includes('legacy-contributes'))).toBe(true);
});
```

在 `gateway/tests/unit/plugins/package-validator.test.ts` 内新增一个 `describe('contributes enforcement')`（该文件已 import `buildActivatedContributions` 与 `UnifiedPluginContributions`，并已有 `CANONICAL`）：

```ts
describe('contributes enforcement', () => {
  const declared = (gateway: Record<string, unknown>) => ({ gateway } as any);

  it('rejects an action that is not declared', () => {
    const built = buildActivatedContributions(
      'example',
      { actions: { ping: { handler: () => null }, pong: { handler: () => null } } },
      CANONICAL,
      declared({ actions: ['ping'] }),
    );
    expect(built.ok).toBe(false);
    expect(built.ok ? [] : built.errors).toContain(
      'action "pong" is not declared in plugin.json contributes.gateway.actions',
    );
  });

  it('rejects an event that is not declared', () => {
    const built = buildActivatedContributions(
      'example',
      { events: [{ type: 'plugin:example:other' }] },
      CANONICAL,
      declared({ events: ['plugin:example:ping'] }),
    );
    expect(built.ok).toBe(false);
    expect(built.ok ? [] : built.errors).toContain(
      'event "plugin:example:other" is not declared in plugin.json contributes.gateway.events',
    );
  });

  it('rejects a tool that is not declared', () => {
    const built = buildActivatedContributions(
      'example',
      { tools: [{ name: 'nope', description: 'x', inputSchema: { type: 'object' }, handler: () => null }] },
      CANONICAL,
      declared({ tools: [{ name: 'ghost', description: 'g', inputSchema: { type: 'object' } }] }),
    );
    expect(built.ok).toBe(false);
    expect(built.ok ? [] : built.errors).toContain(
      'tool "nope" is not declared in plugin.json contributes.gateway.tools',
    );
  });

  it('allows a declared tool that is not registered (conditional registration)', () => {
    const built = buildActivatedContributions(
      'example',
      { actions: { ping: { handler: () => null } } },
      CANONICAL,
      declared({
        actions: ['ping'],
        tools: [{ name: 'ghost', description: 'g', inputSchema: { type: 'object' } }],
      }),
    );
    expect(built.ok).toBe(true);
  });

  it('leaves every plane unconstrained when nothing is declared', () => {
    const built = buildActivatedContributions(
      'example',
      { actions: { anything: { handler: () => null } } },
      CANONICAL,
    );
    expect(built.ok).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest --runInBand tests/unit/plugins/package-manifest.test.ts tests/unit/plugins/package-validator.test.ts
```

Expected: FAIL。manifest 两例失败于 `contributes` 为 `undefined`；validator 四例里三例失败于 `expected true to be false` 一类断言（当前不比对）。

- [ ] **Step 3: 实现 manifest 归一化**

`gateway/src/plugins/package-manifest.ts`：

1. 顶部加 `import { validatePluginManifestContributes, type PluginManifestContributes } from '@mafw/plugin-contract';`
2. `NormalizedPackageManifest` 加字段 `contributes?: PluginManifestContributes;`
3. 在 `parsePackageManifest` 中、`const permissions = readPermissions(...)` 之后（此时 `apiVersion` 已知）插入：

```ts
let contributes: PluginManifestContributes | undefined;
if (raw.contributes !== undefined) {
  const validated = validatePluginManifestContributes(raw.contributes);
  if (validated.ok) contributes = validated.value;
  else if (apiVersion === 1) warnings.push(`legacy-contributes: ${validated.error}`);
  else errors.push(`contributes: ${validated.error}`);
}
```

4. 成功返回的 `manifest` 对象里加 `...(contributes !== undefined ? { contributes } : {}),`

- [ ] **Step 4: 实现 validator 比对**

`gateway/src/plugins/package-validator.ts`：

1. 顶部 import 增加类型 `PluginManifestContributes`（与已有的 `@mafw/plugin-contract` import 合并）。
2. 新增内部函数，放在 `analyze` 之前，签名逐字如下：

```ts
function enforceDeclared(
  declared: PluginManifestContributes | undefined,
  actions: CollectedActions,
  events: CollectedEvents,
  tools: CollectedTools,
  errors: string[],
): void
```

行为由三条规定（错误文案见本任务 Interfaces，逐字使用）：每个**已声明**的面构造允许集合，把该面**实际**声明的名字逐个比对，不在集合内则 push 错误；未声明的面直接跳过；只做“实际 ⊆ 声明”一个方向，绝不检查“声明 ⊆ 实际”。

3. `analyze` 增加第 4 参数 `declared?: PluginManifestContributes`（与 `buildActivatedContributions` 同名同型），在第 572 行 `const observers = collectObservers(...)` 之后调用：

```ts
enforceDeclared(declared, actions, events, tools, errors);
```

4. `buildActivatedContributions` 增加第 4 参数并透传给 `analyze(packageName, contributions, canonicalTypes, declared)`。

- [ ] **Step 5: 跑测试确认通过**

```bash
npx jest --runInBand tests/unit/plugins/package-manifest.test.ts tests/unit/plugins/package-validator.test.ts
```

Expected: PASS（新增 8 例全绿，原有用例不变）。

- [ ] **Step 6: 提交**

```bash
git add gateway/src/plugins/package-manifest.ts gateway/src/plugins/package-validator.ts \
  gateway/tests/unit/plugins/package-manifest.test.ts gateway/tests/unit/plugins/package-validator.test.ts
git commit -m "feat(plugin): enforce plugin.json contributes as a registration bound"
```

---

### Task 2: 接线层——两条激活路径传声明 + http 检查

**Files:**
- Modify: `gateway/src/plugins/package-host.ts:1239`（worker 路径）与 `:1325`（trusted 路径）
- Modify: `gateway/src/plugins/package-host.ts`（`http: false` 检查，紧跟 `httpRecorder.seal()` 之后）
- Modify: `docs/guides/plugin-authoring.md`（新增 `contributes` 小节，说明“声明即约束 / 未声明不约束 / 声明是上界”）
- Test: `gateway/tests/unit/plugins/package-host.test.ts`
- Test: `gateway/tests/unit/plugins/package-host-worker.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `buildActivatedContributions(..., declared?)`
- Produces: 无新导出；错误文案 `http routes are not declared (contributes.gateway.http is false)`

- [ ] **Step 1: 写失败的测试**

`gateway/tests/unit/plugins/package-host-worker.test.ts`：把 `writePackage` 增加第 3 个参数，并在 `describe` 内新增两例。

```ts
function writePackage(dir: string, name: string, contributes?: Record<string, unknown>): string {
  // ...原实现不变...
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({
    name,
    version: '1.0.0',
    main: 'index.js',
    apiVersion: 2,
    kind: 'untrusted',
    permissions: ['actions'],
    ...(contributes !== undefined ? { contributes } : {}),
  }));
  // ...
}

it('rejects a worker action that the manifest does not declare', async () => {
  const { host, dir } = makeHost({ contributions: { actions: { echo: {}, nope: {} } } });
  writePackage(dir, 'acme', { gateway: { actions: ['echo'] } });
  await host.reload();
  const state = host.getState().find((entry) => entry.name === 'acme');
  expect(state).toMatchObject({ status: 'error' });
  expect(state?.error).toContain('action "nope" is not declared');
  host.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

it('accepts a worker whose declared actions match', async () => {
  const { host, dir } = makeHost({ contributions: { actions: { echo: {} } } });
  writePackage(dir, 'acme', { gateway: { actions: ['echo'] } });
  await host.reload();
  expect(host.getState().find((entry) => entry.name === 'acme')).toMatchObject({ status: 'ok' });
  host.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});
```

`gateway/tests/unit/plugins/package-host.test.ts` 新增一个 `describe('PluginHost contributes enforcement')`，用目录包 + `plugin.json`（该文件已有 `mkHost`）：

```ts
describe('PluginHost contributes enforcement', () => {
  let dir: string;

  function writeDirPackage(manifest: Record<string, unknown>, body: string): void {
    const root = path.join(dir, String(manifest.name));
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(root, 'index.js'), body);
  }

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-contributes-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('activates a v1 package that declares no contributes', async () => {
    writeDirPackage({ name: 'legacy' }, `
module.exports = { name: 'legacy', async activate() { return { actions: { any: { handler: () => null } } }; } };
`);
    const host = mkHost(dir);
    await host.init();
    expect(host.getState()[0]).toMatchObject({ status: 'ok' });
    host.stop();
  });

  it('rejects http routes when contributes.gateway.http is false', async () => {
    writeDirPackage({ name: 'noroute', apiVersion: 2, contributes: { gateway: { http: false } } }, `
module.exports = { name: 'noroute', async activate(ctx) {
  ctx.http.route('GET', '/ping', () => ({ body: 'pong' }));
  return {};
} };
`);
    const host = mkHost(dir);
    await host.init();
    const state = host.getState().find((entry) => entry.name === 'noroute');
    expect(state).toMatchObject({ status: 'error' });
    expect(state?.error).toContain('http routes are not declared');
    host.stop();
  });

  it('accepts http routes when contributes.gateway.http is true', async () => {
    writeDirPackage({ name: 'routed', apiVersion: 2, contributes: { gateway: { http: true } } }, `
module.exports = { name: 'routed', async activate(ctx) {
  ctx.http.route('GET', '/ping', () => ({ body: 'pong' }));
  return {};
} };
`);
    const host = mkHost(dir);
    await host.init();
    expect(host.getState().find((entry) => entry.name === 'routed')).toMatchObject({ status: 'ok' });
    host.stop();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest --runInBand tests/unit/plugins/package-host.test.ts tests/unit/plugins/package-host-worker.test.ts
```

Expected: FAIL。worker 两例中第一例状态为 `ok`；host 的 `http: false` 一例状态为 `ok`（当前不检查）。v1 与 `http: true` 两例应已通过（回归基线）。

- [ ] **Step 3: 实现接线**

`gateway/src/plugins/package-host.ts`：

1. 在 `activate()` 中，`const built = buildActivatedContributions(modName, raw, this.canonicalTypes);`（约 1325 行）改为传入声明：
   `buildActivatedContributions(modName, raw, this.canonicalTypes, parsedManifest?.manifest?.contributes)`
   —— 同函数内已有 `parsedManifest`，直接复用。
2. 在同函数 `httpRecorder.seal()` 之后加入：

```ts
if (parsedManifest?.manifest?.contributes?.gateway?.http === false
  && httpRecorder.entries.length > 0) {
  throw new Error('http routes are not declared (contributes.gateway.http is false)');
}
```

3. 在 worker 路径（约 1239 行）把 `buildActivatedContributions(desc.name, {...}, this.canonicalTypes)` 改为
   `buildActivatedContributions(desc.name, {...}, this.canonicalTypes, parsed.manifest.contributes)`。
   该处 `parsed` 已校验为 `ok` 且 `manifest` 存在（1200 行前已断言）。

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest --runInBand tests/unit/plugins/package-host.test.ts tests/unit/plugins/package-host-worker.test.ts
```

Expected: PASS（新增 5 例全绿）。

- [ ] **Step 5: 文档**

`docs/guides/plugin-authoring.md` 增加一小节（放在 manifest 字段说明之后）：

- `contributes` 是**上界不是清单**：声明了某面，`activate()` 不得注册超出集合的条目；未声明的面不受约束；声明了但未注册合法。
- `contributes.gateway.http: false` 时 `ctx.http.route/ws` 一旦调用即激活失败。
- `apiVersion 1` 的包该字段校验失败只产生 `legacy-contributes` warning，不影响激活。

- [ ] **Step 6: 提交**

```bash
git add gateway/src/plugins/package-host.ts gateway/tests/unit/plugins/package-host.test.ts \
  gateway/tests/unit/plugins/package-host-worker.test.ts docs/guides/plugin-authoring.md
git commit -m "feat(plugin): wire manifest contributes into both activation paths"
```

---

### Task 3: 开关层——tools / observers 默认生效

**Files:**
- Modify: `gateway/src/runtime/v2-live.ts`（`readKernelV2LiveFlags` 语义 + 两条报错文案里的提示）
- Modify: `docs/guides/plugin-authoring.md:265,287`（把“需要 `=1`”改成“默认开启，`=0` 关闭”）
- Test: `gateway/tests/unit/runtime/v2-live.test.ts`
- Test: `gateway/tests/integration/kernel-v2-plugin-host.test.ts`

**Interfaces:**
- `readKernelV2LiveFlags(env: NodeJS.ProcessEnv = process.env): KernelV2LiveFlags` —— 返回类型不变
- 语义：`'0'` / `'false'` → `false`；其余（含未设置、`'1'`、`'true'`）→ `true`

- [ ] **Step 1: 改写/新增测试**

`gateway/tests/unit/runtime/v2-live.test.ts` 前两个用例替换为：

```ts
test('flags default on and accept 0/false as the kill switch', () => {
  expect(readKernelV2LiveFlags({})).toEqual({ observers: true, tools: true });
  expect(
    readKernelV2LiveFlags({ MAFW_KERNEL_V2_TOOLS: '0', MAFW_KERNEL_V2_OBSERVERS: 'false' }),
  ).toEqual({ observers: false, tools: false });
  expect(
    readKernelV2LiveFlags({ MAFW_KERNEL_V2_OBSERVERS: '1', MAFW_KERNEL_V2_TOOLS: 'true' }),
  ).toEqual({ observers: true, tools: true });
});

test('the bridge is live without any env', async () => {
  const live = createKernelV2Live({ env: {} })!;
  expect(live).not.toBeNull();
  expect(live.toolsEnabled).toBe(true);
  expect(live.observersEnabled).toBe(true);
  await live.dispose();
});

test('an explicit 0 disables one plane and keeps the other live', () => {
  const live = createKernelV2Live({ env: { MAFW_KERNEL_V2_TOOLS: '0' } })!;
  expect(live.toolsEnabled).toBe(false);
  expect(live.observersEnabled).toBe(true);
  expect(live.toolFactory()).toBeUndefined();
  expect(() => live.registerTool(tool())).toThrow(/MAFW_KERNEL_V2_TOOLS/);
  return live.dispose();
});

test('events dispatched before registration are not replayed', async () => {
  const live = createKernelV2Live({ env: {} })!;
  const seen: string[] = [];
  live.observe({ type: 'turn.completed', sessionID: 's1' });
  const unregister = live.registerObserver({
    id: 'a',
    onEvent: (event) => { seen.push(event.type); },
  });
  live.observe({ type: 'turn.completed', sessionID: 's1' });
  await live.drain();
  expect(seen).toEqual(['turn.completed']);
  unregister();
  await live.dispose();
});
```

`gateway/tests/integration/kernel-v2-plugin-host.test.ts:39`：把
`env: { MAFW_KERNEL_V2_OBSERVERS: '1', MAFW_KERNEL_V2_TOOLS: '1' }` 改为 `env: {}`，
让该集成用例证明“默认就生效”。

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest --runInBand tests/unit/runtime/v2-live.test.ts tests/integration/kernel-v2-plugin-host.test.ts
```

Expected: FAIL。`readKernelV2LiveFlags({})` 返回 `{observers:false,tools:false}`；`createKernelV2Live({env:{}})` 为 `null`（后续断言抛 `Cannot read properties of null`）。

- [ ] **Step 3: 实现**

`gateway/src/runtime/v2-live.ts`：

1. `enabled()` 替换为 kill-switch 语义：

```ts
/** Phase 3 flags shipped; they are now kill switches, not opt-ins. */
function disabled(value: string | undefined): boolean {
  return value === '0' || value === 'false';
}
```

2. `readKernelV2LiveFlags` 改为 `{ observers: !disabled(env.MAFW_KERNEL_V2_OBSERVERS), tools: !disabled(env.MAFW_KERNEL_V2_TOOLS) }`。
3. 两处抛错文案改为指向关闭动作：`'kernel-v2 tools are disabled (MAFW_KERNEL_V2_TOOLS=0)'`、`'kernel-v2 observers are disabled (MAFW_KERNEL_V2_OBSERVERS=0)'`。

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest --runInBand tests/unit/runtime/v2-live.test.ts tests/integration/kernel-v2-plugin-host.test.ts
```

Expected: PASS（4 例新/改 + 集成 1 例）。

- [ ] **Step 5: 文档**

`docs/guides/plugin-authoring.md` 第 265 / 287 行：把「需要 `MAFW_KERNEL_V2_TOOLS=1`」改为
「默认生效；需要关闭时设 `MAFW_KERNEL_V2_TOOLS=0`」。`docs/architecture/plugin.md` 的现状段同步一句。

- [ ] **Step 6: 提交**

```bash
git add gateway/src/runtime/v2-live.ts gateway/tests/unit/runtime/v2-live.test.ts \
  gateway/tests/integration/kernel-v2-plugin-host.test.ts docs/guides/plugin-authoring.md \
  docs/architecture/plugin.md
git commit -m "feat(plugin): make tool and observer seams live by default"
```

---

## 验收门禁（终审前必跑）

```bash
# 1. 三个改动文件的类型门禁（不带 -p 是假绿）
cd gateway && npx tsc --noEmit -p tsconfig.json

# 2. gateway 全量（zeromq 句柄可能拖住退出）
cd gateway && npx jest --runInBand --forceExit

# 3. 契约包不变式
npm run test:plugin-contract
```

Expected:
- `tsc` 无输出。
- jest 全绿，并记录 **新增用例数** 与 **全量通过数**（用户要求交付时汇报）。
- 已知 env-red 不计入本次判定：`plugin-package-e2e`、`claude-adapter-acceptance`、`claude-adapter-coverage`
  （缺 `@anthropic-ai/claude-agent-sdk`）。若这三个 suite 失败但其余全绿，视为通过并如实记录。

## 交付记录

合并后在 `docs/releases/` 新增 `2026-11-16-plugin-insertion-points.md`，写清：
版本号、commit 哈希、新增测试数、全量通过数、`contributes` 语义表、kill switch 说明。
