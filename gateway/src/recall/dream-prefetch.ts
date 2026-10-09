// D4a dream prefetch: nightly, per recently-active session, a worker
// generates the 3 most likely next-session queries; the first obs/capture of
// the day prefetches them into R8 snapshots.
export interface DreamTurn { session_id: string; status: string; last_ts?: number }

export function selectDreamSessions(
  turns: DreamTurn[],
  opts: { now: number; maxSessions: number; windowMs: number; isInternal: (sid: string) => boolean },
): string[] {
  const latest = new Map<string, number>();
  for (const t of turns) {
    if (t.status !== 'completed' || !t.last_ts) continue;
    const tsMs = t.last_ts * 1000;
    if (opts.now - tsMs > opts.windowMs) continue;
    if (opts.isInternal(t.session_id)) continue;
    latest.set(t.session_id, Math.max(latest.get(t.session_id) ?? 0, tsMs));
  }
  return [...latest.entries()].sort((a, b) => b[1] - a[1]).slice(0, opts.maxSessions).map(([sid]) => sid);
}

export function parseDreamQueries(reply: string, max: number): string[] {
  return (reply ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.length <= 200)
    .slice(0, max);
}

export const DREAM_SYSTEM = `Given the tail of a coding-agent session transcript, list the 3 most likely questions or tasks the user will open with next time. One per line, no numbering, no commentary.`;
