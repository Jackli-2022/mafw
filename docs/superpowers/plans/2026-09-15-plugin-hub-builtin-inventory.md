# 插件中心全量清单（builtin inventory）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 插件中心显示全量插件（内置 runtime/media/usage 条目 + 用户文件），安装改为 raw octet-stream 传输 + 接口自动判型，移除示例生成与「Runtime & Media」卡。

**Architecture:** gateway `hub.ts` 为唯一清单权威——`listPlugins` 经 `builtinEntries` 注入内置条目；`installPlugin` 接收 raw Buffer 并以 tmp-require 嗅探 `module.exports` 接口定型；SDK/desktop 链路改直传字节；renderer 内置行只读（runtime 激活/usage 克隆），media 每模态下拉并入 hub，「Runtime & Media」卡删除。

**Tech Stack:** TypeScript（gateway CJS + tsc nodenext）、Jest（gateway）、Bun test（SDK 与 desktop renderer）、SolidJS（Config 页）。

**Spec:** `docs/superpowers/specs/2026-09-15-plugin-hub-builtin-inventory-design.md`

## Global Constraints

- 四目录布局不变：`~/.mafw/{runtime,media,usage,ui}-plugins/`（ui 可被 `MAFW_UI_PLUGINS_DIR` 覆盖）
- 内置条目约定：`file: '(builtin)'`、`size: 0`、`mtime: ''`、`builtin: true`；同名用户文件 → 内置条目 `overridden: true`
- 安装端点：`POST /api/plugins/install?filename=<x.js>[&type=...][&overwrite=1]`，body 为原始字节，上限 2MB（raw 计）
- 嗅探优先级：请求显式 `type` > 接口推导；零命中 400 `unrecognized plugin interface`、多命中 400 `ambiguous plugin interface: <a/b>`
- 内置条目永不渲染开关/删除；usage 内置行仅「克隆」（`overridden` 时隐藏）
- 测试命令：gateway `cd gateway && npx jest tests/unit/<file>`；SDK `cd packages/gateway-sdk && bun test src/<file>`；renderer `cd packages/desktop && bun test src/renderer/mafw/pages/<file>`
- TDD：每任务先写失败测试再实现；提交信息用 repo 现有风格（`feat(hub): ...` / `feat(desktop): ...`）
- 新建文件必须立即 `git add` 并提交（repo 规约）

---

### Task 1: hub 数据模型与内置条目合并（listPlugins）

**Files:**
- Modify: `gateway/src/plugins/hub.ts`
- Test: `gateway/tests/unit/plugins-hub.test.ts`

**Interfaces:**
- Consumes: 现有 `HubDeps`（dirs/getErrors/configDisabledUsage/reload/maxBytes）
- Produces: `HubEntry` 新增 `builtin?: boolean; overridden?: boolean; pluginType?: string`；`HubDeps` 新增 `builtinEntries?: () => PluginEntry[]`（返回已按显示顺序排好的内置条目，hub 负责 `builtin:true` 标记与覆盖/禁用映射）

- [ ] **Step 1: 写失败测试**（追加到 `plugins-hub.test.ts` 的 `describe('listPlugins')` 内）

```ts
test('builtin entries are listed first with builtin flag', () => {
  const deps = makeDeps({
    builtinEntries: () => [
      { type: 'runtime', name: 'opencode', file: '(builtin)', status: 'enabled', size: 0, mtime: '' },
      { type: 'runtime', name: 'pi', file: '(builtin)', status: 'enabled', size: 0, mtime: '' },
      { type: 'media', name: 'pi', file: '(builtin)', status: 'enabled', size: 0, mtime: '' },
      { type: 'usage', name: 'deepseek', file: 'deepseek.js', status: 'enabled', size: 0, mtime: '', pluginType: 'api' },
    ],
  });
  fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'x');
  const entries = listPlugins(deps);
  expect(entries.map((e) => `${e.type}/${e.name}`)).toEqual([
    'runtime/opencode', 'runtime/pi', 'media/pi', 'usage/deepseek', 'runtime/foo',
  ]);
  expect(entries[0]).toEqual(expect.objectContaining({ builtin: true, size: 0, mtime: '' }));
});

test('user file with same name marks builtin overridden', () => {
  const deps = makeDeps({
    builtinEntries: () => [{ type: 'usage', name: 'deepseek', file: 'deepseek.js', status: 'enabled', size: 0, mtime: '', pluginType: 'api' }],
  });
  fs.writeFileSync(path.join(deps.dirs.usage, 'deepseek.js'), 'user copy');
  const entries = listPlugins(deps);
  const builtin = entries.find((e) => e.builtin)!;
  expect(builtin.overridden).toBe(true);
  const user = entries.find((e) => !e.builtin)!;
  expect(user).toEqual(expect.objectContaining({ name: 'deepseek', status: 'enabled' }));
});

test('usage builtin in config disabledPlugins shows config-disabled', () => {
  const deps = makeDeps({
    builtinEntries: () => [{ type: 'usage', name: 'deepseek', file: 'deepseek.js', status: 'enabled', size: 0, mtime: '' }],
    configDisabledUsage: () => new Set(['deepseek']),
  });
  const [builtin] = listPlugins(deps);
  expect(builtin).toEqual(expect.objectContaining({ status: 'config-disabled', builtin: true }));
});

test('no builtinEntries dep → unchanged behavior', () => {
  expect(listPlugins(makeDeps())).toEqual([]);
});
```

- [ ] **Step 2: 运行验证失败**

Run: `cd gateway && npx jest tests/unit/plugins-hub.test.ts`
Expected: 新增 4 例 FAIL（`builtinEntries` 未定义 / `overridden` undefined）

- [ ] **Step 3: 实现**（`hub.ts`）

`HubEntry` 增加字段：

```ts
export interface PluginEntry {
  type: PluginType;
  name: string;
  file: string;
  status: PluginStatus;
  error?: string;
  size: number;
  mtime: string;
  builtin?: boolean;
  overridden?: boolean;
  pluginType?: string;
}
```

`HubDeps` 增加成员（放在 `maxBytes` 之后）：

