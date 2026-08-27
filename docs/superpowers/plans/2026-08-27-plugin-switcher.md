# Runtime / Media 插件切换器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 gateway 后端提供 `POST /api/runtime/switch` 与 `POST /api/media/switch` 两个插件切换端点，并在桌面 Config 页提供配套下拉 UI（Runtime 切换二次确认 + 自动重启；Media 切换热生效）。

**Architecture:** 切换逻辑放在可独立测试的 route handler 模块（`gateway/src/routes/*.ts`，沿用 `routes/permission.ts` 的模式，测试用真实 http server + mock deps）。配置持久化收敛为 `Config.persistOverrides()`（读当前值 → 合并 → 整对象写 config.yaml → reload）。前端通过 gateway-sdk `MafwClient` → 桌面 preload → Config 页 SelectV2 下拉完成切换。

**Tech Stack:** Node/TypeScript (gateway, CJS + ts-jest)、SolidJS + @opencode-ai/ui v2（桌面）、@mafw/sdk workspace 包。

## Global Constraints

- 路由正则必须允许 query string：`(?:\?|$)` 结尾（AGENTS.md §6.5）
- 不新增依赖（gateway / gateway-sdk / desktop 均不加 package.json 依赖；桌面不引 @kobalte/core，二次确认用内联确认条）
- 注释遵循仓库惯例（gateway 侧可以留简短说明注释；desktop 侧 `// @ts-nocheck` 的 Config.tsx 内不写无谓注释）
- 测试命令：gateway = `npx jest --runInBand <file>`（workdir: `gateway/`）；gateway-sdk = `bun test`（workdir: `opencode-dev/packages/gateway-sdk/`）；desktop typecheck = `bun typecheck`（workdir: `opencode-dev/packages/desktop/`）
- 桌面 UI 禁止裸 `<button>`/`<input>`/裸 `title`，一律 `@opencode-ai/ui/v2/*` 组件（AGENTS.md §5.10）
- `config.raw` 的 `runtime.plugin` 可能被 `MAFW_RUNTIME_PLUGIN` 环境变量覆盖——端点返回 `envOverride`，UI 提示但不断言
- Media 引擎不存在不报错（fail-open，resolve 时回退 `pi`）；Runtime 插件不存在返回 400（阻断，避免重启后回退造成困惑）
- 空字符串语义：media 的 `''` = 取消该层覆盖（跟随全局）；runtime 的 `''`/`'opencode'` = 内置默认

---

### Task 1: Config.persistOverrides — 合并式配置持久化

**Files:**
- Modify: `gateway/src/config.ts`（在 `reload()` 方法之后、`get server()` 之前插入新方法，约 434 行处）
- Test: `gateway/tests/unit/config-persist.test.ts`（新建）

**Interfaces:**
- Consumes: 无（`Config` 类已有 `this.data`、`resolvePath()`、`reload()`、`import * as yaml from 'js-yaml'`、`fs`、`path`）
- Produces: `Config.persistOverrides(overrides: Record<string, any>): { changed: string[]; restartRequired: string[] }` —— 将 overrides 按顶层 key **合并**进当前配置（子对象按 key 浅合并），整对象 dump 到 `<dataDir>/config.yaml`，再 `reload()`，返回 reload 结果

- [ ] **Step 1: 写失败测试**

Create `gateway/tests/unit/config-persist.test.ts`:

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Config } from '../../src/config';

