# Phase 6 Trust Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 6A → 6B → 6C 落地 Phase 6：统一插件包的 manifest v2 / 安装同意 / 完整性 / 审计 / doctor / kill switch，再用 worker 隔离 untrusted 包，最后补兼容门、last-known-good 与回滚演练。

**Architecture:** 6A 在现有 `gateway/src/plugins/*` 上增量加 manifest 解析、状态 v2、审计、doctor 与安全策略；6B 新增 `gateway/src/plugins/worker/*`，由 `PluginHost` 按 `kind` 分流到 worker；6C 新增磁盘 last-good 快照与健康窗口，并用 Jest drill 固化回滚行为。所有阶段都不改变 memory / runtime / Goal / Pod / 人类验收不变量。

**Tech Stack:** TypeScript / Node >= 22 / Jest + ts-jest（gateway）/ `node --test` + tsx（desktop）/ better-sqlite3 / `@mafw/plugin-contract` / Electron webview sandbox（已有，不改）。

**Spec:** `docs/superpowers/specs/2026-11-14-phase6-trust-hardening-design.md`

## Global Constraints

- 每个 task 先用失败测试驱动，再实现；禁止先实现后补测试。
- 不新增运行时依赖；host range 用内置受限 semver 解析器。
- 测试只写临时目录，禁止写真实 `~/.mafw`；禁止依赖网络。
- `untrusted` 代码永不进入 gateway 主进程；worker 不可用必须拒绝，禁止 in-process fallback。
- v2 包的 install / resume / unquarantine / rollback 必须 human / device principal；v1 包沿用现有 auth。
- 不改 human accept、审批 / 权限、memory soft supersede / T1 / 100ms recall、runtime 四条不变量、Goal/Pod 状态机、`planHash`/`evalHash`。
- 现有 v1 包（无 `apiVersion` / 无 `permissions` / 单文件包）必须继续可安装、可运行、可热更新。
- 状态文件损坏 = safe mode（fail-closed），不是空文档。
- host range 比较根 `package.json.version`（当前 `5.1.0`），不是 `gateway/package.json.version`（`4.16.1`）。
- 路由全部增量；新增路由必须同步 `gateway/src/routes/route-catalog.ts` 与 `gateway/tests/unit/architecture/schema-coverage.test.ts` 的 `TOTAL_OPS`（当前 318）。
- 每个 task 结束提交；提交前至少跑该 task 的定向测试。
- 每阶段结束跑：`cd gateway && npx jest --runInBand --forceExit --testTimeout=20000`、`npx tsc --noEmit -p tsconfig.json`、根目录 `npm run test:desktop`、`npm run test:plugin-contract`。

## Review Focus

1. **损坏 / 部分写入的安全状态文件**：boot 时必须进入 safe mode，不能把 quarantined / safeMode 清空后重新启用所有包。→ Task 2 `corrupt state enters safe mode`、Task 21 `corrupt-state` drill。
2. **legacy v1 包 / 单文件包**：没有 `apiVersion`、`permissions`、`plugin.json` 的现有安装不能被 doctor 判死或拒绝安装。→ Task 1 `legacy package defaults`、Task 4 `v1 install needs no consent`、Task 7 `legacy single-file warns`。
3. **worker flag 不可用 / spawn 失败**：untrusted 必须被拒绝或 quarantine，绝不能回退主进程。→ Task 13 `refuses to start without a permission flag`、Task 16 `untrusted never loads in-process`。
4. **磁盘上是坏版本、进程在健康窗口内退出**：下次 boot 必须先恢复 last-good 再激活，不能 boot loop。→ Task 20 `boot reconciles an unconfirmed health check`、Task 21 `boot-loop-rollback`。
5. **agent / MCP 安装 v2 包**：必须 403 且不复制文件，plugin-creator 的 v1 草稿流程不受影响。→ Task 8 `v2 install rejects a service principal`、Task 9 `CLI asks for a human token`。

---

## Phase 6A：信任面硬化

### Task 1: Manifest v2 parser + host range

**Files:**
- Create: `gateway/src/plugins/package-manifest.ts`
- Test: `gateway/tests/unit/plugins/package-manifest.test.ts`

**Interfaces:**
- Consumes: 无（纯解析模块）。
- Produces:
  - `SUPPORTED_PLUGIN_API_VERSIONS: readonly [1, 2]`
  - `type PluginKind = 'trusted' | 'untrusted'`
  - `interface NormalizedPackageManifest { name: string; version?: string; main: string; apiVersion: 1 | 2; kind: PluginKind; permissions: string[]; host?: string; integrity?: { algorithm: 'sha256'; files: Record<string, string> }; deprecated?: string; legacy: boolean }`
  - `parsePackageManifest(raw: unknown): { ok: boolean; manifest?: NormalizedPackageManifest; errors: string[]; warnings: string[] }`
  - `isHostRangeCompatible(range: string | undefined, hostVersion: string): boolean`
  - `isKnownPermissionToken(token: string): boolean`

- [ ] **Step 1: Write the failing test**

`gateway/tests/unit/plugins/package-manifest.test.ts`:

```ts
import {
  parsePackageManifest,
  isHostRangeCompatible,
} from '../../../src/plugins/package-manifest';

describe('package manifest v2', () => {
  it('defaults a legacy package to apiVersion 1 / trusted / index.js', () => {
    const result = parsePackageManifest({ name: 'demo' });
    expect(result.ok).toBe(true);
    expect(result.manifest).toMatchObject({
      name: 'demo',
      main: 'index.js',
      apiVersion: 1,
      kind: 'trusted',
      permissions: [],
      legacy: true,
    });
  });

  it('parses apiVersion 2 trust fields', () => {
    const result = parsePackageManifest({
      name: 'demo', version: '1.2.0', main: 'main.js', apiVersion: 2,
      kind: 'untrusted',
      permissions: ['actions', 'config.read'],
      host: '>=5.1.0 <6.0.0',
      deprecated: 'use demo-next',
    });
    expect(result.ok).toBe(true);
    expect(result.manifest).toMatchObject({
      apiVersion: 2, kind: 'untrusted',
      permissions: ['actions', 'config.read'],
      host: '>=5.1.0 <6.0.0',
      deprecated: 'use demo-next',
    });
  });

  it('rejects an unsupported apiVersion', () => {
    const result = parsePackageManifest({ name: 'demo', apiVersion: 3 });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('unsupported apiVersion: 3');
  });

  it('rejects untrusted without apiVersion 2', () => {
    const result = parsePackageManifest({ name: 'demo', kind: 'untrusted' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('untrusted requires apiVersion 2');
  });

  it('rejects unknown permission tokens', () => {
    const result = parsePackageManifest({
      name: 'demo', apiVersion: 2, permissions: ['actions', 'root'],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('unknown permission: root');
  });

  it('compares host ranges against the product version', () => {
    expect(isHostRangeCompatible('>=5.1.0 <6.0.0', '5.1.0')).toBe(true);
    expect(isHostRangeCompatible('>=5.1.0 <6.0.0', '5.9.9')).toBe(true);
    expect(isHostRangeCompatible('>=5.1.0 <6.0.0', '6.0.0')).toBe(false);
    expect(isHostRangeCompatible(undefined, '5.1.0')).toBe(true);
    expect(isHostRangeCompatible('not a range', '5.1.0')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/package-manifest.test.ts`
Expected: FAIL with `Cannot find module '../../../src/plugins/package-manifest'`.

- [ ] **Step 3: Implement `gateway/src/plugins/package-manifest.ts`**

Rules:
- `name` required, same single-path-segment rule as `PackageManager` (`/^[A-Za-z0-9][A-Za-z0-9._-]*$/`, no trailing dot/space).
- `main` defaults `index.js`; absolute or `..`-escaping paths are errors.
- `apiVersion` defaults `1`; only `1` / `2` accepted.
- `kind` defaults `trusted`; `untrusted` requires `apiVersion === 2`.
- `permissions` defaults `[]` for v1, and for v2 must be an array of known tokens. Known base tokens: `actions`, `events`, `config.read`, `config.write`, `terminal`, `http`, `tools`, `observers`, `ui.web`; prefixed tokens: `files.read:`, `files.write:`, `net.fetch:` with a non-empty suffix.
- `host` is a string of space-separated comparators (`>=`, `>`, `<=`, `<`, `=` + semver). Parse into comparators; invalid syntax = error.
- `integrity` accepts `{ algorithm: 'sha256', files: Record<string,string> }`.
- `warnings` gets `legacy-permissions` when v2 has no permissions.
- `isHostRangeCompatible` uses the same parser; missing/`*` = true, malformed = false.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/package-manifest.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/package-manifest.ts gateway/tests/unit/plugins/package-manifest.test.ts
git commit -m "feat(plugins): add package manifest v2 parser"
```

---

### Task 2: State store v2

**Files:**
- Modify: `gateway/src/plugins/package-state-store.ts`
- Test: `gateway/tests/unit/plugins/package-state-store.test.ts`

**Interfaces:**
- Consumes: Task 1 types (`NormalizedPackageManifest` not required here).
- Produces:
  - `PACKAGE_STATE_VERSION = 2`
  - `interface PackageQuarantineEntry { name: string; reason: string; at: string; version?: string; fingerprint?: string }`
  - `interface PackageInstalledState { version?: string; fingerprint: string; files: Record<string,string>; installedAt: string; consecutiveFailures: number; lastFailureAt?: string; degraded?: { reason: string; at: string; version?: string }; lastKnownGood?: { version?: string; fingerprint: string; savedAt: string }; pendingHealthCheck?: { version?: string; fingerprint: string; startedAt: string } }`
  - `interface PackageStateDocument { version: 2; disabled: string[]; safeMode: boolean; quarantined: PackageQuarantineEntry[]; installed: Record<string, PackageInstalledState> }`
  - Methods: `isSafeMode()`, `setSafeMode(boolean)`, `listQuarantine()`, `getQuarantine(name)`, `setQuarantine(entry)`, `clearQuarantine(name)`, `getInstalled(name)`, `setInstalled(name, state)`, `updateInstalled(name, patch)`, `removeInstalled(name)`, `wasCorrupt()`.

- [ ] **Step 1: Write the failing tests**

Replace the existing expectations in `package-state-store.test.ts` with v2 expectations, and add:

```ts
it('returns v2 defaults when the state file is missing', () => {
  const store = new PackageStateStore(dir);
  expect(store.read()).toEqual({
    version: 2, disabled: [], safeMode: false, quarantined: [], installed: {},
  });
  expect(store.wasCorrupt()).toBe(false);
});

