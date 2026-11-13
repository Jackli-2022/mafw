/**
 * E4 batch6 review — admission seam integration.
 *
 * 真实 `Scheduler` + `createResourceBudgetChecker` + stub governor：
 * 钉住「降级时无 budget 的后台任务也被拒绝、恢复后自动放行、前台永不拒绝」。
 * （batch 6 原缺陷：pressure checker 挂在 budgetChecker 上，而 budgetChecker
 *  只对带 budget 的 descriptor 生效 → 无 budget 的后台任务逃过压力门。）
 */
import { Scheduler } from '../../../src/scheduler';
import { BudgetExceededError } from '../../../src/scheduler';
import { createResourceBudgetChecker, shouldResumeScheduler } from '../../../src/resources/degradation';
import type { DegradedCode, Pressure } from '../../../src/resources/governor';

function harness() {
  let degraded = false;
  const governor = { isDegraded: () => degraded };
  const scheduler = new Scheduler({
    admissionChecker: (task) => createResourceBudgetChecker(() => governor, () => ({ ok: true }))(task),
  });
  return {
    scheduler,
    setDegraded(value: boolean) {
      degraded = value;
    },
  };
}

describe('pressure admission integration (real Scheduler)', () => {
  it('rejects a budgetless background task while degraded, accepts it after recovery', async () => {
    const { scheduler, setDegraded } = harness();
    let ran = 0;

    setDegraded(true);
    await expect(
      scheduler.submit({ priority: 'background', strategy: 'queue' }, async () => {
        ran++;
      }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(ran).toBe(0);

    setDegraded(false);
    await expect(
      scheduler.submit({ priority: 'background', strategy: 'queue' }, async () => {
        ran++;
        return 'recovered';
      }),
    ).resolves.toBe('recovered');
    expect(ran).toBe(1);
  });

  it.each(['midground', 'idle'] as const)('%s is also rejected while degraded', async (priority) => {
    const { scheduler, setDegraded } = harness();
    setDegraded(true);
    await expect(
      scheduler.submit({ priority, strategy: 'queue' }, async () => 'x'),
    ).rejects.toThrow('resource pressure');
  });

  it('foreground is always accepted (degraded and healthy)', async () => {
    const { scheduler, setDegraded } = harness();
    setDegraded(true);
    await expect(scheduler.submit({ priority: 'foreground', strategy: 'queue' }, async () => 'fg')).resolves.toBe('fg');
    setDegraded(false);
    await expect(scheduler.submit({ priority: 'foreground', strategy: 'queue' }, async () => 'fg2')).resolves.toBe('fg2');
  });

  it('a pipeline-budgeted task denied by pressure never reaches the pipeline checker', async () => {
    let degraded = true;
    const budgetCalls: string[] = [];
    const scheduler = new Scheduler({
      admissionChecker: (task) => createResourceBudgetChecker(() => ({ isDegraded: () => degraded }), () => ({ ok: true }))(task),
      budgetChecker: () => {
        budgetCalls.push('budget');
        return { ok: false, reason: 'daily cap' };
      },
    });
    await expect(
      scheduler.submit(
        { priority: 'background', strategy: 'queue', budget: { kind: 'pipeline', pipeline: 'reflect' } },
        async () => 'x',
      ),
    ).rejects.toThrow('resource pressure');
    expect(budgetCalls).toEqual([]);

    degraded = false;
    await expect(
      scheduler.submit(
        { priority: 'background', strategy: 'queue', budget: { kind: 'pipeline', pipeline: 'reflect' } },
        async () => 'x',
      ),
    ).rejects.toThrow('daily cap');
    expect(budgetCalls).toEqual(['budget']);
  });
});

// E11-3: a task queued while healthy must not start after the box degraded, and
// must come back automatically when the governor recovers (kernel wires the
// edge to `scheduler.sweep()`; the edge predicate lives in degradation.ts).
describe('governor recovery edge (E11-3)', () => {
  const pressure = (degraded: DegradedCode[]): Pressure => ({ disk: 'ok', heap: 'ok', degraded });

  it.each<[string, DegradedCode[], DegradedCode[], boolean]>([
    ['healthy → healthy', [], [], false],
    ['healthy → degraded', [], ['disk_critical'], false],
    ['degraded → degraded (code change)', ['disk_critical'], ['heap_critical'], false],
    ['degraded → healthy', ['disk_critical'], [], true],
    ['degraded → healthy (two codes)', ['disk_critical', 'heap_critical'], [], true],
  ])('%s', (_name, prev, next, expected) => {
    expect(shouldResumeScheduler(pressure(prev), pressure(next))).toBe(expected);
  });

  it('parks a queued task on the degrade edge and resumes it exactly once on recovery', async () => {
    let degraded = false;
    const listeners = new Set<(prev: Pressure, next: Pressure) => void>();
    const governor = {
      isDegraded: () => degraded,
      onChange(listener: (prev: Pressure, next: Pressure) => void) {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    };
    const scheduler = new Scheduler({
      maxConcurrent: 1,
      resourceAdmission: () => !governor.isDegraded(),
    });
    // Mirror of kernel.ts governor onChange (E11-3).
    governor.onChange((prev, next) => {
      if (shouldResumeScheduler(prev, next)) void scheduler.sweep();
    });
    const emit = (next: boolean) => {
      const prev: Pressure = pressure(degraded ? ['disk_critical'] : []);
      degraded = next;
      const snapshot = pressure(degraded ? ['disk_critical'] : []);
      for (const listener of listeners) listener(prev, snapshot);
    };

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const blocker = scheduler.submit({ priority: 'background', mutexKey: 'blk', strategy: 'queue' }, () => gate);
    const runs: string[] = [];
    const queued = scheduler.submit({ priority: 'background', strategy: 'queue' }, async () => {
      runs.push('queued');
    });

    emit(true); // degrade: no recovery edge, no sweep
    release();
    await blocker;
    expect(runs).toEqual([]); // parked by start-time admission
    expect(scheduler.stats().queued).toBe(1);

    emit(false); // recovery: edge → sweep
    expect(runs).toEqual(['queued']);
    await queued;
    expect(runs).toEqual(['queued']);
  });
});
