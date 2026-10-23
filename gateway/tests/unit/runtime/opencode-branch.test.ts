import { createOpencodeAdapter } from '../../../src/runtime/opencode-adapter';

const mockClient = {
  // 形状对齐真实 SDK 1.18.x（OpencodeClient）：question 是顶层命名空间，
  // session 上没有 question（曾因 mock 假形状漏掉生产 TypeError reading 'list'）
  question: {
    list: jest.fn(async (params?: any) => ({ data: [{ id: 'q1' }] })),
    reply: jest.fn(async (params: any) => ({})),
    reject: jest.fn(async (params: any) => ({})),
  },
  session: {
    fork: jest.fn(async (opts: any) => ({ id: 'ses_forked', ...opts })),
    revert: jest.fn(async () => ({})),
    unrevert: jest.fn(async () => ({})),
    prompt: jest.fn(async () => ({
      info: {
        id: 'msg_1', role: 'assistant', finish: 'stop', cost: 0.0042,
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 80, write: 5 } },
      },
      parts: [{ type: 'text', text: 'done' }],
    })),
    promptAsync: jest.fn(async () => ({})),
  },
  permission: {
    // v2 SDK 真实形状：Permission 是 client 顶层命名空间（/permission/{requestID}/reply），
    // session 上没有 permission 成员（Session2 只有 24 个方法）。此前 mock 挂在 session 下 = 假形状假绿。
    reply: jest.fn(async () => ({})),
  },
  event: {
    // 2.1.0：SSE 流在 Event class（/event → /api/event）；Global class 的
    // /global/event 在 2.1.0 已 404（2026-10-22 事故第三层）
    subscribe: jest.fn(async () => ({ ok: true })),
  },
  global: {
    event: jest.fn(async () => ({ ok: true })),
  },
};

const createClientMock = jest.fn(() => mockClient);
jest.mock('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: (cfg: any) => createClientMock(cfg),
}));

