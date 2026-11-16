// Pure planner for the one-off cortical grounding backfill.
//
// Only exact `source_trace_ids` are used; units without traces are reported as
// `ungrounded` rather than guessed from session/time. A unit that already has
// an episode is skipped (idempotent).
import { deriveEpisodeId, type EpisodeLookup } from '../core/memory/provenance';

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
