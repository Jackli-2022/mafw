import { IndexScanService, hashText, resolveScanBaseUrl } from '../../src/recall/index-scan';
import { Scheduler } from '../../src/scheduler';
import { log } from '../../src/core/utils/logger';

const fullId = 'mem_1111111111_abc12345'; // tail-10 short id = '1_abc12345'
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
      choices: [{ message: { content: '{"relevant_ids":["1_abc12345"],"confidence":0.9}' }, finish_reason: 'stop' }],
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
    // Reasoning models need headroom — 512 truncated the JSON on real indexes
    expect(body.max_tokens).toBe(4096);
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
          choices: [{ message: { content: '', reasoning_content: '{"relevant_ids":["1_abc12345"],"confidence":0.8}' } }],
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
      { fetchFn: fetchFn as any, credentialsResolver: () => null },
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

  it('prefetch remembers which query built the scan snapshot', async () => {
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      { apiKey: 'sk-test' },
    );
    (svc as any).scan = async () => ({ relevantIds: [fullId], confidence: 0.9 });
    svc.prefetch('ses_provenance', 'find my preference');
    await new Promise(resolve => setImmediate(resolve));
    const snap = svc.getSnapshot('ses_provenance');
    expect(snap?.query).toBe('find my preference');
    expect(typeof snap?.builtAt).toBe('string');
  });

  it('maps known providers to their OpenAI-compatible endpoints', () => {
    expect(resolveScanBaseUrl('alibaba-cn')).toContain('dashscope.aliyuncs.com');
    expect(resolveScanBaseUrl('alibaba')).toContain('dashscope.aliyuncs.com');
    expect(resolveScanBaseUrl('dashscope')).toContain('dashscope.aliyuncs.com');
    expect(resolveScanBaseUrl('xiaomi')).toBeUndefined();
    expect(resolveScanBaseUrl(undefined)).toBeUndefined();
  });

  it('scanEndpoints map wins over the hardcoded table', () => {
    expect(resolveScanBaseUrl('gateway', { gateway: 'https://gw.example/v1/chat/completions' })).toBe('https://gw.example/v1/chat/completions');
    expect(resolveScanBaseUrl('alibaba-cn', { gateway: 'https://gw.example/v1/chat/completions' })).toContain('dashscope.aliyuncs.com');
  });

  it('records scan usage through the injected sink', async () => {
    const recorded: any[] = [];
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        fetchFn: (async () => okScanBody()) as any,
        apiKey: 'sk-test',
        recordUsage: (u) => recorded.push(u),
      },
    );
    await svc.scan('q');
    expect(recorded.length).toBe(1);
    expect(recorded[0].providerID).toBe('alibaba-cn');
    expect(recorded[0].modelID).toBe('qwen3.7-max');
    expect(recorded[0].input).toBe(1000); // prompt 25000 − cached 24000
    expect(recorded[0].cached).toBe(24000);
    expect(recorded[0].ok).toBe(true);
    expect(recorded[0].indexHash).toMatch(/^[0-9a-f]{8}$/);
    expect(recorded[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('resolves endpoint and key via injected async hooks (opencode provider config path)', async () => {
    const calls: string[] = [];
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'gateway', modelID: 'glm-5.3-flash' },
      {
        fetchFn: (async (url: string) => { calls.push(url); return okScanBody(); }) as any,
        resolveEndpoint: async () => 'https://gw.example/v1/chat/completions',
        resolveApiKey: async () => 'sk-inline',
      },
    );
    const res = await svc.scan('q');
    expect(res?.relevantIds).toEqual([fullId]);
    expect(calls).toEqual(['https://gw.example/v1/chat/completions']);
  });

  it('resolveEndpoint losing to explicit baseUrl, resolveApiKey losing to explicit apiKey', async () => {
    const calls: string[] = [];
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'gateway', modelID: 'm' },
      {
        fetchFn: (async (url: string) => { calls.push(url); return okScanBody(); }) as any,
        baseUrl: 'https://explicit.example/v1/chat/completions',
        apiKey: 'sk-explicit',
        resolveEndpoint: async () => 'https://should-not-be-used/v1/chat/completions',
        resolveApiKey: async () => 'sk-should-not-be-used',
      },
    );
    await svc.scan('q');
    expect(calls).toEqual(['https://explicit.example/v1/chat/completions']);
  });

  it('hashText is stable, 8-hex, and input-sensitive', () => {
    expect(hashText('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
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

describe('IndexScanService completion channel', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const fakeIndex2: any = {
    getIndex: () => ({
      entries: [{ id: fullId, created_at: '2026-01-01', type: 'semantic', primary_abstraction: 'x', cue_anchors: [] }],
    }),
  };

  it('prefers the runtime completion channel over direct HTTP', async () => {
    let httpCalled = false;
    const svc = new IndexScanService(
      fakeIndex2,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        fetchFn: (async () => { httpCalled = true; return okScanBody(); }) as any,
        apiKey: 'sk-test',
        completion: () => ({
          complete: async (req: any) => {
            expect(req.system?.some((b: any) => b.cacheable)).toBe(true);
            expect(req.user).toEqual([{ type: 'text', text: expect.stringContaining('find my preference') }]);
            return {
              text: '{"relevant_ids":["1_abc12345"],"confidence":0.9}',
              usage: { input: 100, cached: 24000, output: 5 },
            };
          },
        }),
      },
    );
    const res = await svc.scan('find my preference');
    expect(res?.relevantIds).toEqual([fullId]);
    expect(httpCalled).toBe(false);
  });

  it('falls back to direct HTTP when the completion channel throws', async () => {
    let httpCalled = false;
    const svc = new IndexScanService(
      fakeIndex2,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        fetchFn: (async () => { httpCalled = true; return okScanBody(); }) as any,
        apiKey: 'sk-test',
        completion: () => ({ complete: async () => { throw new Error('contract broken'); } }),
      },
    );
    const res = await svc.scan('q');
    expect(res?.relevantIds).toEqual([fullId]);
    expect(httpCalled).toBe(true);
  });

  it('records usage from the completion channel when present', async () => {
    const usageRecords: any[] = [];
    const svc = new IndexScanService(
      fakeIndex2,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        apiKey: 'sk-test',
        recordUsage: (u) => { usageRecords.push(u); },
        completion: () => ({
          complete: async () => ({
            text: '{"relevant_ids":["1_abc12345"],"confidence":0.9}',
            usage: { input: 100, cached: 24000, output: 5 },
          }),
        }),
      },
    );
    await svc.scan('q');
    expect(usageRecords.length).toBe(1);
    expect(usageRecords[0]).toMatchObject({ input: 100, cached: 24000, output: 5 });
  });

  it('skips with a null result when no channel and no endpoint resolve', async () => {
    const svc = new IndexScanService(
      fakeIndex2,
      { providerID: 'unknown-provider', modelID: 'm' },
      { apiKey: 'sk-test' }, // no fetchFn — must never be reached
    );
    const res = await svc.scan('q');
    expect(res).toBeNull();
  });
});

