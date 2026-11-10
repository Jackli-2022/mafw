// Unified scheduler: priority queue + admission strategies + budget gate.
// Spec: docs/superpowers/specs/2026-11-09-gateway-kernel-scheduler-design.md
// Plan: docs/superpowers/plans/2026-11-10-gateway-kernel-scheduler.md (Task 1)
import {
  Scheduler,
  TaskSkippedError,
  TaskTimeoutError,
  BudgetExceededError,
} from '../../../src/scheduler';

/** Manually-resolved promise for deterministic ordering (no fake timers). */
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('Scheduler', () => {
  it('foreground executes immediately and returns the value', async () => {
    const s = new Scheduler();
    const result = await s.submit({ priority: 'foreground', strategy: 'queue' }, async () => 'value');
    expect(result).toBe('value');
    expect(s.stats().running).toBe(0);
  });

  it('foreground + held mutexKey + strategy skip rejects TaskSkippedError', async () => {
    const s = new Scheduler();
    const gate = manual();
    const first = s.submit({ priority: 'background', mutexKey: 'k', strategy: 'queue' }, () => gate.promise);
    await expect(
      s.submit({ priority: 'foreground', mutexKey: 'k', strategy: 'skip' }, async () => 'x'),
    ).rejects.toBeInstanceOf(TaskSkippedError);
    gate.resolve(undefined);
    await first;
  });

  it('foreground queued behind a held key starts when the key frees, even at full capacity', async () => {
    const s = new Scheduler({ maxConcurrent: 1 });
    const gate = manual();
    const holder = s.submit({ priority: 'background', mutexKey: 'k', strategy: 'queue' }, () => gate.promise);
    let fgRan = false;
    const fg = s.submit({ priority: 'foreground', mutexKey: 'k', strategy: 'queue' }, async () => {
      fgRan = true;
    });
    // Pump starts the background holder synchronously; fg is key-blocked.
    expect(fgRan).toBe(false);
    gate.resolve(undefined);
    await holder;
    await fg;
    expect(fgRan).toBe(true);
  });

  it('budget exceeded rejects BudgetExceededError, fn never runs', async () => {
    const s = new Scheduler({ budgetChecker: () => ({ ok: false, reason: 'daily cap' }) });
    let ran = false;
    await expect(
      s.submit(
        { priority: 'background', strategy: 'queue', budget: { kind: 'pipeline', pipeline: 'reflect' } },
        async () => {
          ran = true;
        },
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(ran).toBe(false);
  });

  it('skip on running same key rejects, fn not run', async () => {
    const s = new Scheduler();
    const gate = manual();
    const first = s.submit({ priority: 'background', mutexKey: 'k', strategy: 'queue' }, () => gate.promise);
    let ran = false;
    await expect(
      s.submit({ priority: 'background', mutexKey: 'k', strategy: 'skip' }, async () => {
        ran = true;
      }),
    ).rejects.toBeInstanceOf(TaskSkippedError);
    expect(ran).toBe(false);
    gate.resolve(undefined);
    await first;
  });

  it('skip on queued same key (cap-blocked, not running) rejects', async () => {
    const s = new Scheduler({ maxConcurrent: 1 });
    const gate = manual();
    const blocker = s.submit({ priority: 'background', mutexKey: 'other', strategy: 'queue' }, () => gate.promise);
    const queued = s.submit({ priority: 'background', mutexKey: 'k', strategy: 'queue' }, async () => 'a');
    await expect(
      s.submit({ priority: 'background', mutexKey: 'k', strategy: 'skip' }, async () => 'b'),
    ).rejects.toBeInstanceOf(TaskSkippedError);
    gate.resolve(undefined);
    await blocker;
    expect(await queued).toBe('a');
  });

  it('coalesce joins in-flight run: fn called once, both callers share the result', async () => {
    const s = new Scheduler();
    let calls = 0;
    const gate = manual<number>();
    const first = s.submit({ priority: 'background', mutexKey: 'k', strategy: 'coalesce' }, () => {
      calls++;
      return gate.promise;
    });
    const second = s.submit({ priority: 'background', mutexKey: 'k', strategy: 'coalesce' }, async () => {
      calls++;
      return 99;
    });
    gate.resolve(42);
    expect(await first).toBe(42);
    expect(await second).toBe(42); // joined — fn not called again
    expect(calls).toBe(1);
  });

  it('coalesce joins a queued run (cap-blocked): fn called once', async () => {
    const s = new Scheduler({ maxConcurrent: 1 });
    const gate = manual();
    const blocker = s.submit({ priority: 'background', mutexKey: 'blocker', strategy: 'queue' }, () => gate.promise);
    let calls = 0;
    const first = s.submit({ priority: 'background', mutexKey: 'k', strategy: 'coalesce' }, async () => {
      calls++;
      return 'v';
    });
    const second = s.submit({ priority: 'background', mutexKey: 'k', strategy: 'coalesce' }, async () => {
      calls++;
      return 'w';
    });
    gate.resolve(undefined);
    await blocker;
    expect(await first).toBe('v');
    expect(await second).toBe('v');
    expect(calls).toBe(1);
  });

  it('coalesce after completion starts a NEW run (no stale join)', async () => {
    const s = new Scheduler();
    let calls = 0;
    const mk = () =>
      s.submit({ priority: 'background', mutexKey: 'k', strategy: 'coalesce' }, async () => {
        calls++;
        return calls;
      });
    expect(await mk()).toBe(1);
    expect(await mk()).toBe(2);
    expect(calls).toBe(2);
  });

  it('queue strategy: same-key tasks run FIFO', async () => {
    const s = new Scheduler();
    const order: string[] = [];
    const a = s.submit({ priority: 'background', mutexKey: 'k', strategy: 'queue' }, async () => {
      order.push('a');
    });
    const b = s.submit({ priority: 'background', mutexKey: 'k', strategy: 'queue' }, async () => {
      order.push('b');
    });
    const c = s.submit({ priority: 'background', mutexKey: 'k', strategy: 'queue' }, async () => {
      order.push('c');
    });
    await Promise.all([a, b, c]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('defer-to-idle waits for foreground drain, then runs', async () => {
    const s = new Scheduler();
    const gate = manual();
    const fg = s.submit({ priority: 'foreground', strategy: 'queue' }, () => gate.promise);
    let started = false;
    const d = s.submit({ priority: 'midground', mutexKey: 'snap', strategy: 'defer-to-idle' }, async () => {
      started = true;
    });
    // Pump runs synchronously on submit — if defer-to-idle were ignored, fn
    // would already be running here.
    expect(started).toBe(false);
    gate.resolve(undefined);
    await fg;
    await d;
    expect(started).toBe(true);
  });

  it('defer-to-idle with no foreground in flight runs like queue', async () => {
    const s = new Scheduler();
    let ran = false;
    await s.submit({ priority: 'midground', mutexKey: 'k', strategy: 'defer-to-idle' }, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('priority order: midground before background before idle', async () => {
    const s = new Scheduler({ maxConcurrent: 1 });
    const gate = manual();
    const blocker = s.submit({ priority: 'background', mutexKey: 'blk', strategy: 'queue' }, () => gate.promise);
    const completion: string[] = [];
    const bg = s.submit({ priority: 'background', strategy: 'queue' }, async () => {
      completion.push('bg');
    });
    const mid = s.submit({ priority: 'midground', strategy: 'queue' }, async () => {
      completion.push('mid');
    });
    const idle = s.submit({ priority: 'idle', strategy: 'queue' }, async () => {
      completion.push('idle');
    });
    gate.resolve(undefined);
    await blocker;
    await bg;
    await mid;
    await idle;
    expect(completion).toEqual(['mid', 'bg', 'idle']);
  });

  it('maxConcurrent caps concurrent non-foreground tasks', async () => {
    const s = new Scheduler({ maxConcurrent: 2 });
    const gates = [manual(), manual(), manual(), manual(), manual()];
    let active = 0;
    const levels: number[] = [];
    const tasks = gates.map((g) =>
      s.submit({ priority: 'background', strategy: 'queue' }, () => {
        active++;
        levels.push(active);
        return g.promise.then(() => {
          active--;
        });
      }),
    );
    expect(s.stats().running).toBe(2);
    expect(s.stats().queued).toBe(3);
    gates[0].resolve(undefined);
    gates[1].resolve(undefined);
    gates[2].resolve(undefined);
    gates[3].resolve(undefined);
    gates[4].resolve(undefined);
    await Promise.all(tasks);
    expect(Math.max(...levels)).toBe(2);
  });

  it('mutex-blocked task passes over; different-key task proceeds', async () => {
    const s = new Scheduler({ maxConcurrent: 2 });
    const gate = manual();
    const first = s.submit({ priority: 'background', mutexKey: 'k', strategy: 'queue' }, () => gate.promise);
    const second = s.submit({ priority: 'background', mutexKey: 'k', strategy: 'queue' }, async () => 'second');
    let thirdRan = false;
    const third = s.submit({ priority: 'background', mutexKey: 'other', strategy: 'queue' }, async () => {
      thirdRan = true;
      return 'third';
    });
    // second is queued ahead of third but mutex-blocked; third starts anyway.
    expect(thirdRan).toBe(true);
    expect(s.stats().queued).toBe(1);
    gate.resolve(undefined);
    await first;
    await third;
    expect(await second).toBe('second');
  });

  it('timeout: rejects TaskTimeoutError, key freed, late completion is a no-op', async () => {
    const s = new Scheduler();
    const gate = manual<string>();
    const first = s.submit(
      { priority: 'background', mutexKey: 'k', strategy: 'queue', timeoutMs: 30 },
      () => gate.promise,
    );
    await expect(first).rejects.toBeInstanceOf(TaskTimeoutError);
    // Key freed: next same-key task starts immediately.
    const second = s.submit({ priority: 'background', mutexKey: 'k', strategy: 'queue' }, async () => 'ok');
    expect(await second).toBe('ok');
    // Late completion of the abandoned fn must not throw or corrupt state.
    gate.resolve('late');
    await sleep(10);
    expect(s.stats().running).toBe(0);
  });

  it('timeout measures execution, not queue wait', async () => {
    const s = new Scheduler({ maxConcurrent: 1 });
    const gate = manual();
    const blocker = s.submit({ priority: 'background', mutexKey: 'blk', strategy: 'queue' }, () => gate.promise);
    let startedAt = 0;
    const slow = s.submit(
      { priority: 'background', mutexKey: 'slow', strategy: 'queue', timeoutMs: 40 },
      () =>
        new Promise<void>((resolve) => {
          startedAt = Date.now();
          setTimeout(resolve, 25); // finishes within 40ms of EXECUTION
        }),
    );
    // Blocker holds the only slot past slow's timeoutMs — slow is still queued.
    await sleep(50);
    gate.resolve(undefined);
    await blocker;
    // If the watchdog had started at submit time, slow would have timed out
    // while waiting; with execution-time semantics it gets its full window.
    await expect(slow).resolves.toBeUndefined();
    expect(startedAt).toBeGreaterThan(0);
  });

  it('sync-throw in fn: rejects, key freed, next same-key task runs', async () => {
    const s = new Scheduler();
    const syncThrow = () => {
      throw new Error('sync boom');
    };
    await expect(
      s.submit({ priority: 'background', mutexKey: 'k', strategy: 'queue' }, syncThrow as unknown as () => Promise<void>),
    ).rejects.toThrow('sync boom');
    const next = s.submit({ priority: 'background', mutexKey: 'k', strategy: 'queue' }, async () => 'recovered');
    expect(await next).toBe('recovered');
    expect(s.stats().running).toBe(0);
  });

  it('async rejection: later queued tasks still run (pump survives)', async () => {
    const s = new Scheduler({ maxConcurrent: 1 });
    const fail = s.submit({ priority: 'background', strategy: 'queue' }, async () => {
      throw new Error('boom');
    });
    const after = s.submit({ priority: 'background', strategy: 'queue' }, async () => 'after');
    await expect(fail).rejects.toThrow('boom');
    expect(await after).toBe('after');
  });

  it('stats(): queued/running/byPriority with all four keys', async () => {
    const s = new Scheduler({ maxConcurrent: 1 });
    const gate = manual();
    const tasks = [
      s.submit({ priority: 'background', strategy: 'queue' }, () => gate.promise),
      s.submit({ priority: 'background', strategy: 'queue' }, async () => {}),
      s.submit({ priority: 'background', strategy: 'queue' }, async () => {}),
      s.submit({ priority: 'background', strategy: 'queue' }, async () => {}),
    ];
    expect(s.stats()).toEqual({
      queued: 3,
      running: 1,
      byPriority: { foreground: 0, midground: 0, background: 3, idle: 0 },
    });
    gate.resolve(undefined);
    await Promise.all(tasks);
  });

  it('sweep() resolves and leaves no eligible-but-unstarted tasks', async () => {
    const s = new Scheduler({ maxConcurrent: 2 });
    const gates = [manual(), manual(), manual()];
    const tasks = gates.map((g) => s.submit({ priority: 'background', strategy: 'queue' }, () => g.promise));
    expect(s.stats().queued).toBe(1); // 2 running, 1 queued (cap)
    gates[0].resolve(undefined);
    await tasks[0];
    await s.sweep();
    expect(s.stats().running).toBe(2); // queued task auto-started on settle
    gates[1].resolve(undefined);
    gates[2].resolve(undefined);
    await Promise.all(tasks);
    expect(s.stats().queued).toBe(0);
  });
});
