import { topicSetTool } from '../src/tools/topic-set';

describe('mafw_topic_set native tool', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('posts the current session and topic fields without a source trace', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        state: { sessionId: 's1', topic: '记忆设计', revision: 1 },
      }),
    }));
    globalThis.fetch = fetchMock as any;

    const out = await topicSetTool.execute(
      {
        topic: '记忆设计',
        entities: ['记忆'],
        retrievalKeys: ['主题', '召回'],
        expectedRevision: 0,
        sourceTraceId: 't1t_forged',
      } as any,
      { sessionID: 's1', abort: new AbortController().signal },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as any[])[1].body);
    expect(body).toMatchObject({
      sessionID: 's1',
      topic: '记忆设计',
      entities: ['记忆'],
      retrievalKeys: ['主题', '召回'],
      expectedRevision: 0,
    });
    expect(body).not.toHaveProperty('sourceTraceId');
    expect(out).toMatchObject({ title: '主题已设置', metadata: { ok: true, revision: 1 } });
  });

  test('supports closing the topic without a topic name', async () => {
    let body: any;
    globalThis.fetch = jest.fn(async (_url: any, init: any) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ ok: true, state: { sessionId: 's1', active: false, revision: 2 } }),
      };
    }) as any;

    const out = await topicSetTool.execute(
      { active: false },
      { sessionID: 's1', abort: new AbortController().signal },
    );

    expect(body).toMatchObject({ sessionID: 's1', active: false });
    expect(out).toMatchObject({ title: '主题已关闭', metadata: { ok: true } });
  });

  test('revision conflicts and network failures return non-throwing errors', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: false,
      json: async () => ({ ok: false, code: 'topic_revision_conflict' }),
    })) as any;
    const conflict = await topicSetTool.execute(
      { topic: 'x', expectedRevision: 0 },
      { sessionID: 's1', abort: new AbortController().signal },
    );
    expect(conflict).toMatchObject({ metadata: { ok: false } });
    expect(String(conflict.output)).toContain('topic_revision_conflict');

    globalThis.fetch = jest.fn(async () => { throw new Error('gateway down'); }) as any;
    const failed = await topicSetTool.execute(
      { topic: 'x' },
      { sessionID: 's1', abort: new AbortController().signal },
    );
    expect(failed).toMatchObject({ metadata: { ok: false } });
    expect(String(failed.output)).toContain('gateway down');
  });
});
