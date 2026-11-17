import { makeHarness, seedGoal } from './helpers/goal-driver-harness';

describe('NodeDriver review context', () => {
  test('passes the in-flight revision and renders the block into the plan prompt', async () => {
    const h = makeHarness();
    const calls: Array<[string, string, number]> = [];
    h.deps.reviewItemsContext = async (goalId, node, revision) => {
      calls.push([goalId, node, revision]);
      return '【本批人类评审意见】\n- review_1 改这里';
    };
    seedGoal(h, 'g1', { patch: { revision: 2 } });

    await h.driver.advance('g1');

    expect(calls).toEqual([['g1', 'plan', 2]]);
    const prompt = h.calls.find((call) => call.op === 'promptAsync')?.parts?.[0]?.text ?? '';
    expect(prompt).toContain('review_1');
  });

  test('provider failure fails the node closed without creating a session', async () => {
    const h = makeHarness();
    const calls: Array<[string, string, number]> = [];
    h.deps.reviewItemsContext = async (goalId, node, revision) => {
      calls.push([goalId, node, revision]);
      throw new Error('snapshot broken');
    };
    seedGoal(h, 'g1', { patch: { revision: 2 } });

    await h.driver.advance('g1');

    expect(calls).toEqual([['g1', 'plan', 2]]);
    expect(h.calls.filter((call) => call.op === 'create')).toHaveLength(0);
    expect(h.load('g1')?.lastFailure?.code).toBe('review_context_invalid');
  });
});