describe('opencode adapter 2.1.0 compat (apiBase + Basic auth + event stream)', () => {
  beforeEach(() => { createClientMock.mockClear(); mockClient.event.subscribe.mockClear(); mockClient.global.event.mockClear(); });

  it('SDK client 挂在 baseUrl + /api 前缀（2.1.0 全 API 面），且带 Basic auth 头', async () => {
    await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    const cfg = createClientMock.mock.calls[0][0];
    expect(cfg.baseUrl).toBe('http://127.0.0.1:4096/api');
    expect(cfg.headers?.Authorization).toMatch(/^Basic /);
  });
  it('外部传入 headers 优先合并且 Basic 兜底存在', async () => {
    await createOpencodeAdapter({ baseUrl: 'http://x:1', headers: { 'x-custom': '1' } });
    const cfg = createClientMock.mock.calls[0][0];
    expect(cfg.headers['x-custom']).toBe('1');
    expect(cfg.headers.Authorization).toMatch(/^Basic /);
  });
  it('SSE 流走 event.subscribe（/api/event）——global.event 在 2.1.0 已 404', async () => {
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    await client.global.event!();
    expect(mockClient.event.subscribe).toHaveBeenCalled();
    expect(mockClient.global.event).not.toHaveBeenCalled();
  });
  it('2.1.0 响应信封 {data:X} 双层剥——unwrap 后直接可用（messages 场景）', async () => {
    // 2.1.0 统一响应形状 {"data":[...]}（有时带 location）；SDK 的 result.data = body，
    // body 仍是信封 → unwrap 需再剥一层，否则 messages 拿到对象而非数组
    mockClient.session.messages = jest.fn(async () => ({ data: { data: [{ id: 'msg_1', type: 'user', content: [] }] } }));
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    const out = await client.session.messages!({ sessionID: 'ses_1' });
    expect(Array.isArray(out.data)).toBe(true);
    expect(out.data).toHaveLength(1);
  });
  it('2.1.0 分页信封 {data, cursor}——剥 data 且 cursor 迁移到 nextCursor', async () => {
    // 实测 2.1.0 messages 响应：{"data":[...],"cursor":"..."}——游标在 body（旧面在
    // X-Next-Cursor 响应头）。键集判定漏掉 cursor 导致整个信封未剥（2026-10-23 复现）。
    mockClient.session.messages = jest.fn(async () => ({
      data: { data: [{ id: 'msg_2', type: 'assistant', content: [] }], cursor: 'cur-next' },
      response: { headers: { get: () => null } },
    }));
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    const out = await client.session.messages!({ sessionID: 'ses_1' });
    expect(Array.isArray(out.data)).toBe(true);
    expect(out.data).toHaveLength(1);
    expect(out.nextCursor).toBe('cur-next');
  });
  it('2.1.0 消息 role 归一：type:user/assistant → role（desktop 缺 role 直接丢消息）', async () => {
    mockClient.session.messages = jest.fn(async () => ({
      data: { data: [
        { id: 'm1', type: 'user', text: 'hello user' },               // 2.1.0 用户消息：text 在 info，无 content
        { id: 'm2', type: 'assistant', content: [] },
        { id: 'm3', role: 'user', type: 'user', content: [] },        // 已有 role 不覆盖
        { id: 'm4', type: 'idle', outcome: 'succeeded' },             // 非角色标记 → 过滤
        { id: 'm5', type: 'synthetic', text: 'instructions' },        // 合成指令 → 过滤
      ] },
      response: { headers: { get: () => null } },
    }));
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    const out = await client.session.messages!({ sessionID: 'ses_1' });
    const byId = Object.fromEntries((out.data as any[]).map((m: any) => [m.id, m]));
    expect(byId.m1.role).toBe('user');
    // 用户消息 text → 合成 text part（desktop 从 parts 渲染，2.1.0 用户消息 parts 为空）
    expect(byId.m1.content).toEqual([{ id: 'm1-p0', type: 'text', text: 'hello user' }]);
    expect(byId.m2.role).toBe('assistant');
    expect(byId.m3.role).toBe('user');
    // canonical flat 契约只允许 user|assistant——idle/synthetic 等标记不得混入历史
    expect(byId.m4).toBeUndefined();
    expect(byId.m5).toBeUndefined();
  });
});

