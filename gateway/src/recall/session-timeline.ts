// Ordered session timeline for T1 replay.
//
// T1 is the unconsolidated episodic trace. This module reconstructs a bounded,
// ordered view across active + archived turns, using the sparse event code when
// present and falling back to a deterministic raw summary. It never replaces
// the raw observations: callers can still resolve a trace via readTrace().
import type { GatewayDatabase, T1Observation, T1TurnFeature } from '../memory/gateway-db';

export interface TimelineTurn {
  traceId: string;
  sessionId: string;
  turnSeq: number;
  createdAt: number;
  archived: boolean;
  feature: T1TurnFeature | null;
  summary: string;
  rows: T1Observation[];
}

export interface SessionTimeline {
  sessionId: string;
  turns: TimelineTurn[];
  chars: number;
  truncated: boolean;
}

export interface TimelineOptions {
  fromTurn?: number;
  toTurn?: number;
  /** Explicit turn ids (turn_seq). Takes precedence over from/to. */
  turnSeqs?: number[];
  /** Hard char budget. Default 6000. */
  maxChars?: number;
  /** Include raw rows in the returned timeline (default false). */
  includeRows?: boolean;
}

const DEFAULT_MAX_CHARS = 6000;
const FIELD_CAP = 200;

function cap(text: string, max = FIELD_CAP): string {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? value.slice(0, max) : value;
}

function summarize(feature: T1TurnFeature | null, rows: T1Observation[]): string {
  if (feature) {
    const parts = [
      feature.intent ? `INTENT: ${cap(feature.intent)}` : '',
      feature.action ? `ACTION: ${cap(feature.action, 120)}` : '',
      feature.error ? `ERROR: ${cap(feature.error)}` : '',
      feature.decision ? `DECISION: ${cap(feature.decision)}` : '',
      feature.result ? `RESULT: ${cap(feature.result)}` : '',
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(' | ');
  }

  const user = rows.find((row) => row.source === 'user_input');
  const tool = rows.find((row) => row.source === 'tool_result');
  const assistant = [...rows].reverse().find((row) => row.source === 'assistant_reply');
  return [
    user ? `USER: ${cap(user.content)}` : '',
    tool ? `TOOL: ${cap(tool.content, 120)}` : '',
    assistant ? `ASSISTANT: ${cap(assistant.content)}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
}

/**
 * Reconstruct a session's turn sequence from `t1_turns` + active/archived rows.
 * The timeline is bounded by `maxChars`; when the budget is hit the last turn's
 * summary is truncated and `truncated` is set. No LLM calls.
 */
export function readSessionTimeline(
  db: GatewayDatabase,
  sessionId: string,
  opts: TimelineOptions = {},
): SessionTimeline {
  const maxChars = Math.max(0, Math.trunc(opts.maxChars ?? DEFAULT_MAX_CHARS));
  const includeRows = opts.includeRows === true;
  const all = db.listSessionTurns(sessionId);

  const wanted = opts.turnSeqs && opts.turnSeqs.length > 0 ? new Set(opts.turnSeqs) : null;
  const selected = all.filter((turn) => {
    if (wanted) return wanted.has(turn.turn_seq);
    if (opts.fromTurn != null && turn.turn_seq < opts.fromTurn) return false;
    if (opts.toTurn != null && turn.turn_seq > opts.toTurn) return false;
    return true;
  });

  const turns: TimelineTurn[] = [];
  let chars = 0;
  let truncated = false;

  for (const turn of selected) {
    const rows = db.readTurnRows(sessionId, turn.turn_seq);
    const feature = db.getTurnFeature(turn.trace_id);
    let summary = summarize(feature, rows);
    const rowChars = includeRows ? rows.reduce((sum, row) => sum + (row.content?.length ?? 0), 0) : 0;
    const cost = summary.length + rowChars;

    if (turns.length > 0 && chars + cost > maxChars) {
      truncated = true;
      break;
    }

    if (chars + cost > maxChars) {
      const room = maxChars - chars;
      if (room <= 0) {
        truncated = true;
        break;
      }
      summary = summary.slice(0, room);
      truncated = true;
    }

    turns.push({
      traceId: turn.trace_id,
      sessionId: turn.session_id,
      turnSeq: turn.turn_seq,
      createdAt: turn.created_at,
      archived: turn.archived_at != null,
      feature,
      summary,
      rows: includeRows ? rows : [],
    });
    chars += summary.length + rowChars;

    if (truncated) break;
  }

  if (selected.length > turns.length) truncated = true;
  return { sessionId, turns, chars, truncated };
}
