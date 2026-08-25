# Usage Provider Plugin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把用量 provider 适配器做成用户可插拔的 JS 插件系统，新增 provider 只需往 `~/.mafw/usage-plugins/` 丢一个 `.js` 文件。

**Architecture:** 新增 `PluginLoader` 类负责扫描/加载/热重载插件目录，维护加载状态。`UsagePoller` 合并插件适配器与内置适配器（插件同名优先覆盖）。HTTP API 暴露插件状态与手动重载。Desktop 配置面板新增插件管理区。

**Tech Stack:** TypeScript (CJS), Node.js fs.watch, Electron shell.openPath

## Global Constraints

- 插件形式：CJS JS 文件（`module.exports = { name, plan, async fetch(ctx) }`）
- 插件目录：`~/.mafw/usage-plugins/`（`os.homedir()/.mafw/usage-plugins`）
- 热加载：fs.watch + 300ms 防抖 + require cache 清理
- 内置适配器保留在 gateway 源码，插件同名可覆盖
- 错误处理：fail-open（插件错误不影响其他插件和内置适配器）
- 前端显示零改动（UsageDock 已动态渲染），仅配置面板新增插件管理区

---

## File Structure

**New files:**
- `gateway/src/usage/plugin-loader.ts` — PluginLoader 类（扫描/加载/热重载/状态）
- `gateway/src/usage/plugin-context.ts` — PluginContext 工厂 + makeAdapter
- `gateway/src/usage/auth-helpers.ts` — 提取 readProviderKey 供插件和内置共用
- `tests/unit/gateway/plugin-loader.test.ts` — 插件加载器单测

**Auto-generated (首次启动):**
- `~/.mafw/usage-plugins/README.md` — 插件 API 说明
- `~/.mafw/usage-plugins/example.js.disabled` — 模板

**Modified files:**
- `gateway/src/usage/usage-poller.ts` — 接受 PluginLoader，合并 adapters
- `gateway/src/usage/external-adapters.ts` — readProviderKey 移到 auth-helpers
- `gateway/src/config.ts` — 加 `pluginConfig` 字段
- `gateway/src/index.ts` — init PluginLoader，HTTP 路由
- `opencode-dev/packages/gateway-sdk/src/client.ts` — usagePlugins / usagePluginsReload
- `opencode-dev/packages/desktop/src/preload/mafw-api.ts` — usagePlugins / usagePluginsReload / openUsagePluginsDir
- `opencode-dev/packages/desktop/src/preload/mafw-types.ts` — 类型
- `opencode-dev/packages/desktop/src/main/mafw-ipc.ts` — IPC handlers
- `opencode-dev/packages/desktop/src/renderer/mafw/components/UsageDock.tsx` — 插件管理区

---

### Task 1: PluginLoader Core (scan, load, state, fail-open) + Tests

**Files:**
- Create: `gateway/src/usage/plugin-loader.ts`
- Create: `gateway/src/usage/auth-helpers.ts`
- Test: `tests/unit/gateway/plugin-loader.test.ts`

**Interfaces:**
- Produces: `PluginLoader` class with `init()`, `getAdapters()`, `getState()`, `reload()`, `stop()`
- Produces: `PluginState` interface: `{ file, name?, status: 'ok'|'error', error?, overridden: boolean, adapter?: ExternalAdapter }`
- Produces: `readProviderKey(name)` function (extracted from external-adapters)

- [ ] **Step 1: Extract readProviderKey to auth-helpers.ts**

Create `gateway/src/usage/auth-helpers.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export function readProviderKey(providerName: string): string | null {
  try {
    const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
    const raw = fs.readFileSync(authPath, 'utf8');
    const parsed = JSON.parse(raw);
    const entry = parsed?.[providerName];
    if (typeof entry?.key === 'string' && entry.key.trim()) {
      return entry.key.trim();
    }
  } catch {
    /* missing/corrupt */
  }
  return null;
}
```

