import { translateProviders, translateAgents, translateConfigGet, translateConfigUpdate } from '../../../src/runtime/pi/pi-provider';

const fakeMR = () => ({
  getProviders: () => [{ id: 'xiaomi', name: 'Xiaomi' }, { id: 'openai', name: 'OpenAI' }],
  getModels: (pid: string) => pid === 'xiaomi' ? [{ id: 'mimo-v2.5' }, { id: 'mimo-v1' }] : [],
  getProvider: (pid: string) => pid === 'xiaomi' ? { id: 'xiaomi', name: 'Xiaomi' } : undefined,
  hasConfiguredAuth: (pid: string) => pid === 'xiaomi',
});

describe('translateProviders', () => {
  it('maps providers with connected from hasConfiguredAuth', async () => {
    const out = await translateProviders(fakeMR());
    expect(out.all.map((p: any) => p.id)).toEqual(['xiaomi', 'openai']);
    expect(out.connected).toEqual(['xiaomi']);
    expect(out.default).toEqual({});
  });

  it('translateAgents returns empty array', async () => {
    expect(await translateAgents()).toEqual([]);
  });

  it('translateConfigGet/Update round-trip', async () => {
    expect(await translateConfigGet()).toEqual({});
    expect(await translateConfigUpdate({ a: 1 })).toEqual({ a: 1 });
  });
});