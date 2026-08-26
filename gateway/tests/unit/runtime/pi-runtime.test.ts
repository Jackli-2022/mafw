import { PI_CAPABILITIES, createPiRuntime } from '../../../src/runtime/plugins/pi-runtime';

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
  createAgentSession: async () => ({
    session: {
      prompt: async () => {},
      waitForIdle: async () => {},
      abort: async () => {},
      dispose: async () => {},
      compact: async () => ({}),
      subscribe: () => () => {},
      isStreaming: false,
      messages: [],
    },
  }),
};

describe('pi-runtime', () => {
  it('declares Tier-2-partial capabilities', () => {
    expect(PI_CAPABILITIES).toMatchObject({
      sessionApi: true, promptWhileBusy: true, eventStream: true,
      nativeApprovals: false, providerConfigApi: true, perLlmCallTransform: true,
      sessionStorageApi: false, agentConfigApi: false,
    });
  });

  it('createPiRuntime returns AgentRuntime shape with external=true', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    expect(rt.name).toBe('pi');
    expect(rt.external).toBe(true);
    expect(typeof rt.getBaseUrl).toBe('function');
    expect(typeof rt.session.create).toBe('function');
    expect(typeof rt.global.event).toBe('function');
    expect(typeof rt.provider.list).toBe('function');
    expect(typeof rt.app.agents).toBe('function');
    expect(typeof rt.config.get).toBe('function');
    expect(typeof rt.config.update).toBe('function');
    expect(typeof rt.healthCheck).toBe('function');
  });

  it('session.create → promptAsync → messages works through injected pi', async () => {
    let msgCount = 0;
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({ provider: 'xiaomi', model: 'mimo-v2.5' }) } as any,
      { loadPi: async () => fakePi },
    );
    const { id } = await rt.session.create({ directory: '/tmp/proj' });
    expect(id.startsWith('pi_')).toBe(true);
    await rt.session.promptAsync({ sessionID: id, message: 'hello' });
    const { data } = await rt.session.messages({ sessionID: id });
    expect(Array.isArray(data)).toBe(true);
    expect(msgCount).toBe(0);
  });
});