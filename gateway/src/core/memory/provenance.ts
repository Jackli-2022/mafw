/**
 * Exact T1 provenance helpers.
 *
 * A Harmonic memory may cite permanent T1 trace ids captured at write time.
 * Unknown/fabricated ids are dropped (the memory still writes); merges union
 * the incoming and existing sets so provenance is never silently lost.
 */
export const MAX_SOURCE_TRACE_IDS = 20;

/** Validate untrusted `sourceTraceIds` against the live T1 identity table. */
export function normalizeSourceTraceIds(
  value: unknown,
  exists: (traceId: string) => boolean,
): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim().replace(/^#?t1:/, '');
    if (!id || out.includes(id)) continue;
    try {
      if (!exists(id)) continue;
    } catch {
      continue;
    }
    out.push(id);
    if (out.length >= MAX_SOURCE_TRACE_IDS) break;
  }
  return out;
}

/** Union incoming-first, dedupe, cap at MAX_SOURCE_TRACE_IDS. Empty → undefined. */
export function unionSourceTraceIds(
  incoming?: string[],
  existing?: string[],
): string[] | undefined {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of [incoming, existing]) {
    for (const id of list ?? []) {
      if (typeof id !== 'string' || !id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= MAX_SOURCE_TRACE_IDS) return out;
    }
  }
  return out.length ? out : undefined;
}

/** Minimal lookup the episode index can satisfy. */
export interface EpisodeLookup {
  findEpisodeByTrace(traceId: string): string | null;
}

/**
 * Derive the first source trace's episode. A memory may draw from several
 * episodes; the field is a soft hint, not a foreign key. Fail-open: a lookup
 * error leaves the memory ungrounded rather than failing the write.
 */
export function deriveEpisodeId(
  lookup: EpisodeLookup | null | undefined,
  traceIds: readonly string[] | undefined,
): string | null {
  const seen = new Set<string>();
  for (const raw of traceIds ?? []) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    try {
      const episodeId = lookup?.findEpisodeByTrace(id);
      if (episodeId) return episodeId;
    } catch {
      /* fail-open: incident lookup must not fail the write */
    }
    if (seen.size >= MAX_SOURCE_TRACE_IDS) break;
  }
  return null;
}
