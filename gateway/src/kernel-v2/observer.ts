/**
 * Read-only canonical event observers (kernel-v2 Phase 3, S5 probe).
 *
 * Observer contract:
 * - post-hoc, read-only, fail-open
 * - `dispatch()` only filters + enqueues; it never waits for a handler
 * - per-observer timeout and error isolation
 * - bounded queue; overflow drops the newest and is counted
 *
 * This is not an interceptor: observers cannot veto or rewrite canonical
 * events. A handler that blocks the event loop synchronously cannot be
 * preempted here; Phase 6 moves untrusted observers into a worker.
 */

export interface CanonicalEvent {
  type: string;
  sessionID?: string;
  projectId?: string;
  at: number;
  properties?: Record<string, unknown>;
}

export interface ObserverFilter {
  sessionID?: string;
  projectId?: string;
  /** Exact type or trailing `*` prefix match (e.g. "tool.*"). */
  types?: string[];
}

export interface CanonicalObserver {
  id: string;
  filter?: ObserverFilter;
  onEvent(event: CanonicalEvent): void | Promise<void>;
  timeoutMs?: number;
  dispose?(): void | Promise<void>;
}

export interface ObserverDiagnostic {
  observerId: string;
  delivered: number;
  failed: number;
  timedOut: number;
  lastError?: string;
}

export interface ObserverRegistryOptions {
  defaultTimeoutMs?: number;
  /** Max queued (observer, event) pairs; overflow drops the newest. */
  maxQueue?: number;
  onError?: (info: {
    observerId: string;
    error: string;
    kind: 'throw' | 'timeout' | 'overflow';
  }) => void;
}

interface QueuedDelivery {
  observer: CanonicalObserver;
  event: CanonicalEvent;
}

class ObserverTimeoutError extends Error {
  constructor(ms: number) {
    super(`observer timed out after ${ms}ms`);
    this.name = 'ObserverTimeoutError';
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function matchesFilter(filter: ObserverFilter | undefined, event: CanonicalEvent): boolean {
  if (!filter) return true;
  if (filter.sessionID !== undefined && filter.sessionID !== event.sessionID) return false;
  if (filter.projectId !== undefined && filter.projectId !== event.projectId) return false;
  if (filter.types?.length) {
    const matched = filter.types.some((pattern) =>
      pattern.endsWith('*')
        ? event.type.startsWith(pattern.slice(0, -1))
        : event.type === pattern,
    );
    if (!matched) return false;
  }
  return true;
}

export class CanonicalObserverRegistry {
  private readonly observers = new Map<string, CanonicalObserver>();
  private readonly diagnosticsById = new Map<string, ObserverDiagnostic>();
  private readonly defaultTimeoutMs: number;
  private readonly maxQueue: number;
  private readonly onError?: ObserverRegistryOptions['onError'];
  private queue: QueuedDelivery[] = [];
  private inFlight = 0;
  private scheduled = false;
  private disposed = false;
  private droppedCount = 0;
  private drainWaiters: Array<() => void> = [];

  constructor(options: ObserverRegistryOptions = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 1_000;
    this.maxQueue = options.maxQueue ?? 1_000;
    this.onError = options.onError;
  }

  get size(): number {
    return this.observers.size;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  register(observer: CanonicalObserver): () => void {
    this.assertOpen();
    if (this.observers.has(observer.id)) {
      throw new Error(`observer already registered: ${observer.id}`);
    }
    this.observers.set(observer.id, observer);
    this.diagnosticsById.set(observer.id, {
      observerId: observer.id,
      delivered: 0,
      failed: 0,
      timedOut: 0,
    });
    return () => {
      if (this.observers.get(observer.id) !== observer) return;
      this.observers.delete(observer.id);
      this.diagnosticsById.delete(observer.id);
    };
  }

  /** Filters + enqueues synchronously; handler execution is scheduled. */
  dispatch(event: CanonicalEvent): void {
    if (this.disposed) return;
    for (const observer of this.observers.values()) {
      if (!matchesFilter(observer.filter, event)) continue;
      if (this.queue.length >= this.maxQueue) {
        this.droppedCount += 1;
        this.report(observer.id, 'queue overflow', 'overflow');
        continue;
      }
      this.queue.push({ observer, event });
    }
    this.schedule();
  }

  async drain(): Promise<void> {
    if (this.disposed) return;
    if (this.queue.length === 0 && this.inFlight === 0) return;
    await new Promise<void>((resolve) => {
      this.drainWaiters.push(resolve);
    });
  }

  diagnostics(): ObserverDiagnostic[] {
    return [...this.diagnosticsById.values()].map((item) => ({ ...item }));
  }

  dropped(): number {
    return this.droppedCount;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.queue = [];
    const observers = [...this.observers.values()].reverse();
    this.observers.clear();
    this.diagnosticsById.clear();
    for (const observer of observers) {
      try {
        await observer.dispose?.();
      } catch {
        /* observer teardown is fail-open */
      }
    }
    this.resolveDrainWaiters();
  }

  private schedule(): void {
    if (this.disposed || this.scheduled || this.queue.length === 0) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      void this.flush();
    });
  }

  private async flush(): Promise<void> {
    const batch = this.queue.splice(0);
    await Promise.all(batch.map((item) => this.runOne(item)));
    if (this.queue.length > 0) this.schedule();
    else this.resolveDrainWaiters();
  }

  private async runOne(item: QueuedDelivery): Promise<void> {
    const diagnostic = this.diagnosticsById.get(item.observer.id);
    if (!diagnostic) return;

    const timeoutMs = item.observer.timeoutMs ?? this.defaultTimeoutMs;
    this.inFlight += 1;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ObserverTimeoutError(timeoutMs)), timeoutMs);
      });
      await Promise.race([Promise.resolve(item.observer.onEvent(item.event)), timeout]);
      diagnostic.delivered += 1;
    } catch (error) {
      const timedOut = error instanceof ObserverTimeoutError;
      if (timedOut) diagnostic.timedOut += 1;
      else diagnostic.failed += 1;
      diagnostic.lastError = messageOf(error);
      this.report(item.observer.id, messageOf(error), timedOut ? 'timeout' : 'throw');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.inFlight -= 1;
      if (this.queue.length === 0 && this.inFlight === 0) this.resolveDrainWaiters();
    }
  }

  private report(
    observerId: string,
    error: string,
    kind: 'throw' | 'timeout' | 'overflow',
  ): void {
    try {
      this.onError?.({ observerId, error, kind });
    } catch {
      /* diagnostics callback is fail-open */
    }
  }

  private resolveDrainWaiters(): void {
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('observer registry is disposed');
  }
}