// Task 2: prefetch is optional background work. When the gateway injects a
// scheduler, prefetch must only SUBMIT the scan→snapshot chain — HTTP starts
// when the scheduler runs it (after the recall foreground scope clears and the
// shared `snapshot` mutex is free), never inline on the prefetch call.
describe('IndexScanService scheduled prefetch', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

  /** Collect unhandled rejections across a couple of event-loop turns. */
  async function withUnhandledRejectionWatch(fn: () => Promise<void>): Promise<unknown[]> {
    const unhandled: unknown[] = [];
    const onRejection = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onRejection);
    try {
      await fn();
      // Reported on a later turn — flush one macrotask.
      await new Promise<void>((resolve) => setImmediate(resolve));
      return unhandled;
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  }

  function makeScheduledSvc(
    schedulePrefetch: (sessionID: string, run: () => Promise<void>) => Promise<unknown>,
  ) {
    const calls = { http: 0 };
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        fetchFn: (async () => { calls.http++; return okScanBody(); }) as any,
        apiKey: 'sk-test',
        schedulePrefetch,
      },
    );
    return { svc, calls };
  }

  it('submits the run without executing HTTP or writing a snapshot', async () => {
    const submitted: Array<{ sessionID: string; run: () => Promise<void> }> = [];
    const { svc, calls } = makeScheduledSvc((sessionID, run) => {
      submitted.push({ sessionID, run });
      return Promise.resolve();
    });

    svc.prefetch('sess-sched', 'what does the user prefer');
    await flush();

    expect(submitted).toHaveLength(1);
    expect(submitted[0].sessionID).toBe('sess-sched');
    expect(calls.http).toBe(0);
    expect(svc.getSnapshot('sess-sched')).toBeNull();
  });

  it('writes the snapshot only when the submitted run is executed', async () => {
    const submitted: Array<() => Promise<void>> = [];
    const { svc, calls } = makeScheduledSvc((_sessionID, run) => {
      submitted.push(run);
      return Promise.resolve();
    });

    svc.prefetch('sess-sched', 'find my preference');
    await flush();
    expect(svc.getSnapshot('sess-sched')).toBeNull();

    await submitted[0]();

    expect(calls.http).toBe(1);
    const snap = svc.getSnapshot('sess-sched');
    expect(snap?.relevantIds).toEqual([fullId]);
    expect(snap?.query).toBe('find my preference');
    expect(typeof snap?.builtAt).toBe('string');
  });

  it('stays deferred under a real scheduler foreground scope until release', async () => {
    // Same shape the kernel injects: background + snapshot mutex + defer-to-idle.
    const scheduler = new Scheduler();
    const { svc, calls } = makeScheduledSvc((sessionID, run) =>
      scheduler.submit(
        { id: `index-scan:${sessionID}`, priority: 'background', mutexKey: 'snapshot', strategy: 'defer-to-idle' },
        run,
      ),
    );

    const release = scheduler.enterForeground();
    svc.prefetch('sess-fg', 'q');
    await flush();

    expect(calls.http).toBe(0);
    expect(svc.getSnapshot('sess-fg')).toBeNull();
    expect(scheduler.stats().queued).toBe(1);

    release();
    await flush();

    expect(calls.http).toBe(1);
    expect(svc.getSnapshot('sess-fg')?.relevantIds).toEqual([fullId]);
    expect(scheduler.stats().queued).toBe(0);
  });

  it('waits for the shared snapshot mutex before scanning', async () => {
    const scheduler = new Scheduler();
    const { svc, calls } = makeScheduledSvc((sessionID, run) =>
      scheduler.submit(
        { id: `index-scan:${sessionID}`, priority: 'background', mutexKey: 'snapshot', strategy: 'defer-to-idle' },
        run,
      ),
    );

    let releaseSnapshot!: () => void;
    const snapshotGate = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
    // A snapshot build already holds the key (same as kernel refreshSnapshot).
    const held = scheduler.submit(
      { priority: 'midground', mutexKey: 'snapshot', strategy: 'defer-to-idle' },
      () => snapshotGate,
    );
    svc.prefetch('sess-mutex', 'q');
    await flush();

    expect(calls.http).toBe(0);

    releaseSnapshot();
    await held;
    await flush();

    expect(calls.http).toBe(1);
    expect(svc.getSnapshot('sess-mutex')?.relevantIds).toEqual([fullId]);
  });

  it('swallows a rejected schedulePrefetch: no fallback HTTP, no unhandled, old snapshot survives', async () => {
    const submitted: Array<() => Promise<void>> = [];
    let httpCalls = 0;
    const deps: any = {
      fetchFn: (async () => { httpCalls++; return okScanBody(); }) as any,
      apiKey: 'sk-test',
      schedulePrefetch: (_sessionID: string, run: () => Promise<void>) => {
        submitted.push(run);
        return Promise.resolve();
      },
    };
    const svc = new IndexScanService(fakeIndex, { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' }, deps);

    svc.prefetch('sess-rej', 'q1');
    await flush();
    await submitted[0]();
    expect(httpCalls).toBe(1);
    expect(svc.getSnapshot('sess-rej')?.relevantIds).toEqual([fullId]);

    // Scheduler now rejects at submit (e.g. admission denied). Past the 60s
    // throttle, still inside the 10min snapshot TTL.
    deps.schedulePrefetch = () => Promise.reject(new Error('admission denied'));
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 5 * 60_000);
    try {
      const unhandled = await withUnhandledRejectionWatch(async () => {
        svc.prefetch('sess-rej', 'q2');
        await flush();
      });
      expect(unhandled).toEqual([]);
      expect(httpCalls).toBe(1); // no direct fallback run
      expect(submitted).toHaveLength(1);
      expect(svc.getSnapshot('sess-rej')?.relevantIds).toEqual([fullId]);
    } finally {
      spy.mockRestore();
    }
  });

  it('a synchronously throwing schedulePrefetch skips the optional scan silently', async () => {
    let httpCalls = 0;
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        fetchFn: (async () => { httpCalls++; return okScanBody(); }) as any,
        apiKey: 'sk-test',
        schedulePrefetch: () => { throw new Error('scheduler boom'); },
      },
    );

    const unhandled = await withUnhandledRejectionWatch(async () => {
      expect(() => svc.prefetch('sess-sync', 'q')).not.toThrow();
      await flush();
    });

    expect(unhandled).toEqual([]);
    expect(httpCalls).toBe(0);
    expect(svc.getSnapshot('sess-sync')).toBeNull();
  });

  it('applies the 60s throttle before scheduling (one submit per window)', async () => {
    const submitted: string[] = [];
    const { svc } = makeScheduledSvc((sessionID) => {
      submitted.push(sessionID);
      return Promise.resolve();
    });

    svc.prefetch('sess-throttle', 'q1');
    svc.prefetch('sess-throttle', 'q2'); // throttled synchronously — no second submit
    await flush();

    expect(submitted).toEqual(['sess-throttle']);
  });
});

