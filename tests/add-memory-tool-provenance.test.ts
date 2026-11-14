import { addMemoryTool } from '../src/tools/add-memory';

describe('mafw_add_memory native tool provenance', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('exposes sourceTraceIds and forwards it in the HTTP body', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, id: 'mem_1' }),
    }));
    globalThis.fetch = fetchMock as any;

    expect((addMemoryTool.args as any).sourceTraceIds).toBeDefined();

    await addMemoryTool.execute(
      {
        content: 'provenance transport smoke',
        memoryType: 'semantic',
        cueAnchors: ['provenance'],
        primaryAbstraction: 'provenance transport',
        importance: 2,
        sourceTraceIds: ['t1t_a', 't1t_b'],
      },
      { sessionID: 's1', abort: new AbortController().signal },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as any[])[1].body);
    expect(body.sourceTraceIds).toEqual(['t1t_a', 't1t_b']);
  });

  test('omitting sourceTraceIds keeps the old payload shape', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, id: 'mem_2' }),
    }));
    globalThis.fetch = fetchMock as any;

    await addMemoryTool.execute(
      { content: 'legacy transport', memoryType: 'semantic' },
      { sessionID: 's1', abort: new AbortController().signal },
    );

    const body = JSON.parse((fetchMock.mock.calls[0] as any[])[1].body);
    expect(body).not.toHaveProperty('sourceTraceIds');
  });
});
