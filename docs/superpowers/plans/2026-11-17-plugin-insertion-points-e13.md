# E13 插入点补完 + 单文件边界 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 observers 纳入 `contributes` 声明、清掉 E12 遗留的两类诊断问题，并收回单文件包的 tools/observers/http 三个能力面。

**Architecture:** 三层递增。契约层给 `PluginGatewayContributes` 加 `observers: string[]`；纯层 `enforceDeclared` 增加 observer 比对并在已有错误时提前返回；host 层在激活末尾拒绝单文件包的三个面。doctor 只增加可见性，不改变判决。

**Tech Stack:** TypeScript、Jest（gateway）、`node:test`（plugin-contract）、`@mafw/plugin-contract`。

**Spec:** `docs/superpowers/specs/2026-11-17-plugin-insertion-points-e13-design.md`

## Global Constraints

- 契约新增字段必须是**可选**的，且旧包不声明时行为完全不变。
- 错误文案逐字固定（见各任务 Interfaces）。
- v1 包 `contributes` 形状非法仍是 warning-only，不构成约束（E12 语义不变）。
- 单文件包**继续加载**，只收回 tools / observers / http；ui / actions / events / legacy 不受影响。
- 不改 `boot.ts`、不引入 DI / profile / bundle、不动 `~/.mafw/plugins` 目录结构。
- 只 ADD 本任务列出的文件，禁止 `git add -A`（共享 main checkout，其他会话有未提交改动）。
- 提交信息用 `feat(plugin): ...` / `chore(plugin): ...`。

## Review Focus

- **v1 合法 observers 声明必须构成约束**，不能因为「v1 是 legacy」就跳过 observers 面。→ Task 1 步骤 1 第 3 例。
- **声明多于注册必须合法**（observers 也适用上界不是清单）。→ Task 1 步骤 1 第 4 例。
- **去噪只改诊断顺序，不改判决**：包有 shape 错误时先报 shape，修好后越界仍必须报出来。→ Task 2 步骤 1 第 1 例（shape + 越界同包只报 shape）+ Task 1 的越界用例（干净包上报越界）。
- **单文件包收缩后仍能跑通 ui/actions**：不能把整类包打死。→ Task 3 步骤 1 第 3 例。
- **单文件包同时命中多个面时错误要列全**。→ Task 3 步骤 1 第 4 例。

---

### Task 1: `contributes.gateway.observers`

**Files:**
- Modify: `packages/plugin-contract/src/types.ts`（`PluginGatewayContributes` 加字段）
- Modify: `packages/plugin-contract/src/validate.ts`（`GATEWAY_CONTRIBUTES_KEYS` + 读取）
- Test: `packages/plugin-contract/src/validate.test.ts`
- Modify: `gateway/src/plugins/package-validator.ts`（`enforceDeclared` 增加 observer 比对）
- Test: `gateway/tests/unit/plugins/package-validator.test.ts`
- Modify: `docs/guides/plugin-authoring.md`（§1.1 表格加一行 + 一句说明）

**Interfaces:**
- Produces: `PluginGatewayContributes.observers?: string[]`（observer id 列表）
- 错误文案（逐字）：`observer "<id>" is not declared in plugin.json contributes.gateway.observers`

- [ ] **Step 1: 写失败的测试**

`packages/plugin-contract/src/validate.test.ts`（该文件用 `node:test` 的 `test()` + `assert`，追加在其它 contributes 用例旁）：

```ts
test("manifest contributes: accepts gateway observers", () => {
  const result = validatePluginManifestContributes({ gateway: { observers: ["audit", "metrics"] } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value.gateway?.observers : undefined, ["audit", "metrics"]);
});

test("manifest contributes: rejects a non-array observers value", () => {
  const result = validatePluginManifestContributes({ gateway: { observers: "audit" } });
  assert.equal(result.ok, false);
});
```

`gateway/tests/unit/plugins/package-validator.test.ts`，追加进已有 `describe('contributes enforcement')`：