```ts
  /** builtin inventory entries in display order; hub stamps builtin/overridden/config-disabled. */
  builtinEntries?: () => PluginEntry[];
```

`listPlugins` 改为：收集用户条目（现有逻辑不动，改名为 `collectUserEntries(deps)`），再合并：

```ts
export function listPlugins(deps: HubDeps): PluginEntry[] {
  const userEntries = collectUserEntries(deps);
  const builtins = (deps.builtinEntries?.() ?? []).map((e) => ({ ...e, builtin: true }));
  const userKeys = new Set(userEntries.map((e) => `${e.type}/${e.name}`));
  const configDisabled = deps.configDisabledUsage?.() ?? new Set<string>();
  for (const b of builtins) {
    if (userKeys.has(`${b.type}/${b.name}`)) b.overridden = true;
    if (b.type === 'usage' && configDisabled.has(b.name) && b.status === 'enabled') b.status = 'config-disabled';
  }
  return [...builtins, ...userEntries];
}
```

（原 `listPlugins` 主体原样改名为 `collectUserEntries`，内部 `configDisabled` 逻辑保留不动。）

- [ ] **Step 4: 运行验证通过**

Run: `cd gateway && npx jest tests/unit/plugins-hub.test.ts`
Expected: 全部 PASS（含原有 15 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/hub.ts gateway/tests/unit/plugins-hub.test.ts
git commit -m "feat(hub): builtin entries merge in listPlugins (builtin/overridden/pluginType)"
```

---

### Task 2: cleanupExamples（停生成前的存量清理函数）

**Files:**
- Modify: `gateway/src/plugins/hub.ts`
- Test: `gateway/tests/unit/plugins-hub.test.ts`

**Interfaces:**
- Produces: `cleanupExamples(deps: HubDeps): { removed: string[]; failed: string[] }`（幂等，目录缺失跳过；不抛异常）

- [ ] **Step 1: 写失败测试**（新 `describe('cleanupExamples')`）

```ts
describe('cleanupExamples', () => {
  test('removes example.js.disabled in all four dirs', () => {
    const deps = makeDeps();
    for (const d of Object.values(deps.dirs)) fs.writeFileSync(path.join(d, 'example.js.disabled'), 'x');
    const out = cleanupExamples(deps);
    expect(out.removed).toHaveLength(4);
    expect(out.failed).toEqual([]);
    for (const d of Object.values(deps.dirs)) expect(fs.existsSync(path.join(d, 'example.js.disabled'))).toBe(false);
  });

  test('idempotent on missing files/dirs and keeps other files', () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'README.md'), 'keep');
    const out = cleanupExamples(deps);
    expect(out.removed).toEqual([]);
    expect(fs.existsSync(path.join(deps.dirs.runtime, 'README.md'))).toBe(true);
  });

  test('failed unlink is reported not thrown', () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.ui, 'example.js.disabled'), 'x');
    const orig = fs.unlinkSync;
    (fs as any).unlinkSync = (p: string) => { if (p.endsWith('example.js.disabled')) throw new Error('EBUSY'); orig(p); };
    try {
      const out = cleanupExamples(deps);
      expect(out.failed).toHaveLength(1);
    } finally { (fs as any).unlinkSync = orig; }
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `cd gateway && npx jest tests/unit/plugins-hub.test.ts -t cleanupExamples`
Expected: FAIL（`cleanupExamples` 未导出）

- [ ] **Step 3: 实现**（`hub.ts` 末尾追加）

```ts
export function cleanupExamples(deps: HubDeps): { removed: string[]; failed: string[] } {
  const removed: string[] = [];
  const failed: string[] = [];
  for (const dir of Object.values(deps.dirs)) {
    const target = path.join(dir, 'example.js.disabled');
    try {
      if (fs.existsSync(target)) { fs.unlinkSync(target); removed.push(target); }
    } catch { failed.push(target); }
  }
  return { removed, failed };
}
```

（测试文件 import 行补上 `cleanupExamples`。）

- [ ] **Step 4: 运行验证通过**

Run: `cd gateway && npx jest tests/unit/plugins-hub.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/hub.ts gateway/tests/unit/plugins-hub.test.ts
git commit -m "feat(hub): cleanupExamples removes stale example.js.disabled"
```

---

### Task 3: installPlugin 改 raw bytes + 接口嗅探

**Files:**
- Modify: `gateway/src/plugins/hub.ts`
- Modify: `gateway/src/routes/plugins.ts`
- Test: `gateway/tests/unit/plugins-hub.test.ts`

**Interfaces:**
- Consumes: Task 1/2 的 hub 现状
- Produces: `installPlugin(deps, input: { type?: PluginType; filename: string; bytes: Buffer; overwrite?: boolean }): Promise<PluginEntry>`（`contentBase64` 移除；`decodeContent` 移除）；`routes/plugins.ts` 的 install handler 读 raw body + query

- [ ] **Step 1: 重写 install 测试**（`describe('installPlugin')` 整体替换；`B64` 常量删除，换 `MOD` Buffer 工厂）

