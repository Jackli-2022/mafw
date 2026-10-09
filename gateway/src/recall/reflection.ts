// Pipeline 2: reflection → distilled memory. The reflector processes each
// session's *unreflected* episodic memories (incremental cursor, not a time
// window) with that session's own persistent reflect worker, distills durable
// insights (Hermes six categories), dedups with the MinHash pure functions,
// and writes semantic/procedural units back into the shared harmonic index.
import { HarmonicIndexManager } from '../core/memory/harmonic-index';
import { HarmonicUnitFileStore } from '../memory/harmonic-file-store';
import { MemoryWorker } from './memory-worker';
import { MinHashMerger } from '../core/memory/minhash-merger';
import { ReflectCursor } from './reflect-cursor';
import { generateHarmonicId, HarmonicUnit } from '../core/memory/harmonic-types';
import { HarmonicIndexEntry } from '../core/memory/harmonic-types';
import { abstractionLevelFor } from '../core/memory/abstraction-level';
import { calculateSalience } from '../core/memory/salience-perceptor';
import { HARD_BOUNDARIES } from '../skills/memory-curator-agent';
import { getRouteWriteDeps, routeAndWrite } from '../memory/route-write';
import { PipelineBudgetLike } from './pipeline-budget';

/** Session key for episodic memories with no source_session_id (legacy data). */
export const ORPHAN_SESSION = '__orphan__';

export interface ReflectionOptions {
  index: HarmonicIndexManager;
  baseDir: string;
  workerFor: (sessionID: string) => MemoryWorker;
  cursor: ReflectCursor;
  maxEpisodicPerSession?: number;
  maxInsights?: number;
  /** Serializes reflection per (session, kind) when multiple triggers coexist. */
  exclusive?: (sessionID: string, fn: () => Promise<unknown>) => Promise<unknown>;
  /** Pin a model for each worker prompt. */
  workerModel?: { providerID: string; modelID: string };
  /** D1b: fraction of source-episode energy removed after a successful distillation (default 0.3). */
  sourceDemoteFactor?: number;
  /** A4: downstream retrieval-hit count per memory id (7d need) — selection-pressure feedback. */
  needFor?: (id: string) => number;
  /** Daily USD cap gate for background pipelines (0 = unlimited). */
  budget?: PipelineBudgetLike;
}

export interface ReflectionResult {
  sessions: number;
  reviewed: number;
  distilled: number;
  deduped: number;
  superseded: number;
  failed: number;
  pendingSessions: number;
}

export type InsightCategory = 'failure' | 'correction' | 'insight' | 'preference' | 'convention' | 'tool-quirk';

export interface Insight {
  category: InsightCategory;
  content: string;
  cue_anchors?: string[];
}

export const REFLECT_SYSTEM = `You are a reflection system for a coding agent's long-term memory. Review the episodic memories of one conversation and distill durable, reusable insights. Return ONLY valid JSON, no markdown:
{"insights":[{"category":"failure|correction|insight|preference|convention|tool-quirk","content":"<one sentence>","cue_anchors":["<keyword>"]}]}
Rules:
- no redundant insights; each insight must be a durable lesson, preference, failure, convention, or tool quirk
- every cue_anchors list MUST include the topic entity names (project, module, API, person, feature) so the insight can be found across sessions
- for category "preference", include a machine-readable anchor like "pref:<dimension>=<value>" (e.g., "pref:output-language=chinese" or "pref:spicy=false")
- prefer insights that hold across multiple episodes of this conversation
Division of labor: focus on CROSS-EPISODE high-level patterns — recurring failure root causes, lessons that generalize to future tasks, user behavior patterns. Do NOT re-record single-point facts already present in the episodic memories (the hourly extract pipeline already saved those).

### Cross-Session Entity Linking (CRITICAL):
- Extract ALL named entities from the episodes: project names, module names, person names, API endpoints, feature names, file paths, commands, error messages, configuration keys
- For each insight, include entities that would help find this insight in OTHER sessions about the same topic
- Include entity variants: e.g., both "React" and "react", both "User Auth Module" and "auth module"
- For technical discussions, include error codes, stack traces, or specific function names as anchors
- For user preferences, include the dimension AND value: e.g., "pref:ui-language=chinese" AND "chinese" AND "ui-language"
- Think: "If someone asked about this topic in a different session, what keywords would they search for?"
${HARD_BOUNDARIES}`;

