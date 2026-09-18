# Slash 命令单一注册表 + 用户自定义命令 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 gateway `/api/mafw-commands/run` 的硬编码 if 链收敛为带元数据的命令注册表，新增 `GET /api/mafw-commands` 清单端点与用户自定义 markdown 命令系统（`$ARGUMENTS`/`!shell`/`@file` 模板注入、热重载），TUI/Desktop/插件三端统一从注册表拉取命令。

**Architecture:** 注册表真源在 gateway（`gateway/src/commands/registry.ts`）：内置命令（6 条，handler deps 注入可单测）+ 自定义命令（`~/.mafw/commands/` 用户级 + `<project>/.mafw/commands/` 项目级 markdown 文件，项目覆盖同名用户级）。客户端（TUI/Desktop）启动/打开面板时经 SDK `mafwCommands.list()` 拉取，本地命令与远端命令合并（本地优先），未命中本地注册表的 slash 命令 fallback 到 `mafwCommands.run`。

**Tech Stack:** TypeScript（gateway CJS/tsc + jest；TUI ESM/node --test；SDK bun test + openapi-typescript；desktop SolidJS + bun test）

## Global Constraints

- 用户偏好：**TDD 先行**（先写失败测试再实现）；交付时汇报**新增测试数 + 全量通过数**；版本号与 commit 哈希显式记录。
- **git commit 必须逐次向用户确认**（环境规则优先于本计划中的 commit 步骤；执行时每到一个 commit 步骤先问）。
- TUI 源码**禁用 TS parameter properties**（Node strip-only 不支持）；相对 import 用 `.ts` 后缀。
- gateway 路由模块遵循既有模式：deps 注入纯函数/类（参考 `gateway/src/routes/waitwhat-command.ts`、`note-board.ts`），index.ts 只做薄接线。
- openapi.json 是 SDK-facing 路由的权威——先改 openapi.json，再同步 `route-catalog.ts` SDK_FACING_ROUTES 与 `api-schema.gen.ts`（`npm run gen:api`）。
- 代码注释用中文，风格与既有文件一致。
- 完工后需更新 `AGENTS.md`（§4/§5 相关段落）与 `docs/architecture/gateway.md`、`docs/architecture/plugin.md`。
- gateway 改动生效需走 mafw-gateway-restart 流程（写 pending-restart 令牌自更新）。

## 命名与语义决议（执行前已与用户确认方向，以下为定论）

- gateway 注册表命令保持现有 6 个名字：`goal / new-topic / btw / waitwhat / status / merge-memory`；`new-topic` 增加别名 `new`。
- 客户端合并规则：**本地命令优先**；远端命令名或别名与本地冲突时隐藏远端（TUI `/new`=rotate、桌面 `/new`=新建会话，两者语义不同，各保本地）。
- TUI `/status`（本地会话 recap）与 gateway `status`（MAFW 状态）冲突 → 远端 `status` 在 TUI 隐藏（本地优先规则自然生效），TUI 用户可用 Goals tab 看 MAFW 状态。
- 自定义命令目录：用户级 `~/.mafw/commands/`、项目级 `<projectDir>/.mafw/commands/`；子目录即命名空间（`git/commit.md` → `git:commit`）；同名项目级覆盖用户级。
- 自定义命令执行 = 渲染模板后 promptAsync 到 `sessionID`（调用方传入）或该项目的 manager session（兜底）。

---

### Task 1: Gateway 命令注册表模块

**Files:**
- Create: `gateway/src/commands/registry.ts`
- Test: `gateway/tests/unit/mafw-command-registry.test.ts`

**Interfaces:**
- Produces（后续所有任务依赖）:
  - `MafwCommandDef { name: string; aliases?: string[]; description: string; argumentHint?: string; category: 'goals'|'session'|'memory'|'custom'; destructive?: boolean; kind: 'builtin'|'custom'; source?: string }`
  - `MafwCommandContext { args: string; sessionID?: string; projectDir: string }`
  - `MafwCommandResult { ok: boolean; message?: string; text?: string; error?: string; [k: string]: unknown }`
  - `MafwCommandHandler = (ctx: MafwCommandContext) => Promise<MafwCommandResult>`
  - `class MafwCommandRegistry { register(def, handler): void; unregister(name): void; resolve(nameOrAlias): { def, handler } | null; list(): MafwCommandDef[] }`
  - `BUILTIN_COMMAND_DEFS: MafwCommandDef[]`（6 条元数据，无 handler）

- [ ] **Step 1: 写失败测试** `gateway/tests/unit/mafw-command-registry.test.ts`

```typescript
import { MafwCommandRegistry, BUILTIN_COMMAND_DEFS } from '../../src/commands/registry';

describe('MafwCommandRegistry', () => {
  test('register + resolve by name', () => {
    const r = new MafwCommandRegistry();
    const handler = async () => ({ ok: true });
    r.register({ name: 'btw', description: '支线问答', category: 'session', kind: 'builtin' }, handler);
    expect(r.resolve('btw')?.handler).toBe(handler);
  });

  test('resolve by alias returns canonical def', () => {
    const r = new MafwCommandRegistry();
    r.register({ name: 'new-topic', aliases: ['new'], description: '新话题', category: 'session', kind: 'builtin' }, async () => ({ ok: true }));
    expect(r.resolve('new')?.def.name).toBe('new-topic');
  });

  test('resolve unknown returns null', () => {
    expect(new MafwCommandRegistry().resolve('nope')).toBeNull();
  });

  test('list returns defs without handlers, aliases included', () => {
    const r = new MafwCommandRegistry();
    r.register({ name: 'a', aliases: ['b'], description: 'd', category: 'session', kind: 'builtin' }, async () => ({ ok: true }));
    const list = r.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'a', aliases: ['b'] });
    expect((list[0] as any).handler).toBeUndefined();
  });

  test('re-register same name overwrites (custom reload)', () => {
    const r = new MafwCommandRegistry();
    r.register({ name: 'x', description: 'v1', category: 'custom', kind: 'custom' }, async () => ({ ok: true, message: 'v1' }));
    r.register({ name: 'x', description: 'v2', category: 'custom', kind: 'custom' }, async () => ({ ok: true, message: 'v2' }));
    expect(r.list()[0].description).toBe('v2');
  });

  test('unregister removes name and aliases', () => {
    const r = new MafwCommandRegistry();
    r.register({ name: 'x', aliases: ['y'], description: 'd', category: 'custom', kind: 'custom' }, async () => ({ ok: true }));
    r.unregister('x');
    expect(r.resolve('x')).toBeNull();
    expect(r.resolve('y')).toBeNull();
  });

  test('BUILTIN_COMMAND_DEFS covers the 6 legacy commands with metadata', () => {
    const names = BUILTIN_COMMAND_DEFS.map((d) => d.name).sort();
    expect(names).toEqual(['btw', 'goal', 'merge-memory', 'new-topic', 'status', 'waitwhat']);
    const nt = BUILTIN_COMMAND_DEFS.find((d) => d.name === 'new-topic');
    expect(nt?.aliases).toContain('new');
    const btw = BUILTIN_COMMAND_DEFS.find((d) => d.name === 'btw');
    expect(btw?.argumentHint).toBe('<问题>');
    const mm = BUILTIN_COMMAND_DEFS.find((d) => d.name === 'merge-memory');
    expect(mm?.argumentHint).toBe('<worktree路径> [strategy]');
    for (const d of BUILTIN_COMMAND_DEFS) expect(d.kind).toBe('builtin');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/mafw-command-registry.test.ts`
Expected: FAIL（`Cannot find module '../../src/commands/registry'`）

- [ ] **Step 3: 实现** `gateway/src/commands/registry.ts`

```typescript
/**
 * MAFW 命令注册表（P0 收敛）：/api/mafw-commands/run 的单一元数据真源。
 * - 内置命令：元数据在 BUILTIN_COMMAND_DEFS，handler 在 builtin-handlers.ts（deps 注入）
 * - 自定义命令：custom-commands.ts 扫描 markdown 文件后 register（kind:'custom'）
 * 客户端（TUI/Desktop）经 GET /api/mafw-commands 拉取 list() 输出做补全/面板。
 */

export type MafwCommandCategory = 'goals' | 'session' | 'memory' | 'custom';

export interface MafwCommandDef {
  name: string;
  aliases?: string[];
  description: string;
  /** 补全提示，如 '<问题>'、'<worktree路径> [strategy]' */
  argumentHint?: string;
  category: MafwCommandCategory;
  /** 破坏性操作：客户端据此弹确认（对齐 TUI COMMAND_REGISTRY 语义） */
  destructive?: boolean;
  kind: 'builtin' | 'custom';
  /** custom：来源文件绝对路径（调试/展示用） */
  source?: string;
}

export interface MafwCommandContext {
  args: string;
  sessionID?: string;
  projectDir: string;
}

export interface MafwCommandResult {
  ok: boolean;
  message?: string;
  text?: string;
  error?: string;
  [k: string]: unknown;
}

export type MafwCommandHandler = (ctx: MafwCommandContext) => Promise<MafwCommandResult>;

interface RegistryEntry {
  def: MafwCommandDef;
  handler?: MafwCommandHandler;
}

export class MafwCommandRegistry {
  private entries = new Map<string, RegistryEntry>();

  register(def: MafwCommandDef, handler?: MafwCommandHandler): void {
    this.entries.set(def.name, { def, handler });
  }

  unregister(name: string): void {
    this.entries.delete(name);
  }

  resolve(nameOrAlias: string): RegistryEntry | null {
    const key = String(nameOrAlias || '').trim().toLowerCase();
    if (!key) return null;
    const direct = this.entries.get(key);
    if (direct) return direct;
    for (const entry of this.entries.values()) {
      if (entry.def.aliases?.includes(key)) return entry;
    }
    return null;
  }

  /** 元数据清单（不含 handler），供 GET /api/mafw-commands 输出。 */
  list(): MafwCommandDef[] {
    return [...this.entries.values()].map((e) => ({ ...e.def }));
  }
}

/** 内置命令元数据（handler 由 builtin-handlers.ts 绑定）。 */
export const BUILTIN_COMMAND_DEFS: MafwCommandDef[] = [
  { name: 'goal', description: '提交新 Goal 给 Manager', argumentHint: '<目标描述>', category: 'goals', kind: 'builtin' },
  { name: 'new-topic', aliases: ['new'], description: '开新话题（当前 Manager 会话归档）', category: 'session', destructive: true, kind: 'builtin' },
  { name: 'btw', description: '支线问答（一次性会话，不污染主线）', argumentHint: '<问题>', category: 'session', kind: 'builtin' },
  { name: 'waitwhat', description: '没听懂：用简明语言+项目术语重述上一条回复', category: 'session', kind: 'builtin' },
  { name: 'status', description: 'MAFW 状态（活跃 Goal 摘要）', category: 'goals', kind: 'builtin' },
  { name: 'merge-memory', description: '跨 worktree 记忆融合', argumentHint: '<worktree路径> [strategy]', category: 'memory', kind: 'builtin' },
];
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway; npx jest tests/unit/mafw-command-registry.test.ts`
Expected: PASS（7 个用例）

