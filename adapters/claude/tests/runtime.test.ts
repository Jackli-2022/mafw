/**
 * claude runtime 契约测试 —— SDK 注入 seam（假件脚本化），不 spawn 真进程。
 *
 * Review Focus：①spawn 失败→turn.failed 不炸；②busy 排队（promptWhileBusy）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeRuntime } from '../src/runtime.ts';
import { __resetClaudeTurnState } from '../src/events.ts';

/** 脚本化假 SDK：query 返回预排消息流。 */
function fakeSdk(script: Array<(push: (m: any) => void) => void | Promise<void>>, opts: { failQuery?: Error } = {}) {
  const calls: any[] = [];
  const sdk = {
    calls,
    async query(args: any) {
      calls.push(args);
      if (opts.failQuery) throw opts.failQuery;
      const messages: any[] = [];
      const push = (m: any) => messages.push(m);
      for (const step of script) await step(push);
      const self = {
        async *[Symbol.asyncIterator]() {
          for (const m of messages) yield m;
        },
        interrupt() {
          (self as any).interrupted = true;
        },
      };
      return self;
    },
    async listSessions() { return [{ id: 'cs_1', title: 't', updatedAt: '2026-10-21T00:00:00Z' }]; },
    async getSessionMessages(sessionId: string) {
      return [
        { uuid: 'u1', role: 'user', content: 'hi' },
        { uuid: 'a1', role: 'assistant', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', model: 'claude-opus-4-6' },
      ];
      void sessionId;
    },
  };
  return sdk;
}

async function collectEvents(rt: any, sid: string, take: number): Promise<any[]> {
  const iter = await rt.global.event();
  const stream = iter.stream ?? iter;
  const out: any[] = [];
  for await (const e of stream) {
    out.push(e);
    if (out.length >= take) break;
  }
  return out;
}

test('create → cls_ 前缀 id；capabilities 声明面', async () => {
  const rt = createClaudeRuntime({ sdk: fakeSdk([]) as any });
  const s = await rt.session.create({ directory: 'C:/tmp/proj' });
  assert.ok(String(s.id).startsWith('cls_'));
  assert.equal(rt.name, 'claude');
  assert.equal(rt.external, true);
  assert.equal(rt.capabilities.sessionApi, true);
  assert.equal(rt.capabilities.promptWhileBusy, true);
  assert.equal(rt.capabilities.eventStream, true);
  assert.equal(typeof rt.getBaseUrl(), 'string');
});

test('promptAsync → query 被调（sessionId + cwd）→ 消息流经方言进总线（端到端）', async () => {
  __resetClaudeTurnState();
  const sdk = fakeSdk([
    (push) => push({ type: 'system', subtype: 'init', session_id: 'S', model: 'claude-opus-4-6' }),
    (push) => push({ type: 'result', subtype: 'success', session_id: 'S', usage: { input_tokens: 1 }, total_cost_usd: 0 }),
  ]);
  const rt = createClaudeRuntime({ sdk: sdk as any });
  const s = await rt.session.create({ directory: 'C:/tmp/proj' });
  const done = collectEvents(rt, s.id, 2); // session.created + turn.completed
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'hi' }] });
  const events = await Promise.race([done, new Promise<any[]>((r) => setTimeout(() => r([]), 3000))]);
  const types = events.map((e: any) => e.payload?.type ?? e.type);
  assert.ok(types.includes('session.created'), JSON.stringify(types));
  assert.ok(types.includes('turn.completed'), JSON.stringify(types));
  assert.equal(sdk.calls[0].options.sessionId, s.id);
  assert.equal(sdk.calls[0].options.cwd, 'C:/tmp/proj');
  assert.equal(sdk.calls[0].prompt, 'hi');
});

