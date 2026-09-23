/**
 * S2: replay priority sampling — prioritized (not uniform) replay selection.
 */
import { replayPriority, sampleByPriority } from '../../src/recall/replay-sampling';

test('priority increases with salience/novelty, decays with age', () => {
  expect(replayPriority({ salience: 1, novelty: 1, ageHours: 0 }))
    .toBeGreaterThan(replayPriority({ salience: 0.2, novelty: 0.2, ageHours: 0 }));
  expect(replayPriority({ salience: 1, novelty: 1, ageHours: 0 }))
    .toBeGreaterThan(replayPriority({ salience: 1, novelty: 1, ageHours: 72 }));
});

test('budget-respecting selection prefers higher priority', () => {
  const items = [{ id: 'a', s: 1, len: 5 }, { id: 'b', s: 0.1, len: 5 }, { id: 'c', s: 0.9, len: 5 }];
  const out = sampleByPriority(items, (x) => x.s, 10, (x) => x.len);
  expect(out.map((x) => x.id)).toEqual(['a', 'c']);
});

test('oversized item is skipped, not truncating the budget', () => {
  const items = [{ id: 'big', s: 1, len: 100 }, { id: 'ok', s: 0.5, len: 5 }];
  const out = sampleByPriority(items, (x) => x.s, 10, (x) => x.len);
  expect(out.map((x) => x.id)).toEqual(['ok']);
});
