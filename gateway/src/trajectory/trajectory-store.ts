import { GatewayDatabase } from '../memory/gateway-db';
import { TrajectoryEvent, TrajectoryTurn, TokenCounts } from './types';

const EMPTY_TOKENS: TokenCounts = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };

function rowToEvent(row: any): TrajectoryEvent {
  return {
    id: row.id,
    projectID: row.project_id,
    sessionID: row.session_id,
    turnID: row.turn_id,
    seq: row.seq,
    eventType: row.event_type,
    toolName: row.tool_name ?? undefined,
    callID: row.call_id ?? undefined,
    toolState: row.tool_state ?? undefined,
    agent: row.agent ?? undefined,
    model: row.model ?? undefined,
    inputSummary: row.input_summary ?? undefined,
    outputSummary: row.output_summary ?? undefined,
    error: row.error ?? undefined,
    tokens: row.tokens ? JSON.parse(row.tokens) : undefined,
    cost: row.cost ?? undefined,
    finish: row.finish ?? undefined,
    timeMs: row.time_ms,
    durationMs: row.duration_ms ?? undefined,
  };
}

function rowToTurn(row: any): TrajectoryTurn {
  return {
    projectID: row.project_id,
    sessionID: row.session_id,
    turnID: row.turn_id,
    turnStartMs: row.turn_start_ms,
    turnEndMs: row.turn_end_ms,
    durationMs: row.duration_ms,
    toolCount: row.tool_count,
    toolErrorCount: row.tool_error_count,
    reasoningCount: row.reasoning_count,
    agentSwitchCount: row.agent_switch_count,
    tokens: row.tokens ? JSON.parse(row.tokens) : { ...EMPTY_TOKENS },
    cost: row.cost,
    finish: row.finish,
    model: row.model,
    agent: row.agent,
    userText: row.user_text,
  };
}

export class TrajectoryStore {
  constructor(
    private db: GatewayDatabase,
    private projectID: string,
  ) {}

  private get rawDb(): any {
    return (this.db as any).db;
  }

  recordEvent(evt: Omit<TrajectoryEvent, 'id'>): void {
    this.rawDb
      .prepare(
        `INSERT INTO trajectory_events
         (project_id, session_id, turn_id, seq, event_type, tool_name, call_id, tool_state,
          agent, model, input_summary, output_summary, error, tokens, cost, finish, time_ms, duration_ms)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        evt.projectID,
        evt.sessionID,
        evt.turnID,
        evt.seq,
        evt.eventType,
        evt.toolName ?? null,
        evt.callID ?? null,
        evt.toolState ?? null,
        evt.agent ?? null,
        evt.model ?? null,
        evt.inputSummary ?? null,
        evt.outputSummary ?? null,
        evt.error ?? null,
        evt.tokens ? JSON.stringify(evt.tokens) : null,
        evt.cost ?? null,
        evt.finish ?? null,
        evt.timeMs,
        evt.durationMs ?? null,
      );
  }

  upsertTurn(turn: TrajectoryTurn): void {
    this.rawDb
      .prepare(
        `INSERT INTO trajectory_turns
         (project_id, session_id, turn_id, turn_start_ms, turn_end_ms, duration_ms,
          tool_count, tool_error_count, reasoning_count, agent_switch_count,
          tokens, cost, finish, model, agent, user_text)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(session_id, turn_id) DO UPDATE SET
           turn_end_ms = excluded.turn_end_ms,
           duration_ms = excluded.duration_ms,
           tool_count = excluded.tool_count,
           tool_error_count = excluded.tool_error_count,
           reasoning_count = excluded.reasoning_count,
           agent_switch_count = excluded.agent_switch_count,
           tokens = excluded.tokens,
           cost = excluded.cost,
           finish = excluded.finish,
           model = excluded.model,
           agent = excluded.agent,
           user_text = excluded.user_text`,
      )
      .run(
        turn.projectID,
        turn.sessionID,
        turn.turnID,
        turn.turnStartMs,
        turn.turnEndMs,
        turn.durationMs,
        turn.toolCount,
        turn.toolErrorCount,
        turn.reasoningCount,
        turn.agentSwitchCount,
        JSON.stringify(turn.tokens),
        turn.cost,
        turn.finish,
        turn.model,
        turn.agent,
        turn.userText,
      );
  }

  getSessionTrajectory(
    sessionID: string,
    opts: { limit: number; beforeTurn?: number },
  ): { turns: TrajectoryTurn[]; events: TrajectoryEvent[] } {
    const turns = this.rawDb
      .prepare(
        `SELECT * FROM trajectory_turns WHERE session_id = ?
         ${opts.beforeTurn !== undefined ? 'AND turn_id < ?' : ''}
         ORDER BY turn_id DESC LIMIT ?`,
      )
      .all(...(opts.beforeTurn !== undefined ? [sessionID, opts.beforeTurn, opts.limit] : [sessionID, opts.limit])) as any[];
    if (turns.length === 0) {
      return { turns: [], events: [] };
    }
    const turnIDs = turns.map((t: any) => t.turn_id);
    const placeholders = turnIDs.map(() => '?').join(',');
    const events = (this.rawDb
      .prepare(
        `SELECT * FROM trajectory_events
         WHERE session_id = ? AND turn_id IN (${placeholders})
         ORDER BY turn_id ASC, seq ASC`,
      )
      .all(sessionID, ...turnIDs) as any[]).map(rowToEvent);
    return {
      turns: turns.map(rowToTurn),
      events,
    };
  }

  deleteSession(sessionID: string): void {
    this.rawDb.prepare('DELETE FROM trajectory_events WHERE session_id = ?').run(sessionID);
    this.rawDb.prepare('DELETE FROM trajectory_turns WHERE session_id = ?').run(sessionID);
  }

  pruneOlderThan(days: number): void {
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    this.rawDb.prepare('DELETE FROM trajectory_events WHERE created_at < ?').run(cutoff);
    this.rawDb.prepare('DELETE FROM trajectory_turns WHERE created_at < ?').run(cutoff);
  }
}
