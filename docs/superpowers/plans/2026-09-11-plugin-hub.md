# Plugin Hub 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gateway 统一插件 REST API（四类插件 list/install/enable/disable/delete）+ 桌面 Config 页插件中心 UI，desktop-only 用户可在 UI 安装管理全部插件。

**Architecture:** gateway 新增 `plugins/hub.ts`（纯文件操作+校验+重载路由，deps 注入）与 `routes/plugins.ts`（HTTP 薄壳）；禁用=`.js`↔`.js.disabled` 改名（四个加载器只扫 `*.js`，零改动）；SDK/Preload 加 `plugins` 命名空间（`mafw-invoke` 通用派发自动生效）；Config 页 Plugins 区升级为分组卡片 hub。

**Tech Stack:** TypeScript (gateway CJS, jest + ts-jest)、@mafw/sdk（fetch）、SolidJS + @mafw/ui v2（bun test）。

**Spec:** `docs/superpowers/specs/2026-09-11-plugin-hub-design.md`

## Global Constraints

- 禁止改动四个插件加载器本体（`runtime/loader.ts` / `media/media-plugin-loader.ts` / `usage/plugin-loader.ts` / desktop `ui-plugins.ts`）
- 所有写文件路径：先写 `.tmp` 再 rename（防半写，事故记忆 mem_1788840174820_37fkvs）
- filename 白名单 `^[A-Za-z0-9._-]+\.js$`；resolve 后必须落在插件目录内；大小上限 2MB
- UI 禁裸 `<button>`/裸文本 `<input>`（§5.10）；`<input type="file">` 无 V2 等价物，用 `class="hidden"` 隐藏 + `ButtonV2` 触发
- gateway 测试 `npx jest <file>`（在 gateway/ 目录）；desktop 测试 `bun test <file>`（在 packages/desktop/ 目录）
- 状态枚举：`enabled | disabled | error | config-disabled`；error 仅来自三个 gateway 侧 loader 的 getState()
- 每个 Task 结束按计划内消息 commit（用户确认整体计划后执行；最终提交前再向用户确认一次——工作流偏好 mem_1789096598490_xoa1mb）

---

### Task 1: Gateway hub 核心模块（纯逻辑）

**Files:**
- Create: `gateway/src/plugins/hub.ts`
- Test: `gateway/tests/unit/plugins-hub.test.ts`

**Interfaces:**
- Consumes: 无（deps 全注入）
- Produces:
  - `type PluginType = 'runtime' | 'media' | 'usage' | 'ui'`
  - `interface PluginEntry { type; name; file; status: 'enabled'|'disabled'|'error'|'config-disabled'; error?: string; size: number; mtime: string }`
  - `interface HubDeps { dirs: Record<PluginType,string>; getErrors?: (type: PluginType) => Record<string,string>; configDisabledUsage?: () => Set<string>; reload?: (type: PluginType) => void | Promise<void>; maxBytes?: number }`
  - `class HubError extends Error { status: number }`
  - `listPlugins(deps): PluginEntry[]`
  - `installPlugin(deps, input: {type; filename; contentBase64; overwrite?}): Promise<PluginEntry>`
  - `setPluginEnabled(deps, input: {type; filename; enabled: boolean}): Promise<PluginEntry>`
  - `deletePlugin(deps, input: {type; filename}): Promise<{ok: true}>`

- [ ] **Step 1: 写失败测试**

