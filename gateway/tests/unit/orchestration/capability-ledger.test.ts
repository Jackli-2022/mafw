import { buildCapabilityLedger, buildFailureTaxonomy, capabilityPriorBlock } from '../../../src/orchestration/capability-ledger';

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

describe('buildFailureTaxonomy', () => {
  it('clusters cat:failure/correction entries by primary_abstraction, drops superseded', () => {
    const t = buildFailureTaxonomy([
      { id: 'm1', energy: 0.9, primary_abstraction: 'serve 崩溃后事件订阅必须重连', cue_anchors: ['cat:failure'] },
      { id: 'm2', energy: 0.7, primary_abstraction: 'serve 崩溃后事件订阅必须重连', cue_anchors: ['cat:failure'] },
      { id: 'm3', energy: 0.8, primary_abstraction: '别的坑', cue_anchors: ['cat:correction'] },
      { id: 'm4', energy: 0.9, primary_abstraction: '不收', cue_anchors: ['cat:insight'] },
      { id: 'm5', energy: 0.9, primary_abstraction: '已取代', cue_anchors: ['cat:failure'], superseded_by: 'm1' },
    ]);
    expect(t).toHaveLength(2);
    const top = t[0];
    expect(top.pattern).toBe('serve 崩溃后事件订阅必须重连');
    expect(top.count).toBe(2);
    expect(top.energy).toBeCloseTo(0.9);
    expect(top.id).toBe('m1');
  });
});

describe('capabilityPriorBlock', () => {
  it('renders history summary + recurrent failure patterns', () => {
    const block = capabilityPriorBlock(
      { total: 4, passRate: 0.5, avgRounds: 3.2, avgCostUsd: 0.18, thumbsUp: 1, thumbsDown: 1, byFailureKind: { max_retries: 2 } },
      [{ pattern: 'serve 崩溃后事件订阅必须重连', count: 2, energy: 0.9, id: 'm1' }],
    );
    expect(block).toContain('历史 PASS 率 50%');
    expect(block).toContain('平均 3.2 轮');
    expect(block).toContain('serve 崩溃后事件订阅必须重连');
    expect(block).toContain('回避');
  });

  it('empty book → empty string', () => {
    expect(
      capabilityPriorBlock(
        { total: 0, passRate: 0, avgRounds: 0, avgCostUsd: 0, thumbsUp: 0, thumbsDown: 0, byFailureKind: {} },
        [],
      ),
    ).toBe('');
  });
});
