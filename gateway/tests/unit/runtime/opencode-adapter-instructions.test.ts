jest.mock('@opencode-ai/sdk/v2', () => ({ createOpencodeClient: () => ({}) }));

import { createOpencodeAdapter } from '../../../src/runtime/opencode-adapter';

interface FetchCall { url: string; method: string; headers: any; body: any; signal: any }

function installFetch(response: any) {
  const calls: FetchCall[] = [];
  global.fetch = jest.fn(async (url: any, init: any) => {
    calls.push({
      url: String(url),
      method: init?.method,
      headers: init?.headers,
      body: init?.body ? JSON.parse(init.body) : undefined,
      signal: init?.signal,
    });
    return response;
  }) as any;
  return calls;
}

describe('opencode adapter instruction entries', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('lists entries with auth + signal and unwraps the data envelope', async () => {
    const calls = installFetch({ ok: true, status: 200, json: async () => ({ data: [{ key: 'k', value: 'v' }] }) });
    const rt = await createOpencodeAdapter({ baseUrl: 'http://serve.test' });
    const ctrl = new AbortController();
    const list = await rt.session.instructions!.list('s1', { signal: ctrl.signal });
    expect(list).toEqual([{ key: 'k', value: 'v' }]);
    expect(calls[0].url).toBe('http://serve.test/api/experimental/session/s1/instructions/entries');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].headers.Authorization).toMatch(/^Basic /);
    expect(calls[0].signal).toBe(ctrl.signal);
  });

  it('puts a JSON value and deletes a key', async () => {
    const calls = installFetch({ ok: true, status: 204, json: async () => { throw new Error('no body'); } });
    const rt = await createOpencodeAdapter({ baseUrl: 'http://serve.test' });
    await rt.session.instructions!.put('s1', 'mafw.memory-guide', 'hello');
    expect(calls[0].url).toBe('http://serve.test/api/experimental/session/s1/instructions/entries/mafw.memory-guide');
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].body).toEqual({ value: 'hello' });
    await rt.session.instructions!.remove('s1', 'mafw.memory-guide');
    expect(calls[1].method).toBe('DELETE');
  });

  it('surfaces the HTTP status on failures', async () => {
    installFetch({ ok: false, status: 404, json: async () => ({}) });
    const rt = await createOpencodeAdapter({ baseUrl: 'http://serve.test' });
    await expect(rt.session.instructions!.list('missing')).rejects.toMatchObject({ status: 404 });
  });
});
