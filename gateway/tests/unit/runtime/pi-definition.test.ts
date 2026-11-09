import { createPiDefinition, PI_DEFINITION_NAME } from '../../../src/runtime/pi/pi-definition';
import type { RuntimePluginContext } from '../../../src/runtime/loader';

function fakeCtx(overrides: Partial<RuntimePluginContext> = {}): RuntimePluginContext {
  return {
    fetch: async () => new Response(''),
    log: { info() {}, warn() {}, error() {}, debug() {} } as any,
    pluginConfig: () => ({}),
    credentials: { getApiKey: () => null },
    gatewayPort: 3000,
    projectDir: process.cwd(),
    rootDir: process.cwd(),
    ...overrides,
  };
}

const fakeLoadPi = async () => ({});

it('builds a neutral definition with the pi capability set', async () => {
  const def = await createPiDefinition(fakeCtx(), { loadPi: fakeLoadPi });
  expect(def.name).toBe(PI_DEFINITION_NAME);
  expect(def.external).toBe(false);
  expect(def.capabilities.sessionApi).toBe(true);
  expect(def.capabilities.nativeApprovals).toBe(true);
  expect(def.capabilities.instructionsApi).toBe(false);
  expect(typeof def.transport.onEvent).toBe('function');
  expect(typeof def.channels?.messages?.list).toBe('function');
});

it('uses the neutral transport surface, not the raw runtime', async () => {
  const def = await createPiDefinition(fakeCtx(), { loadPi: fakeLoadPi });
  expect(typeof def.transport.createSession).toBe('function');
  expect(typeof def.transport.sendTurn).toBe('function');
  expect(typeof def.transport.interruptTurn).toBe('function');
  expect((def as any).registry).toBeUndefined();
  expect((def as any).session).toBeUndefined();
});