- [ ] **Step 5: Commit（先向用户确认）**

```bash
git add gateway/src/commands/registry.ts gateway/tests/unit/mafw-command-registry.test.ts
git commit -m "feat(gateway): MAFW 命令注册表模块（元数据+别名解析）"
```

---

### Task 2: 内置 handler 提取（if 链 → deps 注入函数）

**Files:**
- Create: `gateway/src/commands/builtin-handlers.ts`
- Test: `gateway/tests/unit/mafw-command-builtin-handlers.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `MafwCommandContext`/`MafwCommandResult`/`MafwCommandHandler`；`routes/waitwhat-command.ts` 的 `runWaitwhat(sessionID, deps)` 与 `WaitwhatMessage`。
- Produces:
  - `MafwBuiltinDeps { ensureManagerSession(projectDir): Promise<string>; createSession(projectDir): Promise<string | null>; promptAsync(sessionID, text): Promise<void>; listMessages(sessionID): Promise<WaitwhatMessage[]>; btwAsk(question): Promise<string>; rotateManagerSession(projectDir): Promise<Record<string, unknown> & { sessionId: string }>; mergeMemory(sourceWorktree, strategy): Promise<Record<string, unknown>>; readStatus(): string; llmAvailable(): boolean }`
  - `buildBuiltinHandlers(deps: MafwBuiltinDeps): Map<string, MafwCommandHandler>`（键 = 命令名）

行为逐字搬移 index.ts:3180-3252 的语义：goal 缺 args→400 语义（返回 `{ok:false,error}`，由路由层映射状态码）；goal 优先 manager session、缺失则新建 session；merge-memory 复用 `handleMergeMemory` 的结果解析（`content[0].text` JSON.parse fail-open）。

- [ ] **Step 1: 写失败测试** `gateway/tests/unit/mafw-command-builtin-handlers.test.ts`

```typescript
import { buildBuiltinHandlers, MafwBuiltinDeps } from '../../src/commands/builtin-handlers';

function makeDeps(overrides: Partial<MafwBuiltinDeps> = {}): MafwBuiltinDeps {
  return {
    ensureManagerSession: async () => 'mgr-1',
    createSession: async () => 'new-1',
    promptAsync: async () => {},
    listMessages: async () => [],
    btwAsk: async () => '答案',
    rotateManagerSession: async () => ({ sessionId: 'mgr-2' }),
    mergeMemory: async () => ({ success: true, merged: 3 }),
    readStatus: () => '# STATUS',
    llmAvailable: () => true,
    ...overrides,
  };
}