export const QUESTIONS_SYSTEM = `You are a reflection system for a coding agent's long-term memory. Review the episodic memories of one conversation and generate the 2-3 most salient high-level questions about this session — questions whose answers would reveal durable patterns, recurring root causes, or generalizable lessons. Return ONLY valid JSON, no markdown:
{"questions":["<question>","<question>"]}
Rules:
- questions must be answerable from past conversations (not speculation)
- prefer questions that span multiple episodes
- questions should be specific enough to retrieve relevant memories (include entity names like project, module, API, feature)
- for multi-topic sessions, generate questions for each topic separately
- for user preferences, ask about the preference itself (e.g., "What UI language does the user prefer?") rather than the context where it was mentioned
${HARD_BOUNDARIES}`;

export function parseQuestions(text: string): string[] {
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
    const items = parsed?.questions ?? parsed;
    if (!Array.isArray(items)) return [];
    return items.filter((q: any) => typeof q === 'string' && q.trim()).slice(0, 3).map(String);
  } catch {
    return [];
  }
}

const CATEGORY_TO_TYPE: Record<InsightCategory, HarmonicUnit['type']> = {
  failure: 'semantic',
  correction: 'semantic',
  insight: 'semantic',
  preference: 'semantic',
  convention: 'semantic',
  'tool-quirk': 'procedural',
};

const CATEGORY_ENERGY: Record<InsightCategory, number> = {
  failure: 0.9,
  correction: 0.9,
  insight: 0.8,
  preference: 0.85,
  convention: 0.75,
  'tool-quirk': 0.8,
};

/**
 * Build the harmonic unit for a distilled insight. Extracted as a pure function
 * so the unit shape (notably the `cat:` anchor) is testable without the LLM
 * worker. `cat:<category>` is persisted to cue_anchors so the failure taxonomy
 * (L2) and the `<agent-priors>` block (W1) can filter by category — previously
 * the category was mapped to type and then discarded.
 */
/**
 * D1b helper: demote source verbatim episodes after their gist was distilled
 * (Fuzzy-Trace: detail fades, gist survives). Demotion — not supersede — keeps
 * episodes retrievable (multiple gists may draw on overlapping episodes, so a
 * 1:1 supersede chain would over-redirect). Pure over an injected index.
 * @returns number of episodes actually demoted
 */
export function demoteSourceEpisodes(
  index: { getIndex(): { entries: any[] }; updateEnergy(id: string, delta: number): void; save?(): void },
  episodeIds: string[],
  factor: number = 0.3,
): number {
  const byId = new Map(index.getIndex().entries.map((e: any) => [e.id, e]));
  let demoted = 0;
  for (const id of episodeIds) {
    const entry = byId.get(id);
    if (!entry) continue;
    index.updateEnergy(id, -((entry.energy ?? 0) * factor));
    demoted++;
  }
  if (demoted > 0) {
    try { index.save?.(); } catch { /* fail-open */ }
  }
  return demoted;
}

/**
 * A4 selection-pressure feedback: render the downstream retrieval-hit counts of
 * previously distilled insights so the next reflection round can calibrate —
 * insights that never get retrieved are candidates for merge/deletion. Pure;
 * returns '' for an empty set.
 */
export function selectionFeedbackBlock(items: Array<{ text: string; need: number }>): string {
  if (items.length === 0) return '';
  const lines = items.map((i) =>
    i.need > 0 ? `- [命中 ${i.need}] ${i.text}` : `- [未被检索] ${i.text}`,
  );
  return `### 你此前蒸馏洞察的使用反馈（按 need 校准：未被检索的考虑合并或删除）\n${lines.join('\n')}`;
}

