import { applyGoalEvalResults } from '../../../src/core/goal/goal-eval-provider';
import type { GoalEval } from '../../../src/core/goal/goal-eval';
import type { ReviewRubric } from '../../../src/core/goal/review-rubric';

function goalEval(): GoalEval {
  return {
    outcome: 'works',
    conditions: [
      { id: 'c1', statement: 'required one', required: true, evidence: 'test', method: 'run' },
      { id: 'c2', statement: 'optional one', required: false, evidence: 'test', method: 'run' },
    ],
    failureConditions: [],
    constraints: [],
    nonGoals: [],
    mapping: {},
  };
}

function verdict(over: Partial<ReviewRubric> = {}): ReviewRubric {
  return {
    verdict: 'PASS',
    tasks: [{ taskId: 't1', result: 'pass', evidence: 'tests pass' }],
    goalResults: [
      { conditionId: 'c1', result: 'pass', evidence: 'reviewer says ok' },
    ],
    feedback: 'ok',
    ...over,
  };
}

describe('goal eval provider results', () => {
  test('provider results replace reviewer goal results', () => {
    const applied = applyGoalEvalResults(verdict(), goalEval(), [
      { conditionId: 'c1', result: 'pass', evidence: 'provider evidence' },
      { conditionId: 'c2', result: 'skipped', evidence: '' },
    ], ['c1']);

    expect(applied.ok).toBe(true);
    expect(applied.verdict.verdict).toBe('PASS');
    expect(applied.verdict.goalResults).toEqual([
      { conditionId: 'c1', result: 'pass', evidence: 'provider evidence' },
      { conditionId: 'c2', result: 'skipped', evidence: '' },
    ]);
  });

  test('required condition failure forces FAIL and records an omission', () => {
    const applied = applyGoalEvalResults(verdict(), goalEval(), [
      { conditionId: 'c1', result: 'fail', evidence: 'broken' },
    ], ['c1']);

    expect(applied.ok).toBe(true);
    expect(applied.verdict.verdict).toBe('FAIL');
    expect(applied.verdict.missingGoalConditions ?? []).toEqual([]);
    expect((applied.verdict.omissions ?? []).join('\n')).toMatch(/required goal conditions not passing/);
  });

  test('missing required condition forces FAIL', () => {
    const applied = applyGoalEvalResults(verdict(), goalEval(), [
      { conditionId: 'c2', result: 'pass', evidence: 'optional' },
    ], ['c1']);

    expect(applied.ok).toBe(true);
    expect(applied.verdict.verdict).toBe('FAIL');
    expect(applied.verdict.missingGoalConditions).toEqual(['c1']);
    expect((applied.verdict.omissions ?? []).join('\n')).toMatch(/missing required goal condition/);
  });

  test('unknown or duplicate ids are rejected and leave the reviewer verdict untouched', () => {
    const original = verdict();
    for (const results of [
      [{ conditionId: 'ghost', result: 'pass', evidence: 'x' }],
      [
        { conditionId: 'c1', result: 'pass', evidence: 'x' },
        { conditionId: 'c1', result: 'pass', evidence: 'y' },
      ],
    ]) {
      const applied = applyGoalEvalResults(original, goalEval(), results as any, ['c1']);
      expect(applied.ok).toBe(false);
      expect(applied.verdict).toBe(original);
      expect(applied.errors.length).toBeGreaterThan(0);
    }
  });

  test('pass without evidence is downgraded to fail', () => {
    const applied = applyGoalEvalResults(verdict(), goalEval(), [
      { conditionId: 'c1', result: 'pass', evidence: '' },
    ], ['c1']);

    expect(applied.ok).toBe(true);
    expect(applied.verdict.verdict).toBe('FAIL');
    expect(applied.verdict.goalResults[0]).toMatchObject({ conditionId: 'c1', result: 'fail' });
    expect((applied.verdict.omissions ?? []).join('\n')).toMatch(/missing verifiable evidence/);
  });
});
