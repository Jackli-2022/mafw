import { LayaConflictClient, CONFLICT_QUESTION, REDUNDANT_QUESTION } from '../../../src/memory/laya-client';

function okFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as any;
}

describe('LayaConflictClient', () => {
  const deps = (fetchFn: any) => ({ url: 'http://127.0.0.1:13129', timeoutMs: 50, fetchFn });

  it('returns noul probability on success', async () => {
    const c = new LayaConflictClient(deps(okFetch({ answers: { conflict: { noul: 0.92 } } })));
    expect(await c.askConflict('用户对花生过敏', '用户想试试花生酱饼干')).toBe(0.92);
  });

  it('sends the exact model-card contract', async () => {
    let captured: any;
    const fetchFn = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify({ answers: { conflict: { noul: 0.1 } } }), { status: 200 });
    }) as any;
    await new LayaConflictClient(deps(fetchFn)).askConflict('a', 'b');
    expect(captured.state).toEqual({ known: 'a', new: 'b' });
    expect(captured.questions.conflict).toEqual(CONFLICT_QUESTION);
    expect(CONFLICT_QUESTION.type).toBe('noul');
    expect(CONFLICT_QUESTION.labels).toEqual({ false: '兼容', true: '冲突' });
  });

  it('returns null on non-200', async () => {
    const c = new LayaConflictClient(deps(okFetch({ error: 'x' }, 500)));
    expect(await c.askConflict('a', 'b')).toBeNull();
  });

  it('returns null on malformed body', async () => {
    const c = new LayaConflictClient(deps(okFetch({ nope: true })));
    expect(await c.askConflict('a', 'b')).toBeNull();
  });

  it('returns null on timeout', async () => {
    const never = (async () => { await new Promise((r) => setTimeout(r, 500)); return new Response(); }) as any;
    const c = new LayaConflictClient(deps(never));
    expect(await c.askConflict('a', 'b')).toBeNull();
  });

  it('circuit breaker opens after 3 consecutive failures and cools down', async () => {
    let fail = true;
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      if (fail) throw new Error('down');
      return new Response(JSON.stringify({ answers: { conflict: { noul: 0.5 } } }), { status: 200 });
    }) as any;
    const c = new LayaConflictClient({ url: 'http://x', timeoutMs: 50, fetchFn, breakerCooldownMs: 10 });
    expect(await c.askConflict('a', 'b')).toBeNull();
    expect(await c.askConflict('a', 'b')).toBeNull();
    expect(await c.askConflict('a', 'b')).toBeNull();
    // breaker open — no further calls
    expect(await c.askConflict('a', 'b')).toBeNull();
    expect(calls).toBe(3);
    await new Promise((r) => setTimeout(r, 20));
    fail = false;
    expect(await c.askConflict('a', 'b')).toBe(0.5); // half-open probe succeeds
    expect(calls).toBe(4);
  });

  it('healthCheck returns true on 200', async () => {
    const c = new LayaConflictClient(deps(okFetch({ ok: true })));
    expect(await c.healthCheck()).toBe(true);
  });
});

describe('askPair', () => {
  const deps = (fetchFn: any) => ({ url: 'http://127.0.0.1:13129', timeoutMs: 50, fetchFn });

  it('sends both questions in one call and returns both scores', async () => {
    let captured: any;
    const fetchFn = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify({ answers: { conflict: { noul: 0.2 }, redundant: { noul: 0.93 } } }), { status: 200 });
    }) as any;
    const r = await new LayaConflictClient(deps(fetchFn)).askPair('已知', '新信息');
    expect(captured.questions.conflict).toEqual(CONFLICT_QUESTION);
    expect(captured.questions.redundant).toEqual(REDUNDANT_QUESTION);
    expect(r).toEqual({ pConflict: 0.2, pRedundant: 0.93 });
  });

  it('missing redundant field → pRedundant null, overall non-null', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ answers: { conflict: { noul: 0.4 } } }), { status: 200 })) as any;
    const r = await new LayaConflictClient(deps(fetchFn)).askPair('a', 'b');
    expect(r).toEqual({ pConflict: 0.4, pRedundant: null });
  });

  it('total failure → null', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: 'x' }), { status: 500 })) as any;
    expect(await new LayaConflictClient(deps(fetchFn)).askPair('a', 'b')).toBeNull();
  });
});
