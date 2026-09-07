# Usage 插件工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Config → Usage 页重构为 provider 卡片 + 右侧抽屉：配置全收进卡片，4 种模板向导生成插件，自定义插件用内置代码编辑器。

**Architecture:** Gateway 端点制——`PluginLoader` 透传 configSchema/disabled 状态；新路由模块 `routes/usage-plugins.ts`（deps 注入可单测）提供 list/create/source/test/delete；模板系统 `usage/templates.ts` 纯函数 render 生成 `.js` 到 `~/.mafw/usage-plugins/`（watcher 自动热加载）。Desktop 新组件 `UsageProviders.tsx` 合并"JS 插件 + 本地统计 provider"为卡片网格，点开抽屉编辑（configSchema 表单 / 代码编辑器 / 预算限额 cookie）。

**Tech Stack:** Gateway TS (CJS, jest+ts-jest 真实 HTTP 测试模式)、SolidJS + `@opencode-ai/ui/v2`、gateway-sdk client + preload IPC。

**Spec:** `docs/superpowers/specs/2026-09-03-usage-plugin-ui-design.md`

## Global Constraints

- `config.yaml` usage 段 schema 不变（limits/budgets/cookies/pluginConfig/disabledPlugins）
- Desktop UI 组件约定（§5.10）：禁止裸 `<button>`/`<input>`/裸 `title`；用 ButtonV2/TextInputV2/SwitchV2/TooltipV2/LoaderV2/ToastV2
- Gateway 代码风格（opencode-dev AGENTS）：无 `else`（早返回）、无解构、`const` 优先、import 不别名、注释只写非显然约束
- name 白名单：`/^[a-z0-9][a-z0-9-]{0,63}$/`；文件写入限定 `~/.mafw/usage-plugins/`
- 插件目录（运行时）：`path.join(os.homedir(), '.mafw', 'usage-plugins')`；builtin 目录 `gateway/dist/usage/builtin-plugins/`（源码 `gateway/src/usage/builtin-plugins/`）
- 测试：gateway 用 `cd gateway && npx jest tests/unit/<file> --runInBand`；desktop 无测试 runner，验证 = `npm run typecheck`（tsgo -b）
- 路由注册顺序：`/api/usage/plugins/create|reload` 等具体路径必须先于 `/:name` 泛匹配

---

### Task 1: configSchema 校验 + PluginLoader 透传

**Files:**
- Modify: `gateway/src/usage/plugin-loader.ts`
- Test: `gateway/tests/unit/usage-plugin-schema.test.ts`

**Interfaces:**
- Produces: `validateConfigSchema(raw: unknown): ConfigSchemaField[] | undefined`（导出自 plugin-loader.ts）；`PluginState.configSchema?: ConfigSchemaField[]`；`interface ConfigSchemaField { key: string; label: string; type: 'number'|'string'|'boolean'|'select'; options?: string[]; default?: string|number|boolean }`

- [ ] **Step 1: 写失败测试**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginLoader, validateConfigSchema } from '../../src/usage/plugin-loader';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-usage-plugins-'));
}

describe('validateConfigSchema', () => {
  it('passes a valid schema', () => {
    const s = [{ key: 'endpoint', label: 'URL', type: 'string' }, { key: 'retries', label: '重试', type: 'number', default: 1 }];
    expect(validateConfigSchema(s)).toHaveLength(2);
  });
  it('rejects non-array/empty/bad fields', () => {
    expect(validateConfigSchema(undefined)).toBeUndefined();
    expect(validateConfigSchema([])).toBeUndefined();
    expect(validateConfigSchema([{ key: 'a b', label: 'x', type: 'string' }])).toBeUndefined();
    expect(validateConfigSchema([{ key: 'a', label: 'x', type: 'select' }])).toBeUndefined();
    expect(validateConfigSchema([{ key: 'a', label: 3, type: 'string' }])).toBeUndefined();
  });
});

