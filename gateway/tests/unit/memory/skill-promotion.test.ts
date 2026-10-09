import { evaluatePromotion, isConsistentMapping, DEFAULT_PROMOTION_GATES } from '../../../src/memory/skill-promotion';

describe('isConsistentMapping', () => {
  it('step-shaped body passes', () => {
    expect(isConsistentMapping('1. 改代码\n2. npm run build\n3. 写令牌\n4. 等待通知')).toBe(true);
  });
  it('conditional-heavy body fails (variable mapping stays declarative)', () => {
    expect(isConsistentMapping('如果 A 则 X，否则 Y；若 B 取决于 C，如果 D 则 Z')).toBe(false);
  });
});

describe('evaluatePromotion', () => {
  const base = { need7d: 5, energy: 0.8, body: '1. a\n2. b', verified: true, daysSinceRevision: 10, existingSkillCount: 3 };
  it('all gates pass → eligible', () => {
    expect(evaluatePromotion(base).eligible).toBe(true);
  });
  it.each([
    ['G1 热度', { need7d: 1 }],
    ['G3 未验证', { verified: false }],
    ['G4 不稳定', { daysSinceRevision: 2 }],
    ['G5 列表膨胀', { existingSkillCount: DEFAULT_PROMOTION_GATES.maxSkills }],
  ])('%s → ineligible with reason', (_n, patch) => {
    const d = evaluatePromotion({ ...base, ...patch });
    expect(d.eligible).toBe(false);
    expect(d.reasons.length).toBeGreaterThan(0);
  });
  it('G2 条件分支体 → ineligible', () => {
    expect(evaluatePromotion({ ...base, body: '如果 x 则 a 否则 b' }).eligible).toBe(false);
  });
});
