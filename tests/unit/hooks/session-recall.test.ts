import { sessionRecallHook } from '../../../src/hooks/session-recall';

// NOTE: cursorBySession is module-level (TtlMap), so every test must use its
// own sessionID to stay isolated.

describe('sessionRecallHook (boundary recall)', () => {
  let originalFetch: typeof global.fetch;
  let sessionCounter = 0;

  beforeEach(() => {
    originalFetch = global.fetch;
    sessionCounter++;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const mockRecall = (pointers: string | null = null) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pointers }),
    }) as any;
  };

  const msg = (id: string, role: string, text: string) => ({
    info: { id, role, sessionID: `sess-${sessionCounter}` },
    content: text,
    parts: [{ type: 'text', text }],
  });

  test('injects <recall> pointers into the last user message and advances the cursor', async () => {
    mockRecall('<recall>\n- #mem-abc "JWT" (E:0.9)\n</recall>');
    const output: any = { messages: [msg('m1', 'user', 'build auth')] };

    await sessionRecallHook({}, output);

    const injected = output.messages[0].parts.filter((p: any) => p.synthetic);
    expect(injected.length).toBe(1);
    expect(injected[0].text).toContain('<recall>');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('does not re-inject when no new messages since the cursor', async () => {
    mockRecall('<recall>\nx\n</recall>');
    const output: any = { messages: [msg('m1', 'user', 'build auth')] };

    await sessionRecallHook({}, output);
    expect(output.messages[0].parts.filter((p: any) => p.synthetic).length).toBe(1);

    // Same messages again 鈫?increment is empty 鈫?no fetch, no duplicate part.
    await sessionRecallHook({}, output);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(output.messages[0].parts.filter((p: any) => p.synthetic).length).toBe(1);
  });

  test('incremental: new messages after cursor trigger a new recall', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ pointers: '<recall>\np\n</recall>', constraints: null }) });
    global.fetch = fetchMock as any;
    const output: any = { messages: [msg('m1', 'user', 'build auth')] };

    await sessionRecallHook({}, output);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // One assistant message appended (cursor = m1, so only m2 is incremental).
    output.messages = [msg('m1', 'user', 'build auth'), msg('m2', 'assistant', 'let me check')];
    await sessionRecallHook({}, output);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const lastUrl = decodeURIComponent(String(fetchMock.mock.calls[1][0]));
    expect(lastUrl).toContain('let me check');
  });

  test('synthetic <recall> parts are skipped as incremental content', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ pointers: '<recall>\np\n</recall>', constraints: null }) });
    global.fetch = fetchMock as any;
    const output: any = { messages: [msg('m1', 'user', 'build auth')] };

    await sessionRecallHook({}, output);
    const syntheticCount = output.messages[0].parts.filter((p: any) => p.synthetic).length;
    expect(syntheticCount).toBe(1);

    // New assistant message appended after the injected part; cursor points at m1.
    output.messages = [msg('m1', 'user', 'build auth'), msg('m2', 'assistant', 'result text')];
    await sessionRecallHook({}, output);

    const url = decodeURIComponent(String(fetchMock.mock.calls[1][0]));
    expect(url).toContain('result text');
    expect(url).not.toContain('<recall>');
  });

  test('falls back to last 8 real messages when cursor ID is missing (edited history)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ pointers: null, constraints: null }) });
    global.fetch = fetchMock as any;
    const output: any = { messages: [msg('m1', 'user', 'build auth')] };
    await sessionRecallHook({}, output);

    // History rewritten: m1 gone, m10 present (within the 8-message window).
    output.messages = [
      msg('m2', 'assistant', 'old'),
      msg('m3', 'assistant', 'old'),
      msg('m4', 'assistant', 'old'),
      msg('m5', 'assistant', 'old'),
      msg('m6', 'assistant', 'old'),
      msg('m7', 'assistant', 'old'),
      msg('m8', 'assistant', 'old'),
      msg('m9', 'assistant', 'old'),
      msg('m10', 'assistant', 'new text'),
    ];
    await sessionRecallHook({}, output);

    const url = decodeURIComponent(String(fetchMock.mock.calls[1][0]));
    expect(url).toContain('new text');
  });

  test('per-session cursors are isolated', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ pointers: null, constraints: null }) });
    global.fetch = fetchMock as any;
    const outputA: any = { messages: [msg('m1', 'user', 'text a')] };
    const outputB: any = { messages: [msg('m1', 'user', 'text b')] };

    // Different sessionID per message set.
    outputA.messages[0].info.sessionID = 'iso-a';
    outputB.messages[0].info.sessionID = 'iso-b';

    await sessionRecallHook({}, outputA);
    await sessionRecallHook({}, outputB);
    // Session A's cursor must not suppress session B's first injection.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('pointers flow through without a constraints channel', async () => {
    mockRecall('<recall>\np\n</recall>');
    const output: any = { messages: [msg('m1', 'user', 'build auth')] };
    await sessionRecallHook({}, output);
    const injected = output.messages[0].parts.filter((p: any) => p.synthetic);
    expect(injected[0].text).toContain('<recall>');
  });

  test('fail-open: fetch errors never throw', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('gateway down')) as any;
    const output: any = { messages: [msg('m1', 'user', 'build auth')] };
    await expect(sessionRecallHook({}, output)).resolves.toBe(output);
    expect(output.messages.length).toBe(1);
  });

  test('no sessionID recoverable 鈫?no-op', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ pointers: '<recall>\n</recall>', constraints: null }) });
    global.fetch = fetchMock as any;
    const output: any = { messages: [{ info: { id: 'm1', role: 'user' }, content: 'no session' }] };
    await sessionRecallHook({}, output);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
