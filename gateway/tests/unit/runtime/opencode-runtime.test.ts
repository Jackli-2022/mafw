jest.mock('../../../src/opencode-adapter', () => ({
  createOpencodeAdapter: jest.fn(async () => ({
    __clientMarker: true,
    session: {
      create: jest.fn(),
      promptAsync: jest.fn(),
      prompt: jest.fn(),
      messages: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
      abort: jest.fn(),
      list: jest.fn(),
      todo: jest.fn(),
      children: jest.fn(),
      summarize: jest.fn(),
    },
    global: { event: jest.fn() },
    provider: { list: jest.fn() },
    app: { agents: jest.fn() },
    config: { get: jest.fn(), update: jest.fn() },
  })),
}));
jest.mock('../../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../src/config', () => ({
  config: { server: { serveUrl: 'http://127.0.0.1:4096' } },
}));
jest.mock('../../../src/runtime/auth', () => ({
  getProviderApiKey: () => null,
  readOpencodeAuth: () => ({}),
  DEFAULT_AUTH_PATH: () => '/tmp/fake-auth.json',
}));

import { createOpencodeRuntime } from '../../../src/runtime/opencode-runtime';

describe('createOpencodeRuntime', () => {
  const saved = process.env.MAFW_SERVER_SERVE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.MAFW_SERVER_SERVE_URL;
    else process.env.MAFW_SERVER_SERVE_URL = saved;
  });

  it('declares opencode identity + full capabilities, preserving the client surface', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:4096' });
    expect(rt.name).toBe('opencode');
    expect(rt.capabilities).toEqual({
      sessionApi: true, promptWhileBusy: true, eventStream: true,
      nativeApprovals: true, providerConfigApi: true, perLlmCallTransform: true,
      sessionStorageApi: true, agentConfigApi: true, agentProcessApi: true,
    });
    expect(rt.external).toBe(false);
    // 装饰不覆盖 adapter 返回的 client 方法面
    expect((rt as any).__clientMarker).toBe(true);
  });

  it('marks external when MAFW_SERVER_SERVE_URL is set', async () => {
    process.env.MAFW_SERVER_SERVE_URL = 'http://127.0.0.1:9999';
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:9999' });
    expect(rt.external).toBe(true);
  });

  it('gates agentProcessApi capability when external', async () => {
    process.env.MAFW_SERVER_SERVE_URL = 'http://127.0.0.1:9999';
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:9999' });
    expect(rt.capabilities.agentProcessApi).toBe(false);
    // Other Tier-2 capabilities remain
    expect(rt.capabilities.sessionApi).toBe(true);
    expect(rt.capabilities.eventStream).toBe(true);
  });

  it('healthCheck resolves false when serve is unreachable', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:1' });
    await expect(rt.healthCheck!()).resolves.toBe(false);
  });

  it('provides agentProcess.restart() when restartServe callback is given (non-external)', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    const restartFn = jest.fn().mockResolvedValue(undefined);
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:4096', restartServe: restartFn });
    expect(rt.agentProcess).toBeDefined();
    expect(typeof rt.agentProcess!.restart).toBe('function');
    await rt.agentProcess!.restart();
    expect(restartFn).toHaveBeenCalledTimes(1);
  });

  it('does not provide agentProcess or agentProcessApi when external', async () => {
    process.env.MAFW_SERVER_SERVE_URL = 'http://127.0.0.1:9999';
    const restartFn = jest.fn();
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:9999', restartServe: restartFn });
    expect(rt.agentProcess).toBeUndefined();
    expect(rt.capabilities.agentProcessApi).toBe(false);
  });

  it('does not provide agentProcess when no restartServe callback', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:4096' });
    expect(rt.agentProcess).toBeUndefined();
  });
});
