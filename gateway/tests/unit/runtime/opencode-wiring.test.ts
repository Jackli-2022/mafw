import { readFileSync } from 'fs';
import { join } from 'path';
import { defineRuntime } from '@mafw/runtime-contract';
import { RuntimeBus } from '../../../src/runtime/runtime-bus';
import { toRuntimeDefinition, getBridgeEventEntry, setBridgeEventEntry } from '../../../src/runtime/adapter-bridge';
import { setBridgeEventEntry as setAdapterBridgeEventEntry } from '../../../../adapters/opencode/src/entry-registry';
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

it('the composition root registers all four opencode definitions from adapter descriptors', () => {
  // D3 Task 5: the runtime.loader boot step (descriptor registration) lives in boot.ts.
  const src = readFileSync(join(GATEWAY, 'src', 'boot.ts'), 'utf8');
  expect(src).toContain('builtinAdapterRegistrations(external)');
  expect(src).not.toMatch(/registerBuiltinDefinition\('opencode/);
  const descriptors = readFileSync(
    join(GATEWAY, '..', 'adapters', 'opencode', 'src', 'registration.ts'),
    'utf8',
  );
  for (const name of ['opencode', 'opencode@v1', 'opencode@v2', 'opencode@v21']) {
    expect(descriptors).toContain(`name: '${name}'`);
  }
  // Task 6: the factory receives the runtime context and loads the driver
  // through the package shim (no gateway imports of adapter internals).
  expect(src).toContain('createOpencodeDefinition(ctx,');
  expect(src).toContain("from './runtime/opencode-adapter'");
  expect(src).not.toContain("from './runtime/opencode-definition'");
  expect(src).not.toContain("from './runtime/opencode-runtime'");
});

it('proxy and pre-activation provider resolution use the host seams', () => {
  // D3: the reverse proxy lives in http/transport.ts (deps.proxyHeaders) and the
  // scan transport precedence in kernel.ts (resolveScanProviderTransport).
  const src = readFileSync(join(GATEWAY, 'src', 'kernel.ts'), 'utf8')
    + readFileSync(join(GATEWAY, 'src', 'http', 'transport.ts'), 'utf8');
  expect(src).toContain('proxyHeaders?.()');
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
  // D3 Task 8: composition root = kernel.ts.
  const src = readFileSync(join(GATEWAY, 'src', 'kernel.ts'), 'utf8');
  expect(src).toContain('getBridgeEventEntry');
});

it('forwards the adapter-owned tooling entry into the gateway bridge', () => {
  const entry = { eventSource: OPENCODE_EVENT_SOURCE, eventMappings: OPENCODE_V1_EVENT_MAPPINGS };
  setAdapterBridgeEventEntry('opencode@bridge-seam', entry);
  expect(getBridgeEventEntry('opencode@bridge-seam')).toBe(entry);
});

it('the adaptive dialect probe republishes @2.1 over the static v1 registration', async () => {
  // Review regression: `registerBuiltinDefinition` publishes the static v1
  // entry (index.ts → setBridgeEventEntry, mirrored to the adapter map), and
  // the deferred probe later updates *only* the adapter map. The gateway read
  // must therefore prefer the provider map, otherwise dry-event/conformance
  // keep translating v21 traffic with the v1 table after activation.
  const { createOpencodeDefinition, opencodeStaticEntry } = await import(
    '../../../../adapters/opencode/src/definition'
  );
  const { OPENCODE_21_EVENT_SOURCE, OPENCODE_21_EVENT_MAPPINGS } = await import(
    '../../../../adapters/opencode/src/events-21'
  );

  setBridgeEventEntry('opencode', opencodeStaticEntry('adaptive'));
  expect(getBridgeEventEntry('opencode')?.eventMappings).toBe(OPENCODE_V1_EVENT_MAPPINGS);

  const raw = [{
    id: 'probe-1',
    created: 1,
    type: 'session.created',
    data: { sessionID: 's21', slug: 'quiet' },
    location: { directory: '/p' },
  }];
  const runtime = {
    ...fakeRuntime(),
    global: {
      event: async () => ({
        stream: (async function* () { for (const event of raw) yield event; })(),
      }),
    },
  } as any;

  const definition = await createOpencodeDefinition({} as any, {
    variant: 'adaptive',
    registrationName: 'opencode',
    baseUrl: 'http://127.0.0.1:4096',
  }, {
    runtime,
    probe: async () => 'v21',
    external: true,
  });

  // First event arms the deferred entry resolver inside the adapter bridge.
  definition.transport.onEvent(() => {});

  const started = Date.now();
  while (
    getBridgeEventEntry('opencode')?.eventMappings !== OPENCODE_21_EVENT_MAPPINGS
    && Date.now() - started < 2000
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const resolved = getBridgeEventEntry('opencode');
  expect(resolved?.eventMappings).toBe(OPENCODE_21_EVENT_MAPPINGS);
  expect(resolved?.eventSource).toBe(OPENCODE_21_EVENT_SOURCE);
});
