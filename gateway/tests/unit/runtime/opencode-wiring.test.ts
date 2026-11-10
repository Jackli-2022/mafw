import { readFileSync } from 'fs';
import { join } from 'path';
import { defineRuntime } from '@mafw/runtime-contract';
import { RuntimeBus } from '../../../src/runtime/runtime-bus';
import { toRuntimeDefinition, getBridgeEventEntry } from '../../../src/runtime/adapter-bridge';
import { setBridgeEventEntry as setAdapterBridgeEventEntry } from '../../../../adapters/opencode/src/legacy-definition';
import { OPENCODE_EVENT_SOURCE, OPENCODE_V1_EVENT_MAPPINGS } from '../../../../adapters/opencode/src/events';
// Loading the shim registers the adapter's tooling map with the gateway bridge.
import '../../../src/runtime/opencode-adapter';

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
  // Task 6: the factory receives the runtime context and loads the driver
  // through the package shim (no gateway imports of adapter internals).
  expect(src).toContain('createOpencodeDefinition(ctx,');
  expect(src).toContain("from './runtime/opencode-adapter'");
  expect(src).not.toContain("from './runtime/opencode-definition'");
  expect(src).not.toContain("from './runtime/opencode-runtime'");
});

it('proxy and pre-activation provider resolution use the host seams', () => {
  const src = readFileSync(join(GATEWAY, 'src', 'index.ts'), 'utf8');
  expect(src).toContain('runtimeHost?.proxyHeaders?.()');
  expect(src).toContain('resolveProviderTransport');
  // The adapter shim is the only package entry the gateway loads.
  const shim = readFileSync(join(GATEWAY, 'src', 'runtime', 'opencode-adapter.ts'), 'utf8');
  expect(shim).toContain("require('@mafw/adapter-opencode')");
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

it('forwards the adapter-owned tooling entry into the gateway bridge', () => {
  const entry = { eventSource: OPENCODE_EVENT_SOURCE, eventMappings: OPENCODE_V1_EVENT_MAPPINGS };
  setAdapterBridgeEventEntry('opencode@bridge-seam', entry);
  expect(getBridgeEventEntry('opencode@bridge-seam')).toBe(entry);
});
