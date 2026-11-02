import { validateGoalEval } from '../../../src/core/goal/goal-eval';

function baseEval(): any {
  return {
    outcome: '  用户可以按项目切换会话标签  ',
    conditions: [
      {
        id: ' g1 ',
        statement: ' 标签按项目恢复 ',
        required: true,
        evidence: ' 桌面冒烟截图 + 单测 ',
        method: ' npm test -- desktop ',
      },
      {
        id: 'g2',
        statement: '未加载过的项目显示空列表',
        required: false,
        evidence: 'session-store 单测',
        method: 'node --test',
      },
    ],
    failureConditions: [' 刷新后标签丢失 ', '刷新后标签丢失', ''],
    constraints: [' 不改 gateway 契约 '],
    nonGoals: [],
    mapping: {
      g1: { tasks: [' w1-t1 ', 'w1-t1'], probes: [' p1 '], artifacts: [] },
      g2: { tasks: ['w1-t2'] },
    },
  };
}

describe('validateGoalEval', () => {
  test('normalizes conditions, lists and mapping', () => {
    const evalResult = validateGoalEval(baseEval());

    expect(evalResult.outcome).toBe('用户可以按项目切换会话标签');
    expect(evalResult.conditions).toEqual([
      {
        id: 'g1',
        statement: '标签按项目恢复',
        required: true,
        evidence: '桌面冒烟截图 + 单测',
        method: 'npm test -- desktop',
      },
      {
        id: 'g2',
        statement: '未加载过的项目显示空列表',
        required: false,
        evidence: 'session-store 单测',
        method: 'node --test',
      },
    ]);
    expect(evalResult.failureConditions).toEqual(['刷新后标签丢失']);
    expect(evalResult.constraints).toEqual(['不改 gateway 契约']);
    expect(evalResult.nonGoals).toEqual([]);
    expect(evalResult.mapping).toEqual({
      g1: { tasks: ['w1-t1'], probes: ['p1'] },
      g2: { tasks: ['w1-t2'] },
    });
  });

  test('does not mutate the input and is idempotent', () => {
    const input = baseEval();
    const snapshot = JSON.parse(JSON.stringify(input));

    const once = validateGoalEval(input);
    const twice = validateGoalEval(once);

    expect(input).toEqual(snapshot);
    expect(twice).toEqual(once);
  });

  test('defaults optional list fields to empty arrays', () => {
    const minimal = {
      outcome: 'outcome',
      conditions: [{ id: 'g1', statement: 's', required: true, evidence: 'e', method: 'm' }],
    };
    expect(validateGoalEval(minimal)).toEqual({
      outcome: 'outcome',
      conditions: [{ id: 'g1', statement: 's', required: true, evidence: 'e', method: 'm' }],
      failureConditions: [],
      constraints: [],
      nonGoals: [],
      mapping: {},
    });
  });

  test('requires an outcome', () => {
    expect(() => validateGoalEval({ ...baseEval(), outcome: '   ' }))
      .toThrow('goal eval requires an outcome');
    expect(() => validateGoalEval({ ...baseEval(), outcome: undefined }))
      .toThrow('goal eval requires an outcome');
  });

  test('requires at least one condition', () => {
    expect(() => validateGoalEval({ ...baseEval(), conditions: [] }))
      .toThrow('goal eval requires at least one condition');
    expect(() => validateGoalEval({ ...baseEval(), conditions: undefined }))
      .toThrow('goal eval requires at least one condition');
  });

  test('requires at least one required condition', () => {
    const evalInput = baseEval();
    evalInput.conditions = evalInput.conditions.map((condition: any) => ({ ...condition, required: false }));
    expect(() => validateGoalEval(evalInput))
      .toThrow('goal eval requires at least one required condition');
  });

  test('rejects duplicate condition ids', () => {
    const evalInput = baseEval();
    evalInput.conditions[1].id = 'g1';
    expect(() => validateGoalEval(evalInput))
      .toThrow('duplicate goal eval condition id: g1');
  });

  test('rejects empty ids, statements, evidence and methods', () => {
    const noId = baseEval();
    noId.conditions[0].id = '  ';
    expect(() => validateGoalEval(noId)).toThrow('goal eval condition id is required');

    const noStatement = baseEval();
    noStatement.conditions[0].statement = '  ';
    expect(() => validateGoalEval(noStatement))
      .toThrow('goal eval condition statement is required: g1');

    const noEvidence = baseEval();
    noEvidence.conditions[0].evidence = '';
    expect(() => validateGoalEval(noEvidence))
      .toThrow('goal eval condition evidence is required: g1');

    const noMethod = baseEval();
    noMethod.conditions[0].method = '   ';
    expect(() => validateGoalEval(noMethod))
      .toThrow('goal eval condition method is required: g1');
  });

  test('rejects non-boolean required flags', () => {
    const evalInput = baseEval();
    evalInput.conditions[0].required = 'yes';
    expect(() => validateGoalEval(evalInput))
      .toThrow('goal eval condition required must be boolean: g1');
  });

  test('rejects malformed condition entries', () => {
    const evalInput = baseEval();
    evalInput.conditions[0] = 'g1';
    expect(() => validateGoalEval(evalInput))
      .toThrow('goal eval condition must be an object');
  });

  test('mapping must reference known condition ids', () => {
    const evalInput = baseEval();
    evalInput.mapping.ghost = { tasks: ['w1-t9'] };
    expect(() => validateGoalEval(evalInput))
      .toThrow('goal eval mapping references unknown condition: ghost');

    const notObject = baseEval();
    notObject.mapping.g1 = ['w1-t1'];
    expect(() => validateGoalEval(notObject))
      .toThrow('goal eval mapping entry must be an object: g1');

    const badValues = baseEval();
    badValues.mapping.g1 = { tasks: ['w1-t1', '  ', 3] };
    expect(() => validateGoalEval(badValues))
      .toThrow('goal eval mapping tasks must be an array of strings: g1');
  });

  test('rejects non-array list fields', () => {
    expect(() => validateGoalEval({ ...baseEval(), nonGoals: 'none' }))
      .toThrow('goal eval nonGoals must be an array of strings');
    expect(() => validateGoalEval({ ...baseEval(), failureConditions: [null] }))
      .toThrow('goal eval failureConditions must be an array of strings');
  });

  test('rejects non-object input', () => {
    expect(() => validateGoalEval(null)).toThrow('goal eval must be an object');
    expect(() => validateGoalEval('eval')).toThrow('goal eval must be an object');
  });
});
