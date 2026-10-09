import { buildCapabilityLedger } from '../../../src/orchestration/capability-ledger';

describe('buildCapabilityLedger', () => {
  it('aggregates pass rate, avg rounds, and failure-kind breakdown', () => {
    const led = buildCapabilityLedger([
      { goal_id: 'g1', verdict: 'PASS', rounds: 2, total_cost: 0.1, thumbs_up: 1, thumbs_down: 0, failure_kind: null },
      { goal_id: 'g2', verdict: 'FAIL', rounds: 5, total_cost: 0.3, thumbs_up: 0, thumbs_down: 0, failure_kind: 'max_retries' },
      { goal_id: 'g3', verdict: 'PASS', rounds: 4, total_cost: 0.2, thumbs_up: 0, thumbs_down: 0, failure_kind: null },
      { goal_id: 'g4', verdict: 'ERROR', rounds: 1, total_cost: 0.05, thumbs_up: 0, thumbs_down: 1, failure_kind: 'max_retries' },
    ]);
    expect(led.total).toBe(4);
    expect(led.passRate).toBeCloseTo(0.5);
    expect(led.avgRounds).toBeCloseTo(3);
    expect(led.avgCostUsd).toBeCloseTo(0.1625);
    expect(led.thumbsUp).toBe(1);
    expect(led.thumbsDown).toBe(1);
    expect(led.byFailureKind).toEqual({ max_retries: 2 });
  });

  it('empty → zeroed ledger (no NaN)', () => {
    const led = buildCapabilityLedger([]);
    expect(led).toMatchObject({ total: 0, passRate: 0, avgRounds: 0, avgCostUsd: 0, byFailureKind: {} });
  });
});
