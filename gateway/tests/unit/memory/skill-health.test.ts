import { shouldDeoptSkill } from '../../../src/memory/skill-health';

const stats = (failure: number, success = 0) => ({ total: failure + success, success, failure, unknown: 0, lastAt: null });

describe('shouldDeoptSkill', () => {
  test('all source memories superseded or missing → source-superseded', () => {
    expect(shouldDeoptSkill({
      sources: [{ exists: true, superseded: true }, { exists: false, superseded: false }],
      stats: stats(0),
    })).toEqual({ deopt: true, reason: 'source-superseded' });
  });

  test('at least one live source keeps the skill', () => {
    expect(shouldDeoptSkill({
      sources: [{ exists: true, superseded: true }, { exists: true, superseded: false }],
      stats: stats(0),
    }).deopt).toBe(false);
  });

  test('empty source list is unknown, not a deopt reason', () => {
    expect(shouldDeoptSkill({ sources: [], stats: stats(0) }).deopt).toBe(false);
  });

  test('repeated mechanical failures without success → repeated-failure', () => {
    expect(shouldDeoptSkill({ sources: [{ exists: true, superseded: false }], stats: stats(3) }))
      .toEqual({ deopt: true, reason: 'repeated-failure' });
    expect(shouldDeoptSkill({ sources: [], stats: stats(2) }).deopt).toBe(false);
    expect(shouldDeoptSkill({ sources: [], stats: stats(3, 1) }).deopt).toBe(false);
    expect(shouldDeoptSkill({ sources: [], stats: stats(5), failureThreshold: 6 }).deopt).toBe(false);
  });
});
