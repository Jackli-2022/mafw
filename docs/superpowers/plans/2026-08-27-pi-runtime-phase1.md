# Pi Runtime 插件（Phase 1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 pi-coding-agent 作为第二个 agent runtime（进程内 SDK 嵌入）接入网关，验证 runtime 能力契约在非 opencode runtime 上成立——Tier 2 部分能力（session/eventStream/provider），nativeApprovals/sessionStorageApi/agentConfigApi 声明 false。

**Architecture:** 新增 `gateway/src/runtime/plugins/pi-runtime.ts`（内置插件入口）+ `gateway/src/runtime/pi/`（session 注册表、事件翻译、消息翻译、provider 翻译）。`RuntimePluginLoader` 加 `registerBuiltin()` 内置注册；`index.ts` 启动序列：外部 runtime 事件订阅与 serveReady 门解耦、stop 时调用 runtime dispose、ModelRuntime 单例注入认证链。ESM 桥复用媒体适配器模式（`new Function('spec','return import(spec)')`）。

**Tech Stack:** TypeScript（gateway 编译为 CJS，tsc）、jest + ts-jest（测试根 `gateway/tests/unit/runtime/` + `tests/unit/gateway/`）、pi-coding-agent `@earendil-works/pi-coding-agent`（ESM-only，版本 0.84.1）。

## Global Constraints

- **行为保持不变**：opencode 是默认 runtime，所有既有测试必须通过；`npm run build`（根目录）为每个任务的门禁。
- 不新增任何 npm 依赖（pi-coding-agent 已在 gateway 依赖中）。
- 能力分级语义：缺能力的 runtime 只影响功能丰富度，永不阻塞 agent 基本工作（fail-open）。
- gateway 源码静态导入**不带** `.js` 后缀；动态 `import()` 保持现有的 `.js` 后缀风格。
- **ESM 桥必须用 `new Function('spec','return import(spec)')`**（tsc 会把普通动态 import 降级为 require，require ESM 包抛错）。
- 测试放 `gateway/tests/unit/runtime/`（gateway 包内自测）或 `tests/unit/gateway/`（root 级，导入 `../../../gateway/src/...` 不带 `.js` 后缀）。
- **git commit 步骤默认挂起**：每个任务的 "Commit" 步骤需在执行前向用户确认后才执行。
- `AgentRuntime` 必选成员：`name` / `capabilities` / `session.*` / `global.event()` / `provider.list()` / `app.agents()` / `config.get|update()` / `getBaseUrl()`。
- pi 事件翻译目标必须是 normalize.ts 实际消费的形状（`session.idle` / `session.error` / `message.part.updated` / `message.updated` / `message.error`，**不是** `session.updated`——它是 passthrough 死事件）。
- 认证链：`ctx.credentials?.getApiKey(provider)` → `readOpencodeAuth()` 回退 → `ModelRuntime.setRuntimeApiKey(provider, key)`（单例共享）。
- ModelRuntime 必须单例创建并传入**每个** `createAgentSession({ modelRuntime, model })`（否则认证注入错实例）。

---

### Task 1: loader 内置注册（registerBuiltin）

**Files:**
- Modify: `gateway/src/runtime/loader.ts`
- Test: `gateway/tests/unit/runtime/loader-builtin.test.ts`

**Interfaces:**
- Consumes: `RuntimePluginLoader`（现有类）、`RuntimeFactory`（现有类型）
- Produces: `registerBuiltin(name: string, factory: RuntimeFactory, capabilities: RuntimeCapabilities, external: boolean): void`——`get()` 先查内置再查文件；`getState()` 包含内置项（status:'ok'，source 标记 'builtin'）

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/runtime/loader-builtin.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RuntimePluginLoader } from '../../../src/runtime/loader';
import { minimalCapabilities } from '../../../src/runtime/contract';

jest.mock('../../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../src/config', () => ({ config: { raw: {} } }));