- [ ] **Step 2: Update external-adapters.ts to import readProviderKey**

In `gateway/src/usage/external-adapters.ts`, replace all local `readProviderKey` calls with:

```typescript
import { readProviderKey } from './auth-helpers';
```

Remove the local `readProviderKey` function definition.

- [ ] **Step 3: Write failing test for PluginLoader.scan()**

Create `tests/unit/gateway/plugin-loader.test.ts`:

```typescript
import { PluginLoader } from '../../../gateway/src/usage/plugin-loader';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('PluginLoader', () => {
  let tmpDir: string;
  let loader: PluginLoader;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-test-'));
    loader = new PluginLoader(tmpDir, ['builtin1']);
  });

  afterEach(() => {
    loader.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('scan loads valid plugin', async () => {
    fs.writeFileSync(path.join(tmpDir, 'good.js'), `
      module.exports = {
        name: 'test-provider',
        plan: 'Test',
        async fetch(ctx) {
          return { name: 'test-provider', plan: 'Test', windows: [] };
        },
      };
    `);
    await loader.init();
    const state = loader.getState();
    expect(state).toHaveLength(1);
    expect(state[0].status).toBe('ok');
    expect(state[0].name).toBe('test-provider');
  });

  test('scan skip .disabled files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'example.js.disabled'), 'module.exports = {};');
    await loader.init();
    expect(loader.getState()).toHaveLength(0);
  });

  test('scan fail-open on syntax error', async () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.js'), 'syntax error {{{');
    await loader.init();
    const state = loader.getState();
    expect(state).toHaveLength(1);
    expect(state[0].status).toBe('error');
    expect(state[0].error).toBeTruthy();
  });

  test('scan fail-open on missing name', async () => {
    fs.writeFileSync(path.join(tmpDir, 'no-name.js'), 'module.exports = { fetch: async () => null };');
    await loader.init();
    const state = loader.getState();
    expect(state).toHaveLength(1);
    expect(state[0].status).toBe('error');
    expect(state[0].error).toContain('name');
  });

  test('plugin overrides builtin', async () => {
    fs.writeFileSync(path.join(tmpDir, 'override.js'), `
      module.exports = { name: 'builtin1', plan: 'Override', async fetch() { return null; } };
    `);
    await loader.init();
    const state = loader.getState();
    expect(state[0].overridden).toBe(true);
  });

  test('duplicate plugin name marked as error', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), `
      module.exports = { name: 'dup', plan: 'A', async fetch() { return null; } };
    `);
    fs.writeFileSync(path.join(tmpDir, 'b.js'), `
      module.exports = { name: 'dup', plan: 'B', async fetch() { return null; } };
    `);
    await loader.init();
    const state = loader.getState();
    expect(state).toHaveLength(2);
    const a = state.find(s => s.file === 'a.js');
    const b = state.find(s => s.file === 'b.js');
    expect(a?.status).toBe('ok');
    expect(b?.status).toBe('error');
    expect(b?.error).toContain('duplicate');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/plugin-loader.test.ts --runInBand`

Expected: FAIL (PluginLoader not found)

- [ ] **Step 5: Implement PluginLoader**