describe('Config.persistOverrides', () => {
  let projectDir: string;
  let dataDir: string;
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-proj-'));
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-data-'));
    for (const key of ['MAFW_RUNTIME_PLUGIN', 'MAFW_SERVER_API_PORT', 'MAFW_MEDIA_ENGINE']) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(envBackup)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('persists merged runtime.plugin to data-dir config.yaml', () => {
    const cfg = new Config(projectDir, dataDir);
    const result = cfg.persistOverrides({ runtime: { plugin: 'pi' } });

    expect(result.changed).toContain('runtime');
    expect(cfg.raw.runtime.plugin).toBe('pi');

    const filePath = path.join(dataDir, 'config.yaml');
    expect(fs.existsSync(filePath)).toBe(true);
    const dumped = fs.readFileSync(filePath, 'utf-8');
    expect(dumped).toContain('plugin: pi');
  });

  test('partial override does not wipe other runtime keys', () => {
    const cfg = new Config(projectDir, dataDir);
    cfg.persistOverrides({ runtime: { pluginConfig: { pi: { approvalPolicy: { autoApprove: ['read'] } } } } });
    cfg.persistOverrides({ runtime: { plugin: 'pi' } });

    expect(cfg.raw.runtime.plugin).toBe('pi');
    expect(cfg.raw.runtime.pluginConfig).toEqual({ pi: { approvalPolicy: { autoApprove: ['read'] } } });
  });

  test('partial media override preserves sibling keys', () => {
    const cfg = new Config(projectDir, dataDir);
    cfg.persistOverrides({ media: { image: { engine: 'gemini-vision' } } });

    expect(cfg.raw.media.image.engine).toBe('gemini-vision');
    expect(cfg.raw.media.image.model).toBe('');
    expect(cfg.raw.media.provider).toBe('xiaomi');
  });

  test('overriding to empty string keeps the key (semantics decided by caller)', () => {
    const cfg = new Config(projectDir, dataDir);
    cfg.persistOverrides({ media: { video: { engine: 'qwen-vl' } } });
    cfg.persistOverrides({ media: { video: { engine: '' } } });
    expect(cfg.raw.media.video.engine).toBe('');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest --runInBand tests/unit/config-persist.test.ts`（workdir: `gateway/`）
Expected: FAIL — `cfg.persistOverrides is not a function`

- [ ] **Step 3: 实现 persistOverrides**

In `gateway/src/config.ts`, insert after the `reload()` method (line 434) and before `get server()`:

```typescript
  /**
   * Persist top-level config overrides (merged into current values, nested
   * objects shallow-merged per top-level key) to the data-root config.yaml,
   * then hot-reload. Returns the reload result so callers can surface
   * restart-required sections.
   */
  persistOverrides(overrides: Record<string, any>): { changed: string[]; restartRequired: string[] } {
    const merged: Record<string, any> = { ...this.data };
    for (const key of Object.keys(overrides)) {
      const val = overrides[key];
      const cur = (this.data as any)[key];
      if (val && typeof val === 'object' && !Array.isArray(val) && cur && typeof cur === 'object') {
        merged[key] = { ...cur, ...val };
      } else {
        merged[key] = val;
      }
    }
    const mafwDir = this.resolvePath();
    if (!fs.existsSync(mafwDir)) fs.mkdirSync(mafwDir, { recursive: true });
    fs.writeFileSync(
      path.join(mafwDir, 'config.yaml'),
      yaml.dump(merged, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: true }),
      'utf-8',
    );
    return this.reload();
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest --runInBand tests/unit/config-persist.test.ts`
Expected: PASS (4 tests)

> 注意：`persistOverrides` 的 merge 只处理一层（`{ ...cur, ...val }`），覆盖 `runtime`/`media` 顶层 key 的场景；`media.video.engine` 这类嵌套是调用方构造的 overrides 子对象，直接浅合并进 `media`，天然保留 `model` 等兄弟 key。

- [ ] **Step 5: 提交**

```bash
git add gateway/src/config.ts gateway/tests/unit/config-persist.test.ts
git commit -m "feat(gateway): add Config.persistOverrides merged config persistence"
```

---

### Task 2: POST /api/runtime/switch 端点

**Files:**
- Create: `gateway/src/routes/runtime-switch.ts`
- Test: `gateway/tests/unit/runtime-switch.test.ts`
- Modify: `gateway/src/index.ts`（import + 路由接线）

**Interfaces:**
- Consumes: `Config.persistOverrides`（Task 1）；`RuntimePluginLoader.get(name)`（`gateway/src/runtime/loader.ts:122`，返回 `{ createRuntime, capabilities, external } | undefined`）
- Produces: `handleRuntimeSwitch(req: http.IncomingMessage, res: http.ServerResponse, deps: RuntimeSwitchDeps): Promise<void>`；`RuntimeSwitchDeps = { loader?: RuntimePluginLoader; persist: (overrides: Record<string, any>) => { changed: string[]; restartRequired: string[] } }`。成功响应 `{ success: true, restartRequired: true, target: string, envOverride: boolean }`；未知插件 400 `{ error }`；坏 JSON 400。

- [ ] **Step 1: 写失败测试**

Create `gateway/tests/unit/runtime-switch.test.ts`（复用 `gateway-permission.test.ts` 的 http server 模式）:

```typescript
import * as http from 'http';
import { handleRuntimeSwitch } from '../../src/routes/runtime-switch';

function postJson(server: http.Server, path: string, body: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method: 'POST',
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

function createServer(loader: any, persist: any): http.Server {
  return http.createServer(async (req, res) => {
    const match = req.url?.match(/^\/api\/runtime\/switch(?:\?|$)/);
    if (match && req.method === 'POST') {
      await handleRuntimeSwitch(req, res, { loader, persist });
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

describe('POST /api/runtime/switch', () => {
  let server: http.Server;
  const envBackup = process.env.MAFW_RUNTIME_PLUGIN;

  beforeEach(() => { delete process.env.MAFW_RUNTIME_PLUGIN; });
  afterAll(() => {
    if (envBackup === undefined) delete process.env.MAFW_RUNTIME_PLUGIN;
    else process.env.MAFW_RUNTIME_PLUGIN = envBackup;
  });

  afterEach((done) => {
    if (server?.listening) server.close(done);
    else done();
  });

  it('switches to a known plugin and persists config', async () => {
    const loader = { get: jest.fn((name: string) => (name === 'pi' ? { createRuntime: async () => ({}) } : undefined)) };
    const persist = jest.fn().mockReturnValue({ changed: ['runtime'], restartRequired: [] });
    server = createServer(loader, persist);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/runtime/switch', { plugin: 'pi' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, restartRequired: true, target: 'pi', envOverride: false });
    expect(persist).toHaveBeenCalledWith({ runtime: { plugin: 'pi' } });
    expect(loader.get).toHaveBeenCalledWith('pi');
  });

  it('rejects an unknown plugin with 400 and does not persist', async () => {
    const loader = { get: jest.fn(() => undefined) };
    const persist = jest.fn();
    server = createServer(loader, persist);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/runtime/switch', { plugin: 'no-such-runtime' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "runtime plugin 'no-such-runtime' not found" });
    expect(persist).not.toHaveBeenCalled();
  });

  it('accepts opencode and empty plugin (builtin default) without loader check', async () => {
    const loader = { get: jest.fn() };
    const persist = jest.fn().mockReturnValue({ changed: ['runtime'], restartRequired: [] });
    server = createServer(loader, persist);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/runtime/switch', { plugin: 'opencode' });
    expect(res.status).toBe(200);
    expect(res.body.target).toBe('opencode');
    expect(loader.get).not.toHaveBeenCalled();
  });

  it('reports envOverride when MAFW_RUNTIME_PLUGIN is set', async () => {
    process.env.MAFW_RUNTIME_PLUGIN = 'pi';
    const persist = jest.fn().mockReturnValue({ changed: ['runtime'], restartRequired: [] });
    server = createServer(undefined, persist);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/runtime/switch', { plugin: '' });
    expect(res.status).toBe(200);
    expect(res.body.envOverride).toBe(true);
    expect(res.body.target).toBe('opencode');
  });

  it('returns 400 on malformed JSON', async () => {
    const persist = jest.fn();
    server = createServer(undefined, persist);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const addr = server.address() as { port: number };
    const data = '{not json';
    const raw = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: addr.port, path: '/api/runtime/switch', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      }, (res) => {
        let chunks = '';
        res.on('data', (c) => chunks += c);
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(chunks) }));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });

    expect(raw.status).toBe(400);
    expect(persist).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest --runInBand tests/unit/runtime-switch.test.ts`（workdir: `gateway/`）
Expected: FAIL — `Cannot find module '../../src/routes/runtime-switch'`

- [ ] **Step 3: 实现 handler**

Create `gateway/src/routes/runtime-switch.ts`:

```typescript
import * as http from 'http';
import { RuntimePluginLoader } from '../runtime/loader';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export interface RuntimeSwitchDeps {
  loader?: RuntimePluginLoader;
  persist: (overrides: Record<string, any>) => { changed: string[]; restartRequired: string[] };
}

export async function handleRuntimeSwitch(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: RuntimeSwitchDeps,
): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));
    const plugin = typeof body?.plugin === 'string' ? body.plugin.trim() : '';
    if (plugin && plugin !== 'opencode') {
      const found = deps.loader?.get(plugin);
      if (!found) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `runtime plugin '${plugin}' not found` }));
        return;
      }
    }
    deps.persist({ runtime: { plugin } });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      restartRequired: true,
      target: plugin || 'opencode',
      envOverride: !!process.env.MAFW_RUNTIME_PLUGIN,
    }));
  } catch (err: any) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest --runInBand tests/unit/runtime-switch.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 接线到 index.ts**

