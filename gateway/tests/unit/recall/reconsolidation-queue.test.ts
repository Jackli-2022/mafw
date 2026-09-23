/**
 * S5.2: reconsolidation queue (mark/expire/consume) + prediction-error gate.
 */
import { InMemoryReconsolidationQueue, shouldReconsolidate } from '../../../src/recall/reconsolidation';

test('mark eligible then expire after TTL', () => {
  const q = new InMemoryReconsolidationQueue();
  q.mark('a', 'feedback', 1000);
  expect(q.isEligible('a', Date.now())).toBe(true);
  expect(q.isEligible('a', Date.now() + 2000)).toBe(false);
});

test('listEligible excludes expired', () => {
  const q = new InMemoryReconsolidationQueue();
  q.mark('a', 'feedback', 1000);
  q.mark('b', 'feedback', 10 * 60_000);
  expect(q.listEligible(Date.now() + 2000)).toEqual(['b']);
});

test('consume removes eligibility', () => {
  const q = new InMemoryReconsolidationQueue();
  q.mark('a', 'feedback', 1000);
  q.consume('a');
  expect(q.isEligible('a', Date.now())).toBe(false);
});

test('prediction-error gate: only an update verdict targeting this id', () => {
  expect(shouldReconsolidate({ action: 'update', targetId: 'a' }, 'a')).toBe(true);
  expect(shouldReconsolidate({ action: 'create' }, 'a')).toBe(false);
  expect(shouldReconsolidate({ action: 'separate', targetId: 'a' }, 'a')).toBe(false);
  expect(shouldReconsolidate({ action: 'update', targetId: 'b' }, 'a')).toBe(false);
  expect(shouldReconsolidate(null, 'a')).toBe(false);
});