```ts
// gateway/tests/unit/plugins-hub.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listPlugins, installPlugin, setPluginEnabled, deletePlugin, HubError } from '../../src/plugins/hub';

const B64 = Buffer.from('module.exports = { name: "foo" };').toString('base64');

function makeDeps(overrides: Record<string, any> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-hub-'));
  const dirs = {
    runtime: path.join(root, 'runtime-plugins'),
    media: path.join(root, 'media-plugins'),
    usage: path.join(root, 'usage-plugins'),
    ui: path.join(root, 'ui-plugins'),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return {
    dirs,
    getErrors: jest.fn(() => ({} as Record<string, string>)),
    configDisabledUsage: jest.fn(() => new Set<string>()),
    reload: jest.fn(),
    ...overrides,
  };
}

describe('listPlugins', () => {
  test('empty dirs yield no entries', () => {
    expect(listPlugins(makeDeps())).toEqual([]);
  });

  test('foo.js is enabled, foo.js.disabled is disabled', () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'x');
    fs.writeFileSync(path.join(deps.dirs.media, 'bar.js.disabled'), 'x');
    const entries = listPlugins(deps);
    expect(entries).toEqual([
      expect.objectContaining({ type: 'runtime', name: 'foo', file: 'foo.js', status: 'enabled' }),
      expect.objectContaining({ type: 'media', name: 'bar', file: 'bar.js.disabled', status: 'disabled' }),
    ]);
  });

  test('entries carry size and mtime', () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), '12345');
    const [e] = listPlugins(deps);
    expect(e.size).toBe(5);
    expect(new Date(e.mtime).getTime()).not.toBeNaN();
  });

  test('loader errors promote status to error', () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'x');
    (deps.getErrors as jest.Mock).mockImplementation((type: string) =>
      type === 'runtime' ? { foo: 'boom' } : {});
    expect(listPlugins(deps)[0]).toEqual(expect.objectContaining({ status: 'error', error: 'boom' }));
  });

  test('usage plugin in config disabledPlugins shows config-disabled', () => {
    const deps = makeDeps({ configDisabledUsage: () => new Set(['foo']) });
    fs.writeFileSync(path.join(deps.dirs.usage, 'foo.js'), 'x');
    expect(listPlugins(deps)[0]).toEqual(expect.objectContaining({ status: 'config-disabled' }));
  });

  test('same name enabled+disabled coexisting: enabled wins with warning error field', () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'x');
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js.disabled'), 'x');
    const entries = listPlugins(deps);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(expect.objectContaining({ status: 'enabled' }));
    expect(entries[0].error).toContain('foo.js.disabled');
  });
});

describe('installPlugin', () => {
  test('writes file, triggers reload, returns enabled entry', async () => {
    const deps = makeDeps();
    const entry = await installPlugin(deps, { type: 'runtime', filename: 'foo.js', contentBase64: B64 });
    expect(fs.readFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'utf-8')).toContain('name: "foo"');
    expect(deps.reload).toHaveBeenCalledWith('runtime');
    expect(entry).toEqual(expect.objectContaining({ name: 'foo', status: 'enabled' }));
  });

  test('duplicate name (enabled or disabled variant) → HubError 409', async () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'old');
    await expect(installPlugin(deps, { type: 'runtime', filename: 'foo.js', contentBase64: B64 }))
      .rejects.toMatchObject({ status: 409 });
  });

  test('overwrite: true replaces existing file', async () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'old');
    await installPlugin(deps, { type: 'runtime', filename: 'foo.js', contentBase64: B64, overwrite: true });
    expect(fs.readFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'utf-8')).toContain('name: "foo"');
  });

  test('path traversal rejected', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'runtime', filename: '../evil.js', contentBase64: B64 }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('invalid type rejected', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'nope' as any, filename: 'a.js', contentBase64: B64 }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('oversized content rejected', async () => {
    const deps = makeDeps({ maxBytes: 4 });
    await expect(installPlugin(deps, { type: 'runtime', filename: 'a.js', contentBase64: B64 }))
      .rejects.toMatchObject({ status: 413 });
  });

  test('invalid base64 rejected', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'runtime', filename: 'a.js', contentBase64: '!!!not-base64!!!' }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('setPluginEnabled / deletePlugin', () => {
  test('disable renames to .disabled and triggers reload', async () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'x');
    const entry = await setPluginEnabled(deps, { type: 'runtime', filename: 'foo.js', enabled: false });
    expect(fs.existsSync(path.join(deps.dirs.runtime, 'foo.js'))).toBe(false);
    expect(fs.existsSync(path.join(deps.dirs.runtime, 'foo.js.disabled'))).toBe(true);
    expect(entry.status).toBe('disabled');
    expect(deps.reload).toHaveBeenCalledWith('runtime');
  });

  test('enable renames back', async () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js.disabled'), 'x');
    const entry = await setPluginEnabled(deps, { type: 'runtime', filename: 'foo.js.disabled', enabled: true });
    expect(fs.existsSync(path.join(deps.dirs.runtime, 'foo.js'))).toBe(true);
    expect(entry.status).toBe('enabled');
  });

  test('operating on a missing file → HubError 404', async () => {
    const deps = makeDeps();
    await expect(setPluginEnabled(deps, { type: 'runtime', filename: 'nope.js', enabled: false }))
      .rejects.toMatchObject({ status: 404 });
    await expect(deletePlugin(deps, { type: 'runtime', filename: 'nope.js' }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('delete removes the file and triggers reload', async () => {
    const deps = makeDeps();
    fs.writeFileSync(path.join(deps.dirs.runtime, 'foo.js'), 'x');
    await deletePlugin(deps, { type: 'runtime', filename: 'foo.js' });
    expect(fs.existsSync(path.join(deps.dirs.runtime, 'foo.js'))).toBe(false);
    expect(deps.reload).toHaveBeenCalledWith('runtime');
  });

  test('traversal in enable/delete rejected', async () => {
    const deps = makeDeps();
    await expect(setPluginEnabled(deps, { type: 'runtime', filename: 'sub/../../x.js', enabled: false }))
      .rejects.toMatchObject({ status: 400 });
    await expect(deletePlugin(deps, { type: 'ui', filename: '..\\evil.js' }))
      .rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run（在 `gateway/`）：`npx jest tests/unit/plugins-hub.test.ts`
Expected: FAIL — `Cannot find module '../../src/plugins/hub'`

- [ ] **Step 3: 最小实现**

```ts
// gateway/src/plugins/hub.ts
import * as fs from 'fs';
import * as path from 'path';

export type PluginType = 'runtime' | 'media' | 'usage' | 'ui';
export type PluginStatus = 'enabled' | 'disabled' | 'error' | 'config-disabled';

export interface PluginEntry {
  type: PluginType;
  name: string;
  file: string;
  status: PluginStatus;
  error?: string;
  size: number;
  mtime: string;
}

export interface HubDeps {
  dirs: Record<PluginType, string>;
  /** plugin name -> error message, from each loader's getState() (three gateway-side types only). */
  getErrors?: (type: PluginType) => Record<string, string>;
  /** usage plugins disabled via config usage.disabledPlugins (read-only compatibility). */
  configDisabledUsage?: () => Set<string>;
  /** called after a successful mutation so the caller triggers the type's reload. */
  reload?: (type: PluginType) => void | Promise<void>;
  maxBytes?: number;
}

export class HubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const PLUGIN_TYPES: PluginType[] = ['runtime', 'media', 'usage', 'ui'];
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const FILENAME_RE = /^[A-Za-z0-9._-]+\.js$/;

export function parseType(value: unknown): PluginType {
  if (typeof value === 'string' && (PLUGIN_TYPES as string[]).includes(value)) return value as PluginType;
  throw new HubError(400, `invalid plugin type: ${String(value)}`);
}

function validateFilename(filename: string): string {
  if (typeof filename !== 'string' || !FILENAME_RE.test(filename)) {
    throw new HubError(400, `invalid filename: ${String(filename)}`);
  }
  return filename;
}

function resolveInDir(dir: string, filename: string): string {
  const resolved = path.resolve(dir, filename);
  if (resolved !== dir && !resolved.startsWith(path.resolve(dir) + path.sep)) {
    throw new HubError(400, `path traversal rejected: ${filename}`);
  }
  return resolved;
}

function baseName(file: string): string {
  return file.replace(/\.js(\.disabled)?$/, '');
}

