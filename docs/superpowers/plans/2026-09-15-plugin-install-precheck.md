# 插件中心安装预检实现计划（语法/接口/名称统一/预激活）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 插件中心安装时统一执行预检——加载（语法/顶层 throw）、名称统一（exports.name === 文件名 stem）、接口命中（显式 type ∈ 命中集合）、media 预激活深检——任一失败 400 拒绝且文件不落盘。

**Architecture:** 改造收敛在 `gateway/src/plugins/hub.ts`：`sniffPluginType` 泛化为 `inspectPlugin()`（tmp-require 返回命中集合 + module 对象），新增 `validateName` / `validateMediaActivation`，`installPlugin` 串成统一检查管线。loader 侧零改动（runtime stem-alias 保留）。spec：`docs/superpowers/specs/2026-09-15-plugin-install-precheck-design.md`。

**Tech Stack:** TypeScript (gateway, CJS)、Jest、Node require（tmp-require 嗅探既有机制）。

## Global Constraints

- 错误消息逐字使用（英文，与既有/loader 风格一致）：
  - `plugin failed to load: <err.message>`
  - `missing plugin name`
  - `plugin name mismatch: exports '<name>', filename '<file>' (must match)`
  - `unrecognized plugin interface: export createRuntime / createPrompt / fetch / tools`
  - `ambiguous plugin interface: media/usage`（多命中，格式 `matches.join('/')`）
  - `plugin interface mismatch: selected usage, exports media (createPrompt)`（格式 `selected <type>, exports <命中列表，含接口名>`）
  - `invalid modalities` / `missing createPrompt() or engine:"pi"` / `createPrompt and engine:"pi" are mutually exclusive` / `createPrompt did not return a function`（与 media-plugin-loader.ts 逐字对齐）
- `VALID_MODALITIES = new Set(['image', 'video', 'audio'])`（hub.ts 本地常量，不 import media 模块——plugin-context 会拉 config）
- stub media ctx 在 hub.ts 本地构造：`{ apiKey: () => null, fetch, pluginConfig: () => null, log }`（log 从 `../core/utils/logger` import）
- 检查顺序（installPlugin 内）：文件名正则/.js 后缀 → 空内容/大小 → `parseType`（显式 type 提前校验枚举）→ `inspectPlugin`（加载+命中集合）→ `validateName` → 0 命中 400 → 显式 type ∈ 命中 / 嗅探回退（多命中 400）→ media 预激活 → 重复 409 → 写盘 → reload
- TDD：每任务先写失败测试再实现；测试命令一律在 `gateway/` 目录：`npx jest tests/unit/plugins-hub.test.ts`
- 直接提交 main；不新增依赖；不改 SDK / 桌面 / routes / loaders
- 既有测试 fixture 因新规则失效的（名称 stem 不匹配等）随所在任务一并修正，见各任务清单

---

### Task 1: inspectPlugin 提取 + 加载检查 + 名称统一

**Files:**
- Modify: `gateway/src/plugins/hub.ts`（sniffPluginType → inspectPlugin + computeMatches；新增 validateName；installPlugin 接线）
- Test: `gateway/tests/unit/plugins-hub.test.ts`

**Interfaces:**
- Consumes: 现有 `validateFilename` / `baseName` / `HubError` / `parseType`（均在 hub.ts）
- Produces: `inspectPlugin(filename: string, bytes: Buffer): { matches: PluginType[]; mod: Record<string, unknown> }`（module 私有）；`validateName(mod, filename): void`（module 私有，失败 throw HubError(400)）；Task 2/3 依赖 `matches`、`mod` 与上述错误消息

本任务为纯增量（旧语义测试全部保持绿）：显式 type 时仍不校验命中集合，仅新增加载失败 400 与名称统一 400。

- [ ] **Step 1: 更新测试 fixture + 写失败测试**

在 `gateway/tests/unit/plugins-hub.test.ts` 顶部常量区，替换 fixture（名称改为与文件名 stem 一致，PLAIN 升级为合法 runtime 插件）：

