// V2 ④: grace-period re-visit. Young (≤48h) slow-system writes with a
// prediction-error signal (newer same-cue content exists — selectNewerRelated
// reused from D2) are re-read nightly by the reflection worker; verdicts:
// keep / update (additive supersede) / merge (dupCandidate convergence) /
// demote. authority=user entries are observe-only. Sevenster 2014: PE
// demarcates retrieval→reconsolidation→new-learning; no PE = no window.
import { HarmonicIndexEntry, HarmonicUnit } from '../core/memory/harmonic-types';
import { selectNewerRelated } from './reconsolidate-pipeline';
import { PipelineBudgetLike } from './pipeline-budget';

export const GRACE_WINDOW_MS = 48 * 3600 * 1000;

export function selectGraceCandidates(
  entries: HarmonicIndexEntry[],
  now: number,
  opts?: { windowMs?: number; maxPerRun?: number },
): Array<{ id: string; related: HarmonicIndexEntry[] }> {
  const windowMs = opts?.windowMs ?? GRACE_WINDOW_MS;
  const out: Array<{ id: string; related: HarmonicIndexEntry[] }> = [];
  for (const e of entries) {
    if (out.length >= (opts?.maxPerRun ?? 20)) break;
    if (e.type !== 'semantic' && e.type !== 'procedural') continue;
    if (e.superseded_by) continue;
    const anchors = e.cue_anchors ?? [];
    if (anchors.includes('rejected') || anchors.some(a => a.startsWith('redundant:'))) continue;
    const created = e.created_at ? Date.parse(e.created_at) : 0;
    if (!created || now - created > windowMs) continue;
    const related = selectNewerRelated(
      { id: e.id, cue_anchors: anchors, created_at: e.created_at! }, entries, now, 5);
    if (related.length === 0) continue; // PE gate: no newer related → no window
    out.push({ id: e.id, related });
  }
  return out;
}

export interface GraceVerdict {
  id: string;
  verdict: 'keep' | 'update' | 'merge' | 'demote';
  content?: string;
  mergeWith?: string;
}

export interface GraceRevisitDeps {
  index: { getIndex(): { entries: HarmonicIndexEntry[] } };
  readMemory: (id: string) => Promise<HarmonicUnit | null>;
  worker: { prompt(text: string, system: string): Promise<string> };
  /** Additive rewrite: new version + supersedes old (Lei 2024). */
  writeSuperseding: (oldId: string, content: string) => Promise<string>;
  /** Merge convergence: combined unit supersedes BOTH. */
  writeMerged: (aId: string, bId: string, content: string) => Promise<string>;
  markRejected: (id: string) => Promise<void>;
  /** 'shadow' = verdicts logged, never executed. */
  mode: 'shadow' | 'live';
  /** Observe sink — every verdict lands here (jsonl in production). */
  onVerdict: (v: GraceVerdict & { executed: boolean }) => void;
  /** V2 ⑥: salience-v2 observe sink — called once per selected/related entry
   *  during the selection pass; components land in salience-v2.jsonl. */
  onSalience?: (line: { id: string; components: SalienceV2Components; ts: number }) => void;
  /** 7d retrieval-hit proxy per id (RetrievalEventBuffer.needFor). */
  needFor?: (id: string) => number;
  budget?: PipelineBudgetLike;
  maxPerRun?: number;
}

export interface SalienceV2Components { static: number; need: number; authority: number; novelty: number; value: number }

/** V2 ⑥: mechanical salience composite (neuromodulator scalar for
 * consolidation ranking) — OBSERVE ONLY, never written back to entries or
 * ranking. static clamped to [0,1] (live salience can exceed 1); need
 * normalized against a 5-hit ceiling; authority per G1 rank; novelty
 * defaults 0.5 when absent (embedding off). */
export function computeSalienceV2(
  entry: { id: string; salience?: number; authority?: string; novelty?: number },
  deps: { needFor?: (id: string) => number },
): SalienceV2Components {
  const staticS = Math.min(1, Math.max(0, entry.salience ?? 0.5));
  const need = deps.needFor ? Math.min(1, Math.max(0, deps.needFor(entry.id)) / 5) : 0;
  const rank: Record<string, number> = { pipeline: 1, tool: 2, agent: 2, user: 3 };
  const authority = (rank[entry.authority ?? 'pipeline'] ?? 1) / 3;
  const novelty = entry.novelty ?? 0.5;
  const value = 0.5 * staticS + 0.25 * need + 0.15 * authority + 0.1 * novelty;
  return { static: staticS, need, authority, novelty, value };
}

export const GRACE_SYSTEM = `You re-visit young long-term memories that have received newer related evidence. For each memory decide: "keep" (evidence adds nothing), "update" (evidence evolves or contradicts it — provide the merged updated full text), "merge" (a distinct memory listed in mergeWith says the same thing — provide the combined full text), or "demote" (the memory is wrong or worthless now). Reply with ONLY JSON: {"revisits":[{"id":"...","verdict":"keep|update|merge|demote","content":"<full merged text when update/merge>","mergeWith":"<related id when merge>"}]}`;

export interface GraceRevisitResult {
  selected: number; kept: number; updated: number; merged: number; demoted: number; skipped: number;
}

/** Write ops for the grace phase against a real HarmonicUnitFileStore
 * (factory keeps index.ts wiring thin and the ops unit-testable). */
