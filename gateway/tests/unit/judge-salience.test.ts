import { judgeSalience } from '../../src/judge/salience';

describe('judgeSalience', () => {
  test('无额外信号时等于正则三档（向后兼容）', () => {
    expect(judgeSalience({ text: 'error crash 严重' }).score).toBe(1.5);
    expect(judgeSalience({ text: 'info success 正常' }).score).toBe(0.5);
    expect(judgeSalience({ text: 'plain text' }).score).toBe(1.0);
  });

  test('新颖度高 → 分数提升', () => {
    const base = judgeSalience({ text: 'plain text' }).score;
    const novel = judgeSalience({ text: 'plain text', novelty: 1 }).score;
    expect(novel).toBeGreaterThan(base);
  });

  test('低反馈 → 分数下降', () => {
    expect(judgeSalience({ text: 'plain text', feedback: 0 }).score).toBeLessThan(1.0);
  });

  test('分数钳制在 0.5–1.5，置信度随信号数上升', () => {
    const r = judgeSalience({ text: 'error', novelty: 1, feedback: 1, repetitions: 5 });
    expect(r.score).toBeLessThanOrEqual(1.5);
    expect(r.score).toBeGreaterThanOrEqual(0.5);
    expect(r.confidence).toBe(1);
  });
});
