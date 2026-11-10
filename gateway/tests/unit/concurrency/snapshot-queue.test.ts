// Integration test for the snapshotBuildInFlight semantic change.
// Phase A: drop → queue (boolean mutex → Guard queue).
// Phase B: Guard queue → scheduler defer-to-idle. This test pins the scheduler
// semantics that refreshSnapshot relies on: same-key queueing (no drops) plus
// idle deferral (queued builds wait for foreground quiescence).
// Spec: docs/superpowers/specs/2026-11-09-gateway-kernel-scheduler-design.md §5.1
import { Scheduler } from '../../../src/scheduler';

function manual<T = void>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The exact descriptor refreshSnapshot submits with (index.ts Task 4). */
function snapshotTask() {
  return { priority: 'midground' as const, mutexKey: 'snapshot', strategy: 'defer-to-idle' as const };
}

describe('snapshotBuildInFlight queue semantics (Phase B Task 4)', () => {
  it('second build request queues (not drops) while first is building', async () => {
    const s = new Scheduler();
    const builds: string[] = [];

    // Simulate a slow build (embedding + reranker)
    const buildA = s.submit(snapshotTask(), async () => {
      await new Promise((r) => setTimeout(r, 50));
      builds.push('A');
      return 'A-done';
    });

    // Simulate a second request arriving while A is still building.
    // Previously this would be silently dropped (boolean mutex).
    const buildB = s.submit(snapshotTask(), async () => {
      builds.push('B');
      return 'B-done';
    });

    // Both should complete — B waits for A, then runs
    expect(await buildA).toBe('A-done');
    expect(await buildB).toBe('B-done');
    expect(builds).toEqual(['A', 'B']);
  });

  it('multiple queued builds execute sequentially after the current one', async () => {
    const s = new Scheduler();
    const order: string[] = [];

    const tasks = ['A', 'B', 'C', 'D'].map((name) =>
      s.submit(snapshotTask(), async () => {
        order.push(name);
        if (name === 'A') await new Promise((r) => setTimeout(r, 30));
        return name;
      }),
    );

    await Promise.all(tasks);
    // All four builds run — none dropped
    expect(order).toEqual(['A', 'B', 'C', 'D']);
  });

  it('a queued build defers while a foreground task is in flight, then runs', async () => {
    const s = new Scheduler();
    const gate = manual();
    const fg = s.submit({ priority: 'foreground', strategy: 'queue' }, () => gate.promise);

    let firstStarted = false;
    const buildA = s.submit(snapshotTask(), async () => {
      firstStarted = true;
    });
    // Pump is synchronous on submit: with foreground in flight, the defer-
    // to-idle build must not have started.
    expect(firstStarted).toBe(false);

    gate.resolve(undefined);
    await fg;
    await buildA;
    expect(firstStarted).toBe(true);
  });
});
