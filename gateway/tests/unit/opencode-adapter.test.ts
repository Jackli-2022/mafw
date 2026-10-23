/**
 * opencode-adapter 契约面测试：permissionList + question reply/reject 的
 * directory 路由。SDK 经 jest.mock 工厂注入（@opencode-ai/sdk/v2 是 ESM-only，
 * jest CJS 无法直接解析——见 tests/mocks/opencode-sdk-v2-stub.ts）。
 */
import { createOpencodeAdapter } from '../../src/runtime/opencode-adapter';

const sdkCalls: Array<{ method: string; args: any }> = [];
// 形状对齐真实 SDK 1.18.x：question 是顶层命名空间，session 上没有
const mockClient: any = {
  question: {
    list: jest.fn(async () => ({ data: [] })),
    reply: jest.fn(async (...a: any[]) => { sdkCalls.push({ method: 'reply', args: a }); return {}; }),
    reject: jest.fn(async (...a: any[]) => { sdkCalls.push({ method: 'reject', args: a }); return {}; }),
  },
  session: {
    permission: {
      reply: jest.fn(async () => ({})),
    },
  },
};

jest.mock('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: jest.fn(() => mockClient),
}));

describe('opencode-adapter 2.1.0 native session routes (directNative)', () => {
  let fetchSpy: jest.SpyInstance;
  const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const routeFetch = (overrides: Record<string, any> = {}) => {
    fetchSpy.mockImplementation((async (url: any, init: any) => {
      const u = String(url);
      const key = Object.keys(overrides).find((k) => u.includes(k));
      if (key) return overrides[key](init);
      if (u.includes('/wait')) return new Response(null, { status: 204 });
      if (u.includes('/message')) {
        return json({
          data: [
            { id: 'msg_idle', type: 'idle', outcome: 'succeeded' },
            {
              id: 'msg_asst', type: 'assistant', content: [{ type: 'text', text: 'ok' }],
              tokens: { input: 10, output: 5, reasoning: 1, cache: { read: 2, write: 0 } },
              cost: 0.02,
            },
          ],
          cursor: { previous: null, next: null },
        });
      }
      return json({ data: { id: 'ses_new', projectID: 'p1' } });
    }) as any);
  };

  beforeEach(() => { jest.clearAllMocks(); fetchSpy = jest.spyOn(global, 'fetch'); });
  afterEach(() => { fetchSpy.mockRestore(); });

  const callsFor = (part: string) =>
    fetchSpy.mock.calls.filter(([u]: any[]) => String(u).includes(part)) as Array<[string, RequestInit]>;

  it('create 发 POST /api/session，body {location:{directory}}（2.1.0 无 body=400）', async () => {
    routeFetch();
    const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    const created = await rt.session.create({ directory: 'C:/proj' });
    const [url, init] = callsFor('/api/session')[0];
    expect(url).toBe('http://127.0.0.1:4096/api/session');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ location: { directory: 'C:/proj' } });
    expect((created as any).id).toBe('ses_new');
  });

  it('promptAsync 发 POST /api/session/{id}/prompt 顶层 {text}，不等待回合结束', async () => {
    routeFetch();
    const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    await rt.session.promptAsync({ sessionID: 'ses_1', parts: [{ type: 'text', text: 'hi' }, { type: 'text', text: 'there' }] });
    const [url, init] = callsFor('/api/session/ses_1/prompt')[0];
    expect(url).toBe('http://127.0.0.1:4096/api/session/ses_1/prompt');
    expect(JSON.parse(init.body as string)).toEqual({ text: 'hi\nthere' });
    expect(callsFor('/wait')).toHaveLength(0);
  });

  it('prompt 先发 prompt 再 POST /wait，返回最后 assistant 消息的 parts/usage/cost', async () => {
    routeFetch();
    const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    const out = await rt.session.prompt({ sessionID: 'ses_1', message: 'hi' });
    expect(callsFor('/api/session/ses_1/prompt')).toHaveLength(1);
    expect(callsFor('/api/experimental/session/ses_1/wait')).toHaveLength(1);
    expect(out.parts[0]).toMatchObject({ type: 'text', text: 'ok' });
    expect(out.usage).toMatchObject({ input: 10, output: 5, reasoning: 1, cached: 2, costUsd: 0.02 });
    expect(out.finish).toBeUndefined();
  });

  it('abort → POST /api/session/{id}/interrupt', async () => {
    routeFetch();
    const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    await rt.session.abort({ sessionID: 'ses_1' });
    const [url, init] = callsFor('/interrupt')[0];
    expect(url).toBe('http://127.0.0.1:4096/api/session/ses_1/interrupt');
    expect(init.method).toBe('POST');
  });

  it('summarize → POST /api/session/{id}/compact', async () => {
    routeFetch();
    const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    await rt.session.summarize!({ sessionID: 'ses_1' });
    const [url, init] = callsFor('/compact')[0];
    expect(url).toBe('http://127.0.0.1:4096/api/session/ses_1/compact');
    expect(init.method).toBe('POST');
  });

  it('permissionReply → POST /api/session/{sid}/permission/{req}/reply，body {decision}', async () => {
    routeFetch();
    const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    const ok = await rt.session.permissionReply!('ses_1', 'req_9', 'always', 'fine');
    expect(ok).toBe(true);
    const [url, init] = callsFor('/permission/req_9/reply')[0];
    expect(url).toBe('http://127.0.0.1:4096/api/session/ses_1/permission/req_9/reply');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'always', message: 'fine' });
  });

  it('revert 走 2.1.0 两段式：stage(messageID,files:true) + commit', async () => {
    routeFetch();
    const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    await rt.session.revert!({ sessionID: 'ses_1', messageID: 'msg_9', partID: 'prt_1' });
    const stage = callsFor('/api/session/ses_1/revert/stage')[0];
    expect(stage).toBeDefined();
    expect(stage[1].method).toBe('POST');
    expect(JSON.parse(stage[1].body as string)).toEqual({ messageID: 'msg_9', files: true });
    const commit = callsFor('/api/session/ses_1/revert/commit')[0];
    expect(commit).toBeDefined();
    expect(commit[1].method).toBe('POST');
  });

  it('unrevert 走 2.1.0 DELETE /revert（只清暂存；commit 不可逆）', async () => {
    routeFetch();
    const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    await rt.session.unrevert!({ sessionID: 'ses_1' });
    const clear = callsFor('/api/session/ses_1/revert')[0];
    expect(clear).toBeDefined();
    expect(String(clear[0])).toBe('http://127.0.0.1:4096/api/session/ses_1/revert');
    expect(clear[1].method).toBe('DELETE');
  });

  it('app.agents → GET /api/agent?directory=（2.1.0 无 /app/agent）', async () => {    routeFetch({ '/api/agent': () => json({ location: { directory: '/proj' }, data: [{ name: 'build' }] }) });
    const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    const agents = await rt.app!.agents();
    const [url, init] = callsFor('/api/agent')[0];
    expect(url).toBe('http://127.0.0.1:4096/api/agent');
    expect(init.method).toBe('GET');
    expect(agents).toEqual([{ name: 'build' }]);
  });

  it('todo/children 在 2.1.0 无路由 → 空数组 fail-open', async () => {
    routeFetch();
    const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    await expect(rt.session.todo!({ sessionID: 'ses_1' })).resolves.toEqual([]);
    await expect(rt.session.children!({ sessionID: 'ses_1' })).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('provider.list 重建 legacy {all,connected,default}（2.1.0 /provider 不再内嵌 models/connected）', async () => {
    routeFetch({
      '/api/provider': () => json({ location: {}, data: [{ id: 'gateway', name: '蓝区统一网关' }, { id: 'unused', name: 'Unused' }] }),
      '/api/model/default': () => json({ data: { id: 'm1', modelID: 'm1', providerID: 'gateway' } }),
      '/api/model': () => json({ data: [
        { id: 'm1', modelID: 'm1', providerID: 'gateway', name: 'Model One', capabilities: { input: ['text', 'image'], output: ['text'] }, limit: { context: 1000000 } },
        { id: 'm2', modelID: 'm2', providerID: 'gateway', name: 'Model Two', capabilities: { input: ['text'], output: ['text'] } },
        { id: 'm3', modelID: 'm3', providerID: 'catalog-only', name: 'Catalog Model', capabilities: { input: ['text'], output: ['text'] } },
      ] }),
      '/api/integration': () => json({ data: [{ id: 'gateway', name: '蓝区统一网关' }, { id: 'catalog-only', name: 'Catalog Provider' }] }),
      '/api/credential': () => json({ data: [{ integrationID: 'gateway', active: true }, { integrationID: 'catalog-only', active: true }, { integrationID: 'stale', active: false }] }),
    });
    const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    const out = await rt.provider.list();
    expect(out.connected).toEqual(['gateway', 'catalog-only']);
    expect(out.all).toHaveLength(3);
    expect(out.all[0].models.m1).toMatchObject({ name: 'Model One', limit: { context: 1000000 } });
    expect(out.all[0].models.m1.capabilities.input.image).toBe(true);
    expect(out.all[0].models.m2.capabilities.input.image).toBe(false);
    expect(out.all[1].models).toEqual({});
    // /api/provider 为空时（OPENCODE_CONFIG_CONTENT={} 的 sidecar），从模型目录派生 provider
    const catalog = out.all.find((p) => p.id === 'catalog-only');
    expect(catalog).toMatchObject({ name: 'Catalog Provider' });
    expect(catalog.models.m3.name).toBe('Catalog Model');
    expect(out.default).toEqual({ providerID: 'gateway', modelID: 'm1' });
  });
});

