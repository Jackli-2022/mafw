/**
 * T2-1 Task 2: checkpointApi 能力位 + revert files 参数 + commit 失败清 stage。
 * 活体已证：serve 2.1 stage body 接受 files:boolean|null（计划头部验证点①）。
 */
import { createOpencodeAdapter } from '../../../src/runtime/opencode-adapter';
import { fullCapabilities, minimalCapabilities, type RuntimeClient } from '../../../src/runtime/contract';

jest.mock('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: () => ({}),
}));

type RevertOpts = Parameters<NonNullable<NonNullable<RuntimeClient['session']['revert']>>>[0];

function res(status = 200, body: any = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as any;
}

describe('T2-1 checkpoint contract', () => {
  const originalFetch = global.fetch;
  afterEach(() => { (global as any).fetch = originalFetch; });

  it('fullCapabilities declares checkpointApi (opencode snapshot trees available)', () => {
    expect((fullCapabilities() as any).checkpointApi).toBe(true);
  });

  it('minimalCapabilities leaves checkpointApi off', () => {
    // 缺省 undefined = 能力门 503（pi / 最小 runtime）
    expect((minimalCapabilities() as any).checkpointApi).toBeUndefined();
  });

  it('session.revert accepts files:false (type-level contract)', () => {
    const opts: RevertOpts = { sessionID: 's', messageID: 'm', files: false };
    expect(opts.files).toBe(false);
  });

  it('passes files:false into stage body (no file rollback), then commits', async () => {
    const calls: Array<{ url: string; method: string; body?: any }> = [];
    (global as any).fetch = jest.fn(async (url: string, init: any) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
      return res(200, { data: {} });
    });

    const adapter = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:1' });
    await adapter.session.revert!({ sessionID: 's1', messageID: 'm1', files: false });

    const stage = calls.find((c) => c.url.includes('/revert/stage'));
    expect(stage?.body).toEqual({ messageID: 'm1', files: false });
    expect(calls.find((c) => c.url.endsWith('/revert/commit'))).toBeDefined();
  });

  it('defaults files to true (backward compatible with existing revert callers)', async () => {
    const calls: Array<{ url: string; method: string; body?: any }> = [];
    (global as any).fetch = jest.fn(async (url: string, init: any) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
      return res(200, { data: {} });
    });

    const adapter = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:1' });
    await adapter.session.revert!({ sessionID: 's1', messageID: 'm1' });

    expect(calls.find((c) => c.url.includes('/revert/stage'))?.body).toEqual({
      messageID: 'm1',
      files: true,
    });
  });

  it('clears staged boundary when commit fails (no dangling stage)', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    (global as any).fetch = jest.fn(async (url: string, init: any) => {
      calls.push({ url, method: init.method });
      if (url.endsWith('/revert/commit')) return res(500);
      return res(200, {});
    });

    const adapter = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:1' });
    await expect(
      adapter.session.revert!({ sessionID: 's1', messageID: 'm1', files: true }),
    ).rejects.toThrow(/revert\/commit failed: 500/);

    const cleared = calls.find((c) => c.method === 'DELETE' && /\/session\/s1\/revert$/.test(c.url));
    expect(cleared).toBeDefined();
  });
});
