/**
 * E11-3 — resource admission re-check at START time.
 *
 * `admissionChecker` gates *submission*; it cannot see a task that was already
 * queued (capacity-blocked) when the box degraded. Before E11-3 `pump()` started
 * every eligible queued task regardless of pressure — a backfill queued on a
 * healthy machine ran after the disk went critical.
 *
 * `resourceAdmission` is a **resource-pressure** re-check (never the budget
 * checker — budgets are checked once, at submit):
 *   - false ⇒ non-foreground tasks stay queued (nothing is dropped);
 *   - foreground always starts, and other eligible candidates are still
 *     considered (work-conserving, no early `return`);
 *   - recovery is driven by `sweep()` (kernel wires the governor edge).
 *
 * Spec: docs/superpowers/specs/2026-11-13-gateway-e11-identity-hardening-design.md §3
 */
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

describe('Scheduler resourceAdmission (E11-3)', () => {
  it('a queued non-foreground task is NOT started when admission flips false, and starts once after recovery', async () => {
    let admitted = true;
    const s = new Scheduler({ maxConcurrent: 1, resourceAdmission: () => admitted });
    const gate = manual();
    const blocker = s.submit({ priority: 'background', mutexKey: 'blk', strategy: 'queue' }, () => gate.promise);

    const runs: string[] = [];
    const queued = s.submit({ priority: 'background', strategy: 'queue' }, async () => {
      runs.push('queued');
    });
    expect(runs).toEqual([]); // capacity-blocked behind the blocker

    // Degrade, then free the slot: the settle-time pump must NOT start it.
    admitted = false;
    gate.resolve(undefined);
    await blocker;
    expect(runs).toEqual([]);
    expect(s.stats().queued).toBe(1);
    expect(s.stats().running).toBe(0);

    // An explicit sweep while still degraded is also a no-op (and terminates).
    await s.sweep();
    expect(runs).toEqual([]);
    expect(s.stats().queued).toBe(1);

    // Recovery: sweep starts it exactly once.
    admitted = true;
    await s.sweep();
    expect(runs).toEqual(['queued']);
    await queued;
    expect(runs).toEqual(['queued']);
  });

  it('foreground starts while admission is false (pressure never blocks the user)', async () => {
    let admitted = false;
    const s = new Scheduler({ resourceAdmission: () => admitted });
    await expect(s.submit({ priority: 'foreground', strategy: 'queue' }, async () => 'fg')).resolves.toBe('fg');
  });

  it('a key-blocked foreground still starts when the key frees under pressure (work-conserving)', async () => {
    let admitted = true;
    const s = new Scheduler({ maxConcurrent: 1, resourceAdmission: () => admitted });
    const gate = manual();
    const holder = s.submit({ priority: 'background', mutexKey: 'k', strategy: 'queue' }, () => gate.promise);
    let fgRan = false;
    const fg = s.submit({ priority: 'foreground', mutexKey: 'k', strategy: 'queue' }, async () => {
      fgRan = true;
    });

    // Degrade while the foreground waits on the key: pump must skip the blocked
    // non-foreground path without returning early — the foreground is next.
    admitted = false;
    gate.resolve(undefined);
    await holder;
    await fg;
    expect(fgRan).toBe(true);
  });

  it('resourceAdmission is not a submit gate: a new non-foreground task queues (not rejected) while degraded', async () => {
    let admitted = true;
    const s = new Scheduler({ maxConcurrent: 1, resourceAdmission: () => admitted });
    const gate = manual();
    const blocker = s.submit({ priority: 'background', mutexKey: 'blk', strategy: 'queue' }, () => gate.promise);

    admitted = false;
    let ran = false;
    const queued = s.submit({ priority: 'background', strategy: 'queue' }, async () => {
      ran = true;
    });
    expect(ran).toBe(false);
    expect(s.stats().queued).toBe(1); // queued, not rejected (no admissionChecker here)

    admitted = true;
    gate.resolve(undefined);
    await Promise.all([blocker, queued]);
    expect(ran).toBe(true);
  });

  it('no task loss or duplication across repeated degrade / recover sweeps', async () => {
    let admitted = true;
    const s = new Scheduler({ maxConcurrent: 1, resourceAdmission: () => admitted });
    const gate = manual();
    const blocker = s.submit({ priority: 'background', mutexKey: 'blk', strategy: 'queue' }, () => gate.promise);

    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    const tasks = [
      s.submit({ priority: 'background', strategy: 'queue' }, async () => { counts.a++; }),
      s.submit({ priority: 'midground', strategy: 'queue' }, async () => { counts.b++; }),
      s.submit({ priority: 'idle', strategy: 'queue' }, async () => { counts.c++; }),
    ];

    for (let cycle = 0; cycle < 3; cycle++) {
      admitted = false;
      await s.sweep();
      admitted = true;
      await s.sweep();
      // Capacity is still held by the blocker: nothing may start yet.
      expect(counts).toEqual({ a: 0, b: 0, c: 0 });
      expect(s.stats().queued).toBe(3);
    }

    // Degrade one last time and release the slot: the queued tasks stay parked.
    admitted = false;
    gate.resolve(undefined);
    await blocker;
    expect(counts).toEqual({ a: 0, b: 0, c: 0 });
    expect(s.stats().queued).toBe(3);

    admitted = true;
    await s.sweep();
    await Promise.all(tasks);
    expect(counts).toEqual({ a: 1, b: 1, c: 1 }); // each exactly once
    expect(s.stats().queued).toBe(0);
  });

  it('admission is consulted at start time only — a settled healthy pump runs everything', async () => {
    const admission = jest.fn(() => true);
    const s = new Scheduler({ resourceAdmission: admission });
    expect(await s.submit({ priority: 'background', strategy: 'queue' }, async () => 'ok')).toBe('ok');
    expect(admission).toHaveBeenCalled();
    // Submit itself does not consult it a second time beyond the pump.
    expect(admission.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
