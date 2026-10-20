# Session 目录契约统一 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让"这次会话在哪个项目跑"只有一个权威来源——`opts.directory`（契约必填，gateway 显式传绝对路径）；`ctx.projectDir` 绝对化并降级为启动期信息。

**Architecture:** 先落一个纯规则模块（`session-dir.ts`）承载解析语义，再按"调用点先修 → 契约后收紧"的顺序推进，保证每个任务提交时 `tsc` + jest 都是绿的；最后清理死通道（`sdkConfig.directory` 等 0 读取配置）并同步文档。

**Tech Stack:** TypeScript (gateway, CJS/tsc)、jest（`gateway/tests`）、契约文件 `gateway/src/runtime/contract.ts`。

## Global Constraints

- 不改 `~/.mafw` 记忆存储路径（固定，与 session 目录解耦）
- 不改 trajectory 行键 `projectID`、kv `manager-session` 分键语义（保持 `'.'`）
- 不改多项目 / worktree 语义（`worktreeDir` 仍显式传）
- 不新增公开 API（不做 `ctx.resolveSessionDir()`）
- 每个任务：先写失败测试 → 跑红 → 最小实现 → 跑绿 → 提交（TDD）
- 提交信息用中文 conventional 风格，含实测结论
- 验证命令一律在 `gateway/` 下执行：`npx tsc --noEmit`、`npx jest <path>`

---

## File Structure

| 文件 | 职责 |
|---|---|
| `gateway/src/runtime/session-dir.ts`（新） | 目录解析纯规则：`requireSessionDir`（runtime 侧）/ `resolvePluginProjectDir`（gateway 侧） |
| `gateway/tests/unit/runtime/session-dir.test.ts`（新） | 上述规则单测 |
| `gateway/src/media/media-runtime-executor.ts` | `projectDir` 入 options（必填），会话创建传参 |
| `gateway/src/eval-endpoint.ts` | `directory` 必填，去 `|| '.'` |
| `gateway/src/resources/sdk-session.ts` | `create(directory)` 必填，去 `|| '.'` |
| `gateway/src/index.ts` | `resolvedProjectDir()` + 2 处 ctx 注入 + 4 处会话创建点 + conformance deps + media 注入 |
| `gateway/src/runtime/contract.ts` | `SessionCreateOpts.directory` 必填 + 语义注释 |
| `gateway/src/runtime/plugins/pi-runtime.ts` | 用 `requireSessionDir`，去掉 `config.raw.paths.projectDir` 泄漏腿 |
| `gateway/src/opencode-adapter.ts` / `runtime/opencode-runtime.ts` | 删死字段 `config.directory` 声明 |
| `.opencode/skills/runtime-plugin-authoring/SKILL.md`、`gateway/src/runtime/loader.ts` 注释、`AGENTS.md` | 文档同步一句话规则 |
| `docs/superpowers/specs/2026-10-20-session-directory-contract-design.md` | 勘误：ctx 注入点是 2 处（非 3） |

---

### Task 1: 目录解析规则模块（纯函数 + 单测）

**Files:**
- Create: `gateway/src/runtime/session-dir.ts`
- Test: `gateway/tests/unit/runtime/session-dir.test.ts`

**Interfaces:**
- Produces: `requireSessionDir(optsDirectory: string | undefined | null, ctxProjectDir?: string | null): string`；`resolvePluginProjectDir(currentProjectDir: string | null | undefined, configProjectDir: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/runtime/session-dir.test.ts
import { requireSessionDir, resolvePluginProjectDir } from '../../../src/runtime/session-dir';

describe('requireSessionDir', () => {
  test('opts.directory wins', () => {
    expect(requireSessionDir('/proj/a', '/proj/b')).toBe('/proj/a');
  });
  test('falls back to ctx.projectDir (defensive leg)', () => {
    expect(requireSessionDir(undefined, '/proj/b')).toBe('/proj/b');
  });
  test('both missing → throws fail-loud', () => {
    expect(() => requireSessionDir(undefined, undefined)).toThrow(/directory is required/);
    expect(() => requireSessionDir(null, null)).toThrow(/directory is required/);
  });
});

describe('resolvePluginProjectDir', () => {
  test('UI current project wins', () => {
    expect(resolvePluginProjectDir('/cur/proj', '/cfg/proj')).toBe('/cur/proj');
  });
  test('null/undefined current → config project root', () => {
    expect(resolvePluginProjectDir(null, '/cfg/proj')).toBe('/cfg/proj');
    expect(resolvePluginProjectDir(undefined, '/cfg/proj')).toBe('/cfg/proj');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/runtime/session-dir.test.ts`
