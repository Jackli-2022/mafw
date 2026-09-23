/**
 * S5.1: retrieval access bonus — a hit strengthens the memory (+0.02 energy).
 */
import { applyAccessBonus } from '../../../src/recall/access-bonus';

test('applies +0.02 to each hit id', () => {
  const calls: Array<[string, number]> = [];
  applyAccessBonus(['a', 'b'], { updateEnergy: (id, d) => calls.push([id, d]) });
  expect(calls).toEqual([['a', 0.02], ['b', 0.02]]);
});

test('no hits → no calls', () => {
  const calls: any[] = [];
  applyAccessBonus([], { updateEnergy: (...a: any[]) => calls.push(a) });
  expect(calls).toHaveLength(0);
});

test('a throwing index does not propagate (fail-open)', () => {
  expect(() => applyAccessBonus(['a'], { updateEnergy: () => { throw new Error('x'); } })).not.toThrow();
});
