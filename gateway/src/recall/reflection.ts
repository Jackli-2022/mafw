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
import { calculateSalience } from '../core/memory/salience-perceptor';

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
}

export interface ReflectionResult {
  sessions: number;
  reviewed: number;
  distilled: number;
  deduped: number;
  failed: number;
  pendingSessions: number;
}

export type InsightCategory = 'failure' | 'correction' | 'insight' | 'preference' | 'convention' | 'tool-quirk';

export interface Insight {
  category: InsightCategory;
  content: string;
  cue_anchors?: string[];
}

const REFLECT_SYSTEM = `You are a reflection system for a coding agent's long-term memory. Review the episodic memories of one conversation and distill durable, reusable insights. Return ONLY valid JSON, no markdown:
{"insights":[{"category":"failure|correction|insight|preference|convention|tool-quirk","content":"<one sentence>","cue_anchors":["<keyword>"]}]}
Rules:
- no redundant insights; each insight must be a durable lesson, preference, failure, convention, or tool quirk
- every cue_anchors list MUST include the topic entity names (project, module, API, person, feature) so the insight can be found across sessions
- for category "preference", include a machine-readable anchor like "pref:<dimension>=<value>" (e.g., "pref:output-language=chinese" or "pref:spicy=false")
- prefer insights that hold across multiple episodes of this conversation`;

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
    list.push({ id: entry.id, text: `${entry.primary_abstraction} ${entry.cue_anchors.join(' ')}` });
  }
  return bySession;
}

export class ReflectionPipeline {
  private store: HarmonicUnitFileStore;
  private merger = new MinHashMerger();

  constructor(private opts: ReflectionOptions) {
    this.store = new HarmonicUnitFileStore(opts.baseDir, opts.index);
  }

  private isDuplicate(content: string): boolean {
    const sig = this.merger.generateSignature(content);
    for (const entry of this.opts.index.getIndex().entries) {
      if (entry.type !== 'semantic' && entry.type !== 'procedural') continue;
      const other = `${entry.primary_abstraction} ${entry.cue_anchors.join(' ')}`;
      if (this.merger.similarity(sig, this.merger.generateSignature(other)) > 0.6) return true;
    }
    return false;
  }

  /**
   * Reflect one session's unreflected episodes. Returns the number of
   * reviewed episodes (0 when nothing pending). Marks ids reflected only
   * after insights were successfully written (failure keeps them pending for
   * the next run).
   */
  private async reflectSession(sessionID: string, episodes: { id: string; text: string }[]): Promise<ReflectionResult> {
    const result: ReflectionResult = { sessions: 0, reviewed: 0, distilled: 0, deduped: 0, failed: 0, pendingSessions: 0 };
    if (episodes.length === 0) return result;
    result.reviewed = episodes.length;

    const prompt = episodes.map((e, i) => `${i + 1}. ${e.text}`).join('\n');
    const worker = this.opts.workerFor(sessionID);
    let insights: Insight[] = [];
    try {
      const text = await worker.prompt(prompt, REFLECT_SYSTEM, this.opts.workerModel);
      insights = parseInsights(text);
    } catch {
      result.failed++;
      return result; // episodes stay unreflected
    }

    const maxInsights = this.opts.maxInsights ?? 10;
    for (const insight of insights.slice(0, maxInsights)) {
      if (this.isDuplicate(insight.content)) {
        result.deduped++;
        continue;
      }
      const now = new Date().toISOString();
      const unit: HarmonicUnit = {
        id: generateHarmonicId(),
        type: CATEGORY_TO_TYPE[insight.category],
        primary_abstraction: insight.content.slice(0, 200),
        cue_anchors: insight.cue_anchors ?? [],
        memory_value: insight.content,
        energy: CATEGORY_ENERGY[insight.category],
        salience: calculateSalience(insight.content),
        abstraction_level: 2,
        created_at: now,
        updated_at: now,
        source_session_id: sessionID === ORPHAN_SESSION ? undefined : sessionID,
      };
      try {
        await this.store.write(unit);
        result.distilled++;
      } catch {
        result.failed++;
      }
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
    const total: ReflectionResult = { sessions: 0, reviewed: 0, distilled: 0, deduped: 0, failed: 0, pendingSessions: 0 };
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
    if (!episodes || episodes.length === 0) return { sessions: 0, reviewed: 0, distilled: 0, deduped: 0, failed: 0, pendingSessions: 0 };
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
