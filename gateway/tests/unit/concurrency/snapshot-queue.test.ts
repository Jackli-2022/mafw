// Integration test for the snapshotBuildInFlight semantic change (drop → queue).
// The actual snapshot build lives in the 9800-line index.ts which cannot be
// unit-tested directly; this test pins the Guard queue semantics that
// refreshSnapshot now relies on.
import { Guard } from '../../../src/concurrency/guard';

describe('snapshotBuildInFlight queue semantics (Phase A Task 3)', () => {
  it('second build request queues (not drops) while first is building', async () => {
    const guard = new Guard();
    const builds: string[] = [];

    // Simulate a slow build (embedding + reranker)
    const buildA = guard.run('snapshot', async () => {
      await new Promise((r) => setTimeout(r, 50));
      builds.push('A');
      return 'A-done';
    }, { onConflict: 'queue' });

    // Simulate a second request arriving while A is still building.
    // Previously this would be silently dropped (boolean mutex).
    const buildB = guard.run('snapshot', async () => {
      builds.push('B');
      return 'B-done';
    }, { onConflict: 'queue' });

    // Both should complete — B waits for A, then runs
    expect(await buildA).toBe('A-done');
    expect(await buildB).toBe('B-done');
    expect(builds).toEqual(['A', 'B']);
  });

  it('multiple queued builds execute sequentially after the current one', async () => {
    const guard = new Guard();
    const order: string[] = [];

    const tasks = ['A', 'B', 'C', 'D'].map((name) =>
      guard.run('snapshot', async () => {
        order.push(name);
        if (name === 'A') await new Promise((r) => setTimeout(r, 30));
        return name;
      }, { onConflict: 'queue' }),
    );

    await Promise.all(tasks);
    // All four builds run — none dropped
    expect(order).toEqual(['A', 'B', 'C', 'D']);
  });
});
