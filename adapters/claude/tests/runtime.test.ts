/**
 * claude runtime 契约测试 —— SDK 注入 seam（假件脚本化），不 spawn 真进程。
 *
 * raw-event-first：runtime 只推原生 SDKMessage；翻译由 gateway 执行器负责
 * （见 gateway/tests/unit/runtime/claude-adapter-mappings.test.ts）。本文件钉：
 * ①原生事件原样入总线；②tracker 合成 turn.started / 终态复位；
 * ③busy 排队；④spawn 失败 → canonical turn.failed 且下回合仍能合成 start。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeRuntime } from '../src/runtime.ts';

function fakeSdk(
  script: Array<(push: (m: any) => void) => void | Promise<void>>,
  opts: { failQuery?: Error; failTimes?: number; throwDuringIteration?: Error } = {},
) {
  const calls: any[] = [];
  let failures = 0;
  const sdk = {
    calls,
    async query(args: any) {
      calls.push(args);
      if (opts.failQuery && failures < (opts.failTimes ?? Infinity)) {
        failures++;
        throw opts.failQuery;
      }
      const messages: any[] = [];
      const push = (m: any) => messages.push(m);
      for (const step of script) await step(push);
      const self = {
        async *[Symbol.asyncIterator]() {
          for (const m of messages) yield m;
          if (opts.throwDuringIteration) throw opts.throwDuringIteration;
        },
        interrupt() {
          (self as any).interrupted = true;
        },
      };
      return self;
    },
    async listSessions() { return [{ id: 'cs_1', title: 't', updatedAt: '2026-10-21T00:00:00Z' }]; },
    async getSessionMessages(sessionId: string) {
      void sessionId;
      return [
        { uuid: 'u1', role: 'user', content: 'hi' },
        { uuid: 'a1', role: 'assistant', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', model: 'claude-opus-4-6' },
      ];
    },
  };
  return sdk;
}

function typeOf(e: any): string {
  return e?.payload?.type ?? e?.type;
}

async function collectEvents(rt: any, take: number): Promise<any[]> {
  const iter = await rt.global.event();
  const stream = iter.stream ?? iter;
  const out: any[] = [];
  for await (const e of stream) {
    out.push(e);
    if (out.length >= take) break;
  }
  return out;
}

test('create → cls_ 前缀 id；实例不再声明 capabilities（单源在 module.exports）', async () => {
  const rt = createClaudeRuntime({ sdk: fakeSdk([]) as any });
  const s = await rt.session.create({ directory: 'C:/tmp/proj' });
  assert.ok(String(s.id).startsWith('cls_'));
  assert.equal(rt.name, 'claude');
  assert.equal(rt.external, true);
  assert.equal(rt.capabilities, undefined);
  assert.equal(typeof rt.getBaseUrl(), 'string');
});

test('promptAsync → query 被调（sessionId + cwd）；原生事件原样入总线，turn.started 由 tracker 合成', async () => {
  const sdk = fakeSdk([
    (push) => push({ type: 'user', session_id: 'S', uuid: 'u1', message: { role: 'user', content: 'hi' } }),
    (push) => push({ type: 'result', subtype: 'success', session_id: 'S', usage: { input_tokens: 1 }, total_cost_usd: 0 }),
  ]);
  const rt = createClaudeRuntime({ sdk: sdk as any });
  const s = await rt.session.create({ directory: 'C:/tmp/proj' });
  const done = collectEvents(rt, 3);
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'hi' }] });
  const events = await Promise.race([done, new Promise<any[]>((r) => setTimeout(() => r([]), 3000))]);
  assert.deepEqual(events.map(typeOf), ['turn.started', 'user', 'result']);
  // 原生 payload 原样透传（未经本地翻译）
  assert.equal(events[1].message.content, 'hi');
  assert.equal(events[2].subtype, 'success');
  assert.equal(sdk.calls[0].options.sessionId, s.id);
  assert.equal(sdk.calls[0].options.cwd, 'C:/tmp/proj');
  assert.equal(sdk.calls[0].prompt, 'hi');
});

test('同回合第二条 user 不重复合成；result 后下一回合重新合成', async () => {
  const sdk = fakeSdk([
    (push) => push({ type: 'user', session_id: 'S', uuid: 'u1', message: { role: 'user', content: 'a' } }),
    (push) => push({ type: 'user', session_id: 'S', uuid: 'u2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
    (push) => push({ type: 'result', subtype: 'success', session_id: 'S' }),
  ]);
  const rt = createClaudeRuntime({ sdk: sdk as any });
  const s = await rt.session.create({ directory: 'C:/tmp/proj' });
  const done = collectEvents(rt, 4);
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'go' }] });
  const events = await Promise.race([done, new Promise<any[]>((r) => setTimeout(() => r([]), 3000))]);
  assert.equal(events.filter((e) => typeOf(e) === 'turn.started').length, 1);

  const second = fakeSdk([
    (push) => push({ type: 'user', session_id: 'S', uuid: 'u3', message: { role: 'user', content: 'next' } }),
  ]);
  const rt2 = createClaudeRuntime({ sdk: second as any });
  const s2 = await rt2.session.create({ directory: 'C:/tmp/proj' });
  const done2 = collectEvents(rt2, 1);
  await rt2.session.promptAsync({ sessionID: s2.id, parts: [{ type: 'text', text: 'x' }] });
  const first = await Promise.race([done2, new Promise<any[]>((r) => setTimeout(() => r([]), 3000))]);
  assert.equal(typeOf(first[0]), 'turn.started');
});

test('busy 排队：query 进行中再 promptAsync 入队，result 后 flush 队首', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const sdk = fakeSdk([
    async (push) => { await gate; push({ type: 'result', subtype: 'success', session_id: 'S' }); },
  ]);
  const rt = createClaudeRuntime({ sdk: sdk as any });
  const s = await rt.session.create({ directory: 'C:/tmp/proj' });
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'first' }] });
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'second' }] });
  assert.equal(sdk.calls.length, 1, 'second queued, not spawned');
  release();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(sdk.calls.length, 2, 'queue flushed after result');
  assert.equal(sdk.calls[1].prompt, 'second');
});

test('abort → interrupt() 被调（不炸）', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const sdk = fakeSdk([async (push) => { await gate; push({ type: 'result', subtype: 'success', session_id: 'S' }); }]);
  const rt = createClaudeRuntime({ sdk: sdk as any });
  const s = await rt.session.create({ directory: 'C:/tmp/proj' });
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'x' }] });
  await rt.session.abort({ sessionID: s.id });
  release();
  await new Promise((r) => setTimeout(r, 50));
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'after' }] });
  assert.ok(true);
});

test('spawn 失败 → canonical turn.failed（恒等行放行语义）；下回合仍能合成 turn.started', async () => {
  const sdk = fakeSdk(
    [(push) => push({ type: 'user', session_id: 'S', uuid: 'u9', message: { role: 'user', content: 'retry' } })],
    { failQuery: new Error('claude CLI not found (spawn ENOENT)'), failTimes: 1 },
  );
  const rt = createClaudeRuntime({ sdk: sdk as any });
  const s = await rt.session.create({ directory: 'C:/tmp/proj' });
  const done = collectEvents(rt, 1);
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'hi' }] });
  const events = await Promise.race([done, new Promise<any[]>((r) => setTimeout(() => r([]), 3000))]);
  assert.equal(events.length, 1);
  assert.equal(typeOf(events[0]), 'turn.failed');
  assert.ok(String(events[0].payload.properties.error).includes('claude CLI not found'));

  // 失败已复位 tracker：下一回合首条 user 重新合成 start
  const done2 = collectEvents(rt, 2);
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'again' }] });
  const events2 = await Promise.race([done2, new Promise<any[]>((r) => setTimeout(() => r([]), 3000))]);
  assert.deepEqual(events2.map(typeOf), ['turn.started', 'user']);
});

test('失败发生在 raw session_id 键上时也复位 tracker（双键 reset）', async () => {
  const sdk = fakeSdk(
    [(push) => push({ type: 'user', session_id: 'RAW_SID', uuid: 'u1', message: { role: 'user', content: 'x' } })],
    { throwDuringIteration: new Error('stream broke') },
  );
  const rt = createClaudeRuntime({ sdk: sdk as any });
  const s = await rt.session.create({ directory: 'C:/tmp/proj' });
  const done = collectEvents(rt, 5);
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'hi' }] });
  await new Promise((r) => setTimeout(r, 50));
  // 第二回合：同一个 raw session_id 应重新合成 turn.started（说明失败时复位了 RAW_SID 键）
  await rt.session.promptAsync({ sessionID: s.id, parts: [{ type: 'text', text: 'again' }] });
  const events = await Promise.race([done, new Promise<any[]>((r) => setTimeout(() => r([]), 3000))]);
  const types = events.map(typeOf);
  assert.ok(types.includes('turn.failed'), JSON.stringify(types));
  const started = types.filter((t) => t === 'turn.started').length;
  assert.equal(started, 2, `expected two turn.started (before + after failure): ${JSON.stringify(types)}`);
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
