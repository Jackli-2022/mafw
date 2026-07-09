# RuntimeAdapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define RuntimeAdapter interface, migrate plugin.ts to OpenCodeAdapter, build LangChainAdapter with BaseCallbackHandler + MafwFileCheckpointer.

**Architecture:** RuntimeAdapter 接口层将 MAFW 核心与运行时解耦。两个 Adapter（OpenCode + LangChain）各自实现事件入站（→ HookManager）和能力出站（executeCapability）。EventBuffer 保证 bind 前事件不丢失。MafwFileCheckpointer 是 state.json 的唯一写入者。

**Tech Stack:** TypeScript, @langchain/core (^1.1.48), @langchain/langgraph (^1.4.7), Jest

## Global Constraints

- 所有新文件在 `src/runtime/` 目录下
- `BaseRuntimeAdapter` 提供 `dispatch` / `dispatchAsync` / `EventBuffer` 公共实现
- `state.json` 仅由 `MafwFileCheckpointer.put()` 写入（Single Writer Principle）
- Skill Entry 在 LangChain 模式下只写业务工件（waves/receipts/reviews），不写 state.json
- `runTree` 是 `runId → { type, sessionId, parentRunId }` 映射，不依赖全局变量
- `resumedThreads` Set 防止自动恢复时重复 `session.start`
- 测试覆盖率 ≥ 80% 新代码

---

## File Structure

```
src/runtime/
├── RuntimeAdapter.ts          — 接口定义 + BaseRuntimeAdapter (EventBuffer)
├── OpenCodeAdapter.ts         — OpenCode SDK 事件桥接
├── MafwCallbackHandler.ts     — LangChain BaseCallbackHandler 实现
├── MafwFileCheckpointer.ts    — LangGraph BaseCheckpointSaver 实现
├── langchain-nodes/
│   ├── plan.node.ts           — LangChain 模式下的 Plan 节点适配
│   ├── execute.node.ts        — LangChain 模式下的 Execute 节点适配
│   └── review.node.ts         — LangChain 模式下的 Review 节点适配
│   └── index.ts               — 统一导出
├── index.ts                   — 统一导出
src/plugin.ts                  (modify — 委托给 OpenCodeAdapter)
tests/unit/runtime/
├── RuntimeAdapter.test.ts     — EventBuffer 缓存/重放
├── OpenCodeAdapter.test.ts    — 每种事件 → HookManager 调用
├── MafwCallbackHandler.test.ts — 每个 Callback → HookManager 事件
├── MafwFileCheckpointer.test.ts — 格式转换 CRUD
└── langchain-nodes/
    └── plan.node.test.ts      — Plan 节点适配
```

---

## Task 1: RuntimeAdapter 接口 + BaseRuntimeAdapter

**Files:**
- Create: `src/runtime/RuntimeAdapter.ts`
- Test: `tests/unit/runtime/RuntimeAdapter.test.ts`

**Interfaces:**
- Produces: `RuntimeAdapter` interface, `BaseRuntimeAdapter` abstract class with `dispatch()` / `dispatchAsync()` / EventBuffer

- [ ] **Step 1: Write the failing test**

```typescript
import { BaseRuntimeAdapter, RuntimeAdapter } from '../../../src/runtime/RuntimeAdapter';

class TestAdapter extends BaseRuntimeAdapter {
  async executeCapability(params: any): Promise<any> {
    return { ok: true };
  }
}

describe('BaseRuntimeAdapter EventBuffer', () => {
  test('buffers events before bind, replays after bind', async () => {
    const adapter = new TestAdapter();
    const events: string[] = [];

    // dispatch before bind
    adapter.dispatch('test.event1', {});
    adapter.dispatch('test.event2', {});

    expect(events).toEqual([]); // no hookManager yet

    // bind with mock
    const mockHookManager = {
      execute: async (event: string, ctx: any) => { events.push(event); }
    };
    adapter.bind(mockHookManager as any);

    expect(events).toEqual(['test.event1', 'test.event2']);
  });

  test('dispatches immediately after bind', async () => {
    const adapter = new TestAdapter();
    const events: string[] = [];

    const mockHookManager = {
      execute: async (event: string, ctx: any) => { events.push(event); }
    };
    adapter.bind(mockHookManager as any);

    adapter.dispatch('test.event3', {});
    expect(events).toEqual(['test.event3']);
  });

  test('dispatchAsync returns context', async () => {
    const adapter = new TestAdapter();
    const mockHookManager = {
      execute: async (event: string, ctx: any) => { ctx.modified = true; }
    };
    adapter.bind(mockHookManager as any);

    const ctx = { value: 1 };
    const result = await adapter.dispatchAsync('test.event', ctx);
    expect(result.modified).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/runtime/RuntimeAdapter.test.ts
```