In `gateway/src/index.ts`:
1. 在 line 69 `import { handlePermissionReply } from './routes/permission';` 后面加：

```typescript
import { handleRuntimeSwitch } from './routes/runtime-switch';
```

2. 在 `GET /api/runtime` 块结束后（line 3140 `return;` 之后、`GET /api/orchestration/outcomes` 之前）插入：

```typescript
        // POST /api/runtime/switch — persist runtime.plugin (takes effect after gateway restart)
        if (req.url?.match(/^\/api\/runtime\/switch(?:\?|$)/) && req.method === 'POST') {
          await handleRuntimeSwitch(req, res, {
            loader: this.runtimeLoader,
            persist: (overrides) => config.persistOverrides(overrides),
          });
          return;
        }
```

- [ ] **Step 6: 验证编译 + 全量测试**

Run: `npx tsc --noEmit`（workdir: `gateway/`）→ 无错误
Run: `npx jest --runInBand tests/unit/runtime-switch.test.ts tests/unit/config-persist.test.ts` → PASS

- [ ] **Step 7: 提交**

```bash
git add gateway/src/routes/runtime-switch.ts gateway/tests/unit/runtime-switch.test.ts gateway/src/index.ts
git commit -m "feat(gateway): add POST /api/runtime/switch endpoint"
```

---

### Task 3: POST /api/media/switch 端点

**Files:**
- Create: `gateway/src/routes/media-switch.ts`
- Test: `gateway/tests/unit/media-switch.test.ts`
- Modify: `gateway/src/index.ts`（import + 路由接线）

**Interfaces:**
- Consumes: `Config.persistOverrides`（Task 1）；`MediaPluginLoader.reload()`（`gateway/src/media/media-plugin-loader.ts:148`，`Promise<void>`）
- Produces: `handleMediaSwitch(req, res, deps: MediaSwitchDeps): Promise<void>`；`MediaSwitchDeps = { persist: (overrides) => { changed; restartRequired }; reloadPlugins: () => Promise<void>; currentMedia: () => { engine?: string; image?: { engine?: string }; video?: { engine?: string }; audio?: { engine?: string } } }`。成功响应 `{ success: true, restartRequired: false, resolved: { engine, image, video, audio } }`。
- 语义：body `{ engine?, image?, video?, audio? }`，值为 `''` 时表示取消该层覆盖（`engine: undefined`，yaml dump 会省略该 key，resolve 时回退全局/pi）；未知引擎不校验（fail-open）。

- [ ] **Step 1: 写失败测试**

Create `gateway/tests/unit/media-switch.test.ts`:

