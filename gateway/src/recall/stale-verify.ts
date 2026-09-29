// Pipeline 3: stale-memory verification — environment-probing curation
// (arXiv:2609.11060) applied to memory maintenance. Periodically re-verifies
// high-value procedural/semantic memories against the live environment via
// the memory-curator worker's read-only tools (read/grep/glob/ls). Memories
// contradicted by the environment are corrected and soft-superseded; energy
// decay handles fading, this pipeline handles CONTENT validity (drift).
import { HarmonicIndexManager } from '../core/memory/harmonic-index';
import { HarmonicIndexEntry } from '../core/memory/harmonic-types';
import { HARD_BOUNDARIES } from '../skills/memory-curator-agent';

export interface StaleVerifyWorker {
  prompt(
    message: string,
    system?: string,
    model?: { providerID: string; modelID: string },
    agent?: string,
  ): Promise<string>;
}

export interface StaleVerifyOptions {
  index: HarmonicIndexManager;
  /** Loads full memory_value for a candidate (index entries carry only the
   *  abstraction). May return null when the tier file is unreadable. */
  readMemory: (id: string) => Promise<{ id: string; memory_value: string } | null>;
  worker: StaleVerifyWorker;
  topK?: number; // default 10
  minAgeDays?: number; // default 14 — only re-verify memories older than this
  /** A1: exclude entries reviewed within this many days (default 21). */
  minReviewIntervalDays?: number; // default 21
  now?: number; // test hook
  workerModel?: { providerID: string; modelID: string };
}

export interface StaleVerifyResult {
  candidates: number;
  checked: number;
  superseded: number;
  failed: boolean;
}

export const STALE_VERIFY_SYSTEM = `You are the stale-memory reviewer for the harmonic memory system.
You receive a list of existing long-term memories. Re-verify each one against the CURRENT environment using read/grep/glob/ls (read-only):
- still true → do nothing.
- contradicted by the environment → write the corrected version with mafw_add_memory, passing the old memory's id in its supersedes field (or call mafw_supersede_memory on the old id when there is nothing worth replacing it with).
- not verifiable with read-only tools (preferences, past events, opinions) → skip it.
Spend at most 3 probes per memory. Probing verifies a memory; it never continues the work the memory describes.
${HARD_BOUNDARIES}

After processing, ALWAYS end your response with exactly one line:
[STALE-REVIEW: checked=N superseded=M]
This line MUST be the very last line of your response.`;

const DAY_MS = 24 * 60 * 60 * 1000;

export class StaleVerifyPipeline {
  constructor(private opts: StaleVerifyOptions) {}

  /** High-value, drift-exposed memories: procedural/semantic, live (not
   *  superseded), older than minAgeDays, ranked by energy × salience.
   *  A1 scheduling state: entries reviewed within minReviewIntervalDays are
   *  excluded, never-reviewed entries sort first. */
  selectCandidates(): HarmonicIndexEntry[] {
    const now = this.opts.now ?? Date.now();
    const topK = this.opts.topK ?? 10;
    const minAgeDays = this.opts.minAgeDays ?? 14;
    const minReviewDays = this.opts.minReviewIntervalDays ?? 21;
    return this.opts.index
      .getIndex()
      .entries.filter((e) => (e.type === 'procedural' || e.type === 'semantic') && !e.superseded_by)
      .filter((e) => {
        const created = e.created_at ? new Date(e.created_at).getTime() : 0;
        return created > 0 && now - created >= minAgeDays * DAY_MS;
      })
      .filter((e) => {
        const reviewed = e.last_reviewed ? new Date(e.last_reviewed).getTime() : 0;
        return reviewed === 0 || now - reviewed >= minReviewDays * DAY_MS;
      })
      .sort((a, b) => {
        const ra = a.review_count ?? 0;
        const rb = b.review_count ?? 0;
        if ((ra === 0) !== (rb === 0)) return ra === 0 ? -1 : 1;
        return b.energy * (b.salience ?? 1) - a.energy * (a.salience ?? 1);
      })
      .slice(0, topK);
  }

  async runOnce(): Promise<StaleVerifyResult> {
    const candidates = this.selectCandidates();
    const result: StaleVerifyResult = {
      candidates: candidates.length,
      checked: 0,
      superseded: 0,
      failed: false,
    };
    if (candidates.length === 0) return result;

    const blocks: string[] = [];
    for (const c of candidates) {
      const unit = await this.opts.readMemory(c.id).catch(() => null);
      if (!unit) continue;
      blocks.push(`---\nid: ${c.id}\ntype: ${c.type}\ncontent:\n${unit.memory_value}`);
    }
    if (blocks.length === 0) return result;

    const prompt = `Re-verify the following ${blocks.length} memories against the current environment:\n\n${blocks.join('\n')}`;
    try {
      const reply = await this.opts.worker.prompt(
        prompt,
        STALE_VERIFY_SYSTEM,
        this.opts.workerModel,
        'memory-curator',
      );
      const m = reply.match(/\[STALE-REVIEW:\s*checked=(\d+)\s+superseded=(\d+)\s*\]/);
      if (m) {
        result.checked = parseInt(m[1], 10);
        result.superseded = parseInt(m[2], 10);
        // A1: stamp scheduling state — these candidates were reviewed now,
        // excluding them from the next minReviewIntervalDays window.
        const nowIso = new Date(this.opts.now ?? Date.now()).toISOString();
        for (const c of candidates) {
          try {
            (this.opts.index as any).stampReview?.(c.id, nowIso);
          } catch { /* fail-open */ }
        }
      }
    } catch {
      result.failed = true;
    }
    return result;
  }
}