```ts
const mod = (body: string) => Buffer.from(body, 'utf-8');
const PLAIN = mod('module.exports = { name: "foo" };');
const RUNTIME_MOD = mod('module.exports = { name: "my-rt", createRuntime: async () => ({}) };');
const MEDIA_MOD = mod('module.exports = { name: "my-media", createPrompt: async () => async () => "" };');
const USAGE_MOD = mod('module.exports = { name: "my-usage", type: "api", fetch: async () => null };');
const UI_MOD = mod('module.exports = { name: "my-ui", tools: { t: { render: () => [] } } };');
const AMBIGUOUS_MOD = mod('module.exports = { name: "both", createPrompt: async () => async () => "", fetch: async () => null };');

describe('installPlugin', () => {
  test('writes raw bytes, triggers reload, returns enabled entry', async () => {
    const deps = makeDeps();
    const entry = await installPlugin(deps, { type: 'runtime', filename: 'foo.js', bytes: PLAIN });
    expect(fs.readFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'utf-8')).toContain('name: "foo"');
    expect(deps.reload).toHaveBeenCalledWith('runtime');
    expect(entry).toEqual(expect.objectContaining({ name: 'foo', status: 'enabled' }));
  });

  test('sniffs runtime interface', async () => {
    const deps = makeDeps();
    const entry = await installPlugin(deps, { filename: 'rt.js', bytes: RUNTIME_MOD });
    expect(fs.existsSync(path.join(deps.dirs.runtime, 'rt.js'))).toBe(true);
    expect(entry.type).toBe('runtime');
    expect(deps.reload).toHaveBeenCalledWith('runtime');
  });

  test('sniffs media interface (createPrompt / engine / fixPayload / modalities)', async () => {
    const deps = makeDeps();
    const e1 = await installPlugin(deps, { filename: 'm1.js', bytes: MEDIA_MOD });
    expect(e1.type).toBe('media');
    const e2 = await installPlugin(deps, { filename: 'm2.js', bytes: mod('module.exports = { engine: "pi" };') });
    expect(e2.type).toBe('media');
    const e3 = await installPlugin(deps, { filename: 'm3.js', bytes: mod('module.exports = { modalities: ["image"] };') });
    expect(e3.type).toBe('media');
  });

  test('sniffs usage interface (fetch; type optional)', async () => {
    const deps = makeDeps();
    const e1 = await installPlugin(deps, { filename: 'u1.js', bytes: USAGE_MOD });
    expect(e1.type).toBe('usage');
    const e2 = await installPlugin(deps, { filename: 'u2.js', bytes: mod('module.exports = { fetch: async () => null };') });
    expect(e2.type).toBe('usage');
  });

  test('sniffs ui interface (tools object)', async () => {
    const deps = makeDeps();
    const entry = await installPlugin(deps, { filename: 'ui.js', bytes: UI_MOD });
    expect(entry.type).toBe('ui');
  });

  test('unrecognized interface → 400 and no file left behind', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { filename: 'x.js', bytes: mod('module.exports = { name: "x" };') }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('unrecognized plugin interface') });
    for (const d of Object.values(deps.dirs)) {
      expect(fs.readdirSync(d).filter((f) => f.endsWith('.js') || f.endsWith('.tmp'))).toEqual([]);
    }
  });

  test('ambiguous interface → 400 with candidates', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { filename: 'x.js', bytes: AMBIGUOUS_MOD }))
      .rejects.toMatchObject({ status: 400, message: 'ambiguous plugin interface: media/usage' });
  });

  test('explicit type skips sniffing', async () => {
    const deps = makeDeps();
    const entry = await installPlugin(deps, { type: 'ui', filename: 'weird.js', bytes: mod('module.exports = { name: "weird" };') });
    expect(fs.existsSync(path.join(deps.dirs.ui, 'weird.js'))).toBe(true);
    expect(entry.type).toBe('ui');
  });

  test('duplicate name (enabled or disabled variant) → HubError 409', async () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'old');
    await expect(installPlugin(deps, { type: 'runtime', filename: 'foo.js', bytes: PLAIN }))
      .rejects.toMatchObject({ status: 409 });
  });

  test('overwrite: true replaces existing file', async () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'old');
    await installPlugin(deps, { type: 'runtime', filename: 'foo.js', bytes: PLAIN, overwrite: true });
    expect(fs.readFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'utf-8')).toContain('name: "foo"');
  });

  test('path traversal rejected', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'runtime', filename: '../evil.js', bytes: PLAIN }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('invalid type rejected', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'nope' as any, filename: 'a.js', bytes: PLAIN }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('oversized content rejected (raw bytes)', async () => {
    const deps = makeDeps({ maxBytes: 4 });
    await expect(installPlugin(deps, { type: 'runtime', filename: 'a.js', bytes: PLAIN }))
      .rejects.toMatchObject({ status: 413 });
  });

  test('empty bytes rejected', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'runtime', filename: 'a.js', bytes: Buffer.alloc(0) }))
      .rejects.toMatchObject({ status: 400 });
  });
});
```

（`describe('setPluginEnabled / deletePlugin')` 不动。）

- [ ] **Step 2: 运行验证失败**

Run: `cd gateway && npx jest tests/unit/plugins-hub.test.ts -t installPlugin`
Expected: FAIL（`bytes` 不被识别 / 嗅探不存在）

- [ ] **Step 3: 实现 hub.ts**（`installPlugin` 整体替换；删除 `decodeContent`；顶部 import 补 `* as os from 'os'`）

```ts
export interface InstallInput {
  type?: PluginType;
  filename: string;
  bytes: Buffer;
  overwrite?: boolean;
}

export async function installPlugin(deps: HubDeps, input: InstallInput): Promise<PluginEntry> {
  const filename = validateFilename(input.filename);
  if (!filename.endsWith('.js')) throw new HubError(400, `install filename must end with .js: ${filename}`);
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) throw new HubError(400, 'empty content');
  if (input.bytes.length > maxBytes) throw new HubError(413, `content exceeds ${maxBytes} bytes`);
  const type = input.type ? parseType(input.type) : sniffPluginType(filename, input.bytes);
  const dir = deps.dirs[type];
  fs.mkdirSync(dir, { recursive: true });
  const target = resolveInDir(dir, filename);
  const dup = path.join(dir, filename);
  const dupDisabled = path.join(dir, filename.replace(/\.js$/, '.js.disabled'));
  if (!input.overwrite && (fs.existsSync(dup) || fs.existsSync(dupDisabled))) {
    throw new HubError(409, `plugin already exists: ${filename}`);
  }
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, input.bytes);
  fs.renameSync(tmp, target);
  await deps.reload?.(type);
  return statEntry(type, dir, filename);
}

function sniffPluginType(filename: string, bytes: Buffer): PluginType {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-hub-sniff-'));
  const tmpFile = path.join(tmpDir, filename);
  try {
    fs.writeFileSync(tmpFile, bytes);
    try { delete require.cache[require.resolve(tmpFile)]; } catch { /* first load */ }
    const mod = require(tmpFile) as Record<string, unknown>;
    const matches: PluginType[] = [];
    if (typeof mod?.createRuntime === 'function') matches.push('runtime');
    if (typeof mod?.createPrompt === 'function' || typeof mod?.fixPayload === 'function'
        || typeof mod?.engine === 'string' || Array.isArray(mod?.modalities)) matches.push('media');
    if (typeof mod?.fetch === 'function'
        && (mod.type === undefined || mod.type === 'api' || mod.type === 'token-plan' || mod.type === 'local')) matches.push('usage');
    if (mod?.tools && typeof mod.tools === 'object' && Object.keys(mod.tools as object).length > 0) matches.push('ui');
    if (matches.length === 0) throw new HubError(400, 'unrecognized plugin interface: export createRuntime / createPrompt / fetch / tools');
    if (matches.length > 1) throw new HubError(400, `ambiguous plugin interface: ${matches.join('/')}`);
    return matches[0];
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
```