```typescript
import * as http from 'http';
import { handleMediaSwitch } from '../../src/routes/media-switch';

function postJson(server: http.Server, path: string, body: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method: 'POST',
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

/**
 * Models the gateway Config state: persist merges overrides into `cur`,
 * and the handler reads `cur` back (via currentMedia) AFTER persist —
 * the same ordering as real wiring (persistOverrides → reload → config.raw.media).
 */
function makeMediaState() {
  const cur: any = {
    engine: undefined,
    image: { engine: undefined },
    video: { engine: undefined },
    audio: { engine: undefined },
  };
  const persist = jest.fn((overrides: Record<string, any>) => {
    const media = overrides.media || {};
    if (typeof media.engine === 'string') cur.engine = media.engine;
    for (const k of ['image', 'video', 'audio']) {
      if (media[k]) cur[k] = { ...cur[k], ...media[k] };
    }
    return { changed: ['media'], restartRequired: [] };
  });
  return { cur, persist };
}

function createServer(deps: { persist?: any; reloadPlugins?: any; currentMedia?: any }): http.Server {
  const persist = deps.persist ?? jest.fn().mockReturnValue({ changed: ['media'], restartRequired: [] });
  const reloadPlugins = deps.reloadPlugins ?? jest.fn().mockResolvedValue(undefined);
  const currentMedia = deps.currentMedia ?? (() => ({ engine: undefined, image: { engine: undefined }, video: { engine: undefined }, audio: { engine: undefined } }));
  return http.createServer(async (req, res) => {
    const match = req.url?.match(/^\/api\/media\/switch(?:\?|$)/);
    if (match && req.method === 'POST') {
      await handleMediaSwitch(req, res, { persist, reloadPlugins, currentMedia });
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

describe('POST /api/media/switch', () => {
  let server: http.Server;

  afterEach((done) => {
    if (server?.listening) server.close(done);
    else done();
  });

  it('persists a partial override and hot-reloads plugins', async () => {
    const state = makeMediaState();
    const reloadPlugins = jest.fn().mockResolvedValue(undefined);
    server = createServer({ persist: state.persist, reloadPlugins, currentMedia: () => state.cur });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/media/switch', { video: 'qwen-vl' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      restartRequired: false,
      resolved: { engine: 'pi', image: 'pi', video: 'qwen-vl', audio: 'pi' },
    });
    expect(state.persist).toHaveBeenCalledWith({ media: { video: { engine: 'qwen-vl' } } });
    expect(reloadPlugins).toHaveBeenCalled();
  });

  it('unknown engine is accepted (fail-open) and reflected in resolved', async () => {
    const state = makeMediaState();
    server = createServer({ persist: state.persist, currentMedia: () => state.cur });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/media/switch', { engine: 'no-such-engine' });
    expect(res.status).toBe(200);
    expect(res.body.resolved.engine).toBe('no-such-engine');
    expect(res.body.restartRequired).toBe(false);
  });

  it('empty string resets the per-kind override to follow the global engine', async () => {
    const state = makeMediaState();
    server = createServer({ persist: state.persist, currentMedia: () => state.cur });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/media/switch', { image: '' });
    expect(res.status).toBe(200);
    expect(state.persist).toHaveBeenCalledWith({ media: { image: { engine: undefined } } });
    expect(res.body.resolved.image).toBe('pi');
  });

  it('resolved uses current global engine when only a kind is overridden', async () => {
    const state = makeMediaState();
    state.cur.engine = 'custom-global';
    server = createServer({ persist: state.persist, currentMedia: () => state.cur });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/media/switch', { audio: 'custom-audio' });
    expect(res.status).toBe(200);
    expect(res.body.resolved).toEqual({
      engine: 'custom-global',
      image: 'custom-global',
      video: 'custom-global',
      audio: 'custom-audio',
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest --runInBand tests/unit/media-switch.test.ts`（workdir: `gateway/`）
Expected: FAIL — `Cannot find module '../../src/routes/media-switch'`

- [ ] **Step 3: 实现 handler**

Create `gateway/src/routes/media-switch.ts`:

```typescript
import * as http from 'http';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const KINDS = ['image', 'video', 'audio'] as const;

export interface MediaSwitchDeps {
  persist: (overrides: Record<string, any>) => { changed: string[]; restartRequired: string[] };
  reloadPlugins: () => Promise<void>;
  currentMedia: () => {
    engine?: string;
    image?: { engine?: string };
    video?: { engine?: string };
    audio?: { engine?: string };
  };
}

export async function handleMediaSwitch(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: MediaSwitchDeps,
): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req)) || {};
    const overrides: Record<string, any> = { media: {} };
    if (typeof body.engine === 'string') overrides.media.engine = body.engine;
    for (const kind of KINDS) {
      if (typeof body[kind] === 'string') {
        // '' means "follow the global engine": persist undefined so the key
        // is omitted from yaml and resolve-time fallback (kind → global → pi) applies.
        overrides.media[kind] = { engine: body[kind] === '' ? undefined : body[kind] };
      }
    }
    await deps.persist(overrides);
    await deps.reloadPlugins();

    // Read currentMedia AFTER persist: resolved must reflect the new config
    // (real wiring: persistOverrides → reload → config.raw.media).
    const cur = deps.currentMedia();
    const global = cur.engine ?? 'pi';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      restartRequired: false,
      resolved: {
        engine: global,
        image: cur.image?.engine ?? global,
        video: cur.video?.engine ?? global,
        audio: cur.audio?.engine ?? global,
      },
    }));
  } catch (err: any) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest --runInBand tests/unit/media-switch.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 接线到 index.ts**

In `gateway/src/index.ts`:
1. 在 `handleRuntimeSwitch` import 后加：

```typescript
import { handleMediaSwitch } from './routes/media-switch';
```

2. 在 `POST /api/media/plugins/reload` 块结束后（line 3695 `return;` 之后、`GET /api/usage` 之前）插入：

```typescript
        // POST /api/media/switch — persist media engine overrides + hot-reload plugins
        if (req.url?.match(/^\/api\/media\/switch(?:\?|$)/) && req.method === 'POST') {
          await handleMediaSwitch(req, res, {
            persist: (overrides) => config.persistOverrides(overrides),
            reloadPlugins: async () => { await this.mediaPluginLoader?.reload(); },
            currentMedia: () => config.raw.media as any,
          });
          return;
        }