Create `gateway/src/usage/plugin-loader.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils/logger';
import { ExternalAdapter } from './types';
import { makeAdapter } from './plugin-context';

export interface PluginState {
  file: string;
  name?: string;
  status: 'ok' | 'error';
  error?: string;
  overridden: boolean;
  adapter?: ExternalAdapter;
}

export class PluginLoader {
  private pluginsDir: string;
  private state = new Map<string, PluginState>();
  private watcher?: fs.FSWatcher;
  private debounceTimer?: NodeJS.Timeout;
  private builtinNames: Set<string>;

  constructor(pluginsDir: string, builtinNames: string[]) {
    this.pluginsDir = pluginsDir;
    this.builtinNames = new Set(builtinNames);
  }

  async init(): Promise<void> {
    this.ensureDir();
    await this.scan();
    this.startWatch();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      fs.writeFileSync(path.join(this.pluginsDir, 'README.md'), README_CONTENT);
      fs.writeFileSync(path.join(this.pluginsDir, 'example.js.disabled'), EXAMPLE_CONTENT);
      log.info(`[PluginLoader] Created ${this.pluginsDir}`);
    }
  }

  private async scan(): Promise<void> {
    if (!fs.existsSync(this.pluginsDir)) return;
    const files = fs.readdirSync(this.pluginsDir).filter(f => f.endsWith('.js'));
    const seen = new Set<string>();
    const loadedNames = new Set<string>();
    for (const file of files.sort()) {
      await this.loadFile(file, loadedNames);
      seen.add(file);
    }
    for (const [file] of this.state) {
      if (!seen.has(file)) this.state.delete(file);
    }
  }

  private async loadFile(file: string, loadedNames: Set<string>): Promise<void> {
    const fullPath = path.join(this.pluginsDir, file);
    try {
      const cacheKey = require.resolve(fullPath);
      delete require.cache[cacheKey];
    } catch { /* first load */ }

    try {
      const mod = require(fullPath);
      const name = mod?.name;
      if (!name || typeof name !== 'string') {
        this.state.set(file, { file, status: 'error', error: 'missing name', overridden: false });
        return;
      }
      if (typeof mod.fetch !== 'function') {
        this.state.set(file, { file, name, status: 'error', error: 'missing fetch()', overridden: false });
        return;
      }
      if (loadedNames.has(name)) {
        this.state.set(file, { file, name, status: 'error', error: 'duplicate name', overridden: false });
        log.warn(`[PluginLoader] ${file}: duplicate name '${name}', skipping`);
        return;
      }
      loadedNames.add(name);
      const overridden = this.builtinNames.has(name);
      const adapter = makeAdapter(mod, file);
      this.state.set(file, { file, name, status: 'ok', overridden, adapter });
      log.info(`[PluginLoader] Loaded ${file} (${name})${overridden ? ' [overrides builtin]' : ''}`);
    } catch (err: any) {
      const prev = this.state.get(file);
      this.state.set(file, {
        file,
        name: prev?.name,
        status: 'error',
        error: err.message,
        overridden: false,
        adapter: prev?.adapter,
      });
      log.warn(`[PluginLoader] ${file} load error: ${err.message}`);
    }
  }

  getAdapters(): ExternalAdapter[] {
    const adapters: ExternalAdapter[] = [];
    for (const s of this.state.values()) {
      if (s.status === 'ok' && s.adapter) adapters.push(s.adapter);
    }
    return adapters;
  }

  getState(): PluginState[] {
    return [...this.state.values()];
  }

  async reload(): Promise<void> {
    await this.scan();
  }

  private startWatch(): void {
    if (!fs.existsSync(this.pluginsDir)) return;
    try {
      this.watcher = fs.watch(this.pluginsDir, () => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.scan(), 300);
      });
    } catch (err: any) {
      log.warn(`[PluginLoader] watch failed: ${err.message}`);
    }
  }

  stop(): void {
    this.watcher?.close();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }
}

const README_CONTENT = `# Usage Provider Plugins

Place \`.js\` files here to add custom usage providers. Each file exports:

\`\`\`js
module.exports = {
  name: "my-provider",
  plan: "My Plan",
  async fetch(ctx) {
    const key = ctx.apiKey("my-provider");
    if (!key) return null;
    const res = await ctx.fetch("https://api.example.com/usage", {
      headers: { Authorization: \`Bearer \${key}\` },
    });
    const data = await res.json();
    return {
      name: "my-provider",
      plan: "My Plan",
      windows: [{
        window: "5h",
        used: data.used,
        limit: data.limit,
        unit: "$",
        pct: Math.round((data.used / data.limit) * 100),
      }],
    };
  },
};
\`\`\`

**ctx methods:**
- \`ctx.apiKey(name)\` — read provider key from opencode auth.json
- \`ctx.cookie(name)\` — read usage.cookies[name] from config
- \`ctx.fetch(url, opts)\` — fetch with 10s timeout
- \`ctx.pluginConfig(name)\` — read usage.pluginConfig[name] from config
- \`ctx.log\` — gateway logger

Return \`null\` to hide provider (falls back to local trajectory cost).
`;

