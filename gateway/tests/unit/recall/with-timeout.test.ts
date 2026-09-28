/**
 * deadline guard for the boundary path: adding the dense channel must never
 * block on a busy embedding sidecar.
 */
import { withTimeout } from '../../../src/recall/recall-context';

describe('withTimeout', () => {
  test('resolves the value when it beats the deadline', async () => {
    await expect(withTimeout(Promise.resolve('v'), 50)).resolves.toBe('v');
  });

  test('resolves null when the deadline wins', async () => {
    const slow = new Promise<string>(r => setTimeout(() => r('late'), 100));
    await expect(withTimeout(slow, 10)).resolves.toBeNull();
  });

  test('resolves null on rejection (fail-open)', async () => {
    await expect(withTimeout(Promise.reject(new Error('sidecar down')), 50)).resolves.toBeNull();
  });
});
