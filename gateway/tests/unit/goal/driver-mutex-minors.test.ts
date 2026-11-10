// B2 leftover pins: withGoalMutex rejection poisoning (fixed in B2 —
// MutexQueue drains on rejection; the old promise-chain SKIPPED the queued
// advance) and driver lastError fidelity for non-Error object throws.
import { makeHarness, seedGoal } from '../helpers/goal-driver-harness';

describe('NodeDriver mutex leftovers (B2 pins)', () => {
  it('advance after a rejecting withGoalMutex op still runs advanceInner (poisoning pin)', async () => {
    const h = makeHarness();
    const goalId = 'g-poison';
    seedGoal(h, goalId);

    // A withGoalMutex op that rejects (e.g. the approvePlan StalePlanError path).
    await expect(
      (h.driver as any).withGoalMutex(goalId, async () => {
        throw new Error('stale_plan');
      }),
    ).rejects.toThrow('stale_plan');

    // The next advance must NOT be poisoned — advanceInner runs (creates the
    // node session). The old promise-chain skipped it and wrote a spurious
    // `driver: stale_plan` lastError (spec scheduler §9.1).
    await h.driver.advance(goalId);
    const state = h.load(goalId);
    expect(state.nodeSession).toBeDefined();
    expect(state.lastError ?? '').not.toContain('stale_plan');
  });

  it('advance lastError preserves .message on non-Error object throws', async () => {
    const h = makeHarness();
    const goalId = 'g-obj';
    seedGoal(h, goalId);

    const original = (h.driver as any).advanceInner.bind(h.driver);
    (h.driver as any).advanceInner = async () => {
      throw { code: 'E_X', message: 'obj boom' };
    };
    try {
      await h.driver.advance(goalId);
    } finally {
      (h.driver as any).advanceInner = original;
    }

    const state = h.load(goalId);
    expect(state.lastError).toContain('obj boom');
    expect(state.lastError).not.toContain('[object Object]');
  });
});
