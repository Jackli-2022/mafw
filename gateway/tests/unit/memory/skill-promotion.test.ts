import { evaluatePromotion, isConsistentMapping, DEFAULT_PROMOTION_GATES, renderSkillMd } from '../../../src/memory/skill-promotion';

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

describe('renderSkillMd', () => {
  it('renders OKF unit as SKILL.md (name/desc/body mapping)', () => {
    const r = renderSkillMd({
      id: 'mem_1791453253146_y3ggt9',
      primary_abstraction: 'serve sidecar 重启后必须重订事件流',
      memory_value: '1. killProcessOnPort\n2. startServe\n3. subscribeToEvents',
      cue_anchors: ['serve', 'watchdog', 'sse'],
    });
    expect(r.name).toBe('ms-y3ggt9');
    expect(r.content).toMatch(/^---\nname: ms-y3ggt9\n/);
    expect(r.content).toContain('description: serve sidecar 重启后必须重订事件流。触发词：serve / watchdog / sse');
    expect(r.content).toContain('1. killProcessOnPort');
    expect(r.content).toContain('> 物化自记忆 mem_1791453253146_y3ggt9');
  });

  it('excludes namespaced anchors (cat:/pref:/skill:) from trigger words', () => {
    const r = renderSkillMd({
      id: 'mem_x_abcdef',
      primary_abstraction: 'P',
      memory_value: '1. a\n2. b',
      cue_anchors: ['alpha', 'cat:failure', 'verified:2026-10-01'],
    });
    expect(r.content).toContain('触发词：alpha');
    expect(r.content).not.toContain('cat:failure');
  });
});
