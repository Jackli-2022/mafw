import test from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeDefinition, createRuntimeDefinition } from '../src/index.ts';

const fakeSdk = {
  query: async () => ({ async *[Symbol.asyncIterator]() {}, interrupt() {} }),
  listSessions: async () => [],
  getSessionMessages: async () => [],
} as any;

test('creates a defineRuntime definition with api 1', async () => {
  const def = await createClaudeDefinition({ gatewayPort: 3000 } as any, { sdk: fakeSdk });
  assert.equal(def.api, 1);
  assert.equal(def.eventApi, 1);
  assert.equal(def.name, 'claude');
  assert.equal(def.capabilities.sessionApi, true);
  assert.equal(def.capabilities.eventStream, true);
  assert.equal(def.capabilities.nativeApprovals, false);
});

test('has a messages channel', async () => {
  const def = await createClaudeDefinition({ gatewayPort: 3000 } as any, { sdk: fakeSdk });
  const data = await def.channels!.messages!.list('s1');
  assert.ok(Array.isArray(data.data));
});

test('exports the async loader entry', () => {
  assert.equal(typeof createRuntimeDefinition, 'function');
});