Expected: FAIL with module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/runtime/RuntimeAdapter.ts

export interface RuntimeAdapter {
  bind(hookManager: { execute(event: string, context: any): Promise<void> }): void;
  executeCapability(params: {
    type: 'tool' | 'skill' | 'chain';
    name: string;
    goalId: string;
    context: Record<string, any>;
    args?: any;
  }): Promise<any>;
}

export abstract class BaseRuntimeAdapter implements RuntimeAdapter {
  protected hookManager: { execute(event: string, context: any): Promise<void> } | null = null;
  private eventBuffer: Array<{ event: string; ctx: any }> = [];

  bind(hookManager: { execute(event: string, context: any): Promise<void> }): void {
    this.hookManager = hookManager;
    while (this.eventBuffer.length) {
      const { event, ctx } = this.eventBuffer.shift()!;
      hookManager.execute(event, ctx);
    }
  }

  protected dispatch(event: string, ctx: any): void {
    if (this.hookManager) {
      this.hookManager.execute(event, ctx);
    } else {
      this.eventBuffer.push({ event, ctx });
    }
  }

  protected async dispatchAsync(event: string, ctx: any): Promise<any> {
    if (this.hookManager) {
      await this.hookManager.execute(event, ctx);
    }
    return ctx;
  }

  abstract executeCapability(params: {
    type: 'tool' | 'skill' | 'chain';
    name: string;
    goalId: string;
    context: any;
    args?: any;
  }): Promise<any>;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/unit/runtime/RuntimeAdapter.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/RuntimeAdapter.ts tests/unit/runtime/RuntimeAdapter.test.ts
git commit -m "feat(runtime): add RuntimeAdapter interface + BaseRuntimeAdapter with EventBuffer"
```

---

## Task 2: OpenCodeAdapter implementation

**Files:**
- Create: `src/runtime/OpenCodeAdapter.ts`
- Create: `src/runtime/index.ts`
- Test: `tests/unit/runtime/OpenCodeAdapter.test.ts`

**Interfaces:**
- Consumes: `BaseRuntimeAdapter` from Task 1
- Produces: `OpenCodeAdapter` class with event methods

- [ ] **Step 1: Write the failing test**

```typescript
import { OpenCodeAdapter } from '../../../src/runtime/OpenCodeAdapter';

describe('OpenCodeAdapter', () => {
  let adapter: OpenCodeAdapter;
  let hookCalls: Array<{ event: string; ctx: any }>;

  beforeEach(() => {
    hookCalls = [];
    adapter = new OpenCodeAdapter({ directory: '/test/project' });
    adapter.bind({
      execute: async (event: string, ctx: any) => { hookCalls.push({ event, ctx }); }
    });
  });

  test('onSessionEnd dispatches session.end', () => {
    adapter.onSessionEnd({ sessionID: 'sess-1' });
    expect(hookCalls[0].event).toBe('session.end');
    expect(hookCalls[0].ctx.sessionId).toBe('sess-1');
  });

  test('onToolBefore dispatches tool.execute.before', () => {
    adapter.onToolBefore({ tool: 'read', sessionID: 'sess-1' });
    expect(hookCalls[0].event).toBe('tool.execute.before');
  });

  test('onToolAfter dispatches tool.execute.after with data', () => {
    adapter.onToolAfter({ tool: 'read', sessionID: 'sess-1' }, { output: 'content' });
    expect(hookCalls[0].event).toBe('tool.execute.after');
    expect(hookCalls[0].ctx.data.output).toBe('content');
  });

  test('onChatMessage dispatches user.prompt.submit and returns message', async () => {
    const ctx = { sessionID: 'sess-1', message: { parts: [{ text: 'hello' }] }, parts: [] };
    const result = await adapter.onChatMessage(ctx);
    expect(hookCalls[0].event).toBe('user.prompt.submit');
    expect(result.message).toBe(ctx.message);
  });

  test('onRuntimeEvent session.created dispatches session.start', () => {
    adapter.onRuntimeEvent({ type: 'session.created', info: { id: 'sess-1' } });
    expect(hookCalls[0].event).toBe('session.start');
    expect(hookCalls[0].ctx.sessionId).toBe('sess-1');
  });

  test('onTextComplete dispatches llm.call.after', () => {
    adapter.onTextComplete({ sessionID: 'sess-1', messageID: 'm1', partID: 'p1' }, { text: 'response' });
    expect(hookCalls[0].event).toBe('llm.call.after');
    expect(hookCalls[0].ctx.text).toBe('response');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/runtime/OpenCodeAdapter.test.ts
```

Expected: FAIL with module not found.

- [ ] **Step 3: Write implementation**

```typescript
// src/runtime/OpenCodeAdapter.ts
import { BaseRuntimeAdapter } from './RuntimeAdapter';

export interface OpenCodeAdapterOptions {
  directory: string;
  opencodeClient?: any;
}

export class OpenCodeAdapter extends BaseRuntimeAdapter {
  private directory: string;
  private opencodeClient?: any;
  private sessionMap = new Map<string, string>();

  constructor(options: OpenCodeAdapterOptions) {
    super();
    this.directory = options.directory;
    this.opencodeClient = options.opencodeClient;
  }

  onSessionEnd(ctx: { sessionID: string }): void {
    this.dispatch('session.end', { sessionId: ctx.sessionID, projectDir: this.directory });
  }

  onToolBefore(ctx: { tool: string; sessionID: string; callID?: string; args?: any }): void {
    this.dispatch('tool.execute.before', ctx);
  }

  onToolAfter(ctx: { tool: string; sessionID: string; callID?: string; args?: any }, result: any): void {
    this.dispatch('tool.execute.after', { ...ctx, data: result });
  }

  async onChatMessage(ctx: { sessionID: string; message?: any; parts?: any[] }): Promise<{ message: any; parts: any[] }> {
    const modifiedCtx = await this.dispatchAsync('user.prompt.submit', {
      sessionID: ctx.sessionID,
      message: ctx.message,
      parts: ctx.parts || [],
    });
    return { message: modifiedCtx.message, parts: modifiedCtx.parts || [] };
  }

  onRuntimeEvent(event: { type: string; info?: any; sessionID?: string }): void {
    if (event.type === 'session.created') {
      const sessionId = event.info?.id || event.sessionID;
      if (sessionId && this.directory) {
        this.sessionMap.set(sessionId, this.directory);
      }
      this.dispatch('session.start', { sessionId, projectDir: this.directory });
      return;
    }
    const sessionId = event.sessionID || event.info?.sessionID;
    const projectDir = sessionId ? this.sessionMap.get(sessionId) || this.directory : this.directory;
    this.dispatch(`runtime.${event.type}`, { ...event, sessionId, projectDir });
  }

  onTextComplete(ctx: { sessionID: string; messageID?: string; partID?: string }, result: any): void {
    this.dispatch('llm.call.after', { sessionID: ctx.sessionID, text: result?.text || '' });
  }

  onSessionCompacting(ctx: { sessionID: string }, snapshot: any): void {
    this.dispatch('session.compacting', { sessionID: ctx.sessionID, projectDir: this.directory });
  }

  async executeCapability(params: {
    type: 'tool' | 'skill' | 'chain';
    name: string;
    goalId: string;
    context: any;
    args?: any;
  }): Promise<any> {
    const runtimeCtx = { ...params.context, goalId: params.goalId, projectDir: this.directory };
    if (params.type === 'skill') {
      if (!this.opencodeClient?.runSkill) {
        throw new Error('OpenCodeAdapter: opencodeClient.runSkill not available');
      }
      return this.opencodeClient.runSkill(params.name, runtimeCtx);
    }
    throw new Error(`OpenCodeAdapter: unsupported capability type ${params.type}`);
  }
}
```

- [ ] **Step 4: Create barrel export**

```typescript
// src/runtime/index.ts
export { RuntimeAdapter, BaseRuntimeAdapter } from './RuntimeAdapter';
export { OpenCodeAdapter } from './OpenCodeAdapter';
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- tests/unit/runtime/OpenCodeAdapter.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/runtime/OpenCodeAdapter.ts src/runtime/index.ts tests/unit/runtime/OpenCodeAdapter.test.ts
git commit -m "feat(runtime): add OpenCodeAdapter with event bridge methods"
```

---

## Task 3: 迁移 plugin.ts 委托 OpenCodeAdapter

**Files:**
- Modify: `src/plugin.ts`

- [ ] **Step 1: Write the failing test** (先确认现有测试通过作为基线)

```bash
npm test -- tests/unit/hooks/
```

Expected: all passing.

- [ ] **Step 2: 修改 plugin.ts — 注入 OpenCodeAdapter 替代内联事件处理**

替换顶部 imports，添加：

```typescript
import { OpenCodeAdapter } from './runtime/OpenCodeAdapter';
```

在 `MafwPlugin` 函数体中，`hookManager` 创建之后，添加：

```typescript
  const runtimeAdapter = new OpenCodeAdapter({ directory });
  runtimeAdapter.bind(hookManager);
```

然后移除所有现有的 `hookManager.register()` 中由 OpenCodeAdapter 代为处理的事件（session-ending, tool-executed, cost-recording, cost-threshold, session-start, tool-before, user-prompt, llm-after, session-compacting 等由 HookManager 注册的handler），改为在 Adapter 中处理。

**注意：Wave 1 的内存事件（memory.write/recall/contradiction/decay）和 handoff-detector 仍然保留在直接注册中，因为它们是 MAFW 内部事件，不由 OpenCode 触发。**

`plugin.ts` 中 setup hookManager 的部分简化为仅含内部事件：

```typescript
  // 内部事件（非 OpenCode 触发）
  hookManager.register({ name: 'memory-write-handler', event: 'memory.write', ... });
  hookManager.register({ name: 'memory-recall-handler', event: 'memory.recall', ... });
  hookManager.register({ name: 'memory-contradiction-handler', event: 'memory.contradiction', ... });
  hookManager.register({ name: 'memory-decay-handler', event: 'memory.decay', ... });
  hookManager.register({ name: 'handoff-detector', event: 'session.end', priority: 90, ... });
```

返回对象中的 `hooks` / `event` / `experimental.*` 改为委托 Adapter：

```typescript
    hooks: {
      'session.end': (ctx: any) => runtimeAdapter.onSessionEnd(ctx),
      'tool.execute.before': (ctx: any) => runtimeAdapter.onToolBefore(ctx),
      'tool.execute.after': (ctx: any, r: any) => runtimeAdapter.onToolAfter(ctx, r),
      'chat.message': (ctx: any) => runtimeAdapter.onChatMessage(ctx),
    },
    event: async ({ event }: any) => runtimeAdapter.onRuntimeEvent(event),
    'experimental.text.complete': (ctx: any, r: any) => runtimeAdapter.onTextComplete(ctx, r),
    'experimental.session.compacting': (ctx: any, s: any) => runtimeAdapter.onSessionCompacting(ctx, s),
    'experimental.chat.messages.transform': async (input: any, output: any) => {
      // 纯 OpenCode 特有逻辑，保留不动
    },
```

- [ ] **Step 3: Run tests to verify**

```bash
npm test
```

Expected: all 520+ tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/plugin.ts
git commit -m "refactor(plugin): delegate OpenCode events to OpenCodeAdapter"
```

---

## Task 4: MafwCallbackHandler (LangChain 事件入站)

**Files:**
- Create: `src/runtime/MafwCallbackHandler.ts`
- Test: `tests/unit/runtime/MafwCallbackHandler.test.ts`

**Interfaces:**
- Consumes: `BaseRuntimeAdapter` from Task 1
- Produces: `MafwCallbackHandler` class extends `BaseRuntimeAdapter` + `BaseCallbackHandler`

- [ ] **Step 1: Write the failing test**

```typescript
import { MafwCallbackHandler } from '../../../src/runtime/MafwCallbackHandler';

describe('MafwCallbackHandler', () => {
  let handler: MafwCallbackHandler;
  let hookCalls: Array<{ event: string; ctx: any }>;

  beforeEach(() => {
    hookCalls = [];
    handler = new MafwCallbackHandler();
    handler.bind({
      execute: async (event: string, ctx: any) => { hookCalls.push({ event, ctx }); }
    });
  });

  test('onChainStart root triggers session.start', async () => {
    await handler.onChainStart('run-a', undefined, [], {}, {});
    expect(hookCalls[0].event).toBe('session.start');
  });

  test('onChainStart sub-chain does not trigger session.start', async () => {
    await handler.onChainStart('run-a', undefined, [], {}, {});
    await handler.onChainStart('run-b', 'run-a', [], {}, {});
    expect(hookCalls.filter(c => c.event === 'session.start')).toHaveLength(1);
  });

  test('onChainEnd root triggers session.end', async () => {
    await handler.onChainStart('run-a', undefined, [], {}, {});
    await handler.onChainEnd({}, 'run-a');
    expect(hookCalls.filter(c => c.event === 'session.end')).toHaveLength(1);
  });

  test('onChainEnd sub-chain does not trigger session.end', async () => {
    await handler.onChainStart('run-a', undefined, [], {}, {});
    await handler.onChainStart('run-b', 'run-a', [], {}, {});
    await handler.onChainEnd({}, 'run-b');
    expect(hookCalls.filter(c => c.event === 'session.end')).toHaveLength(0);
  });

  test('onLLMStart dispatches llm.call.before', async () => {
    await handler.onChainStart('run-a', undefined, [], {}, {});
    await handler.onLLMStart({ name: 'gpt-4' }, ['prompt'], 'run-b', 'run-a');
    expect(hookCalls.some(c => c.event === 'llm.call.before')).toBe(true);
  });

  test('onToolStart dispatches tool.execute.before', async () => {
    await handler.onChainStart('run-a', undefined, [], {}, {});
    await handler.onToolStart({ name: 'read' }, 'input', 'run-b', 'run-a');
    expect(hookCalls.some(c => c.event === 'tool.execute.before')).toBe(true);
  });

  test('resume detection dispatches session.handoff', async () => {
    await handler.onChainStart('run-a', undefined, [], {}, { resumeValue: { data: 'x' } });
    expect(hookCalls.some(c => c.event === 'session.handoff')).toBe(true);
  });

  test('interrupt detection dispatches session.handoff pause', async () => {
    await handler.onChainStart('run-a', undefined, [], {}, {});
    await handler.onChainEnd({ interrupt: { value: 'pause' } }, 'run-a');
    expect(hookCalls.some(c => c.event === 'session.handoff')).toBe(true);
  });

  test('resumedThreads prevents duplicate session.start', async () => {
    await handler.onChainStart('run-a', undefined, [], {}, { configurable: { thread_id: 'goal-1' } });
    await handler.onChainEnd({}, 'run-a');
    // second invoke = resume
    await handler.onChainStart('run-b', undefined, [], {}, { configurable: { thread_id: 'goal-1' } });
    const starts = hookCalls.filter(c => c.event === 'session.start');
    expect(starts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/runtime/MafwCallbackHandler.test.ts
```

Expected: FAIL with module not found.

- [ ] **Step 3: Write implementation**

```typescript
// src/runtime/MafwCallbackHandler.ts
import { BaseCallbackHandler } from '@langchain/core/callbacks/manager';
import { BaseRuntimeAdapter } from './RuntimeAdapter';

export class MafwCallbackHandler extends BaseRuntimeAdapter {
  name = 'MafwCallbackHandler';
  private runTree = new Map<string, { type: string; sessionId: string; parentRunId?: string }>();
  private resumedThreads = new Set<string>();
  private toolRegistry: Record<string, any> = {};

  registerTool(name: string, tool: any): void {
    this.toolRegistry[name] = tool;
  }

  async onChainStart(
    runId: string,
    parentRunId: string | undefined,
    tags?: string[],
    metadata?: any,
    config?: any,
  ): Promise<void> {
    const threadId = config?.configurable?.thread_id;
    const isResume = config?.resumeValue !== undefined || this.resumedThreads.has(threadId);

    let sessionId: string;
    if (!parentRunId) {
      sessionId = `lc_${runId}`;
      if (!isResume) {
        this.dispatch('session.start', { sessionId });
      }
      if (threadId) this.resumedThreads.add(threadId);
    } else {
      sessionId = this.runTree.get(parentRunId)?.sessionId || `lc_${runId}`;
    }
    this.runTree.set(runId, { type: 'chain', sessionId, parentRunId });

    if (config?.resumeValue !== undefined) {
      this.dispatch('session.handoff', { sessionId, type: 'resume', resumeValue: config.resumeValue });
    }
  }

  async onChainEnd(output: any, runId: string): Promise<void> {
    const meta = this.runTree.get(runId);
    if (!meta) return;

    if (output?.interrupt) {
      this.dispatch('session.handoff', { sessionId: meta.sessionId, type: 'pause', interruptInfo: output.interrupt });
      return;
    }
    if (!meta.parentRunId) {
      this.dispatch('session.end', { sessionId: meta.sessionId });
    }
    this.runTree.delete(runId);
  }

  async onLLMStart(serialized: any, prompts: string[], runId: string, parentRunId?: string): Promise<void> {
    const parent = parentRunId ? this.runTree.get(parentRunId) : null;
    this.dispatch('llm.call.before', { sessionId: parent?.sessionId || 'unknown', model: serialized?.name, prompts, runId });
    this.runTree.set(runId, { type: 'llm', sessionId: parent?.sessionId || '' });
  }

  async onLLMEnd(response: any, runId: string): Promise<void> {
    const meta = this.runTree.get(runId);
    this.dispatch('llm.call.after', { sessionId: meta?.sessionId || 'unknown', runId, generations: response?.generations });
  }

  async onToolStart(serialized: any, input: string, runId: string, parentRunId?: string): Promise<void> {
    const parent = parentRunId ? this.runTree.get(parentRunId) : null;
    this.dispatch('tool.execute.before', { tool: serialized?.name, input, runId, sessionId: parent?.sessionId || 'unknown' });
    this.runTree.set(runId, { type: 'tool', sessionId: parent?.sessionId || '' });
  }

  async onToolEnd(output: string, runId: string): Promise<void> {
    const meta = this.runTree.get(runId);
    this.dispatch('tool.execute.after', { runId, sessionId: meta?.sessionId || 'unknown', output });
  }

  async onRetrieverStart(serialized: any, query: string, runId: string, parentRunId?: string): Promise<void> {
    const parent = parentRunId ? this.runTree.get(parentRunId) : null;
    this.dispatch('memory.recall', { query, sessionId: parent?.sessionId || 'unknown', runId });
  }

  async onRetrieverEnd(response: any, runId: string): Promise<void> {
    const meta = this.runTree.get(runId);
    this.dispatch('memory.recall', { ...meta, response, completed: true });
  }

  async executeCapability(params: {
    type: 'tool' | 'skill' | 'chain';
    name: string;
    goalId: string;
    context: any;
    args?: any;
  }): Promise<any> {
    if (params.type === 'skill') {
      const entryPath = `../skills/${params.name}/entry`;
      try {
        const { default: skillEntry } = await import(entryPath);
        const runtimeCtx = { ...params.context, goalId: params.goalId, projectDir: params.context.projectDir };
        return await skillEntry(runtimeCtx);
      } catch (err: any) {
        throw new Error(`LangChainAdapter: failed to execute skill "${params.name}": ${err.message}`);
      }
    }
    if (params.type === 'tool') {
      const tool = this.toolRegistry[params.name];
      if (!tool) throw new Error(`LangChainAdapter: unknown tool "${params.name}"`);
      return tool.invoke(params.args);
    }
    throw new Error(`LangChainAdapter: unsupported capability type ${params.type}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/unit/runtime/MafwCallbackHandler.test.ts
```

Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/MafwCallbackHandler.ts tests/unit/runtime/MafwCallbackHandler.test.ts
git commit -m "feat(runtime): add MafwCallbackHandler (LangChain event inbound)"
```

---

## Task 5: MafwFileCheckpointer

**Files:**
- Create: `src/runtime/MafwFileCheckpointer.ts`
- Test: `tests/unit/runtime/MafwFileCheckpointer.test.ts`

**Interfaces:**
- Produces: `MafwFileCheckpointer` extends `BaseCheckpointSaver` with state.json ↔ checkpoint format conversion

- [ ] **Step 1: Write the failing test**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { MafwFileCheckpointer } from '../../../src/runtime/MafwFileCheckpointer';

describe('MafwFileCheckpointer', () => {
  let tmpDir: string;
  let checkpointer: MafwFileCheckpointer;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
    const stateDir = path.join(tmpDir, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    checkpointer = new MafwFileCheckpointer({ baseDir: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('put writes state.json', async () => {
    const checkpoint = {
      id: 'cp-1', ts: '2026-01-01T00:00:00Z', version: 1,
      channelValues: { goalId: 'g1', phase: 'PLANNING', loop: 1, nextAction: 'CREATE_EXECUTE_SESSION' },
    };
    await checkpointer.put(
      { configurable: { thread_id: 'g1', goalId: 'g1' } },
      checkpoint as any,
      { source: 'test', step: 1 } as any,
    );
    const statePath = path.join(tmpDir, 'state', 'g1.json');
    expect(fs.existsSync(statePath)).toBe(true);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    expect(state.goalId).toBe('g1');
    expect(state.loop).toBe(1);
  });

  test('get reads from state.json', async () => {
    const statePath = path.join(tmpDir, 'state', 'g1.json');
    fs.writeFileSync(statePath, JSON.stringify({
      version: '2', goalId: 'g1', loop: 2, phase: 'EXECUTING',
      nextAction: 'CREATE_REVIEW_SESSION', currentWave: 1, totalWaves: 3,
      updatedAt: '2026-01-01T00:00:00Z',
    }));
    const result = await checkpointer.get({ configurable: { thread_id: 'g1', goalId: 'g1' } });
    expect(result).toBeDefined();
    expect((result as any).channelValues.goalId).toBe('g1');
    expect((result as any).channelValues.loop).toBe(2);
  });

  test('list returns checkpoints in descending step order', async () => {
    const cpDir = path.join(tmpDir, 'checkpoints', 'langgraph', 'g1');
    fs.mkdirSync(cpDir, { recursive: true });
    fs.writeFileSync(path.join(cpDir, 'step_1.json'), JSON.stringify({
      checkpoint: { id: 'cp-1', ts: '2026-01-01T00:00:00Z', version: 1 },
      metadata: { source: 'test', step: 1 },
    }));
    fs.writeFileSync(path.join(cpDir, 'step_2.json'), JSON.stringify({
      checkpoint: { id: 'cp-2', ts: '2026-01-02T00:00:00Z', version: 1 },
      metadata: { source: 'test', step: 2 },
    }));
    const tuples: any[] = [];
    const gen = checkpointer.list({ configurable: { thread_id: 'g1', goalId: 'g1' } });
    for await (const t of gen) tuples.push(t);
    expect(tuples).toHaveLength(2);
    expect(tuples[0].metadata.step).toBe(2); // newest first
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/runtime/MafwFileCheckpointer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write implementation**

```typescript
// src/runtime/MafwFileCheckpointer.ts
import * as fs from 'fs';
import * as path from 'path';
import { BaseCheckpointSaver } from '@langchain/langgraph';

interface Checkpoint { id: string; ts: string; version: number; channelValues?: Record<string, any>; }
interface CheckpointMetadata { source?: string; step?: number; [key: string]: any; }
interface CheckpointTuple { checkpoint: Checkpoint; metadata: CheckpointMetadata; config: any; }

export class MafwFileCheckpointer extends BaseCheckpointSaver {
  private baseDir: string;

  constructor(config: { baseDir: string }) {
    super();
    this.baseDir = config.baseDir;
  }

  async get(config: any): Promise<Checkpoint | undefined> {
    const goalId = config.configurable?.goalId || config.configurable?.thread_id;
    if (!goalId) return;
    const statePath = path.join(this.baseDir, 'state', `${goalId}.json`);
    if (!fs.existsSync(statePath)) return;
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    return this.stateToCheckpoint(state);
  }

  async put(config: any, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<void> {
    const goalId = config.configurable?.goalId || config.configurable?.thread_id;
    if (!goalId) return;
    const stateData = this.checkpointToState(checkpoint, metadata);
    const statePath = path.join(this.baseDir, 'state', `${goalId}.json`);
    const stateDir = path.dirname(statePath);
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(stateData, null, 2));
    const cpDir = path.join(this.baseDir, 'checkpoints', 'langgraph', goalId);
    if (!fs.existsSync(cpDir)) fs.mkdirSync(cpDir, { recursive: true });
    const cpPath = path.join(cpDir, `step_${metadata?.step || 0}.json`);
    fs.writeFileSync(cpPath, JSON.stringify({ checkpoint, metadata }));
  }

  async getTuple(config: any): Promise<CheckpointTuple | undefined> {
    const goalId = config.configurable?.goalId || config.configurable?.thread_id;
    if (!goalId) return;
    const statePath = path.join(this.baseDir, 'state', `${goalId}.json`);
    if (!fs.existsSync(statePath)) return;
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    const checkpoint = this.stateToCheckpoint(state);
    return {
      checkpoint,
      metadata: { source: 'mafw_file', step: state.loop || 0 },
      config: { configurable: { thread_id: goalId, goalId } },
    };
  }

  async *list(config: any): AsyncGenerator<CheckpointTuple> {
    const goalId = config.configurable?.goalId || config.configurable?.thread_id;
    if (!goalId) return;
    const cpDir = path.join(this.baseDir, 'checkpoints', 'langgraph', goalId);
    if (!fs.existsSync(cpDir)) return;
    const files = fs.readdirSync(cpDir).filter(f => f.startsWith('step_') && f.endsWith('.json'));
    files.sort((a, b) => {
      const stepA = parseInt(a.split('_')[1]);
      const stepB = parseInt(b.split('_')[1]);
      return stepB - stepA;
    });
    for (const file of files) {
      const data = JSON.parse(fs.readFileSync(path.join(cpDir, file), 'utf-8'));
      yield { checkpoint: data.checkpoint, metadata: data.metadata, config: { configurable: { thread_id: goalId, goalId } } };
    }
  }

  private stateToCheckpoint(state: any): Checkpoint {
    return {
      id: `mafw_${state.goalId}_loop${state.loop}`,
      ts: new Date(state.updatedAt || Date.now()).toISOString(),
      version: 1,
      channelValues: {
        goalId: state.goalId,
        phase: state.phase,
        loop: state.loop,
        nextAction: state.nextAction,
        currentWave: state.currentWave,
        totalWaves: state.totalWaves,
      },
    };
  }

  private checkpointToState(checkpoint: Checkpoint, metadata: CheckpointMetadata): any {
    const cv = checkpoint.channelValues || {};
    return {
      version: '2',
      goalId: cv.goalId,
      loop: cv.loop || 0,
      phase: cv.phase || 'PENDING',
      nextAction: cv.nextAction || null,
      currentWave: cv.currentWave || 0,
      totalWaves: cv.totalWaves || null,
      artifacts: {},
      sessions: {},
      updatedAt: checkpoint.ts || new Date().toISOString(),
    };
  }
}
```

- [ ] **Step 4: Export from runtime/index.ts**

```typescript
export { MafwFileCheckpointer } from './MafwFileCheckpointer';
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- tests/unit/runtime/MafwFileCheckpointer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/MafwFileCheckpointer.ts src/runtime/index.ts tests/unit/runtime/MafwFileCheckpointer.test.ts
git commit -m "feat(runtime): add MafwFileCheckpointer with state.json ↔ checkpoint conversion"
```

---

## Task 6: LangChain 节点适配 + 运行时入口

**Files:**
- Create: `src/runtime/langchain-nodes/plan.node.ts`
- Create: `src/runtime/langchain-nodes/execute.node.ts`
- Create: `src/runtime/langchain-nodes/review.node.ts`
- Create: `src/runtime/langchain-nodes/index.ts`
- Test: `tests/unit/runtime/langchain-nodes/plan.node.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { planNodeWithAdapter } from '../../../src/runtime/langchain-nodes/plan.node';

describe('planNodeWithAdapter', () => {
  test('calls executeCapability and returns updated state', async () => {
    const executed: any[] = [];
    const mockRuntime = {
      executeCapability: async (params: any) => {
        executed.push(params);
        return { artifacts: { wavesPath: 'waves/g1.json' }, nextAction: 'CREATE_EXECUTE_SESSION' };
      }
    };

    const state = { goalId: 'g1', projectDir: '/test', phase: 'PLANNING', loop: 1 } as any;
    const result = await planNodeWithAdapter(state, mockRuntime as any);

    expect(executed).toHaveLength(1);
    expect(executed[0].name).toBe('mafw-plan');
    expect(result.wavePlanPath).toBe('waves/g1.json');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/runtime/langchain-nodes/plan.node.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write implementations**

```typescript
// src/runtime/langchain-nodes/plan.node.ts
import { RuntimeAdapter } from '../RuntimeAdapter';

export async function planNodeWithAdapter(state: any, runtime: RuntimeAdapter): Promise<any> {
  const result = await runtime.executeCapability({
    type: 'skill',
    name: 'mafw-plan',
    goalId: state.goalId,
    context: { goalId: state.goalId, projectDir: state.projectDir, state: { ...state, phase: 'PLANNING' } },
  });
  return {
    phase: 'EXECUTING',
    wavePlanPath: result.artifacts.wavesPath,
    nextAction: 'CREATE_EXECUTE_SESSION',
  };
}

// src/runtime/langchain-nodes/execute.node.ts
export async function executeNodeWithAdapter(state: any, runtime: RuntimeAdapter): Promise<any> {
  const result = await runtime.executeCapability({
    type: 'skill',
    name: 'mafw-execute',
    goalId: state.goalId,
    context: { goalId: state.goalId, projectDir: state.projectDir, state: { ...state, phase: 'EXECUTING' } },
  });
  return {
    phase: 'REVIEW',
    receiptPath: result.artifacts.receiptsPath,
    nextAction: 'CREATE_REVIEW_SESSION',
  };
}

// src/runtime/langchain-nodes/review.node.ts
export async function reviewNodeWithAdapter(state: any, runtime: RuntimeAdapter): Promise<any> {
  const result = await runtime.executeCapability({
    type: 'skill',
    name: 'mafw-review',
    goalId: state.goalId,
    context: { goalId: state.goalId, projectDir: state.projectDir, state: { ...state, phase: 'REVIEW' } },
  });
  const isPass = result.nextAction === 'PASS';
  return {
    phase: isPass ? 'COMPLETED' : 'PLANNING',
    reviewVerdict: isPass ? 'PASS' : 'FAIL',
    reviewReportPath: result.artifacts.reviewPath,
    nextAction: isPass ? 'PASS' : 'FAIL',
  };
}

// src/runtime/langchain-nodes/index.ts
export { planNodeWithAdapter } from './plan.node';
export { executeNodeWithAdapter } from './execute.node';
export { reviewNodeWithAdapter } from './review.node';
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/unit/runtime/langchain-nodes/plan.node.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/langchain-nodes/ tests/unit/runtime/langchain-nodes/
git commit -m "feat(runtime): add LangChain node adapters for plan/execute/review"
```

---

## Task 7: 运行时选择入口 + 集成测试

**Files:**
- Modify: `src/runtime/index.ts`
- Test: `tests/unit/runtime/runtime-selector.test.ts`

- [ ] **Step 1: Add runtime selector to index.ts**

```typescript
export function createRuntime(type: 'opencode' | 'langchain', options: any): RuntimeAdapter {
  if (type === 'opencode') {
    return new OpenCodeAdapter(options);
  }
  if (type === 'langchain') {
    const handler = new MafwCallbackHandler();
    if (options.hookManager) handler.bind(options.hookManager);
    return handler;
  }
  throw new Error(`Unknown runtime type: ${type}`);
}
```

- [ ] **Step 2: Write integration test**

```typescript
import { createRuntime } from '../../../src/runtime/index';

describe('createRuntime', () => {
  test('creates OpenCodeAdapter with opencode type', () => {
    const adapter = createRuntime('opencode', { directory: '/test' });
    expect(adapter.constructor.name).toBe('OpenCodeAdapter');
  });

  test('creates MafwCallbackHandler with langchain type', () => {
    const adapter = createRuntime('langchain', {});
    expect(adapter.constructor.name).toBe('MafwCallbackHandler');
  });

  test('throws on unknown type', () => {
    expect(() => createRuntime('invalid' as any, {})).toThrow('Unknown runtime type');
  });
});
```

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: all suites pass.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/index.ts tests/unit/runtime/runtime-selector.test.ts
git commit -m "feat(runtime): add createRuntime selector + integration tests"
```