describe('RuntimePluginLoader registerBuiltin', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-builtin-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('registerBuiltin makes get() return the builtin factory', async () => {
    const loader = new RuntimePluginLoader(dir);
    const caps = { ...minimalCapabilities(), eventStream: true };
    loader.registerBuiltin('my-builtin', async () => ({ name: 'my-builtin' } as any), caps, true);
    await loader.init();

    const plugin = loader.get('my-builtin');
    expect(plugin).toBeDefined();
    expect(plugin!.capabilities.eventStream).toBe(true);
    expect(plugin!.external).toBe(true);
    expect(typeof plugin!.createRuntime).toBe('function');
  });

  it('file plugins take precedence over builtins of the same name', async () => {
    const loader = new RuntimePluginLoader(dir);
    loader.registerBuiltin('dup', async () => ({ name: 'dup-builtin' } as any), minimalCapabilities(), true);
    fs.writeFileSync(path.join(dir, 'dup.js'), `module.exports = { name: 'dup', async createRuntime() { return { name: 'dup-file' }; } };`);
    await loader.init();

    const plugin = loader.get('dup');
    const rt = await plugin!.createRuntime({} as any);
    expect(rt.name).toBe('dup-file');
  });

  it('getState() reports builtins as ok with source builtin', async () => {
    const loader = new RuntimePluginLoader(dir);
    loader.registerBuiltin('b1', async () => ({ name: 'b1' } as any), minimalCapabilities(), true);
    await loader.init();
    const state = loader.getState();
    expect(state).toHaveLength(1);
    expect(state[0].name).toBe('b1');
    expect(state[0].status).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/unit/runtime/loader-builtin.test.ts`
Expected: FAIL — `registerBuiltin is not a function`

- [ ] **Step 3: Implement registerBuiltin**

```ts
// gateway/src/runtime/loader.ts — 类内新增字段与方法

// 类字段：
private builtins = new Map<string, { factory: RuntimeFactory; capabilities: RuntimeCapabilities; external: boolean }>();

// 方法：
registerBuiltin(name: string, factory: RuntimeFactory, capabilities: RuntimeCapabilities, external: boolean): void {
  this.builtins.set(name, { factory, capabilities, external });
}

// get() 改为先查内置：
get(name: string): { createRuntime: RuntimeFactory; capabilities: RuntimeCapabilities; external: boolean } | undefined {
  const builtin = this.builtins.get(name);
  if (builtin) return { createRuntime: builtin.factory, ...builtin };
  const createRuntime = this.factories.get(name);
  const meta = this.meta.get(name);
  if (!createRuntime || !meta) return undefined;
  return { createRuntime, ...meta };
}

// getState() 末尾追加内置项：
for (const [name, b] of this.builtins) {
  this.state.set(`builtin:${name}`, { file: `builtin:${name}`, name, status: 'ok', capabilities: b.capabilities });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand tests/unit/runtime/loader-builtin.test.ts`
Expected: PASS, 3/3

- [ ] **Step 5: Verify no regression**

Run: `npx jest --runInBand tests/unit/runtime/`（gateway 目录）
Expected: 全部通过（原 loader 测试 14 + 新 3）

- [ ] **Step 6: Commit（挂起，需用户确认）**

```bash
git add gateway/src/runtime/loader.ts gateway/tests/unit/runtime/loader-builtin.test.ts
git commit -m "feat(runtime): add registerBuiltin to RuntimePluginLoader"
```

---

### Task 2: pi-session 注册表（PiSessionRegistry）

**Files:**
- Create: `gateway/src/runtime/pi/pi-session.ts`
- Test: `gateway/tests/unit/runtime/pi-session.test.ts`

**Interfaces:**
- Consumes: pi 模块（`createAgentSession` / `AgentSession`），通过 ESM 桥注入（`deps.createSession` 可 mock）
- Produces: `class PiSessionRegistry`——`create(cwd, model): Promise<{ id }>`、`promptAsync(id, text): Promise<void>`、`prompt(id, text): Promise<{ parts }>`、`messages(id): Promise<{ data }>`、`delete(id)`、`abort(id)`、`list()`、`get(id)`、`todo(id)`、`children(id)`、`summarize(id)`、`disposeAll()`、`sessionFor(id)`、`sessionIdFor(session: any): string | undefined`

**关键语义：**
- `create` 每次调 `createAgentSession({ cwd, modelRuntime, model, sessionManager })` 建新会话并登记（无同 cwd 冲突）
- `promptAsync` 忙时（isStreaming）走 followUp 队列：`session.sendUserMessage(content, { deliverAs: 'followUp' })`
- `disposeAll()` 遍历 `session.dispose()`
- sessionID 格式：`pi_<uuid>` 前缀（与 `mtask_` 风格一致）

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/runtime/pi-session.test.ts
import { PiSessionRegistry } from '../../../src/runtime/pi/pi-session';

const fakeSession = (overrides: any = {}) => ({
  prompt: jest.fn(async () => {}),
  waitForIdle: jest.fn(async () => {}),
  abort: jest.fn(async () => {}),
  dispose: jest.fn(),
  get isStreaming() { return overrides.streaming ?? false; },
  sendUserMessage: jest.fn(async () => {}),
  get messages() { return overrides.messages ?? []; },
  get sessionId() { return overrides.id ?? 'fake'; },
  compact: jest.fn(async () => ({})),
  ...overrides,
});

describe('PiSessionRegistry', () => {
  it('create registers a new session and returns pi_ prefixed id', async () => {
    const registry = new PiSessionRegistry({ createSession: async () => ({ session: fakeSession({ id: 'x' }) }) });
    const { id } = await registry.create('/tmp/proj', { provider: 'xiaomi', model: 'm' } as any);
    expect(id.startsWith('pi_')).toBe(true);
    expect(registry.sessionFor(id)).toBeDefined();
  });

  it('promptAsync calls session.prompt and waits idle', async () => {
    const s = fakeSession();
    const registry = new PiSessionRegistry({ createSession: async () => ({ session: s }) });
    const { id } = await registry.create('/tmp/proj', {} as any);
    await registry.promptAsync(id, 'hello');
    expect(s.prompt).toHaveBeenCalledWith('hello', expect.anything());
    expect(s.waitForIdle).toHaveBeenCalled();
  });

  it('promptAsync while streaming uses followUp queue', async () => {
    const s = fakeSession({ streaming: true });
    const registry = new PiSessionRegistry({ createSession: async () => ({ session: s }) });
    const { id } = await registry.create('/tmp/proj', {} as any);
    await registry.promptAsync(id, 'hello');
    expect(s.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining('hello'), expect.objectContaining({ deliverAs: 'followUp' }));
  });

  it('abort and delete dispose the session', async () => {
    const s = fakeSession();
    const registry = new PiSessionRegistry({ createSession: async () => ({ session: s }) });
    const { id } = await registry.create('/tmp/proj', {} as any);
    await registry.abort(id);
    expect(s.abort).toHaveBeenCalled();
    await registry.delete(id);
    expect(s.dispose).toHaveBeenCalled();
    expect(registry.sessionFor(id)).toBeUndefined();
  });

  it('disposeAll disposes every session', async () => {
    const s1 = fakeSession(); const s2 = fakeSession();
    let n = 0;
    const registry = new PiSessionRegistry({ createSession: async () => ({ session: n++ === 0 ? s1 : s2 }) });
    await registry.create('/a', {} as any);
    await registry.create('/b', {} as any);
    await registry.disposeAll();
    expect(s1.dispose).toHaveBeenCalled();
    expect(s2.dispose).toHaveBeenCalled();
  });

  it('todo and children return empty arrays (no pi equivalents)', async () => {
    const registry = new PiSessionRegistry({ createSession: async () => ({ session: fakeSession() }) });
    const { id } = await registry.create('/tmp', {} as any);
    expect(await registry.todo(id)).toEqual([]);
    expect(await registry.children(id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/unit/runtime/pi-session.test.ts`
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement PiSessionRegistry**

```ts
// gateway/src/runtime/pi/pi-session.ts
import { randomUUID } from 'crypto';

export interface PiSessionDeps {
  /** 注入 createAgentSession（ESM 桥在 pi-runtime.ts 传入） */
  createSession: (opts: any) => Promise<{ session: any }>;
}

export interface PiSessionRegistryOptions {
  sessionTtlMs?: number;   // 默认 24h
}

export class PiSessionRegistry {
  private sessions = new Map<string, any>();
  private bySession = new Map<any, string>();
  private lastUsed = new Map<string, number>();

  constructor(private deps: PiSessionDeps, private opts: PiSessionRegistryOptions = {}) {}

  async create(cwd: string, createOpts: any): Promise<{ id: string }> {
    const { session } = await this.deps.createSession({ cwd, ...createOpts });
    const id = `pi_${randomUUID().slice(0, 8)}`;
    this.sessions.set(id, session);
    this.bySession.set(session, id);
    this.lastUsed.set(id, Date.now());
    return { id };
  }

  sessionFor(id: string): any | undefined { return this.sessions.get(id); }

  sessionIdFor(session: any): string | undefined { return this.bySession.get(session); }

  async promptAsync(id: string, text: string): Promise<void> {
    const s = this.requireSession(id);
    this.touch(id);
    if (s.isStreaming) {
      await s.sendUserMessage(text, { deliverAs: 'followUp' });
    } else {
      await s.prompt(text, {});
      await s.waitForIdle();
    }
  }

  async prompt(id: string, text: string): Promise<{ parts: any[] }> {
    const s = this.requireSession(id);
    this.touch(id);
    const before = (s.messages || []).length;
    await s.prompt(text, {});
    await s.waitForIdle();
    const after = s.messages || [];
    const assistant = after.slice(before).filter((m: any) => m?.role === 'assistant');
    return { parts: (assistant[assistant.length - 1]?.content || []).map((c: any) => ({ type: 'text', text: c?.text || '' })) };
  }

  async messages(id: string): Promise<{ data: any[] }> {
    const s = this.requireSession(id);
    this.touch(id);
    return { data: s.messages || [] };
  }

  async delete(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (s) { try { await s.dispose(); } catch { /* ignore */ } }
    this.sessions.delete(id);
    this.bySession.delete(s);
    this.lastUsed.delete(id);
  }

  async abort(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (s) { try { await s.abort(); } catch { /* ignore */ } }
  }

  async list(): Promise<any[]> {
    return [...this.sessions.keys()].map((id) => ({ id, directory: '', title: '', time: { created: 0, updated: 0 } }));
  }

  async get(id: string): Promise<any> {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    return { id, directory: '', title: '', time: { created: 0, updated: this.lastUsed.get(id) ?? 0 } };
  }

  async todo(): Promise<any[]> { return []; }
  async children(): Promise<any[]> { return []; }

  async summarize(id: string): Promise<any> {
    const s = this.requireSession(id);
    return s.compact();
  }

  async disposeAll(): Promise<void> {
    for (const s of this.sessions.values()) {
      try { await s.dispose(); } catch { /* ignore */ }
    }
    this.sessions.clear();
    this.bySession.clear();
    this.lastUsed.clear();
  }

  private requireSession(id: string): any {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`Pi session not found: ${id}`);
    return s;
  }

  private touch(id: string): void { this.lastUsed.set(id, Date.now()); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand tests/unit/runtime/pi-session.test.ts`
Expected: PASS, 6/6

- [ ] **Step 5: Commit（挂起，需用户确认）**

```bash
git add gateway/src/runtime/pi/pi-session.ts gateway/tests/unit/runtime/pi-session.test.ts
git commit -m "feat(runtime): add PiSessionRegistry with Map lifecycle"
```

---

### Task 3: pi-messages 翻译（AgentMessage → opencode 形状）

**Files:**
- Create: `gateway/src/runtime/pi/pi-messages.ts`
- Test: `gateway/tests/unit/runtime/pi-messages.test.ts`

**Interfaces:**
- Consumes: pi `AgentMessage[]`（`{ role: 'user'|'assistant', content: (TextContent|ImageContent)[], ... }`）
- Produces: `translatePiMessages(messages: any[], sessionID: string): any[]`——opencode 形状消息数组（`{ id, role, content: [{type:'text', text}], sessionID, time: {created, updated} }`）；`piMessagesToParts(msgs): any[]`（简化版，用于 prompt 返回）

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/runtime/pi-messages.test.ts
import { translatePiMessages, piMessagesToParts } from '../../../src/runtime/pi/pi-messages';

describe('translatePiMessages', () => {
  it('maps role and text content to opencode shape', () => {
    const out = translatePiMessages([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ], 'pi_x');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ role: 'user', sessionID: 'pi_x', content: [{ type: 'text', text: 'hi' }] });
    expect(out[1].role).toBe('assistant');
    expect(out[0].id).toBeDefined();
    expect(out[0].time.created).toBeDefined();
  });

  it('strips non-text content (images) but keeps text', () => {
    const out = translatePiMessages([
      { role: 'user', content: [{ type: 'text', text: 'q' }, { type: 'image', data: 'AAAA' }] },
    ], 'pi_x');
    expect(out[0].content).toEqual([{ type: 'text', text: 'q' }]);
  });

  it('piMessagesToParts extracts text parts', () => {
    const parts = piMessagesToParts([
      { role: 'assistant', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
    ]);
    expect(parts).toEqual([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/unit/runtime/pi-messages.test.ts`
Expected: FAIL — Cannot find module

- [ ] **Step 3: Implement translation**

```ts
// gateway/src/runtime/pi/pi-messages.ts
export function translatePiMessages(messages: any[], sessionID: string): any[] {
  return messages.map((m, i) => ({
    id: `pimsg_${sessionID}_${i}`,
    role: m?.role === 'assistant' ? 'assistant' : 'user',
    content: (m?.content || [])
      .filter((c: any) => c?.type === 'text' && typeof c?.text === 'string')
      .map((c: any) => ({ type: 'text', text: c.text })),
    sessionID,
    time: { created: m?.timestamp ?? Date.now(), updated: m?.timestamp ?? Date.now() },
  }));
}

export function piMessagesToParts(messages: any[]): any[] {
  return (messages || [])
    .flatMap((m: any) => (m?.content || []).filter((c: any) => c?.type === 'text' && typeof c?.text === 'string'))
    .map((c: any) => ({ type: 'text', text: c.text }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand tests/unit/runtime/pi-messages.test.ts`
Expected: PASS, 3/3

- [ ] **Step 5: Commit（挂起，需用户确认）**

```bash
git add gateway/src/runtime/pi/pi-messages.ts gateway/tests/unit/runtime/pi-messages.test.ts
git commit -m "feat(runtime): add pi message translation layer"
```

---

### Task 4: pi-events 翻译（subscribe → RawRuntimeEvent）

**Files:**
- Create: `gateway/src/runtime/pi/pi-events.ts`
- Test: `gateway/tests/unit/runtime/pi-events.test.ts`

**Interfaces:**
- Consumes: `AgentSession.subscribe(listener)`、`PiSessionRegistry.sessionIdFor(session)`
- Produces: `class PiEventStream`——`attach(registry: PiSessionRegistry): void`（单例底层订阅）、`stream(): AsyncIterable<any>`（每次调用返回新 AsyncIterable，fan-out 共享底层 listener）、`dispose(): Promise<void>`；`translatePiEvent(event: any, sessionID: string): RawRuntimeEvent | null`

**翻译表（目标必须是 normalize.ts 消费的形状）：**
| pi 事件 | 产出 `RawRuntimeEvent` |
|---|---|
| `agent_start` | `{ payload: { type: 'session.updated', properties: { sessionID } } }` |
| `message_start` / `message_update` | `{ payload: { type: 'message.part.updated', properties: { part: { sessionID, type: 'text', text: evt.delta ?? '' } } } }` |
| `message_end` | `{ payload: { type: 'message.updated', properties: { sessionID, info: { role: 'assistant' } } } }` |
| `tool_call` | `{ payload: { type: 'message.part.updated', properties: { part: { sessionID, type: 'tool-call' } } } }` |
| `tool_result` | `{ payload: { type: 'message.part.updated', properties: { part: { sessionID, type: 'tool-result' } } } }` |
| `turn_start` | `{ payload: { type: 'message.part.updated', properties: { part: { sessionID, type: 'step-start' } } } }` |
| `turn_end` | `{ payload: { type: 'message.part.updated', properties: { part: { sessionID, type: 'step-finish', sessionID, assistantMessageID: `pi_step_${sessionID}` } } } }` |
| `agent_end` / `agent_settled` | `{ payload: { type: 'session.idle', properties: { sessionID } } }` |
| 错误事件（error/aborted 类） | `{ payload: { type: 'session.error', properties: { sessionID, error: msg } } }` |

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/runtime/pi-events.test.ts
import { translatePiEvent } from '../../../src/runtime/pi/pi-events';

describe('translatePiEvent', () => {
  it('agent_end maps to session.idle (not session.updated)', () => {
    const out = translatePiEvent({ type: 'agent_end' }, 'pi_x');
    expect(out?.payload.type).toBe('session.idle');
    expect(out?.payload.properties.sessionID).toBe('pi_x');
  });

  it('message_update maps to message.part.updated with delta text', () => {
    const out = translatePiEvent({ type: 'message_update', delta: 'hi' }, 'pi_x');
    expect(out?.payload.type).toBe('message.part.updated');
    expect(out?.payload.properties.part.text).toBe('hi');
  });

  it('turn_end maps to step-finish part with assistantMessageID', () => {
    const out = translatePiEvent({ type: 'turn_end' }, 'pi_x');
    expect(out?.payload.type).toBe('message.part.updated');
    expect(out?.payload.properties.part.type).toBe('step-finish');
    expect(out?.payload.properties.part.assistantMessageID).toBeDefined();
  });

  it('unknown event types return null', () => {
    expect(translatePiEvent({ type: 'queue_update' }, 'pi_x')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/unit/runtime/pi-events.test.ts`
Expected: FAIL — Cannot find module

- [ ] **Step 3: Implement translation**

```ts
// gateway/src/runtime/pi/pi-events.ts
import type { RawRuntimeEvent } from '../normalize';

export function translatePiEvent(event: any, sessionID: string): RawRuntimeEvent | null {
  const t = event?.type;
  const prop = (extra: any = {}) => ({ payload: { type: 'message.part.updated', properties: { part: { sessionID, ...extra } } } });
  switch (t) {
    case 'agent_start':
      return { payload: { type: 'session.updated', properties: { sessionID } } };
    case 'message_start':
    case 'message_update':
      return { payload: { type: 'message.part.updated', properties: { part: { sessionID, type: 'text', text: event?.delta ?? '' } } } };
    case 'message_end':
      return { payload: { type: 'message.updated', properties: { sessionID, info: { role: 'assistant' } } } };
    case 'tool_call':
      return prop({ type: 'tool-call' });
    case 'tool_result':
      return prop({ type: 'tool-result' });
    case 'turn_start':
      return prop({ type: 'step-start' });
    case 'turn_end':
      return prop({ type: 'step-finish', assistantMessageID: `pi_step_${sessionID}` });
    case 'agent_end':
    case 'agent_settled':
      return { payload: { type: 'session.idle', properties: { sessionID } } };
    default:
      return null;
  }
}

export class PiEventStream {
  private listeners = new Set<(evt: any) => void>();
  private subscribed = false;
  private onEvent: ((evt: any) => void) | null = null;

  constructor(private getSession: (sessionID: string) => any | undefined) {}

  /** 单例底层订阅：把 registry 中已登记会话的 subscribe 都挂上（create 时由 registry 通知）。 */
  attach(registry: any): void {
    if (this.subscribed) return;
    this.subscribed = true;
    this.onEvent = (evt: any) => {
      const id = registry.sessionIdFor(evt?.session) ?? '';
      if (!id) return;
      const translated = translatePiEvent(evt, id);
      if (translated) {
        for (const l of this.listeners) l(translated);
      }
    };
    // 注意：实际绑定在 PiSessionRegistry.create 时调用 stream.trackSession(session)
  }

  /** 新会话登记时挂订阅（PiSessionRegistry 调） */
  trackSession(session: any): void {
    if (typeof session?.subscribe !== 'function' || !this.onEvent) return;
    session.subscribe(this.onEvent);
  }

  /** 返回新 AsyncIterable，fan-out 共享底层 listener */
  stream(): AsyncIterable<any> {
    const listeners = this.listeners;
    const queue: any[] = [];
    const waiters: Array<(v: any) => void> = [];
    const push = (evt: any) => {
      const w = waiters.shift();
      if (w) w(evt); else queue.push(evt);
    };
    const listener = (evt: any) => push(evt);
    listeners.add(listener);
    return {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            if (queue.length) return { value: queue.shift(), done: false };
            return new Promise((resolve) => waiters.push((v) => resolve({ value: v, done: false })));
          },
          return: async () => { listeners.delete(listener); return { done: true, value: undefined }; },
        };
      },
    };
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
    this.subscribed = false;
    this.onEvent = null;
  }
}
```

> 注意：`trackSession` 需要在 PiSessionRegistry.create 中调用——Task 6 集成时接线（registry 加 `onSessionCreated?: (session) => void` 回调）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand tests/unit/runtime/pi-events.test.ts`
Expected: PASS, 4/4

- [ ] **Step 5: Commit（挂起，需用户确认）**

```bash
git add gateway/src/runtime/pi/pi-events.ts gateway/tests/unit/runtime/pi-events.test.ts
git commit -m "feat(runtime): add pi event translation to RawRuntimeEvent"
```

---

### Task 5: pi-provider 翻译（ModelRuntime → provider.list）

**Files:**
- Create: `gateway/src/runtime/pi/pi-provider.ts`
- Test: `gateway/tests/unit/runtime/pi-provider.test.ts`

**Interfaces:**
- Consumes: `ModelRuntime.getProviders(): readonly Provider[]`（`{ id, name?, ... }`）、`ModelRuntime.getModels(providerId)`、`ModelRuntime.getProvider(providerId)`
- Produces: `translateProviders(mr: any): Promise<{ all: any[]; connected: string[]; default: Record<string, string> }>`（opencode 形状 provider.list 输出）；`translateAgents(): Promise<any[]>`（恒返回 []）；`translateConfigGet() / translateConfigUpdate(cfg)`（尽力而为：读/写 pluginConfig）

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/runtime/pi-provider.test.ts
import { translateProviders, translateAgents } from '../../../src/runtime/pi/pi-provider';

const fakeMR = () => ({
  getProviders: () => [{ id: 'xiaomi', name: 'Xiaomi' }, { id: 'openai', name: 'OpenAI' }],
  getModels: (pid: string) => pid === 'xiaomi' ? [{ id: 'mimo-v2.5' }, { id: 'mimo-v1' }] : [],
  getProvider: (pid: string) => pid === 'xiaomi' ? { id: 'xiaomi', name: 'Xiaomi' } : undefined,
  hasConfiguredAuth: (pid: string) => pid === 'xiaomi',
});

describe('translateProviders', () => {
  it('maps providers with connected from hasConfiguredAuth', async () => {
    const out = await translateProviders(fakeMR());
    expect(out.all.map((p: any) => p.id)).toEqual(['xiaomi', 'openai']);
    expect(out.connected).toEqual(['xiaomi']);
    expect(out.default).toEqual({});
  });

  it('translateAgents returns empty array', async () => {
    expect(await translateAgents()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/unit/runtime/pi-provider.test.ts`
Expected: FAIL — Cannot find module

- [ ] **Step 3: Implement translation**

```ts
// gateway/src/runtime/pi/pi-provider.ts
export async function translateProviders(mr: any): Promise<{ all: any[]; connected: string[]; default: Record<string, string> }> {
  const providers = (mr?.getProviders?.() || []) as any[];
  const all = providers.map((p: any) => ({
    id: p?.id,
    name: p?.name ?? p?.id,
    models: (mr?.getModels?.(p?.id) || []).map((m: any) => ({ id: m?.id, name: m?.id })),
  }));
  const connected = providers.filter((p: any) => mr?.hasConfiguredAuth?.(p?.id) ?? false).map((p: any) => p?.id);
  return { all, connected, default: {} };
}

export async function translateAgents(): Promise<any[]> { return []; }

export async function translateConfigGet(): Promise<any> { return {}; }

export async function translateConfigUpdate(cfg: any): Promise<any> { return cfg; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand tests/unit/runtime/pi-provider.test.ts`
Expected: PASS, 2/2

- [ ] **Step 5: Commit（挂起，需用户确认）**

```bash
git add gateway/src/runtime/pi/pi-provider.ts gateway/tests/unit/runtime/pi-provider.test.ts
git commit -m "feat(runtime): add pi provider translation"
```

---

### Task 6: pi-runtime 内置插件入口（createPiRuntime）

**Files:**
- Create: `gateway/src/runtime/plugins/pi-runtime.ts`
- Test: `gateway/tests/unit/runtime/pi-runtime.test.ts`

**Interfaces:**
- Consumes: `RuntimePluginContext`（loader.ts）、`PiSessionRegistry`（Task 2）、`translatePiMessages`（Task 3）、`PiEventStream`（Task 4）、`translateProviders`（Task 5）、`fixMediaPayload`（media/pi-adapter.ts，视频/音频 wire 重写）、`readOpencodeAuth` / `DEFAULT_AUTH_PATH`（media/auth-util.ts）
- Produces: `createPiRuntime(ctx: RuntimePluginContext): Promise<AgentRuntime>`——name='pi'、capabilities 如 Global Constraints、external=true、getBaseUrl=gateway API URL、healthCheck=ModelRuntime 存活、dispose=registry.disposeAll + eventStream.dispose
- Produces: `registerPiRuntime(loader: RuntimePluginLoader): void`——`loader.registerBuiltin('pi', createPiRuntime, PI_CAPABILITIES, true)`，供 index.ts 调用

**ModelRuntime 单例：** `let mrPromise: Promise<any> | undefined`；ESM 桥加载 `@earendil-works/pi-coding-agent` 的 `ModelRuntime`；认证链在 createRuntime 时解析一次（credentials → auth.json 回退），`mr.setRuntimeApiKey(provider, key)`。

**视频/音频支持：** 媒体部分 Phase 2 做；Phase 1 在 createRuntime 里只保证 `session` 接口可用（不带 fixMediaPayload 钩子，Phase 2 接）。

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/runtime/pi-runtime.test.ts
import { PI_CAPABILITIES, createPiRuntime } from '../../../src/runtime/plugins/pi-runtime';

jest.mock('../../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe('pi-runtime', () => {
  it('declares Tier-2-partial capabilities', () => {
    expect(PI_CAPABILITIES).toMatchObject({
      sessionApi: true, promptWhileBusy: true, eventStream: true,
      nativeApprovals: false, providerConfigApi: true, perLlmCallTransform: true,
      sessionStorageApi: false, agentConfigApi: false,
    });
  });

  it('createPiRuntime returns AgentRuntime shape with external=true', async () => {
    const rt = await createPiRuntime({ fetch: fetch, log: console, pluginConfig: () => ({}) } as any);
    expect(rt.name).toBe('pi');
    expect(rt.external).toBe(true);
    expect(typeof rt.getBaseUrl).toBe('function');
    expect(typeof rt.session.create).toBe('function');
    expect(typeof rt.global.event).toBe('function');
    expect(typeof rt.provider.list).toBe('function');
    expect(typeof rt.app.agents).toBe('function');
    expect(typeof rt.config.get).toBe('function');
    expect(typeof rt.config.update).toBe('function');
    expect(typeof rt.healthCheck).toBe('function');
  });
});
```

> 注意：此测试需要 mock pi 模块（ESM 桥在 jest 里真实加载会失败）。测试环境用 `jest.mock('@earendil-works/pi-coding-agent', ...)` 或在 createPiRuntime 里把 ESM 加载函数可注入（`deps.loadPi?`）。实现时 createPiRuntime 接受 `deps?: { loadPi?: () => Promise<any> }`，测试注入假 pi 模块。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/unit/runtime/pi-runtime.test.ts`
Expected: FAIL — Cannot find module

- [ ] **Step 3: Implement createPiRuntime**

```ts
// gateway/src/runtime/plugins/pi-runtime.ts
import type { AgentRuntime, RuntimeCapabilities } from '../contract';
import type { RuntimePluginContext } from '../loader';
import { PiSessionRegistry } from '../pi/pi-session';
import { translatePiMessages } from '../pi/pi-messages';
import { PiEventStream } from '../pi/pi-events';
import { translateProviders, translateAgents, translateConfigGet, translateConfigUpdate } from '../pi/pi-provider';
import { DEFAULT_AUTH_PATH, readOpencodeAuth } from '../../media/auth-util';
import { config } from '../../config';

export const PI_CAPABILITIES: RuntimeCapabilities = {
  sessionApi: true,
  promptWhileBusy: true,
  eventStream: true,
  nativeApprovals: false,
  providerConfigApi: true,
  perLlmCallTransform: true,
  sessionStorageApi: false,
  agentConfigApi: false,
};

export interface PiRuntimeDeps {
  loadPi?: () => Promise<any>;
  authPath?: string;
  timeoutMs?: number;
}

export async function createPiRuntime(ctx: RuntimePluginContext, deps: PiRuntimeDeps = {}): Promise<AgentRuntime> {
  const authPath = deps.authPath ?? DEFAULT_AUTH_PATH();
  const cfg = ctx.pluginConfig('pi');
  const provider = cfg.provider ?? 'xiaomi';
  const modelID = cfg.model ?? 'mimo-v2.5';
  const thinkingLevel = cfg.thinkingLevel ?? 'medium';

  let mrPromise: Promise<any> | undefined;
  function modelRuntime(): Promise<any> {
    if (!mrPromise) {
      mrPromise = (async () => {
        const imp = deps.loadPi ?? (new Function('spec', 'return import(spec)') as (s: string) => Promise<any>);
        const { ModelRuntime } = await imp('@earendil-works/pi-coding-agent');
        const mr = await ModelRuntime.create({ signal: AbortSignal.timeout(30_000) });
        // 认证注入：credentials 链 → auth.json 回退
        const key = ctx.credentials?.getApiKey?.(provider) ?? readOpencodeAuth(authPath)[provider]?.key;
        if (key) await mr.setRuntimeApiKey(provider, key);
        return mr;
      })();
      mrPromise.catch(() => { mrPromise = undefined; });
    }
    return mrPromise;
  }

  const eventStream = new PiEventStream(() => undefined);
  const registry = new PiSessionRegistry({
    createSession: async (opts) => {
      const imp = deps.loadPi ?? (new Function('spec', 'return import(spec)') as (s: string) => Promise<any>);
      const { createAgentSession } = await imp('@earendil-works/pi-coding-agent');
      const mr = await modelRuntime();
      const model = mr.getModel(opts.model?.provider ?? provider, opts.model?.modelID ?? modelID);
      const { session } = await createAgentSession({
        cwd: opts.cwd,
        modelRuntime: mr,
        model,
        thinkingLevel,
        sessionManager: undefined,
      });
      eventStream.trackSession(session);
      return { session };
    },
  }, { sessionTtlMs: cfg.sessionTtlMs });

  const sessionAPI = {
    create: async (opts: { directory?: string }) => {
      const { id } = await registry.create(opts?.directory ?? config.projectDir, { model: { provider, modelID } });
      return { id };
    },
    promptAsync: async (opts: { sessionID: string; message?: string; parts?: any[] }) => {
      const text = opts.message ?? (opts.parts || []).map((p: any) => p.text || '').join('\n');
      await registry.promptAsync(opts.sessionID, text);
    },
    prompt: async (opts: { sessionID: string; message?: string; parts?: any[] }) => {
      const text = opts.message ?? (opts.parts || []).map((p: any) => p.text || '').join('\n');
      return registry.prompt(opts.sessionID, text);
    },
    messages: async (opts: { sessionID: string }) => {
      const { data } = await registry.messages(opts.sessionID);
      return { data: translatePiMessages(data, opts.sessionID), nextCursor: undefined };
    },
    get: async (opts: { sessionID: string }) => registry.get(opts.sessionID),
    delete: async (opts: { sessionID: string }) => { await registry.delete(opts.sessionID); },
    abort: async (opts: { sessionID: string }) => { await registry.abort(opts.sessionID); },
    list: async () => registry.list(),
    todo: async () => registry.todo(),
    children: async () => registry.children(),
    summarize: async (opts: { sessionID: string }) => registry.summarize(opts.sessionID),
  };

  return {
    name: 'pi',
    capabilities: PI_CAPABILITIES,
    external: true,
    session: sessionAPI,
    global: { event: () => Promise.resolve({ stream: eventStream.stream() }) },
    provider: { list: () => modelRuntime().then((mr) => translateProviders(mr)) },
    app: { agents: () => translateAgents() },
    config: { get: () => translateConfigGet(), update: (c: any) => translateConfigUpdate(c) },
    credentials: { getApiKey: (p: string) => ctx.credentials?.getApiKey?.(p) ?? readOpencodeAuth(authPath)[p]?.key ?? null },
    getBaseUrl: () => `http://127.0.0.1:${config.server.apiPort ?? 3000}`,
    healthCheck: async () => { try { await modelRuntime(); return true; } catch { return false; } },
    dispose: async () => {
      await registry.disposeAll();
      await eventStream.dispose();
    },
  };
}
```

> 注意：`ctx.credentials` 需要扩展 `RuntimePluginContext`——Task 7 做（或在 Task 6 中一并给 createRuntimePluginContext 加 credentials 传递，看 Task 7 安排）。若 Task 7 未到，先在 pi-runtime 里从 `(ctx as any).credentials` 读取并注释说明。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand tests/unit/runtime/pi-runtime.test.ts`
Expected: PASS, 2/2（需要 `deps.loadPi` 注入假 pi 模块）

- [ ] **Step 5: Commit（挂起，需用户确认）**

```bash
git add gateway/src/runtime/plugins/pi-runtime.ts gateway/tests/unit/runtime/pi-runtime.test.ts
git commit -m "feat(runtime): add pi runtime plugin entry (createPiRuntime)"
```

---

### Task 7: ctx.credentials 传递 + index.ts 接线（注册/解耦/dispose）

> **顺序说明**：Task 6 的 `createPiRuntime` 依赖 `ctx.credentials`（运行时读取，`(ctx as any).credentials` 兜底）；Task 7 先加类型再接线。若 Task 6 先做，`ctx.credentials` 读的是 `any`，运行时不受影响（Task 7 补类型）。两任务无编译期强依赖，可顺序执行。

**Files:**
- Modify: `gateway/src/runtime/loader.ts`（`RuntimePluginContext` 加 `credentials?: { getApiKey(provider: string): string | null }`；`createRuntimePluginContext` 接受可选 credentials 参数）
- Modify: `gateway/src/index.ts`（启动序列：registerBuiltin('pi')、事件订阅与 serveReady 解耦、stop 时 dispose、runtimeName/runtimeCaps 已存在）
- Test: `gateway/tests/unit/runtime/ctx-credentials.test.ts`（loader context）

**Interfaces:**
- Consumes: `RuntimePluginContext`（现有）、`createPiRuntime` / `PI_CAPABILITIES`（Task 6）、Scheduler 启动序列
- Produces: `createRuntimePluginContext(credentials?: RuntimeCredentials)`——credentials 传入 context；`Scheduler.connect()` 中 `registerBuiltin('pi', createPiRuntime, PI_CAPABILITIES, true)`；`subscribeToEvents` 解耦改动；stop 时调 `runtime.dispose?.()`

**serveReady 解耦细节：**
- 现状 `index.ts:378-383`：`if (serveReady) { startServeWatchdog(); subscribeToEvents(); }`
- 改为：`if (serveReady) startServeWatchdog();` + `if (serveReady || this.runtimeCaps.eventStream && this.runtime?.external) subscribeToEvents();`（外部 runtime 声明 eventStream 时不等 serveReady）
- `subscribeToEvents()` 内部已检查 `runtimeCaps.eventStream` 和 `opencodeClient`（698-706 行）——opencodeClient 就是 runtime，无需改内部

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/runtime/ctx-credentials.test.ts
import { createRuntimePluginContext } from '../../../src/runtime/loader';

jest.mock('../../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../src/config', () => ({ config: { raw: {} } }));

describe('createRuntimePluginContext credentials', () => {
  it('passes credentials through to ctx', () => {
    const ctx = createRuntimePluginContext({ getApiKey: (p: string) => p === 'xiaomi' ? 'KEY' : null });
    expect(ctx.credentials?.getApiKey('xiaomi')).toBe('KEY');
    expect(ctx.credentials?.getApiKey('openai')).toBeNull();
  });

  it('credentials undefined when not provided', () => {
    const ctx = createRuntimePluginContext();
    expect(ctx.credentials).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/unit/runtime/ctx-credentials.test.ts`
Expected: FAIL — 编译错误（createRuntimePluginContext 不接受参数）

- [ ] **Step 3: Implement ctx.credentials**

```ts
// gateway/src/runtime/loader.ts
import type { RuntimeCredentials } from './contract';

export interface RuntimePluginContext {
  fetch: (url: string, opts?: any) => Promise<Response>;
  log: typeof log;
  pluginConfig(name: string): Record<string, any>;
  /** runtime 凭据（媒体/pi 认证链优先走这里） */
  credentials?: RuntimeCredentials;
}

export function createRuntimePluginContext(credentials?: RuntimeCredentials): RuntimePluginContext {
  return {
    fetch: (url: string, opts?: any) =>
      fetch(url, { ...opts, signal: opts?.signal ?? AbortSignal.timeout(60000) }),
    log,
    pluginConfig: (name: string) => (config.raw as any)?.runtime?.pluginConfig?.[name] ?? {},
    credentials,
  };
}
```

- [ ] **Step 4: index.ts 接线**

```ts
// 启动序列（connect 内，initServices 之后、createRuntime 调用处）
// ① 注册 pi 内置插件（createRuntime 之前）
this.runtimeLoader?.registerBuiltin('pi', createPiRuntime, PI_CAPABILITIES, true);

// ② createRuntime 传 credentials（基于 auth.json 构造，或后续接 credentials 管理）
const rt = await this.createRuntime(sdkConfig);  // 现有行，不动

// ③ serveReady 解耦（378-383 行改为）
if (serveReady) {
  this.startServeWatchdog();
}
if (serveReady || (this.runtimeCaps.eventStream && this.runtime?.external)) {
  this.subscribeToEvents();
}

// ④ stop() 中追加（在现有清理序列末尾）
if (this.runtime && typeof (this.runtime as any).dispose === 'function') {
  try { await (this.runtime as any).dispose(); } catch (err: any) {
    log.warn(`[Scheduler] runtime dispose error: ${err.message}`);
  }
}
```

```ts
// index.ts 导入（顶部）
import { createPiRuntime, PI_CAPABILITIES } from './runtime/plugins/pi-runtime';
```

- [ ] **Step 5: Verify**

Run: `npx jest --runInBand tests/unit/runtime/ctx-credentials.test.ts` → PASS, 2/2
Run: `npx jest --runInBand tests/unit/runtime/`（gateway）→ 全部通过
Run: `npm run build`（根目录）→ exit 0

- [ ] **Step 6: Commit（挂起，需用户确认）**

```bash
git add gateway/src/runtime/loader.ts gateway/src/index.ts gateway/tests/unit/runtime/ctx-credentials.test.ts
git commit -m "feat(runtime): wire pi runtime into gateway (credentials, serve decoupling, dispose)"
```

---

### Task 8: pi-integration 冒烟测试 + 文档

**Files:**
- Create: `gateway/tests/unit/runtime/pi-integration.test.ts`
- Modify: `AGENTS.md`（§5.19 补 pi runtime 记录）

**Interfaces:**
- Consumes: `createPiRuntime`（Task 6）——用注入的假 pi 模块验证全链路
- Produces: 冒烟证据 + §5.19 文档

- [ ] **Step 1: Write the integration test**

```ts
// gateway/tests/unit/runtime/pi-integration.test.ts
import { createPiRuntime } from '../../../src/runtime/plugins/pi-runtime';

jest.mock('../../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../src/config', () => ({
  config: { raw: {}, projectDir: '/tmp', server: { apiPort: 3000 } },
}));
jest.mock('../../../src/media/auth-util', () => ({
  DEFAULT_AUTH_PATH: () => '/tmp/nonexistent-auth.json',
  readOpencodeAuth: () => ({}),
}));

const fakePi = {
  ModelRuntime: {
    create: async () => ({
      getModel: (p: string, m: string) => ({ id: `${p}/${m}`, baseUrl: 'http://fake' }),
      getProviders: () => [{ id: 'xiaomi', name: 'Xiaomi' }],
      getModels: () => [{ id: 'mimo-v2.5' }],
      hasConfiguredAuth: () => true,
      setRuntimeApiKey: async () => {},
    }),
  },
  createAgentSession: async ({ cwd }: any) => {
    const session: any = {
      prompt: async () => {},
      waitForIdle: async () => {},
      abort: async () => {},
      dispose: async () => {},
      compact: async () => ({}),
      subscribe: () => () => {},
      isStreaming: false,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      ],
    };
    return { session };
  },
};

describe('pi runtime integration', () => {
  it('full session flow: create → promptAsync → messages', async () => {
    const rt = await createPiRuntime({ fetch, log: console, pluginConfig: () => ({ provider: 'xiaomi', model: 'mimo-v2.5' }) } as any, { loadPi: async () => fakePi });
    const { id } = await rt.session.create({ directory: '/tmp/proj' });
    expect(id.startsWith('pi_')).toBe(true);
    await rt.session.promptAsync({ sessionID: id, message: 'hello' });
    const { data } = await rt.session.messages({ sessionID: id });
    expect(data).toHaveLength(2);
    expect(data[0].content[0].text).toBe('hi');
  });

  it('provider.list works through ModelRuntime', async () => {
    const rt = await createPiRuntime({ fetch, log: console, pluginConfig: () => ({}) } as any, { loadPi: async () => fakePi });
    const out = await rt.provider.list();
    expect(out.connected).toContain('xiaomi');
  });

  it('dispose cleans up sessions', async () => {
    const rt = await createPiRuntime({ fetch, log: console, pluginConfig: () => ({}) } as any, { loadPi: async () => fakePi });
    await rt.session.create({ directory: '/tmp' });
    await (rt as any).dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx jest --runInBand tests/unit/runtime/pi-integration.test.ts`
Expected: PASS, 3/3

- [ ] **Step 3: Verify full suite + build**

Run: `npx jest --runInBand tests/unit/runtime/`（gateway）→ 全部通过（含新 4 个文件）
Run: `npm run build`（根目录）→ exit 0
Run: root 级 `npx jest tests/unit/gateway/runtime-*.test.ts tests/unit/gateway/opencode-runtime.test.ts` → 全部通过（回归）

- [ ] **Step 4: 更新 AGENTS.md §5.19**

在"可选能力与接口扩展"后追加段落：

```markdown
**内置插件：pi-coding-agent runtime（`gateway/src/runtime/plugins/pi-runtime.ts`）**
- `config.runtime.plugin: pi` 激活；进程内 SDK 嵌入（ESM 桥 `new Function('spec','return import(spec)')`）
- 能力：sessionApi/promptWhileBusy/eventStream/providerConfigApi true；nativeApprovals/sessionStorageApi/agentConfigApi false（Phase 3 待办）
- 认证链：`ctx.credentials.getApiKey` → auth.json 回退 → ModelRuntime.setRuntimeApiKey（单例共享）
- 会话：`PiSessionRegistry`（Map<sessionID, AgentSession>，忙时 followUp 队列）
- 事件：`PiEventStream`（subscribe → RawRuntimeEvent → normalize.ts 四信号）
- external=true：gateway 不 spawn；事件订阅与 serveReady 解耦（外部 runtime 不等 opencode serve）
- 媒体 agent 消费 AgentRuntime（Phase 2，见 `docs/superpowers/specs/2026-08-27-pi-runtime-design.md`）
```

- [ ] **Step 5: Commit（挂起，需用户确认）**

```bash
git add gateway/tests/unit/runtime/pi-integration.test.ts AGENTS.md
git commit -m "test(runtime): pi runtime integration smoke + docs §5.19"
```

---

## 收尾验证（全部任务完成后）

- [ ] `rg -n "TODO" gateway/src/runtime/pi/ gateway/src/runtime/plugins/` 仅 Phase 3 待办标记
- [ ] `npm run build` exit 0
- [ ] gateway 全量 `npx jest --runInBand tests/unit/runtime/` 全绿
- [ ] root 级 runtime 回归全绿（35 测试）
- [ ] 纯 pi 环境冒烟：`MAFW_RUNTIME_PLUGIN=pi` 启动 → `/api/runtime` 返回 pi 能力集；日志无 "MCP-only mode" 误报；事件订阅正常

## 验收标准（来自规格 §13，Phase 1 范围）

1. `npm run build` exit 0
2. `runtime.plugin: pi` 启动 → `/api/runtime` 返回 pi 能力集（8 项声明）
3. pi 会话：create → promptAsync → messages 全链路工作（冒烟，mock 或真模型）
4. 纯 pi 环境（无 opencode serve）事件流实际工作：`subscribeToEvents()` 不被 serveReady 门挡住
5. opencode 路径全程行为不变（回归全绿）