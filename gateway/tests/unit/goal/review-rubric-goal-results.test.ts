import { RubricError, parseReviewRubric } from '../../../src/core/goal/review-rubric';
import { nodeArtifactPaths, nodeOutputSchema, renderNodePrompt } from '../../../src/core/goal/node-prompts';

type GoalSpec = { id: string; result?: 'pass' | 'fail' | 'skipped' | string; evidence?: string };

function reviewFile(payload: unknown): string {
  return ['# Review', '', 'prose', '', '```mafw-review', JSON.stringify(payload), '```'].join('\n');
}

function markdownWith(
  goals: GoalSpec[],
  verdict: 'PASS' | 'FAIL' = 'PASS',
  extra: Record<string, unknown> = {},
): string {
  return reviewFile({
    verdict,
    tasks: [{ taskId: 't1', result: 'pass', evidence: 'npm test -- goal' }],
    goalResults: goals.map((goal) => ({
      conditionId: goal.id,
      result: goal.result ?? 'pass',
      evidence: goal.evidence ?? `verified ${goal.id} via npm test`,
    })),
    feedback: '',
    ...extra,
  });
}

const required = ['g1', 'g2'];

describe('parseReviewRubric goal results', () => {
  test('rejects a rubric that misses a required goal condition', () => {
    expect(() => parseReviewRubric(markdownWith([{ id: 'g1' }]), ['t1'], required))
      .toThrow(expect.objectContaining({ code: 'missing_goal_conditions' }));
    try {
      parseReviewRubric(markdownWith([{ id: 'g1' }]), ['t1'], required);
    } catch (err: any) {
      expect(err).toBeInstanceOf(RubricError);
      expect(err.message).toContain('g2');
    }
  });

  test('parses goal results covering every required condition', () => {
    const rubric = parseReviewRubric(markdownWith([{ id: 'g1' }, { id: 'g2' }]), ['t1'], required);
    expect(rubric.goalResults).toHaveLength(2);
    expect(rubric.goalResults?.map((goal) => goal.conditionId)).toEqual(['g1', 'g2']);
    expect(rubric.goalResults?.[0]).toEqual({
      conditionId: 'g1',
      result: 'pass',
      evidence: 'verified g1 via npm test',
    });
    expect(rubric.verdict).toBe('PASS');
  });

  test('rejects a failed goal condition inside a PASS verdict', () => {
    expect(() => parseReviewRubric(markdownWith([{ id: 'g1' }, { id: 'g2', result: 'fail' }]), ['t1'], required))
      .toThrow(expect.objectContaining({ code: 'invalid' }));
  });

  test('rejects a skipped required goal condition inside a PASS verdict', () => {
    expect(() => parseReviewRubric(markdownWith([{ id: 'g1' }, { id: 'g2', result: 'skipped' }]), ['t1'], required))
      .toThrow(expect.objectContaining({ code: 'invalid' }));
  });

  test('accepts failed goal conditions when the verdict is FAIL', () => {
    const rubric = parseReviewRubric(
      markdownWith([{ id: 'g1' }, { id: 'g2', result: 'fail' }], 'FAIL'),
      ['t1'],
      required,
    );
    expect(rubric.verdict).toBe('FAIL');
    expect(rubric.goalResults?.[1]).toMatchObject({ conditionId: 'g2', result: 'fail' });
    expect(rubric.inconsistent).toBeUndefined();
  });

  test('rejects blank evidence even when the condition passed', () => {
    expect(() => parseReviewRubric(
      markdownWith([{ id: 'g1', evidence: '' }, { id: 'g2' }]),
      ['t1'],
      required,
    )).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(() => parseReviewRubric(
      markdownWith([{ id: 'g1', result: 'skipped', evidence: '  ' }, { id: 'g2' }], 'FAIL'),
      ['t1'],
      required,
    )).toThrow(expect.objectContaining({ code: 'invalid' }));
  });

  test('rejects invalid results, duplicate and missing condition ids', () => {
    expect(() => parseReviewRubric(
      markdownWith([{ id: 'g1', result: 'maybe' }], 'FAIL', {}),
      ['t1'],
      ['g1'],
    )).toThrow(expect.objectContaining({ code: 'invalid' }));

    expect(() => parseReviewRubric(
      markdownWith([{ id: 'g1' }, { id: 'g1' }, { id: 'g2' }], 'FAIL'),
      ['t1'],
      required,
    )).toThrow(expect.objectContaining({ code: 'invalid' }));

    expect(() => parseReviewRubric(
      reviewFile({
        verdict: 'FAIL',
        tasks: [{ taskId: 't1', result: 'pass', evidence: 'ok' }],
        goalResults: [{ result: 'pass', evidence: 'no id' }],
        feedback: '',
      }),
      ['t1'],
      ['g1'],
    )).toThrow(expect.objectContaining({ code: 'invalid' }));
  });

  test('rejects a non-array goalResults payload', () => {
    expect(() => parseReviewRubric(
      reviewFile({
        verdict: 'FAIL',
        tasks: [{ taskId: 't1', result: 'pass', evidence: 'ok' }],
        goalResults: { g1: 'pass' },
        feedback: '',
      }),
      ['t1'],
      ['g1'],
    )).toThrow(expect.objectContaining({ code: 'invalid' }));
  });

  test('allows extra non-required goal conditions but still requires every required one', () => {
    const rubric = parseReviewRubric(
      markdownWith([{ id: 'g1' }, { id: 'g2', result: 'skipped' }, { id: 'g3', result: 'fail' }], 'FAIL'),
      ['t1'],
      required,
    );
    expect(rubric.goalResults?.map((goal) => goal.conditionId)).toEqual(['g1', 'g2', 'g3']);

    expect(() => parseReviewRubric(
      markdownWith([{ id: 'g1' }, { id: 'g3' }], 'FAIL'),
      ['t1'],
      required,
    )).toThrow(expect.objectContaining({ code: 'missing_goal_conditions' }));
  });

  test('deduplicates required condition ids', () => {
    const rubric = parseReviewRubric(markdownWith([{ id: 'g1' }], 'FAIL'), ['t1'], ['g1', 'g1', ' ']);
    expect(rubric.goalResults).toHaveLength(1);
  });

  test('stays backwards compatible when no goal conditions are required', () => {
    const legacy = reviewFile({ verdict: 'PASS', tasks: [{ taskId: 't1', result: 'pass', evidence: 'ok' }], feedback: '' });
    const rubric = parseReviewRubric(legacy, ['t1']);
    expect(rubric.goalResults).toEqual([]);
    expect(rubric.tasks).toHaveLength(1);
    expect(rubric.verdict).toBe('PASS');

    const withGoals = parseReviewRubric(markdownWith([{ id: 'g1' }]), ['t1']);
    expect(withGoals.goalResults).toHaveLength(1);
  });

  test('missing goalResults is rejected only when conditions are required', () => {
    const legacy = reviewFile({
      verdict: 'FAIL',
      tasks: [{ taskId: 't1', result: 'pass', evidence: 'ok' }],
      feedback: '',
    });
    expect(parseReviewRubric(legacy, ['t1'], []).goalResults).toEqual([]);
    expect(() => parseReviewRubric(legacy, ['t1'], ['g1']))
      .toThrow(expect.objectContaining({ code: 'missing_goal_conditions' }));
  });

  test('keeps task rubric errors unchanged when goal conditions are supplied', () => {
    const missingTask = reviewFile({
      verdict: 'PASS',
      tasks: [],
      goalResults: [{ conditionId: 'g1', result: 'pass', evidence: 'ok' }],
      feedback: '',
    });
    expect(() => parseReviewRubric(missingTask, ['t1'], ['g1']))
      .toThrow(expect.objectContaining({ code: 'missing_tasks' }));

    const taskFail = reviewFile({
      verdict: 'PASS',
      tasks: [{ taskId: 't1', result: 'fail', evidence: 'red' }],
      goalResults: [{ conditionId: 'g1', result: 'pass', evidence: 'ok' }],
      feedback: '',
    });
    const rubric = parseReviewRubric(taskFail, ['t1'], ['g1']);
    expect(rubric.verdict).toBe('FAIL');
    expect(rubric.inconsistent).toBe(true);
  });
});

