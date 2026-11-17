# E14 插件标准 v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让一个没有本仓库上下文的 agent，只凭交付物写出一个 `check --strict` 通过、人能一次装上的插件。

**Architecture:** 不重构运行时。标准由四件可执行的东西承载：两个参考包（形状的真相）、`mafw plugin check`（agent 自查位，复用 `/api/plugins/check` 与 `checkPath`）、`mafw plugin init`（骨架，模板内联为 TS 字符串以免构建拷贝问题）、manifest JSON Schema（内联为 TS 对象，与 parser 做 parity 测试）。规范正文最后写，只引用这四件已验证的东西，并带一条「文案与代码一致」的测试。

**Tech Stack:** TypeScript、Jest（gateway）、`ajv`（已依赖，用于 schema parity）、Node CLI（`bin/mafw.js` + `gateway/src/cli/*`）。

**Spec:** `docs/superpowers/specs/2026-11-17-plugin-standard-v1-design.md`
**调研依据:** `docs/research/2026-11-17-plugin-install-trust.md`

## Global Constraints

- **安装权归人**：任何代码都不得让 agent 自行安装；`check` 不需要也不需要读取 human token。
- 不新增面向 agent 的安装通道；不改 `~/.mafw/plugins` 语义；不碰 `boot.ts`。
- 不重构注册 API、不引入 DI/profile/bundle。
- 契约包只允许加**可选**字段；顶层未知键继续放行。
- 所有新增测试先红后绿；每个 task 一个 commit。
- 只 ADD 本 task 列出的文件（共享 main checkout，禁止 `git add -A`）。
- 用户可见输出必须中文，错误文案与代码逐字一致。

## Review Focus

- **check 与真实激活分叉**：`check` 说 ok、装上却失败是最坏的失败模式。→ Task 2 的 inventory 测试必须用真 `PluginHost` probe，而不是 mock。
- **init 生成物不可用**：脚手架生成完立即 `check` 不过。→ Task 3 的测试在临时目录里 init 后直接跑 `checkPath`。
- **schema 比 parser 更严**：schema 一旦拒绝仓库自带示例包，agent 会照着 schema 写出 parser 不认的东西。→ Task 4 的 parity 矩阵必须包含两个参考包。
- **规范文案漂移**：文档里的错误文案与代码不一致，agent 会照错的文案修。→ Task 5 的文档测试逐条断言五个 plane 的逐字文案。
- **`--json` 不可解析**：agent 要 parse，输出里混人话就废了。→ Task 2 断言 `--json` 的最后一行能 `JSON.parse`。

---

### Task 1: 参考包 ×2

**Files:**
- Create: `examples/plugins/hello-plugin/plugin.json`
- Create: `examples/plugins/hello-plugin/index.js`
- Create: `examples/plugins/hello-plugin/README.md`
- Create: `examples/plugins/kitchen-sink/plugin.json`
- Create: `examples/plugins/kitchen-sink/index.js`
- Create: `examples/plugins/kitchen-sink/README.md`
- Test: `gateway/tests/unit/plugins/example-packages.test.ts`

**Interfaces:**
- 产出：两个目录包，均可被 `checkPath` 接受；`hello-plugin` 只含 1 action + 1 event，`kitchen-sink` 含全部五个 gateway plane + 一个 ui panel。

- [ ] **Step 1: 写失败的测试**

`gateway/tests/unit/plugins/example-packages.test.ts`：

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginHost } from '../../../src/plugins/package-host';
import { createPluginPackageContext } from '../../../src/plugins/package-context';

const EXAMPLES = path.join(__dirname, '..', '..', '..', '..', 'examples', 'plugins');

async function checkExample(name: string) {
  const host = new PluginHost(
    fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-example-')),
    (pkg, bag) => createPluginPackageContext(pkg, { projectDir: '/p', gatewayPort: 3000, bag }),
  );
  try {
    return await host.checkPackage(path.join(EXAMPLES, name));
  } finally {
    host.stop();
  }
}

