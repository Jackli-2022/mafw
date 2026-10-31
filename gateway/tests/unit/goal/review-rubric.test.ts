import { RubricError, parseReviewRubric, taskAcceptanceFromWavePlan, taskIdsFromWavePlan } from '../../../src/core/goal/review-rubric';

function reviewFile(payload: unknown): string {
  return [
    '# Review',
    '',
    'some prose',
    '',
    '```mafw-review',
    JSON.stringify(payload),
    '```',
  ].join('\n');
}

describe('parseReviewRubric', () => {
  test('parses per-task results covering every wave task', () => {
    const rubric = parseReviewRubric(reviewFile({
      verdict: 'PASS',
      tasks: [
        { taskId: 'w1-t1', result: 'pass', evidence: 'npm test -- pod' },
        { taskId: 'w1-t2', result: 'pass', evidence: 'read receipts/loop-1.md' },
      ],
      feedback: 'looks good',
    }), ['w1-t1', 'w1-t2']);
    expect(rubric.verdict).toBe('PASS');
    expect(rubric.tasks.map((t) => t.taskId)).toEqual(['w1-t1', 'w1-t2']);
    expect(rubric.tasks[0].evidence).toBe('npm test -- pod');
    expect(rubric.inconsistent).toBeUndefined();
  });

  test('rejects a rubric that misses a wave task', () => {
    expect(() => parseReviewRubric(reviewFile({
      verdict: 'PASS',
      tasks: [{ taskId: 'w1-t1', result: 'pass', evidence: 'x' }],
      feedback: '',
    }), ['w1-t1', 'w1-t2'])).toThrow(RubricError);
    try {
      parseReviewRubric(reviewFile({ verdict: 'PASS', tasks: [], feedback: '' }), ['w1-t2']);
    } catch (err: any) {
      expect(err.code).toBe('missing_tasks');
      expect(err.message).toContain('w1-t2');
    }
  });

  test('downgrades PASS to FAIL when a task failed', () => {
    const rubric = parseReviewRubric(reviewFile({
      verdict: 'PASS',
      tasks: [
        { taskId: 'w1-t1', result: 'fail', evidence: 'test red' },
        { taskId: 'w1-t2', result: 'pass', evidence: 'ok' },
      ],
      feedback: '',
    }), ['w1-t1', 'w1-t2']);
    expect(rubric.verdict).toBe('FAIL');
    expect(rubric.inconsistent).toBe(true);
    expect(rubric.feedback).toContain('w1-t1');
  });

  test('allows legacy review files without tasks only when waves had no tasks', () => {
    const legacy = reviewFile({ verdict: 'FAIL', feedback: 'needs work' });
    expect(parseReviewRubric(legacy, []).tasks).toEqual([]);
    expect(() => parseReviewRubric(legacy, ['w1-t1'])).toThrow(RubricError);
  });

  test('rejects duplicate task ids and keeps skipped as skipped', () => {
    expect(() => parseReviewRubric(reviewFile({
      verdict: 'FAIL',
      tasks: [
        { taskId: 'w1-t1', result: 'pass', evidence: 'a' },
        { taskId: 'w1-t1', result: 'pass', evidence: 'b' },
      ],
      feedback: 'dup',
    }), ['w1-t1'])).toThrow(RubricError);

    const rubric = parseReviewRubric(reviewFile({
      verdict: 'FAIL',
      tasks: [{ taskId: 'w1-t1', result: 'skipped', evidence: 'blocked by w1-t0' }],
      feedback: 'skipped',
    }), ['w1-t1']);
    expect(rubric.tasks[0].result).toBe('skipped');
  });

  test('rejects a review file without a mafw-review block', () => {
    expect(() => parseReviewRubric('# Review\n\nno block here', ['w1-t1'])).toThrow(RubricError);
  });

  test('evidence is required for pass/fail but not for skipped', () => {
    expect(() => parseReviewRubric(reviewFile({
      verdict: 'PASS', tasks: [{ taskId: 'w1-t1', result: 'pass', evidence: '' }], feedback: 'ok',
    }), ['w1-t1'])).toThrow(RubricError);
    expect(parseReviewRubric(reviewFile({
      verdict: 'FAIL', tasks: [{ taskId: 'w1-t1', result: 'skipped', evidence: '' }], feedback: 'blocked',
    }), ['w1-t1']).tasks[0].result).toBe('skipped');
  });

  test('taskAcceptanceFromWavePlan reads object tasks and ignores string tasks', () => {
    const plan = {
      waves: [
        { id: 'w1', tasks: [{ title: 'a', acceptance: ['npm test 全绿', ' receipts 含路径 '] }, 'legacy'] },
        { id: 'w2', tasks: [{ title: 'b' }] },
      ],
    };
    expect(taskAcceptanceFromWavePlan(plan)).toEqual({
      'w1-t1': ['npm test 全绿', 'receipts 含路径'],
    });
    expect(taskIdsFromWavePlan(plan)).toEqual(['w1-t1', 'w1-t2', 'w2-t1']);
    expect(taskAcceptanceFromWavePlan({ waves: [{ id: 'w1', tasks: ['x'] }] })).toEqual({});
  });
});