- [ ] **Step 4: 实现 routes/plugins.ts**（`handlePluginsInstall` 替换 + body 读取改 Buffer）

```ts
function readBodyBuffer(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function handlePluginsInstall(req: http.IncomingMessage, res: http.ServerResponse, deps: PluginsRouteDeps): Promise<void> {
  await guarded(res, async () => {
    const url = new URL(req.url || '/', 'http://localhost');
    const filename = url.searchParams.get('filename') || '';
    const type = url.searchParams.get('type') || undefined;
    const overwrite = url.searchParams.get('overwrite') === '1' || url.searchParams.get('overwrite') === 'true';
    const bytes = await readBodyBuffer(req);
    const entry = await installPlugin(deps.hub, { filename, type, bytes, overwrite });
    log.info(`[PluginsHub] installed ${entry.type}/${filename}`);
    return entry;
  });
}
```

（`readJsonBody` 仍被 enable/disable/delete 使用，保留。）

- [ ] **Step 5: 运行验证通过**

Run: `cd gateway && npx jest tests/unit/plugins-hub.test.ts`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add gateway/src/plugins/hub.ts gateway/src/routes/plugins.ts gateway/tests/unit/plugins-hub.test.ts
git commit -m "feat(hub): raw octet-stream install with interface sniffing"
```

---

### Task 4: SDK install 直传字节 + list 类型扩展

**Files:**
- Modify: `packages/gateway-sdk/src/client.ts:424-440`
- Test: `packages/gateway-sdk/src/plugins.test.ts`

**Interfaces:**
- Consumes: Task 3 的 query 协议
- Produces: `plugins.install(input: { filename: string; type?: 'runtime'|'media'|'usage'|'ui'; bytes: Uint8Array; overwrite?: boolean })`；`plugins.list()` 返回类型含 `builtin?/overridden?/pluginType?`

- [ ] **Step 1: 更新测试**（`plugins.test.ts` 中 install 相关用例整体替换）

```ts
test("sdk plugins.install posts raw bytes with query params", async () => {
  const f = stubFetch(200, { type: "runtime", name: "foo", file: "foo.js", status: "enabled", size: 2, mtime: "" });
  const client = new MafwClient("http://127.0.0.1:3000", { fetchImpl: f as any });
  const bytes = new Uint8Array([104, 105]);
  await client.plugins.install({ filename: "foo.js", bytes });
  expect((f as any).mock.calls[0][0]).toBe("http://127.0.0.1:3000/api/plugins/install?filename=foo.js");
  expect((f as any).mock.calls[0][1].headers["Content-Type"]).toBe("application/octet-stream");
  expect((f as any).mock.calls[0][1].body).toBe(bytes);
});

test("sdk plugins.install forwards optional type/overwrite", async () => {
  const f = stubFetch(200, {});
  const client = new MafwClient("http://127.0.0.1:3000", { fetchImpl: f as any });
  await client.plugins.install({ filename: "b.js", type: "ui", bytes: new Uint8Array([1]), overwrite: true });
  const url = (f as any).mock.calls[0][0] as string;
  expect(url).toContain("type=ui");
  expect(url).toContain("overwrite=1");
});

test("sdk plugins.error response throws with server message", async () => {
  const f = stubFetch(400, { error: "ambiguous plugin interface: media/usage" });
  const client = new MafwClient("http://127.0.0.1:3000", { fetchImpl: f as any });
  await expect(client.plugins.install({ filename: "foo.js", bytes: new Uint8Array([1]) }))
    .rejects.toThrow("ambiguous plugin interface: media/usage");
});
```

（保留原 `plugins.list` 测试并给 mock 数据补 `builtin: true` 断言字段透传；enable/disable/delete 用例不动。以文件内实际 helper 名为准——`stubFetch`/`okJson` 与现有测试保持一致。）

- [ ] **Step 2: 运行验证失败**

Run: `cd packages/gateway-sdk && bun test src/plugins.test.ts`
Expected: FAIL（新签名不存在）

- [ ] **Step 3: 实现 client.ts**（`plugins` 块的 `list`/`install` 替换）

```ts
  plugins = {
    list: async (): Promise<{
      plugins: { type: 'runtime' | 'media' | 'usage' | 'ui'; name: string; file: string; status: 'enabled' | 'disabled' | 'error' | 'config-disabled'; error?: string; size: number; mtime: string; builtin?: boolean; overridden?: boolean; pluginType?: string }[];
    }> => this.request('/api/plugins'),

    install: async (input: { filename: string; type?: 'runtime' | 'media' | 'usage' | 'ui'; bytes: Uint8Array; overwrite?: boolean }): Promise<any> => {
      const params = new URLSearchParams({ filename: input.filename });
      if (input.type) params.set('type', input.type);
      if (input.overwrite) params.set('overwrite', '1');
      const res = await this.fetchImpl(`${this.baseUrl}/api/plugins/install?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: input.bytes as unknown as BodyInit,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Plugin install failed: ${res.status}`)
      }
      return res.json()
    },
    // enable/disable/delete 原样保留