export function buildInsightUnit(insight: Insight, sessionID: string, now: string): HarmonicUnit {
  return {
    id: generateHarmonicId(),
    type: CATEGORY_TO_TYPE[insight.category],
    primary_abstraction: insight.content.slice(0, 200),
    cue_anchors: [...(insight.cue_anchors ?? []), `cat:${insight.category}`],
    memory_value: insight.content,
    energy: CATEGORY_ENERGY[insight.category],
    salience: calculateSalience(insight.content),
    abstraction_level: abstractionLevelFor('semantic'),
    created_at: now,
    updated_at: now,
    source_session_id: sessionID === ORPHAN_SESSION ? undefined : sessionID,
  };
}

export function parseInsights(text: string): Insight[] {
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
    const items = parsed?.insights ?? parsed;
    if (!Array.isArray(items)) return [];
    return items
      .filter(
        (i: any) =>
          i?.content?.trim() &&
          ['failure', 'correction', 'insight', 'preference', 'convention', 'tool-quirk'].includes(i.category),
      )
      .map((i: any) => ({
        category: i.category as InsightCategory,
        content: String(i.content).trim(),
        cue_anchors: Array.isArray(i.cue_anchors) ? i.cue_anchors.slice(0, 8).map(String) : [],
      }));
  } catch {
    return [];
  }
}

/**
 * Groups index episodic entries by session (source_session_id; legacy entries
 * without one go to the ORPHAN group). Returns only unreflected ids.
 */
export function unreflectedBySession(
  index: HarmonicIndexManager,
  cursor: ReflectCursor,
  maxPerSession: number,
): Map<string, { id: string; text: string }[]> {
  const bySession = new Map<string, { id: string; text: string }[]>();
  for (const entry of index.getIndex().entries) {
    if (entry.type !== 'episodic') continue;
    const session = entry.source_session_id || ORPHAN_SESSION;
    if (cursor.isReflected(session, entry.id)) continue;
    let list = bySession.get(session);
    if (!list) {
      list = [];
      bySession.set(session, list);
    }
    if (list.length >= maxPerSession) continue;
    list.push({ id: entry.id, text: `${entry.primary_abstraction} ${(entry.cue_anchors ?? []).join(' ')}` });
  }
  return bySession;
}

/** A2: tentative draft abstractions (fast-system output) awaiting slow-system
 *  validation — live entries carrying the literal 'tentative' cue anchor. */
export function collectTentative(entries: HarmonicIndexEntry[], _now: number): HarmonicIndexEntry[] {
  return entries.filter((e) => !e.superseded_by && (e.cue_anchors ?? []).includes('tentative'));
}

export interface TentativeVerdict { id: string; verdict: 'promote' | 'reject' }

export const TENTATIVE_SYSTEM = `You validate draft abstractions produced by the hourly extraction pipeline. A draft is valid only if it holds up as a genuine CROSS-EPISODE pattern (not a restatement of one episode). Reply with ONLY JSON: {"drafts":[{"id":"...","verdict":"promote|reject"}]}.`;

/** Promote → strip 'tentative', bump energy to 0.7, stamp verified; reject →
 *  demote to 0.05 energy and swap the anchor to 'rejected'. */
export async function applyTentativeVerdicts(
  verdicts: TentativeVerdict[],
  deps: { read: (id: string) => Promise<HarmonicUnit | null>; write: (u: HarmonicUnit) => Promise<unknown> },
  now: Date,
): Promise<{ promoted: number; rejected: number }> {
  const out = { promoted: 0, rejected: 0 };
  const stamp = `verified:${now.toISOString().slice(0, 10)}`;
  for (const v of verdicts) {
    const unit = await deps.read(v.id);
    if (!unit) continue;
    const cues = (unit.cue_anchors ?? []).filter((c) => c !== 'tentative');
    if (v.verdict === 'promote') {
      await deps.write({ ...unit, cue_anchors: [...cues, stamp], energy: 0.7, updated_at: now.toISOString() });
      out.promoted++;
    } else if (v.verdict === 'reject') {
      await deps.write({ ...unit, cue_anchors: [...cues, 'rejected'], energy: 0.05, updated_at: now.toISOString() });
      out.rejected++;
    }
  }
  return out;
}