describe('review goal rubric contract', () => {
  test('review output schema declares optional goalResults entries', () => {
    const schema: any = nodeOutputSchema('review').schema;
    expect(schema.required).toEqual(expect.arrayContaining(['verdict', 'tasks', 'feedback']));
    expect(schema.required).not.toContain('goalResults');
    expect(schema.properties.goalResults.type).toBe('array');
    expect(schema.properties.goalResults.items.required).toEqual(
      expect.arrayContaining(['conditionId', 'result', 'evidence']),
    );
    expect(schema.properties.goalResults.items.properties.result.enum).toEqual(['pass', 'fail', 'skipped']);
  });

  test('review prompt lists required goal conditions only when provided', () => {
    const base = {
      mafwDir: '/tmp/mafw',
      goalId: 'g1',
      round: 1,
      maxRounds: 3,
      charterPath: '/tmp/mafw/charter.md',
      requestPath: '/tmp/mafw/request.md',
    };
    const withoutGoals = renderNodePrompt('review', base as any);
    expect(withoutGoals).not.toContain('goalResults');
    expect(withoutGoals).not.toContain('Goal 验收条件');

    const withGoals = renderNodePrompt('review', {
      ...base,
      acceptance: { t1: ['npm test 全绿'] },
      goalConditions: [
        { id: 'g1', statement: '用户可以一键导出', required: true, evidence: '导出文件可打开', method: '手工 + 测试' },
        { id: 'g2', statement: '性能不回归', required: false, evidence: 'bench', method: 'bench 命令' },
      ],
    } as any);
    expect(withGoals).toContain(nodeArtifactPaths('/tmp/mafw', 'g1', 1).review);
    expect(withGoals).toContain('Goal 验收条件');
    expect(withGoals).toContain('g1（必需）');
    expect(withGoals).toContain('用户可以一键导出');
    expect(withGoals).toContain('g2：');
    expect(withGoals).toContain('goalResults');
    expect(withGoals).toContain('每一条必需的');
  });
});
