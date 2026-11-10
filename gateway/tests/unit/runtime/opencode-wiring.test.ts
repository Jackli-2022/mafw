import { readFileSync } from 'fs';
import { join } from 'path';
import { defineRuntime } from '@mafw/runtime-contract';
import { RuntimeBus } from '../../../src/runtime/runtime-bus';
import { toRuntimeDefinition, getBridgeEventEntry } from '../../../src/runtime/adapter-bridge';
import { OPENCODE_EVENT_SOURCE, OPENCODE_V1_EVENT_MAPPINGS } from '../../../../adapters/opencode/src/events';

const GATEWAY = join(__dirname, '../../..');

function fakeRuntime() {
  return {
    name: 'opencode',
    capabilities: {},
    session: {
      create: async () => ({ id: 's1' }),
      promptAsync: async () => {},
      abort: async () => {},
    },
    global: { event: async () => ({ stream: (async function* () {})() }) },
    tools: { registerTools() {}, nativeTools: () => [] },
  } as any;
}

it('the composition root registers all four opencode definitions', () => {
  const src = readFileSync(join(GATEWAY, 'src', 'index.ts'), 'utf8');
  expect(src).toContain("registerBuiltinDefinition('opencode'");
  expect(src).toContain("registerBuiltinDefinition('opencode@v1'");
  expect(src).toContain("registerBuiltinDefinition('opencode@v2'");
  expect(src).toContain("registerBuiltinDefinition('opencode@v21'");
  expect(src).not.toMatch(/registerBuiltin\('opencode/);
});

it('exposes the bridge translate entry for dry-event tooling', () => {
  toRuntimeDefinition(fakeRuntime(), {
    name: 'opencode-dry',
    translate: {
      entry: { eventSource: OPENCODE_EVENT_SOURCE, eventMappings: OPENCODE_V1_EVENT_MAPPINGS },
      isCanonical: () => true,
    },
  });
  const entry = getBridgeEventEntry('opencode-dry');
  expect(entry?.eventMappings).toBe(OPENCODE_V1_EVENT_MAPPINGS);
});

it('dryEventDeps falls back to the bridge entry', () => {
  const src = readFileSync(join(GATEWAY, 'src', 'index.ts'), 'utf8');
  expect(src).toContain('getBridgeEventEntry');
});
