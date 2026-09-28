/**
 * Atomic file writes: on Windows, renameSync over a freshly-created target can
 * transiently fail with EPERM/EBUSY (antivirus / indexer holds a handle).
 * Retrying briefly turns a flaky crash into a non-event.
 */
import { renameWithRetry } from '../../src/core/utils/atomic-write';

function err(code: string): NodeJS.ErrnoException {
  const e = new Error(`${code}: mock`) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

test('retries transient EPERM and succeeds', () => {
  let calls = 0;
  const rename = () => {
    calls++;
    if (calls <= 2) throw err('EPERM');
  };
  expect(() => renameWithRetry('a.tmp', 'a', { attempts: 5, sleepMs: 1, rename })).not.toThrow();
  expect(calls).toBe(3);
});

test('gives up after the attempt budget and rethrows', () => {
  let calls = 0;
  const rename = () => {
    calls++;
    throw err('EBUSY');
  };
  expect(() => renameWithRetry('a.tmp', 'a', { attempts: 3, sleepMs: 1, rename })).toThrow(/EBUSY/);
  expect(calls).toBe(3);
});

test('does not retry non-transient errors', () => {
  let calls = 0;
  const rename = () => {
    calls++;
    throw err('ENOENT');
  };
  expect(() => renameWithRetry('a.tmp', 'a', { attempts: 5, sleepMs: 1, rename })).toThrow(/ENOENT/);
  expect(calls).toBe(1);
});
