import { DeferredMemory } from '../../../gateway/src/feedback/deferred-memory';

test('does not distill below threshold', () => {
  const dm = new DeferredMemory();
  const result = dm.recordObservation('debug payment timeout', 'payment');
  expect(result.shouldDistill).toBe(false);
  expect(result.count).toBe(1);
});

test('triggers distillation at threshold 3', () => {
  const dm = new DeferredMemory();
  dm.recordObservation('debug payment', 'payment');
  dm.recordObservation('fix payment', 'payment');
  const result = dm.recordObservation('payment done', 'payment');
  expect(result.shouldDistill).toBe(true);
  expect(result.count).toBe(3);
});

test('different topics are tracked separately', () => {
  const dm = new DeferredMemory();
  dm.recordObservation('debug payment', 'payment');
  const result = dm.recordObservation('fix login', 'login');
  expect(result.shouldDistill).toBe(false);
});