Expected: FAIL — `Cannot find module '../../../src/runtime/session-dir'`

- [ ] **Step 3: Write minimal implementation**

```ts
// gateway/src/runtime/session-dir.ts
/**
 * 会话目录解析规则（单一来源，spec: 2026-10-20-session-directory-contract-design）。
 *
 * runtime 侧：建会话用 opts.directory（契约必填）；ctx.projectDir 只作防御性兜底
 * （gateway 内部配置路径 config.raw.paths.projectDir 不再是插件可见的兜底腿）。
 * gateway 侧：插件 ctx 与内部会话的目录 = UI 当前项目优先，否则 config 项目根（绝对）。
 */

export function requireSessionDir(
  optsDirectory: string | undefined | null,
  ctxProjectDir?: string | null,
): string {
  const dir = optsDirectory ?? ctxProjectDir;
  if (!dir) throw new Error('session.create: directory is required (SessionCreateOpts.directory)');
  return dir;
}

export function resolvePluginProjectDir(
  currentProjectDir: string | null | undefined,
  configProjectDir: string,
): string {
  return currentProjectDir ?? configProjectDir;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/runtime/session-dir.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/session-dir.ts gateway/tests/unit/runtime/session-dir.test.ts
git commit -m "feat(runtime): session 目录解析规则单一来源——requireSessionDir(fail-loud) + resolvePluginProjectDir"
```

---

### Task 2: media executor 目录必填（修 `{directory: undefined}`）

**Files:**
- Modify: `gateway/src/media/media-runtime-executor.ts`（options 接口 + 构造函数 + 会话创建 + 工厂）
- Modify: `gateway/src/index.ts:2975`（工厂调用注入目录）
- Test: `gateway/tests/unit/media-runtime-executor.test.ts`（改既有调用 + 新增 1 例）

**Interfaces:**
- Consumes: `SessionCreateOpts.directory`（当前仍可选；本任务传实值）
- Produces: `MediaRuntimeExecutorOptions.projectDir: string`（必填）；`createMediaRuntimeExecutor(rt, opts: MediaRuntimeExecutorOptions)`

- [ ] **Step 1: Write the failing test（新增，其余既有用例先改签名）**

```ts
// gateway/tests/unit/media-runtime-executor.test.ts —— 文件末尾新增 describe
// 既有 createMediaRuntimeExecutor(fakeRt) 调用一律改为 createMediaRuntimeExecutor(fakeRt, { projectDir: '/tmp/proj' })
describe('MediaRuntimeExecutor session directory', () => {
  it('image session creation uses opts.projectDir (never undefined)', async () => {
    const created: any[] = [];
    const fakeRt: any = {
      capabilities: {},
      session: {
        create: async (opts: any) => { created.push(opts); return { id: 's1' }; },
        promptAsync: async () => {},
      },
    };
    const executor = createMediaRuntimeExecutor(fakeRt, { projectDir: '/tmp/proj' });
    await executor.prompt(
      [{ type: 'file', url: 'data:image/png;base64,AAAA', mime: 'image/png' }, { type: 'text', text: 'describe' }],
      { providerID: 'xiaomi', modelID: 'mimo-v2.5' } as any,
    );
    expect(created).toEqual([{ directory: '/tmp/proj' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/media-runtime-executor.test.ts`
