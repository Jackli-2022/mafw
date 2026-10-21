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
    tools: {
      registerTools: jest.fn(async () => {}),
      nativeTools: () => [
        { name: 'read', toolClass: 'readonly' },
        { name: 'bash', toolClass: 'shell' },
        { name: 'edit', toolClass: 'file-edit' },
        { name: 'task', toolClass: 'subagent' },
      ],
    },
  })),
}));
jest.mock('../../../src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../src/runtime/serve-sidecar', () => ({
  startServeSidecar: jest.fn(),
  killServePort: jest.fn(),
}));
jest.mock('../../../src/config', () => ({
  config: { server: { serveUrl: 'http://127.0.0.1:4096', servePort: 4096 } },
}));
jest.mock('../../../src/runtime/auth', () => ({
  getProviderApiKey: () => null,
  readOpencodeAuth: () => ({}),
  DEFAULT_AUTH_PATH: () => '/tmp/fake-auth.json',
}));

import { createOpencodeRuntime } from '../../../src/runtime/opencode-runtime';
import { startServeSidecar, killServePort } from '../../../src/runtime/serve-sidecar';

const mockStartServe = startServeSidecar as jest.Mock;
const mockKillServePort = killServePort as jest.Mock;

describe('opencode-runtime tools é€šé“ï¼ˆTier-0 å¿…é€‰ï¼‰', () => {
  it('registerTools = ack no-op + nativeTools å£°æ˜Žåˆæ³•æ¡ç›®', async () => {
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:4096' });
    await expect(rt.tools.registerTools(async () => [])).resolves.toBeUndefined();
    const decls = rt.tools.nativeTools();
    expect(decls.length).toBeGreaterThan(0);
    for (const d of decls) {
      expect(typeof d.name).toBe('string');
      expect(d.name.length).toBeGreaterThan(0);
      expect(['readonly', 'search', 'file-edit', 'shell', 'subagent', 'web', 'plan', 'other']).toContain(d.toolClass);
    }
    expect(decls.map((d) => d.name)).toEqual(expect.arrayContaining(['read', 'bash', 'edit', 'task']));
  });
});

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
      // turnBudgetApi falseï¼šé¢„ç®—ç”± gateway ä¾§ BudgetGuard æ‰¿æ‹…ï¼ˆadapter æ—  maxTurns å­—æ®µï¼‰
      completionApi: true, sessionBranchApi: true, turnBudgetApi: false, questionApi: true, diffApi: true, worktreeApi: true,
    });
    expect(rt.external).toBe(false);
    // è£…é¥°ä¸è¦†ç›– adapter è¿”å›žçš„ client æ–¹æ³•é¢
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

  it('provides agentProcess with spawnServe + restart primitives (non-external)', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:4096' });
    expect(rt.agentProcess).toBeDefined();
    expect(typeof rt.agentProcess!.restart).toBe('function');
    expect(typeof rt.agentProcess!.spawnServe).toBe('function');
    // restart is the kill primitive â€” must resolve without a gateway callback
    await expect(rt.agentProcess!.restart()).resolves.toBeUndefined();
  });

  it('does not provide agentProcess or agentProcessApi when external', async () => {
    process.env.MAFW_SERVER_SERVE_URL = 'http://127.0.0.1:9999';
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:9999' });
    expect(rt.agentProcess).toBeUndefined();
    expect(rt.capabilities.agentProcessApi).toBe(false);
  });

  it('declares completionApi and exposes completion.complete', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:4096' });
    expect(rt.capabilities.completionApi).toBe(true);
    expect(typeof rt.completion?.complete).toBe('function');
  });

  it('complete resolves endpoint from opencode provider config baseURL', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    const { createOpencodeAdapter } = require('../../../src/opencode-adapter') as any;
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:4096' });
    const lastResult = (createOpencodeAdapter as jest.Mock).mock.results[(createOpencodeAdapter as jest.Mock).mock.results.length - 1];
    const adapter = await lastResult.value;
    adapter.config.get.mockResolvedValue({
      provider: { 'my-prov': { options: { baseURL: 'https://p.example/v1', apiKey: 'sk-x' } } },
    });
    const calls: Array<{ url: string }> = [];
    const savedFetch = globalThis.fetch;
    (globalThis as any).fetch = (async (url: string) => {
      calls.push({ url });
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    }) as any;
    try {
      const res = await rt.completion!.complete({
        model: { providerID: 'my-prov', modelID: 'm1' },
        user: [{ type: 'text', text: 'q' }],
      });
      expect(res.text).toBe('ok');
      expect(calls[0].url).toBe('https://p.example/v1/chat/completions');
    } finally {
      (globalThis as any).fetch = savedFetch;
    }
  });

  // â”€â”€ URL å½’ runtimeï¼šspawnServe å¸æ”¶ sidecar å®žé™…åœ°å€ï¼ˆåŠ¨æ€ç«¯å£å‰æï¼‰ â”€â”€

  it('spawnServe fills host/port defaults from gateway config (gateway passes none)', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    mockStartServe.mockResolvedValueOnce({ url: 'http://127.0.0.1:4096', close: jest.fn() });
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:4096' });
    await rt.agentProcess!.spawnServe!({} as any);
    expect(mockStartServe).toHaveBeenCalledWith(
      expect.objectContaining({ host: '127.0.0.1', port: 4096 }),
    );
  });

  it('spawnServe absorbs the actual sidecar URL (getBaseUrl + healthCheck follow)', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    mockStartServe.mockResolvedValueOnce({ url: 'http://127.0.0.1:5555', close: jest.fn() });
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:4096' });
    await rt.agentProcess!.spawnServe!({} as any);
    expect(rt.getBaseUrl()).toBe('http://127.0.0.1:5555');
    const calls: string[] = [];
    const savedFetch = globalThis.fetch;
    (globalThis as any).fetch = (async (url: string) => {
      calls.push(String(url));
      return { ok: true, status: 200 };
    }) as any;
    try {
      await expect(rt.healthCheck!()).resolves.toBe(true);
      expect(calls[0]).toBe('http://127.0.0.1:5555/global/health');
    } finally {
      (globalThis as any).fetch = savedFetch;
    }
  });

  it('killServe primitive is the runtime-owned port killer (restart routes through it)', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:4096' });
    expect(typeof rt.agentProcess!.killServe).toBe('function');
    rt.agentProcess!.killServe!();
    expect(mockKillServePort).toHaveBeenCalledWith(4096);
    await rt.agentProcess!.restart();
    expect(mockKillServePort).toHaveBeenCalledWith(4096);
  });
});

