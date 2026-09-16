# 统一插件包（Unified Plugin Packages）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用"一个插件包 = 多个贡献点"的统一模型取代四个按类型分裂的插件目录（usage/media/runtime/ui），并让内置件与用户插件走同一接口（opencode 注册为正式 builtin runtime、media `pi` 可被同名用户插件覆盖、ctx 补齐 projectDir/gatewayPort）。

**Architecture:** 新增 `PluginHost`（扫 `~/.mafw/plugins/`，激活包，产出贡献条目）+ 统一 `PluginPackageContext`（三个现有 ctx 的超集）。现有三个 loader 保持消费方接口不变，各加一个 `setPackageEntries()` 方法接收 host 推送；**优先级：包 > legacy 目录文件 > 内置**。legacy 目录（`usage-plugins/`、`media-plugins/`、`runtime-plugins/`、`ui-plugins/`）行为完全不变（纯加法兼容）。UI 工具卡（desktop 进程）本期不激活，仅在 hub 展示登记。

**Tech Stack:** TypeScript（gateway，CJS 输出）、Node `fs.watch`、Jest（gateway/tests/unit）。

## Global Constraints

- 不改现有三个 loader 的对外消费接口（`getAdapters()` / `getEngines()` / `get()` 签名不变）。
- legacy 目录扫描、watch、覆盖语义（用户同名覆盖内置）零行为变化；全部现有测试必须保持通过。
- fail-open：单个包激活失败只记 error state，不影响其他包与内置。
- 优先级常量：**包 > legacy 文件 > 内置**（同名时）。
- 测试命令统一：`cd gateway; npx jest tests/unit/<file> --runInBand`；全量回归 `cd gateway; npx jest --runInBand`。
- 提交信息格式：`feat(gateway): ...` / `test(gateway): ...` / `docs: ...`。
- 配置读取走 `config.raw` 宽松透传（新增 `plugins.<name>.config` 段无需改 config schema）。
- Windows 平台：`fs.watch` 不用 `recursive: true`（Linux 不支持）；每个包子目录单独建 watcher。

## 关键既有文件地图（执行前必读）

| 文件 | 作用 |
|---|---|
| `gateway/src/usage/plugin-loader.ts` | usage PluginLoader（builtinPluginsDir + 用户目录双扫描，同名用户覆盖内置） |
| `gateway/src/usage/plugin-context.ts` | `makeAdapter(mod, file, usageStats, resolveInlineApiKey)`、`createUsageStatsProvider(store)`、`UsageStatsProvider` |
| `gateway/src/media/media-plugin-loader.ts` | MediaPluginLoader；`MediaEngine { prompt, modalities }`；`createPiPromptAdapter({fixPayload, credentials})` 来自 `./pi-adapter` |
| `gateway/src/runtime/loader.ts` | RuntimePluginLoader：`registerBuiltin(name, factory, capabilities, external)`、`get(name)`（factories→builtins）、`minimalCapabilities()` 合并 |
| `gateway/src/runtime/contract.ts` | `fullCapabilities()`（L52）、`minimalCapabilities()`（L70）、`RuntimeCredentials`、`AgentRuntime` |
| `gateway/src/plugins/hub.ts` | hub：`HubDeps { dirs, builtinEntries, getErrors, configDisabledUsage, reload }`、`listPlugins()`、`PluginEntry` |
| `gateway/src/routes/plugins.ts` | hub HTTP 路由（deps 注入可单测） |
| `gateway/src/index.ts` | 接线点：runtimeLoader 初始化 L393-396、`createRuntime` L1005-1026、mediaPluginLoader L1759-1798、usage PluginLoader L1922-1942、hub deps L3990-4029 |
| `gateway/src/runtime/plugins/pi-runtime.ts` | pi 内置 runtime；L144 直读 `config.raw.paths.projectDir`、L252 直读 `config.server.apiPort` |
| `gateway/src/config.ts` | `config.resolvePath(...segments)`（L549，解析到 `~/.mafw/` 下）、`config.server.apiPort`、`config.raw` |

## 包格式（本计划实现的契约，写进 README 与 AGENTS.md）

```
~/.mafw/plugins/
  my-vendor.js                 # 单文件包：name = 文件名 stem
  my-vendor/                   # 目录包：plugin.json + 入口
    plugin.json                # { "name": "my-vendor", "version": "1.0.0", "main": "index.js" }
    index.js
    lib/...                    # 私有共享代码（注意：reload 只清主文件 require.cache）
```

模块形状（二选一）：

```js
// 声明式
module.exports = {
  name: "my-vendor",
  usage:   { name: "my-vendor", type: "api", plan: "P", async fetch(ctx) {} },
  media:   { modalities: ["image"], engine: "pi", fixPayload(p) {} },
  runtime: { capabilities: { eventStream: true }, async createRuntime(ctx) {} },
  uiTools: { bash: { override: false, render(ctx) {} } },  // v1 仅登记展示
};
// 或函数式（需要读 ctx 再决定贡献什么时用）
module.exports = {
  name: "my-vendor",
  async activate(ctx) { return { usage: {...}, media: {...} }; },
};
```

---

### Task 1: 包类型定义 + 统一上下文

**Files:**
- Create: `gateway/src/plugins/package-types.ts`
- Create: `gateway/src/plugins/package-context.ts`
- Test: `gateway/tests/unit/plugins-package-context.test.ts`

**Interfaces:**
- Consumes: `gateway/src/config.ts` 的 `config.raw`；`gateway/src/runtime/auth.ts` 的 `getProviderApiKey(name, undefined, credentials)`；`gateway/src/usage/plugin-context.ts` 的 `UsageStatsProvider`；`gateway/src/runtime/contract.ts` 的 `RuntimeCredentials`；`gateway/src/media/media-service.ts` 的 `PromptFn` 类型。
- Produces（后续所有任务依赖的确切签名）:
  - `PluginPackageContext { log, fetch(url,opts), apiKey(provider), pluginConfig(): Record<string,any>, credentials?, projectDir, gatewayPort, usage: UsageStatsProvider }`
  - `PluginContributions { usage?, media?, runtime?, uiTools? }`
  - `MediaContributionSpec { name?, modalities: string[], createPrompt?, engine?, fixPayload? }`
  - `RuntimeContributionSpec { name?, capabilities?, external?, createRuntime(ctx) }`
  - `RuntimePackageEntry { name, createRuntime, capabilities: Partial<RuntimeCapabilities>, external: boolean, source }`
  - `UsagePackageEntry { mod: Record<string,any>, source: string }`
  - `MediaPackageEntry { name, prompt: PromptFn, modalities: string[], source: string }`
  - `PackageManifest { name, version?, main? }`、`PackageDescriptor { name, mainFile, manifest? }`、`PackageState { name, source, status: 'ok'|'error', error?, contributions: string[], version? }`
  - `createPluginPackageContext(name, deps: PackageContextDeps): PluginPackageContext`

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/plugins-package-context.test.ts
import { config } from '../../src/config';
import { createPluginPackageContext } from '../../src/plugins/package-context';

