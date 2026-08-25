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
    provider: row.provider ?? null,
    agent: row.agent,
    userText: row.user_text,
    assistantText: row.assistant_text ?? undefined,
    workerRole: row.worker_role ?? undefined,
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
          tokens, cost, finish, model, provider, agent, user_text, assistant_text, worker_role)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
           provider = excluded.provider,
           agent = excluded.agent,
           user_text = excluded.user_text,
           assistant_text = excluded.assistant_text,
           worker_role = COALESCE(excluded.worker_role, trajectory_turns.worker_role)`,
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
        turn.provider ?? null,
        turn.agent,
        turn.userText,
        turn.assistantText ?? null,
        turn.workerRole ?? null,
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
      const allEvents = this.rawDb
        .prepare('SELECT * FROM trajectory_events WHERE session_id = ? ORDER BY turn_id ASC, seq ASC')
        .all(sessionID) as any[];
      if (allEvents.length === 0) {
        return { turns: [], events: [] };
      }
      return { turns: [], events: allEvents.map(rowToEvent) };
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

  nextTurnId(sessionID: string): number {
    const row = this.rawDb
      .prepare('SELECT COALESCE(MAX(turn_id), 0) AS m FROM trajectory_turns WHERE session_id = ?')
      .get(sessionID) as { m: number };
    return row.m + 1;
  }

  currentTurnId(sessionID: string): number {
    const row = this.rawDb
      .prepare('SELECT COALESCE(MAX(turn_id), 0) AS m FROM trajectory_turns WHERE session_id = ?')
      .get(sessionID) as { m: number };
    return row.m;
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

  getSessionTokenSummary(sessionID: string): {
    totalTokens: TokenCounts;
    totalCost: number;
    turnCount: number;
    avgTokensPerTurn: TokenCounts;
  } {
    const turns = this.rawDb
      .prepare('SELECT tokens, cost FROM trajectory_turns WHERE session_id = ?')
      .all(sessionID) as any[];

    const total: TokenCounts = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
    let totalCost = 0;

    for (const row of turns) {
      const t = row.tokens ? JSON.parse(row.tokens) : EMPTY_TOKENS;
      total.input += t.input || 0;
      total.output += t.output || 0;
      total.reasoning += t.reasoning || 0;
      total.cache.read += t.cache?.read || 0;
      total.cache.write += t.cache?.write || 0;
      totalCost += row.cost || 0;
    }

    const count = turns.length;
    const avg: TokenCounts = count > 0
      ? {
          input: Math.round(total.input / count),
          output: Math.round(total.output / count),
          reasoning: Math.round(total.reasoning / count),
          cache: {
            read: Math.round(total.cache.read / count),
            write: Math.round(total.cache.write / count),
          },
        }
      : { ...EMPTY_TOKENS };

    return { totalTokens: total, totalCost, turnCount: count, avgTokensPerTurn: avg };
  }

  getProjectTokenSummary(projectID: string): {
    totalTokens: TokenCounts;
    totalCost: number;
    turnCount: number;
    sessionCount: number;
  } {
    const rows = this.rawDb
      .prepare('SELECT tokens, cost, session_id FROM trajectory_turns WHERE project_id = ?')
      .all(projectID) as any[];

    const total: TokenCounts = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
    let totalCost = 0;
    const sessions = new Set<string>();

    for (const row of rows) {
      const t = row.tokens ? JSON.parse(row.tokens) : EMPTY_TOKENS;
      total.input += t.input || 0;
      total.output += t.output || 0;
      total.reasoning += t.reasoning || 0;
      total.cache.read += t.cache?.read || 0;
      total.cache.write += t.cache?.write || 0;
      totalCost += row.cost || 0;
      sessions.add(row.session_id);
    }

    return { totalTokens: total, totalCost, turnCount: rows.length, sessionCount: sessions.size };
  }

  getGlobalTokenSummary(): {
    totalTokens: TokenCounts;
    totalCost: number;
    turnCount: number;
    sessionCount: number;
  } {
    const rows = this.rawDb
      .prepare('SELECT tokens, cost, session_id FROM trajectory_turns')
      .all() as any[];

    const total: TokenCounts = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
    let totalCost = 0;
    const sessions = new Set<string>();

    for (const row of rows) {
      const t = row.tokens ? JSON.parse(row.tokens) : EMPTY_TOKENS;
      total.input += t.input || 0;
      total.output += t.output || 0;
      total.reasoning += t.reasoning || 0;
      total.cache.read += t.cache?.read || 0;
      total.cache.write += t.cache?.write || 0;
      totalCost += row.cost || 0;
      sessions.add(row.session_id);
    }

    return { totalTokens: total, totalCost, turnCount: rows.length, sessionCount: sessions.size };
  }

  getMemoryTokenSummary(): {
    totalTokens: TokenCounts;
    totalCost: number;
    turnCount: number;
    sessionCount: number;
    byRole: Record<string, { totalTokens: TokenCounts; totalCost: number; turnCount: number; sessionCount: number }>;
  } {
    const rows = this.rawDb
      .prepare('SELECT tokens, cost, session_id, worker_role FROM trajectory_turns WHERE worker_role IS NOT NULL')
      .all() as any[];

    const total: TokenCounts = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
    let totalCost = 0;
    const sessions = new Set<string>();
    const byRole: Record<string, { tokens: TokenCounts; cost: number; turns: number; sessions: Set<string> }> = {};

    for (const row of rows) {
      const t = row.tokens ? JSON.parse(row.tokens) : EMPTY_TOKENS;
      total.input += t.input || 0;
      total.output += t.output || 0;
      total.reasoning += t.reasoning || 0;
      total.cache.read += t.cache?.read || 0;
      total.cache.write += t.cache?.write || 0;
      totalCost += row.cost || 0;
      sessions.add(row.session_id);

      const role = row.worker_role || 'unknown';
      if (!byRole[role]) {
        byRole[role] = {
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
          turns: 0,
          sessions: new Set(),
        };
      }
      const r = byRole[role];
      r.tokens.input += t.input || 0;
      r.tokens.output += t.output || 0;
      r.tokens.reasoning += t.reasoning || 0;
      r.tokens.cache.read += t.cache?.read || 0;
      r.tokens.cache.write += t.cache?.write || 0;
      r.cost += row.cost || 0;
      r.turns++;
      r.sessions.add(row.session_id);
    }

    const byRoleResult: Record<string, { totalTokens: TokenCounts; totalCost: number; turnCount: number; sessionCount: number }> = {};
    for (const [role, data] of Object.entries(byRole)) {
      byRoleResult[role] = {
        totalTokens: data.tokens,
        totalCost: data.cost,
        turnCount: data.turns,
        sessionCount: data.sessions.size,
      };
    }

    return { totalTokens: total, totalCost, turnCount: rows.length, sessionCount: sessions.size, byRole: byRoleResult };
  }

  getProviderCostInWindow(provider: string, cutoffMs: number): number {
    const row = this.rawDb
      .prepare('SELECT SUM(cost) as total FROM trajectory_turns WHERE provider = ? AND turn_start_ms >= ?')
      .get(provider, cutoffMs) as { total: number | null };
    return row?.total || 0;
  }

  getProviderTotalCost(provider: string): number {
    const row = this.rawDb
      .prepare('SELECT SUM(cost) as total FROM trajectory_turns WHERE provider = ?')
      .get(provider) as { total: number | null };
    return row?.total || 0;
  }

  getProviderTokensInWindow(provider: string, cutoffMs: number): TokenCounts {
    const rows = this.rawDb
      .prepare('SELECT tokens FROM trajectory_turns WHERE provider = ? AND turn_start_ms >= ?')
      .all(provider, cutoffMs) as any[];
    return this.aggregateTokens(rows);
  }

  getProviderTotalTokens(provider: string): TokenCounts {
    const rows = this.rawDb
      .prepare('SELECT tokens FROM trajectory_turns WHERE provider = ?')
      .all(provider) as any[];
    return this.aggregateTokens(rows);
  }

  private aggregateTokens(rows: any[]): TokenCounts {
    const total: TokenCounts = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
    for (const row of rows) {
      const t = row.tokens ? JSON.parse(row.tokens) : EMPTY_TOKENS;
      total.input += t.input || 0;
      total.output += t.output || 0;
      total.reasoning += t.reasoning || 0;
      total.cache.read += t.cache?.read || 0;
      total.cache.write += t.cache?.write || 0;
    }
    return total;
  }

  getProviderEarliestTurnInWindow(provider: string, cutoffMs: number): number | null {
    const row = this.rawDb
      .prepare('SELECT MIN(turn_start_ms) as earliest FROM trajectory_turns WHERE provider = ? AND turn_start_ms >= ?')
      .get(provider, cutoffMs) as { earliest: number | null };
    return row?.earliest || null;
  }

  getDistinctProviders(): string[] {
    const rows = this.rawDb
      .prepare('SELECT DISTINCT provider FROM trajectory_turns WHERE provider IS NOT NULL')
      .all() as { provider: string }[];
    return rows.map(r => r.provider);
  }
}
