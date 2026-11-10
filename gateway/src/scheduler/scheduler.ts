// gateway/src/scheduler/scheduler.ts
// Unified priority scheduler for background/pipeline work.
//
// One queue, four priority classes (foreground > midground > background >
// idle), four same-key conflict strategies (skip / coalesce / defer-to-idle /
// queue), budget admission at submit, and a per-execution watchdog.
//
// Node is single-threaded: there is no preemption. Scheduling here means
// (1) ordering of queued tasks by priority, (2) admission control at submit
// (skip/coalesce/budget), and (3) start-time eligibility (mutex keys, idle
// deferral, concurrency cap). Foreground tasks execute immediately and are
// never queued behind lower classes; the concurrency cap does not apply to
// them.
//
// Spec: docs/superpowers/specs/2026-11-09-gateway-kernel-scheduler-design.md

import {
  BudgetExceededError,
  BudgetChecker,
  SchedulerOpts,
  SchedulerStats,
  TaskDescriptor,
  TaskPriority,
  TaskSkippedError,
  TaskTimeoutError,
} from './task-descriptor';

const PRIORITY_RANK: Record<TaskPriority, number> = {
  foreground: 0,
  midground: 1,
  background: 2,
  idle: 3,
};

interface Task {
  descriptor: TaskDescriptor<any>;
  seq: number;
  fn: () => Promise<any>;
  resolve: (v: any) => void;
  reject: (e: unknown) => void;
  /** The caller-facing promise (coalesce joiners share it). */
  promise: Promise<unknown>;
  key?: string;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class Scheduler {
  private readonly maxConcurrent: number;
  private readonly budgetChecker?: BudgetChecker;
  private readonly log: (msg: string) => void;

  private readonly queue: Task[] = [];
  private readonly running = new Set<Task>();
  private readonly held = new Set<string>();
  private foregroundInFlight = 0;
  private runningNonForeground = 0;
  private seq = 0;

  constructor(opts?: SchedulerOpts) {
    // Clamp: maxConcurrent 0 (or negative) would queue every non-foreground
    // task forever with no warning — a silent deadlock for future consumers.
    this.maxConcurrent = Math.max(1, opts?.maxConcurrent ?? 4);
    this.budgetChecker = opts?.budgetChecker;
    this.log = opts?.log ?? (() => {});
  }

  submit<T>(task: TaskDescriptor<T>, fn: () => Promise<T>): Promise<T> {
    const descriptor: TaskDescriptor<T> = { ...task, id: task.id ?? `task_${++this.seq}` };

    // 1. Budget admission — before any queueing; fn must never run.
    if (descriptor.budget && this.budgetChecker) {
      const check = this.budgetChecker(descriptor);
      if (!check.ok) {
        return Promise.reject(new BudgetExceededError(check.reason ?? 'budget check denied'));
      }
    }

    const key = descriptor.mutexKey;

    // 2. Coalesce — join the live (running or earliest queued) same-key task.
    if (key && descriptor.strategy === 'coalesce') {
      const joinable = this.joinableTask(key);
      if (joinable) {
        // ⚠ Same-key different-T is the caller's bug — namespace keys
        // (e.g. `action:memory:decay`, `snapshot`), never reuse bare names.
        return joinable.promise as Promise<T>;
      }
    }

    // 3. Skip — same key already running or queued.
    if (key && descriptor.strategy === 'skip' && this.keyInUse(key)) {
      return Promise.reject(new TaskSkippedError(key));
    }

    // 4. Foreground — immediate execution, unless the key is in use.
    if (descriptor.priority === 'foreground' && (!key || !this.keyInUse(key))) {
      return this.startImmediate(descriptor, fn);
    }

    // 5. Enqueue (also the foreground + held-key path, at rank 0).
    return this.enqueueTask(descriptor, fn);
  }

  /** Pump the queue until nothing eligible. Synchronous; resolves immediately
   *  (running tasks may continue after it returns). */
  async sweep(): Promise<void> {
    this.pump();
  }

  stats(): SchedulerStats {
    const byPriority: Record<TaskPriority, number> = {
      foreground: 0,
      midground: 0,
      background: 0,
      idle: 0,
    };
    for (const t of this.queue) byPriority[t.descriptor.priority]++;
    return { queued: this.queue.length, running: this.running.size, byPriority };
  }

  // ---- internals ----

  private keyInUse(key: string): boolean {
    if (this.held.has(key)) return true;
    return this.queue.some((t) => t.key === key);
  }

  /** Live same-key task to join: running first, else earliest queued. */
  private joinableTask(key: string): Task | undefined {
    for (const t of this.running) if (t.key === key) return t;
    for (const t of this.queue) if (t.key === key) return t;
    return undefined;
  }

  private startImmediate<T>(descriptor: TaskDescriptor<T>, fn: () => Promise<T>): Promise<T> {
    const d = defer<T>();
    const task: Task = {
      descriptor: descriptor as TaskDescriptor<any>,
      seq: ++this.seq,
      fn: fn as () => Promise<any>,
      resolve: d.resolve,
      reject: d.reject,
      promise: d.promise as Promise<unknown>,
      key: descriptor.mutexKey,
      settled: false,
    };
    this.start(task);
    return d.promise;
  }

  private enqueueTask<T>(descriptor: TaskDescriptor<T>, fn: () => Promise<T>): Promise<T> {
    const d = defer<T>();
    this.queue.push({
      descriptor: descriptor as TaskDescriptor<any>,
      seq: ++this.seq,
      fn: fn as () => Promise<any>,
      resolve: d.resolve,
      reject: d.reject,
      promise: d.promise as Promise<unknown>,
      key: descriptor.mutexKey,
      settled: false,
    });
    this.pump();
    return d.promise;
  }

  /** Start queued tasks while capacity and eligibility allow. */
  private pump(): void {
    for (;;) {
      const next = this.pickEligible();
      if (!next) return;
      // Foreground tasks bypass the non-foreground cap; pickEligible ranks
      // them first, so if it returned a non-foreground task no eligible
      // foreground task is waiting.
      if (next.descriptor.priority !== 'foreground' && this.runningNonForeground >= this.maxConcurrent) {
        return;
      }
      this.queue.splice(this.queue.indexOf(next), 1);
      this.start(next);
    }
  }

  /** Best eligible queued task: priority rank first, submission seq second.
   *  Mutex-blocked and idle-deferred tasks are passed over (work-conserving)
   *  but keep their queue position. */
  private pickEligible(): Task | undefined {
    let best: Task | undefined;
    for (const t of this.queue) {
      if (best) {
        const rank = PRIORITY_RANK[t.descriptor.priority] - PRIORITY_RANK[best.descriptor.priority];
        if (rank > 0 || (rank === 0 && t.seq > best.seq)) continue; // worse than best
      }
      if (this.isEligible(t)) best = t;
    }
    return best;
  }

  private isEligible(t: Task): boolean {
    if (t.key && this.held.has(t.key)) return false;
    if (t.descriptor.strategy === 'defer-to-idle' && this.foregroundInFlight > 0) return false;
    return true;
  }

  private start(task: Task): void {
    this.running.add(task);
    if (task.descriptor.priority === 'foreground') this.foregroundInFlight++;
    else this.runningNonForeground++;
    if (task.key) this.held.add(task.key);

    if (task.descriptor.timeoutMs !== undefined) {
      const timer = setTimeout(() => this.onTimeout(task), task.descriptor.timeoutMs);
      timer.unref?.();
      task.timer = timer;
    }

    let fnPromise: Promise<any>;
    try {
      // Promise.resolve wraps non-promise returns (defensive against `as any`
      // callers) without adding a hop for real promises; sync throws still
      // land in the catch below.
      fnPromise = Promise.resolve(task.fn());
    } catch (syncErr) {
      // fn threw synchronously — reject and free the slot (Phase A I1 parity).
      this.settleErr(task, syncErr);
      return;
    }
    fnPromise.then(
      (value) => this.settleOk(task, value),
      (err) => this.settleErr(task, err),
    );
  }

  private onTimeout(task: Task): void {
    if (task.settled) return;
    task.settled = true; // the abandoned fn's eventual settle becomes a no-op
    task.timer = undefined;
    this.free(task);
    task.reject(new TaskTimeoutError(String(task.descriptor.id), task.descriptor.timeoutMs!));
    this.log(`[Scheduler] ${task.descriptor.id} watchdog timeout — run continues in background`);
    this.pump();
  }

  private settleOk(task: Task, value: unknown): void {
    if (task.settled) return;
    task.settled = true;
    this.free(task);
    task.resolve(value);
    this.pump();
  }

  private settleErr(task: Task, err: unknown): void {
    if (task.settled) return;
    task.settled = true;
    this.free(task);
    task.reject(err);
    this.pump();
  }

  private free(task: Task): void {
    if (task.timer) {
      clearTimeout(task.timer);
      task.timer = undefined;
    }
    this.running.delete(task);
    if (task.descriptor.priority === 'foreground') this.foregroundInFlight--;
    else this.runningNonForeground--;
    if (task.key && this.held.has(task.key)) this.held.delete(task.key);
  }
}