export class ReflectionPipeline {
  private store: HarmonicUnitFileStore;
  private merger = new MinHashMerger();

  constructor(private opts: ReflectionOptions) {
    this.store = new HarmonicUnitFileStore(opts.baseDir, opts.index);
  }

  /**
   * Three-way classification for a new insight against existing memories:
   * - 'duplicate': MinHash > 0.6 → skip (same content)
   * - 'conflict': MinHash 0.4-0.6 + shared cue_anchors → supersede old entry
   * - 'novel': no significant overlap → write normally
   *
   * The conflict band (0.4-0.6) catches "same topic, different value" cases
   * that MinHash dedup misses — e.g., "deploy to us-east-1" vs "deploy to
   * eu-west-1" share structure but differ in the critical detail.
   */
  private classifyInsight(content: string, cueAnchors: string[]): { kind: 'duplicate' | 'conflict' | 'novel'; conflictTarget?: string } {
    const sig = this.merger.generateSignature(content);
    let bestMatch: { id: string; sim: number } | null = null;

    for (const entry of this.opts.index.getIndex().entries) {
      if (entry.type !== 'semantic' && entry.type !== 'procedural') continue;
      if ((entry as any).superseded_by) continue; // skip already-superseded entries
      // Merged blobs concatenate segments with ' | ' — compare per segment
      // so a true duplicate of one segment is not diluted by the rest.
      let sim = 0;
      for (const seg of MinHashMerger.segmentsOf(entry.primary_abstraction)) {
        const other = `${seg} ${(entry.cue_anchors ?? []).join(' ')}`;
        const s = this.merger.similarity(sig, this.merger.generateSignature(other));
        if (s > sim) sim = s;
      }

      if (sim > 0.6) return { kind: 'duplicate' };
      if (sim > 0.4 && sim > (bestMatch?.sim ?? 0)) {
        bestMatch = { id: entry.id, sim };
      }
    }

    // Conflict requires both MinHash in the 0.4-0.6 band AND at least one shared cue_anchor
    if (bestMatch && bestMatch.sim > 0.4) {
      const targetEntry = this.opts.index.getIndex().entries.find(e => e.id === bestMatch!.id);
      const targetAnchors = targetEntry?.cue_anchors ?? [];
      const sharedAnchors = cueAnchors.filter(a => targetAnchors.includes(a));
      if (sharedAnchors.length > 0) {
        return { kind: 'conflict', conflictTarget: bestMatch.id };
      }
    }

    return { kind: 'novel' };
  }