```

- [ ] **Step 4: 运行验证通过 + 全 SDK 套件回归**

Run: `cd packages/gateway-sdk && bun test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/plugins.test.ts
git commit -m "feat(sdk): plugins.install raw bytes + list builtin fields"
```

---

### Task 5: renderer 安装面板直传 + ambiguous 兜底

**Files:**
- Modify: `packages/desktop/src/preload/mafw-types.ts`（plugins.install 签名）
- Modify: `packages/desktop/src/renderer/mafw/pages/Config.tsx`（installFile 信号、onInstallFileChosen、doInstall、安装面板 JSX）
- Test: `packages/desktop/src/renderer/mafw/pages/plugin-hub.test.ts`

**Interfaces:**
- Consumes: Task 4 SDK 签名
- Produces: `parseAmbiguousCandidates(message: string): string[] | null`（plugin-hub.ts 新纯函数）；`installFile` 信号形状 `{ name: string; bytes: Uint8Array; size: number } | null`；`installType` 可空（默认无类型）；`installCandidates` 信号存 ambiguous 候选

- [ ] **Step 1: 写失败测试**（`plugin-hub.test.ts` 追加）

```ts
import { parseAmbiguousCandidates } from "./plugin-hub"

describe("parseAmbiguousCandidates", () => {
  test("parses candidate list from gateway error message", () => {
    expect(parseAmbiguousCandidates("ambiguous plugin interface: media/usage")).toEqual(["media", "usage"])
  })
  test("returns null for other errors", () => {
    expect(parseAmbiguousCandidates("plugin already exists: foo.js")).toBeNull()
    expect(parseAmbiguousCandidates("ambiguous plugin interface: ")).toBeNull()
  })
})
```

- [ ] **Step 2: 运行验证失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/pages/plugin-hub.test.ts`
Expected: FAIL（函数不存在）

- [ ] **Step 3: 实现 plugin-hub.ts**（追加）

```ts
export function parseAmbiguousCandidates(message: string): string[] | null {
  const prefix = "ambiguous plugin interface: "
  if (!message.startsWith(prefix)) return null
  const rest = message.slice(prefix.length).trim()
  const candidates = rest.split("/").map((s) => s.trim()).filter(Boolean)
  return candidates.length > 0 ? candidates : null
}
```

- [ ] **Step 4: 更新 preload 类型**（`mafw-types.ts` `plugins` 接口，install 行替换）

```ts
    install(input: { filename: string; type?: 'runtime' | 'media' | 'usage' | 'ui'; bytes: Uint8Array; overwrite?: boolean }): Promise<any>
```

（`mafw-api.ts` 的 `install: (input) => invoke("plugins", "install", input)` 无需改动——通用派发。）

- [ ] **Step 5: 更新 Config.tsx**（锚点：`// ── 插件中心（Plugin Hub）──` 到 `doInstall` 结束）

信号区替换：

```tsx
  const [installType, setInstallType] = createSignal<string | null>(null)
  const [installFile, setInstallFile] = createSignal<{ name: string; bytes: Uint8Array; size: number } | null>(null)
  const [installCandidates, setInstallCandidates] = createSignal<string[] | null>(null)
```

`onInstallFileChosen` 替换（删除逐字节 base64 循环与 btoa）：

```tsx
  const onInstallFileChosen = async (e: Event) => {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    if (!file.name.endsWith(".js")) {
      showToastV2({ description: "仅支持 .js 插件文件", duration: 3000 })
      input.value = ""
      return
    }
    const buf = await file.arrayBuffer()
    setInstallFile({ name: file.name, bytes: new Uint8Array(buf), size: buf.byteLength })
    setInstallCandidates(null)
    input.value = ""
  }
```

`doInstall` 替换：

```tsx
  const doInstall = async () => {
    const f = installFile()
    if (!f) return
    setInstallBusy(true)
    try {
      await window.api.mafw.plugins.install({
        filename: f.name,
        bytes: f.bytes,
        ...(installType() ? { type: installType() as any } : {}),
      })
      showToastV2({ description: `已安装 ${f.name}`, duration: 3000 })
      setInstallFile(null); setInstallType(null); setInstallCandidates(null); setInstallOpen(false)
      await loadPluginHub()
    } catch (err: any) {
      const candidates = parseAmbiguousCandidates(String(err.message ?? err))
      if (candidates) {
        setInstallCandidates(candidates)
        showToastV2({ description: `无法唯一识别插件类型（${candidates.join("/")}），请选择`, duration: 4000 })
      } else {
        showToastV2({ description: `安装失败: ${err.message}`, duration: 4000 })
      }
    } finally { setInstallBusy(false) }
  }
```

安装面板 JSX：删除原类型 `SelectV2` 块，替换为：

```tsx
                    <div style={{ display: "flex", gap: 8, "align-items": "center", "margin-bottom": 8 }}>
                      <Show when={installCandidates()}>
                        <div style={{ width: 180 }}>
                          <SelectV2
                            options={(installCandidates() ?? []).map((t) => ({ value: t, label: t }))}
                            current={installType() ?? ""}
                            value={(x: string) => x}
                            label={(x: string) => x}
                            onSelect={(v) => { if (v) setInstallType(v) }}
                            placeholder="插件类型"
                          />
                        </div>
                      </Show>
                      <input ref={fileInputRef} type="file" accept=".js" class="hidden" onChange={onInstallFileChosen} />
                      <ButtonV2 variant="outline" size="small" onClick={pickInstallFile}>选择 .js 文件</ButtonV2>
                      <Show when={installFile()}>
                        <span style={{ "font-size": 12 }}>{installFile()!.name}（{installFile()!.size} bytes）</span>
                      </Show>
                    </div>
```

（顶部 import 行补 `parseAmbiguousCandidates`。）

- [ ] **Step 6: 验证**

