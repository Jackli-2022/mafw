import { IndexScanService, resolveScanBaseUrl } from '../../src/recall/index-scan';

const fullId = 'aaaaaaaaaaaaaaaaaaaa';
const fakeIndex: any = {
  getIndex: () => ({
    entries: [
      { id: fullId, created_at: '2026-01-01', type: 'semantic', primary_abstraction: 'x', cue_anchors: [] },
    ],
  }),
};

function okScanBody(overrides: any = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: '{"relevant_ids":["aaaaaaaaaaaa"],"confidence":0.9}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 25000, prompt_tokens_details: { cached_tokens: 24000 } },
      ...overrides,
    }),
  };
}

describe('IndexScanService direct-HTTP scan', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends index text with an explicit cache_control marker and the query as the user suffix', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      { fetchFn: (async (url: string, init?: any) => { calls.push({ url, init }); return okScanBody(); }) as any, apiKey: 'sk-test' },
    );

    await svc.scan('find my preference');

    expect(calls.length).toBe(1);
    expect(calls[0].url).toContain('dashscope.aliyuncs.com/compatible-mode');
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe('qwen3.7-max');
    const system = body.messages[0];
    expect(system.role).toBe('system');
    expect(Array.isArray(system.content)).toBe(true);
    const indexBlock = system.content.find((c: any) => c.text?.startsWith('# Memory Index'));
    expect(indexBlock.cache_control).toEqual({ type: 'ephemeral' });
    expect(system.content.some((c: any) => c.text?.includes('You are a memory retrieval system'))).toBe(true);
    const user = body.messages[1];
    expect(user.role).toBe('user');
    expect(user.content).toContain('find my preference');
    expect(user.content).not.toContain('# Memory Index');
  });

  it('parses a successful scan and resolves short ids to full ids', async () => {
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      { fetchFn: (async () => okScanBody()) as any, apiKey: 'sk-test' },
    );
    const res = await svc.scan('q');
    expect(res?.relevantIds).toEqual([fullId]);
    expect(res?.confidence).toBe(0.9);
  });

  it('falls back to reasoning_content when content is empty (reasoning models)', async () => {
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        fetchFn: (async () => okScanBody({
          choices: [{ message: { content: '', reasoning_content: '{"relevant_ids":["aaaaaaaaaaaa"],"confidence":0.8}' } }],
        })) as any,
        apiKey: 'sk-test',
      },
    );
    const res = await svc.scan('q');
    expect(res?.relevantIds).toEqual([fullId]);
  });

  it('skips the scan when no endpoint can be resolved for the provider', async () => {
    const fetchFn = jest.fn();
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'unknown-provider', modelID: 'm' },
      { fetchFn: fetchFn as any, apiKey: 'sk-test' },
    );
    const res = await svc.scan('q');
    expect(res).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('skips the scan when no API key is available', async () => {
    const fetchFn = jest.fn();
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      { fetchFn: fetchFn as any, authPath: 'Z:/nonexistent/auth.json' },
    );
    const res = await svc.scan('q');
    expect(res).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('times out a hung HTTP call and returns null', async () => {
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        fetchFn: (async () => new Promise(() => { /* never settles */ })) as any,
        apiKey: 'sk-test',
        timeoutMs: 30,
      },
    );
    const res = await svc.scan('q');
    expect(res).toBeNull();
  });

  it('maps known providers to their OpenAI-compatible endpoints', () => {
    expect(resolveScanBaseUrl('alibaba-cn')).toContain('dashscope.aliyuncs.com');
    expect(resolveScanBaseUrl('alibaba')).toContain('dashscope.aliyuncs.com');
    expect(resolveScanBaseUrl('dashscope')).toContain('dashscope.aliyuncs.com');
    expect(resolveScanBaseUrl('xiaomi')).toBeUndefined();
    expect(resolveScanBaseUrl(undefined)).toBeUndefined();
  });
});

describe('IndexScanService async prefetch snapshots', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makePrefetchSvc(fetchFn: FetchStub) {
    return new IndexScanService(
      fakeIndex,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      { fetchFn: fetchFn as any, apiKey: 'sk-test' },
    );
  }

  it('stores a successful scan result as a per-session snapshot', async () => {
    const svc = makePrefetchSvc(() => okScanBody());
    svc.prefetch('sess-1', 'what does the user prefer');
    await new Promise((r) => setTimeout(r, 20));
    const snap = svc.getSnapshot('sess-1');
    expect(snap?.relevantIds).toEqual([fullId]);
    expect(svc.getSnapshot('sess-other')).toBeNull();
  });

  it('keeps the previous snapshot when a later scan fails', async () => {
    let fail = false;
    const svc = makePrefetchSvc(() => (fail ? Promise.reject(new Error('boom')) : okScanBody()));
    svc.prefetch('sess-1', 'q1');
    await new Promise((r) => setTimeout(r, 20));
    expect(svc.getSnapshot('sess-1')).not.toBeNull();
    fail = true;
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60_000); // cooldown expired
    svc.prefetch('sess-1', 'q2');
    await new Promise((r) => setTimeout(r, 20));
    spy.mockRestore();
    expect(svc.getSnapshot('sess-1')?.relevantIds).toEqual([fullId]); // old snapshot survives
  });

  it('expires snapshots after the TTL', async () => {
    const svc = makePrefetchSvc(() => okScanBody());
    svc.prefetch('sess-1', 'q');
    await new Promise((r) => setTimeout(r, 20));
    expect(svc.getSnapshot('sess-1')).not.toBeNull();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 20 * 60_000);
    expect(svc.getSnapshot('sess-1')).toBeNull();
    spy.mockRestore();
  });

  it('throttles prefetch for the same session within 60s', async () => {
    const calls = { n: 0 };
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        fetchFn: (async () => { calls.n++; return okScanBody(); }) as any,
        apiKey: 'sk-test',
      },
    );
    svc.prefetch('sess-1', 'q1');
    await new Promise((r) => setTimeout(r, 20));
    svc.prefetch('sess-1', 'q2'); // throttled — no second HTTP call
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.n).toBe(1);
  });
});