it('upgrades a v1 document without losing disabled', () => {
  fs.writeFileSync(path.join(dir, PACKAGE_STATE_FILE),
    JSON.stringify({ version: 1, disabled: ['acme'] }));
  const store = new PackageStateStore(dir);
  expect(store.read()).toMatchObject({
    version: 2, disabled: ['acme'], safeMode: false, quarantined: [],
  });
});

it('enters safe mode when an existing state file is corrupt', () => {
  fs.writeFileSync(path.join(dir, PACKAGE_STATE_FILE), '{ not json');
  const store = new PackageStateStore(dir);
  expect(store.read()).toMatchObject({ version: 2, safeMode: true });
  expect(store.wasCorrupt()).toBe(true);
});

it('persists safe mode and quarantine entries', () => {
  const store = new PackageStateStore(dir);
  store.setSafeMode(true);
  store.setQuarantine({
    name: 'acme', reason: 'integrity mismatch', at: '2026-11-14T00:00:00.000Z',
    version: '1.0.0', fingerprint: 'sha256:abc',
  });
  const reloaded = new PackageStateStore(dir);
  expect(reloaded.isSafeMode()).toBe(true);
  expect(reloaded.getQuarantine('acme')).toMatchObject({ reason: 'integrity mismatch' });
  reloaded.clearQuarantine('acme');
  expect(new PackageStateStore(dir).getQuarantine('acme')).toBeUndefined();
});

