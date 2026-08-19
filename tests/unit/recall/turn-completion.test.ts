import { isTurnComplete, completeTurns, TurnEval } from '../../../gateway/src/recall/turn-completion';

const t = (session_id: string, turn_id: number, partial: Partial<TurnEval> = {}): TurnEval => ({
  session_id,
  turn_id,
  count: 1,
  has_user_input: 0,
  response_count: 0,
  last_ts: 0,
  ...partial,
});

const NOW = 1_000_000;

describe('turn completion (a/b/c)', () => {
  test('a: user input + non-empty response → complete', () => {
    expect(isTurnComplete(t('s', 1, { has_user_input: 1, response_count: 1 }), { staleMs: 30_000 })).toBe(true);
  });

  test('a: user input without any response → not complete (pending)', () => {
    expect(isTurnComplete(t('s', 1, { has_user_input: 1, response_count: 0 }), { staleMs: 30_000 })).toBe(false);
  });

  test('c: silent timeout completes a pending turn', () => {
    const lastTs = NOW - 40; // 40s ago, staleMs 30s
    expect(isTurnComplete(t('s', 1, { has_user_input: 1, response_count: 0, last_ts: lastTs }), { staleMs: 30_000, nowSec: NOW })).toBe(true);
  });

  test('c: recent silence does not complete', () => {
    const lastTs = NOW - 10;
    expect(isTurnComplete(t('s', 1, { has_user_input: 1, response_count: 0, last_ts: lastTs }), { staleMs: 30_000, nowSec: NOW })).toBe(false);
  });

  test('b: a turn with a newer sibling is complete even without responses', () => {
    const turns = [
      t('s', 1, { has_user_input: 1, response_count: 0 }),
      t('s', 2, { has_user_input: 1, response_count: 1 }),
    ];
    const done = completeTurns(turns, { staleMs: 30_000, nowSec: NOW });
    expect(done.map((x) => x.turn_id).sort()).toEqual([1, 2]);
  });

  test('sessions are independent for the newer-sibling rule', () => {
    const turns = [
      t('a', 1, { has_user_input: 1, response_count: 0 }),
      t('b', 1, { has_user_input: 1, response_count: 1 }),
    ];
    const done = completeTurns(turns, { staleMs: 30_000, nowSec: NOW });
    expect(done.map((x) => x.session_id)).toEqual(['b']);
  });

  test('empty turn never completes', () => {
    expect(isTurnComplete(t('s', 1, { count: 0 }), { staleMs: 30_000 })).toBe(false);
  });
});
