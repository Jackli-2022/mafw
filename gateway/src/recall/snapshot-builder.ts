/**
 * R8 snapshot builder (side-effecting, dependency-injected for tests).
 *
 * Builds the *expensive* retrieval result for a session in the background —
 * BM25 + expansion (+ dense if configured) + the R3 reranker, rendered with R6
 * neighbour bundling — and stores it in kv so the boundary path can serve it
 * inside the 100ms contract.
 */
import { RecallSnapshot, snapshotQueryFromTurns, SNAPSHOT_DEFAULTS, SnapshotConfig } from './recall-snapshot';
import { renderT1Lines, T1Hit, T1_POINTER_HEADER } from './verbatim-recall';
import type { RecallMemory } from './recall-context';
import type { FokZone } from './fok-gate';
import type { EpisodeHit } from './t1-episode-search';

export const SNAPSHOT_SCOPE = 'recall-snapshot';

/**
 * Minimal read surface for the rolling window: the durable logical turn list
 * plus a per-turn row read that also sees archived rows. `GatewayDatabase`
 * satisfies it directly (`listSessionTurns` / `readTurnRows`). The `turn_id`
 * alias is accepted because the durable column is `turn_seq` on `T1Turn` while
 * the legacy turn-summary shape calls the same slot `turn_id`.
 */
export interface RecentTurnsDb {
  listSessionTurns(sessionID: string): Array<{ turn_seq?: number; turn_id?: number }>;
  readTurnRows(sessionID: string, turnID: number): Array<{ source: string; content: string }>;
}

/**
 * Texts for the snapshot rolling window: user/assistant content of the last
 * `maxTurns` logical turns, oldest → newest.
 *
 * Uses active + archive rows. The hot-only `listTurns()` / `readTurn()` pair
 * collapsed to the newest instruction once extraction archived older turns,
 * which made the snapshot query (and its reranker probability) meaningless.
 */
export function recentTurnTextsFromDb(
  db: RecentTurnsDb,
  sessionID: string,
  maxTurns: number,
): string[] {
  // `slice(-0)` would return the WHOLE array, so the empty window is guarded.
  const limit = Number.isFinite(maxTurns) ? Math.max(0, Math.trunc(maxTurns)) : 0;
  if (limit <= 0) return [];
  const out: string[] = [];
  for (const turn of db.listSessionTurns(sessionID).slice(-limit)) {
    const turnID = turn.turn_seq ?? turn.turn_id;
    if (typeof turnID !== 'number') continue;
    for (const row of db.readTurnRows(sessionID, turnID)) {
      if (row.source === 'user_input' || row.source === 'assistant_reply') out.push(row.content);
    }
  }
  return out;
}

/** Reranker input must match the MCP path: abstraction + cue anchors. */
export function rerankerEntryFromRecall(memory: RecallMemory): {
  id: string;
  primary_abstraction: string;
  cue_anchors: string[];
  created_at?: string;
} {
  return {
    id: memory.id,
    primary_abstraction: memory.primary_abstraction,
    cue_anchors: memory.cue_anchors ?? [],
    created_at: memory.created_at,
  };
}

export interface SnapshotDeps {
  /** Recent turn texts, oldest → newest (from T1 active + archive). */
  recentTurnTexts: (sessionID: string, maxTurns: number) => string[];
  /** Cheap in-memory BM25 + expansion search (sync path); may be async when
   *  the dense channel (R2) needs a query embedding. */
  search: (query: string, topK: number) => RecallMemory[] | Promise<RecallMemory[]>;
  /**
   * Verification layer + R5 FOK in ONE step: returns the reranked memories and
   * the FOK zone derived from the same scoring pass (the reranker probability
   * is the feature that actually discriminates unanswerable questions; the
   * boundary path cannot afford it, this background path can). `top1prob` is
   * carried through for the hit-proxy calibration samples.
   */
  verify?: (query: string, memories: RecallMemory[]) => Promise<{ memories: RecallMemory[]; fokStatus?: FokZone; top1prob?: number }>;
  /** Render the pointer block (formatRecallContext + neighbours + status). */
  render: (memories: RecallMemory[], status?: FokZone) => string | null;
  /** V1 verbatim layer: dense search over t1 rounds (fail-open — absence
   *  keeps the snapshot harmonic-only). */
  searchT1?: (query: string, k: number) => Promise<T1Hit[]> | T1Hit[];
  /** Episode channel ("what happened"). Kernel only supplies this in live mode. */
  searchEpisodes?: (query: string, k: number) => Promise<EpisodeHit[]>;
  /** kv write (fail-open by the caller). */
  store: (sessionID: string, snapshot: RecallSnapshot) => void;
  now?: () => Date;
}

/**
 * Render the two recall layers as separate sections: episodes first ("what
 * happened"), knowledge second ("what it means"). Empty sections are omitted;
 * lines are appended until the char budget is exhausted.
 */