```ts
it('rejects an observer that is not declared', () => {
  const built = buildActivatedContributions(
    'example',
    {
      observers: [
        { id: 'audit', onEvent: () => {} },
        { id: 'metrics', onEvent: () => {} },
      ],
    },
    CANONICAL,
    declared({ observers: ['audit'] }),
  );
  expect(built.ok).toBe(false);
  expect(built.ok ? [] : built.errors).toContain(
    'observer "metrics" is not declared in plugin.json contributes.gateway.observers',
  );
});

it('allows a declared observer that is not registered', () => {
  const built = buildActivatedContributions(
    'example',
    { actions: { ping: { handler: () => null } } },
    CANONICAL,
    declared({ observers: ['ghost'] }),
  );
  expect(built.ok).toBe(true);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm run test:plugin-contract 2>&1 | Select-Object -Last 15
cd gateway && npx jest --runInBand tests/unit/plugins/package-validator.test.ts
```

Expected: FAIL。契约用例报 `observers` 未知键；validator 两例未拦截（`built.ok === true`）。

- [ ] **Step 3: 实现契约**

`packages/plugin-contract/src/types.ts`，在 `PluginGatewayContributes` 中 `tools` 之后加：

```ts
  /**
   * Observer ids the package may subscribe to canonical events with.
   * Ids only: `onEvent` / `filter` / `timeoutMs` always come from `activate()`.
   */
  observers?: string[]
```

`packages/plugin-contract/src/validate.ts`：

1. `GATEWAY_CONTRIBUTES_KEYS` 数组加入 `"observers"`。
2. 在 `const tools = readToolDescriptors(value.gateway.tools, "manifest contributes.gateway.tools", errors)` 之后加：

```ts
      const observers = readStringList(value.gateway.observers, "manifest contributes.gateway.observers", errors)
      if (observers !== undefined) gateway.observers = observers
```

- [ ] **Step 4: 实现 validator 比对**

`gateway/src/plugins/package-validator.ts`：

1. `enforceDeclared` 增加参数 `observers: CollectedObservers`（放在 `tools` 之后、`errors` 之前）。
2. 在 tools 分支之后加一个同构分支：声明集合取 `gateway.observers`，实际集合取 `observers.declarations.map((d) => d.id)`，越界 push 逐字错误文案。
3. 调用点补传 `observers`。

- [ ] **Step 5: 跑测试确认通过**

契约包测试直接跑 `src/`，但 **gateway 通过 `dist` 消费契约**，所以改完契约必须先重建并同步到 gateway 的 node_modules：

```bash
npm run build -w @mafw/plugin-contract
node scripts/stage-plugin-contract.mjs --node-modules gateway/node_modules
npm run test:plugin-contract 2>&1 | Select-Object -Last 8
cd gateway && npx jest --runInBand tests/unit/plugins/package-validator.test.ts
cd gateway && npx tsc --noEmit -p tsconfig.json
```

Expected: PASS（契约 +2、validator +2），tsc 无输出。
`packages/plugin-contract/dist` 是 gitignored，不要提交它。

- [ ] **Step 6: 文档 + 提交**

`docs/guides/plugin-authoring.md` §1.1 的 plane 表格加一行：

```
| `observers` | 允许订阅的 observer id 数组 | `observer "<id>" is not declared in plugin.json contributes.gateway.observers` |
```

并在表下补一句：observer 的 `onEvent` / `filter` / `timeoutMs` 只能来自 `activate()`，`contributes` 只声明 id 以便安装时审查。

```bash
git add packages/plugin-contract/src/types.ts packages/plugin-contract/src/validate.ts \
  packages/plugin-contract/src/validate.test.ts gateway/src/plugins/package-validator.ts \
  gateway/tests/unit/plugins/package-validator.test.ts docs/guides/plugin-authoring.md
git commit -m "feat(plugin): let manifests declare observer ids as a registration bound"
```

---

### Task 2: 诊断去噪 + desktop 声明可见

**Files:**
- Modify: `gateway/src/plugins/package-validator.ts`（`enforceDeclared` 早退）
- Test: `gateway/tests/unit/plugins/package-validator.test.ts`
- Modify: `gateway/src/plugins/plugin-doctor.ts`（新增 `contributes-desktop` 检查）
- Test: `gateway/tests/unit/plugins/plugin-doctor.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `enforceDeclared(declared, actions, events, tools, observers, errors)`
- Produces: doctor check id `contributes-desktop`，status `warn`

- [ ] **Step 1: 写失败的测试**

`package-validator.test.ts` 的 `describe('contributes enforcement')` 追加：

```ts
it('reports only the shape error when the same action is also undeclared', () => {
  const built = buildActivatedContributions(
    'example',
    { actions: { pong: { handler: () => null, timeoutMs: 0 } } },
    CANONICAL,
    declared({ actions: ['ping'] }),
  );
  expect(built.ok).toBe(false);
  const errors = built.ok ? [] : built.errors;
  expect(errors.some((error) => error.includes('timeoutMs'))).toBe(true);
  expect(errors.some((error) => error.includes('is not declared'))).toBe(false);
});
```

`plugin-doctor.test.ts` 追加：

```ts
it('warns that desktop contributions are not enforced by this host', async () => {
  const { doctor, dir } = makeDoctor();
  writePackage(dir, 'acme', { apiVersion: 2, contributes: { desktop: { ui: {} } } });
  const report = await doctor.check('acme');
  expect(report.checks.find((entry) => entry.id === 'contributes-desktop')?.status).toBe('warn');
});

