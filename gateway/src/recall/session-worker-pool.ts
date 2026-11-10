// Per-session worker pool: every active session gets its own extract and
// reflect MemoryWorker (background Observer/Reflector pair). Entries are
// lazily created, TTL-refreshed on access, and disposed on eviction (24h idle
// or hard-cap overflow). runExclusive serializes pipeline work per
// (session, kind) so concurrent triggers (cron + restore + manual) can never
// run the same worker twice at once.
//
// Kernel refactor Phase C (Task 4, revised): the pair cache stays on TtlMap —
// it is keyed by the SOURCE session (a user session, never labeled
// kind 'worker'). The WORKER sessions themselves register as session-registry
// records at creation (role + origin + TTL), refresh with their pair, and
// unregister at pair eviction / overflow / disposeAll.
import { TtlMap } from './ttl-map';
import { Singleflight } from '../concurrency';
import { MemoryWorker, WorkerClient } from './memory-worker';
import { registerWorkerOrigin } from './worker-origin';
import { SessionRegistry, getDefaultSessionRegistry } from '../session';

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
  /** Hard ceiling per worker prompt (extract/reflect). Default 120s. */
  promptTimeoutMs?: number;
  /** Called whenever an internal worker session is created (used to exclude
   *  internal sessions from observation capture — recursion guard). The role
   *  parameter is the worker kind ('extract' | 'reflect'). */
  onSessionCreated?: (sessionId: string, role: string) => void;
  /** Session registry for worker-session records (Phase C). Defaults to the
   *  shared gateway registry; tests pass isolated instances. */
  registry?: SessionRegistry;
}

export class SessionWorkerPool {
  private entries: TtlMap<string, WorkerPair>;
  private flight = new Singleflight();
  private creationOrder: string[] = [];
  private registry: SessionRegistry;
  /** source session → its worker-session ids. byScope cannot be used for
   *  cleanup: worker records share the pair's TTL, so at eviction time they
   *  are usually already expired — invisible to byScope's active-only view. */
  private workerSids = new Map<string, string[]>();

  constructor(private opts: SessionWorkerPoolOptions) {
    const ttlMs = opts.ttlMs;
    this.registry = opts.registry ?? getDefaultSessionRegistry();
    this.entries = new TtlMap<string, WorkerPair>(ttlMs, {
      onEvict: (key: unknown, pair: WorkerPair) => {
        void pair.extract.dispose();
        void pair.reflect.dispose();
        // The pair's worker sessions die with it — drop their records too.
        this.unregisterWorkersFor(String(key));
      },
    });
  }

  private maxSessions(): number {
    return this.opts.maxSessions ?? 64;
  }

  /** Unregister the session-registry records of a source session's workers. */
  private unregisterWorkersFor(sourceSessionID: string): void {
    const sids = this.workerSids.get(sourceSessionID);
    if (!sids) return;
    this.workerSids.delete(sourceSessionID);
    for (const sid of sids) {
      this.registry.unregister(sid); // works regardless of expiry
    }
  }

  /** Touch the session-registry records of a source session's workers. */
  private touchWorkersFor(sourceSessionID: string): void {
    const sids = this.workerSids.get(sourceSessionID);
    if (!sids) return;
    for (const sid of sids) {
      this.registry.touch(sid);
    }
  }

  /** Get (or lazily create) the worker for a session. Touches the TTL. */
  getWorker(sessionID: string, kind: WorkerKind): MemoryWorker {
    this.entries.sweep(); // release idle/expired sessions before serving one
    let pair = this.entries.getAndTouch(sessionID, this.opts.ttlMs);
    if (pair) {
      this.touchWorkersFor(sessionID); // worker records refresh with the pair
    } else {
      // Hard cap: evict the oldest entry that is not mid-flight (never kill a
      // worker whose prompt is in progress — that degrades to fallback/retry).
      while (this.entries.size() >= this.maxSessions()) {
        const idx = this.creationOrder.findIndex(
          (id) => id !== sessionID && !this.isRunning(id, 'extract') && !this.isRunning(id, 'reflect'),
        );
        if (idx === -1) break; // everything in flight → accept the overflow
        const oldest = this.creationOrder.splice(idx, 1)[0];
        this.entries.delete(oldest); // fires onEvict → disposes + unregisters workers
      }
      const label = `mem-${sessionID}`;
      pair = {
        extract: new MemoryWorker(this.opts.client, {
          directory: this.opts.directory,
          label: `${label}:extract`,
          compactIdleMs: this.opts.compactIdleMs,
          promptTimeoutMs: this.opts.promptTimeoutMs,
          onSessionCreated: (sid) => {
            this.registerWorkerSession(sid, sessionID, 'extract', label);
            this.opts.onSessionCreated?.(sid, 'extract');
          },
        }),
        reflect: new MemoryWorker(this.opts.client, {
          directory: this.opts.directory,
          label: `${label}:reflect`,
          compactIdleMs: this.opts.compactIdleMs,
          promptTimeoutMs: this.opts.promptTimeoutMs,
          onSessionCreated: (sid) => {
            this.registerWorkerSession(sid, sessionID, 'reflect', label);
            this.opts.onSessionCreated?.(sid, 'reflect');
          },
        }),
        label,
      };
      this.entries.set(sessionID, pair, this.opts.ttlMs);
      this.creationOrder.push(sessionID);
    }
    return kind === 'extract' ? pair.extract : pair.reflect;
  }

  /** Register a worker session in the process table; the origin overlay
   *  (registerWorkerOrigin) patches the same record when it already exists. */
  private registerWorkerSession(workerSid: string, sourceSessionID: string, kind: WorkerKind, label: string): void {
    const sids = this.workerSids.get(sourceSessionID);
    if (sids) {
      if (!sids.includes(workerSid)) sids.push(workerSid);
    } else {
      this.workerSids.set(sourceSessionID, [workerSid]);
    }
    const existing = this.registry.lookup(workerSid);
    if (existing) {
      registerWorkerOrigin(workerSid, sourceSessionID); // patch in place
      return;
    }
    this.registry.register({
      sessionID: workerSid,
      scope: { kind: 'worker', role: kind },
      metadata: { originSessionID: sourceSessionID, label },
      ttlMs: this.opts.ttlMs,
    });
  }

  /**
   * Serialize work per (session, kind): if a run is already in flight for the
   * same key, the new call awaits the existing one instead of starting a
   * second concurrent run (prevents duplicate extraction / cursor races).
   */
  runExclusive<T>(sessionID: string, kind: WorkerKind, fn: () => Promise<T>): Promise<T> {
    return this.flight.run(`${sessionID}:${kind}`, fn);
  }

  isRunning(sessionID: string, kind: WorkerKind): boolean {
    return this.flight.has(`${sessionID}:${kind}`);
  }

  size(): number {
    return this.entries.size();
  }

  /** Dispose every worker (gateway stop / restart). */
  disposeAll(): Promise<void> {
    const sources = [...this.creationOrder];
    this.entries.clear(); // onEvict disposes pairs + unregisters workers
    // TtlMap.clear may or may not fire onEvict for every entry — be explicit.
    for (const source of sources) this.unregisterWorkersFor(source);
    this.workerSids.clear();
    this.flight.clear();
    this.creationOrder = [];
    return Promise.resolve();
  }
}

