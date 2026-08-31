import { createOpencodeRuntime } from '../../src/runtime/opencode-runtime';

// Mock the opencode adapter to avoid real serve connection
jest.mock('../../src/opencode-adapter', () => ({
  createOpencodeAdapter: async () => ({
    session: {
      create: async () => ({ id: 's1' }),
      promptAsync: async () => {},
      prompt: async () => ({ parts: [] }),
      messages: async () => ({ data: [] }),
      get: async () => ({}),
      delete: async () => {},
      abort: async () => {},
      list: async () => [],
      todo: async () => [],
      children: async () => [],
      summarize: async () => ({}),
    },
    global: { event: async () => ({}) },
    provider: { list: async () => ({ all: [], connected: [], default: {} }) },
    app: { agents: async () => [] },
    config: { get: async () => ({}), update: async () => ({}) },
  }),
}));

// Mock config to avoid real config loading
jest.mock('../../src/config', () => ({
  config: {
    server: { serveUrl: 'http://127.0.0.1:4096' },
  },
}));

// Mock auth-util
jest.mock('../../src/media/auth-util', () => ({
  getProviderApiKey: () => null,
}));

// Mock logger
jest.mock('../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('opencode runtime agentProcess wiring', () => {
  const originalEnv = process.env.MAFW_SERVER_SERVE_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MAFW_SERVER_SERVE_URL;
    } else {
      process.env.MAFW_SERVER_SERVE_URL = originalEnv;
    }
  });

  it('owned runtime with restartServe: agentProcessApi=true + restart delegates', async () => {
    let restarted = 0;
    const rt = await createOpencodeRuntime({
      baseUrl: 'http://127.0.0.1:4096',
      restartServe: async () => { restarted++; },
    });
    expect(rt.capabilities.agentProcessApi).toBe(true);
    expect(rt.agentProcess).toBeDefined();
    await rt.agentProcess!.restart();
    expect(restarted).toBe(1);
  });

  it('owned runtime without restartServe: agentProcessApi=true but no agentProcess', async () => {
    const rt = await createOpencodeRuntime({
      baseUrl: 'http://127.0.0.1:4096',
    });
    expect(rt.capabilities.agentProcessApi).toBe(true);
    expect(rt.agentProcess).toBeUndefined();
  });

  it('external runtime: agentProcessApi=false and no agentProcess', async () => {
    process.env.MAFW_SERVER_SERVE_URL = 'http://127.0.0.1:9999';
    const rt = await createOpencodeRuntime({
      baseUrl: 'http://127.0.0.1:9999',
    });
    expect(rt.external).toBe(true);
    expect(rt.capabilities.agentProcessApi).toBe(false);
    expect(rt.agentProcess).toBeUndefined();
  });
});
