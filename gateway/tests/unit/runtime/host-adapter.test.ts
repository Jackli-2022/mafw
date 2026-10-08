import {
  COGNITION_CONTRACT, MEMORY_GUIDE, contentToText, hashText, buildRecallQuery,
  createCognitionClient, createRecallCursor,
} from '../../../src/runtime/host-adapter';

describe('host-adapter contract', () => {
  it('时序契约常量与认知面文档一致', () => {
    expect(COGNITION_CONTRACT.recallTimeoutMs).toBe(100);
    expect(COGNITION_CONTRACT.pinnedTimeoutMs).toBe(150);
    expect(COGNITION_CONTRACT.shortIncrementMin).toBe(50);
    expect(COGNITION_CONTRACT.assistantTailMax).toBe(300);
    expect(COGNITION_CONTRACT.obsTimeoutMs).toBe(5000);
    expect(MEMORY_GUIDE).toContain('<memory-guide>');
    expect(MEMORY_GUIDE).toContain('## 记忆');
  });

  it('contentToText 跳过 synthetic 部件', () => {
    expect(contentToText('plain')).toBe('plain');
    expect(contentToText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b', synthetic: true }])).toBe('a');
    expect(contentToText(42 as any)).toBe('');
  });

  it('hashText 输出 8 位 hex', () => {
    expect(hashText('x')).toMatch(/^[0-9a-f]{8}$/);
    expect(hashText('x')).toBe(hashText('x'));
  });

  it('buildRecallQuery：长增量直用 / 短增量并入 assistant 尾部', () => {
    const real = [
      { id: 'a', role: 'user', content: 'q' + 'x'.repeat(60) },
      { id: 'b', role: 'assistant', content: [{ type: 'text', text: '答案尾部' + 'y'.repeat(60) }] },
    ];
    expect(buildRecallQuery(real, [real[0]])).toContain('xxx');
    expect(buildRecallQuery(real, [{ id: 'c', role: 'user', content: '好的' }])).toContain('答案尾部');
  });
});

describe('createCognitionClient', () => {
  it('observe → POST /api/obs/capture；空内容跳过', async () => {
    const calls: any[] = [];
    const fetchImpl: any = async (url: string, init?: any) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => ({}) };
    };
    const c = createCognitionClient({ sessionId: 's1', baseUrl: 'http://gw', fetchImpl });
    c.observe('user_input', 'hello');
    c.observe('user_input', '   ');
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ sessionID: 's1', source: 'user_input', content: 'hello' });
  });

  it('observe failure 标记为 1', async () => {
    const calls: any[] = [];
    const fetchImpl: any = async (url: string, init?: any) => {
      calls.push({ body: init?.body ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => ({}) };
    };
    const c = createCognitionClient({ sessionId: 's1', baseUrl: 'http://gw', fetchImpl });
    c.observe('tool_result', 'boom', true);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls[0].body).toMatchObject({ source: 'tool_result', failure: 1 });
  });

  it('fetchRecallPointers / fetchPinnedProfile fail-open 返回 null', async () => {
    const fetchImpl: any = async () => { throw new Error('down'); };
    const c = createCognitionClient({ sessionId: 's1', baseUrl: 'http://gw', fetchImpl });
    expect(await c.fetchRecallPointers('q')).toBeNull();
    expect(await c.fetchPinnedProfile()).toBeNull();
  });

  it('fetchRecallPointers 命中返回 pointers / 非 ok 返回 null', async () => {
    let ok = true;
    const fetchImpl: any = async () => ({ ok, json: async () => ({ pointers: '<recall>x</recall>' }) });
    const c = createCognitionClient({ sessionId: 's1', baseUrl: 'http://gw', fetchImpl });
    expect(await c.fetchRecallPointers('q')).toBe('<recall>x</recall>');
    ok = false;
    expect(await c.fetchRecallPointers('q')).toBeNull();
  });

  it('fetchPinnedProfile 命中返回 profile 文本', async () => {
    const fetchImpl: any = async () => ({ ok: true, json: async () => ({ profile: '<user-profile>p</user-profile>' }) });
    const c = createCognitionClient({ sessionId: 's1', baseUrl: 'http://gw', fetchImpl });
    expect(await c.fetchPinnedProfile()).toBe('<user-profile>p</user-profile>');
  });
});

describe('createRecallCursor', () => {
  it('id 游标：next 只返回新增；compaction 丢游标回尾部 8 条', () => {
    const cur = createRecallCursor();
    const m1 = [{ id: 'a', role: 'user', content: 'one' }];
    expect(cur.next(m1)).toHaveLength(1);
    cur.advance(m1);
    const m2 = [...m1, { id: 'b', role: 'user', content: 'two' }];
    expect(cur.next(m2).map((m: any) => m.id)).toEqual(['b']);
    cur.advance(m2);
    const fresh = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, role: 'user', content: `m${i}` }));
    expect(cur.next(fresh)).toHaveLength(8);
  });

  it('count 退化：无 id 消息按计数增量', () => {
    const cur = createRecallCursor();
    const a = [{ role: 'user', content: 'alpha' }];
    expect(cur.next(a)).toHaveLength(1);
    cur.advance(a);
    const b = [...a, { role: 'user', content: 'beta' }];
    expect(cur.next(b).map((m: any) => contentToText(m.content))).toEqual(['beta']);
  });
});
