/**
 * opencode-adapter 契约面测试：permissionList + question reply/reject 的
 * directory 路由。SDK 经 jest.mock 工厂注入（@opencode-ai/sdk/v2 是 ESM-only，
 * jest CJS 无法直接解析——见 tests/mocks/opencode-sdk-v2-stub.ts）。
 */
import { createOpencodeAdapter } from '../../src/opencode-adapter';

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
      expect(url).toBe('http://127.0.0.1:4096/permission?directory=%2Fother');
      expect(init.method).toBe('GET');
      expect((init.headers as any)['x-opencode-directory']).toBe(encodeURIComponent('/other'));
      expect((init.headers as any)['Authorization']).toBe('Basic x');
    });

    it('accepts bare array responses', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify([{ id: 'p2' }]), { status: 200 }));
      const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
      const items = await rt.session.permissionList!();
      expect(items).toEqual([{ id: 'p2' }]);
      expect(fetchSpy.mock.calls[0][0]).toBe('http://127.0.0.1:4096/permission');
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
      expect(url).toBe('http://127.0.0.1:4096/question/q1/reply?directory=%2Fother');
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
      expect(url).toBe('http://127.0.0.1:4096/question/q2/reject?directory=%2Fw2');
      expect(init.method).toBe('POST');
    });

    it('direct fetch failure throws (caller retries next directory)', async () => {
      fetchSpy.mockResolvedValue(new Response('nope', { status: 404 }));
      const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
      await expect(rt.session.question!.reject({ requestID: 'q3', directory: '/w2' })).rejects.toThrow('404');
    });
  });
});
