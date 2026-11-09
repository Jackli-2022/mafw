import test from 'node:test';
import assert from 'node:assert/strict';
import { defineRuntime } from './define-runtime.ts';
import type { RuntimeTransport } from './transport.ts';

const transport: RuntimeTransport = {
  createSession: async () => ({ sessionID: 's1' }),
  sendTurn: async (input) => ({ turnID: input.turnID }),
  interruptTurn: async () => {},
  onEvent: () => () => {},
};

test('v2 channels accept concrete payloads', async () => {
  const def = defineRuntime({
    api: 1, name: 'x', displayName: 'X', preset: 'core', transport,
    channelsV2: {
      mcp: {
        list: async () => [{ name: 'mafw', status: 'connected', type: 'remote', url: 'http://x/mcp' }],
        connect: async () => true,
        disconnect: async () => true,
      },
      discovery: {
        list: async () => ({ commands: [{ name: 'goal' }], skills: [], warnings: [] }),
        loadSkill: async () => ({ id: 's', name: 's', contentLength: 1, content: 'x' }),
      },
      instructions: {
        list: async () => [{ key: 'mafw.memory-guide', value: { text: 'g' } }],
        put: async () => {},
        remove: async () => {},
      },
      pty: {
        create: async () => ({ id: 'p1' }),
        connect: async () => ({ id: 'p1', url: 'ws://x' }),
        resize: async () => {},
        remove: async () => {},
      },
      checkpoint: { locate: async () => '/snap' },
      background: { toBackground: async () => {} },
    },
  });

  const servers = await def.channelsV2!.mcp!.list!();
  assert.equal(servers[0].status, 'connected');
  assert.equal(servers[0].type, 'remote');

  const conn = await def.channelsV2!.pty!.connect({ id: 'p1' });
  assert.equal(conn.url, 'ws://x');

  const entries = await def.channelsV2!.instructions!.list('s1');
  assert.equal(entries[0].key, 'mafw.memory-guide');

  const discovery = await def.channelsV2!.discovery!.list({ directory: '/p' });
  assert.equal(discovery.commands[0].name, 'goal');
});
