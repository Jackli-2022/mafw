import {
  planCortexGrounding,
  type GroundingEntry,
} from '../../../src/memory/cortex-grounding';

const lookup = {
  findEpisodeByTrace: (traceId: string) => (traceId === 't1t_b' ? 't1ep_a' : null),
};

describe('planCortexGrounding', () => {
  test('updates trace-linked ungrounded units and reports the rest', () => {
    const entries: GroundingEntry[] = [
      { id: 'a', source_trace_ids: ['t1t_b'] },
      { id: 'b', source_trace_ids: ['t1t_missing'] },
      { id: 'c' },
      { id: 'd', source_trace_ids: ['t1t_b'], episode_id: 't1ep_existing' },
    ];
    const plan = planCortexGrounding(entries, lookup);
    expect(plan.updates).toEqual([{ id: 'a', episodeId: 't1ep_a' }]);
    expect(plan.unresolved).toEqual(['b']);
    expect(plan.ungrounded).toBe(1);
  });

  test('skips already-grounded units and treats empty trace lists as ungrounded', () => {
    const plan = planCortexGrounding(
      [
        { id: 'x', episode_id: 't1ep_a' },
        { id: 'y', source_trace_ids: [] },
      ],
      lookup,
    );
    expect(plan.updates).toEqual([]);
    expect(plan.unresolved).toEqual([]);
    expect(plan.ungrounded).toBe(1);
  });

  test('a throwing lookup leaves the unit unresolved, never throws', () => {
    const plan = planCortexGrounding(
      [{ id: 'a', source_trace_ids: ['t1t_b'] }],
      {
        findEpisodeByTrace: () => {
          throw new Error('db down');
        },
      },
    );
    expect(plan.updates).toEqual([]);
    expect(plan.unresolved).toEqual(['a']);
  });
});
