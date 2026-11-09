import test from 'node:test';
import assert from 'node:assert/strict';
import { defineRuntime } from './define-runtime.ts';

const transport = {
  createSession: async () => ({ sessionID: 's1' }),
  sendTurn: async () => ({ turnID: 't1' }),
  interruptTurn: async () => {},
  onEvent: () => () => {},
};

test('minimal transport derives sessionApi + eventStream only', () => {
  const def = defineRuntime({ api: 1, name: 'x', displayName: 'X', preset: 'core', transport });
  assert.equal(def.capabilities.sessionApi, true);
  assert.equal(def.capabilities.eventStream, true);
  assert.equal(def.capabilities.steerApi, false);
  assert.equal(def.capabilities.nativeApprovals, false);
});

test('steer adds steerApi and promptWhileBusy', () => {
  const def = defineRuntime({
    api: 1, name: 'x', displayName: 'X', preset: 'conversation',
    transport: { ...transport, steer: async () => 'steered' },
  });
  assert.equal(def.capabilities.steerApi, true);
  assert.equal(def.capabilities.promptWhileBusy, true);
});

test('question channel adds questionApi', () => {
  const def = defineRuntime({
    api: 1, name: 'x', displayName: 'X', preset: 'autonomous', transport,
    channels: { question: { list: async () => [], reply: async () => {}, reject: async () => {} } },
  });
  assert.equal(def.capabilities.questionApi, true);
});

test('rejects an unsupported api', () => {
  assert.throws(() => defineRuntime({ api: 2 as any, name: 'x', displayName: 'X', preset: 'core', transport }));
});

test('rejects a native key', () => {
  assert.throws(() => defineRuntime({ api: 1, name: 'x', displayName: 'X', preset: 'core', transport, native: {} } as any));
});