describe('builtin handlers', () => {
  test('goal requires args', async () => {
    const h = buildBuiltinHandlers(makeDeps()).get('goal')!;
    const r = await h({ args: '', projectDir: '/p' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/goal description required/);
  });

  test('goal prompts manager session with 创建新 Goal prefix', async () => {
    const sent: Array<{ sid: string; text: string }> = [];
    const deps = makeDeps({ promptAsync: async (sid, text) => { sent.push({ sid, text }); } });
    const r = await buildBuiltinHandlers(deps).get('goal')!({ args: '做X', projectDir: '/p' });
    expect(r.ok).toBe(true);
    expect(sent).toEqual([{ sid: 'mgr-1', text: '创建新 Goal：做X' }]);
    expect(r.sessionID).toBe('mgr-1');
  });

  test('goal falls back to new session when no manager; 503 when llm unavailable', async () => {
    const deps = makeDeps({ ensureManagerSession: async () => '', createSession: async () => 'new-9' });
    const r = await buildBuiltinHandlers(deps).get('goal')!({ args: 'x', projectDir: '/p' });
    expect(r.sessionID).toBe('new-9');
    const deps2 = makeDeps({ llmAvailable: () => false });
    const r2 = await buildBuiltinHandlers(deps2).get('goal')!({ args: 'x', projectDir: '/p' });
    expect(r2).toMatchObject({ ok: false, error: 'LLM client not available' });
  });

  test('new-topic returns rotate result', async () => {
    const r = await buildBuiltinHandlers(makeDeps()).get('new-topic')!({ args: '', projectDir: '/p' });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('mgr-2');
  });

  test('btw requires args and returns text', async () => {
    const h = buildBuiltinHandlers(makeDeps()).get('btw')!;
    expect((await h({ args: '', projectDir: '/p' })).ok).toBe(false);
    expect((await h({ args: '问', projectDir: '/p' }))).toMatchObject({ ok: true, text: '答案' });
  });

  test('waitwhat requires sessionID; propagates runWaitwhat failure', async () => {
    const h = buildBuiltinHandlers(makeDeps()).get('waitwhat')!;
    expect((await h({ args: '', projectDir: '/p' })).ok).toBe(false);
    // 无 assistant 消息 → runWaitwhat 返回 ok:false
    const r = await h({ args: '', projectDir: '/p', sessionID: 's1' });
    expect(r).toMatchObject({ ok: false, error: 'no assistant message to re-pitch' });
  });

  test('waitwhat prompts re-pitch into same session', async () => {
    const sent: string[] = [];
    const deps = makeDeps({
      listMessages: async () => [{ info: { role: 'assistant' }, parts: [{ type: 'text', text: '原回复' }] }],
      promptAsync: async (_sid, text) => { sent.push(text); },
    });
    const r = await buildBuiltinHandlers(deps).get('waitwhat')!({ args: '', projectDir: '/p', sessionID: 's1' });
    expect(r.ok).toBe(true);
    expect(sent[0]).toContain('原回复');
  });

  test('status returns STATUS.md content', async () => {
    const r = await buildBuiltinHandlers(makeDeps()).get('status')!({ args: '', projectDir: '/p' });
    expect(r).toMatchObject({ ok: true, text: '# STATUS' });
  });

  test('merge-memory requires path and passes strategy', async () => {
    const h = buildBuiltinHandlers(makeDeps()).get('merge-memory')!;
    expect((await h({ args: '', projectDir: '/p' })).ok).toBe(false);
    const r = await h({ args: '/wt higher_energy', projectDir: '/p' });
    expect(r).toMatchObject({ ok: true, success: true, merged: 3 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/mafw-command-builtin-handlers.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现** `gateway/src/commands/builtin-handlers.ts`

```typescript
/**
 * 内置命令 handler（从 index.ts 原 if 链逐字提取，deps 注入可单测）。
 * 语义不变：返回 { ok:false, error } 由路由层映射 4xx/5xx。
 */
import { runWaitwhat, type WaitwhatMessage } from '../routes/waitwhat-command';
import type { MafwCommandContext, MafwCommandHandler, MafwCommandResult } from './registry';

export interface MafwBuiltinDeps {
  /** 返回 manager sessionId；无 manager 时返回 '' */
  ensureManagerSession(projectDir: string): Promise<string>;
  /** 兜底新建会话，返回 id 或 null */
  createSession(projectDir: string): Promise<string | null>;
  promptAsync(sessionID: string, text: string): Promise<void>;
  listMessages(sessionID: string): Promise<WaitwhatMessage[]>;
  btwAsk(question: string): Promise<string>;
  rotateManagerSession(projectDir: string): Promise<Record<string, unknown> & { sessionId: string }>;
  mergeMemory(sourceWorktree: string, strategy: string): Promise<Record<string, unknown>>;
  readStatus(): string;
  llmAvailable(): boolean;
}

export function buildBuiltinHandlers(deps: MafwBuiltinDeps): Map<string, MafwCommandHandler> {
  const handlers = new Map<string, MafwCommandHandler>();

  handlers.set('goal', async (ctx: MafwCommandContext): Promise<MafwCommandResult> => {
    const argStr = ctx.args.trim();
    if (!argStr) return { ok: false, error: 'goal description required' };
    const manager = await deps.ensureManagerSession(ctx.projectDir).catch(() => '');
    const target = manager || (await deps.createSession(ctx.projectDir));
    if (!target || !deps.llmAvailable()) {
      return { ok: false, error: 'LLM client not available' };
    }
    await deps.promptAsync(target, `创建新 Goal：${argStr}`);
    return { ok: true, message: `Goal 已提交：${argStr}`, sessionID: target };
  });

  handlers.set('new-topic', async (ctx) => {
    const result = await deps.rotateManagerSession(ctx.projectDir);
    return { ok: true, message: `新话题已开启：${result.sessionId}`, ...result };
  });

  handlers.set('btw', async (ctx) => {
    const q = ctx.args.trim();
    if (!q) return { ok: false, error: 'usage: /btw <question>' };
    const answer = await deps.btwAsk(q);
    return { ok: true, text: answer };
  });

  handlers.set('waitwhat', async (ctx) => {
    if (!ctx.sessionID) return { ok: false, error: 'sessionID required' };
    if (!deps.llmAvailable()) return { ok: false, error: 'LLM client not available' };
    const result = await runWaitwhat(ctx.sessionID, {
      listMessages: deps.listMessages,
      promptAsync: deps.promptAsync,
    });
    return result.ok
      ? { ok: true, message: '重述请求已发送到当前会话' }
      : { ok: false, error: result.error };
  });

  handlers.set('status', async () => ({ ok: true, text: deps.readStatus() }));

  handlers.set('merge-memory', async (ctx) => {
    const parts = ctx.args.trim().split(/\s+/);
    const sourceWorktree = parts[0];
    if (!sourceWorktree) return { ok: false, error: 'Usage: /merge-memory <sourceWorktreePath> [strategy]' };
    const parsed = await deps.mergeMemory(sourceWorktree, parts[1] || 'manual');
    return { ok: parsed.success !== false, ...parsed };
  });

  return handlers;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway; npx jest tests/unit/mafw-command-builtin-handlers.test.ts`
Expected: PASS（9 个用例）

- [ ] **Step 5: Commit（先向用户确认）**

```bash
git add gateway/src/commands/builtin-handlers.ts gateway/tests/unit/mafw-command-builtin-handlers.test.ts
git commit -m "feat(gateway): 内置命令 handler 提取为 deps 注入模块"
```

---

### Task 3: 路由模块 + index.ts 换血（含 GET 清单端点）

**Files:**
- Create: `gateway/src/routes/mafw-commands.ts`
- Modify: `gateway/src/index.ts`（替换 3168-3261 的 if 链为薄接线；新增 GET /api/mafw-commands 路由）
- Modify: `gateway/src/routes/route-catalog.ts`（SDK_FACING 块 line 52 后加 GET 条目）
- Test: `gateway/tests/unit/mafw-commands-route.test.ts`

**Interfaces:**
- Consumes: Task 1 registry、Task 2 handlers。
- Produces:
  - `MafwCommandsRouteDeps { registry: MafwCommandRegistry }`
  - `handleMafwCommandRun(deps, body: unknown): Promise<{ status: number; body: any }>`
  - `handleMafwCommandList(deps): { status: number; body: any }`
  - `buildMafwCommandRegistry(builtinDeps: MafwBuiltinDeps): MafwCommandRegistry`（注册 BUILTIN_COMMAND_DEFS + handlers；供 index.ts 与测试共用）

- [ ] **Step 1: 写失败测试** `gateway/tests/unit/mafw-commands-route.test.ts`

```typescript
import { MafwCommandRegistry } from '../../src/commands/registry';
import { handleMafwCommandRun, handleMafwCommandList } from '../../src/routes/mafw-commands';

function makeRegistry(): MafwCommandRegistry {
  const r = new MafwCommandRegistry();
  r.register({ name: 'echo', description: 'd', category: 'custom', kind: 'custom' },
    async (ctx) => ({ ok: true, text: `echo:${ctx.args}@${ctx.projectDir}` }));
  r.register({ name: 'fail', description: 'd', category: 'custom', kind: 'custom' },
    async () => ({ ok: false, error: 'bad args' }));
  r.register({ name: 'boom', description: 'd', category: 'custom', kind: 'custom' },
    async () => { throw new Error('kaboom'); });
  return r;
}

describe('mafw-commands route', () => {
  test('run dispatches by name with args and projectDir', async () => {
    const r = await handleMafwCommandRun({ registry: makeRegistry(), resolveProjectDir: () => '/proj' },
      { command: 'echo', args: 'hi' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, text: 'echo:hi@/proj' });
  });

  test('ok:false result maps to 400', async () => {
    const r = await handleMafwCommandRun({ registry: makeRegistry(), resolveProjectDir: () => '/p' },
      { command: 'fail' });
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
  });

  test('unknown command → 400 Unknown command', async () => {
    const r = await handleMafwCommandRun({ registry: makeRegistry(), resolveProjectDir: () => '/p' },
      { command: 'nope' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Unknown command: nope/);
  });

  test('handler throw → 500 with message', async () => {
    const r = await handleMafwCommandRun({ registry: makeRegistry(), resolveProjectDir: () => '/p' },
      { command: 'boom' });
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('kaboom');
  });

  test('list returns metadata (no handler leak)', () => {
    const r = handleMafwCommandList({ registry: makeRegistry(), resolveProjectDir: () => '/p' });
    expect(r.status).toBe(200);
    expect(r.body.commands.map((c: any) => c.name).sort()).toEqual(['boom', 'echo', 'fail']);
    expect(r.body.commands[0].handler).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/mafw-commands-route.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现** `gateway/src/routes/mafw-commands.ts`

```typescript
/**
 * /api/mafw-commands 路由（UI-driven，刻意不进 MCP）：
 * - POST /run：注册表派发（内置 + 自定义）
 * - GET：命令元数据清单（客户端补全/面板）
 */
import { MafwCommandRegistry, BUILTIN_COMMAND_DEFS } from '../commands/registry';
import { buildBuiltinHandlers, type MafwBuiltinDeps } from '../commands/builtin-handlers';

export interface MafwCommandsRouteDeps {
  registry: MafwCommandRegistry;
  resolveProjectDir(): string;
}

export interface RouteReply {
  status: number;
  body: any;
}

/** 组装注册表：内置元数据 + handler。自定义命令由 index.ts 的 loader 追加注册。 */
export function buildMafwCommandRegistry(builtinDeps: MafwBuiltinDeps): MafwCommandRegistry {
  const registry = new MafwCommandRegistry();
  const handlers = buildBuiltinHandlers(builtinDeps);
  for (const def of BUILTIN_COMMAND_DEFS) {
    registry.register(def, handlers.get(def.name));
  }
  return registry;
}

export async function handleMafwCommandRun(deps: MafwCommandsRouteDeps, rawBody: unknown): Promise<RouteReply> {
  try {
    const body = (rawBody ?? {}) as { command?: unknown; args?: unknown; sessionID?: unknown };
    const cmd = String(body.command || '').trim().toLowerCase();
    const entry = deps.registry.resolve(cmd);
    if (!entry?.handler) {
      return { status: 400, body: { ok: false, error: `Unknown command: ${cmd}` } };
    }
    const result = await entry.handler({
      args: String(body.args || '').trim(),
      sessionID: body.sessionID ? String(body.sessionID) : undefined,
      projectDir: deps.resolveProjectDir(),
    });
    return { status: result.ok ? 200 : 400, body: result };
  } catch (err: any) {
    return { status: 500, body: { ok: false, error: err.message } };
  }
}

export function handleMafwCommandList(deps: MafwCommandsRouteDeps): RouteReply {
  return { status: 200, body: { commands: deps.registry.list() } };
}
```

- [ ] **Step 4: index.ts 薄接线**

`gateway/src/index.ts` 中：

1. 顶部 import 区加：

```typescript
import { buildMafwCommandRegistry, handleMafwCommandRun, handleMafwCommandList } from './routes/mafw-commands';
import type { MafwCommandRegistry } from './commands/registry';
```

2. 类中加私有字段与懒构建方法（放在 `btwAsk` 附近）：

```typescript
private mafwCommandRegistry: MafwCommandRegistry | null = null;

/** 命令注册表懒构建：内置 6 命令 handler 绑定到本类依赖。 */
private getMafwCommandRegistry(): MafwCommandRegistry {
  if (this.mafwCommandRegistry) return this.mafwCommandRegistry;
  this.mafwCommandRegistry = buildMafwCommandRegistry({
    ensureManagerSession: async (projectDir) => {
      const id = await this.ensureManagerSession(projectDir, this.mafwDir).catch(() => '');
      return id || '';
    },
    createSession: async (projectDir) => {
      const s = await this.opencodeClient?.session.create({ directory: projectDir }).catch(() => null);
      return s?.id ?? null;
    },
    promptAsync: async (sid, text) => {
      await this.opencodeClient!.session.promptAsync({ sessionID: sid, parts: [{ type: 'text', text }] });
    },
    listMessages: async (sid) => {
      const r = await this.opencodeClient!.session.messages({ sessionID: sid, limit: 50 });
      return (r?.data || []) as any;
    },
    btwAsk: (q) => this.btwAsk(q),
    rotateManagerSession: (projectDir) => this.rotateManagerSessionFor(projectDir) as any,
    mergeMemory: async (sourceWorktree, strategy) => {
      const { handleMergeMemory } = await import('./mcp/handlers/merge-memory.js');
      const result = await handleMergeMemory({ sourceWorktree, resolveStrategy: strategy } as any, {
        memory: this.memoryService,
      } as any);
      const text = result.content?.[0]?.text || '{}';
      try { return JSON.parse(text); } catch { return { text }; }
    },
    readStatus: () => {
      const statusPath = path.join(this.mafwDir, 'STATUS.md');
      return fs.existsSync(statusPath) ? fs.readFileSync(statusPath, 'utf-8') : 'No active Goals. Use /goal to create one.';
    },
    llmAvailable: () => !!this.opencodeClient,
  });
  return this.mafwCommandRegistry;
}
```

3. 替换 3168-3261 整段 if 块为：

```typescript
        // POST /api/mafw-commands/run — 注册表派发（内置+自定义命令，UI-driven 不进 MCP）
        if (req.url === "/api/mafw-commands/run" && req.method === "POST") {
          const reply = await handleMafwCommandRun(
            {
              registry: this.getMafwCommandRegistry(),
              resolveProjectDir: () => this.registeredProjects.values().next().value?.projectDir || this.projectDir,
            },
            JSON.parse(await readBody(req)),
          );
          res.writeHead(reply.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(reply.body));
          return;
        }

        // GET /api/mafw-commands — 命令元数据清单（客户端补全/面板）
        if (req.url?.match(/^\/api\/mafw-commands(?:\?|$)/) && req.method === "GET") {
          const reply = handleMafwCommandList({ registry: this.getMafwCommandRegistry(), resolveProjectDir: () => this.projectDir });
          res.writeHead(reply.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(reply.body));
          return;
        }
```

注意：GET 路由必须放在 POST `/run` 之后、`/api/merge-memory` 等之前的位置不变（原位置即可，正则带 `(?:\?|$)` 防 query string 失配）。

4. `route-catalog.ts` line 52 后插入：

```typescript
  { method: 'GET', path: '/api/mafw-commands', operationId: 'mafwCommands.list', tags: ['mafwCommands'] },
```

- [ ] **Step 5: 跑测试**

Run: `cd gateway; npx jest tests/unit/mafw-commands-route.test.ts tests/unit/api-contract.test.ts`
Expected: PASS（route 5 个新用例；api-contract 不红——若 contract 测试要求 openapi.json 同步则先跳过失败项，Task 4 补齐）

再跑 gateway 全量确认无回归：`cd gateway; npx jest --silent`

- [ ] **Step 6: Commit（先向用户确认）**

```bash
git add gateway/src/routes/mafw-commands.ts gateway/src/index.ts gateway/src/routes/route-catalog.ts gateway/tests/unit/mafw-commands-route.test.ts
git commit -m "feat(gateway): mafw-commands 收敛注册表派发 + GET 清单端点"
```

---

### Task 4: SDK `mafwCommands.list()` + openapi 契约

**Files:**
- Modify: `packages/gateway-sdk/contract/openapi.json`（加 `GET /api/mafw-commands`）
- Modify: `packages/gateway-sdk/src/types.ts`（`MafwCommandDef` 类型）
- Modify: `packages/gateway-sdk/src/client.ts`（mafwCommands.list）
- Modify: `packages/gateway-sdk/src/api-schema.gen.ts`（`npm run gen:api` 重新生成）
- Test: `packages/gateway-sdk/src/client.test.ts`（追加用例）

**Interfaces:**
- Produces: SDK `client.mafwCommands.list(): Promise<MafwCommandDef[]>`；类型 `MafwCommandDef`（字段与 Task 1 registry 一致）。

- [ ] **Step 1: openapi.json 加路径**（镜像现有 `mafwCommands.run` 的极简风格）

在 `paths` 中 `"/api/mafw-commands/run"` 同级加：

```json
    "/api/mafw-commands": {
      "get": {
        "operationId": "mafwCommands.list",
        "tags": ["mafwCommands"],
        "responses": { "200": { "description": "OK" } }
      }
    },
```

- [ ] **Step 2: 重新生成 schema + 写失败测试**

Run: `cd packages/gateway-sdk; npm run gen:api`

在 `client.test.ts` 追加（参照文件内既有 mock fetch 模式）：

```typescript
  test('mafwCommands.list returns command defs', async () => {
    const defs = [{ name: 'btw', description: '支线问答', argumentHint: '<问题>', category: 'session', kind: 'builtin' }];
    const client = new MafwClient({ baseUrl: 'http://x' });
    (client as any).request = async (path: string) => {
      expect(path).toBe('/api/mafw-commands');
      return { commands: defs };
    };
    const out = await client.mafwCommands.list();
    expect(out).toEqual(defs);
  });

  test('mafwCommands.list empty envelope → []', async () => {
    const client = new MafwClient({ baseUrl: 'http://x' });
    (client as any).request = async () => ({});
    expect(await client.mafwCommands.list()).toEqual([]);
  });
```

Run: `cd packages/gateway-sdk; bun test src/client.test.ts`
Expected: FAIL（`client.mafwCommands.list is not a function`）

- [ ] **Step 3: 实现**

`types.ts` 追加（找 `MafwCommandResult` 定义处旁边）：

```typescript
/** MAFW 命令元数据（GET /api/mafw-commands） */
export interface MafwCommandDef {
  name: string
  aliases?: string[]
  description: string
  argumentHint?: string
  category: 'goals' | 'session' | 'memory' | 'custom'
  destructive?: boolean
  kind: 'builtin' | 'custom'
  source?: string
}
```

`client.ts` 的 `mafwCommands` 命名空间（line 298-305）扩展为：

```typescript
  mafwCommands = {
    run: async (params: { command: string; args?: string; sessionID?: string }): Promise<MafwCommandResult> => {
      return this.request<MafwCommandResult>('/api/mafw-commands/run', {
        method: 'POST',
        body: JSON.stringify(params),
      })
    },
    /** 命令元数据清单（补全/面板）；网关不可达时由调用方 catch 兜底。 */
    list: async (): Promise<MafwCommandDef[]> => {
      const data = await this.request<{ commands?: MafwCommandDef[] }>('/api/mafw-commands')
      return data.commands || []
    },
  }
```

- [ ] **Step 4: 跑测试**

Run: `cd packages/gateway-sdk; bun test; npm run typecheck`
Expected: 全 PASS；typecheck 干净

再跑 gateway contract 测试确认 catalog/openapi 同步：`cd gateway; npx jest tests/unit/api-contract.test.ts`

- [ ] **Step 5: Commit（先向用户确认）**

```bash
git add packages/gateway-sdk
git commit -m "feat(sdk): mafwCommands.list + MafwCommandDef 类型 + openapi 契约"
```

---

### Task 5: 自定义命令加载器 + 模板引擎

**Files:**
- Create: `gateway/src/commands/custom-commands.ts`
- Test: `gateway/tests/unit/custom-commands.test.ts`

**Interfaces:**
- Consumes: 无（纯模块）；产出被 Task 6 消费。
- Produces:
  - `CustomCommandSpec { name: string; description: string; argumentHint?: string; template: string; sourceFile: string }`
  - `parseCommandFile(content: string, name: string, sourceFile: string): CustomCommandSpec | null`（frontmatter `description`/`argument-hint`，无 frontmatter 也接受纯模板）
  - `splitArgs(args: string): string[]`（双引号感知）
  - `renderTemplate(template, args, deps: { exec(cmd): Promise<string>; readFile(rel): Promise<string> }): Promise<string>`
  - `scanCommandDirs(dirs: { dir: string; scope: 'user'|'project' }[]): Promise<CustomCommandSpec[]>`（递归 `.md`，子目录冒号命名空间，project 覆盖同名 user）
  - `watchCommandDirs(dirs, onChange: (specs) => void): () => void`（fs.watch + 300ms 防抖；返回 dispose）

模板语法（opencode/Gemini 对齐）：
- `$ARGUMENTS` = 全部参数原文；`$1..$N` = 位置参数
- `` !`cmd` `` = shell 注入（cwd=projectDir，30s 超时，1MB cap；块内 `$` 参数替换时做 shell 转义防注入）；执行失败输出 `[命令失败 (exit N): stderr 摘要]`
- `@path` = 文件内容注入（相对 projectDir；不存在/超 100KB → `[无法读取文件: path]` 占位不炸）

- [ ] **Step 1: 写失败测试** `gateway/tests/unit/custom-commands.test.ts`

```typescript
import { parseCommandFile, splitArgs, renderTemplate, scanCommandDirs } from '../../src/commands/custom-commands';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('parseCommandFile', () => {
  test('frontmatter + template', () => {
    const s = parseCommandFile('---\ndescription: 跑测试\nargument-hint: "[scope]"\n---\n跑全部测试 $ARGUMENTS\n', 'test', '/f/test.md');
    expect(s).toMatchObject({ name: 'test', description: '跑测试', argumentHint: '[scope]', template: '跑全部测试 $ARGUMENTS' });
  });
  test('no frontmatter → whole body is template, description from first line', () => {
    const s = parseCommandFile('总结一下改动\n', 'sum', '/f/sum.md');
    expect(s).toMatchObject({ name: 'sum', template: '总结一下改动' });
    expect(s?.description).toBe('总结一下改动');
  });
  test('empty template → null', () => {
    expect(parseCommandFile('---\ndescription: x\n---\n\n', 'e', '/f/e.md')).toBeNull();
  });
});

describe('splitArgs', () => {
  test('respects double quotes', () => {
    expect(splitArgs('a "b c" d')).toEqual(['a', 'b c', 'd']);
    expect(splitArgs('')).toEqual([]);
  });
});

describe('renderTemplate', () => {
  const deps = {
    exec: async (cmd: string) => cmd === 'fail' ? Promise.reject(new Error('exit 1')) : `OUT(${cmd})`,
    readFile: async (rel: string) => rel === 'ok.md' ? 'FILE-CONTENT' : Promise.reject(new Error('ENOENT')),
  };
  test('$ARGUMENTS and positional', async () => {
    expect(await renderTemplate('A=$ARGUMENTS B=$1 C=$2', 'x "y z"', deps)).toBe('A=x "y z" B=x C=y z');
  });
  test('shell injection with escaped args inside block', async () => {
    expect(await renderTemplate('R: !`grep $1 .`', 'a"b', deps)).toBe('R: OUT(grep a\\"b .)');
  });
  test('shell failure → inline error note', async () => {
    expect(await renderTemplate('!`fail`', '', deps)).toMatch(/\[命令失败/);
  });
  test('@file injection, missing → placeholder', async () => {
    expect(await renderTemplate('see @ok.md and @no.md', '', deps)).toBe('see FILE-CONTENT and [无法读取文件: no.md]');
  });
  test('processing order: @file before shell before args', async () => {
    // $ARGUMENTS 里的 "@x" 不应被二次展开（替换顺序保证）
    expect(await renderTemplate('$1', '@ok.md', deps)).toBe('@ok.md');
  });
});

describe('scanCommandDirs', () => {
  test('recursive .md, subdir namespacing, project overrides user', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-cmd-'));
    const userDir = path.join(root, 'user');
    const projDir = path.join(root, 'proj');
    fs.mkdirSync(path.join(userDir, 'git'), { recursive: true });
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, 'deploy.md'), '---\ndescription: 用户级部署\n---\ndeploy user');
    fs.writeFileSync(path.join(userDir, 'git', 'commit.md'), 'commit template');
    fs.writeFileSync(path.join(projDir, 'deploy.md'), '---\ndescription: 项目级部署\n---\ndeploy proj');
    fs.writeFileSync(path.join(projDir, 'notmd.txt'), 'ignored');
    const specs = await scanCommandDirs([{ dir: userDir, scope: 'user' }, { dir: projDir, scope: 'project' }]);
    const byName = new Map(specs.map((s) => [s.name, s]));
    expect(byName.get('deploy')?.template).toBe('deploy proj');
    expect(byName.get('git:commit')?.template).toBe('commit template');
    expect(byName.has('notmd')).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
  test('missing dir → skipped', async () => {
    expect(await scanCommandDirs([{ dir: '/nonexistent-xyz', scope: 'user' }])).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/custom-commands.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现** `gateway/src/commands/custom-commands.ts`

```typescript
/**
 * 用户自定义命令（opencode/Gemini CLI 对齐）：
 * - 目录：用户级 ~/.mafw/commands/ + 项目级 <project>/.mafw/commands/
 * - 文件名即命令名；子目录即命名空间（git/commit.md → git:commit）
 * - frontmatter：description / argument-hint
 * - 模板：$ARGUMENTS、$1..$N、!`shell`（块内参数 shell 转义）、@file 注入
 */
import * as fs from 'fs';
import * as path from 'path';

export interface CustomCommandSpec {
  name: string;
  description: string;
  argumentHint?: string;
  template: string;
  sourceFile: string;
}

/** 解析 markdown 命令文件；空模板返回 null。 */
export function parseCommandFile(content: string, name: string, sourceFile: string): CustomCommandSpec | null {
  let description = '';
  let argumentHint: string | undefined;
  let body = content;
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
      if (!kv) continue;
      const value = kv[2].trim().replace(/^["']|["']$/g, '');
      if (kv[1] === 'description') description = value;
      if (kv[1] === 'argument-hint') argumentHint = value;
    }
    body = content.slice(m[0].length);
  }
  const template = body.trim();
  if (!template) return null;
  if (!description) description = template.split(/\r?\n/)[0].slice(0, 60);
  return { name, description, argumentHint, template, sourceFile };
}

/** 双引号感知分词："a b" 视为一个参数。 */
export function splitArgs(args: string): string[] {
  const out: string[] = [];
  for (const m of args.matchAll(/"([^"]*)"|(\S+)/g)) {
    out.push(m[1] ?? m[2]);
  }
  return out;
}

/** shell 块内参数转义（防注入，对齐 Gemini {{args}} 在 !{} 内的语义）。 */
function shellEscape(arg: string): string {
  return arg.replace(/(["`\\$])/g, '\\$1');
}

function substituteArgs(text: string, args: string[], rawArgs: string, escape: boolean): string {
  const val = (s: string) => (escape ? shellEscape(s) : s);
  return text
    .replace(/\$ARGUMENTS/g, () => val(rawArgs))
    .replace(/\$(\d+)/g, (_, n) => val(args[parseInt(n, 10) - 1] ?? ''));
}

export interface TemplateDeps {
  exec(cmd: string): Promise<string>;
  readFile(relPath: string): Promise<string>;
}

async function replaceAsync(text: string, re: RegExp, fn: (...m: any[]) => Promise<string>): Promise<string> {
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) return text;
  const replacements = await Promise.all(matches.map((m) => fn(...m)));
  let out = '';
  let last = 0;
  for (let i = 0; i < matches.length; i++) {
    out += text.slice(last, matches[i].index) + replacements[i];
    last = matches[i].index! + matches[i][0].length;
  }
  return out + text.slice(last);
}

/** 渲染模板：@file → shell → 参数（参数内容不二次展开）。 */
export async function renderTemplate(template: string, rawArgs: string, deps: TemplateDeps): Promise<string> {
  const args = splitArgs(rawArgs);
  let out = await replaceAsync(template, /@([\w./\\-]+)/g, async (_m, p) => {
    try {
      return await deps.readFile(p);
    } catch {
      return `[无法读取文件: ${p}]`;
    }
  });
  out = await replaceAsync(out, /!`([^`]+)`/g, async (_m, cmd) => {
    const resolved = substituteArgs(cmd, args, rawArgs, true);
    try {
      return await deps.exec(resolved);
    } catch (err: any) {
      return `[命令失败: ${String(err?.message || err).slice(0, 200)}]`;
    }
  });
  return substituteArgs(out, args, rawArgs, false);
}

export interface CommandDir {
  dir: string;
  scope: 'user' | 'project';
}

/** 扫描目录（递归 .md）；project 覆盖同名 user。坏文件跳过（fail-open）。 */
export async function scanCommandDirs(dirs: CommandDir[]): Promise<CustomCommandSpec[]> {
  const byName = new Map<string, CustomCommandSpec>();
  for (const { dir } of dirs) {
    if (!fs.existsSync(dir)) continue;
    const walk = (cur: string, prefix: string): void => {
      for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
        const full = path.join(cur, entry.name);
        if (entry.isDirectory()) {
          walk(full, prefix ? `${prefix}:${entry.name}` : entry.name);
        } else if (entry.name.endsWith('.md')) {
          const base = entry.name.replace(/\.md$/, '');
          const name = prefix ? `${prefix}:${base}` : base;
          try {
            const spec = parseCommandFile(fs.readFileSync(full, 'utf-8'), name, full);
            if (spec) byName.set(name, spec);
          } catch { /* 坏文件跳过 */ }
        }
      }
    };
    walk(dir, '');
  }
  return [...byName.values()];
}

/** 监听目录变更（300ms 防抖），触发时重扫并回调全量清单。返回 dispose。 */
export function watchCommandDirs(dirs: CommandDir[], onChange: (specs: CustomCommandSpec[]) => void): () => void {
  const watchers: fs.FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  for (const { dir } of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      watchers.push(fs.watch(dir, { recursive: true }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void scanCommandDirs(dirs).then(onChange).catch(() => { /* fail-open */ });
        }, 300);
      }));
    } catch { /* 不支持的目录跳过 */ }
  }
  return () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway; npx jest tests/unit/custom-commands.test.ts`
Expected: PASS（9 个用例）

注：Windows 上 `fs.watch({recursive:true})` 受支持；若 CI Linux 出问题，watcher 已 fail-open。

- [ ] **Step 5: Commit（先向用户确认）**

```bash
git add gateway/src/commands/custom-commands.ts gateway/tests/unit/custom-commands.test.ts
git commit -m "feat(gateway): 自定义 markdown 命令加载器 + 模板引擎（$ARGUMENTS/!shell/@file）"
```

---

### Task 6: 自定义命令接入注册表与执行 + 热重载

**Files:**
- Modify: `gateway/src/index.ts`（`getMafwCommandRegistry()` 扩展：loader 扫描注册 + watcher 重注册 + broadcast）
- Test: `gateway/tests/unit/mafw-commands-custom.test.ts`

**Interfaces:**
- Consumes: Task 5 `scanCommandDirs/watchCommandDirs/renderTemplate/CustomCommandSpec`；Task 3 `buildMafwCommandRegistry`。
- Produces: index.ts 私有方法 `registerCustomCommands(specs)` 与 `customCommandHandler(spec)`；自定义命令目录约定（写入 AGENTS.md）。

执行语义：渲染模板 → `promptAsync(sessionID ?? managerSession, rendered)`；返回 `{ ok: true, message: '已发送到会话 <id 前12位>' }`；无可用会话 → `{ ok:false, error: 'LLM client not available' }`。

- [ ] **Step 1: 写失败测试** `gateway/tests/unit/mafw-commands-custom.test.ts`

路由级测试（自定义命令经注册表 run 全链路，stub prompt/管理器）：

```typescript
import { buildMafwCommandRegistry, handleMafwCommandRun, handleMafwCommandList } from '../../src/routes/mafw-commands';
import { registerCustomCommands, type CustomCommandExecDeps } from '../../src/commands/custom-exec';
import type { MafwBuiltinDeps } from '../../src/commands/builtin-handlers';

function makeBuiltinDeps(): MafwBuiltinDeps {
  return {
    ensureManagerSession: async () => 'mgr-1',
    createSession: async () => null,
    promptAsync: async () => {},
    listMessages: async () => [],
    btwAsk: async () => '',
    rotateManagerSession: async () => ({ sessionId: 'x' }),
    mergeMemory: async () => ({}),
    readStatus: () => '',
    llmAvailable: () => true,
  };
}

describe('custom command execution via registry', () => {
  test('template rendered and prompted into given session', async () => {
    const registry = buildMafwCommandRegistry(makeBuiltinDeps());
    const sent: Array<{ sid: string; text: string }> = [];
    const execDeps: CustomCommandExecDeps = {
      promptAsync: async (sid, text) => { sent.push({ sid, text }); },
      ensureManagerSession: async () => 'mgr-1',
      llmAvailable: () => true,
      exec: async (cmd) => `OUT(${cmd})`,
      readFile: async () => { throw new Error('ENOENT'); },
    };
    registerCustomCommands(registry, [
      { name: 'review', description: '评审', argumentHint: '<文件>', template: '评审 $1，diff：!`git diff --stat`', sourceFile: '/f/review.md' },
    ], execDeps);
    const r = await handleMafwCommandRun({ registry, resolveProjectDir: () => '/p' },
      { command: 'review', args: 'a.ts', sessionID: 'sess-9' });
    expect(r.status).toBe(200);
    expect(sent).toEqual([{ sid: 'sess-9', text: '评审 a.ts，diff：OUT(git diff --stat)' }]);
  });

  test('no sessionID → manager session fallback; no llm → ok:false', async () => {
    const registry = buildMafwCommandRegistry(makeBuiltinDeps());
    const sent: string[] = [];
    registerCustomCommands(registry, [
      { name: 't', description: 'd', template: 'hello', sourceFile: '/f/t.md' },
    ], {
      promptAsync: async (sid) => { sent.push(sid); },
      ensureManagerSession: async () => 'mgr-7',
      llmAvailable: () => true,
      exec: async () => '', readFile: async () => '',
    });
    await handleMafwCommandRun({ registry, resolveProjectDir: () => '/p' }, { command: 't' });
    expect(sent).toEqual(['mgr-7']);
    const reg2 = buildMafwCommandRegistry(makeBuiltinDeps());
    registerCustomCommands(reg2, [{ name: 't', description: 'd', template: 'x', sourceFile: '/f' }], {
      promptAsync: async () => {}, ensureManagerSession: async () => '',
      llmAvailable: () => false, exec: async () => '', readFile: async () => '',
    });
    const r = await handleMafwCommandRun({ registry: reg2, resolveProjectDir: () => '/p' }, { command: 't' });
    expect(r.status).toBe(400);
  });

  test('custom command appears in list with kind=custom and source', async () => {
    const registry = buildMafwCommandRegistry(makeBuiltinDeps());
    registerCustomCommands(registry, [
      { name: 'deploy', description: '部署', template: 'x', sourceFile: '/home/u/.mafw/commands/deploy.md' },
    ], { promptAsync: async () => {}, ensureManagerSession: async () => '', llmAvailable: () => true, exec: async () => '', readFile: async () => '' });
    const list = handleMafwCommandList({ registry, resolveProjectDir: () => '/p' }).body.commands;
    const d = list.find((c: any) => c.name === 'deploy');
    expect(d).toMatchObject({ kind: 'custom', category: 'custom', source: '/home/u/.mafw/commands/deploy.md' });
    expect(list.filter((c: any) => c.kind === 'builtin')).toHaveLength(6);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/mafw-commands-custom.test.ts`
Expected: FAIL（`custom-exec` 模块不存在）

- [ ] **Step 3: 实现** `gateway/src/commands/custom-exec.ts`

```typescript
/**
 * 自定义命令执行：渲染模板 → promptAsync 到指定会话（或 manager 兜底）。
 * registerCustomCommands 供 loader 重扫后全量替换（先 unregister 旧 custom 再注册新）。
 */
import type { MafwCommandRegistry, MafwCommandHandler } from './registry';
import { renderTemplate, type CustomCommandSpec } from './custom-commands';

export interface CustomCommandExecDeps {
  promptAsync(sessionID: string, text: string): Promise<void>;
  ensureManagerSession(projectDir: string): Promise<string>;
  llmAvailable(): boolean;
  exec(cmd: string): Promise<string>;
  readFile(relPath: string): Promise<string>;
}

export function registerCustomCommands(
  registry: MafwCommandRegistry,
  specs: CustomCommandSpec[],
  deps: CustomCommandExecDeps,
): void {
  // 先清掉旧的 custom 条目（重扫全量替换语义）
  for (const def of registry.list()) {
    if (def.kind === 'custom') registry.unregister(def.name);
  }
  for (const spec of specs) {
    const handler: MafwCommandHandler = async (ctx) => {
      const rendered = await renderTemplate(spec.template, ctx.args, {
        exec: deps.exec,
        readFile: deps.readFile,
      });
      const target = ctx.sessionID || (await deps.ensureManagerSession(ctx.projectDir).catch(() => ''));
      if (!target || !deps.llmAvailable()) {
        return { ok: false, error: 'LLM client not available' };
      }
      await deps.promptAsync(target, rendered);
      return { ok: true, message: `已发送到会话 ${target.slice(0, 12)}（/${spec.name}）` };
    };
    registry.register({
      name: spec.name,
      description: spec.description,
      argumentHint: spec.argumentHint,
      category: 'custom',
      kind: 'custom',
      source: spec.sourceFile,
    }, handler);
  }
}
```

- [ ] **Step 4: index.ts 接入 loader + watcher**

`gateway/src/index.ts`：

1. import 区追加：

```typescript
import { scanCommandDirs, watchCommandDirs, type CommandDir } from './commands/custom-commands';
import { registerCustomCommands } from './commands/custom-exec';
import { exec } from 'child_process';
```

2. `getMafwCommandRegistry()` 尾部（`return` 之前）追加 loader 接线：

```typescript
    // 自定义命令：用户级 ~/.mafw/commands/ + 项目级 <project>/.mafw/commands/，热重载
    const registry = this.mafwCommandRegistry;
    const cmdDirs: CommandDir[] = [
      { dir: path.join(this.mafwDir, 'commands'), scope: 'user' },
      { dir: path.join(this.projectDir, '.mafw', 'commands'), scope: 'project' },
    ];
    const execDeps = {
      promptAsync: async (sid: string, text: string) => {
        await this.opencodeClient!.session.promptAsync({ sessionID: sid, parts: [{ type: 'text', text }] });
      },
      ensureManagerSession: async (projectDir: string) => (await this.ensureManagerSession(projectDir, this.mafwDir).catch(() => '')) || '',
      llmAvailable: () => !!this.opencodeClient,
      exec: (cmd: string) => new Promise<string>((resolveExec, rejectExec) => {
        exec(cmd, { cwd: this.projectDir, timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true },
          (err, stdout, stderr) => err ? rejectExec(new Error(stderr?.trim() || err.message)) : resolveExec(stdout.trim()));
      }),
      readFile: async (rel: string) => {
        const full = path.resolve(this.projectDir, rel);
        if (!full.startsWith(path.resolve(this.projectDir))) throw new Error('path escapes project');
        const stat = fs.statSync(full);
        if (stat.size > 100 * 1024) throw new Error('file too large (>100KB)');
        return fs.readFileSync(full, 'utf-8');
      },
    };
    void scanCommandDirs(cmdDirs).then((specs) => {
      registerCustomCommands(registry, specs, execDeps);
      if (specs.length > 0) log.info(`[Commands] 自定义命令已加载: ${specs.map((s) => s.name).join(', ')}`);
    }).catch(() => { /* fail-open */ });
    this.customCommandWatcherDispose = watchCommandDirs(cmdDirs, (specs) => {
      registerCustomCommands(registry, specs, execDeps);
      log.info(`[Commands] 自定义命令已热重载（${specs.length} 条）`);
      this.broadcast({ type: 'mafw_commands_changed' });
    });
```

3. 类字段区追加：

```typescript
private customCommandWatcherDispose: (() => void) | null = null;
```

4. `stop()` 方法内（找既有清理段）追加：

```typescript
    this.customCommandWatcherDispose?.();
    this.customCommandWatcherDispose = null;
```

- [ ] **Step 5: 跑测试 + 全量回归**

Run: `cd gateway; npx jest tests/unit/mafw-commands-custom.test.ts; npx tsc --noEmit`
Expected: PASS（3 个用例）+ 类型干净

Run: `cd gateway; npx jest --silent`
Expected: 全量不红

- [ ] **Step 6: Commit（先向用户确认）**

```bash
git add gateway/src/commands/custom-exec.ts gateway/src/index.ts gateway/tests/unit/mafw-commands-custom.test.ts
git commit -m "feat(gateway): 自定义命令接入注册表（prompt 执行 + fs.watch 热重载）"
```

---

### Task 7: TUI 消费 gateway 命令（合并补全 + fallback 派发）

**Files:**
- Create: `packages/tui/src/ui/gateway-commands.ts`
- Modify: `packages/tui/src/ui/command-registry.ts`（argumentHint 字段 + 合并函数）
- Modify: `packages/tui/src/ui/slash-commands.ts`（default 分支 fallback 到 gateway）
- Modify: `packages/tui/src/ui/app.ts`（启动拉取 + 注入）
- Modify: `packages/tui/src/ui/chat-tab.ts`（补全 provider 动态化）
- Test: `packages/tui/tests/gateway-commands.test.ts`、`packages/tui/tests/command-registry.test.ts`（追加）

**Interfaces:**
- Consumes: SDK `client.mafwCommands.list()`（Task 4）；`MafwCommandDef`。
- Produces:
  - `mergeCommands(local: CommandDef[], remote: MafwCommandDef[]): CommandDef[]`（本地优先：远端 name/alias 撞本地 name/alias → 丢弃远端；返回合并表，远端条目 `category` 映射到最近分类或新增 `'gateway'` 分类）
  - `createSlashHandler` 的 `SlashDeps` 新增 `runGatewayCommand(name: string, args: string): Promise<string | null>` 与 `gatewayCommands(): CommandDef[]`（确认门用）
  - `CommandDef` 新增 `argumentHint?: string` 与 `gateway?: boolean`

- [ ] **Step 1: 写失败测试** `packages/tui/tests/gateway-commands.test.ts`

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeCommands, type RemoteCommand } from '../src/ui/gateway-commands.ts'
import { COMMAND_REGISTRY, resolveCommand } from '../src/ui/command-registry.ts'

test('mergeCommands appends non-colliding remote commands', () => {
  const merged = mergeCommands(COMMAND_REGISTRY, [
    { name: 'goal', description: '提交 Goal', category: 'goals', kind: 'builtin', argumentHint: '<目标>' },
  ])
  assert.ok(merged.find((c) => c.name === 'goal'))
  assert.equal(merged.find((c) => c.name === 'goal')?.argumentHint, '<目标>')
})

test('local wins on name collision (status)', () => {
  const merged = mergeCommands(COMMAND_REGISTRY, [
    { name: 'status', description: 'MAFW 状态', category: 'goals', kind: 'builtin' },
  ])
  assert.equal(merged.filter((c) => c.name === 'status').length, 1)
  assert.equal(merged.find((c) => c.name === 'status')?.description, COMMAND_REGISTRY.find((c) => c.name === 'status')?.description)
})

test('local wins on alias collision (remote new-topic alias new vs local new)', () => {
  const merged = mergeCommands(COMMAND_REGISTRY, [
    { name: 'new-topic', aliases: ['new'], description: '新话题', category: 'session', kind: 'builtin' },
  ])
  assert.equal(merged.find((c) => c.name === 'new-topic'), undefined)
})

test('custom commands land in gateway category', () => {
  const merged = mergeCommands(COMMAND_REGISTRY, [
    { name: 'git:commit', description: '提交', category: 'custom', kind: 'custom' },
  ])
  const c = merged.find((x) => x.name === 'git:commit')
  assert.equal(c?.category, '自定义')
  assert.equal(c?.gateway, true)
})

test('resolveCommand still local-only (unchanged)', () => {
  assert.equal(resolveCommand('goal'), null)
})
```

`packages/tui/tests/command-registry.test.ts` 追加：

```typescript
test('autocompleteItems includes argumentHint', () => {
  const items = autocompleteItems([
    { name: 'btw', description: '支线问答', category: '会话', argumentHint: '<问题>' },
  ])
  assert.equal(items.find((i) => i.name === 'btw')?.description, '支线问答 <问题>')
})

test('helpLines renders gateway group', () => {
  const lines = helpLines([
    { name: 'goal', description: '提交 Goal', category: '自定义' as any, gateway: true },
  ])
  assert.ok(lines.join('\n').includes('/goal'))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/tui; node --test tests/gateway-commands.test.ts tests/command-registry.test.ts`
Expected: FAIL（gateway-commands.ts 不存在 / argumentHint 未实现）

- [ ] **Step 3: 实现**

`packages/tui/src/ui/gateway-commands.ts`：

```typescript
/** gateway 远端命令合并（本地优先；撞名/撞别名丢弃远端）。 */
import type { CommandDef, CommandCategory } from './command-registry.ts'

export interface RemoteCommand {
  name: string
  aliases?: string[]
  description: string
  argumentHint?: string
  category: string
  destructive?: boolean
  kind: 'builtin' | 'custom'
}

const REMOTE_CATEGORY_MAP: Record<string, CommandCategory> = {
  goals: '会话',
  session: '会话',
  memory: '自定义' as CommandCategory,
  custom: '自定义' as CommandCategory,
}

export function mergeCommands(local: CommandDef[], remote: RemoteCommand[]): CommandDef[] {
  const taken = new Set<string>()
  for (const c of local) {
    taken.add(c.name)
    for (const a of c.aliases ?? []) taken.add(a)
  }
  const out = [...local]
  for (const r of remote) {
    if (taken.has(r.name) || (r.aliases ?? []).some((a) => taken.has(a))) continue
    out.push({
      name: r.name,
      description: r.description,
      argumentHint: r.argumentHint,
      category: REMOTE_CATEGORY_MAP[r.category] ?? ('自定义' as CommandCategory),
      aliases: r.aliases,
      destructive: r.destructive,
      gateway: true,
    })
  }
  return out
}
```

`command-registry.ts` 修改：

```typescript
// CommandDef 加两字段：
export interface CommandDef {
  // ...既有字段...
  /** 参数提示（补全/帮助展示），如 '<问题>' */
  argumentHint?: string
  /** 来自 gateway 注册表（远端命令，派发到 mafwCommands.run） */
  gateway?: boolean
}

// autocompleteItems 改签名：
export function autocompleteItems(extra: CommandDef[] = []): { name: string; description: string }[] {
  return [...COMMAND_REGISTRY, ...extra].map((c) => ({
    name: c.name,
    description: c.argumentHint ? `${c.description} ${c.argumentHint}` : c.description,
  }))
}

// helpLines 改签名（gateway 组归入"自定义"分类渲染；COMMAND_CATEGORIES 追加 '自定义'）：
export const COMMAND_CATEGORIES = ['会话', '上下文', '模型', '输入', '自定义', '帮助'] as const

export function helpLines(extra: CommandDef[] = []): string[] {
  const all = [...COMMAND_REGISTRY, ...extra]
  // ...既有渲染逻辑，遍历 COMMAND_CATEGORIES filter all...
}
```

`slash-commands.ts` 修改：`SlashDeps` 追加：

```typescript
  /** gateway 远端命令派发（本地注册表未命中时）；返回提示文本或 null。 */
  runGatewayCommand(name: string, args: string): Promise<string | null>
  /** 当前可见的 gateway 命令（确认门查 destructive 用）。 */
  gatewayCommands(): { name: string; aliases?: string[]; destructive?: boolean }[]
```

default 分支改为：

```typescript
      default: {
        const gw = deps.gatewayCommands().find((c) => c.name === cmd || c.aliases?.includes(cmd))
        if (gw) return deps.runGatewayCommand(gw.name, args)
        return `未知命令 /${rawCmd}（可用: ${COMMAND_REGISTRY.map((c) => `/${c.name}`).join(' ')} …）`
      }
```

`app.ts`：

1. 顶部状态区加 `let gatewayCmds: RemoteCommand[] = []`；client ready 后拉取：

```typescript
  void client.mafwCommands.list().then((cmds) => {
    gatewayCmds = cmds
    chatTab.setAutocompleteExtra(mergeCommands([], cmds).map((c) => ({
      name: c.name, description: c.description, argumentHint: c.argumentHint,
      category: c.category as any, gateway: true,
    })))
  }).catch(() => { /* fail-open：远端命令不可用不阻塞 */ })
```

2. `handleSlashWithConfirm` 的 destructive 检查扩展（本地 OR gateway 命中）：

```typescript
    const name = resolveCommand(rawCmd)
    const def = COMMAND_REGISTRY.find((c) => c.name === name)
      ?? gatewayCmds.find((c) => c.name === rawCmd || c.aliases?.includes(rawCmd)) as any
```

3. `slashHandler` deps 注入：

```typescript
    runGatewayCommand: async (name, args) => {
      const sid = chatStore.sessionID
      const r = await client.mafwCommands.run({ command: name, args, ...(sid ? { sessionID: sid } : {}) })
        .catch((e: any) => ({ error: e.message }))
      if ('error' in (r as any)) return `/${name} 失败: ${(r as any).error}`
      return (r as any).message || (r as any).text || null
    },
    gatewayCommands: () => gatewayCmds,
```

`chat-tab.ts`：构造函数存 `private autocompleteExtra: { name: string; description: string }[] = []`，新增方法：

```typescript
  /** gateway 远端命令到达后刷新补全（重建 provider）。 */
  setAutocompleteExtra(items: { name: string; description: string; argumentHint?: string }[]): void {
    this.autocompleteExtra = items.map((c) => ({
      name: c.name,
      description: c.argumentHint ? `${c.description} ${c.argumentHint}` : c.description,
    }))
    this.editor.setAutocompleteProvider(new CombinedAutocompleteProvider(
      [...autocompleteItems(), ...this.autocompleteExtra],
      process.cwd(),
    ))
  }
```

- [ ] **Step 4: 跑测试 + 全量**

Run: `cd packages/tui; node --test tests/*.test.ts; npm run typecheck`
Expected: 全 PASS（含既有 167 个）

- [ ] **Step 5: Commit（先向用户确认）**

```bash
git add packages/tui
git commit -m "feat(tui): 消费 gateway 命令注册表（合并补全 + fallback 派发 + argumentHint）"
```

---

### Task 8: Desktop 消费（mafw 组动态化）

**Files:**
- Modify: `packages/desktop/src/preload/mafw-api.ts`（mafwCommands.list）
- Modify: `packages/desktop/src/preload/mafw-types.ts`（类型）
- Create: `packages/desktop/src/renderer/mafw/components/command-merge.ts`（纯函数，可测）
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`（mafw 组改动态 + matchCommand 动态）
- Test: `packages/desktop/tests/command-merge.test.ts`

**Interfaces:**
- Consumes: SDK `mafwCommands.list()`。
- Produces: `mergeRemoteCommands(remote: RemoteDef[]): { items: CommandItem[]; names: Set<string> }` 纯函数（把远端 def 映射为桌面 CommandItem mafw 组条目；`source: 'builtin'`、`group: 'mafw'`）。

- [ ] **Step 1: 写失败测试** `packages/desktop/tests/command-merge.test.ts`

```typescript
import { test, expect } from 'bun:test'
import { mergeRemoteCommands } from '../src/renderer/mafw/components/command-merge'

test('remote defs map to mafw CommandItems with trigger and hint', () => {
  const { items, names } = mergeRemoteCommands([
    { name: 'btw', description: '支线问答', argumentHint: '<问题>', category: 'session', kind: 'builtin' },
    { name: 'git:commit', description: '提交', category: 'custom', kind: 'custom' },
  ])
  expect(items[0]).toMatchObject({ id: 'mafw-btw', trigger: '/btw', group: 'mafw' })
  expect(items[0].description).toContain('<问题>')
  expect(items[1].group).toBe('mafw')
  expect(names.has('btw')).toBe(true)
  expect(names.has('git:commit')).toBe(true)
})

test('aliases registered in names for matchCommand', () => {
  const { names } = mergeRemoteCommands([
    { name: 'new-topic', aliases: ['nt'], description: 'x', category: 'session', kind: 'builtin' },
  ])
  expect(names.has('nt')).toBe(true)
})

test('empty remote → empty', () => {
  const { items, names } = mergeRemoteCommands([])
  expect(items).toEqual([])
  expect(names.size).toBe(0)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop; bun test tests/command-merge.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`command-merge.ts`：

```typescript
/** gateway 远端命令 → 桌面 mafw 组 CommandItem（纯函数可测）。 */
export interface RemoteCommandDef {
  name: string
  aliases?: string[]
  description: string
  argumentHint?: string
  category: string
  destructive?: boolean
  kind: 'builtin' | 'custom'
}

export interface MergedCommandItem {
  id: string
  trigger: string
  title: string
  description: string
  group: 'mafw'
  source: 'builtin'
}

export function mergeRemoteCommands(remote: RemoteCommandDef[]): { items: MergedCommandItem[]; names: Set<string> } {
  const items: MergedCommandItem[] = []
  const names = new Set<string>()
  for (const r of remote) {
    items.push({
      id: `mafw-${r.name}`,
      trigger: `/${r.name}`,
      title: r.description,
      description: r.argumentHint ? `${r.argumentHint}` : (r.kind === 'custom' ? '自定义命令' : 'MAFW 命令'),
      group: 'mafw',
      source: 'builtin',
    })
    names.add(r.name)
    for (const a of r.aliases ?? []) names.add(a)
  }
  return { items, names }
}
```

`mafw-api.ts` 的 `mafwCommands` 块（line 116-118）扩展：

```typescript
    mafwCommands: {
      run: (opts) => invoke("mafwCommands", "run", opts),
      list: () => invoke("mafwCommands", "list"),
    },
```

`mafw-types.ts` 对应类型追加 `list: () => Promise<MafwCommandDef[]>` 与 `MafwCommandDef` 接口（字段同 SDK）。

`ChatPane.tsx`：

1. 信号区加：

```typescript
  const [mafwRemote, setMafwRemote] = createSignal<{ items: CommandItem[]; names: Set<string> }>({ items: [], names: new Set() })
```

2. `loadCustomCommands()` 内 Promise.all 追加第三项：

```typescript
        window.api.mafw.mafwCommands.list().catch(() => []),
```
并在 then 中 `setMafwRemote(mergeRemoteCommands(remoteDefs))`。

3. `buildCommands()` 的 `mafw` 硬编码数组替换为 `mafwRemote().items`（fail-open：为空时回退原硬编码 6 条——保留原数组为 `MAFW_FALLBACK_COMMANDS` 常量）。

4. `matchCommand` 的 mafw 组判断改为：

```typescript
    if (mafwRemote().names.has(name) || MAFW_FALLBACK_NAMES.has(name)) return { name, group: "mafw" }
```

- [ ] **Step 4: 跑测试 + 构建**

Run: `cd packages/desktop; bun test tests/command-merge.test.ts; npx electron-vite build`
Expected: 测试 PASS + 构建成功

- [ ] **Step 5: Commit（先向用户确认）**

```bash
git add packages/desktop
git commit -m "feat(desktop): slash 面板 mafw 组改从 gateway 注册表动态拉取"
```

---

### Task 9: 文档与收尾

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/architecture/gateway.md`
- Modify: `docs/architecture/plugin.md`

- [ ] **Step 1: AGENTS.md 更新**

- §4.1 表格下「接线要求」段前的段落补充：mafw-commands 已收敛注册表——在 §5.13a 后新增小节：

```markdown
### 5.13c Slash 命令注册表（2026-09-18）

`/api/mafw-commands/run` 由硬编码 if 链收敛为注册表（`gateway/src/commands/`）：
- **registry.ts**：`MafwCommandDef`（name/aliases/description/argumentHint/category/destructive/kind）+ `MafwCommandRegistry`（别名解析、重注册覆盖）；6 条内置元数据在 `BUILTIN_COMMAND_DEFS`
- **builtin-handlers.ts**：6 条内置 handler（deps 注入可单测），语义与原 if 链逐字一致
- **custom-commands.ts + custom-exec.ts**：用户自定义命令——`~/.mafw/commands/`（用户级）+ `<project>/.mafw/commands/`（项目级，同名覆盖用户级），markdown + frontmatter（description/argument-hint），子目录即命名空间（`git/commit.md`→`git:commit`）；模板语法 `$ARGUMENTS`/`$1..$N`/`` !`shell` ``（块内参数 shell 转义）/`@file`（≤100KB，相对 projectDir，防逃逸）；fs.watch 300ms 防抖热重载，变更广播 `mafw_commands_changed`；执行=渲染后 promptAsync 到 sessionID（缺省 manager session）
- **GET /api/mafw-commands**：元数据清单（SDK `mafwCommands.list()`）；TUI/Desktop 拉取合并（本地命令优先，撞名/撞别名隐藏远端）
```

- §4.2 上方「Tools 清单」标题不变（无 MCP 工具新增）。
- §5.6 附近补充 wire 契约：`mafw_commands_changed` 为扁平顶层广播事件。

- [ ] **Step 2: docs/architecture 两处更新**

- `gateway.md` line 277 表格行改为：`| 命令/融合 | POST /api/mafw-commands/run（注册表派发）、GET /api/mafw-commands（清单）、POST /api/merge-memory |`
- `plugin.md` line 110 后补一句：`命令清单经 GET /api/mafw-commands 暴露（含用户自定义命令，见 AGENTS.md §5.13c）。`

- [ ] **Step 3: 全量验证**

```bash
npm run build
cd gateway; npx jest --silent
cd ../packages/gateway-sdk; bun test
cd ../tui; node --test tests/*.test.ts
cd ../desktop; bun test tests/command-merge.test.ts
```

- [ ] **Step 4: 版本 bump + gateway 重启**

- 根 `package.json` minor bump（4.10.2 → 4.11.0；同步 `packages/tui`、`packages/gateway-sdk` 版本号——发布链一致性）
- 按 `mafw-gateway-restart` skill 流程写 pending-restart 令牌使 gateway 生效
- 向用户汇报：新增测试数、全量通过数、版本号、commit 哈希列表

- [ ] **Step 5: Commit（先向用户确认）**

```bash
git add -A
git commit -m "docs: slash 命令注册表架构文档 + v4.11.0"
```

---

## Self-Review 记录

- **Spec 覆盖**：P0-1（TUI 自定义命令）→ Task 5/6/7 ✅；P0-2（模板注入）→ Task 5 ✅；P0-3（跨面不一致/硬编码 if 链）→ Task 1/2/3/7/8 ✅；单一注册表主线 → Task 1-4 ✅。P1/P2 在姊妹计划 `2026-09-18-slash-commands-p1p2.md`。
- **插件侧对齐**：opencode 插件 command API 是静态注册，维持 6 条不动；`/goal` 插件走 requests 文件（skill 流程）与 gateway goal 语义不同，保留现状并在 AGENTS.md 注明——刻意决策，非遗漏。
- **类型一致性**：`MafwCommandDef` 在 gateway registry / SDK types / desktop mafw-types / TUI RemoteCommand 四处字段一致（name/aliases/description/argumentHint/category/destructive/kind/source）。
- **风险**：①index.ts 接线位置在巨型 handler 内，替换时务必保留 `/api/merge-memory` 平行端点；②`fs.watch recursive` 在 Linux 需 Node ≥20 可用（已 fail-open）；③TUI `CombinedAutocompleteProvider` 重建会重置补全状态——setAutocompleteExtra 在启动早期调用一次，可接受。
