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

const fakeSessionList = [
  {
    id: 'pi-sess-1',
    cwd: '/tmp/proj',
    name: 'Test session',
    firstMessage: 'hello',
    created: new Date('2026-01-01T00:00:00Z'),
    modified: new Date('2026-01-01T01:00:00Z'),
    messageCount: 5,
    path: '/tmp/sessions/pi-sess-1.jsonl',
    allMessagesText: '',
  },
];

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
  SessionManager: {
    list: async (_cwd: string) => fakeSessionList,
  },
};

describe('pi-runtime', () => {
  it('declares Tier-2-partial capabilities', () => {
    expect(PI_CAPABILITIES).toMatchObject({
      sessionApi: true, promptWhileBusy: true, eventStream: true,
      nativeApprovals: true, providerConfigApi: true, perLlmCallTransform: true,
      sessionStorageApi: true, agentConfigApi: true,
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

describe('permissionReply', () => {
  it('should expose permissionReply on session API', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    expect(rt.session.permissionReply).toBeDefined();
  });

  it('should forward permissionReply to registry', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    const { id } = await rt.session.create({ directory: '/tmp' });
    const registry = (rt as any).registry;
    const replySpy = jest.spyOn(registry, 'permissionReply');

    await rt.session.permissionReply!(id, 'req-1', true);

    expect(replySpy).toHaveBeenCalledWith(id, 'req-1', true);
  });
});

describe('approval policy configuration', () => {
  it('should use default policy when not configured', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    const registry = (rt as any).registry;
    expect(registry).toBeDefined();
    expect(registry['policy']).toBeUndefined();
  });

  it('should use custom policy from pluginConfig', async () => {
    const rt = await createPiRuntime(
      {
        fetch,
        log: console,
        pluginConfig: () => ({
          approvalPolicy: {
            autoApprove: ['read', 'grep'],
            autoDeny: ['bash'],
          },
        }),
      } as any,
      { loadPi: async () => fakePi },
    );
    const registry = (rt as any).registry;
    expect(registry).toBeDefined();
    expect(registry['policy']).toEqual({
      autoApprove: ['read', 'grep'],
      autoDeny: ['bash'],
    });
  });
});