it('stores installed integrity and failure counters', () => {
  const store = new PackageStateStore(dir);
  store.setInstalled('acme', {
    version: '1.0.0', fingerprint: 'sha256:abc', files: { 'index.js': 'sha256:def' },
    installedAt: '2026-11-14T00:00:00.000Z', consecutiveFailures: 0,
  });
  store.updateInstalled('acme', { consecutiveFailures: 2 });
  expect(new PackageStateStore(dir).getInstalled('acme')).toMatchObject({
    version: '1.0.0', consecutiveFailures: 2,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/package-state-store.test.ts`
Expected: FAIL because `safeMode` / `quarantined` / `installed` / `wasCorrupt` do not exist.

- [ ] **Step 3: Implement state v2**

Rules:
- Missing file → v2 defaults, no corruption.
- Existing but unreadable / invalid JSON / invalid shape → `{ version: 2, disabled: [], safeMode: true, quarantined: [], installed: {} }`, `wasCorrupt() === true`; log a warning; subsequent write repairs.
- v1 document → disabled preserved, new fields defaulted.
- Sanitize quarantine names with the same path-segment rule; ignore invalid entries.
- Sanitize installed keys; keep only plain JSON values.
- Atomic write stays temp + rename; keep `PACKAGE_STATE_FILE` exported.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/package-state-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/package-state-store.ts gateway/tests/unit/plugins/package-state-store.test.ts
git commit -m "feat(plugins): persist Phase 6 safety state"
```

---

### Task 3: Integrity snapshot and verification

**Files:**
- Modify: `gateway/src/plugins/package-fingerprint.ts`（export `packageFileHashes`）
- Create: `gateway/src/plugins/package-integrity.ts`
- Test: `gateway/tests/unit/plugins/package-integrity.test.ts`

**Interfaces:**
- Consumes: `fingerprintPackage(mainFile, opts)` from `package-fingerprint.ts`.
- Produces:
  - `interface PackageIntegritySnapshot { fingerprint: string; files: Record<string,string> }`
  - `computePackageIntegrity(pkgDir: string, mainFile: string): PackageIntegritySnapshot`
  - `verifyDeclaredIntegrity(pkgDir: string, integrity: { algorithm: 'sha256'; files: Record<string,string> }): { ok: boolean; errors: string[] }`
  - `integrityMatches(snapshot: PackageIntegritySnapshot, installed: { fingerprint: string; files: Record<string,string> }): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computePackageIntegrity,
  verifyDeclaredIntegrity,
} from '../../../src/plugins/package-integrity';

function makePackage(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-integrity-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

it('hashes every package file with a stable fingerprint', () => {
  const dir = makePackage({ 'plugin.json': '{"name":"acme"}', 'index.js': 'module.exports={}' });
  const snapshot = computePackageIntegrity(dir, path.join(dir, 'index.js'));
  expect(snapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(Object.keys(snapshot.files).sort()).toEqual(['index.js', 'plugin.json']);
  expect(computePackageIntegrity(dir, path.join(dir, 'index.js'))).toEqual(snapshot);
});

it('verifies a declared manifest integrity map', () => {
  const dir = makePackage({ 'index.js': 'module.exports={}' });
  const snapshot = computePackageIntegrity(dir, path.join(dir, 'index.js'));
  expect(verifyDeclaredIntegrity(dir, { algorithm: 'sha256', files: snapshot.files }).ok).toBe(true);
  expect(verifyDeclaredIntegrity(dir, {
    algorithm: 'sha256', files: { ...snapshot.files, 'index.js': 'sha256-deadbeef' },
  })).toMatchObject({ ok: false });
});

it('ignores node_modules, logs and temp files', () => {
  const dir = makePackage({
    'index.js': 'module.exports={}',
    'node_modules/x/index.js': 'x',
    'debug.log': 'x',
    'scratch.tmp': 'x',
  });
  const snapshot = computePackageIntegrity(dir, path.join(dir, 'index.js'));
  expect(Object.keys(snapshot.files)).toEqual(['index.js']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/package-integrity.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement**

- Export a `packageFileHashes(mainFile, opts)` helper from `package-fingerprint.ts` that reuses the same collected files and ignored-dir rules; hash each file with `createHash('sha256')`, prefix `sha256-`.
- `computePackageIntegrity` returns `{ fingerprint: fingerprintPackage(...), files: packageFileHashes(...) }`.
- `verifyDeclaredIntegrity` recomputes and compares each declared path; report `missing: <path>` / `mismatch: <path>` / `unexpected: <path>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/package-integrity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/package-fingerprint.ts gateway/src/plugins/package-integrity.ts gateway/tests/unit/plugins/package-integrity.test.ts
git commit -m "feat(plugins): add package integrity snapshots"
```

---

### Task 4: Install consent, v2 gating and integrity baseline

**Files:**
- Modify: `gateway/src/plugins/package-types.ts`
- Modify: `gateway/src/plugins/package-manager.ts`
- Test: `gateway/tests/unit/plugins/package-manager.test.ts`

**Interfaces:**
- Consumes: Task 1 `parsePackageManifest`, Task 2 state store, Task 3 integrity.
- Produces:
  - `interface InstallConsent { trust: 'trusted' | 'untrusted'; permissions: string[] }`
  - `InstallInput.accept?: InstallConsent`
  - `InstallResult.kind?: 'trusted' | 'untrusted'`, `apiVersion?: 1 | 2`
  - `PackageManagerError(status: number, message: string, code?: string)`
  - `PackageManagerDeps.workerAvailable?: boolean`

- [ ] **Step 1: Write the failing tests**

Add to `package-manager.test.ts` (reuse its existing temp-dir / host helpers):

```ts
it('requires consent for a v2 package', async () => {
  const { manager, dir } = makeManager();
  writePackage(dir, 'acme', { name: 'acme', version: '1.0.0', apiVersion: 2, kind: 'trusted', permissions: ['actions'] });
  await expect(manager.installFromPath({ path: path.join(dir, 'acme') }))
    .rejects.toMatchObject({ status: 400, code: 'permission_consent_required' });
});

it('rejects a permission list that does not match the manifest', async () => {
  const { manager, dir } = makeManager();
  writePackage(dir, 'acme', { name: 'acme', apiVersion: 2, permissions: ['actions', 'events'] });
  await expect(manager.installFromPath({
    path: path.join(dir, 'acme'),
    accept: { trust: 'trusted', permissions: ['actions'] },
  })).rejects.toMatchObject({ status: 400, code: 'permission_consent_required' });
});

it('installs a v1 package without consent', async () => {
  const { manager, dir } = makeManager();
  writePackage(dir, 'acme', { name: 'acme', version: '1.0.0' });
  await expect(manager.installFromPath({ path: path.join(dir, 'acme') }))
    .resolves.toMatchObject({ name: 'acme', apiVersion: 1, kind: 'trusted' });
});

it('rejects untrusted packages when no worker is available', async () => {
  const { manager, dir } = makeManager({ workerAvailable: false });
  writePackage(dir, 'acme', { name: 'acme', apiVersion: 2, kind: 'untrusted', permissions: ['actions'] });
  await expect(manager.installFromPath({
    path: path.join(dir, 'acme'),
    accept: { trust: 'untrusted', permissions: ['actions'] },
  })).rejects.toMatchObject({ status: 409, code: 'untrusted_requires_worker' });
  expect(fs.existsSync(path.join(manager.getPluginDir(), 'acme'))).toBe(false);
});

it('rejects a manifest-declared integrity mismatch and leaves no directory', async () => {
  const { manager, dir } = makeManager();
  writePackage(dir, 'acme', {
    name: 'acme', apiVersion: 2, integrity: { algorithm: 'sha256', files: { 'index.js': 'sha256-deadbeef' } },
  });
  await expect(manager.installFromPath({
    path: path.join(dir, 'acme'),
    accept: { trust: 'trusted', permissions: [] },
  })).rejects.toMatchObject({ status: 422, code: 'integrity_mismatch' });
  expect(fs.existsSync(path.join(manager.getPluginDir(), 'acme'))).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/package-manager.test.ts`
Expected: FAIL (no `accept` / `code` / `workerAvailable`).

- [ ] **Step 3: Implement**

- `PackageManagerError` gains optional `code`.
- `readManifest` uses `parsePackageManifest` and throws `PackageManagerError(400, errors.join('; '), 'invalid_manifest')`.
- `installFromPath`:
  - v2 requires `accept` with matching trust/permissions.
  - `kind: untrusted` + `workerAvailable !== true` → 409 `untrusted_requires_worker` before copy.
  - After copy: `computePackageIntegrity`; if manifest declares integrity, `verifyDeclaredIntegrity`; on failure remove the copied dir (restore backup if overwrite) and throw 422.
  - Write `stateStore.setInstalled(name, { version, fingerprint, files, installedAt, consecutiveFailures: 0 })`.
- `copyIntoRoot` must return enough info to remove/restore on integrity failure. Keep the existing temp/backup strategy; on post-copy failure, restore the backup.
- `describe` includes `kind` / `apiVersion` from the parsed manifest.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/package-manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/package-types.ts gateway/src/plugins/package-manager.ts gateway/tests/unit/plugins/package-manager.test.ts
git commit -m "feat(plugins): require install consent and verify integrity"
```

---

### Task 5: Audit store and gateway DB table

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts`
- Create: `gateway/src/plugins/plugin-audit-store.ts`
- Test: `gateway/tests/unit/plugins/plugin-audit-store.test.ts`

**Interfaces:**
- Produces:
  - `type PluginAuditAction = 'install' | 'install.rejected' | 'enable' | 'disable' | 'remove' | 'reload' | 'apply' | 'activate.failed' | 'quarantine' | 'unquarantine' | 'safe-mode.on' | 'safe-mode.off' | 'rollback' | 'doctor'`
  - `interface PluginAuditInput { action: PluginAuditAction; package?: string; version?: string; fingerprint?: string; principalKind?: string; principalMethod?: string; sessionId?: string; result: 'ok' | 'failed' | 'denied'; detail?: Record<string, unknown> }`
  - `interface PluginAuditEvent extends PluginAuditInput { id: string; at: string }`
  - `class PluginAuditStore { constructor(db: Pick<GatewayDb, 'appendPluginAudit' | 'listPluginAudit'>); append(input: PluginAuditInput): boolean; list(query?: { package?: string; limit?: number }): PluginAuditEvent[] }`
- GatewayDb methods:
  - `appendPluginAudit(event: PluginAuditEvent): boolean`
  - `listPluginAudit(query: { package?: string; limit: number }): PluginAuditEvent[]`

- [ ] **Step 1: Write the failing test**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDb } from '../../../src/memory/gateway-db';
import { PluginAuditStore } from '../../../src/plugins/plugin-audit-store';

it('appends and lists audit events newest first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-audit-'));
  const db = new GatewayDb(path.join(dir, 'gateway.db'));
  const store = new PluginAuditStore(db);
  expect(store.append({
    action: 'install', package: 'acme', version: '1.0.0',
    principalKind: 'human', principalMethod: 'human-token', result: 'ok',
    detail: { permissions: ['actions'] },
  })).toBe(true);
  store.append({ action: 'disable', package: 'acme', result: 'ok' });
  const events = store.list({ package: 'acme', limit: 10 });
  expect(events.map((e) => e.action)).toEqual(['disable', 'install']);
  expect(events[1].detail).toEqual({ permissions: ['actions'] });
  db.close();
});

it('drops detail keys outside the allowlist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-audit-'));
  const db = new GatewayDb(path.join(dir, 'gateway.db'));
  const store = new PluginAuditStore(db);
  store.append({
    action: 'install', package: 'acme', result: 'ok',
    detail: { reason: 'ok', token: 'secret', path: 'C:/Users/x' },
  });
  expect(store.list({ limit: 1 })[0].detail).toEqual({ reason: 'ok' });
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/plugin-audit-store.test.ts`
Expected: FAIL (missing table / methods).

- [ ] **Step 3: Implement**

- Add `plugin_audit_events` table + index to `GatewayDb` schema initialization.
- `appendPluginAudit` inserts; returns false on error (fail-soft).
- `listPluginAudit` selects by optional package, `ORDER BY at DESC, id DESC`, `LIMIT ?` (default 100, cap 500).
- `PluginAuditStore` generates `pa_<uuid>` ids and ISO timestamps, filters `detail` keys to: `reason`, `permissions`, `consent`, `apiVersion`, `kind`, `host`, `previousVersion`, `restoredVersion`, `doctorSummary`.
- Prune inside append: delete rows older than 90 days or beyond 5000 newest (single statement, best-effort).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/plugin-audit-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/gateway-db.ts gateway/src/plugins/plugin-audit-store.ts gateway/tests/unit/plugins/plugin-audit-store.test.ts
git commit -m "feat(plugins): add plugin audit store"
```

---

### Task 6: Safety policy, deactivate and kill switch

**Files:**
- Modify: `gateway/src/plugins/package-host.ts`
- Create: `gateway/src/plugins/plugin-safety.ts`
- Test: `gateway/tests/unit/plugins/plugin-safety.test.ts`

**Interfaces:**
- Consumes: Task 2 state store, Task 5 audit store.
- Produces:
  - `class PluginHost` public `deactivate(name: string): Promise<boolean>` and `deactivateAll(): Promise<string[]>`.
  - `type PluginBlockReason = 'safe-mode' | 'quarantined' | 'disabled' | null`
  - `class PluginSafety { constructor(deps: { state: PackageStateStore; host: Pick<PluginHost, 'deactivate' | 'deactivateAll'>; audit: Pick<PluginAuditStore, 'append'>; oneRunSafeMode?: boolean }); blockedReason(name: string): PluginBlockReason; recordActivationFailure(name: string, version: string | undefined, reason: string): { quarantined: boolean }; recordActivationSuccess(name: string): void; markDegraded(name: string, reason: string, version?: string): void; kill(input: { principalKind?: string; principalMethod?: string }): Promise<{ safeMode: true; stopped: string[] }>; resume(input: { principalKind?: string; principalMethod?: string }): Promise<{ safeMode: false; activated: string[] }>; quarantine(name: string, reason: string, input?: { principalKind?: string }): void; unquarantine(name: string, input?: { principalKind?: string }): void }`

- [ ] **Step 1: Write the failing test**

```ts
it('blocks packages in safe mode, quarantine and disabled order', () => {
  const { safety, state } = makeSafety();
  expect(safety.blockedReason('acme')).toBeNull();
  state.setDisabled('acme', true);
  expect(safety.blockedReason('acme')).toBe('disabled');
  state.setDisabled('acme', false);
  safety.quarantine('acme', 'manual');
  expect(safety.blockedReason('acme')).toBe('quarantined');
  state.setSafeMode(true);
  expect(safety.blockedReason('acme')).toBe('safe-mode');
});

it('quarantines after three consecutive activation failures', () => {
  const { safety, state } = makeSafety();
  safety.recordActivationFailure('acme', '1.0.0', 'boom');
  safety.recordActivationFailure('acme', '1.0.0', 'boom');
  expect(safety.recordActivationFailure('acme', '1.0.0', 'boom')).toEqual({ quarantined: true });
  expect(state.getQuarantine('acme')?.reason).toContain('3 consecutive');
});

it('resets the failure counter on success', () => {
  const { safety, state } = makeSafety();
  safety.recordActivationFailure('acme', '1.0.0', 'boom');
  safety.recordActivationSuccess('acme');
  expect(state.getInstalled('acme')?.consecutiveFailures).toBe(0);
});

it('honors a one-run safe mode without persisting it', () => {
  const { safety, state } = makeSafety({ oneRunSafeMode: true });
  expect(safety.blockedReason('acme')).toBe('safe-mode');
  expect(state.isSafeMode()).toBe(false);
});

it('kill deactivates all packages and persists safe mode', async () => {
  const { safety, state, host } = makeSafety();
  await expect(safety.kill({ principalKind: 'service' })).resolves.toEqual({
    safeMode: true, stopped: ['acme', 'beta'],
  });
  expect(state.isSafeMode()).toBe(true);
  expect(host.deactivateAll).toHaveBeenCalled();
});

it('resume clears safe mode but does not enable disabled or quarantined packages', async () => {
  const { safety, state } = makeSafety();
  state.setSafeMode(true);
  state.setDisabled('beta', true);
  state.setQuarantine({ name: 'acme', reason: 'x', at: '2026-11-14T00:00:00.000Z' });
  await expect(safety.resume({ principalKind: 'human' })).resolves.toEqual({
    safeMode: false, activated: [],
  });
  expect(state.isSafeMode()).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/plugin-safety.test.ts`
Expected: FAIL (module / methods missing).

- [ ] **Step 3: Implement**

- Add `deactivate(name)` to `PluginHost`: if active, run its `bag.dispose()`, drop active entries, publish snapshot; return whether anything was deactivated.
- `deactivateAll()`: deactivate every active package, return sorted names.
- `PluginSafety.blockedReason` order: `oneRunSafeMode || state.isSafeMode()` > quarantined > disabled. `oneRunSafeMode` comes from `MAFW_SAFE_MODE=1` / `mafw start --safe-mode` and is never written to state.
- Failure counter: if no `installed` entry exists (first-install failure), create `{ fingerprint: '', files: {}, installedAt: now, consecutiveFailures: 0 }` first; then `updateInstalled(name, { consecutiveFailures: n + 1, lastFailureAt })`; at 3 set quarantine `reason: '3 consecutive activation failures: <reason>'` and return `{ quarantined: true }`.
- Success resets counter and clears `degraded`.
- `kill` sets safe mode, calls `deactivateAll`, appends `safe-mode.on`.
- `resume` clears safe mode, appends `safe-mode.off`, returns `{ activated: [] }` (the manager/host reload is the caller's job).
- Quarantine/unquarantine append audit; no file deletion.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/plugin-safety.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/package-host.ts gateway/src/plugins/plugin-safety.ts gateway/tests/unit/plugins/plugin-safety.test.ts
git commit -m "feat(plugins): add kill switch and quarantine policy"
```

---

### Task 7: Plugin doctor

**Files:**
- Create: `gateway/src/plugins/plugin-doctor.ts`
- Test: `gateway/tests/unit/plugins/plugin-doctor.test.ts`

**Interfaces:**
- Consumes: Task 1 parser, Task 2 state, Task 3 integrity, `PluginHost.checkPackage`.
- Produces:
  - `interface PluginDoctorCheck { id: string; status: 'pass' | 'warn' | 'fail'; message: string; fix?: string }`
  - `interface PluginDoctorReport { name: string; version?: string; apiVersion: number; kind: 'trusted' | 'untrusted' | 'unknown'; fingerprint?: string; ok: boolean; checks: PluginDoctorCheck[]; generatedAt: string }`
  - `class PluginDoctor { constructor(deps: { pluginDir: string; host: Pick<PluginHost, 'checkPackage' | 'getState'>; state: PackageStateStore; hostVersion: string; contractVersion?: string }); check(name: string): Promise<PluginDoctorReport>; checkAll(): Promise<PluginDoctorReport[]> }`

- [ ] **Step 1: Write the failing test**

```ts
it('passes a healthy v1 package and warns about legacy permissions', async () => {
  const { doctor, dir } = makeDoctor();
  writePackage(dir, 'acme', { name: 'acme', version: '1.0.0' });
  const report = await doctor.check('acme');
  expect(report.ok).toBe(true);
  expect(report.checks.find((c) => c.id === 'permissions')).toMatchObject({ status: 'warn' });
});

it('fails an unsupported apiVersion without throwing', async () => {
  const { doctor, dir } = makeDoctor();
  writePackage(dir, 'acme', { name: 'acme', apiVersion: 3 });
  const report = await doctor.check('acme');
  expect(report.ok).toBe(false);
  expect(report.checks.find((c) => c.id === 'api-version')?.status).toBe('fail');
});

it('fails an incompatible host range', async () => {
  const { doctor, dir } = makeDoctor({ hostVersion: '5.1.0' });
  writePackage(dir, 'acme', { name: 'acme', apiVersion: 2, host: '>=7.0.0' });
  const report = await doctor.check('acme');
  expect(report.checks.find((c) => c.id === 'host-range')?.status).toBe('fail');
});

it('does not dry-run activation for a quarantined package', async () => {
  const { doctor, dir, state, host } = makeDoctor();
  writePackage(dir, 'acme', { name: 'acme' });
  state.setQuarantine({ name: 'acme', reason: 'x', at: '2026-11-14T00:00:00.000Z' });
  const report = await doctor.check('acme');
  expect(report.checks.find((c) => c.id === 'activation')?.status).toBe('warn');
  expect(host.checkPackage).not.toHaveBeenCalled();
});

it('synthesizes a legacy single-file manifest', async () => {
  const { doctor, dir } = makeDoctor();
  fs.writeFileSync(path.join(dir, 'legacy.js'), 'module.exports={name:"legacy"}');
  const report = await doctor.check('legacy');
  expect(report).toMatchObject({ name: 'legacy', version: '0.0.0' });
  expect(report.checks.find((c) => c.id === 'manifest')?.status).toBe('warn');
});

it('warns on deprecation and contract skew', async () => {
  const { doctor, dir } = makeDoctor({ contractVersion: '9.9.9' });
  writePackage(dir, 'acme', { name: 'acme', apiVersion: 2, deprecated: 'use acme-next' });
  const report = await doctor.check('acme');
  expect(report.checks.find((c) => c.id === 'deprecation')?.status).toBe('warn');
  expect(report.checks.find((c) => c.id === 'contract-skew')?.status).toBe('warn');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/plugin-doctor.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Fixed check ids in order: `manifest`, `api-version`, `host-range`, `entry`, `permissions`, `integrity`, `state`, `collision`, `activation`, `last-error`, `deprecation`, `contract-skew`.
- `ok = no check with status 'fail'`.
- For a directory package read `plugin.json`; for a single file synthesize `{ name: basename, version: '0.0.0', main: file }`.
- Skip `activation` (warn `not checked: ...`) when any earlier check failed, when quarantined, or safe mode.
- `host.checkPackage(dir)` only when allowed; catch errors into `activation.fail`.
- Contract skew: compare `contractVersion` to the gateway's expected `@mafw/plugin-contract` version; mismatch → warn.
- Do not write state or failure counters.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/plugin-doctor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/plugin-doctor.ts gateway/tests/unit/plugins/plugin-doctor.test.ts
git commit -m "feat(plugins): add plugin doctor"
```

---

### Task 8: Routes, DTOs and schema ledger

**Files:**
- Modify: `gateway/src/routes/plugin-packages.ts`
- Modify: `gateway/src/routes/wave2-handlers.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/plugins/package-inventory.ts`（只读列表字段）
- Modify: `gateway/src/plugins/plugin-web-ticket.ts`
- Test: `gateway/tests/unit/routes/plugin-packages.test.ts`
- Test: `gateway/tests/unit/plugins/plugin-web-ticket.test.ts`
- Test: `gateway/tests/unit/architecture/schema-coverage.test.ts`

**Interfaces:**
- Consumes: Task 4 manager, Task 6 safety, Task 7 doctor, Task 5 audit.
- `PluginPackagesRouteDeps` gains `safety: () => PluginSafety | undefined`, `doctor: () => PluginDoctor | undefined`, `audit: () => PluginAuditStore | undefined`.
- Produces routes:
  - `POST /api/plugins/packages/install` (v2 human/device; v1 existing auth)
  - `POST /api/plugins/:name/doctor`
  - `POST /api/plugins/doctor`
  - `POST /api/plugins/kill`
  - `POST /api/plugins/resume` (human/device)
  - `POST /api/plugins/:name/quarantine`
  - `POST /api/plugins/:name/unquarantine` (human/device)
  - `GET /api/plugins/audit`
- DTO: `plugins.list` items add `apiVersion`, `kind`, `transport` (`in-process` for 6A), `permissions`, `state`, `quarantinedReason`, `degradedReason`.

- [ ] **Step 1: Write the failing tests**

`plugin-packages.test.ts`:

```ts
it('rejects a v2 install from a service principal', async () => {
  const res = await callInstall({ mafwPrincipal: { kind: 'service', method: 'api-token' } }, {
    path: 'C:/tmp/acme', accept: { trust: 'trusted', permissions: ['actions'] },
  });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('human_principal_required');
  expect(manager.installFromPath).not.toHaveBeenCalled();
});

it('passes a v2 install from a human principal to the manager', async () => {
  const res = await callInstall({ mafwPrincipal: { kind: 'human', method: 'human-token' } }, {
    path: 'C:/tmp/acme', accept: { trust: 'trusted', permissions: ['actions'] },
  });
  expect(res.status).toBe(200);
  expect(manager.installFromPath).toHaveBeenCalledWith({
    path: 'C:/tmp/acme', overwrite: false, requestId: undefined,
    accept: { trust: 'trusted', permissions: ['actions'] },
  });
});

it('kill accepts a service principal and resume requires human', async () => {
  expect((await callKill({ kind: 'service' })).status).toBe(200);
  expect((await callResume({ kind: 'service' })).status).toBe(403);
  expect((await callResume({ kind: 'human' })).status).toBe(200);
});

it('quarantine accepts a service principal and unquarantine requires human', async () => {
  expect((await callQuarantine('acme', { kind: 'service' })).status).toBe(200);
  expect((await callUnquarantine('acme', { kind: 'service' })).status).toBe(403);
});
```

Also assert `handlePluginAudit` returns `{ events: [...] }` and `plugins.list` includes the new fields.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest --runInBand tests/unit/routes/plugin-packages.test.ts tests/unit/architecture/schema-coverage.test.ts`
Expected: FAIL (routes / fields missing; schema ledger mismatch).

- [ ] **Step 3: Implement**

- Route handlers read principal from `(req as any).mafwPrincipal`; use `isHumanPrincipal` + `humanOnlyDenied()` for v2 install / resume / unquarantine.
- Add the 7 routes to `route-catalog.ts`; add minimal response schemas (doctor report, audit list, kill/resume result).
- Register the static `/api/plugins/doctor` route **before** the parameterized `/api/plugins/:name/doctor` so the static path wins.
- Update `TOTAL_OPS` 318 → 325 in `schema-coverage.test.ts` and run the ledger script if it asserts a generated count.
- Extend the plugin list projection in `package-inventory.ts` / `plugin-packages.ts` with the additive fields.
- Kill route: after `safety.kill`, call `pluginWebTicketStore.revokePackage(name)` for each stopped package. Add `revokePackage(pkg: string): void` to `gateway/src/plugins/plugin-web-ticket.ts` (drop all entries for that pkg) with a unit test.
- Keep error mapping: `PackageManagerError.code` → `{ error, code }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest --runInBand tests/unit/routes/plugin-packages.test.ts tests/unit/architecture/schema-coverage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/plugin-packages.ts gateway/src/routes/wave2-handlers.ts gateway/src/routes/route-catalog.ts gateway/src/plugins/package-inventory.ts gateway/src/plugins/plugin-web-ticket.ts gateway/tests/unit/routes/plugin-packages.test.ts gateway/tests/unit/plugins/plugin-web-ticket.test.ts gateway/tests/unit/architecture/schema-coverage.test.ts
git commit -m "feat(plugins): expose trust, doctor and kill routes"
```

---

### Task 9: CLI `mafw plugins`

**Files:**
- Create: `gateway/src/cli/plugins-command.ts`
- Modify: `bin/mafw.js`
- Test: `gateway/tests/unit/cli/plugins-command.test.ts`

**Interfaces:**
- Produces:
  - `runPluginsCommand(argv: string[], deps: { request(path: string, method: 'GET' | 'POST', body?: unknown, humanToken?: string): Promise<{ status: number; body: any }>; readHumanToken(): string | null; print(text: string): void }): Promise<number>`
  - Subcommands: `list`, `doctor [name]`, `install <path> [--overwrite] [--trust trusted|untrusted] [--permission <token>]...`, `kill`, `resume`, `quarantine <name> --reason <text>`, `unquarantine <name>`, `audit [--package <name>] [--limit <n>]`. `rollback` is added in Task 21, after `last-good` exists.
- `bin/mafw.js` lazily requires `../gateway/dist/cli/plugins-command.js` and forwards `process.argv.slice(2)`; `start --safe-mode` sets `MAFW_SAFE_MODE=1` before spawning.

- [ ] **Step 1: Write the failing test**

```ts
it('prints a JSON list', async () => {
  const out: string[] = [];
  const code = await runPluginsCommand(['list', '--json'], {
    request: async () => ({ status: 200, body: { packages: [{ name: 'acme' }] } }),
    readHumanToken: () => null,
    print: (s) => out.push(s),
  });
  expect(code).toBe(0);
  expect(JSON.parse(out.join('\n')).packages[0].name).toBe('acme');
});

it('resume fails without a human token', async () => {
  const out: string[] = [];
  const code = await runPluginsCommand(['resume'], {
    request: async () => ({ status: 200, body: {} }),
    readHumanToken: () => null,
    print: (s) => out.push(s),
  });
  expect(code).toBe(1);
  expect(out.join('\n')).toContain('human token');
});

it('sends the human token for resume', async () => {
  const seen: any[] = [];
  const code = await runPluginsCommand(['resume'], {
    request: async (p, m, b, token) => { seen.push({ p, m, token }); return { status: 200, body: { safeMode: false } }; },
    readHumanToken: () => 'human-secret',
    print: () => {},
  });
  expect(code).toBe(0);
  expect(seen[0]).toMatchObject({ p: '/api/plugins/resume', m: 'POST', token: 'human-secret' });
});

it('doctor --json prints the report array', async () => {
  const out: string[] = [];
  await runPluginsCommand(['doctor', '--json'], {
    request: async () => ({ status: 200, body: [{ name: 'acme', ok: true }] }),
    readHumanToken: () => null,
    print: (s) => out.push(s),
  });
  expect(JSON.parse(out.join('\n'))[0]).toMatchObject({ name: 'acme', ok: true });
});

it('install sends the v2 consent and requires a human token', async () => {
  const seen: any[] = [];
  const code = await runPluginsCommand([
    'install', 'C:/tmp/acme', '--trust', 'trusted', '--permission', 'actions', '--permission', 'events',
  ], {
    request: async (p, m, b, token) => { seen.push({ p, m, b, token }); return { status: 200, body: { name: 'acme' } }; },
    readHumanToken: () => 'human-secret',
    print: () => {},
  });
  expect(code).toBe(0);
  expect(seen[0].b).toEqual({
    path: 'C:/tmp/acme', overwrite: false,
    accept: { trust: 'trusted', permissions: ['actions', 'events'] },
  });
  expect(seen[0].token).toBe('human-secret');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/cli/plugins-command.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

- Parse flags manually (no new dependency).
- `--json` makes output machine-readable; otherwise a small table.
- Human-token commands: `install` is not a CLI subcommand in v1 (desktop handles v2), `resume`, `unquarantine`, `rollback` read `MAFW_HUMAN_TOKEN` or `~/.mafw/human.token` via `readHumanToken`.
- Non-2xx: print `{ error, code }`, return 1.
- Modify `bin/mafw.js`: add `'plugins'` to `COMMANDS` and usage; dispatch to the dist module with a clear "run npm run build" error if absent.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/cli/plugins-command.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/cli/plugins-command.ts bin/mafw.js gateway/tests/unit/cli/plugins-command.test.ts
git commit -m "feat(cli): add mafw plugins commands"
```

---

### Task 10: Desktop plugin list / kill / doctor

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pages/plugin-packages-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/pages/PluginPackagesSection.tsx`
- Modify: `packages/desktop/src/renderer/mafw/pages/plugin-hub.ts`
- Test: `packages/desktop/src/renderer/mafw/pages/plugin-packages-model.test.ts`

**Interfaces:**
- Consumes: Task 8 DTO fields and routes.
- Produces: `PluginPackageRow` gains `apiVersion`, `kind`, `transport`, `permissions`, `state`, `quarantinedReason`, `degradedReason`; model helpers `visiblePackages(rows)`, `safeModeBanner(state)`, `packageStateLabel(row)`.

- [ ] **Step 1: Write the failing test**

```ts
it('surfaces safe mode and quarantine without hiding rows', () => {
  const model = buildPluginPackagesModel({
    safeMode: true,
    packages: [
      { name: 'acme', state: 'safe-mode', quarantined: true, quarantinedReason: 'integrity' },
      { name: 'beta', state: 'active', disabled: true },
    ],
  });
  expect(model.safeMode).toBe(true);
  expect(model.rows.map((r) => r.name)).toEqual(['acme', 'beta']);
  expect(model.rows[0].badge).toContain('quarantined');
  expect(model.banner).toContain('safe mode');
});

it('maps trust and transport fields', () => {
  const model = buildPluginPackagesModel({
    safeMode: false,
    packages: [{ name: 'acme', apiVersion: 2, kind: 'untrusted', transport: 'worker', permissions: ['actions'] }],
  });
  expect(model.rows[0]).toMatchObject({ trust: 'untrusted', transport: 'worker', permissions: ['actions'] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pages/plugin-packages-model.test.ts`
Expected: FAIL (fields missing).

- [ ] **Step 3: Implement**

- Extend the model types and row mapping; keep unknown states as `unknown`.
- Add a safe-mode banner and a kill/resume action pair; use `@mafw/ui` v2 buttons, no bare `<button>`.
- Add a doctor result panel (pass/warn/fail) and quarantine reason text.
- Do not add hardcoded colors; use existing tokens.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pages/plugin-packages-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/pages/plugin-packages-model.ts packages/desktop/src/renderer/mafw/pages/PluginPackagesSection.tsx packages/desktop/src/renderer/mafw/pages/plugin-hub.ts packages/desktop/src/renderer/mafw/pages/plugin-packages-model.test.ts
git commit -m "feat(desktop): surface plugin trust and safe mode"
```

---

### Task 11: 6A integration, docs and gate

**Files:**
- Create: `gateway/tests/integration/plugin-trust-6a.test.ts`
- Modify: `docs/architecture/plugin.md`
- Create: `docs/releases/2026-11-14-phase6a-trust-surface.md`

**Interfaces:** none new; exercises Tasks 1–10 together.

- [ ] **Step 1: Write the integration test**

Scenarios:
1. v1 package install → active → disable → enable.
2. v2 trusted install without consent → 400; with consent → active.
3. kill → all inactive + safeMode persisted; new manager instance → still safe mode; resume → active again.
4. three activation failures → quarantine; doctor reports fail; unquarantine + reinstall → active.
5. corrupt state file → new manager safe mode, gateway host still constructs.
6. audit contains install/kill/quarantine events and no `secret` key.

Use temp dirs only; assert via manager/host/state, not HTTP where possible.

- [ ] **Step 2: Run it and fix until green**

Run: `cd gateway && npx jest --runInBand tests/integration/plugin-trust-6a.test.ts`
Expected: PASS.

- [ ] **Step 3: Update docs**

- `docs/architecture/plugin.md`: add a short “Phase 6A trust surface” subsection with manifest v2, consent, integrity, audit, doctor, kill switch, state v2.
- `docs/releases/2026-11-14-phase6a-trust-surface.md`: scope, behavior, tests, rollback, key commits.

- [ ] **Step 4: Run the 6A gate**

Run:
```bash
(cd gateway && npx jest --runInBand --forceExit --testTimeout=20000)
(cd gateway && npx tsc --noEmit -p tsconfig.json)
npm run test:desktop
npm run test:plugin-contract
```
Expected: all pass; record counts in the release doc.

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/integration/plugin-trust-6a.test.ts docs/architecture/plugin.md docs/releases/2026-11-14-phase6a-trust-surface.md
git commit -m "docs: close Phase 6A trust surface"
```

---

## Phase 6B：worker / child host

### Task 12: Worker protocol, bootstrap and permission-flag detection

**Files:**
- Create: `gateway/src/plugins/worker/worker-protocol.ts`
- Create: `gateway/src/plugins/worker/node-flags.ts`
- Create: `gateway/src/plugins/worker/worker-bootstrap.cjs`
- Test: `gateway/tests/unit/plugins/worker-protocol.test.ts`

**Interfaces:**
- Produces:
  - `type HostToWorker = { t: 'invoke'; id: string; action: string; input: unknown; timeoutMs: number } | { t: 'shutdown' }`
  - `type WorkerToHost = { t: 'ready'; name: string; version?: string; apiVersion: number; contributions: unknown } | { t: 'result'; id: string; ok: true; output: unknown } | { t: 'result'; id: string; ok: false; error: { message: string; code?: string } } | { t: 'emit'; type: string; payload: unknown } | { t: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string } | { t: 'config.get'; id: string } | { t: 'config.update'; id: string; patch: unknown }`
  - `MAX_WORKER_MESSAGE_BYTES = 1024 * 1024`
  - `encodeWorkerMessage(message: HostToWorker | WorkerToHost): string`
  - `decodeWorkerMessage(raw: unknown): HostToWorker | WorkerToHost | null`
  - `permissionFlagFor(nodePath: string): '--permission' | '--experimental-permission' | null`
  - `workerBootstrapPath(): string`（`src` 与 `dist` 都解析到同目录的 `.cjs`）

- [ ] **Step 1: Write the failing test**

```ts
it('round-trips a worker message', () => {
  const msg = { t: 'result', id: '1', ok: true, output: { value: 1 } } as const;
  expect(decodeWorkerMessage(encodeWorkerMessage(msg))).toEqual(msg);
});

it('rejects oversized and unknown messages', () => {
  const huge = { t: 'log', level: 'info', message: 'x'.repeat(MAX_WORKER_MESSAGE_BYTES + 1) } as const;
  expect(encodeWorkerMessage(huge)).toBe('');
  expect(decodeWorkerMessage('{"t":"nope"}')).toBeNull();
});

it('detects a Node permission flag', () => {
  expect(['--permission', '--experimental-permission']).toContain(permissionFlagFor(process.execPath));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/worker-protocol.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

- Protocol validation is strict: plain object, known `t`, required fields, JSON-serializable, byte length cap.
- `permissionFlagFor` runs `spawnSync(nodePath, [flag, '-e', '0'])` with a 2s timeout, caches per path; returns the first flag with status 0.
- `worker-bootstrap.cjs` is CommonJS (no TS) so it can run in tests and `dist` after a build copy. It must:
  - patch `Module._load` to throw for `http`, `https`, `net`, `tls`, `dns`, `dgram`, `http2`, `child_process`, `worker_threads`, `cluster`;
  - replace `globalThis.fetch`, `WebSocket`, `EventSource` with throwing stubs;
  - require the package entry from `process.argv[2]` / env;
  - send `ready` with the contribution shape (handlers replaced by `{ __workerAction: name }`);
  - handle `invoke` / `shutdown` / config RPC;
  - exit on uncaught `uncaughtException` / `unhandledRejection` so the host sees a crash.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/worker-protocol.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/worker/worker-protocol.ts gateway/src/plugins/worker/node-flags.ts gateway/src/plugins/worker/worker-bootstrap.cjs gateway/tests/unit/plugins/worker-protocol.test.ts
git commit -m "feat(plugins): add worker protocol and bootstrap"
```

---

### Task 13: WorkerHost lifecycle, RPC and ledger

**Files:**
- Create: `gateway/src/plugins/worker/worker-host.ts`
- Create fixtures: `gateway/tests/fixtures/plugins-worker/echo/{plugin.json,index.js}`
- Test: `gateway/tests/unit/plugins/worker-host.test.ts`

**Interfaces:**
- Consumes: Task 12 protocol / flags / bootstrap, `SubprocessLedger`.
- Produces:
  - `interface WorkerReady { name: string; version?: string; apiVersion: number; contributions: unknown; pid?: number }`
  - `interface WorkerHostOptions { name: string; packageDir: string; entryFile: string; manifest: NormalizedPackageManifest; nodePath?: string; bootstrapPath?: string; permissionFlag?: '--permission' | '--experimental-permission' | null; timeoutMs?: number; maxOldSpaceMb?: number; ledger?: SubprocessLedger; onEmit: (event: PluginEmitEvent) => void; getConfig: () => Record<string, unknown>; updateConfig: (patch: Record<string, unknown>) => void; logger: typeof log; backoffMs?: number[]; onCrash?: (info: { code?: number; signal?: string; restarts: number }) => void }`
  - `class WorkerHost { start(): Promise<WorkerReady>; invoke(action: string, input: unknown, timeoutMs?: number): Promise<unknown>; stop(reason?: string): Promise<void>; health(): 'healthy' | 'failed' | 'stopped'; getPid(): number | undefined; getRestarts(): number }`

- [ ] **Step 1: Write the failing test**

Use fixture `echo` whose `activate()` returns one action `echo` returning its input.

```ts
it('starts, invokes an action and stops', async () => {
  const host = makeWorkerHost('echo');
  const ready = await host.start();
  expect(ready.name).toBe('echo');
  await expect(host.invoke('echo', { value: 7 }, 2000)).resolves.toEqual({ value: 7 });
  const pid = host.getPid();
  await host.stop('test');
  expect(host.health()).toBe('stopped');
  expect(isAlive(pid!)).toBe(false);
});

it('records the child in the subprocess ledger', async () => {
  const ledger = new SubprocessLedger();
  const host = makeWorkerHost('echo', { ledger });
  await host.start();
  expect(ledger.snapshot().some((r) => r.id === 'plugin:echo' && r.state === 'running')).toBe(true);
  await host.stop('test');
  expect(ledger.snapshot().find((r) => r.id === 'plugin:echo')?.state).toBe('stopped');
});

it('rejects invokes after stop', async () => {
  const host = makeWorkerHost('echo');
  await host.start();
  await host.stop('test');
  await expect(host.invoke('echo', {})).rejects.toThrow(/not running/i);
});

it('refuses to start without a permission flag', async () => {
  const host = makeWorkerHost('echo', { permissionFlag: null });
  await expect(host.start()).rejects.toThrow(/worker_unavailable/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/worker-host.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

- Spawn with `child_process.fork(bootstrapPath, [entryFile], { cwd: packageDir, env: sanitized, execArgv: [flag, '--allow-fs-read=<packageDir>', '--allow-fs-read=<bootstrapDir>', '--max-old-space-size=...'], stdio: ['ignore','pipe','pipe','ipc'] })`.
- `permissionFlag` defaults to `permissionFlagFor(nodePath)`; `null` (explicit or auto) → throw `new Error('worker_unavailable: Node permission flag not supported')`.
- Track pending invokes by id; reject on exit / timeout.
- FIFO queue max 4 in-flight, 64 queued.
- `stop`: send `{t:'shutdown'}`, wait 2s, SIGTERM 2s, SIGKILL; always ledger stop.
- `onEmit` / `log` / config RPC handlers.
- `backoffMs` default `[500, 1000, 2000]` used by Task 15.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/worker-host.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/worker/worker-host.ts gateway/tests/fixtures/plugins-worker gateway/tests/unit/plugins/worker-host.test.ts
git commit -m "feat(plugins): add worker host lifecycle"
```

---

### Task 14: Worker ctx proxy, guards and contribution normalization

**Files:**
- Modify: `gateway/src/plugins/worker/worker-bootstrap.cjs`
- Create fixtures: `gateway/tests/fixtures/plugins-worker/{malicious-fs,malicious-net,forbidden-tools,config-echo}`
- Test: `gateway/tests/unit/plugins/worker-sandbox.test.ts`

**Interfaces:**
- Consumes: Task 13 `WorkerHost`.
- Produces: worker ctx with only `name`, `version`, `log`, `config.get`, `config.update`, `emit`, `effect`; forbidden contribution declarations cause `start()` / action failure.

- [ ] **Step 1: Write the failing test**

```ts
it('denies fs access outside the package root', async () => {
  const host = makeWorkerHost('malicious-fs');
  await host.start();
  const result = await host.invoke('read', { path: path.join(os.tmpdir(), 'mafw-worker-secret.txt') });
  expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/access|denied|permission/i) });
});

it('denies net, child_process and fetch', async () => {
  const host = makeWorkerHost('malicious-net');
  await host.start();
  await expect(host.invoke('net', {})).resolves.toMatchObject({ ok: false });
  await expect(host.invoke('fetch', {})).resolves.toMatchObject({ ok: false });
});

it('exposes config and emit through the host', async () => {
  const host = makeWorkerHost('config-echo');
  await host.start();
  await expect(host.invoke('roundTrip', { value: 1 })).resolves.toEqual({ value: 1 });
});

it('rejects tools / observers / ui declarations', async () => {
  const host = makeWorkerHost('forbidden-tools');
  await expect(host.start()).rejects.toThrow(/not allowed in untrusted worker/i);
});
```

Fixtures must return `{ ok: false, error: ... }` from actions instead of crashing, so the test can assert the guard message.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/worker-sandbox.test.ts`
Expected: FAIL (ctx / guards missing).

- [ ] **Step 3: Implement**

- Build the ctx proxy in the bootstrap:
  - `log` → `process.send({t:'log'})`
  - `config.get` / `config.update` → RPC with id, await result
  - `emit` → `process.send({t:'emit'})`
  - `effect` → local set; on shutdown run LIFO once
  - no `files`, `terminal`, `http`, `apiKey`, `usage`
- Normalize contributions: reject `tools`, `observers`, `media`, `runtime`, `tts`, `ui.webSurfaces`, `usage`; only `actions`, `events` allowed.
- Enforce declared event namespace `plugin:<pkg>:*` and declared action names host-side (Task 16).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/worker-sandbox.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/worker/worker-bootstrap.cjs gateway/tests/fixtures/plugins-worker gateway/tests/unit/plugins/worker-sandbox.test.ts
git commit -m "feat(plugins): restrict untrusted worker capabilities"
```

---

### Task 15: Worker crash, timeout, backoff and quarantine

**Files:**
- Modify: `gateway/src/plugins/worker/worker-host.ts`
- Create fixtures: `gateway/tests/fixtures/plugins-worker/{crash-loop,cpu-hog,message-bomb}`
- Test: `gateway/tests/unit/plugins/worker-resilience.test.ts`

**Interfaces:**
- Consumes: Task 13 host, Task 6 `PluginSafety`.
- Produces:
  - `WorkerHostOptions.backoffMs?: number[]` (default `[500, 1000, 2000]`)
  - `WorkerHostOptions.onCrash?: (info: { code?: number; signal?: string; restarts: number }) => void`
  - `WorkerHost.invoke` rejects with `worker_timeout`, `worker_crashed`, `worker_busy`, or `message_too_large`.

- [ ] **Step 1: Write the failing test**

```ts
it('kills an action that exceeds its timeout', async () => {
  const host = makeWorkerHost('cpu-hog');
  await host.start();
  await expect(host.invoke('spin', {}, 100)).rejects.toThrow(/worker_timeout/);
  expect(host.getRestarts()).toBeGreaterThanOrEqual(1);
});

it('restarts with backoff and quarantines after three crashes', async () => {
  const safety = makeSafety();
  const host = makeWorkerHost('crash-loop', {
    backoffMs: [5, 5, 5],
    onCrash: () => { safety.recordActivationFailure('crash-loop', '1.0.0', 'worker crashed'); },
  });
  await host.start();
  for (let i = 0; i < 3; i++) {
    await host.invoke('crash', {}, 500).catch(() => undefined);
  }
  await waitFor(() => safety.blockedReason('crash-loop') === 'quarantined', 1000);
  expect(safety.blockedReason('crash-loop')).toBe('quarantined');
});

it('rejects an oversized message without killing the host', async () => {
  const host = makeWorkerHost('message-bomb');
  await host.start();
  await expect(host.invoke('bomb', { size: 2 * 1024 * 1024 }, 500))
    .rejects.toThrow(/message_too_large/);
  await expect(host.invoke('echo', { ok: true }, 500)).resolves.toEqual({ ok: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/worker-resilience.test.ts`
Expected: FAIL (timeout / restart / quarantine not implemented).

- [ ] **Step 3: Implement**

- Per-invoke timer; on timeout kill child, reject pending with `worker_timeout`, schedule restart.
- On unexpected exit: reject pending with `worker_crashed`; increment restarts; if `restarts >= 3` within 5 minutes call `safety.quarantine(name, 'worker crashed 3 times in 5 minutes')`; otherwise restart after `backoffMs[restarts - 1]`.
- Incoming message over cap → ignore + reject with `message_too_large`; do not kill.
- `worker_busy` when queue full.
- Forward `onCrash` for tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/worker-resilience.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/worker/worker-host.ts gateway/tests/fixtures/plugins-worker gateway/tests/unit/plugins/worker-resilience.test.ts
git commit -m "feat(plugins): isolate worker crashes and timeouts"
```

---

### Task 16: Host integration for untrusted activation and install

**Files:**
- Modify: `gateway/src/plugins/package-host.ts`
- Modify: `gateway/src/plugins/package-manager.ts`
- Modify: `gateway/src/plugins/package-validator.ts`
- Test: `gateway/tests/unit/plugins/package-host-worker.test.ts`
- Test: `gateway/tests/integration/plugin-untrusted.test.ts`

**Interfaces:**
- Consumes: Tasks 12–15, Task 4 install gating.
- Produces:
  - `PluginHostOptions.workerHostFactory?: (desc: PackageDescriptor, manifest: NormalizedPackageManifest) => WorkerHost`
  - `PluginHostOptions.workerAvailable?: () => boolean`
  - `PluginHostOptions.installedFingerprint?: (name: string) => string | undefined`
  - `PluginHostOptions.onUntrustedDrift?: (name: string, reason: string) => void`
  - `PackageManagerDeps.workerAvailable?: boolean` (already from Task 4)
  - `PackageState.transport: 'in-process' | 'worker'`
  - `ActivatedContributions` for worker packages contains only actions/events; handlers call `worker.invoke(action, input)`.

- [ ] **Step 1: Write the failing tests**

`package-host-worker.test.ts`:

```ts
it('activates an untrusted package in a worker, not in-process', async () => {
  const { host, worker } = makeHost({ kind: 'untrusted' });
  await host.reload();
  const state = host.getState().find((p) => p.name === 'acme');
  expect(state).toMatchObject({ transport: 'worker', status: 'ok' });
  expect(worker.start).toHaveBeenCalled();
});

it('registers worker actions through the host action registry', async () => {
  const { host, invokeAction } = makeHost({ kind: 'untrusted' });
  await host.reload();
  await expect(invokeAction('plugin:acme:echo', { value: 1 })).resolves.toEqual({ value: 1 });
});

it('rejects a worker that declares tools', async () => {
  const { host } = makeHost({ kind: 'untrusted', contributions: { tools: [{ name: 'x' }] } });
  await host.reload();
  expect(host.getState().find((p) => p.name === 'acme')).toMatchObject({ status: 'error' });
});

it('never requires the package entry in the gateway process', async () => {
  const { host } = makeHost({ kind: 'untrusted' });
  await host.reload();
  expect(Object.keys(require.cache).some((k) => k.includes('acme/index.js'))).toBe(false);
});

it('quarantines an untrusted package whose fingerprint changed on disk', async () => {
  const { host, safety } = makeHost({ kind: 'untrusted', installedFingerprint: 'sha256:old' });
  await host.reload();
  expect(safety.blockedReason('acme')).toBe('quarantined');
  expect(host.getState().find((p) => p.name === 'acme')?.status).toBe('error');
});
```

Integration: install an untrusted package with a worker available → active; with `workerAvailable: false` → 409; worker flag missing → quarantine, no in-process.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/package-host-worker.test.ts tests/integration/plugin-untrusted.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- In `runReload` / `activate`, branch after manifest parse:
  - `trusted` / legacy → existing `activate()`.
  - `untrusted` → `workerHostFactory` (default creates `WorkerHost`) → `start()`; validate `ready.contributions` with `buildActivatedContributions`; register `ctx.effect(() => worker.stop('dispose'))`; map action handlers to `worker.invoke`.
- `package-validator.ts`: reject `tools` / `observers` / `ui.webSurfaces` / `media` / `runtime` / `tts` for untrusted before publishing.
- `PackageState.transport` set by activation path.
- `PackageManagerDeps.workerAvailable` gates install; host `workerAvailable` gates activation.
- Before activating an untrusted package, compare the current `fingerprintPackage(...)` with `installedFingerprint(name)`. A mismatch calls `onUntrustedDrift(name, 'fingerprint changed on disk')` and throws; no hot reload, no activation.
- If worker start fails: throw; host records `activate.failed`; no fallback.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/package-host-worker.test.ts tests/integration/plugin-untrusted.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/package-host.ts gateway/src/plugins/package-manager.ts gateway/src/plugins/package-validator.ts gateway/tests/unit/plugins/package-host-worker.test.ts gateway/tests/integration/plugin-untrusted.test.ts
git commit -m "feat(plugins): run untrusted packages in workers"
```

---

### Task 17: 6B integration, docs and gate

**Files:**
- Create: `gateway/tests/integration/plugin-worker-security.test.ts`
- Modify: `docs/architecture/plugin.md`
- Create: `docs/releases/2026-11-14-phase6b-worker-host.md`
- Modify: `gateway/package.json`（build copy `src/plugins/worker` → `dist/plugins/worker`）

- [ ] **Step 1: Write the security integration test**

Scenarios:
1. untrusted install + activation in worker; gateway main process has no package module.
2. fs read outside root denied.
3. net / child_process / fetch denied.
4. forbidden contribution rejected.
5. worker crash loop → quarantine; kill switch stops worker; restart does not auto-start.
6. trusted package still in-process and unchanged.

- [ ] **Step 2: Run and fix until green**

Run: `cd gateway && npx jest --runInBand tests/integration/plugin-worker-security.test.ts`
Expected: PASS.

- [ ] **Step 3: Update build and docs**

- `gateway/package.json` build copy adds `cp(src/plugins/worker, dist/plugins/worker)`.
- `docs/architecture/plugin.md`: worker plane, capability matrix, failure semantics, G6 scope.
- `docs/releases/2026-11-14-phase6b-worker-host.md`: scope, test counts, residual net risk, rollback (disable worker → untrusted fail-closed).

- [ ] **Step 4: Run 6B gate**

```bash
(cd gateway && npx jest --runInBand --forceExit --testTimeout=20000)
(cd gateway && npx tsc --noEmit -p tsconfig.json)
npm run test:desktop
```

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/integration/plugin-worker-security.test.ts docs/architecture/plugin.md docs/releases/2026-11-14-phase6b-worker-host.md gateway/package.json
git commit -m "docs: close Phase 6B worker host"
```

---

## Phase 6C：兼容门、last-known-good 与演练

### Task 18: Compatibility gate, deprecation and contract skew

**Files:**
- Modify: `gateway/src/plugins/package-manifest.ts`
- Modify: `gateway/src/plugins/plugin-doctor.ts`
- Modify: `gateway/src/plugins/package-host.ts`
- Test: `gateway/tests/unit/plugins/package-compat.test.ts`

**Interfaces:**
- Consumes: Task 1 parser, Task 7 doctor.
- Produces:
  - Host scan skips packages with `unsupported_api_version` / `host_range_incompatible`, records `PackageState.status = 'error'` + reason.
  - `PluginDoctorReport.checks` includes `deprecation` warn and `contract-skew` warn.
  - `SUPPORTED_PLUGIN_API_VERSIONS` remains `[1, 2]`.

- [ ] **Step 1: Write the failing test**

```ts
it('skips an apiVersion 3 package without entering safe mode', async () => {
  const { host, state } = makeHostWithPackage({ name: 'future', apiVersion: 3 });
  await host.reload();
  expect(host.getState().find((p) => p.name === 'future')).toMatchObject({
    status: 'error', error: expect.stringContaining('unsupported apiVersion'),
  });
  expect(state.isSafeMode()).toBe(false);
});

it('skips a host-range-incompatible package', async () => {
  const { host } = makeHostWithPackage({ name: 'old', apiVersion: 2, host: '>=7.0.0' });
  await host.reload();
  expect(host.getState().find((p) => p.name === 'old')?.error)
    .toContain('host range');
});

it('loads a deprecated package with a doctor warning', async () => {
  const { doctor } = makeDoctorWithPackage({ name: 'old', apiVersion: 2, deprecated: 'use new' });
  const report = await doctor.check('old');
  expect(report.ok).toBe(true);
  expect(report.checks.find((c) => c.id === 'deprecation')?.status).toBe('warn');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/package-compat.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `parsePackageManifest` already rejects unknown apiVersion/host; host uses the parser and records `error` without activating.
- `PluginHost` gets `hostVersion` option (default `process.env.MAFW_HOST_VERSION ?? '5.1.0'`), passes to parser.
- Doctor `contract-skew`: compare `contractVersion` to `@mafw/plugin-contract` package version from `require('@mafw/plugin-contract/package.json').version`; warn on mismatch.
- Audit `install.rejected` / `activate.failed` with `reason`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/package-compat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/package-manifest.ts gateway/src/plugins/plugin-doctor.ts gateway/src/plugins/package-host.ts gateway/tests/unit/plugins/package-compat.test.ts
git commit -m "feat(plugins): add compatibility gate"
```

---

### Task 19: Last-good snapshot and restore

**Files:**
- Create: `gateway/src/plugins/package-last-good.ts`
- Modify: `gateway/src/plugins/package-manager.ts`
- Test: `gateway/tests/unit/plugins/package-last-good.test.ts`

**Interfaces:**
- Produces:
  - `interface LastGoodMeta { version?: string; fingerprint: string; savedAt: string }`
  - `class PackageLastGoodStore { constructor(pluginDir: string, opts?: { maxBytes?: number }); snapshot(name: string, meta: Omit<LastGoodMeta, 'savedAt'>): boolean; restore(name: string): boolean; read(name: string): LastGoodMeta | null; remove(name: string): void }`
  - `PackageManagerDeps.lastGood?: PackageLastGoodStore`
  - `PackageManager.rollback(name: string): Promise<UpdateResult>`

- [ ] **Step 1: Write the failing test**

```ts
it('snapshots and restores the previous package directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-last-good-'));
  writePackage(dir, 'acme', { version: '1.0.0', content: 'old' });
  const store = new PackageLastGoodStore(dir);
  expect(store.snapshot('acme', { version: '1.0.0', fingerprint: 'sha256:old' })).toBe(true);
  fs.writeFileSync(path.join(dir, 'acme', 'index.js'), 'new');
  expect(store.restore('acme')).toBe(true);
  expect(fs.readFileSync(path.join(dir, 'acme', 'index.js'), 'utf8')).toContain('old');
  expect(store.read('acme')).toMatchObject({ version: '1.0.0', fingerprint: 'sha256:old' });
});

it('skips snapshots larger than the cap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-last-good-'));
  writePackage(dir, 'acme', { version: '1.0.0', content: 'x'.repeat(1024) });
  const store = new PackageLastGoodStore(dir, { maxBytes: 10 });
  expect(store.snapshot('acme', { version: '1.0.0', fingerprint: 'sha256:old' })).toBe(false);
  expect(store.read('acme')).toBeNull();
});

it('removes snapshot and metadata with the package', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-last-good-'));
  writePackage(dir, 'acme', { version: '1.0.0', content: 'old' });
  const store = new PackageLastGoodStore(dir);
  store.snapshot('acme', { version: '1.0.0', fingerprint: 'sha256:old' });
  store.remove('acme');
  expect(store.read('acme')).toBeNull();
  expect(fs.existsSync(path.join(dir, '.last-good', 'acme'))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/package-last-good.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

- Layout: `<pluginDir>/.last-good/<name>/` and `<pluginDir>/.last-good/<name>.json`.
- Snapshot uses `fs.cpSync` into a temp dir + rename; exclude `.last-good`, `.install-*`, `.backup-*`, logs/temp.
- Cap default 50 MiB; over cap → return false.
- Restore: remove current `<name>` (or file), rename snapshot into place; keep metadata until success.
- `PackageManager` calls `lastGood.snapshot(name, meta)` before overwrite; on rollback calls `restore` + `host.reload()`.
- Add `rollback(name)` and route/CLI in Task 21.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/package-last-good.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/package-last-good.ts gateway/src/plugins/package-manager.ts gateway/tests/unit/plugins/package-last-good.test.ts
git commit -m "feat(plugins): keep last-known-good snapshots"
```

---

### Task 20: Health window, pending marker and boot rollback

**Files:**
- Modify: `gateway/src/plugins/plugin-safety.ts`
- Modify: `gateway/src/plugins/package-manager.ts`
- Modify: `gateway/src/boot.ts`
- Test: `gateway/tests/unit/plugins/plugin-health-window.test.ts`
- Test: `gateway/tests/integration/plugin-boot-rollback.test.ts`

**Interfaces:**
- Produces:
  - `PluginSafety.beginHealthCheck(name: string, meta: { version?: string; fingerprint: string }): void`
  - `PluginSafety.confirmHealthCheck(name: string): void`
  - `PluginSafety.pendingHealthCheck(name: string): PackageInstalledState['pendingHealthCheck']`
  - `PluginSafety.reconcilePendingHealthChecks(): Promise<{ rolledBack: string[]; quarantined: string[] }>`
  - `PluginSafetyDeps.lastGood?: PackageLastGoodStore`, `healthWindowMs?: number`
  - Boot calls `safety.reconcilePendingHealthChecks()` before `host.reload()`.

- [ ] **Step 1: Write the failing tests**

```ts
it('rolls back when a pending health check is reconciled', async () => {
  const { safety, state, lastGood } = makeSafety();
  safety.beginHealthCheck('acme', { version: '2.0.0', fingerprint: 'sha256:new' });
  await safety.reconcilePendingHealthChecks();
  expect(lastGood.restore).toHaveBeenCalledWith('acme');
  expect(state.getInstalled('acme')?.degraded?.reason).toContain('health');
  expect(state.getInstalled('acme')?.pendingHealthCheck).toBeNull();
});

it('confirms a healthy package after the window', () => {
  const { safety, state } = makeSafety();
  safety.beginHealthCheck('acme', { version: '2.0.0', fingerprint: 'sha256:new' });
  safety.confirmHealthCheck('acme');
  expect(state.getInstalled('acme')?.pendingHealthCheck).toBeNull();
  expect(state.getInstalled('acme')?.lastKnownGood).toMatchObject({ fingerprint: 'sha256:new' });
});

it('boot reconciles an unconfirmed health check before activation', async () => {
  // write state with pendingHealthCheck, then construct a new manager/safety and boot
  await expect(runBoot()).resolves.toMatchObject({ rolledBack: ['acme'] });
  expect(activated).toEqual(['acme']); // old version activated after restore
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/plugin-health-window.test.ts tests/integration/plugin-boot-rollback.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `beginHealthCheck`: only writes `pendingHealthCheck`; it does **not** auto-confirm by time.
- After a successful commit, `PackageManager` / host schedules `setTimeout(() => safety.confirmHealthCheck(name), healthWindowMs)` (default 5 min, unref'd). `confirmHealthCheck`:
  1. reads the current installed fingerprint; if it does not match `pendingHealthCheck.fingerprint`, do nothing;
  2. calls `lastGood.snapshot(name, { version, fingerprint })` to make the current version the new rollback target;
  3. writes `lastKnownGood = { version, fingerprint, savedAt }` and clears pending.
- `reconcilePendingHealthChecks`: for each pending entry, call `lastGood.restore`; on success set `degraded` + clear pending; on failure quarantine; return lists.
- Boot order: state store → safety → reconcile → host reload. If no last-good, quarantine.
- On activation failure after commit (worker crash / integrity), stop and reconcile immediately.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest --runInBand tests/unit/plugins/plugin-health-window.test.ts tests/integration/plugin-boot-rollback.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/plugin-safety.ts gateway/src/plugins/package-manager.ts gateway/src/boot.ts gateway/tests/unit/plugins/plugin-health-window.test.ts gateway/tests/integration/plugin-boot-rollback.test.ts
git commit -m "feat(plugins): roll back unconfirmed updates on boot"
```

---

### Task 21: Manual rollback, last-good API and drill harness

**Files:**
- Modify: `gateway/src/routes/plugin-packages.ts`
- Modify: `gateway/src/routes/wave2-handlers.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/cli/plugins-command.ts`
- Create: `gateway/tests/integration/plugin-trust-drill.test.ts`
- Modify: `gateway/package.json`, root `package.json`（`drill:plugin-trust`）

**Interfaces:**
- Produces routes:
  - `GET /api/plugins/:name/last-good`
  - `POST /api/plugins/:name/rollback` (human/device)
- CLI: `mafw plugins rollback <name>`.
- Drill test writes `artifacts/plugin-trust-drill.json` with 10 scenarios from spec §6.3.

- [ ] **Step 1: Write the failing tests**

Route test:
```ts
it('rollback requires human and restores last-good', async () => {
  expect((await callRollback('acme', { kind: 'service' })).status).toBe(403);
  expect((await callRollback('acme', { kind: 'human' })).status).toBe(200);
  expect(lastGood.restore).toHaveBeenCalledWith('acme');
});
```

Drill test skeleton:
```ts
const scenarios = [
  ['update-rollback-before-commit', scenarioBeforeCommit],
  ['update-rollback-in-window', scenarioInWindow],
  ['boot-loop-rollback', scenarioBootLoop],
  ['integrity-mismatch', scenarioIntegrity],
  ['safe-mode-persist', scenarioSafeMode],
  ['auto-quarantine', scenarioAutoQuarantine],
  ['corrupt-state', scenarioCorruptState],
  ['unsupported-api', scenarioUnsupportedApi],
  ['worker-crash-loop', scenarioWorkerCrash],
  ['version-skew', scenarioVersionSkew],
] as const;

it('writes the drill report', async () => {
  const report = { startedAt: new Date().toISOString(), node: process.version, scenarios: [] as any[] };
  for (const [id, run] of scenarios) {
    const started = Date.now();
    const ok = await run();
    report.scenarios.push({ id, ok, durationMs: Date.now() - started });
  }
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync('artifacts/plugin-trust-drill.json', JSON.stringify(report, null, 2));
  expect(report.scenarios.every((s) => s.ok)).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest --runInBand tests/integration/plugin-trust-drill.test.ts`
Expected: FAIL (scenarios not implemented).

- [ ] **Step 3: Implement**

- Add the two routes + catalog entries; update `TOTAL_OPS` 325 → 327.
- `PackageManager.rollback(name)` loads last-good, restores, reloads, audits `rollback`, returns `UpdateResult` with `application: 'applied'`.
- CLI `rollback` uses human token.
- Implement the 10 scenarios with temp dirs, a fake host where needed, and `healthWindowMs` 5–20ms.
- `worker-crash-loop` uses `WorkerHost` with a crash fixture; skip with a clear message only if no permission flag is available, but keep `ok: false` so CI catches unsupported Node.
- Add npm scripts:
  - root: `"drill:plugin-trust": "npm --prefix gateway run drill:plugin-trust"`
  - gateway: `"drill:plugin-trust": "jest --runInBand tests/integration/plugin-trust-drill.test.ts"`

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd gateway && npx jest --runInBand tests/integration/plugin-trust-drill.test.ts tests/unit/routes/plugin-packages.test.ts tests/unit/architecture/schema-coverage.test.ts
cd .. && npm run drill:plugin-trust
```
Expected: 10/10 scenarios; schema ledger passes; artifact exists.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/plugin-packages.ts gateway/src/routes/wave2-handlers.ts gateway/src/routes/route-catalog.ts gateway/src/cli/plugins-command.ts gateway/tests/integration/plugin-trust-drill.test.ts gateway/package.json package.json
git commit -m "feat(plugins): add rollback and trust drills"
```

---

### Task 22: 6C docs, final gates and release

**Files:**
- Create: `docs/guides/plugin-trust-drills.md`
- Create: `docs/releases/2026-11-14-phase6c-compat-rollback.md`
- Modify: `docs/architecture/plugin.md`

- [ ] **Step 1: Write the drill guide**

Cover: `npm run drill:plugin-trust`, report fields, how to read each scenario, how to recover from quarantine / safe mode, what a failed rollback means, and the downgrade warning (state v2 / old gateway).

- [ ] **Step 2: Write the 6C release doc**

Include: apiVersion/host gate, last-good layout, health window, boot rollback, drill results, test counts, key commits, rollback instructions.

- [ ] **Step 3: Update architecture doc**

Add the 6C subsection: compatibility matrix, last-good state machine, drill gate.

- [ ] **Step 4: Run the final Phase 6 gate**

```bash
(cd gateway && npx jest --runInBand --forceExit --testTimeout=20000)
(cd gateway && npx tsc --noEmit -p tsconfig.json)
npm run test:desktop
(cd packages/gateway-sdk && npm test)
npm run test:plugin-contract
npm run drill:plugin-trust
```

Record exact pass / skip counts in the release doc.

- [ ] **Step 5: Commit**

```bash
git add docs/guides/plugin-trust-drills.md docs/releases/2026-11-14-phase6c-compat-rollback.md docs/architecture/plugin.md
git commit -m "docs: close Phase 6C compatibility and rollback"
```

---

## Self-Review Notes

- **Spec coverage**: 6A covers §4 (manifest, state, integrity, consent, audit, doctor, kill/quarantine/safe mode, API/DTO/CLI/desktop); 6B covers §5 (process, RPC, ctx, lifecycle, failure semantics); 6C covers §6 (compat, last-good, drills) and §7 G6 boundary. §8 failure table is exercised by the drill + integration tests.
- **Deferred**: OS-level hermetic net isolation is explicitly out of scope per spec §7 / §13.
- **Existing behavior**: v1 packages, single-file packages, plugin-creator drafts, MCP `mafw_plugin_manager`, web surfaces, and trusted in-process packages keep working; 6A only adds fields and guards.
- **Known implementation choices left to the builder**: exact Ajv schema for doctor/audit responses, exact `PluginPackagesSection` layout, exact worker log rate limit, and the drill helper structure.
