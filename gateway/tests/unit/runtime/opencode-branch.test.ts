import { createOpencodeAdapter } from '../../../src/opencode-adapter';

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
    permission: {
      reply: jest.fn(async () => ({})),
    },
  },
};

jest.mock('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: () => mockClient,
}));

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

  it('prompt returns result envelope superset', async () => {
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    const res: any = await client.session.prompt({ sessionID: 'ses_1', message: 'hi' });
    expect(res.parts).toEqual([{ type: 'text', text: 'done' }]);
    expect(res.finish).toBe('stop');
    expect(res.usage).toEqual({ input: 100, output: 50, cached: 80, reasoning: 10, costUsd: 0.0042 });
    expect(res.error).toBeUndefined();
  });

  it('prompt envelope maps assistant error', async () => {
    mockClient.session.prompt.mockResolvedValueOnce({
      info: { role: 'assistant', error: { name: 'MessageAbortedError', data: { message: 'aborted' } } },
      parts: [],
    });
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    const res: any = await client.session.prompt({ sessionID: 'ses_1', message: 'hi' });
    expect(res.error).toEqual({ name: 'MessageAbortedError', message: 'aborted' });
    expect(res.usage).toBeUndefined();
  });

  it('permissionReply maps tri-state to SDK', async () => {
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    const ok = await client.session.permissionReply!('ses_1', 'req_1', 'always', 'ok for session');
    expect(mockClient.session.permission.reply).toHaveBeenCalledWith({
      sessionID: 'ses_1', requestID: 'req_1', reply: 'always', message: 'ok for session',
    });
    expect(ok).toBe(true);
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

  it('promptAsync maps expectReply=false to noReply', async () => {
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    await client.session.promptAsync({ sessionID: 's1', message: 'hi', expectReply: false });
    expect(mockClient.session.promptAsync).toHaveBeenCalledWith(expect.objectContaining({ noReply: true }));
    await client.session.promptAsync({ sessionID: 's1', message: 'hi', expectReply: true });
    expect(mockClient.session.promptAsync).toHaveBeenLastCalledWith(expect.objectContaining({ noReply: undefined }));
  });
});