describe('opencode-runtime ·½ÑÔÈë¿ÚÓëÕæÊµ×éºÏ£¨ÖÕÉó Critical #1 »Ø¹é¶¤Ôú£©', () => {
  it('×ÔÊÊÓ¦ resolveEventEntry ½âÎö²úÎï±£Áô transformEvent ÇÒ message.updated ¶Ëµ½¶Ë´æ»î', async () => {
    const { OPENCODE_EVENT_SOURCE, OPENCODE_V1_EVENT_MAPPINGS } = await import('../../../src/runtime/opencode-events');
    const { EVENT_FLOW_MATRIX } = await import('../../../src/runtime/event-flow-matrix');
    const { TOOL_PRIMITIVE_TYPES } = await import('../../../src/runtime/tool-part-assembler');
    const { applyEventMappings } = await import('../../../src/runtime/event-mapper');
    const isCanonicalAll = (t: string) => !!EVENT_FLOW_MATRIX[t] || TOOL_PRIMITIVE_TYPES.has(t);

    // ×ÔÊÊÓ¦ runtime£¨dialectProbe: true£©£»Ì½²âÄ¿±ê 127.0.0.1:1 ±Ø¾Ü ¡ú fail-safe v1
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:1', dialectProbe: true });
    expect(typeof (rt as any).resolveEventEntry).toBe('function');

    const resolved = await (rt as any).resolveEventEntry();
    expect(resolved.eventMappings).toBe(OPENCODE_V1_EVENT_MAPPINGS); // fail-safe Ì½²â ¡ú v1 ±í
    expect((rt as any).activeDialect).toBe('v1');
    expect(typeof resolved.transformEvent).toBe('function'); // ÖÕÉó Critical£ºÈ±Ê§¼´ message.updated È«Ãð

    // ¾­¸Ã entry ·­Òë message.updated ´æ»î£¨Áã»»Ãû {message} ÐÅ·â°áÒÆ£©
    const raw = { directory: '/p', payload: { type: 'message.updated', properties: { sessionID: 's1', info: { id: 'm1', role: 'user', sessionID: 's1' } } } };
    const out = applyEventMappings(raw, resolved, isCanonicalAll);
    expect(out).toHaveLength(1);
    expect(out[0].payload.properties.message).toEqual({ id: 'm1', role: 'user', sessionID: 's1' });
    expect(resolved.eventSource).toBe(OPENCODE_EVENT_SOURCE);
  });

  it('¶¤ËÀ·½ÑÔ£¨dialectProbe È±Ê¡£©²»¹Ò resolveEventEntry', async () => {
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:4096' });
    expect((rt as any).resolveEventEntry).toBeUndefined();
    expect((rt as any).activeDialect).toBeUndefined();
  });
});
