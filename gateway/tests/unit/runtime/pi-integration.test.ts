import { createPiRuntime } from '../../../src/runtime/plugins/pi-runtime';

jest.mock('../../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../src/config', () => ({
  config: { raw: { paths: { projectDir: '/tmp/proj' } }, server: { apiPort: 3000 } },
}));
jest.mock('../../../src/media/auth-util', () => ({
  DEFAULT_AUTH_PATH: () => '/tmp/nonexistent-auth.json',
  readOpencodeAuth: () => ({}),
}));

const fakePi = {
  ModelRuntime: {
    create: async () => ({
      getModel: (p: string, m: string) => ({ id: `${p}/${m}`, baseUrl: 'http://fake' }),
      getProviders: () => [{ id: 'xiaomi', name: 'Xiaomi' }],
      getModels: () => [{ id: 'mimo-v2.5' }],
      hasConfiguredAuth: () => true,
      setRuntimeApiKey: async () => {},
    }),
  },
  createAgentSession: async ({ cwd }: any) => {
    const session: any = {
      prompt: async () => {},
      waitForIdle: async () => {},
      abort: async () => {},
      dispose: async () => {},
      compact: async () => ({}),
      subscribe: () => () => {},
      isStreaming: false,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      ],
    };
    return { session };
  },
};

describe('pi runtime integration', () => {
  it('full session flow: create → promptAsync → messages', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({ provider: 'xiaomi', model: 'mimo-v2.5' }) } as any,
      { loadPi: async () => fakePi },
    );
    const { id } = await rt.session.create({ directory: '/tmp/proj' });
    expect(id.startsWith('pi_')).toBe(true);
    await rt.session.promptAsync({ sessionID: id, message: 'hello' });
    const { data } = await rt.session.messages({ sessionID: id });
    expect(data).toHaveLength(2);
    expect(data[0].content[0].text).toBe('hi');
  });

  it('provider.list works through ModelRuntime', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    const out = await rt.provider.list();
    expect(out.connected).toContain('xiaomi');
  });

  it('dispose cleans up sessions', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    await rt.session.create({ directory: '/tmp' });
    await (rt as any).dispose();
  });

  it('global.event returns an async iterable stream', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    const { stream } = await rt.global.event();
    expect(typeof stream[Symbol.asyncIterator]).toBe('function');
  });
});