```typescript
const mod = (body: string) => Buffer.from(body, 'utf-8');
const PLAIN = mod('module.exports = { name: "foo", createRuntime: async () => ({}) };');
const RUNTIME_MOD = mod('module.exports = { name: "rt", createRuntime: async () => ({}) };');
const MEDIA_MOD = mod('module.exports = { name: "m1", createPrompt: async () => async () => "" };');
const USAGE_MOD = mod('module.exports = { name: "u1", type: "api", fetch: async () => null };');
const UI_MOD = mod('module.exports = { name: "ui", tools: { t: { render: () => [] } } };');
const AMBIGUOUS_MOD = mod('module.exports = { name: "x", createPrompt: async () => async () => "", fetch: async () => null };');
```

同步修正三处内联 body（同文件）：
- 'sniffs media interface' 测试：`m2` → `mod('module.exports = { name: "m2", engine: "pi" };')`；`m3` → `mod('module.exports = { name: "m3", modalities: ["image"] };')`
- 'sniffs usage interface' 测试：`u2` → `mod('module.exports = { name: "u2", fetch: async () => null };')`

在 `describe('installPlugin', ...)` 末尾追加新 describe：

```typescript
describe('install precheck: load & name', () => {
  test('syntax error → 400 plugin failed to load, no file left behind', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'runtime', filename: 'broken.js', bytes: mod('module.exports = { name: "broken"') }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('plugin failed to load') });
    expect(fs.existsSync(path.join(deps.dirs.runtime, 'broken.js'))).toBe(false);
  });

  test('top-level throw → 400 plugin failed to load', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'runtime', filename: 'boom.js', bytes: mod('module.exports = (() => { throw new Error("boom-at-load"); })();') }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('boom-at-load') });
  });

  test('missing name → 400 missing plugin name', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'runtime', filename: 'a.js', bytes: mod('module.exports = { createRuntime: async () => ({}) };') }))
      .rejects.toMatchObject({ status: 400, message: 'missing plugin name' });
  });

  test('name mismatch with filename stem → 400', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'runtime', filename: 'bar.js', bytes: RUNTIME_MOD }))
      .rejects.toMatchObject({ status: 400, message: "plugin name mismatch: exports 'rt', filename 'bar.js' (must match)" });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run（workdir `gateway/`）: `npx jest tests/unit/plugins-hub.test.ts`
Expected: 新增 4 例 FAIL（当前行为是安装成功/无此错误消息），其余既有用例 PASS。

- [ ] **Step 3: 实现 hub.ts 改造**

在 `gateway/src/plugins/hub.ts` 中，将 `sniffPluginType` 整个函数替换为以下三个函数，并新增 import：

```typescript
import { log } from '../core/utils/logger';

const MATCH_IFACE: Record<PluginType, string> = {
  runtime: 'createRuntime',
  media: 'createPrompt',
  usage: 'fetch',
  ui: 'tools',
};

function computeMatches(mod: Record<string, unknown> | undefined): PluginType[] {
  const matches: PluginType[] = [];
  if (typeof mod?.createRuntime === 'function') matches.push('runtime');
  if (typeof mod?.createPrompt === 'function' || typeof mod?.fixPayload === 'function'
      || typeof mod?.engine === 'string' || Array.isArray(mod?.modalities)) matches.push('media');
  if (typeof mod?.fetch === 'function'
      && (mod.type === undefined || mod.type === 'api' || mod.type === 'token-plan' || mod.type === 'local')) matches.push('usage');
  if (mod?.tools && typeof mod.tools === 'object' && Object.keys(mod.tools as object).length > 0) matches.push('ui');
  return matches;
}

