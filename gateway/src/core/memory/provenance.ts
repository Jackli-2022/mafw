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