```

- [ ] **Step 6: 验证编译 + 全量测试**

Run: `npx tsc --noEmit`（workdir: `gateway/`）→ 无错误
Run: `npm test`（workdir: `gateway/`，全量）→ 全部 PASS

- [ ] **Step 7: 提交**

```bash
git add gateway/src/routes/media-switch.ts gateway/tests/unit/media-switch.test.ts gateway/src/index.ts
git commit -m "feat(gateway): add POST /api/media/switch endpoint"
```

---

### Task 4: gateway-sdk client 方法 + 类型

**Files:**
- Modify: `opencode-dev/packages/gateway-sdk/src/client.ts`
- Modify: `opencode-dev/packages/gateway-sdk/src/types.ts`
- Test: `opencode-dev/packages/gateway-sdk/src/client.test.ts`
- Test: `opencode-dev/packages/gateway-sdk/src/types.test.ts`

**Interfaces:**
- Consumes: 无（`MafwClient.request`、`this.baseUrl` 已有）
- Produces:
  - `MafwClient.runtime = { get(): Promise<{ active: { name: string; capabilities: Record<string, boolean> }; plugins: RuntimePluginState[] }>; switch(plugin: string): Promise<RuntimeSwitchResult> }`
  - `MafwClient.media.plugins(): Promise<{ plugins: MediaPluginState[] }>`、`MafwClient.media.switch(opts: MediaSwitchOptions): Promise<MediaSwitchResult>`
  - types.ts 新增：`RuntimePluginState`、`RuntimeNamespace`、`RuntimeSwitchResult`、`MediaPluginState`、`MediaSwitchOptions`、`MediaSwitchResult`；`MediaNamespace` 扩展；`MafwClient` 接口加 `runtime: RuntimeNamespace`

- [ ] **Step 1: 写失败测试**

In `opencode-dev/packages/gateway-sdk/src/client.test.ts`（追加在文件末尾；沿用现有 `fetchMock`/`okJson` helpers，与 line 394-405 的 providers/agents 测试同风格）:

```typescript
test("runtime.get + runtime.switch hit their routes", async () => {
  fetchMock.mockResolvedValue(okJson({ active: { name: "opencode", capabilities: {} }, plugins: [] }))
  const c = new MafwClient()
  const r = await c.runtime.get()
  expect((fetchMock as any).mock.calls[0][0]).toContain("/api/runtime")
  expect(r.active.name).toBe("opencode")

  fetchMock.mockResolvedValue(okJson({ success: true, restartRequired: true, target: "pi", envOverride: false }))
  await c.runtime.switch("pi")
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/runtime/switch",
    expect.objectContaining({ method: "POST" }))
  const body = JSON.parse((fetchMock as any).mock.calls[1][1].body)
  expect(body).toEqual({ plugin: "pi" })
})

test("media.plugins + media.switch hit their routes", async () => {
  fetchMock.mockResolvedValue(okJson({ plugins: [{ file: "x.js", name: "qwen-vl", status: "ok", modalities: ["image", "video"] }] }))
  const c = new MafwClient()
  const p = await c.media.plugins()
  expect((fetchMock as any).mock.calls[0][0]).toContain("/api/media/plugins")
  expect(p.plugins).toHaveLength(1)

  fetchMock.mockResolvedValue(okJson({ success: true, restartRequired: false, resolved: { engine: "pi", image: "pi", video: "qwen-vl", audio: "pi" } }))
  await c.media.switch({ video: "qwen-vl" })
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/media/switch",
    expect.objectContaining({ method: "POST" }))
  const body = JSON.parse((fetchMock as any).mock.calls[1][1].body)
  expect(body).toEqual({ video: "qwen-vl" })
})
```

In `opencode-dev/packages/gateway-sdk/src/types.test.ts`（在现有 `typeof c.config.get` 断言附近追加）:

```typescript
  expect(typeof c.runtime.get).toBe("function")
  expect(typeof c.runtime.switch).toBe("function")
  expect(typeof c.media.plugins).toBe("function")
  expect(typeof c.media.switch).toBe("function")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test`（workdir: `opencode-dev/packages/gateway-sdk/`）
Expected: FAIL — `c.runtime` 为 undefined（types.test.ts 编译错误）

- [ ] **Step 3: 实现 client 方法与类型**

In `opencode-dev/packages/gateway-sdk/src/types.ts`:

1. 在 `OpenCodeConfigNamespace`（line 344）之后加：

```typescript
export interface RuntimePluginState {
  file: string
  name?: string
  status: 'ok' | 'error'
  error?: string
  capabilities?: Record<string, boolean>
}

export interface RuntimeSwitchResult {
  success: boolean
  restartRequired: boolean
  target: string
  envOverride: boolean
}