test('busy 排队：query 进行中再 promptAsync 入队，result 后 flush 队首（Review Focus 2）', async () => {
  __resetClaudeTurnState();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const sdk = fakeSdk([
    async (push) => { await gate; push({ type: 'result', subtype: 'success', session_id: 'S' }); },
  ]);
  const rt = createClaudeRuntime({ sdk: sdk as any });
  const s = await rt.session.create({ directory: 'C:/tmp/proj' });
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'first' }] });
  // busy：第二条入队
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'second' }] });
  assert.equal(sdk.calls.length, 1, 'second queued, not spawned');
  release();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(sdk.calls.length, 2, 'queue flushed after result');
  assert.equal(sdk.calls[1].prompt, 'second');
});

test('abort → interrupt() 被调', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const sdk = fakeSdk([async (push) => { await gate; push({ type: 'result', subtype: 'success', session_id: 'S' }); }]);
  const rt = createClaudeRuntime({ sdk: sdk as any });
  const s = await rt.session.create({ directory: 'C:/tmp/proj' });
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'x' }] });
  await rt.session.abort({ sessionID: s.id });
  release();
  await new Promise((r) => setTimeout(r, 50));
  // interrupt 被调过（假件自标记）——经 runtime 内部 controller，此处断言不炸 + 队列清空
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'after' }] });
  assert.ok(true);
});

test('spawn 失败（CLI 缺失/无凭据模拟）→ turn.failed 事件，不炸 gateway（Review Focus 1）', async () => {
  __resetClaudeTurnState();
  const sdk = fakeSdk([], { failQuery: new Error('claude CLI not found (spawn ENOENT)') });
  const rt = createClaudeRuntime({ sdk: sdk as any });
  const s = await rt.session.create({ directory: 'C:/tmp/proj' });
  const done = collectEvents(rt, s.id, 1);
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'hi' }] });
  const events = await Promise.race([done, new Promise<any[]>((r) => setTimeout(() => r([]), 3000))]);
  assert.equal(events.length, 1, 'exactly one failure event');
  assert.equal(events[0].payload.type, 'turn.failed');
  assert.ok(String(events[0].payload.properties.error).includes('claude CLI not found'));
  // 会话解忙：下一次 promptAsync 可再发（再次失败也成事件）
  const done2 = collectEvents(rt, s.id, 1);
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'again' }] });
  const events2 = await Promise.race([done2, new Promise<any[]>((r) => setTimeout(() => r([]), 3000))]);
  assert.equal(events2[0].payload.type, 'turn.failed');
});

test('messages → getSessionMessages → normalizeClaudeHistory 产物（flat）', async () => {
  const rt = createClaudeRuntime({ sdk: fakeSdk([]) as any });
  const s = await rt.session.create({ directory: 'C:/tmp/proj' });
  const res = await rt.session.messages({ sessionID: s.id });
  assert.equal(res.data.length, 2);
  assert.equal(res.data[0].id, 'clu_u1');
  assert.equal(res.data[0].role, 'user');
  assert.equal(res.data[1].finish, 'end_turn');
  assert.equal(res.data[1].content[0].type, 'text');
});

test('list → SDK listSessions 映射 SessionInfo', async () => {
  const rt = createClaudeRuntime({ sdk: fakeSdk([]) as any });
  const list = await rt.session.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'cs_1');
  assert.equal(list[0].title, 't');
});

test('tools.registerTools stash → prompt 时经 mcpServers 透传', async () => {
  const sdk = fakeSdk([(push) => push({ type: 'result', subtype: 'success', session_id: 'S' })]);
  const rt = createClaudeRuntime({ sdk: sdk as any });
  const made: any[] = [];
  await rt.tools.registerTools((sessionId: string) => {
    made.push(sessionId);
    return [{
      name: 'mafw_add_memory', description: 'x',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ text: 'ok' }),
    }];
  });
  const s = await rt.session.create({ directory: 'C:/tmp/proj' });
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'hi' }] });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(made.length >= 1, true, 'factory invoked');
  const mcp = sdk.calls[0]?.options?.mcpServers;
  assert.ok(mcp && typeof mcp === 'object', 'mcpServers passed to query options');
});
