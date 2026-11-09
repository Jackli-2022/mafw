// gateway/src/concurrency/guard.ts
// Same-key mutual exclusion with configurable conflict strategy (skip/queue)
// and optional timeout that force-releases the lock.

export class GuardTimeoutError extends Error {
  readonly code = 'guard_timeout';
  constructor(key: string, timeoutMs: number) {
    super(`guard timeout for key "${key}" after ${timeoutMs}ms`);
    this.name = 'GuardTimeoutError';
  }
}

export interface GuardOpts {
  /** How to handle a call when the key is already held. Default 'skip'. */
  onConflict?: 'skip' | 'queue';
  /** Force-release the lock after this duration (ms). */
  timeoutMs?: number;
  /** What to do on timeout. 'release' frees the lock; 'error' also rejects. Default 'release'. */
  onTimeout?: 'release' | 'error';
}

interface Waiter {
  fn: () => Promise<unknown>;
  timeoutMs?: number;
  onTimeout: 'release' | 'error';
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export class Guard {
  private readonly held = new Set<string>();
  private readonly tokens = new Map<string, symbol>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly waiters = new Map<string, Waiter[]>();

  run<T>(key: string, fn: () => Promise<T>, opts?: GuardOpts): Promise<T | null> {
    const onConflict = opts?.onConflict ?? 'skip';
    const timeoutMs = opts?.timeoutMs;
    const onTimeout = opts?.onTimeout ?? 'release';

    if (this.held.has(key)) {
      if (onConflict === 'skip') return Promise.resolve(null);
      return new Promise<T | null>((resolve, reject) => {
        const waiter: Waiter = {
          fn: fn as () => Promise<unknown>,
          timeoutMs,
          onTimeout,
          resolve: resolve as (v: unknown) => void,
          reject: reject as (e: unknown) => void,
        };
        const q = this.waiters.get(key);
        if (q) q.push(waiter);
        else this.waiters.set(key, [waiter]);
      });
    }

    return this.execute(key, fn, timeoutMs, onTimeout);
  }

  isHeld(key: string): boolean {
    return this.held.has(key);
  }

  get heldKeys(): string[] {
    return [...this.held];
  }

  get size(): number {
    return this.held.size;
  }

  private execute<T>(
    key: string,
    fn: () => Promise<T>,
    timeoutMs: number | undefined,
    onTimeout: 'release' | 'error',
  ): Promise<T | null> {
    const token = Symbol();
    this.held.add(key);
    this.tokens.set(key, token);

    return new Promise<T | null>((resolve, reject) => {
      let settled = false;

      if (timeoutMs !== undefined) {
        const timer = setTimeout(() => {
          if (settled) return;
          this.forceRelease(key, token);
          if (onTimeout === 'error') {
            settled = true;
            reject(new GuardTimeoutError(key, timeoutMs));
          }
          // 'release': lock is freed; fn continues in background.
          // When fn eventually settles, settled is still false so we
          // resolve/reject the caller's promise, but releaseIfCurrent
          // is a no-op because the token no longer matches.
        }, timeoutMs);
        if (timer.unref) timer.unref();
        this.timers.set(key, timer);
      }

      fn().then(
        (value) => {
          if (settled) return;
          settled = true;
          this.releaseIfCurrent(key, token);
          resolve(value);
        },
        (err) => {
          if (settled) return;
          settled = true;
          this.releaseIfCurrent(key, token);
          reject(err);
        },
      );
    });
  }

  private forceRelease(key: string, token: symbol): void {
    if (this.tokens.get(key) !== token) return;
    this.held.delete(key);
    this.tokens.delete(key);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    this.dequeue(key);
  }

  private releaseIfCurrent(key: string, token: symbol): void {
    if (this.tokens.get(key) !== token) return;
    this.held.delete(key);
    this.tokens.delete(key);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    this.dequeue(key);
  }

  private dequeue(key: string): void {
    const q = this.waiters.get(key);
    if (q && q.length > 0) {
      const next = q.shift()!;
      if (q.length === 0) this.waiters.delete(key);
      const result = this.execute(key, next.fn as () => Promise<unknown>, next.timeoutMs, next.onTimeout);
      result.then(next.resolve, next.reject);
    }
  }
}
