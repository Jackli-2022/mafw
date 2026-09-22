// Backfill for legacy cue_anchors that were auto-filled as single CJK chars
// (pre-2026-09 extractAnchors). Single CJK chars fan out to every memory that
// shares the character, wrecking multi-hop precision; the current extractAnchors
// emits bigrams instead. This planner migrates existing entries: drop the junk,
// keep real anchors, re-derive bigrams from the abstraction.
import { extractAnchors } from './derived-terms';

export interface AnchorBackfillEntry {
  id: string;
  primary_abstraction?: string;
  cue_anchors?: string[];
}

export interface AnchorBackfillPlan {
  id: string;
  before: string[];
  after: string[];
}

export function isSingleCJK(s: string): boolean {
  return /^[\u4e00-\u9fff]$/.test(s);
}

/** Rebuild an entry's anchors. Returns the current anchors unchanged when none
 *  are single CJK chars (caller may still compare). */
export function rebuildAnchors(entry: AnchorBackfillEntry, maxAnchors = 8): string[] {
  const current = entry.cue_anchors ?? [];
  if (!current.some(isSingleCJK)) return current;
  const kept: string[] = [];
  for (const a of current) {
    if (a && !isSingleCJK(a) && !kept.includes(a)) kept.push(a);
  }
  const derived = extractAnchors(entry.primary_abstraction ?? '');
  for (const a of derived) {
    if (kept.length >= maxAnchors) break;
    if (!kept.includes(a)) kept.push(a);
  }
  return kept.slice(0, maxAnchors);
}

/** Entries whose anchors actually change. */
export function planAnchorBackfill(entries: AnchorBackfillEntry[], maxAnchors = 8): AnchorBackfillPlan[] {
  const plan: AnchorBackfillPlan[] = [];
  for (const e of entries) {
    const before = e.cue_anchors ?? [];
    const after = rebuildAnchors(e, maxAnchors);
    if (after.length !== before.length || after.some((a, i) => a !== before[i])) {
      plan.push({ id: e.id, before, after });
    }
  }
  return plan;
}