export function renderLayeredRecall(input: {
  episodes: EpisodeHit[];
  memories: Array<{ id: string; primary_abstraction: string }>;
  maxChars: number;
}): string {
  const maxChars = Math.max(0, Math.trunc(input.maxChars));
  if (maxChars === 0) return '';
  const sections: string[] = [];
  const lines: string[] = [];
  let used = 0;
  const push = (line: string): boolean => {
    const cost = line.length + (lines.length > 0 ? 1 : 0);
    if (used + cost > maxChars) return false;
    lines.push(line);
    used += cost;
    return true;
  };
  const flush = () => {
    if (lines.length > 0) sections.push(lines.join('\n'));
    lines.length = 0;
    used = 0;
  };

  if (input.episodes.length > 0) {
    push('## Episodes — what happened');
    for (const episode of input.episodes) {
      const date = episode.startedAt
        ? new Date(episode.startedAt).toISOString().slice(0, 10)
        : 'unknown';
      const actors = episode.actors
        .map((actor) => actor.replace(/^agent:/, ''))
        .join(',');
      const turns = episode.endTurn - episode.startTurn + 1;
      const head = `[t1ep:${episode.episodeId}] ${date}`;
      const rest = [actors, episode.intent ?? '', `(${turns} turns)`]
        .filter(Boolean)
        .join(' · ');
      const line = rest ? `${head} · ${rest}` : head;
      if (!push(line)) break;
    }
    flush();
  }

  if (input.memories.length > 0) {
    push('## Knowledge — what it means');
    for (const memory of input.memories) {
      if (!push(`- [${memory.id}] ${memory.primary_abstraction}`)) break;
    }
    flush();
  }

  const rendered = sections.join('\n\n');
  return rendered.length > maxChars ? rendered.slice(0, maxChars) : rendered;
}

/**
 * Build + store one snapshot. Returns null when there is nothing to build
 * (no recent turns, no hits, empty render) — the boundary path then falls back
 * to its live search.
 */
export async function buildSnapshot(
  deps: SnapshotDeps,
  sessionID: string,
  cfg: SnapshotConfig = SNAPSHOT_DEFAULTS,
  topK = 3,
): Promise<RecallSnapshot | null> {
  const maxTurns = cfg.maxTurns ?? SNAPSHOT_DEFAULTS.maxTurns;
  const texts = deps.recentTurnTexts(sessionID, maxTurns);
  const query = snapshotQueryFromTurns(texts, cfg.maxChars ?? SNAPSHOT_DEFAULTS.maxChars);
  if (!query.trim()) return null;

  // Episode channel: only supplied by the kernel when episodes are live.
  let episodes: EpisodeHit[] | undefined;
  if (deps.searchEpisodes) {
    try {
      const hits = await deps.searchEpisodes(query, cfg.t1K ?? SNAPSHOT_DEFAULTS.t1K ?? 3);
      if (hits.length > 0) episodes = hits;
    } catch { /* fail-open: harmonic-only snapshot */ }
  }

  // V1: T1 is an independent channel. Search it even when Harmonic has no
  // hits — verbatim evidence must be able to rescue an extraction miss.
  let t1Hits: T1Hit[] | undefined;
  let t1Lines: string | null = null;
  if (deps.searchT1) {
    const t1K = cfg.t1K ?? SNAPSHOT_DEFAULTS.t1K ?? 3;
    try {
      const hits = await deps.searchT1(query, t1K);
      if (hits && hits.length > 0) {
        const lines = renderT1Lines(hits, { k: t1K, maxChars: cfg.t1MaxChars ?? SNAPSHOT_DEFAULTS.t1MaxChars ?? 600 });
        if (lines) {
          t1Hits = hits.slice(0, t1K);
          t1Lines = lines;
        }
      }
    } catch { /* fail-open: harmonic-only snapshot */ }
  }

  let memories = await deps.search(query, topK * 2);
  // R3 + R5 in one scoring pass; fail-open to the un-reranked ranking. Skip the
  // expensive path entirely when there are no gist candidates.
  let fokStatus: FokZone | undefined;
  let top1prob: number | undefined;
  if (memories.length > 0 && deps.verify) {
    try {
      const verified = await deps.verify(query, memories);
      if (verified?.memories?.length) memories = verified.memories;
      fokStatus = verified?.fokStatus;
      top1prob = verified?.top1prob;
    } catch { /* fail-open: keep the un-reranked ranking, no gate */ }
  }
  let block = memories.length > 0 ? deps.render(memories, fokStatus) : null;
  if (episodes) {
    block = renderLayeredRecall({
      episodes,
      memories: memories.slice(0, topK).map((memory) => ({
        id: memory.id,
        primary_abstraction: memory.primary_abstraction,
      })),
      maxChars: cfg.t1MaxChars ?? 1200,
    }) || null;
  } else if (t1Lines) {
    block = block ? `${block}\n${t1Lines}` : `${T1_POINTER_HEADER}\n${t1Lines}`;
  }
  if (!block) return null;

  const snapshot: RecallSnapshot = {
    query,
    block,
    ids: memories.slice(0, topK).map(m => m.id),
    builtAt: (deps.now?.() ?? new Date()).toISOString(),
    fokStatus,
    top1prob,
    t1Hits,
    ...(episodes ? { episodes } : {}),
  };
  deps.store(sessionID, snapshot);
  return snapshot;
}
