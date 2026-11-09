import test from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeTransport } from '../src/transport.ts';

function sdk(messages: any[]) {
  return {
    query: async () => ({
      async *[Symbol.asyncIterator]() { for (const m of messages) yield m; },
      interrupt() {},
    }),
    listSessions: async () => [],
    getSessionMessages: async () => [],
  } as any;
}

const tick = () => new Promise((r) => setTimeout(r, 10));

test('createSession returns a session id', async () => {
  const t = createClaudeTransport({ sdk: sdk([]) });
  const { sessionID } = await t.createSession({ directory: 'C:/tmp' });
  assert.ok(sessionID);
});

test('sendTurn emits turn.started and turn.completed', async () => {
  const t = createClaudeTransport({ sdk: sdk([
    { type: 'system', subtype: 'init', session_id: 'raw1' },
    { type: 'user', session_id: 'raw1', uuid: 'u1', message: { role: 'user', content: 'hi' } },
    { type: 'result', subtype: 'success', session_id: 'raw1' },
  ]) });
  const { sessionID } = await t.createSession({ directory: 'C:/tmp' });
  const events: any[] = [];
  t.onEvent((e) => events.push(e));
  await t.sendTurn({ sessionID, turnID: 't1', text: 'hi' });
  await tick();
  assert.equal(events.find((e) => e.type === 'turn.started')?.turnID, 't1');
  assert.equal(events.find((e) => e.type === 'turn.completed')?.turnID, 't1');
});

test('thinking delta maps to reasoning with message and part ids', async () => {
  const t = createClaudeTransport({ sdk: sdk([
    { type: 'assistant', session_id: 'raw1', uuid: 'm1', message: { content: [{ type: 'thinking', thinking: 'hm' }] } },
    { type: 'stream_event', session_id: 'raw1', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hm' } } },
  ]) });
  const { sessionID } = await t.createSession({ directory: 'C:/tmp' });
  const events: any[] = [];
  t.onEvent((e) => events.push(e));
  await t.sendTurn({ sessionID, turnID: 't1', text: 'hi' });
  await tick();
  const delta = events.find((e) => e.type === 'part.delta');
  assert.equal(delta?.data.field, 'reasoning');
  assert.equal(delta?.data.messageID, 'cla_m1');
  assert.equal(delta?.data.partID, 'cla_m1_r1');
});

test('aborted result maps to turn.aborted', async () => {
  const t = createClaudeTransport({ sdk: sdk([
    { type: 'user', session_id: 'raw1', uuid: 'u1', message: { role: 'user', content: 'hi' } },
    { type: 'result', subtype: 'error_during_execution', terminal_reason: 'aborted_streaming', session_id: 'raw1' },
  ]) });
  const { sessionID } = await t.createSession({ directory: 'C:/tmp' });
  const events: any[] = [];
  t.onEvent((e) => events.push(e));
  await t.sendTurn({ sessionID, turnID: 't1', text: 'hi' });
  await tick();
  assert.equal(events.find((e) => e.type === 'turn.aborted')?.turnID, 't1');
});

test('two sessions keep their own turns', async () => {
  const queries = [
    { session_id: 'raw-a', messages: [
      { type: 'user', uuid: 'ua', message: { role: 'user', content: 'a' } },
      { type: 'result', subtype: 'success' },
    ] },
    { session_id: 'raw-b', messages: [
      { type: 'user', uuid: 'ub', message: { role: 'user', content: 'b' } },
      { type: 'result', subtype: 'success' },
    ] },
  ];
  let call = 0;
  const sdk2 = {
    query: async () => {
      const current = queries[call++];
      return {
        async *[Symbol.asyncIterator]() {
          for (const m of current.messages) yield { ...m, session_id: current.session_id };
        },
        interrupt() {},
      };
    },
    listSessions: async () => [],
    getSessionMessages: async () => [],
  } as any;
  const t = createClaudeTransport({ sdk: sdk2 });
  const a = await t.createSession({ directory: 'C:/a' });
  const b = await t.createSession({ directory: 'C:/b' });
  const events: any[] = [];
  t.onEvent((e) => events.push(e));
  await t.sendTurn({ sessionID: a.sessionID, turnID: 'ta', text: 'a' });
  await t.sendTurn({ sessionID: b.sessionID, turnID: 'tb', text: 'b' });
  await tick();
  assert.equal(events.find((e) => e.type === 'turn.completed' && e.turnID === 'ta')?.sessionID, a.sessionID);
  assert.equal(events.find((e) => e.type === 'turn.completed' && e.turnID === 'tb')?.sessionID, b.sessionID);
});

test('busy send queues the next turn id', async () => {
  const scripts = [
    [
      { type: 'user', session_id: 'raw1', uuid: 'u1', message: { role: 'user', content: 'one' } },
      { type: 'result', subtype: 'success', session_id: 'raw1' },
    ],
    [
      { type: 'user', session_id: 'raw1', uuid: 'u2', message: { role: 'user', content: 'two' } },
      { type: 'result', subtype: 'success', session_id: 'raw1' },
    ],
  ];
  let call = 0;
  const sdk2 = {
    query: async () => {
      const messages = scripts[call++];
      return { async *[Symbol.asyncIterator]() { for (const m of messages) yield m; }, interrupt() {} };
    },
    listSessions: async () => [],
    getSessionMessages: async () => [],
  } as any;
  const t = createClaudeTransport({ sdk: sdk2 });
  const { sessionID } = await t.createSession({ directory: 'C:/tmp' });
  const events: any[] = [];
  t.onEvent((e) => events.push(e));
  await t.sendTurn({ sessionID, turnID: 't1', text: 'one' });
  await t.sendTurn({ sessionID, turnID: 't2', text: 'two' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(events.find((e) => e.type === 'turn.completed' && e.turnID === 't1')?.turnID, 't1');
  assert.equal(events.find((e) => e.type === 'turn.completed' && e.turnID === 't2')?.turnID, 't2');
});