  /**
   * Reflect one session's unreflected episodes. Returns the number of
   * reviewed episodes (0 when nothing pending). Marks ids reflected only
   * after insights were successfully written (failure keeps them pending for
   * the next run).
   */
  private async reflectSession(sessionID: string, episodes: { id: string; text: string }[]): Promise<ReflectionResult> {
    const result: ReflectionResult = { sessions: 0, reviewed: 0, distilled: 0, deduped: 0, superseded: 0, failed: 0, pendingSessions: 0 };
    if (episodes.length === 0) return result;
    result.reviewed = episodes.length;

    const promptLines: string[] = [];
    for (let i = 0; i < episodes.length; i++) {
      const ep = episodes[i];
      let text = ep.text;
      try {
        const unit = await this.store.read(ep.id);
        if (unit?.memory_value) text = unit.memory_value.slice(0, 2000);
      } catch { /* fall back to summary line */ }
      promptLines.push(`${i + 1}. ${text}`);
    }
    const prompt = promptLines.join('\n');
    const worker = this.opts.workerFor(sessionID);
    let insights: Insight[] = [];
    try {
      // Step 1: generate salient questions
      const qText = await worker.prompt(prompt, QUESTIONS_SYSTEM, this.opts.workerModel, 'memory-curator');
      const questions = parseQuestions(qText);
      // Step 2: retrieve evidence per question (bm25, no graph expansion)
      const evidence: string[] = [];
      if (questions.length > 0) {
        for (const q of questions) {
          const hits = this.opts.index.searchScored(q, 5, { retriever: 'bm25', graphExpand: false });
          for (const hit of hits) {
            const line = `- [${hit.entry.id}] ${hit.entry.primary_abstraction}`;
            if (!evidence.includes(line)) evidence.push(line);
          }
        }
      }
      // Step 3: distill insights with evidence context
      const evidenceBlock = evidence.length > 0 ? `\n\n### Related Historical Memories\n${evidence.join('\n')}` : '';
      // Step 3.5: Extract entities from episodes for cross-session linking
      const episodeEntities = new Set<string>();
      for (const ep of episodes) {
        // Extract camelCase/PascalCase identifiers
        const camelPascal = ep.text.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g);
        if (camelPascal) camelPascal.forEach(e => episodeEntities.add(e));
        // Extract ALL_CAPS words
        const allCaps = ep.text.match(/\b[A-Z]{2,}\b/g);
        if (allCaps) allCaps.forEach(e => { if (e.length >= 3) episodeEntities.add(e); });
        // Extract quoted strings
        const quoted = ep.text.match(/['"]([^'"]+)['"]/g);
        if (quoted) quoted.forEach(q => episodeEntities.add(q.slice(1, -1).trim()));
      }
      // Inject entity context into evidence block for cross-session linking
      const entityBlock = episodeEntities.size > 0
        ? `\n\n### Session Entities (for cross-session linking)\n${[...episodeEntities].slice(0, 20).join(', ')}`
        : '';
      // A4: prior distilled insights of THIS session + their downstream usage.
      let feedbackBlock = '';
      if (this.opts.needFor) {
        const prior = this.opts.index.getIndex().entries
          .filter((e: any) =>
            e.source_session_id === sessionID &&
            (e.type === 'semantic' || e.type === 'procedural') &&
            !e.superseded_by)
          .slice(0, 10)
          .map((e: any) => ({ text: e.primary_abstraction as string, need: this.opts.needFor!(e.id) }));
        const fb = selectionFeedbackBlock(prior);
        if (fb) feedbackBlock = `\n\n${fb}`;
      }
      const text = await worker.prompt(prompt + evidenceBlock + entityBlock + feedbackBlock, REFLECT_SYSTEM, this.opts.workerModel, 'memory-curator');
      insights = parseInsights(text);
    } catch {
      result.failed++;
      return result; // episodes stay unreflected
    }

    const maxInsights = this.opts.maxInsights ?? 10;
    for (const insight of insights.slice(0, maxInsights)) {
      const classification = this.classifyInsight(insight.content, insight.cue_anchors ?? []);

      if (classification.kind === 'duplicate') {
        result.deduped++;
        continue;
      }

      const now = new Date().toISOString();
      const unit = buildInsightUnit(insight, sessionID, now);
      try {
        // If this insight conflicts with an existing memory, supersede the old one
        if (classification.kind === 'conflict' && classification.conflictTarget) {
          this.store.markSuperseded(classification.conflictTarget, unit.id);
          result.superseded++;
        }
        // S1 write-time routing: dedup/update against existing memories when wired.
        const routeDeps = getRouteWriteDeps();
        if (routeDeps) {
          const routed = await routeAndWrite(unit, this.store as any, routeDeps);
          if (routed.action === 'skip') result.deduped++;
          else result.distilled++;
        } else {
          await this.store.write(unit);
          result.distilled++;
        }
      } catch {
        result.failed++;
      }
    }