export interface RuntimeNamespace {
  get(): Promise<{ active: { name: string; capabilities: Record<string, boolean> }; plugins: RuntimePluginState[] }>
  switch(plugin: string): Promise<RuntimeSwitchResult>
}
```

2. `MediaNamespace`（line 450）改为：

```typescript
export interface MediaPluginState {
  file: string
  name?: string
  status: 'ok' | 'error'
  error?: string
  modalities?: string[]
}

export interface MediaSwitchOptions {
  engine?: string
  image?: string
  video?: string
  audio?: string
}

export interface MediaSwitchResult {
  success: boolean
  restartRequired: boolean
  resolved: { engine: string; image: string; video: string; audio: string }
}

export interface MediaNamespace {
  /** Create an A2A vision task from an image (data URL) + initial question. */
  createTask: (opts: { dataUrl?: string; artifactId?: string; mediaType?: string; question?: string }) => Promise<MediaTask>
  /** List media engine plugins (status + modalities). */
  plugins: () => Promise<{ plugins: MediaPluginState[] }>
  /** Switch media engine per modality ('' resets to follow the global engine). */
  switch: (opts: MediaSwitchOptions) => Promise<MediaSwitchResult>
}
```

3. `MafwClient` 接口（line 412-429）在 `config: ConfigNamespace` 后加 `runtime: RuntimeNamespace`：

```typescript
export interface MafwClient {
  session: SessionNamespace
  project: ProjectNamespace
  event: EventNamespace
  config: ConfigNamespace
  runtime: RuntimeNamespace
  opencodeConfig: OpenCodeConfigNamespace
  ...
```

In `opencode-dev/packages/gateway-sdk/src/client.ts`:

1. 在 `config` namespace 块（line 296-312）之后、`opencodeConfig` 之前加：

```typescript
  // ── Runtime (agent runtime plugin switching) ──

