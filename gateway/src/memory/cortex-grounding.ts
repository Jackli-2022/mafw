// Pure planner for the one-off cortical grounding backfill.
//
// Only exact `source_trace_ids` are used; units without traces are reported as
// `ungrounded` rather than guessed from session/time. A unit that already has
// an episode is skipped (idempotent).
import { deriveEpisodeId, type EpisodeLookup } from '../core/memory/provenance';
import type { EpisodeHint } from '../core/memory/harmonic-types';

export interface GroundingEntry {
  id: string;
  episode_id?: string;
  source_trace_ids?: string[];
}

export interface GroundingPlan {
  updates: Array<{ id: string; episodeId: string }>;
  unresolved: string[];
  ungrounded: number;
}

export function planCortexGrounding(
  entries: GroundingEntry[],
  lookup: EpisodeLookup,
): GroundingPlan {
  const updates: Array<{ id: string; episodeId: string }> = [];
  const unresolved: string[] = [];
  let ungrounded = 0;

  for (const entry of entries) {
    if (entry.episode_id) continue;
    const traceIds = entry.source_trace_ids ?? [];
    if (traceIds.length === 0) {
      ungrounded++;
      continue;
    }
    const episodeId = deriveEpisodeId(lookup, traceIds);
    if (episodeId) updates.push({ id: entry.id, episodeId });
    else unresolved.push(entry.id);
  }

  return { updates, unresolved, ungrounded };
}

export interface HintEpisode {
  episodeId: string;
  endedAt: number | null;
}

export interface HintEntry {
  id: string;
  episode_id?: string;
  episode_hint?: { episodeId: string };
  source_session_id?: string;
  created_at?: string;
}

export interface HintPlan {
  updates: Array<{ id: string; hint: EpisodeHint }>;
  skippedExisting: number;
  noSession: number;
  noEpisode: number;
  ambiguous: number;
}

/**
 * Hedged session-based links for units with no exact trace. `episode_id`
 * remains exact; hints are shadow-only and never overwrite it.
 */
export function planEpisodeHints(
  entries: HintEntry[],
  episodesBySession: Map<string, HintEpisode[]>,
): HintPlan {
  const updates: Array<{ id: string; hint: EpisodeHint }> = [];
  let skippedExisting = 0;
  let noSession = 0;
  let noEpisode = 0;
  let ambiguous = 0;

  for (const entry of entries) {
    if (entry.episode_id || entry.episode_hint) {
      skippedExisting++;
      continue;
    }
    const sessionId = entry.source_session_id;
    if (!sessionId) {
      noSession++;
      continue;
    }
    const episodes = episodesBySession.get(sessionId) ?? [];
    if (episodes.length === 0) {
      noEpisode++;
      continue;
    }
    if (episodes.length === 1) {
      updates.push({
        id: entry.id,
        hint: {
          episodeId: episodes[0].episodeId,
          basis: 'session_single',
          confidence: 0.8,
        },
      });
      continue;
    }
    const latest = episodes.reduce((best, episode) =>
      (episode.endedAt ?? 0) > (best.endedAt ?? 0) ? episode : best,
    );
    const created = entry.created_at ? Date.parse(entry.created_at) : NaN;
    if (Number.isFinite(created) && latest.endedAt != null && created >= latest.endedAt) {
      updates.push({
        id: entry.id,
        hint: {
          episodeId: latest.episodeId,
          basis: 'session_latest_after',
          confidence: 0.6,
        },
      });
    } else {
      ambiguous++;
    }
  }

  return { updates, skippedExisting, noSession, noEpisode, ambiguous };
}
