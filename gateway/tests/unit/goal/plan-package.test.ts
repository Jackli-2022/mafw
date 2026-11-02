import {
  computeGoalEvalHash,
  computePlanPackageHash,
  computeWavesHash,
  validatePlanPackage,
} from '../../../src/core/goal/plan-package';
import type { PlanPackage } from '../../../src/core/goal/plan-package';

function baseGoalEval(): any {
  return {
    outcome: '用户可以按项目切换会话标签',
    conditions: [
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
    ],
    failureConditions: ['刷新后标签丢失'],
    constraints: ['不改 gateway 契约'],
    nonGoals: ['不做跨项目拖拽'],
    mapping: {
      g1: { tasks: ['w1-t1'], probes: ['p1'], artifacts: ['docs/smoke.md'] },
      g2: { tasks: ['w1-t2'] },
    },
  };
}

function baseWaves(): any {
  return [
    {
      id: 'w1',
      title: '标签持久化',
      riskNote: 'localStorage 迁移易漏',
      tasks: [
        { taskId: 'w1-t1', title: '按项目保存标签', acceptance: ['reload 后恢复'] },
        { taskId: 'w1-t2', title: '空项目显示空列表', acceptance: ['无 tab 时为空'] },
      ],
    },
  ];
}

function basePackage(): PlanPackage {
  return { waves: baseWaves(), goalEval: baseGoalEval() };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/** 深拷贝并反转每层对象键顺序（数组顺序保持不变——数组顺序是语义）。 */
function reverseObjectKeys(value: any): any {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value).reverse();
  return entries.reduce<Record<string, unknown>>((acc, [key, item]) => {
    acc[key] = reverseObjectKeys(item);
    return acc;
  }, {});
}

describe('validatePlanPackage', () => {
  test('returns a normalized package', () => {
    const pkg = validatePlanPackage({ ...basePackage(), status: 'ready', taskType: 'feature' });
    expect(pkg.waves).toEqual(baseWaves());
    expect(pkg.goalEval).toEqual(validateGoalEvalForTest());
  });

  test('validates the embedded goal eval', () => {
    const broken = basePackage();
    broken.goalEval = { ...broken.goalEval, conditions: [] };
    expect(() => validatePlanPackage(broken))
      .toThrow('goal eval requires at least one condition');
  });

  test('requires a non-empty waves array', () => {
    expect(() => validatePlanPackage({ waves: undefined, goalEval: baseGoalEval() }))
      .toThrow('plan package requires waves');
    expect(() => validatePlanPackage({ waves: {}, goalEval: baseGoalEval() }))
      .toThrow('plan package waves must be an array');
    expect(() => validatePlanPackage({ waves: [], goalEval: baseGoalEval() }))
      .toThrow('plan package requires at least one wave');
  });

  test('rejects malformed waves and duplicate wave ids', () => {
    expect(() => validatePlanPackage({ waves: [null], goalEval: baseGoalEval() }))
      .toThrow('plan package wave must be an object');
    expect(() => validatePlanPackage({
      waves: [{ id: 'w1' }, { id: ' w1 ' }],
      goalEval: baseGoalEval(),
    })).toThrow('duplicate plan wave id: w1');
    expect(() => validatePlanPackage({ waves: [{ id: '  ' }], goalEval: baseGoalEval() }))
      .toThrow('plan package wave id is required');
  });
});

describe('computePlanPackageHash', () => {
  test('is stable for identical content and object-key order', () => {
    const pkg = basePackage();
    expect(computePlanPackageHash(pkg)).toBe(computePlanPackageHash(clone(pkg)));
    expect(computePlanPackageHash(pkg)).toBe(computePlanPackageHash(reverseObjectKeys(clone(pkg))));
    expect(computePlanPackageHash(pkg)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('ignores unrelated top-level fields', () => {
    const pkg = basePackage();
    const withExtras = { ...clone(pkg), status: 'ready', taskType: 'feature', revision: 3 };
    expect(computePlanPackageHash(withExtras as any)).toBe(computePlanPackageHash(pkg));
  });

  test('changes when waves change', () => {
    const pkg = basePackage();
    const baseHash = computePlanPackageHash(pkg);

    const retitled = clone(pkg);
    (retitled.waves as any)[0].tasks[0].title = '按项目保存标签（改）';
    expect(computePlanPackageHash(retitled)).not.toBe(baseHash);

    const added = clone(pkg);
    (added.waves as any).push({ id: 'w2', title: '回归', tasks: [] });
    expect(computePlanPackageHash(added)).not.toBe(baseHash);

    const reordered = clone(pkg);
    (reordered.waves as any)[0].tasks.reverse();
    expect(computePlanPackageHash(reordered)).not.toBe(baseHash);
  });

  test('changes when the goal eval changes', () => {
    const pkg = basePackage();
    const baseHash = computePlanPackageHash(pkg);

    const changedEval = clone(pkg);
    changedEval.goalEval.conditions[0].statement = '标签按项目恢复（新）';
    expect(computePlanPackageHash(changedEval)).not.toBe(baseHash);

    const changedMapping = clone(pkg);
    changedMapping.goalEval.mapping.g1.tasks = ['w1-t2'];
    expect(computePlanPackageHash(changedMapping)).not.toBe(baseHash);

    const changedFailure = clone(pkg);
    changedFailure.goalEval.failureConditions.push('标签重复');
    expect(computePlanPackageHash(changedFailure)).not.toBe(baseHash);
  });

  test('raw and validated input hash identically (canonical boundary)', () => {
    const rawEval = {
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
          evidence: ' session-store 单测 ',
          method: 'node --test',
        },
      ],
      failureConditions: [' 刷新后标签丢失 ', '刷新后标签丢失', ''],
      // mapping 键顺序与条件顺序相反，含空数组与重复项
      mapping: {
        g2: { tasks: [' w1-t2 ', 'w1-t2'] },
        g1: { artifacts: [], probes: [' p1 '], tasks: [' w1-t1 '] },
      },
    };
    const rawPkg = { waves: baseWaves(), goalEval: rawEval, status: 'ready' };
    const validated = validatePlanPackage(rawPkg);

    expect(computePlanPackageHash(rawPkg as any)).toBe(computePlanPackageHash(validated));
    expect(computeGoalEvalHash(rawEval)).toBe(computeGoalEvalHash(validated.goalEval));
  });

  test('separates plan hash and eval hash', () => {
    const pkg = basePackage();
    expect(computeGoalEvalHash(pkg.goalEval)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeWavesHash(pkg.waves)).not.toBe(computeGoalEvalHash(pkg.goalEval));

    const changedEval = clone(pkg);
    changedEval.goalEval.nonGoals.push('不做移动端');
    expect(computeWavesHash(changedEval.waves)).toBe(computeWavesHash(pkg.waves));
    expect(computeGoalEvalHash(changedEval.goalEval)).not.toBe(computeGoalEvalHash(pkg.goalEval));

    const changedWaves = clone(pkg);
    (changedWaves.waves as any)[0].riskNote = '改了';
    expect(computeGoalEvalHash(changedWaves.goalEval)).toBe(computeGoalEvalHash(pkg.goalEval));
    expect(computeWavesHash(changedWaves.waves)).not.toBe(computeWavesHash(pkg.waves));
  });
});

function validateGoalEvalForTest() {
  return {
    outcome: '用户可以按项目切换会话标签',
    conditions: baseGoalEval().conditions,
    failureConditions: ['刷新后标签丢失'],
    constraints: ['不改 gateway 契约'],
    nonGoals: ['不做跨项目拖拽'],
    mapping: baseGoalEval().mapping,
  };
}