function inspectPlugin(filename: string, bytes: Buffer): { matches: PluginType[]; mod: Record<string, unknown> } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-hub-sniff-'));
  const tmpFile = path.join(tmpDir, filename);
  try {
    fs.writeFileSync(tmpFile, bytes);
    try { delete require.cache[require.resolve(tmpFile)]; } catch { /* first load */ }
    let mod: Record<string, unknown>;
    try {
      mod = require(tmpFile) as Record<string, unknown>;
    } catch (err: any) {
      throw new HubError(400, `plugin failed to load: ${err.message}`);
    }
    return { matches: computeMatches(mod), mod };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

function validateName(mod: Record<string, unknown> | undefined, filename: string): void {
  const name = mod?.name;
  if (typeof name !== 'string' || name.length === 0) throw new HubError(400, 'missing plugin name');
  const stem = baseName(filename);
  if (name !== stem) {
    throw new HubError(400, `plugin name mismatch: exports '${name}', filename '${filename}' (must match)`);
  }
}
```

将 `installPlugin` 中 `const type = input.type ? parseType(input.type) : sniffPluginType(filename, input.bytes);` 一行替换为：

```typescript
  const explicitType = input.type ? parseType(input.type) : undefined;
  const { matches, mod } = inspectPlugin(filename, input.bytes);
  validateName(mod, filename);
  let type: PluginType;
  if (explicitType) {
    type = explicitType;
  } else {
    if (matches.length === 0) throw new HubError(400, 'unrecognized plugin interface: export createRuntime / createPrompt / fetch / tools');
    if (matches.length > 1) throw new HubError(400, `ambiguous plugin interface: ${matches.join('/')}`);
    type = matches[0];
  }
```

（`sniffPluginType` 函数整体删除；其后的 `const dir = deps.dirs[type];` 起 duplicate/write/reload/statEntry 逻辑不变。）

- [ ] **Step 4: 运行测试确认全绿**

Run（workdir `gateway/`）: `npx jest tests/unit/plugins-hub.test.ts`
Expected: 全部 PASS（既有用例 + 新增 4 例；'explicit type skips sniffing' 本阶段仍绿——无接口文件显式 type 尚可安装）。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/hub.ts gateway/tests/unit/plugins-hub.test.ts
git commit -m "feat(hub): install precheck - load failure & name-stem unification"
```

---

### Task 2: 接口门——显式 type ∈ 命中集合

**Files:**
- Modify: `gateway/src/plugins/hub.ts`（installPlugin 接口门）
- Test: `gateway/tests/unit/plugins-hub.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `inspectPlugin`（`matches`）、`MATCH_IFACE`、`HubError`
- Produces: 显式 type ∉ 命中集合时 `HubError(400, 'plugin interface mismatch: selected <type>, exports <命中列表>')`；命中列表格式 `media (createPrompt)`（`MATCH_IFACE` 映射）

- [ ] **Step 1: 写失败测试（含重写旧语义用例）**

替换既有测试 `'explicit type skips sniffing'`（describe('installPlugin') 内）为：

```typescript
  test('explicit type within matched interfaces installs', async () => {
    const deps = makeDeps();
    const entry = await installPlugin(deps, { type: 'runtime', filename: 'rt.js', bytes: RUNTIME_MOD });
    expect(entry.type).toBe('runtime');
  });

  test('ambiguous file + explicit type from matched set installs (escape hatch)', async () => {
    const deps = makeDeps();
    const entry = await installPlugin(deps, { type: 'usage', filename: 'x.js', bytes: AMBIGUOUS_MOD });
    expect(entry.type).toBe('usage');
    expect(fs.existsSync(path.join(deps.dirs.usage, 'x.js'))).toBe(true);
  });

  test('explicit type outside matched set → 400 mismatch listing actual exports', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'usage', filename: 'rt.js', bytes: RUNTIME_MOD }))
      .rejects.toMatchObject({ status: 400, message: 'plugin interface mismatch: selected usage, exports runtime (createRuntime)' });
  });

  test('explicit type + no known interfaces → 400 unrecognized', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'ui', filename: 'x.js', bytes: mod('module.exports = { name: "x" };') }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('unrecognized plugin interface') });
    expect(fs.existsSync(path.join(deps.dirs.ui, 'x.js'))).toBe(false);
  });

  test('explicit type + syntax error → 400 failed to load', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { type: 'media', filename: 'bad.js', bytes: mod('module.exports = { name: "bad", createPrompt:' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('plugin failed to load') });
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run（workdir `gateway/`）: `npx jest tests/unit/plugins-hub.test.ts`
Expected: 'outside matched set' 与 'no known interfaces' 两例 FAIL（当前显式 type 直通）；其余 PASS。

- [ ] **Step 3: 实现接口门**

`installPlugin` 中 Task 1 的 `if (explicitType) { type = explicitType; } else { ... }` 替换为：

```typescript
  let type: PluginType;
  if (matches.length === 0) throw new HubError(400, 'unrecognized plugin interface: export createRuntime / createPrompt / fetch / tools');
  if (explicitType) {
    if (!matches.includes(explicitType)) {
      const listing = matches.map((m) => `${m} (${MATCH_IFACE[m]})`).join('/');
      throw new HubError(400, `plugin interface mismatch: selected ${explicitType}, exports ${listing}`);
    }
    type = explicitType;
  } else {
    if (matches.length > 1) throw new HubError(400, `ambiguous plugin interface: ${matches.join('/')}`);
    type = matches[0];
  }
```

- [ ] **Step 4: 运行测试确认全绿**

Run（workdir `gateway/`）: `npx jest tests/unit/plugins-hub.test.ts`
Expected: 全部 PASS（Task 1 的 4 例 precheck 测试仍绿）。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/hub.ts gateway/tests/unit/plugins-hub.test.ts
git commit -m "feat(hub): explicit plugin type must be within matched interfaces"
```

---

### Task 3: media 预激活深检

**Files:**
- Modify: `gateway/src/plugins/hub.ts`（新增 VALID_MODALITIES + STUB_MEDIA_CTX + validateMediaActivation；installPlugin 接线）
- Test: `gateway/tests/unit/plugins-hub.test.ts`

**Interfaces:**
- Consumes: Task 1 `inspectPlugin` 的 `mod`；Task 2 的 `type` 解析结果
- Produces: `validateMediaActivation(mod): Promise<void>`（module 私有；media 安装路径专用，错误消息与 media-plugin-loader.ts 逐字一致）

- [ ] **Step 1: 修正 m3 fixture + 写失败测试**

'sniffs media interface' 测试中 m3 改为（modalities-only 现在必须带 engine 才能过预激活）：

```typescript
    const e3 = await installPlugin(deps, { filename: 'm3.js', bytes: mod('module.exports = { name: "m3", modalities: ["image"], engine: "pi" };') });
```

在 'install precheck: load & name' describe 后新增：

```typescript
describe('install precheck: media activation', () => {
  const MEDIA_HEAD = 'module.exports = { name: "mm", ';

  test('empty modalities → 400 invalid modalities', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { filename: 'mm.js', bytes: mod(`${MEDIA_HEAD} modalities: [], createPrompt: async () => async () => "" };`) }))
      .rejects.toMatchObject({ status: 400, message: 'invalid modalities' });
  });

  test('invalid modality value → 400 invalid modalities', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { filename: 'mm.js', bytes: mod(`${MEDIA_HEAD} modalities: ["hologram"], createPrompt: async () => async () => "" };`) }))
      .rejects.toMatchObject({ status: 400, message: 'invalid modalities' });
  });

  test('modalities only (no createPrompt / engine) → 400 missing createPrompt() or engine:"pi"', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { filename: 'mm.js', bytes: mod(`${MEDIA_HEAD} modalities: ["image"] };`) }))
      .rejects.toMatchObject({ status: 400, message: 'missing createPrompt() or engine:"pi"' });
  });

  test('createPrompt + engine:"pi" → 400 mutually exclusive', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { filename: 'mm.js', bytes: mod(`${MEDIA_HEAD} modalities: ["image"], engine: "pi", createPrompt: async () => async () => "" };`) }))
      .rejects.toMatchObject({ status: 400, message: 'createPrompt and engine:"pi" are mutually exclusive' });
  });

  test('createPrompt returns non-function → 400', async () => {
    const deps = makeDeps();
    await expect(installPlugin(deps, { filename: 'mm.js', bytes: mod(`${MEDIA_HEAD} modalities: ["image"], createPrompt: async () => 42 };`) }))
      .rejects.toMatchObject({ status: 400, message: 'createPrompt did not return a function' });
  });

  test('valid media plugin (createPrompt returns fn) installs', async () => {
    const deps = makeDeps();
    const entry = await installPlugin(deps, { type: 'media', filename: 'mm.js', bytes: mod(`${MEDIA_HEAD} modalities: ["image", "audio"], createPrompt: async () => async () => "" };`) });
    expect(entry.type).toBe('media');
    expect(deps.reload).toHaveBeenCalledWith('media');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run（workdir `gateway/`）: `npx jest tests/unit/plugins-hub.test.ts`
Expected: media activation 6 例中前 5 例 FAIL（当前无预激活，错误行为是安装成功）；'valid media plugin' 与修正后的 'sniffs media interface' m3 用例 PASS（无门时本就成功，属防回归断言）。

- [ ] **Step 3: 实现 validateMediaActivation + 接线**

hub.ts 新增（log import 已在 Task 1 加）：

```typescript
const VALID_MODALITIES = new Set(['image', 'video', 'audio']);

const STUB_MEDIA_CTX = {
  apiKey: () => null,
  fetch: (url: string, opts?: RequestInit) => fetch(url, opts),
  pluginConfig: () => null,
  log,
};

async function validateMediaActivation(mod: Record<string, unknown> | undefined): Promise<void> {
  const modalities = mod?.modalities;
  if (!Array.isArray(modalities) || modalities.length === 0
      || !modalities.every((m: string) => VALID_MODALITIES.has(m))) {
    throw new HubError(400, 'invalid modalities');
  }
  const hasCreatePrompt = typeof mod?.createPrompt === 'function';
  const hasPiEngine = mod?.engine === 'pi';
  if (!hasCreatePrompt && !hasPiEngine) throw new HubError(400, 'missing createPrompt() or engine:"pi"');
  if (hasCreatePrompt && hasPiEngine) throw new HubError(400, 'createPrompt and engine:"pi" are mutually exclusive');
  if (hasCreatePrompt) {
    const fn = await (mod.createPrompt as (ctx: unknown) => unknown)(STUB_MEDIA_CTX);
    if (typeof fn !== 'function') throw new HubError(400, 'createPrompt did not return a function');
  }
}
```

`installPlugin` 中接口门之后、duplicate 检查之前插入：

```typescript
  if (type === 'media') await validateMediaActivation(mod);
```

- [ ] **Step 4: 运行测试确认全绿**

Run（workdir `gateway/`）: `npx jest tests/unit/plugins-hub.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/hub.ts gateway/tests/unit/plugins-hub.test.ts
git commit -m "feat(hub): media pre-activation checks at install time"
```

---

### Task 4: spec 勘误 + 全量验证 + 交付汇报

**Files:**
- Modify: `docs/superpowers/specs/2026-09-15-plugin-install-precheck-design.md`（勘误：clone-builtin 直写不经安装门）

**Interfaces:**
- Consumes: Task 1-3 的全部改动
- Produces: 交付汇报（新增测试数 / 全量通过数 / 版本号 / commit 哈希）

- [ ] **Step 1: spec 勘误**

将 spec 中 "**回归保护**：usage clone-builtin 模板流程（`usage/templates.ts`）经过同一安装门时 filename=name 天然一致，不破——补断言验证。" 替换为：

```markdown
**回归保护（勘误 2026-09-15）**：usage 模板/克隆流程直写文件（`routes/usage-plugins.ts` 的 `fs.writeFileSync`，不经 `installPlugin`），不受本安装门影响；模板渲染的 `filename = name + '.js'` 天然满足名称统一规则。
```

- [ ] **Step 2: gateway 构建（类型门禁）**

Run（workdir `gateway/`）: `npm run build`
Expected: exit 0，无 TS 错误。

- [ ] **Step 3: gateway 全量测试**

Run（workdir `gateway/`）: `npx jest --silent`（timeout 600000ms）
Expected: 全部 PASS；记录总数与新增数（新增 = plugins-hub.test.ts 中 'install precheck: load & name' 4 例 + 'install precheck: media activation' 6 例 + Task 2 新增/重写后净增 4 例 = 14 例）。

- [ ] **Step 4: Commit 勘误**

```bash
git add docs/superpowers/specs/2026-09-15-plugin-install-precheck-design.md
git commit -m "docs: correct spec - usage template flows bypass hub install gate"
```

- [ ] **Step 5: 交付汇报**

向用户汇报（用户偏好要求）：新增测试数与全量通过数、`node -p "require('./package.json').version"`（workdir 根目录）取得的版本号、`git log --oneline -5` 的 commit 哈希。