  runtime = {
    get: async (): Promise<{ active: { name: string; capabilities: Record<string, boolean> }; plugins: RuntimePluginState[] }> => {
      return this.request('/api/runtime')
    },
    switch: async (plugin: string): Promise<RuntimeSwitchResult> => {
      const res = await fetch(`${this.baseUrl}/api/runtime/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plugin }),
      })
      if (!res.ok) {
        let detail = ''
        try { const j: any = await res.json(); detail = j?.error || '' } catch { /* ignore */ }
        throw new Error(`Runtime switch failed: HTTP ${res.status}${detail ? ` (${detail})` : ''}`)
      }
      return res.json()
    },
  }
```

2. import 行（line 6-10）追加 `RuntimePluginState, RuntimeSwitchResult, MediaPluginState, MediaSwitchOptions, MediaSwitchResult`：

```typescript
  Approval, TriageItem, AutomationRule, SessionMessagePart, Todo,
  QuestionRequest, PermissionRequest,
  RuntimePluginState, RuntimeSwitchResult,
  MediaPluginState, MediaSwitchOptions, MediaSwitchResult,
  MethodNotSupportedError,
```

3. `media` namespace（line 508-546）在 `createTask` 之后加：

```typescript
    plugins: async (): Promise<{ plugins: MediaPluginState[] }> => {
      return this.request('/api/media/plugins')
    },
    switch: async (opts: MediaSwitchOptions): Promise<MediaSwitchResult> => {
      const res = await fetch(`${this.baseUrl}/api/media/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      })
      if (!res.ok) throw new Error(`Media switch failed: HTTP ${res.status}`)
      return res.json()
    },
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test`（workdir: `opencode-dev/packages/gateway-sdk/`）→ 全部 PASS
Run: `bun run typecheck`（workdir: `opencode-dev/packages/gateway-sdk/`）→ 无错误

- [ ] **Step 5: 提交**

```bash
git add opencode-dev/packages/gateway-sdk/src/client.ts opencode-dev/packages/gateway-sdk/src/types.ts opencode-dev/packages/gateway-sdk/src/client.test.ts opencode-dev/packages/gateway-sdk/src/types.test.ts
git commit -m "feat(sdk): add runtime and media plugin switch client methods"
```

---

### Task 5: 桌面 preload + 类型

**Files:**
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-api.ts`
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-types.ts`

**Interfaces:**
- Consumes: 无（preload 用 `invoke(namespace, method, ...args)` 字符串派发到 MafwClient namespace）
- Produces: `window.api.mafw.runtime.get()/switch(plugin)`、`window.api.mafw.media.plugins()/switch(opts)`

- [ ] **Step 1: preload 实现**

In `opencode-dev/packages/desktop/src/preload/mafw-api.ts`:

1. 在 `config` namespace（line 134-137）之后加：

```typescript
    runtime: {
      get: () => invoke("runtime", "get"),
      switch: (plugin: string) => invoke("runtime", "switch", plugin),
    },
```

2. `media` namespace（line 112-119）在 `uploadAndCreate` 后加：

```typescript
      plugins: () => invoke("media", "plugins"),
      switch: (opts: { engine?: string; image?: string; video?: string; audio?: string }) => invoke("media", "switch", opts),
```

In `opencode-dev/packages/desktop/src/preload/mafw-types.ts`:

1. 在 `config`（line 140-143）之后加：

```typescript
  runtime: {
    get: () => Promise<{ active: { name: string; capabilities: Record<string, boolean> }; plugins: { file: string; name?: string; status: string; error?: string; capabilities?: Record<string, boolean> }[] }>
    switch: (plugin: string) => Promise<{ success: boolean; restartRequired: boolean; target: string; envOverride: boolean }>
  }
```

2. `media`（line 121-125）在 `uploadAndCreate` 后加：

```typescript
    plugins: () => Promise<{ plugins: { file: string; name?: string; status: string; error?: string; modalities?: string[] }[] }>
    switch: (opts: { engine?: string; image?: string; video?: string; audio?: string }) => Promise<{ success: boolean; restartRequired: boolean; resolved: { engine: string; image: string; video: string; audio: string } }>
```

- [ ] **Step 2: 验证类型**

Run: `bun typecheck`（workdir: `opencode-dev/packages/desktop/`）→ 无错误

- [ ] **Step 3: 提交**

```bash
git add opencode-dev/packages/desktop/src/preload/mafw-api.ts opencode-dev/packages/desktop/src/preload/mafw-types.ts
git commit -m "feat(desktop): expose runtime/media switch APIs in preload"
```

---

### Task 6: 桌面 Config 页「插件 Plugins」卡片

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/pages/Config.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`（追加 2 个类）

**Interfaces:**
- Consumes: `window.api.mafw.runtime.get/switch`、`window.api.mafw.media.plugins/switch`、`window.api.mafw.config.get("media")`（Task 5）、`window.api.mafw.gateway.restart`（已有）、`SelectV2`（`@opencode-ai/ui/v2/select-v2`）、`ButtonV2`/`showToastV2`（已有 import）
- Produces: Config 页「插件 Plugins」卡片（Runtime 下拉 + 二次确认条 + Media 每模态下拉）

- [ ] **Step 1: CSS 追加**

In `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`（`.mafw-config-ops-actions` 定义后、line 1360 附近）追加：

```css
.mafw-plugin-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.mafw-plugin-row-label {
  width: 84px;
  font-size: 12px;
  color: var(--text-2);
  flex-shrink: 0;
}
.mafw-plugin-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-2);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 8px;
}
```

- [ ] **Step 2: Config.tsx 逻辑**

In `opencode-dev/packages/desktop/src/renderer/mafw/pages/Config.tsx`:

1. import 行改为（追加 `For, Show` 和 `SelectV2`）：

```typescript
import { createSignal, createEffect, onCleanup, onMount, For, Show } from "solid-js"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { showToastV2 } from "@opencode-ai/ui/v2/toast-v2"

const MEDIA_KINDS = ["engine", "image", "video", "audio"] as const
```

2. 在 `restartGateway` 函数（line 109）之后加状态与逻辑：

```typescript
  // ── Plugin switcher (Runtime + Media) ──
  const [rtInfo, setRtInfo] = createSignal<any>(null)
  const [mediaCfg, setMediaCfg] = createSignal<any>(null)
  const [mediaPluginList, setMediaPluginList] = createSignal<any[]>([])
  const [pendingRuntime, setPendingRuntime] = createSignal<string | null>(null)
  const [switching, setSwitching] = createSignal(false)

  async function loadPlugins() {
    try {
      const [rt, mp, cfg] = await Promise.all([
        window.api.mafw.runtime.get(),
        window.api.mafw.media.plugins(),
        window.api.mafw.config.get("media"),
      ])
      setRtInfo(rt)
      setMediaPluginList(mp.plugins || [])
      setMediaCfg(cfg || {})
    } catch (err: any) {
      console.warn("[Plugins] load failed:", err?.message)
    }
  }

  const runtimeOptions = () => {
    const names = new Set<string>(["opencode"])
    const info = rtInfo()
    if (info?.active?.name) names.add(info.active.name)
    for (const p of (info?.plugins || [])) if (p.status === "ok" && p.name) names.add(p.name)
    return [...names]
  }
  const activeRuntime = () => rtInfo()?.active?.name ?? "opencode"

  const mediaOptions = (kind: string) => {
    const names = new Set<string>(["pi"])
    for (const p of mediaPluginList()) {
      if (p.status === "ok" && p.name && (!p.modalities || p.modalities.includes(kind))) names.add(p.name)
    }
    if (kind !== "engine") return [...names, ""]
    return [...names]
  }
  const mediaCurrent = (kind: string) => {
    const cfg = mediaCfg()
    if (kind === "engine") return cfg?.engine ?? "pi"
    return cfg?.[kind]?.engine ?? ""
  }
  const mediaLabel = (kind: string, x: string) => {
    if (kind !== "engine" && x === "") return "跟随全局"
    return x
  }

  async function confirmRuntimeSwitch() {
    const target = pendingRuntime()
    if (!target) return
    setSwitching(true)
    try {
      const res = await window.api.mafw.runtime.switch(target)
      setPendingRuntime(null)
      if (res.envOverride) {
        showToastV2({ description: "已保存。注意：MAFW_RUNTIME_PLUGIN 环境变量将覆盖此设置", duration: 4000 })
      } else {
        showToastV2({ description: "已保存，正在重启 Gateway…", duration: 3000 })
      }
      await window.api.mafw.gateway.restart()
      await loadPlugins()
      showToastV2({ description: `已切换到 ${res.target}`, duration: 2000 })
    } catch (err: any) {
      showToastV2({ description: `切换失败: ${err.message}`, duration: 3000 })
    }
    setSwitching(false)
  }

  async function switchMedia(kind: string, value: string) {
    try {
      const res = await window.api.mafw.media.switch({ [kind]: value } as any)
      await loadPlugins()
      const effective = (res.resolved as any)[kind] ?? res.resolved.engine
      showToastV2({
        description: effective !== value
          ? `「${value === "" ? "跟随全局" : value}」已生效（当前 ${effective}）`
          : "已生效",
        duration: 2000,
      })
    } catch (err: any) {
      showToastV2({ description: `切换失败: ${err.message}`, duration: 3000 })
    }
  }
```

3. `onMount`（line 39）改为同时加载插件状态：

```typescript
  onMount(() => { loadConfig(); loadOpenCodeConfig(); loadPlugins() })
```

- [ ] **Step 3: Config.tsx JSX**

在「Gateway 运维」块结束（line 203 `</div>`）之后、「opencode 配置」块（line 204）之前插入：

```tsx
      {/* Plugins (Runtime + Media switcher) */}
      <div class="mafw-config-ops">
        <div class="mafw-config-ops-title">插件 Plugins</div>
        <div class="mafw-plugin-row">
          <span class="mafw-plugin-row-label">Agent Runtime</span>
          <div style={{ width: 220 }}>
            <SelectV2
              options={runtimeOptions()}
              current={activeRuntime()}
              value={(x: string) => x}
              label={(x: string) => (x === "opencode" ? "opencode（默认）" : x)}
              onSelect={(v: string | null) => { if (v && v !== activeRuntime()) setPendingRuntime(v) }}
              placeholder="选择 runtime"
            />
          </div>
        </div>
        <Show when={pendingRuntime()}>
          <div class="mafw-plugin-confirm">
            <span>切换 runtime 将重启 Gateway，确定切换为「{pendingRuntime()}」？</span>
            <ButtonV2 variant="contrast" size="small" disabled={switching()} onClick={confirmRuntimeSwitch}>确定并重启</ButtonV2>
            <ButtonV2 variant="ghost" size="small" disabled={switching()} onClick={() => setPendingRuntime(null)}>取消</ButtonV2>
          </div>
        </Show>
        <For each={MEDIA_KINDS as unknown as string[]}>
          {(kind) => (
            <div class="mafw-plugin-row">
              <span class="mafw-plugin-row-label">{kind === "engine" ? "默认引擎" : kind}</span>
              <div style={{ width: 220 }}>
                <SelectV2
                  options={mediaOptions(kind)}
                  current={mediaCurrent(kind)}
                  value={(x: string) => x}
                  label={(x: string) => mediaLabel(kind, x)}
                  onSelect={(v: string | null) => { if (v != null && v !== mediaCurrent(kind)) switchMedia(kind, v) }}
                />
              </div>
            </div>
          )}
        </For>
      </div>
```

- [ ] **Step 4: 验证类型**

Run: `bun typecheck`（workdir: `opencode-dev/packages/desktop/`）→ 无错误
（Config.tsx 有 `// @ts-nocheck`，类型错误不阻塞，但保持代码干净）

- [ ] **Step 5: 手动验证**

Run: `bun dev`（workdir: `opencode-dev/packages/desktop/`）
1. 打开 Config 页 → 「插件 Plugins」卡片显示，Runtime 下拉含 opencode（默认）/pi
2. 选 pi → 出现确认条「确定并重启」→ 点确认 → Gateway 重启 → toast「已切换到 pi」→ 下拉 active 显示 pi
3. Media 段切换 video 为某引擎 → toast「已生效」，无需重启
4. 切回 opencode → 确认 → 重启 → active 恢复 opencode

- [ ] **Step 6: 提交**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/pages/Config.tsx opencode-dev/packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): add runtime/media plugin switcher to Config page"
```

---

### Task 7: 收尾验证 + AGENTS.md 文档

**Files:**
- Modify: `AGENTS.md`（§5.19 Runtime 能力契约后补一段切换器说明）

**Interfaces:**
- Consumes: 全部前置任务
- Produces: 文档更新 + 全量验证结论

- [ ] **Step 1: 全量验证**

Run: `npm test`（workdir: `gateway/`）→ 全部 PASS
Run: `npx tsc --noEmit`（workdir: `gateway/`）→ 无错误
Run: `bun test`（workdir: `opencode-dev/packages/gateway-sdk/`）→ 全部 PASS
Run: `bun typecheck`（workdir: `opencode-dev/packages/desktop/`）→ 无错误

- [ ] **Step 2: 文档**

在 `AGENTS.md` §5.19 末尾（pi runtime 内置插件段落之后）追加：

```markdown
#### 插件切换端点

- `POST /api/runtime/switch { plugin }` — 持久化 `runtime.plugin`（合并写 config.yaml），返回 `restartRequired: true`，**需重启生效**；未知插件 400；`MAFW_RUNTIME_PLUGIN` 存在时返回 `envOverride: true`
- `POST /api/media/switch { engine?, image?, video?, audio? }` — 持久化 media 引擎覆盖 + 热加载插件，**热生效**；`''` 表示该层跟随全局；未知引擎 fail-open 回退 pi
- 桌面 Config 页「插件 Plugins」卡片：Runtime 下拉（二次确认 + 自动重启）、Media 每模态下拉
```

- [ ] **Step 3: 提交**

```bash
git add AGENTS.md
git commit -m "docs: document plugin switcher endpoints and UI"
```