describe('createPluginPackageContext', () => {
  const savedRaw = (config as any).raw;
  afterEach(() => { (config as any).raw = savedRaw; });

  it('pluginConfig 优先读 plugins.<name>.config', () => {
    (config as any).raw = { plugins: { foo: { config: { a: 1 } } }, usage: { pluginConfig: { foo: { a: 2 } } } };
    const ctx = createPluginPackageContext('foo', { projectDir: '/p', gatewayPort: 3000 });
    expect(ctx.pluginConfig()).toEqual({ a: 1 });
  });

  it('pluginConfig 回退 legacy usage→media→runtime 三段', () => {
    (config as any).raw = { media: { pluginConfig: { foo: { b: 2 } } } };
    const ctx = createPluginPackageContext('foo', { projectDir: '/p', gatewayPort: 3000 });
    expect(ctx.pluginConfig()).toEqual({ b: 2 });
  });

  it('pluginConfig 全缺省时返回 {}', () => {
    (config as any).raw = {};
    const ctx = createPluginPackageContext('foo', { projectDir: '/p', gatewayPort: 3000 });
    expect(ctx.pluginConfig()).toEqual({});
  });

  it('携带 projectDir/gatewayPort；usageStats 缺省返回空', () => {
    (config as any).raw = {};
    const ctx = createPluginPackageContext('foo', { projectDir: '/p', gatewayPort: 3000 });
    expect(ctx.projectDir).toBe('/p');
    expect(ctx.gatewayPort).toBe(3000);
    expect(ctx.usage.modelStats()).toEqual([]);
  });

  it('usageStats thunk 惰性求值', () => {
    (config as any).raw = {};
    const ctx = createPluginPackageContext('foo', {
      projectDir: '/p', gatewayPort: 3000,
      usageStats: () => ({ modelStats: () => [{ provider: 'p', model: 'm' }] as any }),
    });
    expect(ctx.usage.modelStats()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/plugins-package-context.test.ts --runInBand`
Expected: FAIL（Cannot find module '../../src/plugins/package-context'）

- [ ] **Step 3: 实现类型与上下文**

```typescript
// gateway/src/plugins/package-types.ts
import type { log } from '../core/utils/logger';
import type { PromptFn } from '../media/media-service';
import type { AgentRuntime, RuntimeCapabilities, RuntimeCredentials } from '../runtime/contract';
import type { UsageStatsProvider } from '../usage/plugin-context';

/** 统一插件包上下文 —— 三个 legacy ctx（usage/media/runtime）的超集。 */
export interface PluginPackageContext {
  log: typeof log;
  /** fetch，默认 60s 超时 */
  fetch: (url: string, opts?: RequestInit) => Promise<Response>;
  /** 读 opencode auth.json 的 provider key（经 runtime credentials 链） */
  apiKey: (provider: string) => string | null;
  /** plugins.<name>.config；缺省回退 legacy 三段 pluginConfig（usage→media→runtime），全缺省 {} */
  pluginConfig: () => Record<string, any>;
  credentials?: RuntimeCredentials;
  projectDir: string;
  gatewayPort: number;
  usage: UsageStatsProvider;
}

export interface MediaContributionSpec {
  /** 缺省 = 包名 */
  name?: string;
  modalities: string[];
  createPrompt?: (ctx: PluginPackageContext) => Promise<PromptFn>;
  engine?: 'pi';
  fixPayload?: (payload: any) => any;
}

export interface RuntimeContributionSpec {
  /** 缺省 = 包名 */
  name?: string;
  capabilities?: Partial<RuntimeCapabilities>;
  external?: boolean;
  createRuntime: (ctx: PluginPackageContext) => Promise<AgentRuntime>;
}

export interface PluginContributions {
  /** legacy usage 插件模块形状：{ name, type?, plan?, fetch(ctx), configSchema? } */
  usage?: Record<string, any>;
  media?: MediaContributionSpec;
  runtime?: RuntimeContributionSpec;
  /** v1 仅登记展示，不激活（desktop 进程侧加载不变） */
  uiTools?: Record<string, unknown>;
}

export interface RuntimePackageEntry {
  name: string;
  createRuntime: (ctx: any) => Promise<AgentRuntime>;
  capabilities: Partial<RuntimeCapabilities>;
  external: boolean;
  source: string;
}

export interface UsagePackageEntry {
  mod: Record<string, any>;
  source: string;
}

export interface MediaPackageEntry {
  name: string;
  prompt: PromptFn;
  modalities: string[];
  source: string;
}

export interface PackageManifest {
  name: string;
  version?: string;
  main?: string;
}

export interface PackageDescriptor {
  name: string;
  mainFile: string;
  manifest?: PackageManifest;
}

export interface PackageState {
  name: string;
  source: string;
  status: 'ok' | 'error';
  error?: string;
  contributions: string[];
  version?: string;
}
```

```typescript
// gateway/src/plugins/package-context.ts
import { config } from '../config';
import { log } from '../core/utils/logger';
import { getProviderApiKey } from '../runtime/auth';
import type { RuntimeCredentials } from '../runtime/contract';
import type { UsageStatsProvider } from '../usage/plugin-context';
import type { PluginPackageContext } from './package-types';

export interface PackageContextDeps {
  /** thunk 惰性求值（host 初始化时 opencodeClient/trajStore 可能尚未就绪） */
  getCredentials?: () => RuntimeCredentials | undefined;
  usageStats?: () => UsageStatsProvider | undefined;
  projectDir: string;
  gatewayPort: number;
}

const EMPTY_USAGE: UsageStatsProvider = { modelStats: () => [] };

export function createPluginPackageContext(name: string, deps: PackageContextDeps): PluginPackageContext {
  return {
    log,
    fetch: (url, opts) => fetch(url, { ...opts, signal: opts?.signal ?? AbortSignal.timeout(60_000) }),
    apiKey: (provider) => getProviderApiKey(provider, undefined, deps.getCredentials?.()) ?? null,
    pluginConfig: () =>
      (config.raw as any)?.plugins?.[name]?.config
      ?? (config.raw as any)?.usage?.pluginConfig?.[name]
      ?? (config.raw as any)?.media?.pluginConfig?.[name]
      ?? (config.raw as any)?.runtime?.pluginConfig?.[name]
      ?? {},
    credentials: deps.getCredentials?.(),
    projectDir: deps.projectDir,
    gatewayPort: deps.gatewayPort,
    usage: deps.usageStats?.() ?? EMPTY_USAGE,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway; npx jest tests/unit/plugins-package-context.test.ts --runInBand`
Expected: PASS（5 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/package-types.ts gateway/src/plugins/package-context.ts gateway/tests/unit/plugins-package-context.test.ts
git commit -m "feat(gateway): unified plugin package context (superset of legacy ctxs)"
```

---

### Task 2: PluginHost 扫描 + 激活 + 状态

**Files:**
- Create: `gateway/src/plugins/package-host.ts`
- Test: `gateway/tests/unit/plugins-package-host.test.ts`

**Interfaces:**
- Consumes: Task 1 的全部类型 + `createPluginPackageContext` 签名（host 构造参数是 `(name) => PluginPackageContext` 工厂，由 index.ts 用 deps 闭包生成）；`createPiPromptAdapter({ fixPayload, credentials })`（`gateway/src/media/pi-adapter.ts`）。
- Produces: `PluginHost` 类——`constructor(dir, createContext)`、`bindRuntime(cb)`、`bindMedia(cb)`、`bindUsage(cb)`（bind 时立即用当前条目回放一次，解决 loader 晚于 host 创建的顺序问题）、`init()`、`reload()`、`getState(): PackageState[]`、`stop()`。Task 3/4/5 的 loader 各消费对应 entry 数组。

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/plugins-package-host.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost } from '../../src/plugins/package-host';
import { createPluginPackageContext } from '../../src/plugins/package-context';

function mkHost(dir: string) {
  return new PluginHost(dir, (name) => createPluginPackageContext(name, { projectDir: '/p', gatewayPort: 3000 }));
}

describe('PluginHost', () => {
  let dir: string;
  let host: PluginHost;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pkghost-')); });
  afterEach(() => { host?.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('扫描单文件包并激活 usage 贡献', async () => {
    fs.writeFileSync(path.join(dir, 'acme.js'), `
module.exports = { name: 'acme', usage: { name: 'acme', type: 'api', plan: 'P', async fetch() { return null; } } };
`);
    host = mkHost(dir);
    const usage: any[] = [];
    host.bindUsage((entries) => { usage.length = 0; usage.push(...entries); });
    await host.init();
    expect(usage).toHaveLength(1);
    expect(usage[0].mod.name).toBe('acme');
    expect(host.getState()[0]).toMatchObject({ name: 'acme', status: 'ok', contributions: ['usage'] });
  });

  it('目录包读 plugin.json manifest（main 自定义）', async () => {
    const pkg = path.join(dir, 'big');
    fs.mkdirSync(pkg);
    fs.writeFileSync(path.join(pkg, 'plugin.json'), JSON.stringify({ name: 'big', version: '1.2.0', main: 'entry.js' }));
    fs.writeFileSync(path.join(pkg, 'entry.js'), `
module.exports = { name: 'big', runtime: { async createRuntime() { return { name: 'big', capabilities: {} }; } } };
`);
    host = mkHost(dir);
    const rt: any[] = [];
    host.bindRuntime((entries) => { rt.length = 0; rt.push(...entries); });
    await host.init();
    expect(rt).toHaveLength(1);
    expect(rt[0]).toMatchObject({ name: 'big', external: true });
    expect(host.getState()[0].version).toBe('1.2.0');
  });

  it('activate() 函数形式收到统一 ctx', async () => {
    fs.writeFileSync(path.join(dir, 'acme.js'), `
module.exports = { name: 'acme', async activate(ctx) {
  return { usage: { name: 'acme', type: 'api', plan: ctx.projectDir, async fetch() { return null; } } };
} };
`);
    host = mkHost(dir);
    const usage: any[] = [];
    host.bindUsage((e) => { usage.length = 0; usage.push(...e); });
    await host.init();
    expect(usage[0].mod.plan).toBe('/p');
  });

  it('media engine:"pi" + fixPayload 产出 prompt 函数', async () => {
    fs.writeFileSync(path.join(dir, 'vl.js'), `
module.exports = { name: 'vl', media: { modalities: ['image'], engine: 'pi', fixPayload: (p) => p } };
`);
    host = mkHost(dir);
    const media: any[] = [];
    host.bindMedia((e) => { media.length = 0; media.push(...e); });
    await host.init();
    expect(media).toHaveLength(1);
    expect(typeof media[0].prompt).toBe('function');
    expect(media[0].modalities).toEqual(['image']);
  });

  it('激活失败 fail-open：坏包记 error state，好包照常', async () => {
    fs.writeFileSync(path.join(dir, 'bad.js'), `throw new Error('boom');`);
    fs.writeFileSync(path.join(dir, 'good.js'), `
module.exports = { name: 'good', usage: { name: 'good', type: 'api', plan: 'P', async fetch() { return null; } } };
`);
    host = mkHost(dir);
    await host.init();
    const states = host.getState();
    expect(states.find((s) => s.name === 'bad')).toMatchObject({ status: 'error', error: 'boom' });
    expect(states.find((s) => s.name === 'good')).toMatchObject({ status: 'ok' });
  });

  it('name 与包名不一致报错', async () => {
    fs.writeFileSync(path.join(dir, 'acme.js'), `module.exports = { name: 'other', usage: {} };`);
    host = mkHost(dir);
    await host.init();
    expect(host.getState()[0].status).toBe('error');
    expect(host.getState()[0].error).toMatch(/name mismatch/);
  });

  it('无贡献字段报错', async () => {
    fs.writeFileSync(path.join(dir, 'empty.js'), `module.exports = { name: 'empty' };`);
    host = mkHost(dir);
    await host.init();
    expect(host.getState()[0].error).toMatch(/no contributions/);
  });

  it('bind 晚于 init 时回放当前条目', async () => {
    fs.writeFileSync(path.join(dir, 'acme.js'), `
module.exports = { name: 'acme', usage: { name: 'acme', type: 'api', plan: 'P', async fetch() { return null; } } };
`);
    host = mkHost(dir);
    await host.init();
    const usage: any[] = [];
    host.bindUsage((e) => { usage.length = 0; usage.push(...e); });
    expect(usage).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/plugins-package-host.test.ts --runInBand`
Expected: FAIL（Cannot find module）

- [ ] **Step 3: 实现 PluginHost**

```typescript
// gateway/src/plugins/package-host.ts
/**
 * 统一插件包宿主 —— 扫 ~/.mafw/plugins/（单文件包 *.js / 目录包 plugin.json+入口），
 * 激活后把贡献分发给三个 legacy loader（setPackageEntries）。fail-open。
 * 优先级（同名）：包 > legacy 目录文件 > 内置。
 */
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils/logger';
import { createPiPromptAdapter } from '../media/pi-adapter';
import type {
  MediaPackageEntry, PackageDescriptor, PackageManifest, PackageState,
  PluginContributions, PluginPackageContext, RuntimePackageEntry, UsagePackageEntry,
} from './package-types';

const VALID_MODALITIES = new Set(['image', 'video', 'audio']);

export class PluginHost {
  private state = new Map<string, PackageState>();
  private watcher?: fs.FSWatcher;
  private debounce?: NodeJS.Timeout;
  private runtimeCb?: (entries: RuntimePackageEntry[]) => void;
  private mediaCb?: (entries: MediaPackageEntry[]) => void;
  private usageCb?: (entries: UsagePackageEntry[]) => void;
  private lastRuntime: RuntimePackageEntry[] = [];
  private lastMedia: MediaPackageEntry[] = [];
  private lastUsage: UsagePackageEntry[] = [];

  constructor(
    private dir: string,
    private createContext: (name: string) => PluginPackageContext,
  ) {}

  bindRuntime(cb: (entries: RuntimePackageEntry[]) => void): void { this.runtimeCb = cb; cb(this.lastRuntime); }
  bindMedia(cb: (entries: MediaPackageEntry[]) => void): void { this.mediaCb = cb; cb(this.lastMedia); }
  bindUsage(cb: (entries: UsagePackageEntry[]) => void): void { this.usageCb = cb; cb(this.lastUsage); }

  async init(): Promise<void> {
    this.ensureDir();
    await this.reload();
    this.startWatch();
  }

  getState(): PackageState[] {
    return [...this.state.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  stop(): void {
    this.watcher?.close();
    if (this.debounce) clearTimeout(this.debounce);
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(path.join(this.dir, 'README.md'), README_CONTENT);
      log.info(`[PluginHost] Created ${this.dir}`);
    }
  }

  /** 全量重扫 + 重新激活 + 一次性推送（跨面原子：先全部激活完再推各 loader）。 */
  async reload(): Promise<void> {
    const next = new Map<string, PackageState>();
    const runtime: RuntimePackageEntry[] = [];
    const media: MediaPackageEntry[] = [];
    const usage: UsagePackageEntry[] = [];
    for (const desc of this.scanDescriptors(next)) {
      try {
        const c = await this.activate(desc);
        if (c.runtime) runtime.push(c.runtime);
        if (c.media) media.push(c.media);
        if (c.usage) usage.push(c.usage);
        next.set(desc.name, {
          name: desc.name, source: desc.mainFile, status: 'ok',
          contributions: c.contributions, version: desc.manifest?.version,
        });
      } catch (err: any) {
        next.set(desc.name, { name: desc.name, source: desc.mainFile, status: 'error', error: err.message, contributions: [] });
        log.warn(`[PluginHost] ${desc.name} activate error: ${err.message}`);
      }
    }
    this.state = next;
    this.lastRuntime = runtime;
    this.lastMedia = media;
    this.lastUsage = usage;
    this.runtimeCb?.(runtime);
    this.mediaCb?.(media);
    this.usageCb?.(usage);
  }

  /** 枚举候选包；逐条错误记入 errorStates（不抛出）。 */
  private scanDescriptors(errorStates: Map<string, PackageState>): PackageDescriptor[] {
    const out: PackageDescriptor[] = [];
    if (!fs.existsSync(this.dir)) return out;
    const entries = fs.readdirSync(this.dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      try {
        if (entry.isFile() && entry.name.endsWith('.js')) {
          out.push({ name: entry.name.replace(/\.js$/, ''), mainFile: path.join(this.dir, entry.name) });
        } else if (entry.isDirectory()) {
          const pkgDir = path.join(this.dir, entry.name);
          const manifestPath = path.join(pkgDir, 'plugin.json');
          let manifest: PackageManifest | undefined;
          if (fs.existsSync(manifestPath)) {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          }
          const mainFile = path.join(pkgDir, manifest?.main ?? 'index.js');
          if (!fs.existsSync(mainFile)) throw new Error(`main file not found: ${manifest?.main ?? 'index.js'}`);
          out.push({ name: manifest?.name ?? entry.name, mainFile, manifest });
        }
      } catch (err: any) {
        errorStates.set(entry.name, { name: entry.name, source: path.join(this.dir, entry.name), status: 'error', error: err.message, contributions: [] });
      }
    }
    return out;
  }

  private async activate(desc: PackageDescriptor): Promise<{
    contributions: string[];
    runtime?: RuntimePackageEntry;
    media?: MediaPackageEntry;
    usage?: UsagePackageEntry;
  }> {
    try { delete require.cache[require.resolve(desc.mainFile)]; } catch { /* first load */ }
    const mod = require(desc.mainFile);
    const modName = mod?.name;
    if (typeof modName !== 'string' || !modName) throw new Error('missing name');
    if (modName !== desc.name) throw new Error(`name mismatch: exports '${modName}', package '${desc.name}'`);
    const ctx = this.createContext(modName);
    const contribs: PluginContributions =
      typeof mod.activate === 'function' ? ((await mod.activate(ctx)) ?? {}) : pickContributions(mod);
    const kinds: string[] = [];
    let runtime: RuntimePackageEntry | undefined;
    let media: MediaPackageEntry | undefined;
    let usage: UsagePackageEntry | undefined;

    if (contribs.usage) {
      const u = contribs.usage;
      if (typeof u.name !== 'string' || !u.name) throw new Error('usage contribution missing name');
      if (typeof u.fetch !== 'function') throw new Error('usage contribution missing fetch(ctx)');
      usage = { mod: u, source: desc.mainFile };
      kinds.push('usage');
    }
    if (contribs.media) {
      const spec = contribs.media;
      if (!Array.isArray(spec.modalities) || spec.modalities.length === 0
          || !spec.modalities.every((m) => VALID_MODALITIES.has(m))) throw new Error('media: invalid modalities');
      const hasCreatePrompt = typeof spec.createPrompt === 'function';
      const hasPiEngine = spec.engine === 'pi';
      if (hasCreatePrompt === hasPiEngine) throw new Error('media: createPrompt and engine:"pi" are mutually exclusive');
      const prompt = hasCreatePrompt
        ? await spec.createPrompt!(ctx)
        : createPiPromptAdapter({ fixPayload: spec.fixPayload, credentials: ctx.credentials });
      if (typeof prompt !== 'function') throw new Error('media: createPrompt did not return a function');
      media = { name: spec.name ?? modName, prompt, modalities: spec.modalities, source: desc.mainFile };
      kinds.push('media');
    }
    if (contribs.runtime) {
      const spec = contribs.runtime;
      if (typeof spec.createRuntime !== 'function') throw new Error('runtime: missing createRuntime(ctx)');
      runtime = {
        name: spec.name ?? modName,
        // 包 runtime 一律拿统一 ctx（忽略 loader 传入的 legacy ctx）
        createRuntime: (_ignored: any) => spec.createRuntime(ctx),
        capabilities: spec.capabilities ?? {},
        external: spec.external !== false,
        source: desc.mainFile,
      };
      kinds.push('runtime');
    }
    if (contribs.uiTools) kinds.push('uiTools');
    if (kinds.length === 0) throw new Error('no contributions (usage/media/runtime/uiTools)');
    return { contributions: kinds, runtime, media, usage };
  }

  private startWatch(): void {
    if (!fs.existsSync(this.dir)) return;
    try {
      this.watcher = fs.watch(this.dir, () => {
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => {
          if (!fs.existsSync(this.dir)) { this.watcher?.close(); this.watcher = undefined; return; }
          void this.reload().catch((err) => log.warn(`[PluginHost] reload error: ${err.message}`));
        }, 300);
      });
    } catch (err: any) {
      log.warn(`[PluginHost] watch failed: ${err.message}`);
    }
  }
}

function pickContributions(mod: any): PluginContributions {
  const out: PluginContributions = {};
  if (mod.usage) out.usage = mod.usage;
  if (mod.media) out.media = mod.media;
  if (mod.runtime) out.runtime = mod.runtime;
  if (mod.uiTools) out.uiTools = mod.uiTools;
  return out;
}

const README_CONTENT = `# MAFW Plugin Packages

一个插件包可以同时贡献多种能力（usage 配额 / media 引擎 / runtime / UI 工具卡）。

## 形态

- 单文件包：\`my-vendor.js\`（包名 = 文件名）
- 目录包：\`my-vendor/plugin.json\`（\`{ "name", "version"?, "main"? }\`，main 缺省 index.js）

## 模块形状（二选一）

\`\`\`js
module.exports = {
  name: "my-vendor",
  usage:   { name: "my-vendor", type: "api", plan: "P", async fetch(ctx) {} },
  media:   { modalities: ["image"], engine: "pi", fixPayload(p) {} },
  runtime: { capabilities: {}, async createRuntime(ctx) {} },
  uiTools: {},  // v1 仅在插件中心展示登记，桌面侧加载仍走 ~/.mafw/ui-plugins/
};
// 或：module.exports = { name, async activate(ctx) { return { usage: {...} }; } };
\`\`\`

## ctx（三个 legacy ctx 的超集）

- \`ctx.apiKey(provider)\` / \`ctx.fetch(url, opts)\`（60s）/ \`ctx.log\`
- \`ctx.pluginConfig()\` —— 读 config.yaml \`plugins.<name>.config\`（回退 legacy 三段 pluginConfig）
- \`ctx.projectDir\` / \`ctx.gatewayPort\` / \`ctx.usage.modelStats({sinceMs?, provider?})\`

## 优先级

同名时：**包 > legacy 目录文件（usage-plugins/ media-plugins/ runtime-plugins/）> 内置**。
legacy 目录行为不变。reload 只清主文件的 require.cache——改包内 lib/ 共享代码需 \`mafw restart\`。
`;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway; npx jest tests/unit/plugins-package-host.test.ts --runInBand`
Expected: PASS（8 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/package-host.ts gateway/tests/unit/plugins-package-host.test.ts
git commit -m "feat(gateway): PluginHost scanning + activation for unified plugin packages"
```

---

### Task 3: RuntimePluginLoader 接收包贡献

**Files:**
- Modify: `gateway/src/runtime/loader.ts`（类内加 packageEntries + setPackageEntries + get/getState 合并）
- Test: `gateway/tests/unit/plugins-package-runtime-loader.test.ts`

**Interfaces:**
- Consumes: Task 1 `RuntimePackageEntry`；现有 `minimalCapabilities()`（contract.ts L70）。
- Produces: `RuntimePluginLoader.setPackageEntries(entries: RuntimePackageEntry[]): void`；`get(name)` 查找顺序变为 **factories（legacy 文件）→ packageEntries → builtins**；`getState()` 追加 `file: 'package:<name>'` 条目（hub 展示用）。

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/plugins-package-runtime-loader.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RuntimePluginLoader } from '../../src/runtime/loader';

describe('RuntimePluginLoader package entries', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-rtpkg-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('setPackageEntries 后 get() 可解析，capabilities 合并 minimal 基线', async () => {
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    const factory = async () => ({ name: 'pkg-rt', capabilities: {} }) as any;
    loader.setPackageEntries([{ name: 'pkg-rt', createRuntime: factory, capabilities: { eventStream: true }, external: true, source: '/x.js' }]);
    const got = loader.get('pkg-rt');
    expect(got).toBeDefined();
    expect(got!.external).toBe(true);
    expect(got!.capabilities.eventStream).toBe(true);
    expect(got!.capabilities.sessionApi).toBe(true); // minimal 基线
  });

  it('legacy 文件插件优先于同名包条目', async () => {
    fs.writeFileSync(path.join(dir, 'pkg-rt.js'), `
module.exports = { name: 'pkg-rt', capabilities: {}, async createRuntime() { return { name: 'from-file' }; } };
`);
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    loader.setPackageEntries([{ name: 'pkg-rt', createRuntime: async () => ({ name: 'from-package' }) as any, capabilities: {}, external: true, source: '/x.js' }]);
    const rt = await loader.get('pkg-rt')!.createRuntime({} as any);
    expect(rt.name).toBe('from-file');
  });

  it('包条目优先于同名内置', async () => {
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    loader.registerBuiltin('pkg-rt', async () => ({ name: 'from-builtin' }) as any, {} as any, true);
    loader.setPackageEntries([{ name: 'pkg-rt', createRuntime: async () => ({ name: 'from-package' }) as any, capabilities: {}, external: true, source: '/x.js' }]);
    const rt = await loader.get('pkg-rt')!.createRuntime({} as any);
    expect(rt.name).toBe('from-package');
  });

  it('scan() 不清包条目；getState 含 package: 条目', async () => {
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    loader.setPackageEntries([{ name: 'pkg-rt', createRuntime: async () => ({}) as any, capabilities: {}, external: true, source: '/x.js' }]);
    await loader.scan();
    expect(loader.get('pkg-rt')).toBeDefined();
    const st = loader.getState();
    expect(st.some((s) => s.file === 'package:pkg-rt')).toBe(true);
  });

  it('空数组清空包条目', async () => {
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    loader.setPackageEntries([{ name: 'pkg-rt', createRuntime: async () => ({}) as any, capabilities: {}, external: true, source: '/x.js' }]);
    loader.setPackageEntries([]);
    expect(loader.get('pkg-rt')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/plugins-package-runtime-loader.test.ts --runInBand`
Expected: FAIL（loader.setPackageEntries is not a function）

- [ ] **Step 3: 实现**

在 `gateway/src/runtime/loader.ts` 的 `RuntimePluginLoader` 类中：

```typescript
// 文件顶部 import 区追加：
import type { RuntimePackageEntry } from '../plugins/package-types';

// 类字段区（private builtins 声明之后）追加：
  private packageEntries = new Map<string, RuntimePackageEntry>();

// 类方法区追加：
  /** PluginHost 推送的包贡献。查找顺序：legacy 文件 > 包 > 内置。scan() 不影响。 */
  setPackageEntries(entries: RuntimePackageEntry[]): void {
    this.packageEntries = new Map(entries.map((e) => [e.name, e]));
  }
```

修改 `get()`（现状 L141-148）为：

```typescript
  get(name: string): { createRuntime: RuntimeFactory; capabilities: RuntimeCapabilities; external: boolean } | undefined {
    const createRuntime = this.factories.get(name);
    const meta = this.meta.get(name);
    if (createRuntime && meta) return { createRuntime, ...meta };
    const pkg = this.packageEntries.get(name);
    if (pkg) {
      return {
        createRuntime: pkg.createRuntime,
        capabilities: { ...minimalCapabilities(), ...pkg.capabilities },
        external: pkg.external,
      };
    }
    const builtin = this.builtins.get(name);
    if (builtin) return { createRuntime: builtin.factory, ...builtin };
    return undefined;
  }
```

修改 `getState()`（现状 L155-160）为：

```typescript
  getState(): RuntimePluginState[] {
    for (const [name, b] of this.builtins) {
      this.state.set(`builtin:${name}`, { file: `builtin:${name}`, name, status: 'ok', capabilities: b.capabilities });
    }
    for (const [name, p] of this.packageEntries) {
      this.state.set(`package:${name}`, {
        file: `package:${name}`, name, status: 'ok',
        capabilities: { ...minimalCapabilities(), ...p.capabilities },
      });
    }
    return [...this.state.values()];
  }
```

- [ ] **Step 4: 跑测试确认通过 + 回归**

Run: `cd gateway; npx jest tests/unit/plugins-package-runtime-loader.test.ts --runInBand`
Expected: PASS（5 例）
Run: `cd gateway; npx jest tests/unit/plugin-loaders-no-example.test.ts --runInBand`
Expected: PASS（loader 行为回归）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/loader.ts gateway/tests/unit/plugins-package-runtime-loader.test.ts
git commit -m "feat(gateway): runtime loader accepts package contributions (package > legacy > builtin)"
```

---

### Task 4: usage PluginLoader 接收包贡献

**Files:**
- Modify: `gateway/src/usage/plugin-loader.ts`（packageEntries + setPackageEntries + getAdapters/getState 合并）
- Test: `gateway/tests/unit/plugins-package-usage-loader.test.ts`

**Interfaces:**
- Consumes: Task 1 `UsagePackageEntry`；现有 `makeAdapter(mod, file, usageStats, resolveInlineApiKey)`、`validateConfigSchema`（本文件内）。
- Produces: `PluginLoader.setPackageEntries(entries: UsagePackageEntry[]): void`；`getAdapters()` = legacy 适配器（剔除被包同名覆盖者）+ 包适配器（跳过 disabled）；`getState()` 追加包条目（`overridden` 标记打在 legacy 同名条目上）。

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/plugins-package-usage-loader.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginLoader } from '../../src/usage/plugin-loader';

const MOD = (name: string) => ({
  name, type: 'api', plan: 'P',
  async fetch() { return null; },
});

describe('usage PluginLoader package entries', () => {
  let dir: string;
  let loader: PluginLoader;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-usgpkg-')); });
  afterEach(() => { loader?.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('包适配器并入 getAdapters()', async () => {
    loader = new PluginLoader(dir, []);
    await loader.init();
    expect(loader.getAdapters()).toHaveLength(0);
    loader.setPackageEntries([{ mod: MOD('pkg-a'), source: '/x.js' }]);
    const adapters = loader.getAdapters();
    expect(adapters.map((a) => a.name)).toEqual(['pkg-a']);
  });

  it('同名时包覆盖 legacy 文件', async () => {
    fs.writeFileSync(path.join(dir, 'acme.js'), `
module.exports = { name: 'acme', type: 'api', plan: 'legacy', async fetch() { return null; } };
`);
    loader = new PluginLoader(dir, []);
    await loader.init();
    loader.setPackageEntries([{ mod: { ...MOD('acme'), plan: 'package' }, source: '/pkg.js' }]);
    const adapters = loader.getAdapters().filter((a) => a.name === 'acme');
    expect(adapters).toHaveLength(1);
    expect(loader.getState().filter((s) => s.name === 'acme' && s.file === '/pkg.js')).toHaveLength(1);
  });

  it('disabledPlugins 对包条目同样生效', async () => {
    loader = new PluginLoader(dir, [], { disabledPlugins: ['pkg-a'] });
    await loader.init();
    loader.setPackageEntries([{ mod: MOD('pkg-a'), source: '/x.js' }]);
    expect(loader.getAdapters()).toHaveLength(0);
    expect(loader.getState().find((s) => s.name === 'pkg-a')?.disabled).toBe(true);
  });

  it('空数组清空；reload 不清包条目', async () => {
    loader = new PluginLoader(dir, []);
    await loader.init();
    loader.setPackageEntries([{ mod: MOD('pkg-a'), source: '/x.js' }]);
    await loader.reload();
    expect(loader.getAdapters().map((a) => a.name)).toEqual(['pkg-a']);
    loader.setPackageEntries([]);
    expect(loader.getAdapters()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/plugins-package-usage-loader.test.ts --runInBand`
Expected: FAIL（setPackageEntries is not a function）

- [ ] **Step 3: 实现**

在 `gateway/src/usage/plugin-loader.ts`：

```typescript
// import 区追加：
import type { UsagePackageEntry } from '../plugins/package-types';

// 类字段区追加：
  private packageEntries: UsagePackageEntry[] = [];
```

修改 `getAdapters()`（现状 L184-190）：

```typescript
  getAdapters(): ExternalAdapter[] {
    const packageNames = new Set(this.packageEntries.map((e) => e.mod.name));
    const adapters: ExternalAdapter[] = [];
    for (const s of this.state.values()) {
      if (s.status === 'ok' && s.adapter && !s.disabled && !packageNames.has(s.name)) adapters.push(s.adapter);
    }
    for (const e of this.packageEntries) {
      if (this.disabledPlugins.has(e.mod.name)) continue;
      adapters.push(makeAdapter(e.mod, e.source, this.usageStats, this.resolveInlineApiKey));
    }
    return adapters;
  }
```

`getState()`（现状 L196-198）改为：

```typescript
  getState(): PluginState[] {
    const out = [...this.state.values()];
    const packageNames = new Set(this.packageEntries.map((e) => e.mod.name));
    for (const s of out) {
      if (s.name && packageNames.has(s.name)) s.overridden = true;
    }
    for (const e of this.packageEntries) {
      out.push({
        file: e.source,
        name: e.mod.name,
        status: 'ok',
        overridden: false,
        builtin: false,
        adapter: undefined,
        configSchema: validateConfigSchema(e.mod.configSchema),
        disabled: this.disabledPlugins.has(e.mod.name),
        pluginType: typeof e.mod.type === 'string' ? e.mod.type : undefined,
      });
    }
    return out;
  }
```

类方法区追加：

```typescript
  /** PluginHost 推送的包贡献。同名包覆盖 legacy 文件与内置；disabledPlugins 同样生效。 */
  setPackageEntries(entries: UsagePackageEntry[]): void {
    this.packageEntries = entries ?? [];
  }
```

注意：`getState()` 里给 legacy 条目打 `overridden` 时不要污染 `this.state` 持久对象——现状 `getState()` 返回浅拷贝数组但元素是引用。改为 `const out = [...this.state.values()].map((s) => ({ ...s }));` 再标记。

- [ ] **Step 4: 跑测试确认通过 + 回归**

Run: `cd gateway; npx jest tests/unit/plugins-package-usage-loader.test.ts --runInBand`
Expected: PASS（4 例）
Run: `cd gateway; npx jest tests/unit/usage --runInBand; npx jest tests/unit/usage-plugin-builtin-discovery.test.ts tests/unit/usage-plugin-disabled.test.ts tests/unit/usage-plugin-schema.test.ts --runInBand`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/usage/plugin-loader.ts gateway/tests/unit/plugins-package-usage-loader.test.ts
git commit -m "feat(gateway): usage loader accepts package contributions with same-name override"
```

---

### Task 5: MediaPluginLoader 接收包贡献 + 内置引擎注册表

**Files:**
- Modify: `gateway/src/media/media-plugin-loader.ts`（`MediaEngine` 加 `builtin?`、builtinEngines 注册表、packageEntries、getEngines 三层合并、getBuiltinEngineNames）
- Test: `gateway/tests/unit/plugins-package-media-loader.test.ts`

**Interfaces:**
- Consumes: Task 1 `MediaPackageEntry`。
- Produces:
  - `MediaEngine { prompt, modalities, builtin?: boolean }`（字段追加，消费方兼容）
  - `MediaPluginLoader.registerBuiltinEngine(name: string, modalities: string[]): void`（内置件登记，prompt 为占位——真正的 pi 路径由 Task 10 的 `resolveMediaPrompt` 在调用点解析）
  - `MediaPluginLoader.setPackageEntries(entries: MediaPackageEntry[]): void`
  - `MediaPluginLoader.getBuiltinEngineNames(): string[]`
  - `getEngines()` 合并顺序：**builtinEngines → legacy engines → packageEngines**（后者覆盖前者同名）

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/plugins-package-media-loader.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MediaPluginLoader } from '../../src/media/media-plugin-loader';

const ENTRY = (name: string) => ({
  name,
  prompt: (async () => 'ok') as any,
  modalities: ['image'],
  source: '/pkg.js',
});

describe('MediaPluginLoader package + builtin engines', () => {
  let dir: string;
  let loader: MediaPluginLoader;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-mediapkg-')); });
  afterEach(() => { loader?.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('registerBuiltinEngine 出现在 getEngines，带 builtin 标记', async () => {
    loader = new MediaPluginLoader(dir);
    await loader.init();
    loader.registerBuiltinEngine('pi', ['image', 'video', 'audio']);
    const pi = loader.getEngines().get('pi');
    expect(pi).toBeDefined();
    expect(pi!.builtin).toBe(true);
    expect(loader.getBuiltinEngineNames()).toEqual(['pi']);
  });

  it('legacy 文件覆盖同名内置引擎', async () => {
    fs.writeFileSync(path.join(dir, 'pi.js'), `
module.exports = { name: 'pi', modalities: ['image'], engine: 'pi', fixPayload: (p) => p };
`);
    loader = new MediaPluginLoader(dir);
    await loader.init();
    loader.registerBuiltinEngine('pi', ['image', 'video', 'audio']);
    await loader.reload();
    const pi = loader.getEngines().get('pi');
    expect(pi!.builtin).toBeUndefined();
    expect(pi!.modalities).toEqual(['image']);
  });

  it('包条目覆盖同名内置与 legacy', async () => {
    fs.writeFileSync(path.join(dir, 'pi.js'), `
module.exports = { name: 'pi', modalities: ['image'], engine: 'pi', fixPayload: (p) => p };
`);
    loader = new MediaPluginLoader(dir);
    await loader.init();
    loader.registerBuiltinEngine('pi', ['image', 'video', 'audio']);
    loader.setPackageEntries([ENTRY('pi')]);
    const pi = loader.getEngines().get('pi');
    expect(pi!.source).toBe('/pkg.js');
  });

  it('scan() 不清包条目与内置；空数组清空包条目', async () => {
    loader = new MediaPluginLoader(dir);
    await loader.init();
    loader.registerBuiltinEngine('pi', ['image', 'video', 'audio']);
    loader.setPackageEntries([ENTRY('acme')]);
    await loader.scan();
    expect(loader.getEngines().has('acme')).toBe(true);
    expect(loader.getEngines().has('pi')).toBe(true);
    loader.setPackageEntries([]);
    expect(loader.getEngines().has('acme')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/plugins-package-media-loader.test.ts --runInBand`
Expected: FAIL（registerBuiltinEngine is not a function）

- [ ] **Step 3: 实现**

在 `gateway/src/media/media-plugin-loader.ts`：

```typescript
// import 区追加：
import type { MediaPackageEntry } from '../plugins/package-types';

// MediaEngine 改为：
export interface MediaEngine {
  prompt: PromptFn;
  modalities: string[];
  builtin?: boolean;
}

// 类字段区追加：
  private builtinEngines = new Map<string, MediaEngine>();
  private packageEngines = new Map<string, MediaPackageEntry>();

// 类方法区追加：
  /** 内置引擎登记（如 pi）。prompt 是占位——真正的内置路径由 resolveMediaPrompt 在调用点解析。 */
  registerBuiltinEngine(name: string, modalities: string[]): void {
    this.builtinEngines.set(name, {
      prompt: (async () => { throw new Error('builtin engine prompt is resolved at call site'); }) as PromptFn,
      modalities,
      builtin: true,
    });
  }

  getBuiltinEngineNames(): string[] {
    return [...this.builtinEngines.keys()];
  }

  /** PluginHost 推送的包贡献。同名覆盖 legacy 与内置。 */
  setPackageEntries(entries: MediaPackageEntry[]): void {
    this.packageEngines = new Map(entries.map((e) => [e.name, e]));
  }
```

`getEngines()`（现状 L139-141）改为：

```typescript
  getEngines(): Map<string, MediaEngine> {
    // 合并顺序：内置 → legacy 文件 → 包（后者覆盖前者同名）
    const merged = new Map<string, MediaEngine>(this.builtinEngines);
    for (const [name, e] of this.engines) merged.set(name, e);
    for (const [name, e] of this.packageEngines) {
      merged.set(name, { prompt: e.prompt, modalities: e.modalities, source: e.source } as MediaEngine);
    }
    return merged;
  }
```

注意 `MediaEngine` 上 `source` 不在接口里——测试断言 `pi!.source`。把 `source?: string` 加进 `MediaEngine` 接口（可选字段，兼容现有构造），上面 `as MediaEngine` 改为直接对象字面量。

- [ ] **Step 4: 跑测试确认通过 + 回归**

Run: `cd gateway; npx jest tests/unit/plugins-package-media-loader.test.ts --runInBand`
Expected: PASS（4 例）
Run: `cd gateway; npx jest tests/unit/gateway/media-plugin-loader.test.ts tests/unit/gateway/media-service.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/media/media-plugin-loader.ts gateway/tests/unit/plugins-package-media-loader.test.ts
git commit -m "feat(gateway): media loader builtin engine registry + package contributions"
```

---

### Task 6: PluginHost watch 热重载 + 子目录 watcher

**Files:**
- Modify: `gateway/src/plugins/package-host.ts`（per-package 子目录 watcher + reload 后刷新 watcher 集合）
- Test: `gateway/tests/unit/plugins-package-host.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 2 `PluginHost`。
- Produces: 不变（行为补全：改包主文件或增删包会触发 reload；`stop()` 清全部 watcher）。

- [ ] **Step 1: 追加失败测试**

在 `gateway/tests/unit/plugins-package-host.test.ts` 的 describe 内追加：

```typescript
  it('修改包文件触发热重载', async () => {
    const file = path.join(dir, 'acme.js');
    fs.writeFileSync(file, `
module.exports = { name: 'acme', usage: { name: 'acme', type: 'api', plan: 'v1', async fetch() { return null; } } };
`);
    host = mkHost(dir);
    const usage: any[] = [];
    host.bindUsage((e) => { usage.length = 0; usage.push(...e); });
    await host.init();
    fs.writeFileSync(file, `
module.exports = { name: 'acme', usage: { name: 'acme', type: 'api', plan: 'v2', async fetch() { return null; } } };
`);
    await new Promise((resolve) => setTimeout(resolve, 800)); // debounce 300ms + margin
    expect(usage[0]?.mod.plan).toBe('v2');
  }, 10000);

  it('目录包主文件变更触发重载（子目录 watcher）', async () => {
    const pkg = path.join(dir, 'big');
    fs.mkdirSync(pkg);
    fs.writeFileSync(path.join(pkg, 'index.js'), `
module.exports = { name: 'big', usage: { name: 'big', type: 'api', plan: 'v1', async fetch() { return null; } } };
`);
    host = mkHost(dir);
    const usage: any[] = [];
    host.bindUsage((e) => { usage.length = 0; usage.push(...e); });
    await host.init();
    fs.writeFileSync(path.join(pkg, 'index.js'), `
module.exports = { name: 'big', usage: { name: 'big', type: 'api', plan: 'v2', async fetch() { return null; } } };
`);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(usage[0]?.mod.plan).toBe('v2');
  }, 10000);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/plugins-package-host.test.ts --runInBand`
Expected: 第一个用例可能过（顶层 watch 覆盖单文件包），**目录包用例 FAIL**（`plan` 仍是 'v1'）

- [ ] **Step 3: 实现子目录 watcher**

`gateway/src/plugins/package-host.ts`：

```typescript
// 类字段区追加：
  private dirWatchers = new Map<string, fs.FSWatcher>();

// reload() 末尾（this.usageCb?.(usage); 之后）追加：
    this.refreshDirWatchers();

// 类方法区追加：
  /** 每个目录包一个 watcher（跨平台——不用 recursive）。reload 后按当前包集合增删。 */
  private refreshDirWatchers(): void {
    if (!this.watcher) return; // 顶层 watch 未建立（init 前手动 reload）则不建
    const wanted = new Set<string>();
    for (const name of this.state.keys()) {
      const sub = path.join(this.dir, name);
      if (fs.existsSync(sub) && fs.statSync(sub).isDirectory()) wanted.add(sub);
    }
    for (const [dir, w] of this.dirWatchers) {
      if (!wanted.has(dir)) { w.close(); this.dirWatchers.delete(dir); }
    }
    for (const dir of wanted) {
      if (this.dirWatchers.has(dir)) continue;
      try {
        const w = fs.watch(dir, () => {
          if (this.debounce) clearTimeout(this.debounce);
          this.debounce = setTimeout(() => {
            void this.reload().catch((err) => log.warn(`[PluginHost] reload error: ${err.message}`));
          }, 300);
        });
        this.dirWatchers.set(dir, w);
      } catch { /* 单个目录不可 watch → 跳过，fail-open */ }
    }
  }

// stop() 改为：
  stop(): void {
    this.watcher?.close();
    for (const w of this.dirWatchers.values()) w.close();
    this.dirWatchers.clear();
    if (this.debounce) clearTimeout(this.debounce);
  }
```

注意：`refreshDirWatchers` 里按 `state` 的 name 推子目录——目录包 `name` 来自 manifest 可能与目录名不同。改为在 `scanDescriptors` 里收集目录包子目录路径：`PackageDescriptor` 加 `pkgDir?: string`（目录包时 = 子目录绝对路径），host 存 `lastPkgDirs: string[]`，refreshDirWatchers 用它。同步更新 Task 1 类型（`pkgDir?: string` 可选，向后兼容）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway; npx jest tests/unit/plugins-package-host.test.ts --runInBand`
Expected: PASS（10 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/package-host.ts gateway/src/plugins/package-types.ts gateway/tests/unit/plugins-package-host.test.ts
git commit -m "feat(gateway): PluginHost per-package dir watchers for hot reload"
```

---

### Task 7: index.ts 接线 + hub packages 展示

**Files:**
- Modify: `gateway/src/plugins/hub.ts`（`HubDeps` 加 `getPackages?`）
- Modify: `gateway/src/routes/plugins.ts`（list 响应加 `packages` 键）
- Modify: `gateway/src/index.ts`（host 创建/初始化/bind 三处 + hub deps）
- Test: `gateway/tests/unit/plugins-routes.test.ts`（追加 packages 断言用例）

**Interfaces:**
- Consumes: Task 2 `PluginHost`（bind* 回放语义保证晚 bind 的 loader 也能拿到条目）；Task 1 `createPluginPackageContext` + `PackageContextDeps`。
- Produces:
  - `HubDeps.getPackages?: () => unknown[]`
  - `GET /api/plugins` 响应 `{ plugins, packages }`（`packages: PackageState[]`，desktop 忽略未知键，无破坏）
  - index.ts 新增字段 `private pluginHost?: PluginHost;` 与 `private usageStatsProvider?: UsageStatsProvider;`

- [ ] **Step 1: 追加失败测试（路由 packages 键）**

在 `gateway/tests/unit/plugins-routes.test.ts` 找到 list 路由用例所在 describe，追加：

```typescript
  it('list 响应携带 packages 键（缺省空数组）', async () => {
    // 复用文件内既有 mockRes/deps 模式；deps.hub 不提供 getPackages
    const res = mockRes();
    await handlePluginsList({ url: '/api/plugins' } as any, res as any, deps);
    const body = JSON.parse(res.body);
    expect(body.packages).toEqual([]);
  });

  it('list 响应透传 getPackages()', async () => {
    const res = mockRes();
    const depsWithPkgs = { hub: { ...deps.hub, getPackages: () => [{ name: 'acme', status: 'ok' }] } };
    await handlePluginsList({ url: '/api/plugins' } as any, res as any, depsWithPkgs as any);
    const body = JSON.parse(res.body);
    expect(body.packages).toEqual([{ name: 'acme', status: 'ok' }]);
  });
```

（执行时先读该测试文件，按其实际 mock 模式适配——`mockRes`/`deps` 以其现有命名为准。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/plugins-routes.test.ts --runInBand`
Expected: FAIL（body.packages 为 undefined）

- [ ] **Step 3: 实现 hub + 路由**

`gateway/src/plugins/hub.ts` `HubDeps` 接口追加：

```typescript
  /** PluginHost 包状态（GET /api/plugins 的 packages 键）。 */
  getPackages?: () => unknown[];
```

`gateway/src/routes/plugins.ts` `handlePluginsList` 改为：

```typescript
export async function handlePluginsList(_req: http.IncomingMessage, res: http.ServerResponse, deps: PluginsRouteDeps): Promise<void> {
  await guarded(res, async () => ({
    plugins: listPlugins(deps.hub),
    packages: deps.hub.getPackages?.() ?? [],
  }));
}
```

- [ ] **Step 4: index.ts 接线**

(a) import 区追加：

```typescript
import { PluginHost } from './plugins/package-host';
import { createPluginPackageContext } from './plugins/package-context';
import type { UsageStatsProvider } from './usage/plugin-context';
```

(b) 类字段区（`private mediaRuntimeExecutorRt` 附近）追加：

```typescript
  private pluginHost?: PluginHost;
  private usageStatsProvider?: UsageStatsProvider;
```

(c) runtime loader 初始化之后（现状 L396 `registerBuiltin('pi', ...)` 下一行）插入 host 创建与初始化——必须在 L408 `createRuntime()` 之前，包 runtime 才能被激活：

```typescript
    this.pluginHost = new PluginHost(
      process.env.MAFW_PLUGINS_DIR || config.resolvePath('plugins'),
      (name) => createPluginPackageContext(name, {
        getCredentials: () => this.opencodeClient?.credentials ?? undefined,
        usageStats: () => this.usageStatsProvider,
        projectDir: this.projectDir,
        gatewayPort: config.server.apiPort,
      }),
    );
    this.pluginHost.bindRuntime((entries) => this.runtimeLoader?.setPackageEntries(entries));
    await this.pluginHost.init();
```

（`this.projectDir` 以 index.ts 内实际字段名为准——执行时确认；若是局部变量则用同一来源。）

(d) media loader 初始化之后（现状 L1762 `await this.mediaPluginLoader.init();` 下一行）：

```typescript
    this.pluginHost?.bindMedia((entries) => this.mediaPluginLoader?.setPackageEntries(entries));
```

(e) usage loader 初始化处（现状 L1930-1942）：`createUsageStatsProvider(trajStore)` 的返回值存入字段 + bind：

```typescript
      const statsProvider = createUsageStatsProvider(trajStore);
      this.usageStatsProvider = statsProvider;
      const pluginLoader = new PluginLoader(pluginsDir, [], {
        builtinPluginsDir,
        disabledPlugins,
        usageStats: statsProvider,
        resolveInlineApiKey: async (providerID: string) => { /* 现状不变 */ },
      });
      await pluginLoader.init();
      this.pluginLoader = pluginLoader;
      this.pluginHost?.bindUsage((entries) => pluginLoader.setPackageEntries(entries));
```

(f) hub deps（现状 L3990-4029）`hub` 对象追加一行：

```typescript
            getPackages: () => this.pluginHost?.getState() ?? [],
```

(g) 停机清理（现状 L1696 `this.mediaPluginLoader?.stop();` 附近）追加：

```typescript
    this.pluginHost?.stop();
```

- [ ] **Step 5: 跑路由测试 + 编译 + 全量回归**

Run: `cd gateway; npx jest tests/unit/plugins-routes.test.ts --runInBand`
Expected: PASS（含新增 2 例）
Run: `cd gateway; npx tsc --noEmit`
Expected: 0 errors
Run: `cd gateway; npx jest --runInBand`
Expected: 全量 PASS

- [ ] **Step 6: Commit**

```bash
git add gateway/src/plugins/hub.ts gateway/src/routes/plugins.ts gateway/src/index.ts gateway/tests/unit/plugins-routes.test.ts
git commit -m "feat(gateway): wire PluginHost into startup + hub packages listing"
```

---

### Task 8: opencode 注册为正式内置 runtime（dogfood）

**Files:**
- Modify: `gateway/src/index.ts`（registerBuiltin opencode + createRuntime fallback 改走 loader + hub 去重）
- Test: `gateway/tests/unit/runtime-loader-builtin-precedence.test.ts`

**Interfaces:**
- Consumes: `fullCapabilities()`（contract.ts L52）；`createRuntimePluginContext(credentials)`（loader.ts L163）。
- Produces: 不变（行为变化：`runtimeLoader.getBuiltinNames()` 含 `'opencode'`；用户 legacy 文件或包可提供同名 `opencode` 覆盖内置）。

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/runtime-loader-builtin-precedence.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RuntimePluginLoader } from '../../src/runtime/loader';
import { fullCapabilities } from '../../src/runtime/contract';

describe('opencode as registered builtin', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-rtblt-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('registerBuiltin(opencode) 后 getBuiltinNames 含 opencode', async () => {
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    loader.registerBuiltin('opencode', async () => ({ name: 'opencode' }) as any, fullCapabilities(), false);
    expect(loader.getBuiltinNames()).toContain('opencode');
    expect(loader.get('opencode')!.external).toBe(false);
  });

  it('用户 legacy 文件 opencode.js 覆盖内置', async () => {
    fs.writeFileSync(path.join(dir, 'opencode.js'), `
module.exports = { name: 'opencode', capabilities: {}, async createRuntime() { return { name: 'user-opencode' }; } };
`);
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    loader.registerBuiltin('opencode', async () => ({ name: 'builtin-opencode' }) as any, fullCapabilities(), false);
    await loader.scan();
    const rt = await loader.get('opencode')!.createRuntime({} as any);
    expect(rt.name).toBe('user-opencode');
  });
});
```

- [ ] **Step 2: 跑测试确认通过与否**

Run: `cd gateway; npx jest tests/unit/runtime-loader-builtin-precedence.test.ts --runInBand`
Expected: PASS（现有 loader 语义本就支持——此测试是行为固化，若 FAIL 说明 loader 有 bug 需修）

- [ ] **Step 3: index.ts 注册 + fallback 改道 + hub 去重**

(a) import 区确认/追加 `fullCapabilities`：

```typescript
import { fullCapabilities } from './runtime/contract';
```

（若 index.ts 已有从 contract 的 import 则合并。）

(b) sdkConfig 构建完成后（现状 L407 `}` 之后、L408 `const runtime = await this.createRuntime(sdkConfig);` 之前）插入：

```typescript
    // opencode 注册为正式内置插件（与用户插件同一接口；同名文件/包可覆盖）
    const sdkSnapshot = { ...sdkConfig, headers: { ...sdkConfig.headers } };
    this.runtimeLoader.registerBuiltin(
      'opencode',
      async () => (await import('./runtime/opencode-runtime.js')).createOpencodeRuntime({
        ...sdkSnapshot,
        headers: { ...sdkSnapshot.headers },
      }),
      fullCapabilities(),
      !!process.env.MAFW_SERVER_SERVE_URL,
    );
```

(c) `createRuntime`（现状 L1022-1025）fallback 改为走 loader（保留最终安全网）：

```typescript
    const builtin = this.runtimeLoader?.get('opencode');
    if (builtin) {
      return builtin.createRuntime(createRuntimePluginContext(undefined));
    }
    const { createOpencodeRuntime } = await import('./runtime/opencode-runtime.js');
    return createOpencodeRuntime({ ...sdkConfig });
```

（`createRuntimePluginContext` 若未 import 则追加 `import { createRuntimePluginContext } from './runtime/loader';`。）

(d) hub 去重（现状 L4001 `entries.push(rt('opencode'));`）——删除该行（`getBuiltinNames()` 现在已含 opencode）。

- [ ] **Step 4: 编译 + 全量回归**

Run: `cd gateway; npx tsc --noEmit`
Expected: 0 errors
Run: `cd gateway; npx jest --runInBand`
Expected: 全量 PASS（重点：plugins-hub.test.ts 不因 opencode 条目重复/缺失而挂——若 hub 测试硬编码了 opencode 行则按新语义更新该测试）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/index.ts gateway/tests/unit/runtime-loader-builtin-precedence.test.ts
git commit -m "feat(gateway): register opencode as formal builtin runtime (dogfood plugin interface)"
```

---

### Task 9: RuntimePluginContext 补 projectDir/gatewayPort，pi 消费

**Files:**
- Modify: `gateway/src/runtime/loader.ts`（`RuntimePluginContext` 加可选字段 + `createRuntimePluginContext` 第二参数）
- Modify: `gateway/src/runtime/plugins/pi-runtime.ts`（L144/L252 改用 ctx，config 兜底）
- Modify: `gateway/src/index.ts`（createRuntime 调用点传入）
- Test: `gateway/tests/unit/plugins-runtime-context.test.ts`

**Interfaces:**
- Consumes: 无新增。
- Produces: `RuntimePluginContext { fetch, log, pluginConfig, credentials?, projectDir?: string, gatewayPort?: number }`；`createRuntimePluginContext(credentials?, extra?: { projectDir?: string; gatewayPort?: number })`。

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/plugins-runtime-context.test.ts
import { createRuntimePluginContext } from '../../src/runtime/loader';

describe('createRuntimePluginContext', () => {
  it('携带 projectDir/gatewayPort', () => {
    const ctx = createRuntimePluginContext(undefined, { projectDir: '/proj', gatewayPort: 3000 });
    expect(ctx.projectDir).toBe('/proj');
    expect(ctx.gatewayPort).toBe(3000);
  });

  it('extra 缺省时字段为 undefined（向后兼容）', () => {
    const ctx = createRuntimePluginContext();
    expect(ctx.projectDir).toBeUndefined();
    expect(ctx.gatewayPort).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/plugins-runtime-context.test.ts --runInBand`
Expected: FAIL（toBe 断言不匹配——字段不存在）

- [ ] **Step 3: 实现**

`gateway/src/runtime/loader.ts`：

```typescript
// RuntimePluginContext 接口追加两字段：
export interface RuntimePluginContext {
  /** fetch with 60s default timeout */
  fetch: (url: string, opts?: any) => Promise<Response>;
  log: typeof log;
  /** 读 config.yaml 的 runtime.pluginConfig[name] */
  pluginConfig(name: string): Record<string, any>;
  /** runtime 凭据（media/pi 认证链优先走这里） */
  credentials?: RuntimeCredentials;
  /** 当前项目目录（pi 等内置件此前直读 config.raw.paths.projectDir） */
  projectDir?: string;
  /** gateway API 端口（pi getBaseUrl 此前直读 config.server.apiPort） */
  gatewayPort?: number;
}

// createRuntimePluginContext 改为：
export function createRuntimePluginContext(
  credentials?: RuntimeCredentials,
  extra?: { projectDir?: string; gatewayPort?: number },
): RuntimePluginContext {
  return {
    fetch: (url: string, opts?: any) =>
      fetch(url, { ...opts, signal: opts?.signal ?? AbortSignal.timeout(60000) }),
    log,
    pluginConfig: (name: string) => (config.raw as any)?.runtime?.pluginConfig?.[name] ?? {},
    credentials,
    projectDir: extra?.projectDir,
    gatewayPort: extra?.gatewayPort,
  };
}
```

`gateway/src/runtime/plugins/pi-runtime.ts`：

L144（`registry.create(opts?.directory ?? config.raw.paths.projectDir, ...)`）改为：

```typescript
      const { id } = await registry.create(opts?.directory ?? ctx.projectDir ?? config.raw.paths.projectDir, { model: { provider, modelID } });
```

L252（`getBaseUrl`）改为：

```typescript
      getBaseUrl: () => `http://127.0.0.1:${ctx.gatewayPort ?? config.server.apiPort ?? 3000}`,
```

`gateway/src/index.ts` `createRuntime` 内（现状 L1012）：

```typescript
          const rt = await plugin.createRuntime(createRuntimePluginContext(creds, {
            projectDir: this.projectDir,
            gatewayPort: config.server.apiPort,
          }));
```

- [ ] **Step 4: 测试 + 编译 + 回归**

Run: `cd gateway; npx jest tests/unit/plugins-runtime-context.test.ts --runInBand`
Expected: PASS（2 例）
Run: `cd gateway; npx tsc --noEmit; npx jest tests/unit/gateway/pi-adapter.test.ts tests/unit/gateway/media-runtime-executor.test.ts --runInBand`
Expected: 0 errors / PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/loader.ts gateway/src/runtime/plugins/pi-runtime.ts gateway/src/index.ts gateway/tests/unit/plugins-runtime-context.test.ts
git commit -m "feat(gateway): runtime plugin ctx carries projectDir/gatewayPort; pi consumes ctx"
```

---

### Task 10: media resolvePrompt 提取 + `pi` 可被同名覆盖

**Files:**
- Create: `gateway/src/media/resolve-prompt.ts`
- Modify: `gateway/src/index.ts`（resolvePrompt 闭包改用提取函数 + registerBuiltinEngine('pi') + hub media 内置条目来自 loader）
- Test: `gateway/tests/unit/media-resolve-prompt.test.ts`

**Interfaces:**
- Consumes: Task 5 `MediaEngine.builtin` / `registerBuiltinEngine` / `getBuiltinEngineNames`。
- Produces: `resolveMediaPrompt(engineName: string, kind: string, deps: { engines: Map<string, MediaEngine>; builtinPi: () => PromptFn | undefined }): PromptFn | undefined`。语义：
  - `engines` 无该名 →（非 'pi' 时 warn）→ `builtinPi()`
  - 命中且 `builtin` → `builtinPi()`
  - 命中非 builtin 但 modality 不含 kind → warn → `builtinPi()`
  - 命中非 builtin → `engine.prompt`
  - `builtinPi()` 返回 undefined → 调用方（MediaService）回退默认 pi adapter（现状语义）

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/media-resolve-prompt.test.ts
import { resolveMediaPrompt } from '../../src/media/resolve-prompt';
import type { MediaEngine } from '../../src/media/media-plugin-loader';

const builtinPi = jest.fn(() => undefined);
const userPrompt = (async () => 'user') as any;

function engines(entries: Record<string, Partial<MediaEngine>>): Map<string, MediaEngine> {
  return new Map(Object.entries(entries).map(([k, v]) => [k, v as MediaEngine]));
}

describe('resolveMediaPrompt', () => {
  beforeEach(() => builtinPi.mockClear());

  it('未知引擎回退 builtinPi', () => {
    const r = resolveMediaPrompt('nope', 'image', { engines: engines({}), builtinPi });
    expect(r).toBeUndefined();
    expect(builtinPi).toHaveBeenCalled();
  });

  it('内置 pi 走 builtinPi（executor/direct 由调用点决定）', () => {
    const e = engines({ pi: { builtin: true, modalities: ['image', 'video', 'audio'], prompt: userPrompt } });
    const r = resolveMediaPrompt('pi', 'image', { engines: e, builtinPi });
    expect(r).toBeUndefined();
    expect(builtinPi).toHaveBeenCalled();
  });

  it('用户插件覆盖 pi：同名非 builtin 直接返回用户 prompt', () => {
    const e = engines({ pi: { modalities: ['image'], prompt: userPrompt } });
    const r = resolveMediaPrompt('pi', 'image', { engines: e, builtinPi });
    expect(r).toBe(userPrompt);
    expect(builtinPi).not.toHaveBeenCalled();
  });

  it('用户 pi 不支持该 modality → 回退 builtinPi', () => {
    const e = engines({ pi: { modalities: ['image'], prompt: userPrompt } });
    const r = resolveMediaPrompt('pi', 'video', { engines: e, builtinPi });
    expect(r).toBeUndefined();
    expect(builtinPi).toHaveBeenCalled();
  });

  it('普通用户引擎正常返回', () => {
    const e = engines({ 'qwen-vl': { modalities: ['image', 'video'], prompt: userPrompt } });
    expect(resolveMediaPrompt('qwen-vl', 'video', { engines: e, builtinPi })).toBe(userPrompt);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/media-resolve-prompt.test.ts --runInBand`
Expected: FAIL（Cannot find module）

- [ ] **Step 3: 实现**

```typescript
// gateway/src/media/resolve-prompt.ts
/** media 引擎解析（deps 注入可单测）。用户引擎可同名覆盖内置 pi。 */
import { log } from '../core/utils/logger';
import type { PromptFn } from './media-service';
import type { MediaEngine } from './media-plugin-loader';

export interface ResolveMediaPromptDeps {
  engines: Map<string, MediaEngine>;
  /** 内置 pi 路径：pi runtime 激活时返回 executor.prompt，否则 undefined（调用方回退默认 adapter）。 */
  builtinPi: () => PromptFn | undefined;
}

export function resolveMediaPrompt(engineName: string, kind: string, deps: ResolveMediaPromptDeps): PromptFn | undefined {
  const engine = deps.engines.get(engineName);
  if (!engine) {
    if (engineName !== 'pi') log.warn(`[MediaService] engine '${engineName}' not found, falling back to pi`);
    return deps.builtinPi();
  }
  if (engine.builtin) return deps.builtinPi();
  if (!engine.modalities.includes(kind)) {
    log.warn(`[MediaService] engine '${engineName}' does not support modality '${kind}', falling back to pi`);
    return deps.builtinPi();
  }
  return engine.prompt;
}
```

`gateway/src/index.ts`：

(a) media loader 初始化后（Task 7 的 bindMedia 行附近）注册内置 pi：

```typescript
    this.mediaPluginLoader.registerBuiltinEngine('pi', ['image', 'video', 'audio']);
```

(b) `resolvePrompt` 闭包（现状 L1771-1797）整体替换为：

```typescript
      resolvePrompt: (kind, cfg) => {
        const engineName = cfg[kind]?.engine ?? cfg.engine ?? 'pi';
        return resolveMediaPrompt(engineName, kind, {
          engines: this.mediaPluginLoader?.getEngines() ?? new Map(),
          builtinPi: () => {
            // pi runtime 激活时：图片走 AgentRuntime 会话（MediaRuntimeExecutor），
            // video/audio 由 executor 内部回退到 complete 路径
            if (this.opencodeClient?.name === 'pi') {
              // runtime 热切换后 opencodeClient 实例更换——旧 executor 持有 stale
              // runtime 引用，必须重建（dispose 尽力而为，不阻塞 prompt）。
              if (!this.mediaRuntimeExecutor || this.mediaRuntimeExecutorRt !== this.opencodeClient) {
                void this.mediaRuntimeExecutor?.dispose().catch(() => {});
                this.mediaRuntimeExecutor = createMediaRuntimeExecutor(this.opencodeClient);
                this.mediaRuntimeExecutorRt = this.opencodeClient;
              }
              return this.mediaRuntimeExecutor.prompt;
            }
            return undefined;
          },
        });
      },
```

（import 区追加 `import { resolveMediaPrompt } from './media/resolve-prompt';`）

(c) hub 内置条目（现状 L4003 `entries.push({ type: 'media', name: 'pi', ... })`）替换为：

```typescript
              for (const name of this.mediaPluginLoader?.getBuiltinEngineNames?.() ?? []) {
                entries.push({ type: 'media', name, file: '(builtin)', status: 'enabled', size: 0, mtime: '' });
              }
```

- [ ] **Step 4: 测试 + 编译 + 回归**

Run: `cd gateway; npx jest tests/unit/media-resolve-prompt.test.ts --runInBand`
Expected: PASS（5 例）
Run: `cd gateway; npx tsc --noEmit; npx jest tests/unit/gateway/media-service.test.ts tests/unit/gateway/media-agent.test.ts tests/unit/plugins-hub.test.ts --runInBand`
Expected: 0 errors / PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/media/resolve-prompt.ts gateway/src/index.ts gateway/tests/unit/media-resolve-prompt.test.ts
git commit -m "feat(gateway): extract media prompt resolution; user engines can override builtin pi"
```

---

### Task 11: 文档（AGENTS.md）+ 交付核对

**Files:**
- Modify: `AGENTS.md`（§5.14a 插件中心段 + §5.19 runtime 插件段）

**Interfaces:**
- Consumes: Task 1-10 全部。
- Produces: 文档与实际行为一致。

- [ ] **Step 1: 更新 AGENTS.md**

在 §5.14a「插件中心全量清单」段落后追加新小节（并修订该段中"安装为 raw octet-stream"描述以提及包形态）：

```markdown
#### 5.14b 统一插件包（Unified Plugin Packages，2026-09-16）

`~/.mafw/plugins/` 一个插件包可同时贡献多种能力（usage 配额 / media 引擎 / runtime；
uiTools v1 仅登记展示，桌面侧加载仍走 `~/.mafw/ui-plugins/`）：

- 单文件包 `name.js` 或目录包 `name/plugin.json`（`{name, version?, main?}`，main 缺省 index.js）
- 模块形状：声明式 `{ name, usage?, media?, runtime?, uiTools? }` 或 `async activate(ctx) → contributions`
- 统一 ctx = 三个 legacy ctx 超集：apiKey/fetch(60s)/log/pluginConfig（读 `plugins.<name>.config`，
  回退 legacy 三段）/projectDir/gatewayPort/usage.modelStats
- **优先级（同名）：包 > legacy 目录文件 > 内置**；legacy 四目录行为不变
- PluginHost（`gateway/src/plugins/package-host.ts`）：扫描/激活/跨面原子 reload
  （先全部激活再一次性推各 loader 的 `setPackageEntries`）+ 顶层与每包子目录双 watcher
- 内置件与用户插件同一接口（dogfood）：opencode 经 `registerBuiltin('opencode', …)` 注册
  （index.ts，可被同名覆盖）；media `pi` 经 `registerBuiltinEngine('pi', …)` 注册，
  `resolveMediaPrompt`（`media/resolve-prompt.ts`）先查 engines map，非 builtin 同名直接生效
- hub：`GET /api/plugins` 响应含 `packages` 键（PackageState[]）
- 环境变量 `MAFW_PLUGINS_DIR` 覆盖包目录（测试用）
- 限制：reload 只清主文件 require.cache（改包内 lib/ 需 `mafw restart`）
```

同时修订 §5.19「Runtime 能力契约」段的 loader 描述：`RuntimePluginContext` 字段清单补 `projectDir?` / `gatewayPort?`。

- [ ] **Step 2: 全量回归 + 测试计数**

Run: `cd gateway; npx jest --runInBand`
Expected: 全量 PASS。记录：新增测试数（Task 1: 5 + Task 2/6: 10 + Task 3: 5 + Task 4: 4 + Task 5: 4 + Task 7: 2 + Task 8: 2 + Task 9: 2 + Task 10: 5 = 39 例）与全量通过数。

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: unified plugin packages + builtin dogfooding in AGENTS.md"
```

---

## Self-Review 记录

- **Spec 覆盖**：统一包模型（Task 1/2/6/7）✓；三 loader 接入（Task 3/4/5）✓；内置同接口（Task 8 opencode、Task 10 media pi、usage 已达标）✓；ctx 缺口 projectDir/gatewayPort（Task 9）✓；文档（Task 11）✓。显式排除：UI 工具卡激活（desktop 进程，需 HTTP 传输，后续单独立项）；usage 内置件迁移为包形态（已是同接口 JS 文件，无必要）。
- **类型一致性**：`RuntimePackageEntry`/`UsagePackageEntry`/`MediaPackageEntry` 在 Task 1 定义，Task 3/4/5 消费一致；`MediaEngine.builtin`/`source` 在 Task 5 定义，Task 10 消费一致；`setPackageEntries` 三处签名与 host 推送类型一致。
- **风险点**：①index.ts 的 `this.projectDir` 字段名需执行时核实（Task 7 Step 4c 已标注）；②hub 测试可能对 opencode/pi 内置行有硬编码断言（Task 8/10 回归步骤已标注按新语义更新）；③`getState()` 浅拷贝污染问题已在 Task 4 Step 3 显式处理。
