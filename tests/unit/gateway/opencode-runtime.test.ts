jest.mock('../../../gateway/src/opencode-adapter', () => ({
  createOpencodeAdapter: jest.fn(async () => ({
    __clientMarker: true,
    session: {
      create: jest.fn(), promptAsync: jest.fn(), prompt: jest.fn(),
      messages: jest.fn(), get: jest.fn(), delete: jest.fn(),
      abort: jest.fn(), list: jest.fn(), todo: jest.fn(),
      children: jest.fn(), summarize: jest.fn(),
    },
    global: { event: jest.fn() },
    provider: { list: jest.fn() },
    app: { agents: jest.fn() },
    config: { get: jest.fn(), update: jest.fn() },
  })),
}));

import { createOpencodeRuntime } from '../../../gateway/src/runtime/opencode-runtime';

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
      sessionStorageApi: true, agentConfigApi: true,
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

  it('healthCheck resolves false when serve is unreachable', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:1' });
    await expect(rt.healthCheck!()).resolves.toBe(false);
  });

  it('getBaseUrl returns config serveUrl when MAFW_SERVER_SERVE_URL is not set', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:4096' });
    expect(rt.getBaseUrl()).toContain('127.0.0.1');
  });

  it('getBaseUrl returns MAFW_SERVER_SERVE_URL when set', async () => {
    process.env.MAFW_SERVER_SERVE_URL = 'http://10.0.0.5:9999';
    const rt = await createOpencodeRuntime({ baseUrl: 'http://10.0.0.5:9999' });
    expect(rt.getBaseUrl()).toBe('http://10.0.0.5:9999');
  });

  it('attaches listByDirectory to session surface (sessionStorageApi)', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:4096' });
    expect(typeof rt.session.listByDirectory).toBe('function');
  });
});
