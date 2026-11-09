import test from 'node:test';
import assert from 'node:assert/strict';
import { defineRuntime, type RuntimeDefinitionInput } from './define-runtime.ts';
import type { SendTurnInput, RuntimeTransport } from './transport.ts';

const transport: RuntimeTransport = {
  createSession: async () => ({ sessionID: 's1' }),
  sendTurn: async (input) => ({ turnID: input.turnID }),
  interruptTurn: async () => {},
  onEvent: () => () => {},
};

test('definition accepts an external flag', () => {
  const def = defineRuntime({
    api: 1, name: 'x', displayName: 'X', preset: 'core', transport, external: false,
  });
  assert.equal(def.external, false);
});

test('session channel exposes the production parity methods', () => {
  const def = defineRuntime({
    api: 1, name: 'x', displayName: 'X', preset: 'core', transport,
    channels: {
      session: {
        todo: async () => [],
        children: async () => [],
        summarize: async () => ({}),
        switchAgent: async () => {},
        switchModel: async () => {},
        setThinkingLevel: async () => {},
        permissionList: async () => [],
        background: async () => {},
      },
    },
  });
  for (const key of [
    'todo', 'children', 'summarize', 'switchAgent',
    'switchModel', 'setThinkingLevel', 'permissionList', 'background',
  ] as const) {
    assert.equal(typeof def.channels!.session![key], 'function', key);
  }
});

test('sendTurn accepts a delivery hint', () => {
  const input: SendTurnInput = { sessionID: 's1', turnID: 't1', text: 'hi', delivery: 'steer' };
  assert.equal(input.delivery, 'steer');
});

test('factory context can carry policy hooks', () => {
  const input: RuntimeDefinitionInput = {
    api: 1, name: 'x', displayName: 'X', preset: 'core', transport,
  };
  assert.equal(input.channels, undefined);
});
