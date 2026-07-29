import { matchAbstraction } from '../../../gateway/src/memory/abstraction-matcher';

test('returns auto-merge >= 0.5', () => {
  const result = matchAbstraction('create payment order', 'create payment transaction');
  expect(result.similarity).toBe(0.5);
  expect(result.level).toBe('auto');
});

test('returns conflict >= 0.2', () => {
  const result = matchAbstraction('create payment order', 'refund payment process');
  expect(result.similarity).toBe(0.2);
  expect(result.level).toBe('conflict');
});

test('returns none < 0.2', () => {
  const result = matchAbstraction('database schema design', 'user login flow');
  expect(result.similarity).toBe(0);
  expect(result.level).toBe('none');
});

test('handles empty input', () => {
  const result = matchAbstraction('', 'test');
  expect(result.similarity).toBe(0);
  expect(result.level).toBe('none');
});
