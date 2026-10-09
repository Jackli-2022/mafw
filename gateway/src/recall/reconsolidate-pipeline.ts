// D2 consumer: entries in the reconsolidation (labile) window are checked
// once daily against NEWER memories sharing a cue anchor. A worker decides
// keep/rewrite; rewrite goes through the supersedes chain. Budget-gated;
// every eligible id is consumed exactly once per pass (no retry storms).
import { HarmonicIndexEntry, HarmonicUnit } from '../core/memory/harmonic-types';
import { ReconsolidationQueue } from './reconsolidation';
import { PipelineBudgetLike } from './pipeline-budget';

export interface ReconsolidateDeps {
  queue: ReconsolidationQueue;
  index: { getIndex(): { entries: HarmonicIndexEntry[] } };
  readMemory: (id: string) => Promise<HarmonicUnit | null>;
  readRelated: (id: string) => Promise<{ id: string; memory_value: string } | null>;
  worker: { prompt(text: string, system: string): Promise<string> };
  writeSuperseding: (oldId: string, content: string) => Promise<string>;
  budget?: PipelineBudgetLike;
  maxPerRun?: number; // default 10
  maxRelated?: number; // default 5
}

/** Newer, live entries sharing >=1 cue anchor with the unit, capped by recency. */
export function selectNewerRelated(
  unit: { id: string; cue_anchors: string[]; created_at: string },
  entries: HarmonicIndexEntry[],
  now: number,
  cap = 5,
): HarmonicIndexEntry[] {
  const unitCreated = new Date(unit.created_at).getTime();
  const cues = new Set(unit.cue_anchors ?? []);
  return entries
    .filter((e) => e.id !== unit.id && !e.superseded_by)
    .filter((e) => (e.cue_anchors ?? []).some((c) => cues.has(c)))
    .filter((e) => {
      const c = e.created_at ? new Date(e.created_at).getTime() : 0;
      return c > unitCreated && c <= now;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, cap);
}

const SYSTEM = `You are reviewing whether an existing long-term memory needs rewriting given newer related memories. Reply with ONLY JSON: {"action":"keep"} or {"action":"rewrite","content":"<merged updated memory text>"}. Rewrite only when the newer material contradicts or clearly evolves the old one; mere re-encounter = keep.`;

export class ReconsolidatePipeline {
  constructor(private opts: ReconsolidateDeps) {}

  async runOnce(): Promise<{ checked: number; rewritten: number; skipped: number }> {
    const result = { checked: 0, rewritten: 0, skipped: 0 };
    if (this.opts.budget && !this.opts.budget.allow('reconsolidate')) return result;
    const ids = this.opts.queue.listEligible().slice(0, this.opts.maxPerRun ?? 10);
    const entries = this.opts.index.getIndex().entries;
    const now = Date.now();
    for (const id of ids) {
      this.opts.queue.consume(id);
      const unit = await this.opts.readMemory(id);
      if (!unit || unit.superseded_by) { result.skipped++; continue; }
      const related = selectNewerRelated(unit, entries, now, this.opts.maxRelated ?? 5);
      if (related.length === 0) { result.skipped++; continue; }
      const relatedTexts: string[] = [];
      for (const r of related) {
        const u = await this.opts.readRelated(r.id);
        if (u) relatedTexts.push(`- ${u.memory_value}`);
      }
      if (relatedTexts.length === 0) { result.skipped++; continue; }
      result.checked++;
      const text = `EXISTING MEMORY:\n${unit.memory_value}\n\nNEWER RELATED MEMORIES:\n${relatedTexts.join('\n')}`;
      let verdict: { action?: string; content?: string } | null = null;
      try {
        const reply = await this.opts.worker.prompt(text, SYSTEM);
        verdict = JSON.parse(reply.replace(/```json|```/g, '').trim());
      } catch { verdict = null; }
      if (verdict?.action === 'rewrite' && typeof verdict.content === 'string' && verdict.content.trim()) {
        await this.opts.writeSuperseding(id, verdict.content.trim());
        result.rewritten++;
      } else if (verdict?.action === 'keep') {
        // no-op
      } else {
        result.skipped++;
      }
    }
    return result;
  }
}