function statEntry(type: PluginType, dir: string, file: string): PluginEntry {
  const full = path.join(dir, file);
  const st = fs.statSync(full);
  return {
    type,
    name: baseName(file),
    file,
    status: file.endsWith('.disabled') ? 'disabled' : 'enabled',
    size: st.size,
    mtime: st.mtime.toISOString(),
  };
}

export function listPlugins(deps: HubDeps): PluginEntry[] {
  const entries: PluginEntry[] = [];
  for (const type of PLUGIN_TYPES) {
    const dir = deps.dirs[type];
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') || f.endsWith('.js.disabled'));
    const byName = new Map<string, PluginEntry>();
    for (const file of files) {
      const entry = statEntry(type, dir, file);
      const existing = byName.get(entry.name);
      if (!existing) {
        byName.set(entry.name, entry);
      } else if (existing.status === 'disabled' && entry.status === 'enabled') {
        // enabled variant wins; surface the shadowed file as a warning
        byName.set(entry.name, {
          ...entry,
          error: `both ${existing.file} and ${entry.file} present; ${existing.file} is shadowed`,
        });
      }
      // otherwise keep the first (enabled already recorded)
    }
    const errors = deps.getErrors?.(type) ?? {};
    const configDisabled = type === 'usage' ? deps.configDisabledUsage?.() ?? new Set<string>() : new Set<string>();
    for (const entry of byName.values()) {
      const loaderError = errors[entry.name];
      let status: PluginStatus = entry.status;
      let error = entry.error;
      if (loaderError) {
        status = 'error';
        error = loaderError;
      } else if (type === 'usage' && configDisabled.has(entry.name) && entry.status === 'enabled') {
        status = 'config-disabled';
      }
      entries.push({ ...entry, status, error });
    }
  }
  return entries;
}

function decodeContent(contentBase64: string, maxBytes: number): Buffer {
  if (typeof contentBase64 !== 'string' || contentBase64.length === 0) throw new HubError(400, 'empty content');
  const buf = Buffer.from(contentBase64, 'base64');
  if (buf.length === 0) throw new HubError(400, 'empty content');
  // round-trip check rejects non-base64 garbage
  if (buf.toString('base64') !== contentBase64) throw new HubError(400, 'content is not valid base64');
  if (buf.length > maxBytes) throw new HubError(413, `content exceeds ${maxBytes} bytes`);
  return buf;
}

export async function installPlugin(
  deps: HubDeps,
  input: { type: PluginType; filename: string; contentBase64: string; overwrite?: boolean },
): Promise<PluginEntry> {
  const type = parseType(input.type);
  const filename = validateFilename(input.filename);
  const dir = deps.dirs[type];
  fs.mkdirSync(dir, { recursive: true });
  const target = resolveInDir(dir, filename);
  const dup = path.join(dir, filename);
  const dupDisabled = path.join(dir, filename.replace(/\.js$/, '.js.disabled'));
  if (!input.overwrite && (fs.existsSync(dup) || fs.existsSync(dupDisabled))) {
    throw new HubError(409, `plugin already exists: ${filename}`);
  }
  const buf = decodeContent(input.contentBase64, deps.maxBytes ?? DEFAULT_MAX_BYTES);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, target);
  await deps.reload?.(type);
  return statEntry(type, dir, filename);
}

export async function setPluginEnabled(
  deps: HubDeps,
  input: { type: PluginType; filename: string; enabled: boolean },
): Promise<PluginEntry> {
  const type = parseType(input.type);
  const filename = validateFilename(input.filename);
  const dir = deps.dirs[type];
  const current = resolveInDir(dir, filename);
  if (!fs.existsSync(current)) throw new HubError(404, `plugin file not found: ${filename}`);
  const nextName = input.enabled ? filename.replace(/\.js\.disabled$/, '.js') : filename.replace(/\.js$/, '.js.disabled');
  const next = resolveInDir(dir, nextName);
  fs.renameSync(current, next);
  await deps.reload?.(type);
  return statEntry(type, dir, nextName);
}

