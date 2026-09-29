// A3: retrieval event stream — ACT-R "use it or lose it" wiring.
// In-memory ring buffer collected at production retrieval exits (recall
// route, snapshot serve, search MCP tool); settled in batches by the daily
// memory:decay pass (retrieval-bonus.ts). The need index (7-day hit counts)
// survives drain and feeds interleaved replay sampling (B1) — the same event
// stream is the shared infrastructure for A1 review scheduling and B4 reward
// modulation (see docs/research/2026-09-29-memory-gap-abc-survey.md §4).
//
// Fail-open by contract: no method may throw — collection must never
// obstruct the 100ms boundary recall path.
import { log } from '../utils/logger';

export interface RetrievalEvent {
  id: string;
  /** reranker top1-style probability when known (0..1); used as bonus weight. */
  prob: number;
  kind: 'recall' | 'search';
  ts: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export class RetrievalEventBuffer {
  private events: RetrievalEvent[] = [];
  private maxEvents: number;
  /** id -> { hits, lastTs } within the trailing week (survives drain). */
  private need = new Map<string, { hits: number; lastTs: number }>();

  constructor(maxEvents = 5000) {
    this.maxEvents = maxEvents;
  }

  record(e: RetrievalEvent): void {
    try {
      if (!e || typeof e.id !== 'string' || !e.id) return;
      this.events.push({
        id: e.id,
        prob: Number.isFinite(e.prob) ? e.prob : 1,
        kind: e.kind === 'search' ? 'search' : 'recall',
        ts: Number.isFinite(e.ts) ? e.ts : Date.now(),
      });
      if (this.events.length > this.maxEvents) {
        this.events.splice(0, this.events.length - this.maxEvents);
      }
      const n = this.need.get(e.id) ?? { hits: 0, lastTs: 0 };
      n.hits += 1;
      n.lastTs = e.ts;
      this.need.set(e.id, n);
    } catch (err: any) {
      log.warn?.(`[RetrievalEvents] record failed: ${err?.message || err}`);
    }
  }

  /** Returns and clears the pending event batch (consumed by the daily pass). */
  drain(): RetrievalEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Hits within the trailing 7 days (replay "need" signal). Prunes lazily. */
  needFor(id: string): number {
    const now = Date.now();
    let total = 0;
    for (const [key, n] of this.need) {
      if (now - n.lastTs > WEEK_MS) this.need.delete(key);
      else if (key === id) total = n.hits;
    }
    return total;
  }

  clear(): void {
    this.events = [];
    this.need.clear();
  }
}

let singleton: RetrievalEventBuffer | null = null;
export function getRetrievalEventBuffer(): RetrievalEventBuffer {
  if (!singleton) singleton = new RetrievalEventBuffer();
  return singleton;
}

/** Test seam: inject a dedicated buffer (production code never sets this). */
export function setRetrievalEventBufferForTest(b: RetrievalEventBuffer | null): void {
  singleton = b;
}

/**
 * Fail-open recording from a scored result list. `probOf` returns the
 * per-entry confidence when available (e.g. reranker top1 prob), else
 * undefined → weight 1.
 */
export function recordRetrievalFromScored(
  scored: Array<{ entry: { id: string } }>,
  kind: 'recall' | 'search',
  probOf?: (s: { entry: { id: string } }) => number | undefined,
  buffer: RetrievalEventBuffer = getRetrievalEventBuffer(),
): void {
  try {
    const ts = Date.now();
    for (const s of scored ?? []) {
      const p = probOf?.(s);
      buffer.record({ id: s?.entry?.id, prob: p === undefined ? 1 : p, kind, ts });
    }
  } catch {
    /* fail-open: never block retrieval */
  }
}
