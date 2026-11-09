import { mapAdapterEvent } from '../../../src/runtime/adapter-event-mapper';
import { createClaudeTransport } from '../../../../adapters/claude/src/transport';

const raw = [
  { type: 'system', subtype: 'init', session_id: 's1' },
  { type: 'user', session_id: 's1', uuid: 'u1', message: { role: 'user', content: 'hi' } },
  { type: 'assistant', session_id: 's1', uuid: 'm1', message: { content: [{ type: 'text', text: 'hello' }] } },
  { type: 'result', subtype: 'success', session_id: 's1' },
];

const tick = () => new Promise((r) => setTimeout(r, 20));

function fakeSdk(messages: any[]) {
  return {
    query: async () => ({
      async *[Symbol.asyncIterator]() { for (const m of messages) yield m; },
      interrupt() {},
    }),
    listSessions: async () => [],
    getSessionMessages: async () => [],
  } as any;
}

it('new AdapterEvent path preserves the pinned canonical sequence', async () => {
  const t = createClaudeTransport({ sdk: fakeSdk(raw) });
  const { sessionID } = await t.createSession({ directory: 'C:/tmp' });
  const events: any[] = [];
  t.onEvent((e) => events.push(e));
  await t.sendTurn({ sessionID, turnID: 't1', text: 'hi' });
  await tick();

  const newTypes = events
    .map((e) => mapAdapterEvent(e).canonical?.payload.type)
    .filter((type): type is string => Boolean(type) && type !== 'turn.started');

  expect(newTypes).toEqual(['session.created', 'message.updated', 'part.updated', 'message.updated', 'part.updated', 'turn.completed']);
});