Run: `cd packages/desktop && bun test src/renderer/mafw/pages/plugin-hub.test.ts`
Expected: PASS。再 `cd packages/desktop && npx electron-vite build`（Expected: 构建成功，无类型错误）

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/preload/mafw-types.ts packages/desktop/src/renderer/mafw/pages/Config.tsx packages/desktop/src/renderer/mafw/pages/plugin-hub.ts packages/desktop/src/renderer/mafw/pages/plugin-hub.test.ts
git commit -m "feat(desktop): install panel sends raw bytes with ambiguous-type fallback"
```

---

### Task 6: runtime loader — getBuiltinNames + 停生成示例

**Files:**
- Modify: `gateway/src/runtime/loader.ts`
- Test: Create `gateway/tests/unit/runtime-loader-builtins.test.ts`

**Interfaces:**
- Produces: `RuntimePluginLoader.getBuiltinNames(): string[]`（返回注册的内置件名，如 `['pi']`）

- [ ] **Step 1: 写失败测试**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RuntimePluginLoader } from '../../src/runtime/loader';

test('runtime loader: getBuiltinNames and no example generation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-rt-'));
  const dir = path.join(root, 'runtime-plugins'); // 不存在的子目录 → ensureDir 走创建分支
  const loader = new RuntimePluginLoader(dir);
  loader.registerBuiltin('pi', (async () => ({ name: 'pi' }) as any), {} as any, false);
  await loader.init();
  try {
    expect(loader.getBuiltinNames()).toEqual(['pi']);
    const files = fs.readdirSync(dir);
    expect(files.some((f) => f === 'example.js.disabled')).toBe(false);
    expect(files.some((f) => f === 'README.md')).toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 运行验证失败**

Run: `cd gateway && npx jest tests/unit/runtime-loader-builtins.test.ts`
Expected: FAIL（`getBuiltinNames` 不存在 / example 文件仍被生成）

- [ ] **Step 3: 实现**（`runtime/loader.ts`）

`ensureDir` 删除 `example.js.disabled` 写入行（保留 README.md）；删除文件底部 `EXAMPLE_CONTENT` 常量；类内追加：

```ts
  /** 已注册内置件名（builtin 文件件不在其中，opencode 为恒等默认由 index.ts 注入 hub）。 */
  getBuiltinNames(): string[] {
    return [...this.builtins.keys()];
  }
```

- [ ] **Step 4: 运行验证通过**

Run: `cd gateway && npx jest tests/unit/runtime-loader-builtins.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/loader.ts gateway/tests/unit/runtime-loader-builtins.test.ts
git commit -m "feat(runtime-loader): getBuiltinNames + stop writing example.js.disabled"
```

---

### Task 7: media/usage loader 停生成示例

**Files:**
- Modify: `gateway/src/media/media-plugin-loader.ts`
- Modify: `gateway/src/usage/plugin-loader.ts`
- Test: Create `gateway/tests/unit/plugin-loaders-no-example.test.ts`

**Interfaces:**
- Consumes: 两 loader 的 `init()`/`stop()`（stop 关闭 fs.watch，测试必须调用防句柄泄漏）

- [ ] **Step 1: 写失败测试**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MediaPluginLoader } from '../../src/media/media-plugin-loader';
import { PluginLoader } from '../../src/usage/plugin-loader';

test('media loader creates dir without example.js.disabled', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-media-'));
  const dir = path.join(root, 'media-plugins'); // 不存在的子目录 → ensureDir 走创建分支
  const loader = new MediaPluginLoader(dir);
  await loader.init();
  try {
    const files = fs.readdirSync(dir);
    expect(files.some((f) => f === 'example.js.disabled')).toBe(false);
    expect(files.some((f) => f === 'README.md')).toBe(true);
  } finally {
    loader.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('usage loader creates dir without example.js.disabled', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-usage-'));
  const dir = path.join(root, 'usage-plugins'); // 不存在的子目录 → ensureDir 走创建分支
  const loader = new PluginLoader(dir, [], {});
  await loader.init();
  try {
    const files = fs.readdirSync(dir);
    expect(files.some((f) => f === 'example.js.disabled')).toBe(false);
    expect(files.some((f) => f === 'README.md')).toBe(true);
  } finally {
    loader.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 运行验证失败**

Run: `cd gateway && npx jest tests/unit/plugin-loaders-no-example.test.ts`
Expected: FAIL（example 文件仍生成）

- [ ] **Step 3: 实现**——两文件的 `ensureDir` 各删一行 `fs.writeFileSync(path.join(this.pluginsDir, 'example.js.disabled'), EXAMPLE_CONTENT);`，并删除各自的 `EXAMPLE_CONTENT` 常量（media 在文件尾部 ~L234、usage 在 ~L281）。

- [ ] **Step 4: 运行验证通过**

Run: `cd gateway && npx jest tests/unit/plugin-loaders-no-example.test.ts`
Expected: PASS（注意退出无挂起——`stop()` 已关 watcher）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/media/media-plugin-loader.ts gateway/src/usage/plugin-loader.ts gateway/tests/unit/plugin-loaders-no-example.test.ts
git commit -m "feat(loaders): stop generating example.js.disabled templates"
```

---

### Task 8: index.ts 组装——builtinEntries 注入 + cleanupExamples 调用

**Files:**
- Modify: `gateway/src/index.ts`（`pluginHubDeps` 块，锚点 `// ── Plugin Hub (all four plugin types) ──`）
- Test: `gateway/tests/unit/plugins-hub.test.ts`（无新增——组装属接线，Task 1 单测已覆盖行为；本任务验证靠 gateway 全量 jest）

**Interfaces:**
- Consumes: Task 1 `builtinEntries` dep；Task 2 `cleanupExamples`；Task 6 `getBuiltinNames()`
- Produces: `GET /api/plugins` 实际返回内置条目（opencode/pi runtime、pi media、usage 内置适配器）

- [ ] **Step 1: 实现**（`pluginHubDeps` 的 `hub` 对象内，`ui:` 行之后追加 `builtinEntries`；`const pluginHubDeps = {...}` 赋值后、首个路由 match 之前插入 cleanup）