describe('opencode-adapter permission/question contract surface', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    sdkCalls.length = 0;
    jest.clearAllMocks();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items: [{ id: 'p1' }] }), { status: 200 }));
  });
  afterEach(() => { fetchSpy.mockRestore(); });

  describe('permissionList', () => {
    it('fetches {baseUrl}/permission with directory + x-opencode-directory, unwraps items', async () => {
      const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096', directory: '/proj', headers: { Authorization: 'Basic x' } });
      const items = await rt.session.permissionList!({ directory: '/other' });
      expect(items).toEqual([{ id: 'p1' }]);
      const [url, init]: [string, RequestInit] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:4096/api/permission/request?directory=%2Fother');
      expect(init.method).toBe('GET');
      expect((init.headers as any)['x-opencode-directory']).toBe(encodeURIComponent('/other'));
      expect((init.headers as any)['Authorization']).toBe('Basic x');
    });

    it('accepts bare array responses', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify([{ id: 'p2' }]), { status: 200 }));
      const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
      const items = await rt.session.permissionList!();
      expect(items).toEqual([{ id: 'p2' }]);
      expect(fetchSpy.mock.calls[0][0]).toBe('http://127.0.0.1:4096/api/permission/request');
    });
  });

  describe('question reply/reject directory routing', () => {
    it('no directory → SDK path (unchanged)', async () => {
      const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
      await rt.session.question!.reply({ requestID: 'q1', answers: [['a']] });
      expect(mockClient.question.reply).toHaveBeenCalledWith({ requestID: 'q1', answers: [['a']] });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('with directory → direct native fetch, not SDK', async () => {
      fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
      const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096', directory: '/proj' });
      await rt.session.question!.reply({ requestID: 'q1', answers: [['a']], directory: '/other' });
      expect(mockClient.question.reply).not.toHaveBeenCalled();
      const [url, init]: [string, RequestInit] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:4096/api/question/q1/reply?directory=%2Fother');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ answers: [['a']] });
      expect((init.headers as any)['x-opencode-directory']).toBe(encodeURIComponent('/other'));
    });

    it('reject with directory → direct native fetch', async () => {
      fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
      const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
      await rt.session.question!.reject({ requestID: 'q2', directory: '/w2' });
      expect(mockClient.question.reject).not.toHaveBeenCalled();
      const [url, init]: [string, RequestInit] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:4096/api/question/q2/reject?directory=%2Fw2');
      expect(init.method).toBe('POST');
    });

    it('direct fetch failure throws (caller retries next directory)', async () => {
      fetchSpy.mockResolvedValue(new Response('nope', { status: 404 }));
      const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
      await expect(rt.session.question!.reject({ requestID: 'q3', directory: '/w2' })).rejects.toThrow('404');
    });
  });
});
