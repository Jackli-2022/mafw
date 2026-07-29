import { IDFStats } from '../../../gateway/src/retrieval/idf-stats';

test('IDFStats computes correct IDF values', () => {
  const stats = new IDFStats();
  stats.addDocument(['payment', 'create']);
  stats.addDocument(['payment', 'refund']);
  stats.addDocument(['order']);
  expect(stats.idf('payment')).toBeCloseTo(0.405, 2);
  expect(stats.idf('create')).toBeCloseTo(1.099, 2);
});

test('isNoisy returns true for IDF below threshold', () => {
  const stats = new IDFStats(0.5);
  stats.addDocument(['common']);
  stats.addDocument(['common']);
  stats.addDocument(['rare']);
  expect(stats.isNoisy('common')).toBe(true);
  expect(stats.isNoisy('rare')).toBe(false);
});

test('idf returns 0 for unknown term', () => {
  const stats = new IDFStats();
  expect(stats.idf('unknown')).toBe(0);
});