export async function deletePlugin(
  deps: HubDeps,
  input: { type: PluginType; filename: string },
): Promise<{ ok: true }> {
  const type = parseType(input.type);
  const filename = validateFilename(input.filename);
  const target = resolveInDir(deps.dirs[type], filename);
  if (!fs.existsSync(target)) throw new HubError(404, `plugin file not found: ${filename}`);
  fs.unlinkSync(target);
  await deps.reload?.(type);
  return { ok: true };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run（在 `gateway/`）：`npx jest tests/unit/plugins-hub.test.ts`
Expected: PASS（全部用例绿）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/hub.ts gateway/tests/unit/plugins-hub.test.ts
git commit -m "feat(gateway): plugin hub core (list/install/enable/disable/delete over plugin dirs)"
```

---

### Task 2: Gateway 路由 + index 接线

**Files:**
- Create: `gateway/src/routes/plugins.ts`
- Modify: `gateway/src/index.ts`（import 段 ~line 79 附近 + 路由注册 ~line 3750 附近 + usage loader 暴露 ~line 1789 附近）
- Test: `gateway/tests/unit/plugins-routes.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `listPlugins/installPlugin/setPluginEnabled/deletePlugin/HubError`（`../plugins/hub`）
- Produces: `handlePluginsList / handlePluginsInstall / handlePluginsEnable / handlePluginsDisable / handlePluginsDelete(req, res, deps)`，deps 形状 `{ hub: HubDeps }`；HTTP 面见 spec §2

- [ ] **Step 1: 写失败测试**（harness 复制 `tests/unit/runtime-switch.test.ts` 的 postJson 模式）

```ts
// gateway/tests/unit/plugins-routes.test.ts
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handlePluginsList, handlePluginsInstall, handlePluginsDisable, handlePluginsDelete } from '../../src/routes/plugins';

const B64 = Buffer.from('module.exports = { name: "foo" };').toString('base64');

function postJson(server: http.Server, p: string, body: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: addr.port, path: p, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode!, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function makeDeps() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-hub-routes-'));
  const dirs = {
    runtime: path.join(root, 'runtime-plugins'),
    media: path.join(root, 'media-plugins'),
    usage: path.join(root, 'usage-plugins'),
    ui: path.join(root, 'ui-plugins'),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return { hub: { dirs, reload: () => {} } as any };
}

function createServer(deps: any): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url?.match(/^\/api\/plugins(?:\?|$)/)) {
      await handlePluginsList(req, res, deps); return;
    }
    if (req.method === 'POST' && req.url?.match(/^\/api\/plugins\/install(?:\?|$)/)) {
      await handlePluginsInstall(req, res, deps); return;
    }
    if (req.method === 'POST' && req.url?.match(/^\/api\/plugins\/disable(?:\?|$)/)) {
      await handlePluginsDisable(req, res, deps); return;
    }
    if (req.method === 'POST' && req.url?.match(/^\/api\/plugins\/delete(?:\?|$)/)) {
      await handlePluginsDelete(req, res, deps); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  });
}

describe('plugins routes', () => {
  let server: http.Server;
  let deps: ReturnType<typeof makeDeps>;
  beforeEach(() => { deps = makeDeps(); server = createServer(deps); server.listen(0, '127.0.0.1'); });
  afterEach((done) => { server.close(() => done()); });

  test('install then list shows the plugin', async () => {
    const inst = await postJson(server, '/api/plugins/install', { type: 'runtime', filename: 'foo.js', contentBase64: B64 });
    expect(inst.status).toBe(200);
    expect(inst.body).toEqual(expect.objectContaining({ name: 'foo', status: 'enabled' }));
    const list = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const addr = server.address() as { port: number };
      http.get({ hostname: '127.0.0.1', port: addr.port, path: '/api/plugins' }, (res) => {
        let chunks = ''; res.on('data', (c) => chunks += c);
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(chunks) }));
      }).on('error', reject);
    });
    expect(list.status).toBe(200);
    expect(list.body.plugins).toEqual([expect.objectContaining({ type: 'runtime', name: 'foo' })]);
  });

  test('install validation failure → 400 with error body', async () => {
    const res = await postJson(server, '/api/plugins/install', { type: 'runtime', filename: '../x.js', contentBase64: B64 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('disable then delete round-trip', async () => {
    await postJson(server, '/api/plugins/install', { type: 'usage', filename: 'foo.js', contentBase64: B64 });
    const dis = await postJson(server, '/api/plugins/disable', { type: 'usage', filename: 'foo.js' });
    expect(dis.status).toBe(200);
    expect(dis.body.status).toBe('disabled');
    const del = await postJson(server, '/api/plugins/delete', { type: 'usage', filename: 'foo.js.disabled' });
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true });
  });

  test('malformed JSON body → 400', async () => {
    const addr = server.address() as { port: number };
    const status: number = await new Promise((resolve) => {
      const req = http.request({ hostname: '127.0.0.1', port: addr.port, path: '/api/plugins/install', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': 7 } }, (res) => {
        res.resume(); res.on('end', () => resolve(res.statusCode!));
      });
      req.end('{broken');
    });
    expect(status).toBe(400);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run（在 `gateway/`）：`npx jest tests/unit/plugins-routes.test.ts`
Expected: FAIL — `Cannot find module '../../src/routes/plugins'`

- [ ] **Step 3: 实现路由**

```ts
// gateway/src/routes/plugins.ts
import * as http from 'http';
import { log } from '../core/utils/logger';
import { HubDeps, HubError, listPlugins, installPlugin, setPluginEnabled, deletePlugin } from '../plugins/hub';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c: string) => body += c);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const raw = await readBody(req);
  try { return JSON.parse(raw); } catch (err: any) {
    throw new HubError(400, `invalid JSON body: ${err.message}`);
  }
}