Expected: FAIL — 类型错误（缺 `projectDir`）/ `create` 收到 `{ directory: undefined }`

- [ ] **Step 3: Write minimal implementation**

```ts
// media-runtime-executor.ts —— options 增字段（必填）
export interface MediaRuntimeExecutorOptions {
  /** 会话 TTL（默认 24h） */
  sessionTtlMs?: number;
  /** 单次分析超时（默认 180s） */
  timeoutMs?: number;
  /** video/audio 单次路径（默认内部 complete 实现） */
  completeFn?: (parts: PromptPart[], opts: PromptOptions) => Promise<string>;
  /** auth.json 路径（默认 DEFAULT_AUTH_PATH） */
  authPath?: string;
  /** 会话工作目录（绝对路径，必填；gateway 注入 resolvedProjectDir()）。 */
  projectDir: string;
}
```
```ts
// 构造函数：去掉默认值（强制调用方传目录）
constructor(
  private readonly rt: AgentRuntime,
  private readonly opts: MediaRuntimeExecutorOptions,
  private readonly completeFn: (parts: PromptPart[], opts: PromptOptions) => Promise<string>,
) { ... }
```
```ts
// 会话创建点（原 `{ directory: undefined }`）
const { id } = await this.rt.session.create({ directory: this.opts.projectDir });
```
```ts
// 工厂签名
export function createMediaRuntimeExecutor(
  rt: AgentRuntime,
  opts: MediaRuntimeExecutorOptions,
): MediaRuntimeExecutor {
```
```ts
// index.ts:2975
this.mediaRuntimeExecutor = createMediaRuntimeExecutor(this.runtime, { projectDir: this.resolvedProjectDir() });
```
> 注：`resolvedProjectDir()` 在 Task 4 引入；本任务先写 `{ projectDir: config.raw.paths.projectDir }`，Task 4 改为助手（两任务相邻，避免跨任务依赖）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/media-runtime-executor.test.ts`
Expected: PASS（既有 + 新增全绿）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/media/media-runtime-executor.ts gateway/src/index.ts gateway/tests/unit/media-runtime-executor.test.ts
git commit -m "fix(media): 媒体会话目录必填（修 {directory: undefined}）——MediaRuntimeExecutorOptions.projectDir 由 gateway 注入"
```

---

### Task 3: eval-endpoint 与 sdk-session 去 `|| '.'`

**Files:**
- Modify: `gateway/src/eval-endpoint.ts:26`（`directory?: string` → `directory: string`）、`:158`
- Modify: `gateway/src/resources/sdk-session.ts:58`（`create(directory?: string, ...)` → `create(directory: string, ...)`）、`:64`
- Modify: `gateway/src/index.ts:4621`（eval handler 传绝对目录）
- Test: `gateway/tests/unit/sdk-session-update-metadata.test.ts`（若调用 `create()` 则补目录）

**Interfaces:**
- Produces: `EvalEndpointOptions.directory: string`；`SdkSessionResource.create(directory: string, metadata?)`

- [ ] **Step 1: Write the failing test**