const EXAMPLE_CONTENT = `// Rename to example.js to activate
module.exports = {
  name: "example",
  plan: "Example Plan",
  async fetch(ctx) {
    return null; // Hide provider
  },
};
`;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/plugin-loader.test.ts --runInBand`

Expected: PASS (all 5 tests)

- [ ] **Step 7: Commit**

```bash
git add gateway/src/usage/plugin-loader.ts gateway/src/usage/auth-helpers.ts tests/unit/gateway/plugin-loader.test.ts
git commit -m "feat(usage): add PluginLoader core (scan, load, state, fail-open)"
```

---

### Task 2: PluginContext + makeAdapter

**Files:**
- Create: `gateway/src/usage/plugin-context.ts`
- Modify: `gateway/src/usage/plugin-loader.ts` (import makeAdapter)

**Interfaces:**
- Consumes: `readProviderKey` from auth-helpers
- Produces: `createPluginContext(name)` and `makeAdapter(mod, file)`

- [ ] **Step 1: Implement plugin-context.ts**

```typescript
import { config } from '../config';
import { log } from '../core/utils/logger';
import { readProviderKey } from './auth-helpers';
import { ExternalAdapter, UsageProvider } from './types';

export interface PluginContext {
  apiKey: (name: string) => string | null;
  cookie: (name: string) => string | null;
  fetch: (url: string, opts?: RequestInit) => Promise<Response>;
  pluginConfig: (name: string) => any;
  log: typeof log;
}

export function createPluginContext(pluginName: string): PluginContext {
  return {
    apiKey: (name: string) => readProviderKey(name),
    cookie: (name: string) => {
      const c = config.usage?.cookies?.[name];
      return typeof c === 'string' && c.trim() ? c.trim() : null;
    },
    fetch: (url: string, opts?: RequestInit) =>
      fetch(url, { ...opts, signal: opts?.signal ?? AbortSignal.timeout(10_000) }),
    pluginConfig: (name: string) => config.usage?.pluginConfig?.[name] ?? null,
    log,
  };
}

