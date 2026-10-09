// A1 ladder top-off: weekly, high-need semantic insights are distilled into
// axiom CANDIDATES that land in triage; confirmation commits them to L5 via
// the existing heuristic channel. The ladder's top rung is no longer manual.
import { HarmonicIndexEntry } from '../core/memory/harmonic-types';

export function selectAxiomSources(
  entries: HarmonicIndexEntry[],
  needFor: (id: string) => number,
  opts: { now: number; minAgeDays: number; cap: number },
): HarmonicIndexEntry[] {
  return entries
    .filter((e) => e.type === 'semantic' && !e.superseded_by)
    .filter((e) => {
      const c = e.created_at ? new Date(e.created_at).getTime() : 0;
      return c > 0 && opts.now - c >= opts.minAgeDays * 86400_000;
    })
    .map((e) => ({ e, score: needFor(e.id) * e.energy * (e.salience ?? 1) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.cap)
    .map((x) => x.e);
}

export function parseAxiomCandidates(reply: string, max: number): string[] {
  return (reply ?? '').split('\n').map((l) => l.trim())
    .filter((l) => l.length > 0 && l.length <= 200)
    .slice(0, max);
}

export const AXIOM_SYSTEM = `Distill the following validated insights into at most 3 general axioms (patterns of patterns). One per line, no numbering. Each must be actionable guidance, not a restatement of any single insight.`;
