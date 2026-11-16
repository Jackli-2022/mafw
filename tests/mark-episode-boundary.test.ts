import {
  markEpisodeBoundaryTool,
  postEpisodeBoundary,
} from '../src/tools/mark-episode-boundary';

describe('mafw_mark_episode_boundary', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('tool posts sessionID + default start_new as an agent declaration', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    global.fetch = jest.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return { ok: true, json: async () => ({ ok: true, boundary: { afterTurn: 4 } }) } as any;
    }) as any;

    const out = await markEpisodeBoundaryTool.execute(
      { reason: 'new task' },
      { sessionID: 's1', abort: new AbortController().signal },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/obs/episode-boundary');
    expect(JSON.parse(calls[0].init.body)).toMatchObject({
      sessionID: 's1',
      scope: 'start_new',
      source: 'agent',
      reason: 'new task',
    });
    expect(out).toMatchObject({ metadata: { ok: true } });
  });

  test('tool honors explicit scope/afterTurn', async () => {
    let body: any;
    global.fetch = jest.fn(async (_url: any, init: any) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ ok: true, boundary: { afterTurn: 9 } }) } as any;
    }) as any;

    await markEpisodeBoundaryTool.execute(
      { scope: 'end_current', afterTurn: 9 },
      { sessionID: 's1', abort: new AbortController().signal },
    );
    expect(body).toMatchObject({ scope: 'end_current', afterTurn: 9 });
  });

  test('queue helper uses next_user_turn + user source', async () => {
    let body: any;
    global.fetch = jest.fn(async (_url: any, init: any) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ ok: true, pending: true }) } as any;
    }) as any;

    const out = await postEpisodeBoundary({
      sessionID: 's1',
      scope: 'next_user_turn',
      source: 'user',
      reason: 'user_declared',
    });
    expect(body).toMatchObject({
      sessionID: 's1',
      scope: 'next_user_turn',
      source: 'user',
      reason: 'user_declared',
    });
    expect(out.ok).toBe(true);
  });

  test('gateway failure returns a non-throwing error object', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('gateway down');
    }) as any;
    const out = await markEpisodeBoundaryTool.execute(
      {},
      { sessionID: 's1', abort: new AbortController().signal },
    );
    expect(out).toMatchObject({ metadata: { ok: false } });
    expect(String(out.output)).toContain('gateway down');
  });
});
