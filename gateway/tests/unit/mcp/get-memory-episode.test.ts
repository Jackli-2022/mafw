import { handleGetMemory } from '../../../src/mcp/handlers/get-memory';

function services(over: any = {}) {
  return {
    memory: null,
    mafwDir: '/tmp/mafw',
    getEpisode: (id: string) =>
      id === 't1ep_a'
        ? {
            episodeId: 't1ep_a',
            sessionId: 's1',
            startTurn: 1,
            endTurn: 2,
            status: 'closed',
            startedAt: 1,
            endedAt: 2,
            boundarySource: 'declared',
            boundaryReason: 'agent_declared',
            confidence: 1,
            actors: [],
            conceptIds: [],
            sourceTraceIds: ['t1t_1', 't1t_2'],
          }
        : null,
    listEpisodeMembers: () => [
      { episodeId: 't1ep_a', traceId: 't1t_1', turnSeq: 1 },
      { episodeId: 't1ep_a', traceId: 't1t_2', turnSeq: 2 },
    ],
    readTrace: (traceId: string) => ({
      turn: { session_id: 's1', turn_seq: traceId === 't1t_1' ? 1 : 2, legacy_ambiguous: 0 },
      archived: false,
      rows: [{ source: 'user_input', content: `row ${traceId}`, trace_id: traceId, observation_key: null }],
    }),
    ...over,
  } as any;
}

describe('mafw_get_memory t1ep pointer', () => {
  test('returns episode metadata + member turns and rows', async () => {
    const out: any = await handleGetMemory({ id: 't1ep:t1ep_a' }, services());
    const body = JSON.parse(out.content[0].text);
    expect(body.success).toBe(true);
    expect(body.episode).toMatchObject({ episodeId: 't1ep_a', startTurn: 1, endTurn: 2 });
    expect(body.members).toHaveLength(2);
    expect(body.members[0]).toMatchObject({
      traceId: 't1t_1',
      turnSeq: 1,
      rows: [{ source: 'user_input', content: 'row t1t_1' }],
    });
  });

  test('unknown or malformed episode returns a not-found error', async () => {
    let out: any = await handleGetMemory({ id: 't1ep:missing' }, services());
    expect(out.isError).toBe(true);
    expect(JSON.parse(out.content[0].text).success).toBe(false);

    out = await handleGetMemory({ id: 't1ep:t1ep_a' }, services({ getEpisode: undefined }));
    expect(out.isError).toBe(true);
  });

  test('plain t1 trace pointer still works', async () => {
    const out: any = await handleGetMemory({ id: 't1:t1t_1' }, services());
    const body = JSON.parse(out.content[0].text);
    expect(body.t1).toMatchObject({ traceId: 't1t_1', sessionId: 's1' });
  });
});
