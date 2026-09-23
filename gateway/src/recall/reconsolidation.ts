// S5: retrieval-driven reconsolidation. A memory that is retrieved AND used
// enters a bounded "labile" window during which a subsequent consolidation pass
// may UPDATE it — but only under a prediction-error gate (the new information
// must contradict, not merely re-encounter). This mirrors the brain: retrieval
// reopens a memory for update, gated so recall alone never rewrites it.
export interface ReconsolidationQueue {
  mark(id: string, reason: string, ttlMs?: number): void;
  isEligible(id: string, now?: number): boolean;
  listEligible(now?: number): string[];
  consume(id: string): void;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export class InMemoryReconsolidationQueue implements ReconsolidationQueue {
  private entries = new Map<string, { expiresAt: number; reason: string }>();

  mark(id: string, reason: string, ttlMs: number = DEFAULT_TTL_MS): void {
    this.entries.set(id, { expiresAt: Date.now() + ttlMs, reason });
  }

  isEligible(id: string, now: number = Date.now()): boolean {
    const e = this.entries.get(id);
    return !!e && e.expiresAt > now;
  }

  listEligible(now: number = Date.now()): string[] {
    return [...this.entries.entries()].filter(([, e]) => e.expiresAt > now).map(([id]) => id);
  }

  consume(id: string): void {
    this.entries.delete(id);
  }
}

/**
 * Prediction-error gate: reconsolidate only when the judge's verdict is an
 * UPDATE targeting this exact entry (i.e. new information contradicts/evolves
 * it). A `create`/`separate` verdict, a different target, or no verdict → no
 * rewrite (prevents drift from mere re-encounter).
 */
export function shouldReconsolidate(
  verdict: { action: 'create' | 'update' | 'separate'; targetId?: string } | null,
  targetId: string,
): boolean {
  return !!verdict && verdict.action === 'update' && verdict.targetId === targetId;
}

// Module singleton so feedback (mark) and the write path (consume) share state
// without plumbing. Swap-able for tests / persistence.
let queue: ReconsolidationQueue | null = null;

export function getReconsolidationQueue(): ReconsolidationQueue {
  if (!queue) queue = new InMemoryReconsolidationQueue();
  return queue;
}

export function setReconsolidationQueue(q: ReconsolidationQueue | null): void {
  queue = q;
}