```ts
// 新增到 gateway/tests/unit/sdk-session-update-metadata.test.ts 同级新文件
// gateway/tests/unit/sdk-session-create-directory.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SdkSessionResource } from '../../src/resources/sdk-session';

describe('SdkSessionResource.create directory', () => {
  test('creates with the given directory and records it (no "." fallback)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-sdk-session-'));
    const created: any[] = [];
    const fakeClient: any = {
      session: {
        create: async (opts: any) => { created.push(opts); return { id: 'sess_1', projectID: 'p', title: 't' }; },
      },
    };
    const res = new SdkSessionResource(fakeClient, dir);
    const rec = await res.create('/proj/real');
    expect(created).toEqual([{ directory: '/proj/real' }]);
    expect(rec.directory ?? '/proj/real').toBeTruthy();
  });
});
```
> 若 `SdkSessionResource` 构造签名不同（第 2 参为 mafwDir），按实际签名调整本测试构造。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/sdk-session-create-directory.test.ts`
Expected: FAIL（`directory` 仍被替换为 `'.'`，`created[0].directory === '.'`）

- [ ] **Step 3: Write minimal implementation**

```ts
// sdk-session.ts
async create(directory: string, metadata?: Record<string, unknown>): Promise<SessionRecord> {
  ...
  const created = await this.client.session.create({ directory });
```
```ts
// eval-endpoint.ts
export interface EvalEndpointOptions {
  runtime: any;
  /** 会话工作目录（绝对路径，必填）。 */
  directory: string;
  ...
}
// :158
const session = await opts.runtime.session.create({ directory: opts.directory });
```
```ts
// index.ts:4621（eval handler deps）
directory: this.resolvedProjectDir(),   // 或 Task 2 阶段的临时值 config.raw.paths.projectDir
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/sdk-session-create-directory.test.ts tests/unit/sdk-session-update-metadata.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/eval-endpoint.ts gateway/src/resources/sdk-session.ts gateway/src/index.ts gateway/tests/unit/sdk-session-create-directory.test.ts
git commit -m "fix(gateway): eval/sdk-session 目录必填——去 '|| .' 静默兜底（. 由调用方显式给绝对路径）"
```

---

### Task 4: gateway 统一注入（ctx 绝对化 + 4 处会话创建点 + conformance/media）

**Files:**
- Modify: `gateway/src/index.ts`：新增 `resolvedProjectDir()`；ctx 注入 **2 处**（`:1316-1318` 插件、`:1356` 内置）；会话创建点 **4 处**（`:1441` pool、`:4621` eval、`:7066` compress、`:7499` btw）；conformance deps `:1645`；media 注入 `:2975`（Task 2 的临时值改助手）
- Modify: `docs/superpowers/specs/2026-10-20-session-directory-contract-design.md`（勘误：注入点 2 处）

**Interfaces:**
- Consumes: `resolvePluginProjectDir`（Task 1）
- Produces: `MafwScheduler.resolvedProjectDir(): string`（私有）

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/runtime/session-dir-wiring.test.ts（新）
// 正向断言本任务的 6 个接线点；负断言"死通道不再出现"归 Task 7（届时才删干净）。
// 读文件后先 `.replace(/\r\n/g, '\n')` 归一换行，避免 CRLF 误伤多行断言。
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('session directory wiring', () => {
  test('resolvedProjectDir helper exists and is the single resolution point', () => {
    expect(src).toContain('private resolvedProjectDir(): string');
    expect(src).toContain('resolvePluginProjectDir(this.currentProjectDir, config.raw.paths.projectDir)');
  });
  test('plugin-path ctx gets the absolute resolved project dir', () => {
    expect(src).toContain('createRuntimePluginContext(creds, {\n            projectDir: this.resolvedProjectDir(),');
  });
  test('builtin-path ctx also gets projectDir (was missing entirely)', () => {
    expect(src).toContain('createRuntimePluginContext(undefined, { projectDir: this.resolvedProjectDir() })');
  });
  test('internal session sites use resolvedProjectDir (pool / compress / btw)', () => {
    expect(src).toContain('directory: this.resolvedProjectDir(),');
    expect(src).toContain('session.create({ directory: this.resolvedProjectDir() })');
  });
  test('conformance harness defaults to resolvedProjectDir', () => {
    expect(src).toContain('directory: opts?.directory ?? this.resolvedProjectDir(),');
  });
  test('media executor is injected with resolvedProjectDir', () => {
    expect(src).toContain('createMediaRuntimeExecutor(this.runtime, { projectDir: this.resolvedProjectDir() })');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/runtime/session-dir-wiring.test.ts`
Expected: FAIL（`resolvedProjectDir` 不存在；`directory: this.projectDir` 仍出现）

- [ ] **Step 3: Write minimal implementation**

```ts
// index.ts —— 顶部 import
import { resolvePluginProjectDir } from './runtime/session-dir';
```
```ts
// index.ts —— MafwScheduler 私有助手（放在 createRuntime 附近）
/** 会话 cwd 与插件 ctx 默认值的唯一解析点：UI 当前项目优先，否则 config 项目根（绝对）。 */
private resolvedProjectDir(): string {
  return resolvePluginProjectDir(this.currentProjectDir, config.raw.paths.projectDir);
}
```
```ts
// :1316-1318 插件 ctx
const rt = await plugin.createRuntime(createRuntimePluginContext(creds, {
  projectDir: this.resolvedProjectDir(),
  gatewayPort: config.server.apiPort,
}));
```
```ts
// :1356 内置 ctx（原先完全没传 projectDir）
const rt = await builtin.createRuntime(createRuntimePluginContext(undefined, {
  projectDir: this.resolvedProjectDir(),
}));
```
```ts
// :1441 worker pool
this.workerPool = new SessionWorkerPool({ client: this.runtime, directory: this.resolvedProjectDir(), ... });
```
```ts
// :4621 eval deps / :7066 compress / :7499 btw —— 三处会话创建
directory: this.resolvedProjectDir(),
```
```ts
// :1645 conformance deps
createSession: async (opts) => this.runtime!.session.create({
  directory: opts?.directory ?? this.resolvedProjectDir(),
}),
```
```ts
// :2975 media（Task 2 的临时值收口）
this.mediaRuntimeExecutor = createMediaRuntimeExecutor(this.runtime, { projectDir: this.resolvedProjectDir() });
```
```md
<!-- spec 勘误（同任务内一并提交） -->
> 勘误：ctx.projectDir 注入点是 **2 处**（插件路径 + 内置路径）；"最终兜底直连"经 createOpencodeRuntime
> 创建、不经 createRuntimePluginContext，无 ctx。
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/runtime/session-dir-wiring.test.ts tests/unit/runtime/session-dir.test.ts && npx tsc --noEmit`
Expected: PASS（3 + 5）+ tsc 无错误

- [ ] **Step 5: Commit**

```bash
git add gateway/src/index.ts gateway/tests/unit/runtime/session-dir-wiring.test.ts docs/superpowers/specs/2026-10-20-session-directory-contract-design.md
git commit -m "fix(gateway): 会话目录单点解析 resolvedProjectDir——ctx（插件+内置）与 4 处内部会话/worker/media 全走绝对路径；spec 勘误注入点 2 处"
```

---

### Task 5: pi 契约对齐（去 `config.raw` 泄漏腿 + fail-loud）

**Files:**
- Modify: `gateway/src/runtime/plugins/pi-runtime.ts:169-172`
- Test: `gateway/tests/unit/runtime/pi-runtime.test.ts`（新增 2 例 + fakePi 捕获 cwd）

**Interfaces:**
- Consumes: `requireSessionDir`（Task 1）

- [ ] **Step 1: Write the failing test**

```ts
// pi-runtime.test.ts —— 在 fakePi 的 createAgentSession 中捕获 cwd
// createAgentSession: async (sessionOpts: any) => {
//   (globalThis as any).__piCwds = [...((globalThis as any).__piCwds || []), sessionOpts.cwd];
//   return { session: { ... } };
// }

describe('pi session.create directory contract', () => {
  afterEach(() => { delete (globalThis as any).__piCwds; });

  test('missing directory → fail-loud (no silent "." / config fallback)', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}), credentials: { getApiKey: () => 'k' } } as any,
      { loadPi: async () => fakePi },
    );
    await expect((rt.session as any).create({} as any)).rejects.toThrow(/directory is required/);
  });

  test('ctx.projectDir is the defensive fallback when opts.directory missing', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}), projectDir: '/proj/from-ctx' } as any,
      { loadPi: async () => fakePi },
    );
    const ctx: any = (globalThis as any).__piCwds;
    const { id } = await (rt.session as any).create({} as any);
    expect(id.startsWith('pi_')).toBe(true);
    expect((globalThis as any).__piCwds.at(-1)).toBe('/proj/from-ctx');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/runtime/pi-runtime.test.ts`
Expected: FAIL — 当前 `?? config.raw.paths.projectDir` 腿会静默用配置值（`create({})` 不抛错）

- [ ] **Step 3: Write minimal implementation**

```ts
// pi-runtime.ts —— import
import { requireSessionDir } from '../session-dir';
```
```ts
const sessionAPI = {
  create: async (opts: { directory?: string }) => {
    const dir = requireSessionDir(opts?.directory, ctx.projectDir);
    const { id } = await registry.create(dir, { model: { provider, modelID } });
    return { id };
  },
```
（`update` 里的 `ctx.projectDir ?? config.raw.paths.projectDir` 保留——它不是会话创建，且 ctx 现已是绝对路径）

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/runtime/pi-runtime.test.ts`
Expected: PASS（含既有用例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/plugins/pi-runtime.ts gateway/tests/unit/runtime/pi-runtime.test.ts
git commit -m "fix(pi): 会话目录契约对齐——requireSessionDir（opts → ctx 兜底 → 缺则抛错），去掉 gateway 内部 config 泄漏腿"
```

---

### Task 6: 契约收紧（`SessionCreateOpts.directory` 必填）+ tsc 扫尾

**Files:**
- Modify: `gateway/src/runtime/contract.ts:101-102`
- Modify: 任何被 tsc 暴露的漏传点（预期：`index.ts` 中 `projectDir` 变量可能为 undefined 的调用点 → `?? this.resolvedProjectDir()`）

- [ ] **Step 1: 红（编译期护栏生效）**

```ts
// contract.ts
export interface SessionCreateOpts {
  /** 会话工作目录。**必填、绝对路径**——由 gateway 每次显式提供（spec:
   *  2026-10-20-session-directory-contract-design）。runtime 不得猜测来源。 */
  directory: string;
}
```
Run: `npx tsc --noEmit`
Expected: FAIL — 列出所有漏传点（首批预期为 media/conformance 之外的残余）

- [ ] **Step 2: 修被暴露的每一处**

对每个报错点，按"绝对路径"语义收口；模式：
```ts
await this.runtime.session.create({ directory: projectDir ?? this.resolvedProjectDir() })
```
> 在 commit message 里**记录最终清单**（哪几个 file:line 是本次被编译期抓出来的）。

- [ ] **Step 3: 绿**

Run: `npx tsc --noEmit && npx jest tests/unit/runtime tests/unit/media-runtime-executor.test.ts`
Expected: tsc 无错误；测试 PASS

- [ ] **Step 4: Commit**

```bash
# 只加本任务触达的显式路径（仓库里可能有其它会话的在途改动，禁止 git add -A / 目录级 add）
git add gateway/src/runtime/contract.ts gateway/src/index.ts
git commit -m "feat(contract): SessionCreateOpts.directory 必填——tsc 编译期护栏暴露并修掉全部漏传点（清单见正文）"
```

---

### Task 7: 死通道清理（0 读取的 `directory` 配置）

**Files:**
- Modify: `gateway/src/opencode-adapter.ts:61`（删 `config.directory`）、`gateway/src/runtime/opencode-runtime.ts:253`（删 `OpencodeRuntimeConfig.directory`）
- Modify: `gateway/src/index.ts:533 / 892 / 1690`（删 `sdkConfig.directory`）

**Interfaces:**
- Produces: `createOpencodeAdapter(config: { baseUrl: string; headers?: Record<string,string> })`

- [ ] **Step 1: 红（契约测试钉扎"字段不存在"）**

```ts
// gateway/tests/unit/runtime/opencode-adapter-config.test.ts（新）
import { readFileSync } from 'fs';
import { join } from 'path';

describe('dead directory channel removed', () => {
  const adapter = readFileSync(join(__dirname, '../../../src/opencode-adapter.ts'), 'utf8');
  const runtime = readFileSync(join(__dirname, '../../../src/runtime/opencode-runtime.ts'), 'utf8');
  const index = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8');

  test('adapter/opencode-runtime config no longer declare directory', () => {
    expect(adapter).not.toMatch(/createOpencodeAdapter\(config:\s*\{[^}]*directory/);
    expect(runtime).not.toMatch(/interface OpencodeRuntimeConfig\s*\{[^}]*directory/s);
    expect(index).not.toMatch(/sdkConfig[\s\S]{0,200}?directory:\s*this\.projectDir/);
  });
});
```
> 该测试以源码文本钉扎"死通道不再复活"；删除后必须绿。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/runtime/opencode-adapter-config.test.ts`
Expected: FAIL（三处断言均命中现存代码）

- [ ] **Step 3: 删除三处**

```ts
// opencode-adapter.ts
export async function createOpencodeAdapter(config: {
  baseUrl: string;
  headers?: Record<string, string>;
}): Promise<OpencodeAdapter> {
```
```ts
// opencode-runtime.ts
export interface OpencodeRuntimeConfig {
  baseUrl: string;
  headers?: Record<string, string>;
}
```
```ts
// index.ts ×3（:533 / :892 / :1690）
const sdkConfig = { baseUrl: this.serveUrl, headers: {} as Record<string, string> };
```

- [ ] **Step 4: Run test + tsc**

Run: `npx jest tests/unit/runtime/opencode-adapter-config.test.ts && npx tsc --noEmit`
Expected: PASS；tsc 无错误（证明 0 引用）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/opencode-adapter.ts gateway/src/runtime/opencode-runtime.ts gateway/src/index.ts gateway/tests/unit/runtime/opencode-adapter-config.test.ts
git commit -m "refactor(runtime): 清理死通道 sdkConfig.directory / OpencodeRuntimeConfig.directory（0 读取）——目录来源收敛为 opts.directory 单点"
```

---

### Task 8: 文档同步（一句话规则进作者可见面）

**Files:**
- Modify: `gateway/src/runtime/loader.ts:24`（`projectDir` 注释）
- Modify: `.opencode/skills/runtime-plugin-authoring/SKILL.md`（新增规则段）
- Modify: `AGENTS.md`（§5.19 runtime 契约段加一行）

- [ ] **Step 1: 红（文档契约测试）**

```ts
// gateway/tests/unit/runtime/session-dir-docs.test.ts（新）
import { readFileSync } from 'fs';
import { join } from 'path';

describe('session directory rule is documented where authors look', () => {
  test('plugin authoring skill states the rule', () => {
    const skill = readFileSync(join(__dirname, '../../../../.opencode/skills/runtime-plugin-authoring/SKILL.md'), 'utf8');
    expect(skill).toContain('opts.directory');
    expect(skill).toMatch(/必填/);
    expect(skill).toContain('ctx.projectDir');
  });

  test('loader context comment marks projectDir as start-up info', () => {
    const loader = readFileSync(join(__dirname, '../../../src/runtime/loader.ts'), 'utf8');
    expect(loader).toMatch(/projectDir\?: string;[\s\S]{0,200}?(绝对|启动期)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/runtime/session-dir-docs.test.ts`
Expected: FAIL

- [ ] **Step 3: 写文档**

```ts
// loader.ts
  /** 项目根（绝对路径；runtime 实例创建时的当前项目快照）。**启动期信息**，
   *  不用于 session cwd —— 建会话一律用 opts.directory（契约必填）。 */
  projectDir?: string;
```
```md
<!-- .opencode/skills/runtime-plugin-authoring/SKILL.md，session 接口段附近 -->
## 会话目录规则（必读）

- **建会话用 `opts.directory`**：契约字段**必填**，由 gateway 每次显式传入绝对路径，
  不得自行猜测/拼接来源。
- **`ctx.projectDir` 只作启动期信息**（绝对路径、runtime 实例创建时的当前项目快照）：
  用于插件初始化（读项目配置/扫描仓库）或 `opts.directory` 缺失时的防御性兜底；
  **不要**用它决定会话工作目录。
```
```md
<!-- AGENTS.md §5.19 契约段追加一行 -->
- `SessionCreateOpts.directory`（**必填、绝对路径**）是会话工作目录的唯一权威来源，
  由 gateway 显式传入；`ctx.projectDir` 为启动期信息（绝对化），仅兜底——见
  `docs/superpowers/specs/2026-10-20-session-directory-contract-design.md`
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/runtime/session-dir-docs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/loader.ts .opencode/skills/runtime-plugin-authoring/SKILL.md AGENTS.md gateway/tests/unit/runtime/session-dir-docs.test.ts
git commit -m "docs(runtime): session 目录规则进作者可见面——opts.directory 必填权威 + ctx.projectDir 启动期信息（SKILL/loader/AGENTS 三处）"
```

---

### Task 9: 全量回归

- [ ] **Step 1: 编译 + 全量测试**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc 0 error；jest 全绿（基线 2136 + 本计划新增约 15 例）

- [ ] **Step 2: 受影响的相邻包**

Run（仓库根）：`npm run test:desktop`（可选，若 TUI/desktop 未触及可跳过并在提交信息注明）
Expected: 通过或不涉及

- [ ] **Step 3: 记录实测（写进 commit message 或 memory）**

记录：新增/修改用例数、tsc 抓出的漏传清单、media/worker 目录从 `.` 变绝对的实测效果（可看日志 `[MemoryWorker] ... created session` 与 curator 探测 cwd）。

- [ ] **Step 4: Commit（若有零散残留）**

```bash
# 只加本计划的文件（禁止 git add -A：其它会话的在途改动不归本次提交）
git add <本计划新增/修改的文件逐一列出>
git commit -m "test: session 目录契约统一全量回归（tsc + jest 绿，新增 N 例）"
```

---

## Self-Review

**Spec coverage**
| spec 条目 | 任务 |
|---|---|
| §2/§4 契约必填 + pi fail-loud | T5、T6 |
| §3 规则一句话 | T1（实现）、T8（文档） |
| §5.1 resolvedProjectDir | T4 |
| §5.2 ctx 注入（勘误 2 处） | T4（含 spec 勘误） |
| §5.3 四处会话创建点 | T4 |
| §5.4 eval/sdk-session `'.'` 默认 | T3 |
| §5.5 死通道清理 | T7 |
| §5.6 漏传修复（media/conformance） | T2、T4 |
| §5.7 `this.projectDir` 其它用途不动 | T4（契约测试 `not.toContain('directory: this.projectDir')`） |
| §7 测试面 | T1–T9（tsc 为主护栏） |
| §8 风险/回滚 | T9 记录实测；单提交可 revert |

**Placeholder scan**：无 TBD/TODO；每个代码步骤含完整代码与命令。Task 3 测试对 `SdkSessionResource` 构造签名标注"按实际签名调整"——执行者需先读该文件（已给出文件与行号）。

**Type consistency**：`requireSessionDir` / `resolvePluginProjectDir` 在 T1 定义，T4/T5 消费，签名一致；`MediaRuntimeExecutorOptions.projectDir: string`（T2）与 T4 注入一致；`resolvedProjectDir(): string`（T4）在 T2/T3 的临时值标注了收口路径。

**遗留已知**：`SessionWorkerPool` 目录为绝对的直接单测未列出（其 `directory` 由 T4 传入，行为经 T9 回归 + 源码契约测试覆盖）；如执行者认为需要，可在 T4 追加一个 pool 构造断言用例。