// Final fix I1: a runtime completion channel may ignore `request.timeoutMs`.
// The scan→snapshot chain holds the global `snapshot` scheduler key, so an
// unbounded wait would serialize (and stall) every session's snapshot build.
// A bounded wait must fail open through the existing cooldown path and must
// NOT fall back to direct HTTP — that would hold the same key for a second
// full timeout (double lock hold).
describe('IndexScanService bounded completion wait', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

  async function withUnhandledRejectionWatch(fn: () => Promise<void>): Promise<unknown[]> {
    const unhandled: unknown[] = [];
    const onRejection = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onRejection);
    try {
      await fn();
      await new Promise<void>((resolve) => setImmediate(resolve));
      return unhandled;
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  }

  it('bounds a never-settling completion channel, fails open, and never runs direct HTTP', async () => {
    const fetchFn = jest.fn(async () => okScanBody());
    let completions = 0;
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        fetchFn: fetchFn as any,
        apiKey: 'sk-test',
        timeoutMs: 25,
        completion: () => ({
          complete: (req) => {
            completions++;
            expect(req.timeoutMs).toBe(25);
            return new Promise(() => { /* never settles — ignores timeoutMs */ });
          },
        }),
      },
    );

    const started = Date.now();
    const res = await svc.scan('q');

    expect(res).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(fetchFn).not.toHaveBeenCalled(); // no direct-HTTP fallback (no double lock hold)

    // Timeout armed the existing failure cooldown: the next attempt
    // short-circuits without touching the channel again.
    expect(await svc.scan('q')).toBeNull();
    expect(completions).toBe(1);
  });

  it('consumes a late rejection from an abandoned attempt (no unhandled, no HTTP fallback)', async () => {
    let rejectLate: ((e: unknown) => void) | undefined;
    const fetchFn = jest.fn(async () => okScanBody());
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        fetchFn: fetchFn as any,
        apiKey: 'sk-test',
        timeoutMs: 20,
        completion: () => ({
          complete: () => new Promise((_resolve, reject) => { rejectLate = reject; }),
        }),
      },
    );

    const unhandled = await withUnhandledRejectionWatch(async () => {
      expect(await svc.scan('q')).toBeNull();
      rejectLate?.(new Error('late provider failure'));
      await flush();
    });

    expect(unhandled).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('releases the shared snapshot scheduler key once the bounded wait expires', async () => {
    const scheduler = new Scheduler();
    const fetchFn = jest.fn(async () => okScanBody());
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        fetchFn: fetchFn as any,
        apiKey: 'sk-test',
        timeoutMs: 25,
        completion: () => ({ complete: () => new Promise(() => { /* never settles */ }) }),
        schedulePrefetch: (sessionID, run) =>
          scheduler.submit(
            { id: `index-scan:${sessionID}`, priority: 'background', mutexKey: 'snapshot', strategy: 'defer-to-idle' },
            run,
          ),
      },
    );

    svc.prefetch('sess-lock', 'q');
    await flush(); // the scan task now holds the `snapshot` key

    let snapshotRan = false;
    const snapshotTask = scheduler.submit(
      { id: 'snapshot:other', priority: 'midground', mutexKey: 'snapshot', strategy: 'defer-to-idle' },
      () => { snapshotRan = true; },
    );

    await snapshotTask; // only resolves if the timed-out scan released the key

    expect(snapshotRan).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(svc.getSnapshot('sess-lock')).toBeNull();
  });

  it('a late resolve after the bounded wait never writes a snapshot', async () => {
    let resolveLate: ((value: any) => void) | undefined;
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        apiKey: 'sk-test',
        timeoutMs: 20,
        completion: () => ({
          complete: () => new Promise((resolve) => { resolveLate = resolve; }),
        }),
      },
    );

    svc.prefetch('sess-late', 'q');
    await flush();
    resolveLate?.({
      text: '{"relevant_ids":["1_abc12345"],"confidence":0.9}',
      usage: { input: 1, cached: 0, output: 1 },
    });
    await flush();

    expect(svc.getSnapshot('sess-late')).toBeNull();
  });
});