it('adds no contributes-desktop check without a desktop declaration', async () => {
  const { doctor, dir } = makeDoctor();
  writePackage(dir, 'acme', { version: '1.0.0' });
  const report = await doctor.check('acme');
  expect(report.checks.find((entry) => entry.id === 'contributes-desktop')).toBeUndefined();
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd gateway && npx jest --runInBand tests/unit/plugins/package-validator.test.ts tests/unit/plugins/plugin-doctor.test.ts
```

Expected: FAIL。第一条 validator 用例断言 `is not declared` 不出现 → 当前会出现；doctor 两例 `contributes-desktop` 不存在。

- [ ] **Step 3: 实现**

`package-validator.ts`：`enforceDeclared` 第一行加

```ts
  // The package already fails shape/identity validation; a derived "not
  // declared" error per item would bury the first cause.
  if (errors.length > 0) return;
```

`plugin-doctor.ts`：在 `manifest-warnings` 检查之后加

```ts
    // 1c. contributes-desktop
    // The contract validates the shape of `contributes.desktop`, but this host
    // has no execution point for it (desktop loads `ui` from the client
    // snapshot). Surface the gap instead of implying it is enforced.
    if (parsed?.manifest?.contributes?.desktop !== undefined) {
      checks.push(check(
        'contributes-desktop',
        'warn',
        'desktop contributions are declared but not enforced by this host',
      ));
    }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd gateway && npx jest --runInBand tests/unit/plugins/package-validator.test.ts tests/unit/plugins/plugin-doctor.test.ts
```

Expected: PASS（validator +2、doctor +2）。

- [ ] **Step 5: 提交**

```bash
git add gateway/src/plugins/package-validator.ts gateway/src/plugins/plugin-doctor.ts \
  gateway/tests/unit/plugins/package-validator.test.ts gateway/tests/unit/plugins/plugin-doctor.test.ts
git commit -m "chore(plugin): drop derived bound errors and surface unenforced desktop declarations"
```

---

### Task 3 附加：Task 2 复审的 4 条 follow-up（与本任务同批交付）

复审通过但留了 4 条小项，全部是 1-3 行改动，随 Task 3 一起提交并在其复审中覆盖：

1. `gateway/src/plugins/package-validator.ts`：把早退注释改准确——
   `// ... a derived "not declared" error per item would bury the first cause.` 改为
   `// ... a derived "not declared" error for any plane would bury the first cause.`
2. 同文件同测试文件加一条跨平面抑制用例：

```ts
it('suppresses bound errors for every plane when any plane has a shape error', () => {
  const built = buildActivatedContributions(
    'example',
    {
      actions: { pong: { handler: () => null, timeoutMs: 0 } },
      observers: [{ id: 'other', onEvent: () => {} }],
    },
    CANONICAL,
    declared({ actions: ['ping'], observers: ['audit'] }),
  );
  expect(built.ok).toBe(false);
  const errors = built.ok ? [] : built.errors;
  expect(errors.some((error) => error.includes('is not declared'))).toBe(false);
});
```

3. `gateway/tests/unit/plugins/plugin-doctor.test.ts` 补两条触发边界（空 desktop 块要触发；contributes 本身非法时不触发）：

```ts
it('fires contributes-desktop for a bare desktop block', async () => {
  const { doctor, dir } = makeDoctor();
  writePackage(dir, 'acme', { apiVersion: 2, contributes: { desktop: {} } });
  const report = await doctor.check('acme');
  expect(report.checks.find((entry) => entry.id === 'contributes-desktop')?.status).toBe('warn');
});

it('does not fire contributes-desktop when the contributes block is invalid', async () => {
  const { doctor, dir } = makeDoctor();
  writePackage(dir, 'acme', { apiVersion: 2, contributes: { gateway: { actions: 'x' } } });
  const report = await doctor.check('acme');
  expect(report.checks.find((entry) => entry.id === 'manifest')?.status).toBe('fail');
  expect(report.checks.find((entry) => entry.id === 'contributes-desktop')).toBeUndefined();
});
```

4. `gateway/src/plugins/plugin-doctor.ts`：把 `parsed?.manifest?.contributes?.desktop` 改为
   `manifest?.contributes?.desktop`，与该方法其余部分已解构的 `manifest` 保持一致（无行为变化）。

---

### Task 3: 单文件包收回 tools / observers / http

**Files:**
- Modify: `gateway/src/plugins/package-host.ts`（`activate()` 末尾校验）
- Modify: `gateway/src/plugins/plugin-doctor.ts`（单文件警告文案）
- Test: `gateway/tests/unit/plugins/package-host.test.ts`
- Test: `gateway/tests/unit/plugins/plugin-doctor.test.ts`
- Modify: `docs/guides/plugin-authoring.md`、`docs/architecture/plugin.md`

**Interfaces:**
- 错误文案（逐字，plane 顺序固定 `tools`、`observers`、`http`）：
  `packages without plugin.json cannot contribute <planes joined by ", ">; ship a directory package with plugin.json`
- 判据：`parsedManifest?.manifest === undefined` —— 单文件 `.js` 与**缺 `plugin.json` 的目录包**都算。
  （终审修正：初版判据是 `desc.pkgDir === undefined`，漏掉目录形态，等于只关了一半。）

- [ ] **Step 1: 写失败的测试**

`package-host.test.ts` 新增 `describe('PluginHost single-file boundaries')`（沿用该文件的 `mkHost(dir)` 与 `fs.mkdtempSync` 模式，注意把 `host` 提到 describe 作用域并在 `afterEach` 里 `stop()`，与该文件其它 describe 一致）：

```ts
it('rejects tools from a single-file package', async () => {
  fs.writeFileSync(path.join(dir, 'solo.js'), `
module.exports = { name: 'solo', async activate() {
  return { tools: [{ name: 'echo', description: 'e', inputSchema: { type: 'object' }, handler: () => null }] };
} };
`);
  host = mkHost(dir);
  await host.init();
  const state = host.getState().find((entry) => entry.name === 'solo');
  expect(state).toMatchObject({ status: 'error' });
  expect(state?.error).toContain('packages without plugin.json cannot contribute tools');
});

it('rejects http routes from a single-file package', async () => {
  fs.writeFileSync(path.join(dir, 'routed.js'), `
module.exports = { name: 'routed', async activate(ctx) {
  ctx.http.route('GET', '/ping', () => ({ body: 'pong' }));
  return { actions: { ping: { handler: () => null } } };
} };
`);
  host = mkHost(dir);
  await host.init();
  const state = host.getState().find((entry) => entry.name === 'routed');
  expect(state).toMatchObject({ status: 'error' });
  expect(state?.error).toContain('packages without plugin.json cannot contribute http');
});

it('names every denied plane in one message', async () => {
  fs.writeFileSync(path.join(dir, 'both.js'), `
module.exports = { name: 'both', async activate(ctx) {
  ctx.http.route('GET', '/x', () => ({ body: 'x' }));
  return {
    tools: [{ name: 'echo', description: 'e', inputSchema: { type: 'object' }, handler: () => null }],
    observers: [{ id: 'audit', onEvent: () => {} }],
  };
} };
`);
  host = mkHost(dir);
  await host.init();
  const state = host.getState().find((entry) => entry.name === 'both');
  expect(state).toMatchObject({ status: 'error' });
  expect(state?.error).toContain('packages without plugin.json cannot contribute tools, observers, http');
});

it('still activates a single-file package with ui and actions', async () => {
  fs.writeFileSync(path.join(dir, 'viewer.js'), `
module.exports = { name: 'viewer', async activate() {
  return { ui: { panels: [{ id: 'view', title: 'View', viewAction: 'load' }] },
           actions: { load: { handler: async () => ({ ok: true }) } } };
} };
`);
  host = mkHost(dir);
  await host.init();
  expect(host.getState().find((entry) => entry.name === 'viewer')).toMatchObject({ status: 'ok' });
  expect(host.getClientSnapshot().plugins).toHaveLength(1);
});
```

`plugin-doctor.test.ts` 追加一条，固化单文件警告仍在且文案点明被收回的面：

```ts
it('tells the operator which planes a single-file package loses', async () => {
  const { doctor, dir } = makeDoctor();
  fs.writeFileSync(path.join(dir, 'solo.js'), 'module.exports = { name: "solo" };');
  const report = await doctor.check('solo');
  const manifest = report.checks.find((entry) => entry.id === 'manifest');
  expect(manifest?.status).toBe('warn');
  expect(manifest?.message).toContain('tools, observers and http');
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd gateway && npx jest --runInBand tests/unit/plugins/package-host.test.ts tests/unit/plugins/plugin-doctor.test.ts
```

Expected: FAIL。前三条单文件用例当前 `status: 'ok'`；doctor 文案当前不含 `tools, observers and http`。

- [ ] **Step 3: 实现 host 校验**

在 `gateway/src/plugins/package-host.ts` 的 `activate()` 里、`buildActivatedContributions(...)` 与 `httpRecorder.entries` 都可用的位置（`const activated = built.value;` 之后、legacy 贡献组装之前）插入：

```ts
    // A package without a manifest has no `contributes`, no declared
    // permissions and no install-time consent — whether it is a bare `.js`
    // file or a directory without plugin.json. It may keep contributing data
    // planes (ui/actions/events/legacy) but must not widen the agent's tool
    // surface, subscribe to canonical events, or publish HTTP routes.
    if (parsedManifest?.manifest === undefined) {
      const denied: string[] = [];
      if (activated.tools.length > 0) denied.push('tools');
      if (activated.observers.length > 0) denied.push('observers');
      if (httpRecorder.entries.length > 0) denied.push('http');
      if (denied.length > 0) {
        throw new Error(
          `packages without plugin.json cannot contribute ${denied.join(', ')}; `
          + 'ship a directory package with plugin.json',
        );
      }
    }
```

注意：此处 `httpRecorder.seal()` 已在 `finally` 中执行过，`entries` 是只读快照，可直接读。
若发现某条既有测试用单文件夹具断言 tools/observers/http，**把它改成目录包夹具**并在报告里记下——它固化的是本波要收回的行为。

`plugin-doctor.ts` 里单文件那条：

```ts
      checks.push(check('manifest', 'warn', 'legacy single-file package; directory package recommended'));
```

改为

```ts
      checks.push(check(
        'manifest',
        'warn',
        'legacy single-file package; tools, observers and http are denied without plugin.json',
      ));
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd gateway && npx jest --runInBand tests/unit/plugins/package-host.test.ts tests/unit/plugins/plugin-doctor.test.ts
```

Expected: PASS（host +4、doctor +1）。

- [ ] **Step 5: 文档 + 提交**

`docs/guides/plugin-authoring.md` 在「包目录」一节或 §1.1 末尾加：

- 单文件 `.js` 包仍被支持，但**不能贡献** `tools` / `observers` / `http`（没有 manifest 就没有声明与授权）；需要这三者的包必须提供 `plugin.json`。

`docs/architecture/plugin.md` 现状段补一句同样的边界。

```bash
git add gateway/src/plugins/package-host.ts gateway/src/plugins/plugin-doctor.ts \
  gateway/tests/unit/plugins/package-host.test.ts gateway/tests/unit/plugins/plugin-doctor.test.ts \
  docs/guides/plugin-authoring.md docs/architecture/plugin.md
git commit -m "feat(plugin): deny tools, observers and http to single-file packages"
```

---

## 收尾（Task 3 之后）

1. `gateway/package.json` 版本 `4.16.1` → `4.17.0`。
2. 新增 `docs/releases/2026-11-17-plugin-insertion-points-e13.md`：三个 commit、语义表（含 observers 行与单文件行）、
   「单文件包仍是主进程 trusted 代码」的已知风险、新增用例数、全量通过数。
3. 门禁：

```bash
cd gateway && npx tsc --noEmit -p tsconfig.json
npm run test:plugin-contract
cd gateway && npx jest --runInBand --forceExit
```

Expected：tsc 无输出；契约全绿；gateway 全量里只允许出现与本波无关的他人红（如实记录，不得据为己有或改他人文件）。
