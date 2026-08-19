// Turn completion detection (pure). A turn = one user_input plus the agent's
// full response (assistant_reply / tool_result / reasoning observations).
// sqlite created_at uses unixepoch() seconds — timestamps are compared in
// seconds throughout.

export interface TurnEval {
  session_id: string;
  turn_id: number;
  count: number;
  has_user_input: number;
  response_count: number;
  last_ts: number;
}

export interface CompletionOptions {
  staleMs: number;
  nowSec?: number;
}

/**
 * A turn is complete when:
 *  a) it has a user_input AND at least one non-empty response, or
 *  b) a newer turn exists for the same session (handled by completeTurns), or
 *  c) it went silent for longer than staleMs (covers the final turn whose
 *     agent response produced no further activity).
 */
export function isTurnComplete(turn: TurnEval, opts: CompletionOptions): boolean {
  if (!turn || turn.count <= 0) return false;
  if (turn.has_user_input && turn.response_count > 0) return true;
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (turn.last_ts > 0 && nowSec - turn.last_ts > opts.staleMs / 1000) return true;
  return false;
}

/**
 * Selects the completed turns from a list, grouped per session. A turn with a
 * newer sibling turn_id is always complete (its successor's user message
 * closed it), regardless of staleness.
 */
export function completeTurns(turns: TurnEval[], opts: CompletionOptions): TurnEval[] {
  const maxBySession = new Map<string, number>();
  for (const t of turns) {
    const m = maxBySession.get(t.session_id) ?? 0;
    if (t.turn_id > m) maxBySession.set(t.session_id, t.turn_id);
  }
  return turns.filter((t) => {
    const maxTurn = maxBySession.get(t.session_id) ?? t.turn_id;
    if (t.turn_id < maxTurn) return true;
    return isTurnComplete(t, opts);
  });
}
