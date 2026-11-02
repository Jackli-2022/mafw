import { JUDGE_SYSTEM } from '../../src/memory/judge-prompt';

describe('consolidation judge prompt', () => {
  test('states the decision procedure in order: merge first, separate, create last', () => {
    const merge = JUDGE_SYSTEM.indexOf('SAME THING');
    const separate = JUDGE_SYSTEM.indexOf('DIFFERENT instance');
    const create = JUDGE_SYSTEM.indexOf('A shared project or topic is NOT enough');
    expect(merge).toBeGreaterThan(-1);
    expect(separate).toBeGreaterThan(merge);
    expect(create).toBeGreaterThan(separate);
  });

  test('keeps the anti-fragmentation rule and the anti-over-merge rule', () => {
    expect(JUDGE_SYSTEM).toMatch(/fragment memory/i);
    expect(JUDGE_SYSTEM).toMatch(/two distinct findings about one project stay separate/i);
  });

  test('still demands a bare JSON answer', () => {
    expect(JUDGE_SYSTEM).toContain('Respond with ONLY a JSON object');
    expect(JUDGE_SYSTEM).toContain('"action":"update"');
    expect(JUDGE_SYSTEM).toContain('"action":"separate"');
    expect(JUDGE_SYSTEM).toContain('"action":"create"');
  });
});