export function createGraceWriteOps(store: {
  read(id: string): Promise<HarmonicUnit | null>;
  write(unit: HarmonicUnit): Promise<string>;
  markSuperseded(id: string, byId: string): boolean | void | Promise<void>;
}): Pick<GraceRevisitDeps, 'writeSuperseding' | 'writeMerged' | 'markRejected'> {
  return {
    writeSuperseding: async (oldId, content) => {
      const { generateHarmonicId } = require('../core/memory/harmonic-types');
      const old = await store.read(oldId);
      const id = generateHarmonicId();
      const now = new Date().toISOString();
      await store.write({
        id,
        type: old?.type ?? 'semantic',
        primary_abstraction: content.slice(0, 80),
        cue_anchors: [...(old?.cue_anchors ?? []), 'revisited'],
        memory_value: content,
        energy: Math.max(0.75, old?.energy ?? 0.75),
        created_at: now,
        updated_at: now,
      } as any);
      await store.markSuperseded(oldId, id);
      return id;
    },
    writeMerged: async (aId, bId, content) => {
      const { generateHarmonicId } = require('../core/memory/harmonic-types');
      const a = await store.read(aId);
      const b = await store.read(bId);
      const id = generateHarmonicId();
      const now = new Date().toISOString();
      const cues = [...new Set([...(a?.cue_anchors ?? []), ...(b?.cue_anchors ?? [])])].slice(0, 8);
      await store.write({
        id,
        type: a?.type ?? 'semantic',
        primary_abstraction: content.slice(0, 80),
        cue_anchors: cues,
        memory_value: content,
        energy: Math.max(a?.energy ?? 0.75, b?.energy ?? 0.75),
        merged_from: [aId, bId],
        created_at: now,
        updated_at: now,
      } as any);
      await store.markSuperseded(aId, id);
      if (bId !== aId) await store.markSuperseded(bId, id);
      return id;
    },
    markRejected: async (id) => {
      const u = await store.read(id);
      if (!u) return;
      await store.write({
        ...u,
        energy: 0.05,
        cue_anchors: [...new Set([...(u.cue_anchors ?? []), 'rejected'])],
        updated_at: new Date().toISOString(),
      } as any);
    },
  };
}

export class GraceRevisitPipeline {
  constructor(private opts: GraceRevisitDeps) {}

  async runOnce(): Promise<GraceRevisitResult> {
    const r: GraceRevisitResult = { selected: 0, kept: 0, updated: 0, merged: 0, demoted: 0, skipped: 0 };
    if (this.opts.budget && !this.opts.budget.allow('reflect')) return r;
    const entries = this.opts.index.getIndex().entries;
    const now = Date.now();
    const candidates = selectGraceCandidates(entries, now, { maxPerRun: this.opts.maxPerRun ?? 20 });
    if (candidates.length === 0) return r;
    r.selected = candidates.length;

    // V2 ⑥: salience-v2 observation rides the selection pass (zero extra
    // scheduling) — candidates AND their related evidence get one line each.
    if (this.opts.onSalience) {
      const observed = new Set<string>();
      for (const c of candidates) {
        for (const e of [entries.find(x => x.id === c.id), ...c.related]) {
          if (!e || observed.has(e.id)) continue;
          observed.add(e.id);
          try {
            this.opts.onSalience({ id: e.id, components: computeSalienceV2(e, { needFor: this.opts.needFor }), ts: now });
          } catch { /* fail-open */ }
        }
      }
    }

    const blocks: string[] = [];
    for (const c of candidates) {
      const unit = await this.opts.readMemory(c.id);
      if (!unit || unit.superseded_by) { r.skipped++; continue; }
      const related = c.related.map(rel => `- [${rel.id}] ${rel.primary_abstraction}`).join('\n');
      blocks.push(`MEMORY [${c.id}]:\n${unit.memory_value.slice(0, 1500)}\nNEWER RELATED:\n${related}`);
    }
    if (blocks.length === 0) return r;

    let verdicts: GraceVerdict[] = [];
    try {
      const reply = await this.opts.worker.prompt(blocks.join('\n\n---\n\n'), GRACE_SYSTEM);
      const m = reply.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : null;
      if (Array.isArray(parsed?.revisits)) verdicts = parsed.revisits;
    } catch { return r; }

    const byId = new Map(entries.map(e => [e.id, e]));
    for (const v of verdicts) {
      const entry = byId.get(v.id);
      if (!entry || entry.superseded_by) { r.skipped++; continue; }
      // G1 discipline: the pipeline never rewrites user-authority memories.
      const isUser = (entry as any).authority === 'user';
      const executed = this.opts.mode === 'live' && !isUser && v.verdict !== 'keep';
      try {
        if (executed && v.verdict === 'update' && v.content?.trim()) {
          await this.opts.writeSuperseding(v.id, v.content.trim());
          r.updated++;
        } else if (executed && v.verdict === 'merge' && v.mergeWith && v.content?.trim()) {
          await this.opts.writeMerged(v.id, v.mergeWith, v.content.trim());
          r.merged++;
        } else if (executed && v.verdict === 'demote') {
          await this.opts.markRejected(v.id);
          r.demoted++;
        } else if (v.verdict === 'keep') {
          r.kept++;
        } else {
          r.skipped++;
        }
      } catch { r.skipped++; continue; }
      this.opts.onVerdict({ ...v, executed });
    }
    return r;
  }
}