describe('example packages', () => {
  it('hello-plugin passes the check', async () => {
    const result = await checkExample('hello-plugin');
    expect(result.ok).toBe(true);
    expect(result.contributions).toEqual(expect.arrayContaining(['actions', 'events']));
  });

  it('kitchen-sink passes the check and covers all five gateway planes', async () => {
    const result = await checkExample('kitchen-sink');
    expect(result.ok).toBe(true);
    expect(result.contributions).toEqual(expect.arrayContaining(['actions', 'events', 'tools', 'observers', 'http']));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd gateway && npx jest --runInBand tests/unit/plugins/example-packages.test.ts
```

Expected: FAIL（`ENOENT`，示例目录不存在）。

- [ ] **Step 3: 写两个示例包**

`hello-plugin/plugin.json`：

```json
{
  "name": "hello-plugin",
  "version": "1.0.0",
  "main": "index.js",
  "apiVersion": 2,
  "kind": "trusted",
  "permissions": ["actions", "events"],
  "contributes": {
    "gateway": { "actions": ["now"], "events": ["plugin:hello:tick"] }
  }
}
```

`hello-plugin/index.js`：

```js
let timer;

module.exports = {
  name: 'hello-plugin',
  async activate(ctx) {
    // 每秒广播一次 tick；清理挂 ctx.effect，卸载时自动停。
    timer = setInterval(() => {
      ctx.emit({ type: 'plugin:hello:tick', properties: { at: Date.now() } });
    }, 1000);
    ctx.effect(() => clearInterval(timer));
    return {
      actions: {
        now: {
          title: 'Current time',
          handler: () => ({ now: new Date().toISOString() }),
        },
      },
      events: [
        {
          type: 'plugin:hello:tick',
          title: 'Tick',
          schema: { type: 'object', properties: { at: { type: 'number' } } },
        },
      ],
    };
  },
};
```

`README.md`：一句话说明用途 + `mafw plugin check .` + 安装命令占位。

`kitchen-sink`：五面齐全（action `echo`、event `plugin:sink:ping`、tool `lookup`、observer `audit`、`ctx.http.route('GET','/ping',...)`），`plugin.json` 的 `contributes.gateway` 声明这五面（`http: true`），并带一个 `ui.panels`。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd gateway && npx jest --runInBand tests/unit/plugins/example-packages.test.ts
```

Expected: PASS（2 例）。

- [ ] **Step 5: 提交**

```bash
git add examples/plugins gateway/tests/unit/plugins/example-packages.test.ts
git commit -m "docs(plugin): add the two reference packages the standard points at"
```

---

### Task 2: `mafw plugin check`（含 inventory）

**Files:**
- Modify: `gateway/src/plugins/package-host.ts`（`PluginCheckResult` 加 `declared` / `registered`，在 `runCheckPackage` 里填充）
- Create: `gateway/src/cli/plugin-standard-command.ts`
- Test: `gateway/tests/unit/plugins/package-check-inventory.test.ts`
- Test: `gateway/tests/unit/cli/plugin-standard-command.test.ts`
- Modify: `bin/mafw.js`（注册 `plugin` 命令）

**Interfaces:**
- 产出：`PluginCheckResult.declared?: { actions: string[]; events: string[]; tools: string[]; observers: string[]; http?: boolean }`
- 产出：`PluginCheckResult.registered?: { actions: string[]; events: string[]; tools: string[]; observers: string[]; http: number }`
- 产出：`PluginCheckResult.warnings?: string[]`（透传 `parsePackageManifest` 的 warnings；`--strict` 用它做 warnings-as-errors）
- 产出：`runPluginStandardCommand(argv: string[], deps: { request(path, method, body?): Promise<{ status: number; body: any }>; print(text: string): void }): Promise<number>`
- CLI：`mafw plugin check <path> [--strict] [--json]`

- [ ] **Step 1: 写失败的测试**

`package-check-inventory.test.ts`（真 host + 临时目录包）：

```ts
it('reports declared and registered planes for a conforming package', async () => {
  // 写一个目录包：声明 actions:['ping']、http:true，注册 ping + 一条 GET 路由
  const result = await host.checkPackage(dir);
  expect(result.ok).toBe(true);
  expect(result.declared).toMatchObject({ actions: ['ping'], http: true });
  expect(result.registered).toMatchObject({ actions: ['ping'], http: 1 });
});

it('reports the diff when a registration is outside the declaration', async () => {
  // 声明 actions:['ping']，注册 ping + pong
  const result = await host.checkPackage(dir);
  expect(result.ok).toBe(false);
  expect(result.error).toContain('action "pong" is not declared');
  expect(result.registered?.actions).toEqual(['ping', 'pong']);
  expect(result.declared?.actions).toEqual(['ping']);
});
```

`plugin-standard-command.test.ts`（纯函数 + 假 deps，仿 `tests/unit/cli/plugins-command.test.ts`）：

```ts
it('posts the path to /api/plugins/check and prints a human summary', async () => {
  const calls: any[] = [];
  const out: string[] = [];
  const code = await runPluginStandardCommand(['check', './my-plugin'], {
    request: async (p, method, body) => {
      calls.push({ p, method, body });
      return { status: 200, body: { ok: true, declared: { actions: ['now'] }, registered: { actions: ['now'] } } };
    },
    print: (t) => out.push(t),
  });
  expect(code).toBe(0);
  expect(calls[0]).toMatchObject({ p: '/api/plugins/check', method: 'POST', body: { path: './my-plugin' } });
  expect(out.join('\n')).toContain('ok');
});

it('prints a single parseable JSON line with --json', async () => {
  const out: string[] = [];
  await runPluginStandardCommand(['check', './p', '--json'], {
    request: async () => ({ status: 200, body: { ok: false, error: 'boom' } }),
    print: (t) => out.push(t),
  });
  expect(() => JSON.parse(out.join('\n').trim())).not.toThrow();
});

it('exits non-zero and prints next steps when the check fails', async () => {
  const out: string[] = [];
  const code = await runPluginStandardCommand(['check', './p'], {
    request: async () => ({ status: 200, body: { ok: false, error: 'action "pong" is not declared in plugin.json contributes.gateway.actions' } }),
    print: (t) => out.push(t),
  });
  expect(code).toBe(1);
  expect(out.join('\n')).toContain('next:');
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd gateway && npx jest --runInBand tests/unit/plugins/package-check-inventory.test.ts tests/unit/cli/plugin-standard-command.test.ts
```

Expected: FAIL（`declared` 未定义 / 模块不存在）。

- [ ] **Step 3: 实现**

1. `package-host.ts`：`PluginCheckResult` 加两个可选字段；在 `runCheckPackage` 返回处，从 `activated` 与 `parsedManifest?.manifest?.contributes?.gateway` 组装。`registered.http` = `httpRecorder.entries.length`。
2. `plugin-standard-command.ts`：

```ts
export async function runPluginStandardCommand(argv: string[], deps: PluginStandardDeps): Promise<number>
```

- `check <path>`：POST `/api/plugins/check {path}`；`ok:true` → 打印 `ok` + 两行 inventory（`declared: …` / `registered: …`）；`ok:false` → 打印 `error` + 差集 + `next: 打开 docs/guides/plugin-standard.md#<plane>` 与 `mafw plugins install <path>`（提示由人执行）。
- `--json`：只打印一行 `JSON.stringify(result)`（`print` 调一次）。
- `--strict`：warnings-as-errors —— `result.warnings` 非空时即使 `ok:true` 也返回 1 并打印 warning 列表。
  **不得**因为「声明了但没注册」而失败：那是合法的条件注册（E12 语义）。
- HTTP 不可达：打印 `gateway not running; start it with: mafw start` 并返回 1。

3. `bin/mafw.js`：`COMMANDS` 加 `'plugin'`，新增 `pluginStandardCommand(args)` 复用现有 `httpRequest`（无 human token），并在 switch 里接线。用法行加入帮助文本。

- [ ] **Step 4: 跑测试 + 手工冒烟**

```bash
cd gateway && npx jest --runInBand tests/unit/plugins/package-check-inventory.test.ts tests/unit/cli/plugin-standard-command.test.ts
cd .. && npm run build && node bin/mafw.js plugin check examples/plugins/hello-plugin
```

Expected: 单测 PASS；冒烟输出含 `ok` 与两行 inventory，退出码 0。
（`npm run build` 较慢；若只想类型门禁，可用 `cd gateway && npx tsc --noEmit -p tsconfig.json`，但冒烟必须真跑一次。）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/plugins/package-host.ts gateway/src/cli/plugin-standard-command.ts gateway/tests/unit/plugins/package-check-inventory.test.ts gateway/tests/unit/cli/plugin-standard-command.test.ts bin/mafw.js
git commit -m "feat(plugin): add mafw plugin check with a declared-vs-registered inventory"
```

---

### Task 3: `mafw plugin init`

**Files:**
- Modify: `gateway/src/cli/plugin-standard-command.ts`（加 `init`）
- Create: `gateway/src/cli/plugin-templates.ts`（内联模板字符串）
- Test: `gateway/tests/unit/cli/plugin-standard-command.test.ts`（追加）

**Interfaces:**
- `mafw plugin init <name> [--dir <path>] [--force]`
- 默认目标：`<cwd>/.mafw/plugin-drafts/<name>`；模板文件 `plugin.json` + `index.js` + `README.md`。

- [ ] **Step 1: 写失败的测试**

```ts
it('scaffolds a package into .mafw/plugin-drafts by default', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-init-'));
  const code = await runPluginStandardCommand(['init', 'demo'], {
    request: async () => ({ status: 200, body: {} }),
    print: () => {},
    cwd,
  });
  expect(code).toBe(0);
  const root = path.join(cwd, '.mafw', 'plugin-drafts', 'demo');
  expect(JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')).name).toBe('demo');
  expect(fs.existsSync(path.join(root, 'index.js'))).toBe(true);
});

it('refuses to overwrite without --force', async () => {
  // 先 init 一次，再 init 同名 → code 1，错误含 --force
});

it('generates a package that check accepts', async () => {
  // init 到临时目录后，用真 PluginHost.checkPackage 校验 → ok:true
});
```

（第三条测试需要真 host；放在 `package-check-inventory.test.ts` 里也行，选能干净复用 host helper 的位置。）

- [ ] **Step 2: 跑测试确认失败**

```bash
cd gateway && npx jest --runInBand tests/unit/cli/plugin-standard-command.test.ts
```

Expected: FAIL（`init` 落到 default 分支）。

- [ ] **Step 3: 实现**

- `plugin-templates.ts` 导出 `pluginTemplate(name: string): { 'plugin.json': string; 'index.js': string; 'README.md': string }`，内容是 `hello-plugin` 的最小版（1 action），`index.js` 用 `module.exports = { name, activate }`。
- `init` 分支：`--dir` 覆盖目标父目录，`--force` 才允许覆盖；目录已存在且无 `--force` → 打印 `refusing to overwrite: <path> (pass --force)` 返回 1。
- 成功后打印 `created <path>` + `next: mafw plugin check <path>`。
- deps 增加可选 `cwd?: string`（默认 `process.cwd()`），便于测试。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd gateway && npx jest --runInBand tests/unit/cli/plugin-standard-command.test.ts
```

Expected: PASS（新增 3 例）。

- [ ] **Step 5: 提交**

```bash
git add gateway/src/cli/plugin-standard-command.ts gateway/src/cli/plugin-templates.ts gateway/tests/unit/cli/plugin-standard-command.test.ts
git commit -m "feat(plugin): add mafw plugin init with an immediately checkable scaffold"
```

---

### Task 4: manifest JSON Schema + parity

**Files:**
- Create: `gateway/src/plugins/manifest-schema.ts`（导出 `MANIFEST_JSON_SCHEMA` 对象）
- Modify: `gateway/src/cli/plugin-standard-command.ts`（加 `schema`）
- Test: `gateway/tests/unit/plugins/manifest-schema-parity.test.ts`

**Interfaces:**
- `mafw plugin schema`：打印 `JSON.stringify(MANIFEST_JSON_SCHEMA, null, 2)`
- parity 契约：对给定 manifest，`parsePackageManifest(m).ok === validateWithSchema(m)`；**schema 不得比 parser 更严**。

- [ ] **Step 1: 写失败的测试**

```ts
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validate = ajv.compile(MANIFEST_JSON_SCHEMA);

const ACCEPTED = [
  { name: 'demo' },                                              // v1 最小
  { name: 'demo', apiVersion: 2, permissions: ['actions'] },
  { name: 'demo', apiVersion: 2, contributes: { gateway: { actions: ['ping'], observers: ['audit'], http: true } } },
  { name: 'demo', standardVersion: 1 },                           // D6：可选的标准版本
  { name: 'demo', unknownTopLevelKey: 1 },                        // 顶层未知键放行
  JSON.parse(fs.readFileSync('../../examples/plugins/hello-plugin/plugin.json', 'utf8')),
  JSON.parse(fs.readFileSync('../../examples/plugins/kitchen-sink/plugin.json', 'utf8')),
];
const REJECTED = [
  { name: 'demo', apiVersion: 3 },
  { name: 'demo', kind: 'untrusted' },                            // untrusted 必须 apiVersion 2
  { name: 'demo', standardVersion: 'v1' },                        // 必须是正整数
  { name: 'demo', contributes: { gateway: { actions: 'ping' } } },
  { name: 'demo', contributes: { gateway: { observer: [] } } },   // 未知键
  { name: 'bad name' },
];

for (const manifest of ACCEPTED) {
  it(`accepts ${JSON.stringify(manifest).slice(0, 40)}`, () => {
    expect(parsePackageManifest(manifest).ok).toBe(true);
    expect(validate(manifest)).toBe(true);
  });
}
for (const manifest of REJECTED) {
  it(`rejects ${JSON.stringify(manifest).slice(0, 40)}`, () => {
    expect(parsePackageManifest(manifest).ok).toBe(false);
    expect(validate(manifest)).toBe(false);
  });
}
```

（`REJECTED` 里的每一条先跑 parser 确认它真的被拒；不被拒就换一条真正的非法样例，不要为了对齐而改 parser。）

- [ ] **Step 2: 跑测试确认失败**

```bash
cd gateway && npx jest --runInBand tests/unit/plugins/manifest-schema-parity.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`manifest-schema.ts`：`type: 'object'`，`required: ['name']`，`properties` 覆盖 `name`（pattern 与 `NAME_PATTERN` 一致）、`version`、`main`、`apiVersion`（enum `[1,2]`）、`kind`（enum）、`permissions`（array of string）、`host`、`integrity`、`deprecated`、`standardVersion`（integer ≥ 1）、`contributes`（`additionalProperties: false`，五个 plane）。**不设** `additionalProperties: false` 于顶层。

`standardVersion`（D6）同时在 parser 侧接住：`parsePackageManifest` 接受可选 `standardVersion`，必须是正整数，写入 `NormalizedPackageManifest.standardVersion?: number`；`packages/plugin-contract/src/types.ts` 的 `PluginManifestContributes` **不动**（它是 contributes 的形状），版本字段加在 gateway 的 `PackageManifest` 类型上。

`mafw plugin schema`：直接打印。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd gateway && npx jest --runInBand tests/unit/plugins/manifest-schema-parity.test.ts
cd .. && node bin/mafw.js plugin schema | Select-Object -First 5
```

Expected: 全绿；schema 首行是 `{`。

- [ ] **Step 5: 提交**

```bash
git add gateway/src/plugins/manifest-schema.ts gateway/src/cli/plugin-standard-command.ts gateway/tests/unit/plugins/manifest-schema-parity.test.ts
git commit -m "feat(plugin): publish a manifest JSON Schema that cannot be stricter than the parser"
```

---

### Task 5: 规范正文

**Files:**
- Create: `docs/guides/plugin-standard.md`
- Modify: `docs/guides/plugin-authoring.md`（顶部加一行：本文是细节参考，规范正文见 plugin-standard.md）
- Modify: `docs/architecture/plugin.md`（现状段加一句指向规范）
- Test: `gateway/tests/unit/plugins/standard-doc.test.ts`

**Interfaces:**
- 规范必须包含五个 plane 的逐字错误文案、`check` / `init` / `schema` 的用法、以及「agent 终点是 check 通过 + 交出安装命令，安装由人执行」。

- [ ] **Step 1: 写失败的测试**

```ts
const DOC = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'docs', 'guides', 'plugin-standard.md'), 'utf8');

it('documents every bound error string verbatim', () => {
  for (const text of [
    'action "<name>" is not declared in plugin.json contributes.gateway.actions',
    'event "<type>" is not declared in plugin.json contributes.gateway.events',
    'tool "<name>" is not declared in plugin.json contributes.gateway.tools',
    'observer "<id>" is not declared in plugin.json contributes.gateway.observers',
    'http routes are not declared (contributes.gateway.http is false)',
    'packages without plugin.json cannot contribute',
  ]) {
    expect(DOC).toContain(text);
  }
});

it('states that installation is performed by the human', () => {
  expect(DOC).toContain('mafw plugins install');
  expect(DOC).toMatch(/由人执行|human/);
});

it('names the three CLI entry points', () => {
  for (const cmd of ['mafw plugin check', 'mafw plugin init', 'mafw plugin schema']) {
    expect(DOC).toContain(cmd);
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd gateway && npx jest --runInBand tests/unit/plugins/standard-doc.test.ts
```

Expected: FAIL（文档不存在）。

- [ ] **Step 3: 写规范**

结构固定为：`0. 60 秒路径`（init → 改 → check → 人安装）、`1. 包形态与目录布局`、`2. plugin.json 字段表`、`3. activate() 与生命周期`、`4. 五个 plane`（每个：字段表 + 可复制片段 + 逐字错误 + 上限）、`5. 声明即上界`、`6. 能力与信任（trusted/untrusted 的硬限制）`、`7. 自检与提交（check --strict / --json）`、`8. 安装（由人执行）`、`9. 常见失败与修法`、`10. 版本与兼容（apiVersion / host / standardVersion）`。

每个 plane 的片段直接从 `examples/plugins/*` 拷贝，不另写。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd gateway && npx jest --runInBand tests/unit/plugins/standard-doc.test.ts
```

Expected: PASS（3 例）。

- [ ] **Step 5: 提交**

```bash
git add docs/guides/plugin-standard.md docs/guides/plugin-authoring.md docs/architecture/plugin.md gateway/tests/unit/plugins/standard-doc.test.ts docs/research/2026-11-17-plugin-install-trust.md
git commit -m "docs(plugin): publish the agent-facing plugin standard"
```

---

### Task 6: 交付记录与版本

**Files:**
- Modify: `gateway/package.json`（`4.17.0` → `4.18.0`）
- Create: `docs/releases/2026-11-17-plugin-standard-v1.md`

- [ ] **Step 1: 写交付记录**

必须包含：五个功能 commit 与各自一句话；`check` / `init` / `schema` 的用法；「安装由人执行」的决策与调研结论；新增测试数；全量通过数；已知边界（check 依赖运行中的 gateway；schema 顶层放行未知键；无 manifest 目录在 doctor 里只报 `plugin.json not found`；`standardVersion` 目前只定义 1）。

- [ ] **Step 2: 版本 + 提交**

```bash
git add gateway/package.json docs/releases/2026-11-17-plugin-standard-v1.md docs/superpowers/specs/2026-11-17-plugin-standard-v1-design.md docs/superpowers/plans/2026-11-17-plugin-standard-v1.md
git commit -m "docs(plugin): record E14 delivery and bump gateway to 4.18.0"
```

---

## 终审后

- 门禁：`cd gateway && npx tsc --noEmit -p tsconfig.json`、`npm run test:plugin-contract`、gateway 定向 suite、gateway 全量。
- 验收：按 spec §6 的三个场景，各派一个**无上下文子代理**跑一遍；场景 A/B 的「人安装」由 controller 用 human token 代执行，并要求 agent 全程不接触 token。
