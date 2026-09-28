/**
 * R5 FOK gate rendering at the boundary-recall exit: the "no reliable memory"
 * zone must inject an explicit status block — silence is never correct, it
 * invites confabulation.
 */
import { formatRecallContext } from '../../../src/recall/inject-format';

const mem = (id: string, text: string) => ({
  id, primary_abstraction: text, memory_value: text, energy: 0.8, type: 'semantic',
  created_at: '2024-05-01T00:00:00Z',
});

describe('formatRecallContext FOK status', () => {
  test('back-compat: no status + empty → null (old behaviour)', () => {
    expect(formatRecallContext([]).pointers).toBeNull();
  });

  test('no-memory + empty → explicit status block (not silence)', () => {
    const { pointers } = formatRecallContext([], { status: 'no-memory' });
    expect(pointers).not.toBeNull();
    expect(pointers).toContain('status="no-reliable-memory"');
  });

  test('no-memory with candidates: KEEPS the pointers and states the status', () => {
    // Measured design (LongMemEval L2, 2026-09-28): withholding contexts hurts
    // answerable accuracy (-20pt on the affected zone) AND lowers abstention
    // accuracy (0.933 vs 0.967) — the reader needs the evidence to confirm the
    // information is absent. Declare, don't withhold.
    const { pointers } = formatRecallContext([mem('mem_1_aaaaaa', 'secret plan')], { status: 'no-memory' });
    expect(pointers).toContain('status="no-reliable-memory"');
    expect(pointers).toContain('mem-aaaaaa');
    expect(pointers).toContain('secret plan');
  });

  test('low-confidence injects the pointers plus a caution marker', () => {
    const { pointers } = formatRecallContext([mem('mem_1_bbbbbb', 'user prefers tea')], { status: 'low-confidence' });
    expect(pointers).toContain('mem-bbbbbb');
    expect(pointers).toContain('置信度低');
  });

  test('inject zone renders exactly like the default path', () => {
    const m = [mem('mem_1_cccccc', 'user prefers tea')];
    expect(formatRecallContext(m, { status: 'inject' }).pointers).toBe(formatRecallContext(m).pointers);
  });
});
