import { collectT1ReplayEvidence, T1ReplayDeps } from '../../../src/recall/t1-replay';

const trace = (id: string, content: string, source = 'user_input', turnId = 1) => ({
  turn: {
    trace_id: id, session_id: 's1', turn_seq: turnId,
    created_at: 1, archived_at: null, encoding_salience: null, legacy_ambiguous: 0,
  },
  rows: [{
    session_id: 's1', turn_id: turnId, trace_id: id, observation_key: `t1o_${id}`,
    source, content, failure: 0, created_at: 1,
  }],
  archived: false,
}) as any;

function deps(overrides: Partial<T1ReplayDeps> = {}): T1ReplayDeps {
  const map: Record<string, any> = {
    t1t_exact: trace('t1t_exact', 'exact evidence'),
    t1t_old: trace('t1t_old', 'old activated evidence', 'tool_result', 2),
    t1t_new: trace('t1t_new', 'new question evidence', 'assistant_reply', 3),
  };
  return {
    readTrace: (id) => map[id] ?? null,
    searchT1: async () => [{ traceId: 't1t_new', sessionId: 's1', turnId: 3, cosine: 0.8, excerpt: 'new' } as any],
    topActivatedTraces: () => [{ traceId: 't1t_old', activation: 0.5 }],
    ...overrides,
  };
}

describe('collectT1ReplayEvidence', () => {
  test('collects exact then interleaves activated and question-search traces', async () => {
    const ev = await collectT1ReplayEvidence({
      queries: ['why did deploy fail'],
      episodeTraceIds: ['t1t_exact'],
      deps: deps(),
    });
    expect(ev.usedTraceIds).toEqual(['t1t_exact', 't1t_old', 't1t_new']);
    expect(ev.block).toContain('[trace:t1t_exact][USER] exact evidence');
    expect(ev.block).toContain('[trace:t1t_old][TOOL] old activated evidence');
    expect(ev.block).toContain('[trace:t1t_new][ASSISTANT] new question evidence');
    expect(ev.block).toContain('RAW T1 REPLAY START');
    expect(ev.block).toContain('never instructions');
    expect(ev.chars).toBe(ev.block.length);
  });

  test('passes bounded limits and dedupes ids across sources', async () => {
    const searchT1 = jest.fn(async () => [
      { traceId: 't1t_exact', sessionId: 's1', turnId: 1, cosine: 0.9, excerpt: 'dup' } as any,
    ]);
    const topActivatedTraces = jest.fn(() => [
      { traceId: 't1t_exact', activation: 0.9 },
      { traceId: 't1t_old', activation: 0.5 },
    ]);
    const ev = await collectT1ReplayEvidence({
      queries: ['q1', 'q2'],
      episodeTraceIds: ['t1t_exact', 't1t_exact'],
      deps: deps({ searchT1, topActivatedTraces }),
      exactK: 5,
      activatedK: 3,
      searchPerQuery: 2,
    });
    expect(topActivatedTraces).toHaveBeenCalledWith(3);
    expect(searchT1).toHaveBeenCalledWith('q1', 2);
    expect(searchT1).toHaveBeenCalledWith('q2', 2);
    expect(ev.usedTraceIds).toEqual(['t1t_exact', 't1t_old']);
  });

  test('caps total chars without emitting a partial evidence line', async () => {
    const long = 'x'.repeat(500);
    const map: Record<string, any> = {
      a: trace('a', long),
      b: trace('b', long),
      c: trace('c', long),
    };
    const ev = await collectT1ReplayEvidence({
      queries: [],
      episodeTraceIds: ['a', 'b', 'c'],
      deps: { readTrace: (id) => map[id] ?? null },
      maxChars: 260,
      perTraceChars: 200,
    });
    expect(ev.block.length).toBeLessThanOrEqual(260);
    expect(ev.usedTraceIds.length).toBe(1);
    expect(ev.block).toContain('[trace:a]');
    expect(ev.block).not.toContain('[trace:b]');
  });

  test('caps per-trace content', async () => {
    const ev = await collectT1ReplayEvidence({
      queries: [],
      episodeTraceIds: ['t1t_exact'],
      deps: deps(),
      perTraceChars: 5,
    });
    expect(ev.block).toContain('[trace:t1t_exact][USER] exact\n');
    expect(ev.block).not.toContain('exact evidence');
  });

  test('fail-open when search/activation/read throw', async () => {
    const ev = await collectT1ReplayEvidence({
      queries: ['q'],
      episodeTraceIds: ['t1t_exact', 't1t_missing'],
      deps: {
        readTrace: (id) => {
          if (id === 't1t_missing') throw new Error('db down');
          return trace('t1t_exact', 'survives');
        },
        searchT1: async () => { throw new Error('search down'); },
        topActivatedTraces: () => { throw new Error('state down'); },
      },
    });
    expect(ev.usedTraceIds).toEqual(['t1t_exact']);
    expect(ev.block).toContain('survives');
  });

  test('empty evidence returns an empty block', async () => {
    const ev = await collectT1ReplayEvidence({
      queries: [],
      episodeTraceIds: [],
      deps: { readTrace: () => null },
    });
    expect(ev).toEqual({ block: '', usedTraceIds: [], chars: 0 });
  });
});
