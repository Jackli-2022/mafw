// Per-session worker pool: every active session gets its own extract and
// reflect MemoryWorker (background Observer/Reflector pair). Entries are
// lazily created, TTL-refreshed on access, and disposed on eviction (24h idle
// or hard-cap overflow). runExclusive serializes pipeline work per
// (session, kind) so concurrent triggers (cron + restore + manual) can never
// run the same worker twice at once.
import { TtlMap } from './ttl-map';
import { MemoryWorker, WorkerClient } from './memory-worker';

export type WorkerKind = 'extract' | 'reflect';

interface WorkerPair {
  extract: MemoryWorker;
  reflect: MemoryWorker;
  label: string;
}

export interface SessionWorkerPoolOptions {
  client: WorkerClient;
  directory: string;
  ttlMs: number;
  maxSessions?: number;
  /** Summarize (compact) a worker session after this many ms of idle time. */
  compactIdleMs?: number;
  /** Called whenever an internal worker session is created (used to exclude
   *  internal sessions from observation capture — recursion guard). */
  onSessionCreated?: (sessionId: string) => void;
}

export class SessionWorkerPool {
  private entries: TtlMap<string, WorkerPair>;
  private inflight = new Map<string, Promise<unknown>>();
  private creationOrder: string[] = [];

  constructor(private opts: SessionWorkerPoolOptions) {
    const ttlMs = opts.ttlMs;
    this.entries = new TtlMap<string, WorkerPair>(ttlMs, {
      onEvict: (_key, pair) => {
        void pair.extract.dispose();
        void pair.reflect.dispose();
      },
    });
  }

  private maxSessions(): number {
    return this.opts.maxSessions ?? 64;
  }

  /** Get (or lazily create) the worker for a session. Touches the TTL. */
  getWorker(sessionID: string, kind: WorkerKind): MemoryWorker {
    this.entries.sweep(); // release idle/expired sessions before serving one
    let pair = this.entries.getAndTouch(sessionID, this.opts.ttlMs);
    if (!pair) {
      // Hard cap: evict the oldest entry that is not mid-flight (never kill a
      // worker whose prompt is in progress — that degrades to fallback/retry).
      while (this.entries.size() >= this.maxSessions()) {
        const idx = this.creationOrder.findIndex(
          (id) => id !== sessionID && !this.isRunning(id, 'extract') && !this.isRunning(id, 'reflect'),
        );
        if (idx === -1) break; // everything in flight → accept the overflow
        const oldest = this.creationOrder.splice(idx, 1)[0];
        this.entries.delete(oldest);
      }
      const label = `mem-${sessionID}`;
      pair = {
        extract: new MemoryWorker(this.opts.client, {
          directory: this.opts.directory,
          label: `${label}:extract`,
          compactIdleMs: this.opts.compactIdleMs,
          onSessionCreated: this.opts.onSessionCreated,
        }),
        reflect: new MemoryWorker(this.opts.client, {
          directory: this.opts.directory,
          label: `${label}:reflect`,
          compactIdleMs: this.opts.compactIdleMs,
          onSessionCreated: this.opts.onSessionCreated,
        }),
        label,
      };
      this.entries.set(sessionID, pair, this.opts.ttlMs);
      this.creationOrder.push(sessionID);
    }
    return kind === 'extract' ? pair.extract : pair.reflect;
  }

  /**
   * Serialize work per (session, kind): if a run is already in flight for the
   * same key, the new call awaits the existing one instead of starting a
   * second concurrent run (prevents duplicate extraction / cursor races).
   */
  runExclusive<T>(sessionID: string, kind: WorkerKind, fn: () => Promise<T>): Promise<T> {
    const key = `${sessionID}:${kind}`;
    const prev = this.inflight.get(key);
    if (prev) return prev as Promise<T>;
    const run = fn().finally(() => {
      if (this.inflight.get(key) === run) this.inflight.delete(key);
    });
    this.inflight.set(key, run);
    return run;
  }

  isRunning(sessionID: string, kind: WorkerKind): boolean {
    return this.inflight.has(`${sessionID}:${kind}`);
  }

  size(): number {
    return this.entries.size();
  }

  /** Dispose every worker (gateway stop / restart). */
  disposeAll(): Promise<void> {
    this.entries.clear(); // onEvict disposes pairs
    this.inflight.clear();
    this.creationOrder = [];
    return Promise.resolve();
  }
}