export function makeAdapter(mod: any, file: string): ExternalAdapter {
  return {
    name: mod.name,
    async fetch(): Promise<UsageProvider | null> {
      const ctx = createPluginContext(mod.name);
      try {
        const result = await mod.fetch(ctx);
        if (result === null) return null;
        if (!result.name || !Array.isArray(result.windows)) {
          log.warn(`[PluginLoader] ${file}: invalid return structure`);
          return null;
        }
        return result;
      } catch (err: any) {
        log.warn(`[PluginLoader] ${file} fetch error: ${err.message}`);
        return null;
      }
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add gateway/src/usage/plugin-context.ts
git commit -m "feat(usage): add PluginContext and makeAdapter"
```

---

### Task 3: Hot Reload Tests

**Files:**
- Modify: `tests/unit/gateway/plugin-loader.test.ts`

- [ ] **Step 1: Add hot reload test**

Append to `tests/unit/gateway/plugin-loader.test.ts`:

```typescript
test('hot reload picks up new file', async () => {
  await loader.init();
  expect(loader.getState()).toHaveLength(0);
  fs.writeFileSync(path.join(tmpDir, 'new.js'), `
    module.exports = { name: 'new', plan: 'New', async fetch() { return null; } };
  `);
  await new Promise(r => setTimeout(r, 400)); // wait for debounce
  expect(loader.getState()).toHaveLength(1);
  expect(loader.getState()[0].name).toBe('new');
});

test('hot reload removes deleted file', async () => {
  fs.writeFileSync(path.join(tmpDir, 'temp.js'), `
    module.exports = { name: 'temp', plan: 'Temp', async fetch() { return null; } };
  `);
  await loader.init();
  expect(loader.getState()).toHaveLength(1);
  fs.unlinkSync(path.join(tmpDir, 'temp.js'));
  await new Promise(r => setTimeout(r, 400));
  expect(loader.getState()).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest tests/unit/gateway/plugin-loader.test.ts --runInBand`

Expected: PASS (all 7 tests)

- [ ] **Step 3: Commit**

```bash
git add tests/unit/gateway/plugin-loader.test.ts
git commit -m "test(usage): add hot reload tests for PluginLoader"
```

---

### Task 4: UsagePoller Integration

**Files:**
- Modify: `gateway/src/usage/usage-poller.ts`

**Interfaces:**
- Consumes: `PluginLoader.getAdapters()`
- Produces: merged adapters list (plugins + builtins, plugins override by name)

- [ ] **Step 1: Add pluginLoader parameter to UsagePoller constructor**

In `gateway/src/usage/usage-poller.ts`:

```typescript
import { PluginLoader } from './plugin-loader';

export class UsagePoller {
  private pluginLoader?: PluginLoader;
  private externalAdapters: ExternalAdapter[];

  constructor(pluginLoader?: PluginLoader) {
    this.pluginLoader = pluginLoader;
    this.externalAdapters = [
      new OpencodeGoAdapter(),
      new ZhipuCodingPlanAdapter(),
      // ... rest of builtins
    ];
  }
```

- [ ] **Step 2: Merge plugins into adapters in poll()**

In the `poll()` method, before the external adapters loop:

```typescript
const pluginAdapters = this.pluginLoader?.getAdapters() ?? [];
const pluginNames = new Set(pluginAdapters.map(a => a.name));
const builtins = this.externalAdapters.filter(a => !pluginNames.has(a.name));
const allExternal = [...pluginAdapters, ...builtins];

// Use allExternal instead of this.externalAdapters in the loop below
```

- [ ] **Step 3: Commit**

```bash
git add gateway/src/usage/usage-poller.ts
git commit -m "feat(usage): integrate PluginLoader into UsagePoller"
```

---

### Task 5: HTTP API Endpoints

**Files:**
- Modify: `gateway/src/index.ts`

- [ ] **Step 1: Add GET /api/usage/plugins**

In `gateway/src/index.ts`, after the `/api/usage` route:

```typescript
if (req.url?.match(/^\/api\/usage\/plugins(?:\?|$)/) && req.method === 'GET') {
  const plugins = pluginLoader.getState().map(s => ({
    file: s.file,
    name: s.name,
    status: s.status,
    error: s.error,
    overridden: s.overridden,
  }));
  return jsonResponse(res, { plugins });
}
```

- [ ] **Step 2: Add POST /api/usage/plugins/reload**

```typescript
if (req.url?.match(/^\/api\/usage\/plugins\/reload$/) && req.method === 'POST') {
  await pluginLoader.reload();
  const plugins = pluginLoader.getState().map(s => ({
    file: s.file,
    name: s.name,
    status: s.status,
    error: s.error,
    overridden: s.overridden,
  }));
  return jsonResponse(res, { ok: true, plugins });
}
```

- [ ] **Step 3: Init PluginLoader in start()**

In the `start()` function, after `initServices()`:

```typescript
const pluginsDir = path.join(os.homedir(), '.mafw', 'usage-plugins');
const builtinNames = ['opencode-go', 'zhipuai-coding-plan', 'kimi-for-coding', 'commandcode', 'deepseek', 'kimi', 'openrouter', 'siliconflow-cn'];
const pluginLoader = new PluginLoader(pluginsDir, builtinNames);
await pluginLoader.init();

const usagePoller = new UsagePoller(pluginLoader);
```

- [ ] **Step 4: Commit**

```bash
git add gateway/src/index.ts
git commit -m "feat(usage): add HTTP API for plugin state and reload"
```

---

### Task 6: Desktop IPC + UsageDock UI

**Files:**
- Modify: `opencode-dev/packages/gateway-sdk/src/client.ts`
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-api.ts`
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-types.ts`
- Modify: `opencode-dev/packages/desktop/src/main/mafw-ipc.ts`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/UsageDock.tsx`

- [ ] **Step 1: Add SDK methods**

In `opencode-dev/packages/gateway-sdk/src/client.ts`:

```typescript
async usagePlugins() {
  const res = await this.fetch('/api/usage/plugins');
  return res.json() as Promise<{ plugins: { file: string; name?: string; status: string; error?: string; overridden: boolean }[] }>;
}

async usagePluginsReload() {
  const res = await this.fetch('/api/usage/plugins/reload', { method: 'POST' });
  return res.json() as Promise<{ ok: boolean; plugins: any[] }>;
}
```

- [ ] **Step 2: Add types to mafw-types.ts**

```typescript
usagePlugins: () => Promise<{ plugins: { file: string; name?: string; status: string; error?: string; overridden: boolean }[] }>
usagePluginsReload: () => Promise<{ ok: boolean; plugins: any[] }>
openUsagePluginsDir: () => Promise<void>
```

- [ ] **Step 3: Add IPC to mafw-api.ts**

```typescript
usagePlugins: () => mafwClient.usagePlugins(),
usagePluginsReload: () => mafwClient.usagePluginsReload(),
openUsagePluginsDir: () => ipcRenderer.invoke('mafw-openUsagePluginsDir'),
```

- [ ] **Step 4: Add IPC handler in mafw-ipc.ts**

```typescript
ipcMain.handle('mafw-openUsagePluginsDir', async () => {
  const { shell } = require('electron');
  const path = require('path');
  const os = require('os');
  const dir = path.join(os.homedir(), '.mafw', 'usage-plugins');
  await shell.openPath(dir);
});
```

- [ ] **Step 5: Add plugin management section to UsageDock**

In `UsageDock.tsx`, inside `UsageConfigEditor`, after the cookie section:

```tsx
<div class="mafw-usage-config-title">平台插件</div>
<Show when={pluginState().length > 0}>
  <For each={pluginState()}>
    {(p: any) => (
      <div class="mafw-usage-config-row">
        <span class="mafw-usage-config-name">
          {p.status === 'ok' ? '✅' : '❌'} {p.file}
          {p.name && <span class="mafw-usage-config-hint"> ({p.name})</span>}
          {p.overridden && <span class="mafw-usage-config-hint"> [覆盖内置]</span>}
        </span>
        <Show when={p.error}>
          <span class="mafw-usage-config-error">{p.error}</span>
        </Show>
      </div>
    )}
  </For>
</Show>
<Show when={pluginState().length === 0}>
  <div class="mafw-usage-config-hint">无插件</div>
</Show>
<div class="mafw-usage-config-row">
  <ButtonV2 variant="ghost" size="small" onClick={() => window.api.mafw.openUsagePluginsDir()}>
    📂 打开插件目录
  </ButtonV2>
  <ButtonV2 variant="ghost" size="small" onClick={reloadPlugins} disabled={reloading()}>
    {reloading() ? '重载中...' : '🔄 重新加载'}
  </ButtonV2>
</div>
```

Add state and reload function:

```tsx
const [pluginState, setPluginState] = createSignal<any[]>([])
const [reloading, setReloading] = createSignal(false)

const loadPlugins = async () => {
  try {
    const res = await window.api.mafw.usagePlugins()
    setPluginState(res.plugins)
  } catch (e: any) {
    console.warn('[UsageConfig] loadPlugins failed:', e?.message)
  }
}

const reloadPlugins = async () => {
  setReloading(true)
  try {
    const res = await window.api.mafw.usagePluginsReload()
    setPluginState(res.plugins)
    showToastV2({ description: '插件已重载', duration: 2000 })
    load() // refresh usage data
  } catch (e: any) {
    showToastV2({ description: `重载失败: ${e.message}`, duration: 3000 })
  }
  setReloading(false)
}

createEffect(() => { loadPlugins() })
```

- [ ] **Step 6: Build SDK + Desktop**

```bash
cd opencode-dev/packages/gateway-sdk && npm run build
cd ../desktop && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add opencode-dev/packages/gateway-sdk/src/client.ts opencode-dev/packages/desktop/src/preload/mafw-api.ts opencode-dev/packages/desktop/src/preload/mafw-types.ts opencode-dev/packages/desktop/src/main/mafw-ipc.ts opencode-dev/packages/desktop/src/renderer/mafw/components/UsageDock.tsx
git commit -m "feat(desktop): add plugin management UI to UsageDock"
```

---

### Task 7: Config pluginConfig Field

**Files:**
- Modify: `gateway/src/config.ts`

- [ ] **Step 1: Add pluginConfig to usage config**

In `gateway/src/config.ts`:

```typescript
usage: {
  pollIntervalMs: number;
  limits: {
    'opencode-go': { '5h': number; '7d': number; month: number };
    zen: { balance: number };
  };
  budgets: Record<string, number>;
  cookies: Record<string, string>;
  pluginConfig: Record<string, any>;  // NEW
};
```

And in defaults:

```typescript
usage: {
  pollIntervalMs: 60000,
  limits: {
    'opencode-go': { '5h': 12, '7d': 30, month: 60 },
    zen: { balance: 100 },
  },
  budgets: {},
  cookies: {},
  pluginConfig: {},  // NEW
},
```

- [ ] **Step 2: Commit**

```bash
git add gateway/src/config.ts
git commit -m "feat(config): add usage.pluginConfig field"
```

---

### Task 8: Build + Deploy + Verify

- [ ] **Step 1: Build gateway**

```bash
cd gateway && npm run build
```

- [ ] **Step 2: Deploy gateway**

```bash
robocopy dist C:\home\ubuntu\.npm-global\node_modules\opencode-plugin-mafw\gateway\dist /E /IS /IT /NFL /NDL /NJH /NJS
mafw restart
```

- [ ] **Step 3: Verify plugin dir created**

```bash
ls ~/.mafw/usage-plugins/
```

Expected: `README.md`, `example.js.disabled`

- [ ] **Step 4: Test HTTP API**

```bash
curl http://127.0.0.1:3000/api/usage/plugins
```

Expected: `{ "plugins": [] }`

- [ ] **Step 5: Create test plugin**

```bash
cat > ~/.mafw/usage-plugins/test.js << 'EOF'
module.exports = {
  name: "test-plugin",
  plan: "Test",
  async fetch(ctx) {
    return {
      name: "test-plugin",
      plan: "Test",
      windows: [{ window: "5h", used: 1, limit: 10, unit: "$", pct: 10 }],
    };
  },
};
EOF
```

- [ ] **Step 6: Verify hot reload**

Wait 1s, then:

```bash
curl http://127.0.0.1:3000/api/usage/plugins
```

Expected: `{ "plugins": [{ "file": "test.js", "name": "test-plugin", "status": "ok", "overridden": false }] }`

- [ ] **Step 7: Verify provider appears in usage**

```bash
curl "http://127.0.0.1:3000/api/usage?sessionID=test&projectID=test"
```

Expected: `providers` array includes `test-plugin` with 5h window at 10%

- [ ] **Step 8: Delete test plugin**

```bash
rm ~/.mafw/usage-plugins/test.js
```

- [ ] **Step 9: Commit all**

```bash
git add -A
git commit -m "feat(usage): complete plugin system implementation"
```