    // A2: validate this session's tentative drafts (promote/reject) with the
    // same worker — drafts that hold up become normal semantic memories.
    try {
      const tentative = collectTentative(this.opts.index.getIndex().entries, Date.now());
      if (tentative.length > 0) {
        const listText = tentative.slice(0, 10).map((e) => `- [${e.id}] ${e.primary_abstraction}`).join('\n');
        const reply = await worker.prompt(
          `DRAFT ABSTRACTIONS:\n${listText}`,
          TENTATIVE_SYSTEM,
          this.opts.workerModel,
          'memory-curator',
        );
        const m = reply.match(/\{[\s\S]*\}/);
        const parsed = m ? JSON.parse(m[0]) : null;
        if (Array.isArray(parsed?.drafts) && parsed.drafts.length > 0) {
          const r = await applyTentativeVerdicts(
            parsed.drafts,
            { read: (id) => this.store.read(id), write: (u) => this.store.write(u) },
            new Date(),
          );
          result.distilled += r.promoted;
        }
      }
    } catch { /* fail-open: drafts remain for the next run */ }

    // D1b: gist 化后源 verbatim episodes 降能（Fuzzy-Trace：细节先死、要点存活）。
    // 降能不失联——条目仍可检索，只是在排序中让位给 gist。
    if (result.distilled > 0) {
      demoteSourceEpisodes(this.opts.index, episodes.map((e) => e.id), this.opts.sourceDemoteFactor ?? 0.3);
    }

    // Mark the batch reflected once the LLM produced a parseable result —
    // regardless of dedup/partial write failures. The episodes were processed;
    // retrying them would only re-extract the same (deduped) insights. Only a
    // hard LLM failure (no insights at all) keeps them pending.
    if (insights.length > 0) {
      this.opts.cursor.markReflected(sessionID, episodes.map((e) => e.id));
    }
    result.sessions = insights.length > 0 ? 1 : 0;
    return result;
  }

  /**
   * Reflect all sessions with unreflected episodes (daily cron). Each session
   * goes through the exclusive gate so concurrent triggers (restore, manual)
   * can never double-process the same episodes on the same worker.
   */
  async runAll(): Promise<ReflectionResult> {
    const total: ReflectionResult = { sessions: 0, reviewed: 0, distilled: 0, deduped: 0, superseded: 0, failed: 0, pendingSessions: 0 };
    if (this.opts.budget && !this.opts.budget.allow('reflect')) return total;
    const bySession = unreflectedBySession(
      this.opts.index,
      this.opts.cursor,
      this.opts.maxEpisodicPerSession ?? 100,
    );
    const exclusive =
      this.opts.exclusive ?? ((_sessionID: string, fn: () => Promise<unknown>) => fn());
    for (const [sessionID, episodes] of bySession) {
      const res = await exclusive(sessionID, async () => {
        return this.reflectSession(sessionID, episodes);
      });
      const r = res as ReflectionResult;
      total.sessions += r.sessions;
      total.reviewed += r.reviewed;
      total.distilled += r.distilled;
      total.deduped += r.deduped;
      total.superseded += r.superseded;
      total.failed += r.failed;
    }
    // Maintenance: drop reflected ids that no longer exist in the index so the
    // bounded per-session list never re-exposes stale episodes.
    this.opts.cursor.prune(new Set(this.opts.index.getIndex().entries.map((e) => e.id)));
    return total;
  }

  /** Reflect a single session (restoreWorkerState / shouldReflect path). */
  async runSession(sessionID: string): Promise<ReflectionResult> {
    const bySession = unreflectedBySession(
      this.opts.index,
      this.opts.cursor,
      this.opts.maxEpisodicPerSession ?? 100,
    );
    const episodes = bySession.get(sessionID);
    if (!episodes || episodes.length === 0) return { sessions: 0, reviewed: 0, distilled: 0, deduped: 0, superseded: 0, failed: 0, pendingSessions: 0 };
    return this.reflectSession(sessionID, episodes);
  }

  /** Number of unreflected episodes for a session (shouldReflect gate). */
  pendingFor(sessionID: string): number {
    const bySession = unreflectedBySession(
      this.opts.index,
      this.opts.cursor,
      this.opts.maxEpisodicPerSession ?? 100,
    );
    return bySession.get(sessionID)?.length ?? 0;
  }
}