```ts
        const pluginHubDeps = {
          hub: {
            dirs: { /* 原样保留 */ },
            builtinEntries: (): any[] => {
              const entries: any[] = [];
              const rt = (name: string) => ({ type: 'runtime', name, file: '(builtin)', status: 'enabled', size: 0, mtime: '' });
              entries.push(rt('opencode'));
              for (const name of this.runtimeLoader?.getBuiltinNames?.() ?? []) entries.push(rt(name));
              entries.push({ type: 'media', name: 'pi', file: '(builtin)', status: 'enabled', size: 0, mtime: '' });
              const usageState: any[] = this.pluginLoader?.getState?.() ?? [];
              for (const s of usageState) {
                if (s.builtin && s.status === 'ok' && s.name) {
                  entries.push({ type: 'usage', name: s.name, file: s.file, status: 'enabled', size: 0, mtime: '', pluginType: s.pluginType });
                }
              }
              return entries;
            },
            getErrors: /* 原样保留 */ ...,
            configDisabledUsage: /* 原样保留 */ ...,
            reload: /* 原样保留 */ ...,
          } as any,
        };
        try {
          const cleaned = cleanupExamples(pluginHubDeps.hub);
          if (cleaned.removed.length) log.info(`[PluginsHub] removed stale examples: ${cleaned.removed.length}`);
          if (cleaned.failed.length) log.warn(`[PluginsHub] cleanupExamples failed: ${cleaned.failed.join(', ')}`);
        } catch (err: any) {
          log.warn(`[PluginsHub] cleanupExamples error: ${err.message}`);
        }
```

顶部 import 行（L83）追加 `cleanupExamples`：

```ts
import { handlePluginsList, handlePluginsInstall, handlePluginsEnable, handlePluginsDisable, handlePluginsDelete } from './routes/plugins';
import { cleanupExamples } from './plugins/hub';
```

- [ ] **Step 2: 验证**

Run: `cd gateway && npx jest tests/unit`
Expected: 全部 PASS。再 `cd gateway && npm run build`（Expected: 构建成功）
（可选手动冒烟：启动 gateway 后 `curl http://127.0.0.1:3000/api/plugins` 应含 `builtin: true` 的 opencode/pi/deepseek 等条目，且四目录无 `example.js.disabled`。）

- [ ] **Step 3: Commit**

```bash
git add gateway/src/index.ts
git commit -m "feat(gateway): wire builtinEntries + example cleanup into plugin hub"
```

---

### Task 9: renderer hub 行内置分支 + media 区内嵌 + 删 Runtime & Media 卡

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pages/plugin-hub.ts`
- Modify: `packages/desktop/src/renderer/mafw/pages/Config.tsx`
- Test: `packages/desktop/src/renderer/mafw/pages/plugin-hub.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `HubEntry.builtin/overridden/pluginType`（经 Task 4 SDK 透传）；现有 `runtimeActivatable`/`switchRuntime`/`mediaOptions`/`switchMediaEngine`/`mediaEngine()/mediaImage()/mediaVideo()/mediaAudio()`/`mediaSwitching()`/`rtEnvOverride()`/`window.api.mafw.usagePluginsCreate`
- Produces: `builtinMeta(e: HubEntry): string`（内置徽标文案，含 usage pluginType 与覆盖标记）

- [ ] **Step 1: 写失败测试**（`plugin-hub.test.ts` 追加）

```ts
import { builtinMeta } from "./plugin-hub"

describe("builtinMeta", () => {
  test("runtime builtin", () => {
    expect(builtinMeta(entry({ builtin: true, file: "(builtin)", size: 0, mtime: "" }))).toBe("内置")
  })
  test("usage builtin carries pluginType", () => {
    expect(builtinMeta(entry({ type: "usage", builtin: true, pluginType: "api" }))).toBe("内置 · api")
  })
  test("overridden builtin marked", () => {
    expect(builtinMeta(entry({ type: "usage", builtin: true, overridden: true, pluginType: "api" }))).toBe("内置 · api · 被覆盖")
  })
  test("non-builtin entries empty", () => {
    expect(builtinMeta(entry({}))).toBe("")
  })
})
```

- [ ] **Step 2: 运行验证失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/pages/plugin-hub.test.ts`
Expected: FAIL（`builtinMeta` 不存在）

- [ ] **Step 3: 实现 plugin-hub.ts**（追加）

```ts
export function builtinMeta(e: HubEntry): string {
  if (!e.builtin) return ""
  const parts = ["内置"]
  if (e.type === "usage" && e.pluginType) parts.push(e.pluginType)
  if (e.overridden) parts.push("被覆盖")
  return parts.join(" · ")
}
```

- [ ] **Step 4: 实现 Config.tsx**（四处改动）

(a) 信号区（锚点 `const [installBusy, setInstallBusy]` 之后）加克隆 handler：

```tsx
  const cloneBuiltin = async (e: HubEntry) => {
    try {
      await window.api.mafw.usagePluginsCreate({ template: "clone-builtin", values: { sourceName: e.name } })
      showToastV2({ description: `已克隆 ${e.name} 到 usage-plugins，可编辑后启用`, duration: 4000 })
      await loadPluginHub()
    } catch (err: any) {
      showToastV2({ description: `克隆失败: ${err.message}`, duration: 4000 })
    }
  }