function send(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function guarded(res: http.ServerResponse, fn: () => Promise<unknown>): Promise<void> {
  try {
    const result = await fn();
    send(res, 200, result);
  } catch (err: any) {
    if (err instanceof HubError) { send(res, err.status, { error: err.message }); return; }
    log.error(`[PluginsHub] unexpected error: ${err.message}`);
    send(res, 500, { error: err.message });
  }
}

export interface PluginsRouteDeps { hub: HubDeps }

export async function handlePluginsList(_req: http.IncomingMessage, res: http.ServerResponse, deps: PluginsRouteDeps): Promise<void> {
  await guarded(res, async () => ({ plugins: listPlugins(deps.hub) }));
}

export async function handlePluginsInstall(req: http.IncomingMessage, res: http.ServerResponse, deps: PluginsRouteDeps): Promise<void> {
  await guarded(res, async () => {
    const body = await readJsonBody(req);
    const entry = await installPlugin(deps.hub, {
      type: body.type, filename: body.filename, contentBase64: body.contentBase64, overwrite: !!body.overwrite,
    });
    log.info(`[PluginsHub] installed ${body.type}/${body.filename}`);
    return entry;
  });
}

export async function handlePluginsEnable(req: http.IncomingMessage, res: http.ServerResponse, deps: PluginsRouteDeps): Promise<void> {
  await guarded(res, async () => {
    const body = await readJsonBody(req);
    return setPluginEnabled(deps.hub, { type: body.type, filename: body.filename, enabled: true });
  });
}

export async function handlePluginsDisable(req: http.IncomingMessage, res: http.ServerResponse, deps: PluginsRouteDeps): Promise<void> {
  await guarded(res, async () => {
    const body = await readJsonBody(req);
    return setPluginEnabled(deps.hub, { type: body.type, filename: body.filename, enabled: false });
  });
}

export async function handlePluginsDelete(req: http.IncomingMessage, res: http.ServerResponse, deps: PluginsRouteDeps): Promise<void> {
  await guarded(res, async () => {
    const body = await readJsonBody(req);
    const out = await deletePlugin(deps.hub, { type: body.type, filename: body.filename });
    log.info(`[PluginsHub] deleted ${body.type}/${body.filename}`);
    return out;
  });
}
```

- [ ] **Step 4: index.ts 接线（三处）**

1. import 段（~line 84 旁）：`import { handlePluginsList, handlePluginsInstall, handlePluginsEnable, handlePluginsDisable, handlePluginsDelete } from './routes/plugins';`
2. 暴露 usage loader（~line 1789 `const pluginLoader = new PluginLoader(...)` 之后同作用域加）：
   `this.usagePluginLoader = pluginLoader;`（类成员声明 `usagePluginLoader?: PluginLoader;`；若已有等价成员则复用）
3. deps + 路由注册（放在 `const runtimeDeps = {...}`（~line 3718）之后）：

```ts
const pluginHubDeps = {
  hub: {
    dirs: {
      runtime: config.resolvePath('runtime-plugins'),
      media: path.join(mafwDir, 'media-plugins'),
      usage: path.join(os.homedir(), '.mafw', 'usage-plugins'),
      ui: process.env.MAFW_UI_PLUGINS_DIR || path.join(os.homedir(), '.mafw', 'ui-plugins'),
    },
    getErrors: (type: string): Record<string, string> => {
      const stateOf = (loader: any): any[] => (loader && typeof loader.getState === 'function' ? loader.getState() : []);
      const source = type === 'runtime' ? this.runtimeLoader : type === 'media' ? this.mediaPluginLoader : type === 'usage' ? (this as any).usagePluginLoader : null;
      const out: Record<string, string> = {};
      for (const p of stateOf(source)) {
        if (p && p.error) out[p.name || p.file] = p.error;
      }
      return out;
    },
    configDisabledUsage: () => new Set<string>((config as any).usage?.disabledPlugins ?? []),
    reload: async (type: string): Promise<void> => {
      if (type === 'runtime') await this.runtimeLoader.scan();
      else if (type === 'media') await this.mediaPluginLoader.reload();
      else if (type === 'usage') await (this as any).usagePluginLoader?.reload();
      // ui: desktop main fs.watch picks it up automatically
    },
  } as any,
};
```

路由 dispatch（放在 runtime 路由 dispatch（~line 3753）同区域；注意正则带 `(?:\?|$)` 锚——query string 兼容，事故记忆 mem_1789096598490 邻域惯例）：

```ts
if (req.url?.match(/^\/api\/plugins(?:\?|$)/) && req.method === 'GET') {
  await handlePluginsList(req, res, pluginHubDeps);
  return;
}
if (req.method === 'POST' && req.url?.match(/^\/api\/plugins\/install(?:\?|$)/)) {
  await handlePluginsInstall(req, res, pluginHubDeps); return;
}
if (req.method === 'POST' && req.url?.match(/^\/api\/plugins\/enable(?:\?|$)/)) {
  await handlePluginsEnable(req, res, pluginHubDeps); return;
}
if (req.method === 'POST' && req.url?.match(/^\/api\/plugins\/disable(?:\?|$)/)) {
  await handlePluginsDisable(req, res, pluginHubDeps); return;
}
if (req.method === 'POST' && req.url?.match(/^\/api\/plugins\/delete(?:\?|$)/)) {
  await handlePluginsDelete(req, res, pluginHubDeps); return;
}
```

（`path`/`os` 已在 index.ts 顶部 import；`mafwDir` 为既有变量名，若不存在用 `config.resolvePath('.')`——接线时以现场为准，保持与 line 1625 `path.join(mafwDir, 'media-plugins')` 同源。）

- [ ] **Step 5: 跑测试确认通过 + 回归**

Run（在 `gateway/`）：`npx jest tests/unit/plugins-routes.test.ts && npx jest tests/unit`
Expected: 全绿（存量测试无回归）

- [ ] **Step 6: Commit**

```bash
git add gateway/src/routes/plugins.ts gateway/src/index.ts gateway/tests/unit/plugins-routes.test.ts
git commit -m "feat(gateway): /api/plugins routes wired (list/install/enable/disable/delete)"
```

---

### Task 3: SDK `plugins` 命名空间

**Files:**
- Modify: `packages/gateway-sdk/src/client.ts`（在 `runtime` 命名空间对象之后、`config` 之前插入）

**Interfaces:**
- Consumes: Task 2 的 HTTP 面
- Produces: `client.plugins.{list, install, enable, disable, delete}`；类型内联定义（与 `runtime` 命名空间同风格）

- [ ] **Step 1: 写失败测试**（追加到 `packages/gateway-sdk/src/client.test.ts`；沿用该文件现有 mock fetch 模式——若其为集成式则新建 `plugins.test.ts` 用全局 fetch stub）

```ts
// packages/gateway-sdk/src/plugins.test.ts
import { MafwClient } from './client';

const stubFetch = (status: number, body: unknown) => {
  return jest.fn(async (_url: string, init?: RequestInit) => ({
    ok: status < 400,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
};

describe('sdk plugins namespace', () => {
  test('list hits GET /api/plugins', async () => {
    const f = stubFetch(200, { plugins: [{ type: 'runtime', name: 'foo', file: 'foo.js', status: 'enabled', size: 1, mtime: '2026-09-11T00:00:00Z' }] });
    const client = new MafwClient('http://127.0.0.1:3000', { fetchImpl: f } as any);
    const res = await client.plugins.list();
    expect((f as any).mock.calls[0][0]).toBe('http://127.0.0.1:3000/api/plugins');
    expect(res.plugins[0].name).toBe('foo');
  });

  test('install posts JSON body', async () => {
    const f = stubFetch(200, { type: 'media', name: 'bar', file: 'bar.js', status: 'enabled', size: 3, mtime: '2026-09-11T00:00:00Z' });
    const client = new MafwClient('http://127.0.0.1:3000', { fetchImpl: f } as any);
    const res = await client.plugins.install({ type: 'media', filename: 'bar.js', contentBase64: 'eHg=' });
    expect((f as any).mock.calls[0][0]).toBe('http://127.0.0.1:3000/api/plugins/install');
    expect(JSON.parse((f as any).mock.calls[0][1].body)).toEqual({ type: 'media', filename: 'bar.js', contentBase64: 'eHg=', overwrite: false });
    expect(res.name).toBe('bar');
  });

  test('enable/disable/delete post to their paths', async () => {
    const f = stubFetch(200, { ok: true });
    const client = new MafwClient('http://127.0.0.1:3000', { fetchImpl: f } as any);
    await client.plugins.enable('runtime', 'foo.js');
    await client.plugins.disable('runtime', 'foo.js');
    await client.plugins.delete('runtime', 'foo.js');
    const urls = (f as any).mock.calls.map((c: any[]) => c[0] as string);
    expect(urls).toEqual([
      'http://127.0.0.1:3000/api/plugins/enable',
      'http://127.0.0.1:3000/api/plugins/disable',
      'http://127.0.0.1:3000/api/plugins/delete',
    ]);
  });

  test('error response throws with server message', async () => {
    const f = stubFetch(409, { error: 'plugin already exists: foo.js' });
    const client = new MafwClient('http://127.0.0.1:3000', { fetchImpl: f } as any);
    await expect(client.plugins.install({ type: 'runtime', filename: 'foo.js', contentBase64: 'eHg=' }))
      .rejects.toThrow('plugin already exists: foo.js');
  });
});
```

> 注：若 `MafwClient` 构造器不支持 `{ fetchImpl }` 选项，则先在 client.ts 构造器加可注入 fetch（`private fetchImpl: typeof fetch = opts?.fetchImpl ?? fetch.bind(globalThis)`），把 `this.request` 与命名空间内裸 `fetch` 统一走 `this.fetchImpl`——此为该 Task 的前置小步骤，同样先测后改。

- [ ] **Step 2: 跑测试确认失败**

Run（在 `packages/gateway-sdk`）：`npx jest src/plugins.test.ts`
Expected: FAIL — `client.plugins is undefined`

- [ ] **Step 3: 实现**（`client.ts`，`runtime` 对象结束后插入）

```ts
  // ── Plugins Hub ──

  plugins = {
    list: async (): Promise<{
      plugins: { type: 'runtime' | 'media' | 'usage' | 'ui'; name: string; file: string; status: 'enabled' | 'disabled' | 'error' | 'config-disabled'; error?: string; size: number; mtime: string }[];
    }> => this.request('/api/plugins'),

    install: async (input: { type: 'runtime' | 'media' | 'usage' | 'ui'; filename: string; contentBase64: string; overwrite?: boolean }): Promise<any> => {
      const res = await this.fetchImpl(`${this.baseUrl}/api/plugins/install`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, overwrite: !!input.overwrite }),
      });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || `Plugin install failed: ${res.status}`); }
      return res.json();
    },

    enable: async (type: string, filename: string): Promise<any> => {
      const res = await this.fetchImpl(`${this.baseUrl}/api/plugins/enable`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, filename }),
      });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || `Plugin enable failed: ${res.status}`); }
      return res.json();
    },

    disable: async (type: string, filename: string): Promise<any> => {
      const res = await this.fetchImpl(`${this.baseUrl}/api/plugins/disable`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, filename }),
      });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || `Plugin disable failed: ${res.status}`); }
      return res.json();
    },

    delete: async (type: string, filename: string): Promise<{ ok: true }> => {
      const res = await this.fetchImpl(`${this.baseUrl}/api/plugins/delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, filename }),
      });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || `Plugin delete failed: ${res.status}`); }
      return res.json();
    },
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run（在 `packages/gateway-sdk`）：`npx jest src/plugins.test.ts && npx jest`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/plugins.test.ts
git commit -m "feat(sdk): plugins namespace (list/install/enable/disable/delete)"
```

---

### Task 4: Preload 契约

**Files:**
- Modify: `packages/desktop/src/preload/mafw-types.ts`（`runtime` 命名空间后加 `plugins`）
- Modify: `packages/desktop/src/preload/mafw-api.ts`（`runtime` 块后加 `plugins` 块）

**Interfaces:**
- Consumes: Task 3 SDK（经 `mafw-invoke` 通用派发，main 进程零改动——`mafw-ipc.ts:90-102`）
- Produces: `window.api.mafw.plugins.{list, install, enable, disable, delete}`

- [ ] **Step 1: mafw-types.ts 加类型**（`runtime: {...}` 块之后）

```ts
  plugins: {
    list(): Promise<{ plugins: { type: 'runtime' | 'media' | 'usage' | 'ui'; name: string; file: string; status: 'enabled' | 'disabled' | 'error' | 'config-disabled'; error?: string; size: number; mtime: string }[] }>
    install(input: { type: 'runtime' | 'media' | 'usage' | 'ui'; filename: string; contentBase64: string; overwrite?: boolean }): Promise<any>
    enable(type: 'runtime' | 'media' | 'usage' | 'ui', filename: string): Promise<any>
    disable(type: 'runtime' | 'media' | 'usage' | 'ui', filename: string): Promise<any>
    delete(type: 'runtime' | 'media' | 'usage' | 'ui', filename: string): Promise<{ ok: true }>
  }
```

- [ ] **Step 2: mafw-api.ts 加实现**（`runtime: {...},` 块之后）

```ts
    plugins: {
      list: () => invoke("plugins", "list"),
      install: (input) => invoke("plugins", "install", input),
      enable: (type, filename) => invoke("plugins", "enable", type, filename),
      disable: (type, filename) => invoke("plugins", "disable", type, filename),
      delete: (type, filename) => invoke("plugins", "delete", type, filename),
    },
```

- [ ] **Step 3: typecheck 验证**

Run（在 `packages/desktop`）：`npm run typecheck`
Expected: 无错误（`mafw-invoke` 泛型派发无需 main 改动）

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/preload/mafw-types.ts packages/desktop/src/preload/mafw-api.ts
git commit -m "feat(desktop): preload plugins namespace via mafw-invoke"
```

---

### Task 5: Config 页插件中心 UI

**Files:**
- Create: `packages/desktop/src/renderer/mafw/pages/plugin-hub.ts`（纯函数）
- Test: `packages/desktop/src/renderer/mafw/pages/plugin-hub.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/pages/Config.tsx`（Plugins section，~line 488 `<Show when={activeNav() === "plugins"}>` 内，置于现有 Runtime/Media 切换卡之前）

**Interfaces:**
- Consumes: Task 4 `window.api.mafw.plugins.*`
- Produces: 纯函数 `sortEntries / statusLabel / installableTypes`（供组件用，供 bun test 测）

- [ ] **Step 1: 写失败测试（纯函数）**

```ts
// packages/desktop/src/renderer/mafw/pages/plugin-hub.test.ts
import { describe, expect, test } from "bun:test"
import { sortEntries, statusLabel, installableTypes, type HubEntry } from "./plugin-hub"

const entry = (over: Partial<HubEntry>): HubEntry => ({
  type: "runtime", name: "foo", file: "foo.js", status: "enabled", size: 1, mtime: "2026-09-11T00:00:00Z", ...over,
})

describe("plugin-hub pure helpers", () => {
  test("sortEntries orders types runtime→media→usage→ui then by name", () => {
    const sorted = sortEntries([
      entry({ type: "ui", name: "b" }), entry({ type: "usage", name: "a" }),
      entry({ type: "runtime", name: "z" }), entry({ type: "runtime", name: "a" }),
      entry({ type: "media", name: "m" }),
    ])
    expect(sorted.map((e) => `${e.type}/${e.name}`)).toEqual([
      "runtime/a", "runtime/z", "media/m", "usage/a", "ui/b",
    ])
  })

  test("statusLabel maps all four statuses", () => {
    expect(statusLabel(entry({ status: "enabled" }))).toBe("已启用")
    expect(statusLabel(entry({ status: "disabled" }))).toBe("已禁用")
    expect(statusLabel(entry({ status: "error" }))).toBe("错误")
    expect(statusLabel(entry({ status: "config-disabled" }))).toBe("config 禁用")
  })

  test("installableTypes exposes the four fixed types", () => {
    expect(installableTypes()).toEqual(["runtime", "media", "usage", "ui"])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run（在 `packages/desktop`）：`bun test src/renderer/mafw/pages/plugin-hub.test.ts`
Expected: FAIL — Cannot find module './plugin-hub'

- [ ] **Step 3: 实现纯函数**

```ts
// packages/desktop/src/renderer/mafw/pages/plugin-hub.ts
export type PluginType = "runtime" | "media" | "usage" | "ui"
export type PluginStatus = "enabled" | "disabled" | "error" | "config-disabled"

export interface HubEntry {
  type: PluginType
  name: string
  file: string
  status: PluginStatus
  error?: string
  size: number
  mtime: string
}

const TYPE_ORDER: PluginType[] = ["runtime", "media", "usage", "ui"]

const STATUS_LABEL: Record<PluginStatus, string> = {
  enabled: "已启用",
  disabled: "已禁用",
  error: "错误",
  "config-disabled": "config 禁用",
}

export function statusLabel(entry: HubEntry): string {
  return STATUS_LABEL[entry.status]
}

export function installableTypes(): PluginType[] {
  return [...TYPE_ORDER]
}

export function sortEntries(entries: HubEntry[]): HubEntry[] {
  return [...entries].sort((a, b) => {
    const t = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)
    if (t !== 0) return t
    return a.name.localeCompare(b.name)
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run（在 `packages/desktop`）：`bun test src/renderer/mafw/pages/plugin-hub.test.ts`
Expected: PASS

- [ ] **Step 5: Config.tsx 接入**

在 `<Show when={activeNav() === "plugins"}>`（~line 489）块顶部、现有 Runtime/Media 卡之前插入插件中心卡。组件逻辑（加入既有 `<script>` 段，紧邻 `loadPluginState`）：

```tsx
// ── Plugin Hub ──
const [hubEntries, setHubEntries] = createSignal<any[]>([])
const [hubLoading, setHubLoading] = createSignal(false)
const [installOpen, setInstallOpen] = createSignal(false)
const [installType, setInstallType] = createSignal<string>("runtime")
const [installFile, setInstallFile] = createSignal<{ name: string; contentBase64: string; size: number } | null>(null)
const [installBusy, setInstallBusy] = createSignal(false)
let fileInputRef: HTMLInputElement | undefined

const loadPluginHub = async () => {
  setHubLoading(true)
  try {
    const res = await window.api.mafw.plugins.list()
    setHubEntries(res?.plugins ?? [])
  } catch (err: any) {
    showToastV2({ description: `插件列表失败: ${err.message}`, duration: 3000 })
  } finally { setHubLoading(false) }
}
onMount(() => { loadPluginHub() })

const pickInstallFile = () => fileInputRef?.click()
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
  let binary = ""
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  setInstallFile({ name: file.name, contentBase64: btoa(binary), size: bytes.length })
  input.value = ""
}

const doInstall = async () => {
  const f = installFile()
  if (!f) return
  setInstallBusy(true)
  try {
    await window.api.mafw.plugins.install({ type: installType() as any, filename: f.name, contentBase64: f.contentBase64 })
    showToastV2({ description: `已安装 ${f.name}`, duration: 3000 })
    setInstallFile(null); setInstallOpen(false)
    await loadPluginHub()
  } catch (err: any) {
    showToastV2({ description: `安装失败: ${err.message}`, duration: 4000 })
  } finally { setInstallBusy(false) }
}

const togglePlugin = async (e: any) => {
  try {
    if (e.status === "enabled") await window.api.mafw.plugins.disable(e.type, e.file)
    else if (e.status === "disabled") await window.api.mafw.plugins.enable(e.type, e.file)
    else { showToastV2({ description: e.status === "config-disabled" ? "config 禁用项请在 usage 配置中处理" : "错误条目不可切换，请删除后重装", duration: 3000 }); return }
    await loadPluginHub()
  } catch (err: any) {
    showToastV2({ description: `操作失败: ${err.message}`, duration: 3000 })
  }
}

const removePlugin = async (e: any) => {
  if (!confirm(`删除插件 ${e.type}/${e.file}？此操作不可恢复。`)) return
  try {
    await window.api.mafw.plugins.delete(e.type, e.file)
    showToastV2({ description: `已删除 ${e.file}`, duration: 3000 })
    await loadPluginHub()
  } catch (err: any) {
    showToastV2({ description: `删除失败: ${err.message}`, duration: 3000 })
  }
}
```

JSX（`<Show>` 块内，现有内容之前；仅用 V2 组件 + 隐藏 file input）：

```tsx
<div class="mafw-config-card">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <span class="mafw-config-section-title">插件中心（全部插件）</span>
    <div style="display:flex;gap:8px">
      <ButtonV2 variant="outline" size="small" onClick={loadPluginHub} disabled={hubLoading()}>刷新</ButtonV2>
      <ButtonV2 variant="contrast" size="small" onClick={() => setInstallOpen(!installOpen())}>安装插件</ButtonV2>
    </div>
  </div>

  <Show when={installOpen()}>
    <div style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <SelectV2 value={installType()} options={installableTypes().map((t) => ({ value: t, label: t }))}
          onSelect={(v) => v && setInstallType(v)} placeholder="插件类型" />
        <input ref={fileInputRef} type="file" accept=".js" class="hidden" onChange={onInstallFileChosen} />
        <ButtonV2 variant="outline" size="small" onClick={pickInstallFile}>选择 .js 文件</ButtonV2>
        <Show when={installFile()}>
          <span style="font-size:12px">{installFile()!.name}（{installFile()!.size} bytes）</span>
        </Show>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
        ⚠ 安装的插件是任意本地代码，加载后即以当前应用权限执行。仅安装你信任来源的插件。
      </div>
      <ButtonV2 variant="contrast" size="small" onClick={doInstall} disabled={!installFile() || installBusy()}>
        {installBusy() ? "安装中…" : "安装"}
      </ButtonV2>
    </div>
  </Show>

  <For each={sortEntries(hubEntries() as any)}>
    {(e) => (
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
        <div>
          <span style="font-weight:500">{e.type}/{e.name}</span>
          <span style="font-size:12px;margin-left:8px;color:var(--text-muted)">{statusLabel(e)}</span>
          <span style="font-size:12px;margin-left:8px;color:var(--text-muted)">{e.size} B · {new Date(e.mtime).toLocaleString()}</span>
          <Show when={e.error}><span style="font-size:12px;margin-left:8px;color:var(--danger)">{e.error}</span></Show>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <SwitchV2 checked={e.status === "enabled"} onChange={() => togglePlugin(e)} />
          <ButtonV2 variant="ghost" size="small" onClick={() => removePlugin(e)}>删除</ButtonV2>
        </div>
      </div>
    )}
  </For>
  <Show when={!hubLoading() && hubEntries().length === 0}>
    <div style="font-size:13px;color:var(--text-muted)">暂无插件。点击「安装插件」从本地 .js 文件安装。</div>
  </Show>
</div>
```

补充 import（文件头）：`import { SwitchV2 } from "@mafw/ui/v2/switch-v2"`；`sortEntries/statusLabel/installableTypes` from `"./plugin-hub"`。若 `@mafw/ui/v2/switch-v2` 实际导出路径不同，以 `packages/ui/` 现有导出为准（`grep -r "SwitchV2" packages/ui/src --include=*.tsx -l` 核对）。

- [ ] **Step 6: typecheck + 全量 bun test**

Run（在 `packages/desktop`）：`npm run typecheck && bun test`
Expected: typecheck 干净；测试全绿（除已知 pre-existing Linux launcher 失败）

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/pages/plugin-hub.ts packages/desktop/src/renderer/mafw/pages/plugin-hub.test.ts packages/desktop/src/renderer/mafw/pages/Config.tsx
git commit -m "feat(desktop): plugin hub UI in Config page (install/toggle/delete all four plugin types)"
```

---

### Task 6: 全量回归 + 端到端冒烟

**Files:**
- 无新文件；验证 + 冒烟

- [ ] **Step 1: 全量测试**

Run（在 `gateway/`）：`npx jest`
Run（在 `packages/desktop`）：`bun test && npm run typecheck`
Expected: gateway 全绿；desktop 除已知 pre-existing Linux launcher 失败外全绿

- [ ] **Step 2: 构建验证**

Run（仓库根）：`npm run build`
Expected: 退出码 0（gateway dist 更新）

- [ ] **Step 3: 端到端冒烟（gateway 起来后）**

```bash
# 起仓库 gateway（若未起）：node gateway/dist/index.js &
curl -s http://127.0.0.1:3000/api/plugins | head -c 400
# 预期：{"plugins":[...]}（含 media 目录自带的 example.js.disabled → status disabled）
# 安装→禁用→删除环：
B64=$(node -e "process.stdout.write(Buffer.from('module.exports={name:\"smoke\"}').toString('base64'))")
curl -s -X POST http://127.0.0.1:3000/api/plugins/install -H "Content-Type: application/json" -d "{\"type\":\"runtime\",\"filename\":\"smoke.js\",\"contentBase64\":\"$B64\"}"
curl -s -X POST http://127.0.0.1:3000/api/plugins/disable -H "Content-Type: application/json" -d '{"type":"runtime","filename":"smoke.js"}'
curl -s -X POST http://127.0.0.1:3000/api/plugins/delete -H "Content-Type: application/json" -d '{"type":"runtime","filename":"smoke.js.disabled"}'
```
Expected: 三步均 200；`~/.mafw/runtime-plugins/` 中无残留 smoke 文件；desktop 打开 Config→Plugins 能看到列表与安装面板。

- [ ] **Step 4: 汇报**

向用户汇报：新增测试数、全量通过数、commit 列表；等待用户确认后再推送（工作流偏好 mem_1789096598490_xoa1mb）。
