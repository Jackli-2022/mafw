import {
  computePlanPackageHash,
  validatePlanPackage,
} from '../../../src/core/goal/plan-package';

const legacy = {
  waves: [{ id: 'w1', tasks: ['legacy'] }],
  goalEval: {
    outcome: 'done',
    conditions: [{
      id: 'g1',
      statement: 'works',
      required: true,
      evidence: 'test',
      method: 'npm test',
    }],
    failureConditions: [],
    constraints: [],
    nonGoals: [],
    mapping: { g1: { tasks: ['w1-t1'] } },
  },
};

describe('PlanPackage execution strategy', () => {
  test('a quick package may omit goalEval and records the strategy', () => {
    const pkg = validatePlanPackage({
      strategy: 'quick',
      waves: [{ id: 'w1', tasks: [{ title: 'debug', acceptance: ['repro fixed'] }] }],
    });
    expect(pkg.strategy).toBe('quick');
    expect(pkg.goalEval).toBeUndefined();
  });

  test('collaborative and legacy packages still require goalEval', () => {
    expect(() => validatePlanPackage({
      strategy: 'collaborative',
      waves: [{ id: 'w1', tasks: ['x'] }],
    })).toThrow(/goalEval|goal eval/i);
    expect(() => validatePlanPackage({
      waves: [{ id: 'w1', tasks: ['x'] }],
    })).toThrow(/goalEval|goal eval/i);
  });

  test('rejects unknown strategies', () => {
    expect(() => validatePlanPackage({
      strategy: 'tiny',
      waves: [{ id: 'w1', tasks: ['x'] }],
    })).toThrow(/strategy/i);
  });

  test('a legacy package keeps its existing package hash', () => {
    expect(computePlanPackageHash(legacy)).toBe(
      'fd6bbb16760bb7c4b3aa603e1da5da0447542b68922aea8e9f7a61b06a8c2c82',
    );
  });

  test('quick and collaborative are different approved packages', () => {
    const quick = computePlanPackageHash({
      strategy: 'quick',
      waves: legacy.waves,
    });
    const collaborative = computePlanPackageHash({
      strategy: 'collaborative',
      ...legacy,
    });
    expect(quick).not.toBe(collaborative);
  });
});