// Final fix I2: skipped scheduling was silent. Keep skipping (no retry), but
// leave a trace with the session and the error.
describe('IndexScanService prefetch scheduling diagnostics', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
  const joined = (calls: any[][]) => calls.map((c) => c.map(String).join(' '));

  it('logs the session and error when schedulePrefetch rejects, then skips without retry', async () => {
    const debug = jest.spyOn(log, 'debug').mockImplementation(() => {});
    const fetchFn = jest.fn(async () => okScanBody());
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        fetchFn: fetchFn as any,
        apiKey: 'sk-test',
        schedulePrefetch: () => Promise.reject(new Error('admission denied')),
      },
    );

    svc.prefetch('sess-reject-log', 'q');
    await flush();

    const lines = joined(debug.mock.calls);
    expect(lines.some((l) => l.includes('sess-reject-log') && l.includes('admission denied'))).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(svc.getSnapshot('sess-reject-log')).toBeNull();
  });

  it('logs the session and error when schedulePrefetch throws synchronously, then skips', async () => {
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => {});
    const fetchFn = jest.fn(async () => okScanBody());
    const svc = new IndexScanService(
      fakeIndex,
      { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      {
        fetchFn: fetchFn as any,
        apiKey: 'sk-test',
        schedulePrefetch: () => { throw new Error('scheduler boom'); },
      },
    );

    expect(() => svc.prefetch('sess-sync-log', 'q')).not.toThrow();
    await flush();

    const lines = joined(warn.mock.calls);
    expect(lines.some((l) => l.includes('sess-sync-log') && l.includes('scheduler boom'))).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(svc.getSnapshot('sess-sync-log')).toBeNull();
  });
});
