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

test('thinking delta maps to reasoning', async () => {
  const t = createClaudeTransport({ sdk: sdk([
    { type: 'stream_event', session_id: 'raw1', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hm' } } },
  ]) });
  const { sessionID } = await t.createSession({ directory: 'C:/tmp' });
  const events: any[] = [];
  t.onEvent((e) => events.push(e));
  await t.sendTurn({ sessionID, turnID: 't1', text: 'hi' });
  await tick();
  assert.equal(events.find((e) => e.type === 'part.delta')?.data.field, 'reasoning');
});