```

(b) hub `<For each={sortEntries(hubEntries())}>` 行内替换元信息与操作区：

```tsx
                <For each={sortEntries(hubEntries())}>
                  {(e) => (
                    <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", padding: "8px 0", "border-bottom": "1px solid var(--border, #222)" }}>
                      <div>
                        <span style={{ "font-weight": 500 }}>{e.type}/{e.name}</span>
                        <span style={{ "font-size": 12, "margin-left": 8, color: "var(--text-muted, #888)" }}>{statusLabel(e)}</span>
                        <Show
                          when={e.builtin}
                          fallback={<span style={{ "font-size": 12, "margin-left": 8, color: "var(--text-muted, #888)" }}>{e.size} B · {new Date(e.mtime).toLocaleString()}</span>}
                        >
                          <span style={{ "font-size": 12, "margin-left": 8, color: "var(--brand, #7c8)" }}>{builtinMeta(e)}</span>
                        </Show>
                        <Show when={e.error}>
                          <span style={{ "font-size": 12, "margin-left": 8, color: "var(--danger, #e55)" }}>{e.error}</span>
                        </Show>
                      </div>
                      <div style={{ display: "flex", gap: 8, "align-items": "center" }}>
                        <Show when={runtimeActivatable(e, rtInfo()?.active?.name)}>
                          <ButtonV2 variant="outline" size="small" onClick={() => switchRuntime(e.name)}>激活</ButtonV2>
                        </Show>
                        <Show when={e.type === "usage" && e.builtin && !e.overridden}>
                          <ButtonV2 variant="outline" size="small" onClick={() => cloneBuiltin(e)}>克隆</ButtonV2>
                        </Show>
                        <Show when={!e.builtin}>
                          <SwitchV2 checked={e.status === "enabled"} onChange={() => togglePlugin(e)} hideLabel />
                          <ButtonV2 variant="ghost" size="small" onClick={() => removePlugin(e)}>删除</ButtonV2>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
```

(c) media 引擎下拉并入：在 hub `</For>` 与空态 `<Show when={!hubLoading() && hubEntries().length === 0}>` 之间插入（JSX 从原「Runtime & Media」卡平移）：

```tsx
                <div class="mafw-config-field-group" style={{ "margin-top": 16 }}>
                  <label class="mafw-config-label">Media 引擎</label>
                  <div class="mafw-config-grid">
                    {[
                      { kind: 'engine', label: 'Default', value: mediaEngine() },
                      { kind: 'image', label: 'Image', value: mediaImage() },
                      { kind: 'video', label: 'Video', value: mediaVideo() },
                      { kind: 'audio', label: 'Audio', value: mediaAudio() },
                    ].map(({ kind, label, value }) => (
                      <div class="mafw-config-grid-row">
                        <span class="mafw-config-grid-label">{label}</span>
                        <div style={{ width: 180 }}>
                          <SelectV2
                            options={mediaOptions()}
                            current={value || 'pi'}
                            value={(x: string) => x}
                            onSelect={(v) => { if (v != null && v !== (value || 'pi')) switchMediaEngine(kind, v) }}
                            disabled={mediaSwitching()}
                            placeholder="选择引擎"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  {mediaSwitching() && (
                    <div class="mafw-config-inline-loading">
                      <LoaderV2 width={12} height={12} /> 切换中…
                    </div>
                  )}
                </div>
```

(d) 删除与清理：

- 整卡删除：`<Show when={activeNav() === "plugins"}>` 内的第二个 `<div class="mafw-config-section">`（`插件中心` 区之后的「Runtime & Media」整块，从 `<div class="mafw-config-section-header">…Runtime &amp; Media…` 到对应闭合 `</div>`）
- `envOverride` 警告移到插件中心 body 顶部（`刷新/安装插件` 按钮行之前）：

```tsx
                {rtEnvOverride() && (
                  <div class="mafw-config-env-warning">
                    ⚠️ 环境变量 MAFW_RUNTIME_PLUGIN 已覆盖 config.yaml 设置
                  </div>
                )}
```

- 删除 `runtimeOptions()` 函数（锚点 `const runtimeOptions = () => {`）；`mediaOptions`/`mediaEngine`/`mediaImage`/`mediaVideo`/`mediaAudio`/`mediaSwitching`/`switchMediaEngine`/`switchRuntime`/`rtInfo`/`rtEnvOverride` 全部保留
- import 行补 `builtinMeta`（来自 `./plugin-hub`）

- [ ] **Step 5: 验证**

Run: `cd packages/desktop && bun test src/renderer/mafw/pages/plugin-hub.test.ts`
Expected: PASS。再 `cd packages/desktop && npx electron-vite build`
Expected: 构建成功（Config.tsx 无残留引用错误）

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/pages/plugin-hub.ts packages/desktop/src/renderer/mafw/pages/Config.tsx packages/desktop/src/renderer/mafw/pages/plugin-hub.test.ts
git commit -m "feat(desktop): plugin hub builtin rows + media engine block, drop Runtime&Media card"
```

---

### Task 10: 全量回归 + AGENTS.md 文档更新

**Files:**
- Modify: `AGENTS.md`（§5.14a media-plugins 描述行、§5.9b.2 无关；重点是与插件目录/hub 相关的行——在 `media-plugins`、`ui-plugins` 提及处补一句示例不再生成 + hub 含内置件）

**Interfaces:**
- Consumes: 全部前序任务

- [ ] **Step 1: gateway 全量测试**

Run: `cd gateway && npx jest`
Expected: 全部 PASS（0 failed）

- [ ] **Step 2: SDK 全量测试**

Run: `cd packages/gateway-sdk && bun test`
Expected: 全部 PASS

- [ ] **Step 3: desktop renderer 测试 + 构建**

Run: `cd packages/desktop && bun test src/renderer/mafw/pages/plugin-hub.test.ts; npx electron-vite build`
Expected: PASS + 构建成功

- [ ] **Step 4: 手动冒烟（gateway 运行时）**

1. `curl http://127.0.0.1:3000/api/plugins` → 含 `opencode`/`pi`（runtime）、`pi`（media）、9 个 usage 内置适配器，均 `builtin: true`
2. 桌面 Settings → Plugins：内置行显示「内置」徽标、无开关无删除；runtime 行有「激活」；usage 行有「克隆」
3. 安装一个 `.js`（含 `fetch`）→ 落入 `~/.mafw/usage-plugins/`，无需选类型
4. 四个 `~/.mafw/*-plugins/` 目录中 `example.js.disabled` 消失

- [ ] **Step 5: 更新 AGENTS.md 并汇报**

在 `~/.mafw/media-plugins/`、`ui-plugins`、runtime-plugins 相关描述行补充：

```
> 2026-09-15 起：loader 不再生成 example.js.disabled（启动时幂等清理存量）；插件中心（GET /api/plugins）含内置条目（runtime: opencode/pi、media: pi、usage: 全部内置适配器，builtin/overridden/pluginType 字段）；安装为 raw octet-stream（POST /api/plugins/install?filename=&type=，type 可缺省由接口嗅探 createRuntime/createPrompt+fixPayload+engine+modalities/fetch/tools）。
```

交付汇报格式：新增测试数 + 全量通过数 + commit 哈希。

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md
git commit -m "docs: plugin hub builtin inventory + raw install transport notes"
```
