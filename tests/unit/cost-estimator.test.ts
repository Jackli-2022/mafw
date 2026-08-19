import { CostEstimator } from '../../gateway/src/core/cost/cost-estimator';

describe('CostEstimator', () => {
  it('records a tool call and retrieves cost', () => {
    const estimator = new CostEstimator();
    estimator.recordToolCall({
      goalId: 'goal-001', loopNum: 1, waveNum: 1,
      toolName: 'mafw_review', input: 'a'.repeat(100)
    });
    const summary = estimator.getSummary('goal-001', 1);
    expect(summary.totalTokens).toBe(25);
    expect(summary.totalCost).toBeGreaterThan(0);
    expect(summary.byWave).toHaveLength(1);
  });

  it('returns empty summary for unknown goal', () => {
    const estimator = new CostEstimator();
    const summary = estimator.getSummary('unknown', 1);
    expect(summary.totalTokens).toBe(0);
    expect(summary.totalCost).toBe(0);
    expect(summary.byWave).toEqual([]);
    expect(summary.byTool).toEqual([]);
  });

  it('aggregates costs by tool', () => {
    const estimator = new CostEstimator();
    estimator.recordToolCall({ goalId: 'g', loopNum: 1, toolName: 'tool_a', input: 'x'.repeat(40) });
    estimator.recordToolCall({ goalId: 'g', loopNum: 1, toolName: 'tool_a', input: 'x'.repeat(40) });
    estimator.recordToolCall({ goalId: 'g', loopNum: 1, toolName: 'tool_b', input: 'y'.repeat(40) });
    const summary = estimator.getSummary('g', 1);
    expect(summary.byTool).toHaveLength(2);
    const toolA = summary.byTool.find(t => t.toolName === 'tool_a');
    expect(toolA!.tokens).toBe(20);
  });

  it('getAllRecords returns a copy of all records', () => {
    const estimator = new CostEstimator();
    estimator.recordToolCall({ goalId: 'g', loopNum: 1, toolName: 'test', input: 'hi' });
    expect(estimator.getAllRecords()).toHaveLength(1);
  });

  it('clear resets all records', () => {
    const estimator = new CostEstimator();
    estimator.recordToolCall({ goalId: 'g', loopNum: 1, toolName: 'test', input: 'hi' });
    estimator.clear();
    expect(estimator.getAllRecords()).toHaveLength(0);
  });
});