describe('PluginLoader configSchema passthrough', () => {
  afterEach(() => { fs.rmSync(tmpName(), { recursive: true, force: true }); });
  function tmpName() { return tmpDirHolder.d; }
  const tmpDirHolder = { d: '' };

  it('exposes configSchema in state', async () => {
    const dir = tmpDir(); tmpDirHolder.d = dir;
    fs.writeFileSync(path.join(dir, 'p.js'), `module.exports = { name: 'p', fetch: async () => null, configSchema: [{ key: 'endpoint', label: 'URL', type: 'string' }] };`);
    fs.writeFileSync(path.join(dir, 'bad.js'), `module.exports = { name: 'bad', fetch: async () => null, configSchema: 'nope' };`);
    const loader = new PluginLoader(dir, []);
    await loader.init();
    const state = loader.getState();
    expect(state.find(s => s.name === 'p')?.configSchema).toHaveLength(1);
    expect(state.find(s => s.name === 'bad')?.configSchema).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/usage-plugin-schema.test.ts --runInBand`
Expected: FAIL — `validateConfigSchema` 未导出

- [ ] **Step 3: 实现**

plugin-loader.ts 顶部类型区新增：

```ts
export interface ConfigSchemaField {
  key: string;
  label: string;
  type: 'number' | 'string' | 'boolean' | 'select';
  options?: string[];
  default?: string | number | boolean;
}

const SCHEMA_TYPES = new Set(['number', 'string', 'boolean', 'select']);

/** Fail-open: anything malformed → undefined (plugin still loads, no form UI). */
export function validateConfigSchema(raw: unknown): ConfigSchemaField[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ConfigSchemaField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return undefined;
    const f = item as Record<string, unknown>;
    if (typeof f.key !== 'string' || !/^[a-zA-Z0-9_]+$/.test(f.key)) return undefined;
    if (typeof f.label !== 'string' || typeof f.type !== 'string' || !SCHEMA_TYPES.has(f.type)) return undefined;
    if (f.type === 'select' && (!Array.isArray(f.options) || f.options.length === 0 || f.options.some(o => typeof o !== 'string'))) return undefined;
    const field: ConfigSchemaField = { key: f.key, label: f.label, type: f.type as ConfigSchemaField['type'] };
    if (Array.isArray(f.options)) field.options = f.options as string[];
    if (f.default !== undefined) field.default = f.default as string | number | boolean;
    out.push(field);
  }
  return out;
}
```

`PluginState` 接口加一行：`configSchema?: ConfigSchemaField[];`
scan() 的 ok 分支改为：

```ts
const configSchema = validateConfigSchema((entry.mod as any).configSchema);
this.state.set(entry.file, { file: entry.file, name, status: 'ok', overridden, builtin: entry.builtin, adapter, configSchema });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway; npx jest tests/unit/usage-plugin-schema.test.ts --runInBand`
Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/usage/plugin-loader.ts gateway/tests/unit/usage-plugin-schema.test.ts
git commit -m "feat(usage): configSchema validation and PluginLoader passthrough"
```

---

### Task 2: PluginLoader disabled 状态化 + isBuiltinName

**Files:**
- Modify: `gateway/src/usage/plugin-loader.ts`
- Test: `gateway/tests/unit/usage-plugin-disabled.test.ts`

**Interfaces:**
- Produces: `PluginState.disabled: boolean`；`PluginLoader.isBuiltinName(name: string): boolean`；`getAdapters()` 排除 disabled

- [ ] **Step 1: 写失败测试**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginLoader } from '../../src/usage/plugin-loader';

describe('PluginLoader disabled semantics', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-usage-disabled-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('keeps disabled plugins in state but out of adapters', async () => {
    fs.writeFileSync(path.join(dir, 'a.js'), `module.exports = { name: 'a', fetch: async () => null };`);
    fs.writeFileSync(path.join(dir, 'b.js'), `module.exports = { name: 'b', fetch: async () => null };`);
    const loader = new PluginLoader(dir, [], { disabledPlugins: ['a'] });
    await loader.init();
    const a = loader.getState().find(s => s.name === 'a');
    expect(a?.disabled).toBe(true);
    expect(loader.getState().find(s => s.name === 'b')?.disabled).toBe(false);
    expect(loader.getAdapters().map(x => x.name)).toEqual(['b']);
  });

  it('isBuiltinName reflects declared builtin names', async () => {
    const loader = new PluginLoader(dir, ['deepseek']);
    await loader.init();
    expect(loader.isBuiltinName('deepseek')).toBe(true);
    expect(loader.isBuiltinName('nope')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/usage-plugin-disabled.test.ts --runInBand`
Expected: FAIL — `disabled` undefined / `isBuiltinName` 不存在

- [ ] **Step 3: 实现**

`PluginState` 加 `disabled: boolean;`。scan() 中：

```ts
// 原：if (this.disabledPlugins.has(name)) continue;
const disabled = this.disabledPlugins.has(name);
```

ok 分支 state.set 追加 `disabled`；error 分支 state.set 追加 `disabled: false`。
getAdapters() 改为：

```ts
if (s.status === 'ok' && s.adapter && !s.disabled) adapters.push(s.adapter);
```

类内新增：

```ts
isBuiltinName(name: string): boolean {
  return this.builtinNames.has(name);
}
```

- [ ] **Step 4: 跑测试确认通过 + 既有回归**

Run: `cd gateway; npx jest tests/unit/usage-plugin --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/usage/plugin-loader.ts gateway/tests/unit/usage-plugin-disabled.test.ts
git commit -m "feat(usage): expose disabled plugins in loader state; add isBuiltinName"
```

---

### Task 3: 模板系统 usage/templates.ts

**Files:**
- Create: `gateway/src/usage/templates.ts`
- Test: `gateway/tests/unit/usage-templates.test.ts`

**Interfaces:**
- Produces:
  - `interface TemplateField { key: string; label: string; type: 'string'|'number'|'boolean'|'select'|'textarea'; required?: boolean; options?: string[]; placeholder?: string; hint?: string }`
  - `interface TemplateRenderCtx { readBuiltinSource(name: string): string | null }`
  - `renderTemplate(id: string, values: Record<string, any>, ctx: TemplateRenderCtx): { ok: true; content: string; name: string } | { ok: false; error: string }`
  - `USAGE_TEMPLATES: { id: string; label: string; description: string; fields: TemplateField[] }[]`（列表给向导；clone-builtin 的 sourceName options 运行时由 UI 填 builtin 名单）

- [ ] **Step 1: 写失败测试**

```ts
import { USAGE_TEMPLATES, renderTemplate } from '../../src/usage/templates';

describe('usage templates', () => {
  it('lists four templates with unique ids', () => {
    const ids = USAGE_TEMPLATES.map(t => t.id);
    expect(ids).toEqual(['balance-api', 'token-plan', 'clone-builtin', 'blank']);
  });

  it('balance-api renders syntactic js embedding values', () => {
    const r = renderTemplate('balance-api', {
      name: 'my-gw', displayName: '我的网关', authMode: 'authKey', authName: 'my-gw',
      endpoint: 'https://x/api/balance', usedPath: 'data.used', limitPath: 'data.limit', remainingPath: 'data.remain',
    }, { readBuiltinSource: () => null });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(() => new Function(r.content)).not.toThrow();
      expect(r.content).toContain('"my-gw"');
      expect(r.content).toContain('configSchema');
    }
  });

  it('balance-api requires name and endpoint', () => {
    const r = renderTemplate('balance-api', { name: '', endpoint: '' }, { readBuiltinSource: () => null });
    expect(r.ok).toBe(false);
  });

  it('token-plan renders pct windows mapping', () => {
    const r = renderTemplate('token-plan', {
      name: 'plan-x', authMode: 'none', endpoint: 'https://x/u', listPath: 'items',
      windowField: 'window', pctField: 'pct', usedField: '', limitField: '', resetAtField: 'resetAt',
    }, { readBuiltinSource: () => null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(() => new Function(r.content)).not.toThrow();
  });

  it('clone-builtin copies builtin source verbatim with header', () => {
    const r = renderTemplate('clone-builtin', { sourceName: 'deepseek', name: 'deepseek' },
      { readBuiltinSource: (n) => (n === 'deepseek' ? 'module.exports = { name: "deepseek", fetch: async () => null };' : null) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toContain('Cloned from builtin');
  });

  it('clone-builtin fails on unknown source', () => {
    const r = renderTemplate('clone-builtin', { sourceName: 'zzz', name: 'zzz' }, { readBuiltinSource: () => null });
    expect(r.ok).toBe(false);
  });

  it('blank renders skeleton with name', () => {
    const r = renderTemplate('blank', { name: 'custom-x' }, { readBuiltinSource: () => null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toContain('"custom-x"');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/usage-templates.test.ts --runInBand`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 templates.ts**

要点（完整文件较长，关键结构）：

```ts
export interface TemplateField { key: string; label: string; type: 'string' | 'number' | 'boolean' | 'select' | 'textarea'; required?: boolean; options?: string[]; placeholder?: string; hint?: string }

export interface TemplateRenderCtx { readBuiltinSource(name: string): string | null }

type RenderResult = { ok: true; content: string; name: string } | { ok: false; error: string };

const AUTH_FIELDS: TemplateField[] = [
  { key: 'authMode', label: '认证方式', type: 'select', required: true, options: ['none', 'authKey', 'cookie', 'header'] },
  { key: 'authName', label: '认证名（auth provider 或 cookie 名）', type: 'string' },
  { key: 'headerName', label: '自定义 header 名', type: 'string', hint: 'authMode=header 时使用，值存 pluginConfig.<name>.headerValue' },
];

function jsValue(v: unknown): string { return JSON.stringify(v ?? null); }

function pickFn(): string {
  return [
    'function pick(obj, path) {',
    '  if (!path) return undefined;',
    '  return path.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);',
    '}',
  ].join('\n');
}
```

balance-api render（生成物含 configSchema，之后参数走表单）：

```ts
function renderBalanceApi(v: Record<string, any>): string {
  const name = v.name;
  const schema = [
    { key: 'endpoint', label: 'Endpoint URL', type: 'string', default: v.endpoint },
    { key: 'usedPath', label: 'used 字段路径', type: 'string', default: v.usedPath },
    { key: 'limitPath', label: 'limit 字段路径', type: 'string', default: v.limitPath },
    { key: 'remainingPath', label: 'remaining 字段路径', type: 'string', default: v.remainingPath },
  ];
  return [
    `// Generated by MAFW usage template 'balance-api' — params editable via Config → Usage（usage.pluginConfig）`,
    `const CFG = ${jsValue({ ...v })};`,
    `const SCHEMA = ${jsValue(schema)};`,
    pickFn(),
    `async function main(ctx) {`,
    `  const pc = ctx.pluginConfig(CFG.name) || {};`,
    `  const cfg = { ...CFG, ...pc };`,
    `  const headers = {};`,
    `  if (cfg.authMode === 'authKey') {`,
    `    const key = ctx.apiKey(cfg.authName);`,
    `    if (!key) return null;`,
    `    headers.Authorization = 'Bearer ' + key;`,
    `  } else if (cfg.authMode === 'cookie') {`,
    `    const cookie = ctx.cookie(cfg.authName);`,
    `    if (!cookie) return null;`,
    `    headers.Cookie = cookie;`,
    `  } else if (cfg.authMode === 'header') {`,
    `    headers[cfg.headerName || 'X-Api-Key'] = pc.headerValue || '';`,
    `  }`,
    `  const res = await ctx.fetch(cfg.endpoint, { headers });`,
    `  if (!res.ok) { ctx.log.warn('[' + CFG.name + '] HTTP ' + res.status); return null; }`,
    `  const data = await res.json();`,
    `  const used = pick(data, cfg.usedPath);`,
    `  const limit = pick(data, cfg.limitPath);`,
    `  const remaining = pick(data, cfg.remainingPath);`,
    `  if (limit === undefined && remaining === undefined) return null;`,
    `  const u = Number(used !== undefined ? used : (limit !== undefined && remaining !== undefined ? limit - remaining : 0));`,
    `  const l = Number(limit !== undefined ? limit : u + Number(remaining || 0));`,
    `  if (!isFinite(u) || !isFinite(l) || l <= 0) return null;`,
    `  return { name: CFG.name, type: 'api', plan: CFG.displayName, windows: [{ window: 'balance', used: u, limit: l, unit: '$', pct: Math.min(100, Math.round((u / l) * 100)), remaining }] };`,
    `}`,
    `module.exports = { name: ${jsValue(name)}, type: 'api', plan: ${jsValue(v.displayName || name)}, configSchema: SCHEMA, fetch: (ctx) => main(ctx) };`,
  ].join('\n');
}
```

token-plan render：同骨架，fetch 把 `pick(data, cfg.listPath)` 数组 map 成 windows（`{ window: it[cfg.windowField], pct: Number(it[cfg.pctField]), used/limit/resetAt 可选 }`，仅 pct 时 `unit: 'pct'`）；schema 覆盖 endpoint/listPath/各字段路径。

clone-builtin：

```ts
const src = ctx.readBuiltinSource(v.sourceName);
if (!src) return { ok: false, error: `builtin plugin '${v.sourceName}' not found` };
const content = `// Cloned from builtin '${v.sourceName}' by MAFW — edit freely (overrides the builtin).\n${src}`;
```

blank：README 示例骨架 + configSchema 注释。必填校验：`name` 全模板必填；balance-api 另需 `endpoint`；缺 → `{ ok: false, error }`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway; npx jest tests/unit/usage-templates.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/usage/templates.ts gateway/tests/unit/usage-templates.test.ts
git commit -m "feat(usage): plugin templates (balance-api/token-plan/clone-builtin/blank)"
```

---

### Task 4: 路由模块 routes/usage-plugins.ts

**Files:**
- Create: `gateway/src/routes/usage-plugins.ts`
- Test: `gateway/tests/unit/usage-plugins-route.test.ts`

**Interfaces:**
- Consumes: Task 1/2 的 `PluginState/configSchema/disabled/isBuiltinName`、Task 3 的 `renderTemplate/USAGE_TEMPLATES`、`PluginLoader`、`ExternalAdapter`（types.ts）
- Produces（index.ts 接线用）:
  - `interface UsagePluginsDeps { loader: { getState(): PluginState[]; getAdapters(): ExternalAdapter[]; reload(): Promise<void>; isBuiltinName(n: string): boolean }; pluginsDir: string; getDisabled(): string[]; getPluginConfig(name: string): any; readBuiltinSource(name: string): string | null; runAdapter(name: string): Promise<{ ok: boolean; result?: unknown; error?: string }>; builtinNames(): string[] }`
  - `handleUsagePluginsList(req, res, deps)` — GET list（含 `templates`、`builtins`）
  - `handleUsagePluginCreate(req, res, deps)` — POST create
  - `handleUsagePluginSourceGet(req, res, deps, name)` / `handleUsagePluginSourcePut(req, res, deps, name)` / `handleUsagePluginDelete(req, res, deps, name)` / `handleUsagePluginTest(req, res, deps, name)`

- [ ] **Step 1: 写失败测试**（真实 HTTP server 模式，同 model-config.test.ts）

```ts
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as httpServ from 'http';
import { PluginLoader } from '../../src/usage/plugin-loader';
import { handleUsagePluginCreate, handleUsagePluginDelete, handleUsagePluginsList, handleUsagePluginSourceGet, handleUsagePluginSourcePut, handleUsagePluginTest, UsagePluginsDeps } from '../../src/routes/usage-plugins';

function makeDeps(overrides: any = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-usage-route-'));
  const builtinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-usage-builtin-'));
  fs.writeFileSync(path.join(builtinDir, 'deepseek.js'), `module.exports = { name: 'deepseek', fetch: async () => null };`);
  const loader = new PluginLoader(dir, [], { builtinPluginsDir: builtinDir });
  const disabled: string[] = [];
  const pluginConfig: Record<string, any> = { deepseek: { apiKey: 'k' } };
  const deps: UsagePluginsDeps = {
    loader: loader as any,
    pluginsDir: dir,
    getDisabled: () => disabled,
    getPluginConfig: (n) => pluginConfig[n] ?? null,
    readBuiltinSource: (n) => (n === 'deepseek' ? `module.exports = { name: 'deepseek', fetch: async () => null };` : null),
    runAdapter: async (n) => ({ ok: true, result: { name: n, windows: [] } }),
    builtinNames: () => ['deepseek'],
    ...overrides,
  };
  return { deps, dir, builtinDir, loader, pluginConfig, disabled };
}

function createServer(deps: UsagePluginsDeps, loader: PluginLoader): http.Server {
  return httpServ.createServer(async (req, res) => {
    const u = req.url || '';
    let m: RegExpMatchArray | null;
    if (u.match(/^\/api\/usage\/plugins(?:\?|$)/) && req.method === 'GET') { await handleUsagePluginsList(req, res, deps); return; }
    if (u.match(/^\/api\/usage\/plugins\/create$/) && req.method === 'POST') { await handleUsagePluginCreate(req, res, deps); return; }
    if ((m = u.match(/^\/api\/usage\/plugins\/([^/]+)\/source$/)) && req.method === 'GET') { await handleUsagePluginSourceGet(req, res, deps, decodeURIComponent(m[1])); return; }
    if ((m = u.match(/^\/api\/usage\/plugins\/([^/]+)\/source$/)) && req.method === 'PUT') { await handleUsagePluginSourcePut(req, res, deps, decodeURIComponent(m[1])); return; }
    if ((m = u.match(/^\/api\/usage\/plugins\/([^/]+)\/test$/)) && req.method === 'POST') { await handleUsagePluginTest(req, res, deps, decodeURIComponent(m[1])); return; }
    if ((m = u.match(/^\/api\/usage\/plugins\/([^/]+)$/)) && req.method === 'DELETE') { await handleUsagePluginDelete(req, res, deps, decodeURIComponent(m[1])); return; }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  });
}

async function request(server: http.Server, method: string, p: string, body?: any): Promise<{ status: number; body: any }> { /* 同 model-config.test.ts 的 request()，path 用 p */ }
```

用例：

```ts
describe('usage plugins routes', () => {
  it('create from template writes file and reloads', ...)
  // POST create {template:'balance-api', values:{name:'my-gw', endpoint:'https://x', usedPath:'u', limitPath:'l'}}
  // → 200 {ok:true, name:'my-gw'}；fs.existsSync(dir/my-gw.js)；list 里 origin='user'、configSchema 长度>0、config=null
  it('create rejects bad name / duplicate / builtin name', ...)
  // name 'X Y' → 400；重复创建同名 → 409；name 'deepseek' → 409
  it('list enriches origin/configSchema/config/disabled + templates+builtins', ...)
  // 放一个用户文件 + disabled=['x'] → origin/origin='builtin'（builtin 目录文件）、config 来自 pluginConfig、templates 长度 4
  it('source get/put/delete only for user files', ...)
  // GET source my-gw → 200 {source}; PUT {source:'module.exports={name:"my-gw",fetch:async()=>null}'} → 200；GET source deepseek → 403 {builtin:true}；DELETE deepseek → 403；DELETE my-gw → 200 且文件消失
  it('source put rejects syntax errors', ...)
  // PUT source:'module.exports = {' → 400
  it('test returns adapter result', ...)
  // POST test my-gw → 200 {ok:true,...}
});
```

afterEach 清理 tmp 目录。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/usage-plugins-route.test.ts --runInBand`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 routes/usage-plugins.ts**

结构（完整实现按 Task 3/依赖接口展开）：

```ts
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { log } from '../core/utils/logger';
import type { ExternalAdapter, PluginState } from '../usage/types'; // PluginState 实际在 plugin-loader.ts
import { PluginState } from '../usage/plugin-loader';
import { USAGE_TEMPLATES, renderTemplate } from '../usage/templates';

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface UsagePluginsDeps { /* 如上 Interfaces */ }

function json(res: http.ServerResponse, status: number, payload: any): void { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); }

function readBody(req: http.IncomingMessage): Promise<string> { /* 同 model-config.ts */ }

function originOf(deps: UsagePluginsDeps, s: PluginState): 'builtin' | 'override' | 'user' {
  if (s.builtin) return 'builtin';
  if (s.name && deps.isBuiltinName(s.name)) return 'override';
  return 'user';
}

function safeUserPath(deps: UsagePluginsDeps, name: string): string | null {
  if (!NAME_RE.test(name)) return null;
  const root = path.resolve(deps.pluginsDir);
  const p = path.join(root, name + '.js');
  return p.startsWith(root + path.sep) ? p : null;
}

function syntaxCheck(source: string): string | null {
  try { new Function(source); return null; } catch (err: any) { return err.message; }
}

function pluginSummary(deps: UsagePluginsDeps): any[] {
  return deps.loader.getState().map(s => ({
    file: s.file, name: s.name, status: s.status, error: s.error,
    disabled: s.disabled, origin: originOf(deps, s), configSchema: s.configSchema,
    config: s.name ? deps.getPluginConfig(s.name) : null,
  }));
}

export async function handleUsagePluginsList(req, res, deps) {
  json(res, 200, { plugins: pluginSummary(deps), templates: USAGE_TEMPLATES, builtins: deps.builtinNames() });
}

export async function handleUsagePluginCreate(req, res, deps) {
  const body = JSON.parse(await readBody(req)).catch? — 用 try/catch（400 on parse error）;
  const values = body?.values ?? {};
  let name: string | undefined = body?.name ?? values.name;
  let content: string | undefined;
  if (body?.template) {
    if (body.template === 'clone-builtin' && !name) name = values.sourceName;
    const rendered = renderTemplate(body.template, { ...values, name }, { readBuiltinSource: deps.readBuiltinSource });
    if (!rendered.ok) { json(res, 400, { error: rendered.error }); return; }
    name = rendered.name; content = rendered.content;
    // clone-builtin 允许 builtin 名（=override）；其余模板拒绝
    if (body.template !== 'clone-builtin' && deps.isBuiltinName(name!)) { json(res, 409, { error: 'name collides with a builtin plugin' }); return; }
  } else if (typeof body?.source === 'string' && name) {
    if (deps.isBuiltinName(name)) { json(res, 409, { error: 'name collides with a builtin plugin' }); return; }
    const err = syntaxCheck(body.source);
    if (err) { json(res, 400, { error: `syntax error: ${err}` }); return; }
    content = body.source;
  } else { json(res, 400, { error: 'template+values or name+source required' }); return; }

  if (!name || !NAME_RE.test(name)) { json(res, 400, { error: 'invalid name' }); return; }
  const target = safeUserPath(deps, name);
  if (!target) { json(res, 400, { error: 'invalid name' }); return; }
  if (fs.existsSync(target)) { json(res, 409, { error: 'plugin file already exists' }); return; }
  try { fs.writeFileSync(target, content!); } catch (err: any) { json(res, 500, { error: err.message }); return; }
  await deps.loader.reload();
  json(res, 200, { ok: true, name, plugins: pluginSummary(deps) });
}
```

sourceGet：user 文件存在 → `{ source, origin: isBuiltinName ? 'override' : 'user' }`；否则 builtin 名 → 403 `{ builtin: true }`；否则 404。
sourcePut：user 文件必须已存在（builtin → 403 提示先 clone）；语法校验 → 写盘 → reload。
delete：user 文件 unlink → reload；builtin → 403；不存在 → 404。
test：`deps.runAdapter(name)` 结果直出（runAdapter 404 情形在 index 接线里处理）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway; npx jest tests/unit/usage-plugins-route.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/usage-plugins.ts gateway/tests/unit/usage-plugins-route.test.ts
git commit -m "feat(usage): plugin management routes (list/create/source/test/delete)"
```

---

### Task 5: index.ts 接线

**Files:**
- Modify: `gateway/src/index.ts`（替换 ~4144-4171 的 usage plugins 路由块）

**Interfaces:**
- Consumes: Task 4 全部 handler + `UsagePluginsDeps`

- [ ] **Step 1: 接线**

顶部 import 区加：`import { handleUsagePluginCreate, handleUsagePluginDelete, handleUsagePluginsList, handleUsagePluginSourceGet, handleUsagePluginSourcePut, handleUsagePluginTest } from './routes/usage-plugins';`
（沿用文件现有 import 风格——若该文件对 routes/* 用 require，则用 require。）

类内新增方法：

```ts
private usagePluginsDeps(): UsagePluginsDeps {
  return {
    loader: this.pluginLoader!,
    pluginsDir: path.join(os.homedir(), '.mafw', 'usage-plugins'),
    getDisabled: () => (Array.isArray(config.usage?.disabledPlugins) ? config.usage.disabledPlugins : []),
    getPluginConfig: (name) => config.usage?.pluginConfig?.[name] ?? null,
    readBuiltinSource: (name) => {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) return null;
      const p = path.join(__dirname, 'usage', 'builtin-plugins', name + '.js');
      try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
    },
    runAdapter: async (name) => {
      const adapter = this.pluginLoader?.getAdapters().find(a => a.name === name);
      if (!adapter) return { ok: false, error: 'plugin not found or disabled' };
      try { return { ok: true, result: await adapter.fetch() }; } catch (err: any) { return { ok: false, error: err.message }; }
    },
    builtinNames: () => fs.existsSync(path.join(__dirname, 'usage', 'builtin-plugins'))
      ? fs.readdirSync(path.join(__dirname, 'usage', 'builtin-plugins')).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, ''))
      : [],
  };
}
```

替换原 GET `/api/usage/plugins` 块为：

```ts
if (req.url?.match(/^\/api\/usage\/plugins(?:\?|$)/) && req.method === 'GET') {
  await handleUsagePluginsList(req, res, this.usagePluginsDeps());
  return;
}
if (req.url?.match(/^\/api\/usage\/plugins\/create$/) && req.method === 'POST') {
  await handleUsagePluginCreate(req, res, this.usagePluginsDeps());
  return;
}
if (req.url?.match(/^\/api\/usage\/plugins\/([^/]+)\/source$/) && req.method === 'GET') {
  await handleUsagePluginSourceGet(req, res, this.usagePluginsDeps(), decodeURIComponent(RegExp.$1));
  return;
}
if (req.url?.match(/^\/api\/usage\/plugins\/([^/]+)\/source$/) && req.method === 'PUT') {
  await handleUsagePluginSourcePut(req, res, this.usagePluginsDeps(), decodeURIComponent(RegExp.$1));
  return;
}
if (req.url?.match(/^\/api\/usage\/plugins\/([^/]+)\/test$/) && req.method === 'POST') {
  await handleUsagePluginTest(req, res, this.usagePluginsDeps(), decodeURIComponent(RegExp.$1));
  return;
}
if (req.url?.match(/^\/api\/usage\/plugins\/([^/]+)$/) && req.method === 'DELETE') {
  await handleUsagePluginDelete(req, res, this.usagePluginsDeps(), decodeURIComponent(RegExp.$1));
  return;
}
```

保留原 `POST /api/usage/plugins/reload` 块（位置必须在 `:name` DELETE 之前无关——方法不同；但要在 GET 泛匹配之外）。

- [ ] **Step 2: 构建验证**

Run: `cd gateway; npm run build`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add gateway/src/index.ts
git commit -m "feat(usage): wire plugin management routes into gateway"
```

---

### Task 6: SDK client + preload 通道

**Files:**
- Modify: `opencode-dev/packages/gateway-sdk/src/client.ts:173-179`（sessions 命名空间）
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-types.ts:47-48`
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-api.ts:59-60`

- [ ] **Step 1: client.ts sessions 增加方法**（usagePluginsReload 之后）

```ts
usagePluginsCreate: async (body: { template?: string; values?: Record<string, any>; name?: string; source?: string }): Promise<{ ok: boolean; name?: string; error?: string; plugins?: any[] }> => {
  return this.request('/api/usage/plugins/create', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
},
usagePluginSource: async (name: string): Promise<{ source?: string; origin?: string; builtin?: boolean; error?: string }> => {
  return this.request(`/api/usage/plugins/${encodeURIComponent(name)}/source`)
},
usagePluginSourceSave: async (name: string, source: string): Promise<{ ok: boolean; error?: string }> => {
  return this.request(`/api/usage/plugins/${encodeURIComponent(name)}/source`, { method: 'PUT', body: JSON.stringify({ source }), headers: { 'Content-Type': 'application/json' } })
},
usagePluginDelete: async (name: string): Promise<{ ok: boolean; error?: string }> => {
  return this.request(`/api/usage/plugins/${encodeURIComponent(name)}`, { method: 'DELETE' })
},
usagePluginTest: async (name: string): Promise<{ ok: boolean; result?: any; error?: string }> => {
  return this.request(`/api/usage/plugins/${encodeURIComponent(name)}/test`, { method: 'POST' })
},
```

（执行时先确认 `this.request` 的 options 形状——参照文件内现有 POST 用例。）

- [ ] **Step 2: mafw-types.ts / mafw-api.ts 同步**（session 命名空间，签名一致）

- [ ] **Step 3: typecheck**

Run: `cd opencode-dev/packages/gateway-sdk; bun run typecheck 2>nul || npx tsc --noEmit; cd ..\..\packages\desktop; npm run typecheck`
Expected: exit 0（desktop typecheck 覆盖 preload 对 SDK 类型引用）

- [ ] **Step 4: Commit**

```bash
git add opencode-dev/packages/gateway-sdk/src/client.ts opencode-dev/packages/desktop/src/preload/mafw-types.ts opencode-dev/packages/desktop/src/preload/mafw-api.ts
git commit -m "feat(sdk): usage plugin management IPC channels"
```

---

### Task 7: Desktop 卡片网格 + 抽屉 + 向导（UsageProviders.tsx）

**Files:**
- Create: `opencode-dev/packages/desktop/src/renderer/mafw/components/UsageProviders.tsx`
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/pages/Config.tsx`（usage nav 段 ~856-1050 换成组件；~344-470 删掉扁平卡片专用 state/handlers：usageAddKind/usageAddName/commitUsageAdd/setUsageLimitWindow/setUsageBudget/setUsageCookie/removeUsageCookie）
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/mafw.css`（卡片/抽屉/向导样式）

**Interfaces:**
- Consumes: Task 6 全部 IPC 方法、`window.api.mafw.config.get/set('usage')`、`window.api.mafw.sessions.usage()`（右 dock 数据源，卡片摘要用）、`modelAvailable()`（providerID→显示名）
- Produces: `UsageProviders(props: { modelAvailable: () => any[] | null })`——组件自治（config/plugins/usage 全部自取），保存后派发 `mafw:usage-config-saved`

**组件结构：**

```tsx
// 卡片合并：插件卡（win）+ 剩余 usage provider（本地统计）
type Card = {
  key: string                 // providerID 或 file
  name: string                // providerID
  displayName: string
  origin: 'user' | 'builtin' | 'override' | 'local'
  badge: string               // '插件·balance' | '插件·token-plan' | '本地统计'
  status: 'ok' | 'error' | 'disabled'
  error?: string
  summary?: string            // 来自 usage provider windows
  plugin?: any                // 插件条目（含 configSchema/config）
}

function mergeCards(plugins: any[], usageProviders: any[], limits: any, budgets: any, nameOf: (id: string) => string): Card[]
```

合并规则：插件名命中 usageProvider → 摘要附到插件卡；剩余 usageProvider 里"有 windows 或在 limits/budgets 有 key"的 → 本地统计卡。

**交互（全部走既有 v2 组件）：**

1. 卡片网格：`.mafw-usage-cards`（CSS grid 2 列）+ `＋ 新建插件` 卡
2. 抽屉：`.mafw-usage-drawer`（fixed 右侧 480px，z-index 高于内容），分区：
   - 头：displayName + providerID + 徽章 + 状态 + 关闭钮
   - 通用配置：预算 TextInputV2、限额三窗口（5h/7d/month）、Cookie（textarea）→ 本地暂存，`保存配置` 按钮 → `config.set('usage', 全量)` → `dispatchEvent('mafw:usage-config-saved')` → 刷新
   - 插件专属（origin != local）：configSchema 表单（type→TextInputV2/SwitchV2/select）编辑 `pluginConfig[name]`；代码编辑器（TextareaV2 monospace + 保存按钮 → usagePluginSourceSave；origin=builtin 只读并提示"克隆后可编辑"）；测试运行 → usagePluginTest → 结果 JSON 展示；启用/禁用 SwitchV2（改 usage.disabledPlugins）；删除（override/user，confirm 后 usagePluginDelete）
3. 向导：模板 SelectV2 → 动态字段表单（templates[].fields）→ 创建 → usagePluginsCreate → 刷新列表；clone-builtin 的 sourceName options = builtins
4. 错误/toast：showToastV2

- [ ] **Step 1: 写 UsageProviders.tsx**（完整实现）
- [ ] **Step 2: Config.tsx 替换 usage 段 + 删冗余 state**
- [ ] **Step 3: mafw.css 加样式**（卡片网格/抽屉/向导/编辑器等宽字体）
- [ ] **Step 4: typecheck**

Run: `cd opencode-dev/packages/desktop; npm run typecheck`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/UsageProviders.tsx opencode-dev/packages/desktop/src/renderer/mafw/pages/Config.tsx opencode-dev/packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): usage provider cards + drawer + template wizard"
```

---

### Task 8: 全量构建 + 手动冒烟清单

- [ ] **Step 1:** 根目录 `npm run build`（plugin + gateway）→ exit 0
- [ ] **Step 2:** desktop `npm run typecheck` → exit 0
- [ ] **Step 3:** 部署走 `mafw-gateway-restart` skill（用户触发）；desktop `npm run dev` 冒烟：
  - Config → Usage 显示卡片（xiaomi/gateway 本地统计卡 + 8 个 builtin 插件卡）
  - 点 gateway 卡 → 改预算 50 → 保存 → 右 dock 用量刷新
  - 新建插件向导 → balance-api 模板 → 填 name/endpoint → 创建 → 卡片出现（用户目录多了 `<name>.js`）
  - 抽屉代码编辑器改插件源码 → 保存 → 状态无错误
  - 测试运行 → 返回 JSON/错误可见
  - 禁用开关 → 卡片变灰、右 dock 对应行消失

---

## Self-Review 记录

- Spec 覆盖：§1 卡片/Task 7、§2 抽屉/Task 7、§3 模板/Task 3、§4 API/Task 4-5、§5 兼容/Task 1-2、§6 错误处理/Task 4+7、§7 测试/Task 1-4 ✓
- 占位符：无 TBD；Task 7 UI 骨架以结构+交互规格给出（SolidJS 组件代码在执行时落地，关键纯函数 mergeCards 已给签名与规则）
- 类型一致性：UsagePluginsDeps 在 Task 4 定义、Task 5 消费，字段一致 ✓；ConfigSchemaField Task 1 定义、Task 3 生成物消费 ✓