describe('opencode adapter branch + envelope', () => {
  it('fork maps flat params and returns new session id', async () => {
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    const out = await client.session.fork!({ sessionID: 'ses_1', messageID: 'msg_9' });
    expect(mockClient.session.fork).toHaveBeenCalledWith({ sessionID: 'ses_1', messageID: 'msg_9' });
    expect(out).toEqual({ id: 'ses_forked' });
  });

  it('revert/unrevert pass through', async () => {
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    await client.session.revert!({ sessionID: 'ses_1', messageID: 'msg_9', partID: 'prt_1' });
    expect(mockClient.session.revert).toHaveBeenCalledWith({ sessionID: 'ses_1', messageID: 'msg_9', partID: 'prt_1' });
    await client.session.unrevert!({ sessionID: 'ses_1' });
    expect(mockClient.session.unrevert).toHaveBeenCalledWith({ sessionID: 'ses_1' });
  });

  it('prompt uses 2.1.0 prompt+wait+message chain and returns envelope superset', async () => {
    const savedFetch = globalThis.fetch;
    (globalThis as any).fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes('/wait')) return { ok: true, status: 204, json: async () => { throw new Error('no body'); } };
      if (u.includes('/message')) return {
        ok: true, status: 200,
        json: async () => ({
          data: [{
            id: 'msg_1', type: 'assistant', content: [{ type: 'text', text: 'done' }],
            tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 80 } }, cost: 0.0042,
          }],
        }),
      };
      return { ok: true, status: 200, json: async () => ({ data: {} }) };
    }) as any;
    try {
      const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
      const res: any = await client.session.prompt({ sessionID: 'ses_1', message: 'hi' });
      expect(res.parts).toMatchObject([{ type: 'text', text: 'done' }]);
      expect(res.finish).toBeUndefined();
      expect(res.usage).toEqual({ input: 100, output: 50, cached: 80, reasoning: 10, costUsd: 0.0042 });
      expect(res.error).toBeUndefined();
    } finally {
      (globalThis as any).fetch = savedFetch;
    }
  });

  it('prompt envelope maps assistant error', async () => {
    const savedFetch = globalThis.fetch;
    (globalThis as any).fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes('/wait')) return { ok: true, status: 204, json: async () => { throw new Error('no body'); } };
      if (u.includes('/message')) return {
        ok: true, status: 200,
        json: async () => ({
          data: [{ id: 'msg_1', type: 'assistant', content: [], error: { name: 'MessageAbortedError', data: { message: 'aborted' } } }],
        }),
      };
      return { ok: true, status: 200, json: async () => ({ data: {} }) };
    }) as any;
    try {
      const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
      const res: any = await client.session.prompt({ sessionID: 'ses_1', message: 'hi' });
      expect(res.error).toEqual({ name: 'MessageAbortedError', message: 'aborted' });
      expect(res.usage).toBeUndefined();
    } finally {
      (globalThis as any).fetch = savedFetch;
    }
  });

  it('permissionReply posts decision to the 2.1.0 session-scoped reply route', async () => {
    const savedFetch = globalThis.fetch;
    const calls: any[] = [];
    (globalThis as any).fetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body });
      return { ok: true, status: 204, json: async () => { throw new Error('no body'); } };
    }) as any;
    try {
      const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
      const ok = await client.session.permissionReply!('ses_1', 'req_1', 'always', 'ok for session');
      expect(calls[0].url).toBe('http://x/api/session/ses_1/permission/req_1/reply');
      expect(calls[0].method).toBe('POST');
      expect(JSON.parse(calls[0].body)).toEqual({ decision: 'always', message: 'ok for session' });
      expect(ok).toBe(true);
    } finally {
      (globalThis as any).fetch = savedFetch;
    }
  });

  it('question list/reply/reject route to the SDK top-level question namespace', async () => {
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    const items = await client.session.question!.list();
    expect(mockClient.question.list).toHaveBeenCalledWith(undefined);
    expect(items).toEqual([{ id: 'q1' }]);
    await client.session.question!.list({ directory: 'C:\\proj' });
    expect(mockClient.question.list).toHaveBeenLastCalledWith({ directory: 'C:\\proj' });
    await client.session.question!.reply({ requestID: 'q1', answers: [['a', 'b']] });
    expect(mockClient.question.reply).toHaveBeenCalledWith({ requestID: 'q1', answers: [['a', 'b']] });
    // directory 变体走 directNative（x-opencode-directory header）——mock fetch 验证不抛
    const savedFetch = globalThis.fetch;
    (globalThis as any).fetch = (async () => ({ ok: true, status: 200, json: async () => ({}) })) as any;
    try {
      await client.session.question!.reply({ requestID: 'q1', answers: [['a']], directory: 'C:\\proj' });
      await client.session.question!.reject({ requestID: 'q1' });
      expect(mockClient.question.reject).toHaveBeenCalledWith({ requestID: 'q1' });
      await client.session.question!.reject({ requestID: 'q1', directory: 'C:\\proj' });
    } finally {
      (globalThis as any).fetch = savedFetch;
    }
    expect(mockClient.question.reject).toHaveBeenCalledWith({ requestID: 'q1' });
  });

  it('promptAsync posts 2.1.0 prompt body {text} (no prompt_async route)', async () => {
    const savedFetch = globalThis.fetch;
    const calls: any[] = [];
    (globalThis as any).fetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body });
      return { ok: true, status: 200, json: async () => ({ data: {} }) };
    }) as any;
    try {
      const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
      await client.session.promptAsync({ sessionID: 's1', message: 'hi', expectReply: false });
      expect(calls[0].url).toBe('http://x/api/session/s1/prompt');
      expect(JSON.parse(calls[0].body)).toEqual({ text: 'hi' });
    } finally {
      (globalThis as any).fetch = savedFetch;
    }
  });
});
