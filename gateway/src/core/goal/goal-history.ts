// gateway/src/core/goal/goal-history.ts
// Snapshot + pure replay for GoalState. History is the `goal.state.changed`
// stream; replay only reads DB rows and applies patches (no LLM, no fs writes).
import type Database from 'better-sqlite3';
import type { DomainEventStore } from '../events/domain-event-store';
import { normalizeGoalState, type GoalStateV3 } from './state-v3';

interface SnapshotRow {
  goal_id: string;
  version: number;
  state_json: string;
  created_at: string;
}

export class GoalSnapshotStore {
  constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS goal_snapshots (
        goal_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (goal_id, version)
      );
    `);
  }

  save(goalId: string, version: number, state: GoalStateV3, now: string): void {
    this.db.prepare(`
      INSERT INTO goal_snapshots (goal_id, version, state_json, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(goal_id, version) DO UPDATE SET
        state_json = excluded.state_json,
        created_at = excluded.created_at
    `).run(goalId, version, JSON.stringify(state), now);
  }

  latest(goalId: string, atVersion?: number): { version: number; state: GoalStateV3 } | null {
    const row = (atVersion === undefined
      ? this.db.prepare(
        'SELECT * FROM goal_snapshots WHERE goal_id = ? ORDER BY version DESC LIMIT 1',
      ).get(goalId)
      : this.db.prepare(
        'SELECT * FROM goal_snapshots WHERE goal_id = ? AND version <= ? ORDER BY version DESC LIMIT 1',
      ).get(goalId, atVersion)) as SnapshotRow | undefined;
    if (!row) return null;
    try {
      const raw = JSON.parse(row.state_json);
      if (!raw || typeof raw !== 'object') return null;
      return {
        version: row.version,
        state: normalizeGoalState(raw, raw.mafwDir ?? '', row.goal_id),
      };
    } catch {
      return null;
    }
  }

  /** Number of `goal.state.changed` events after `afterVersion` (snapshot cadence). */
  countStateChangesAfter(goalId: string, afterVersion: number): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS n FROM domain_events
      WHERE aggregate_type = 'goal' AND aggregate_id = ?
        AND type = 'goal.state.changed' AND aggregate_version > ?
    `).get(goalId, afterVersion) as { n: number };
    return Number(row?.n ?? 0);
  }
}

export interface GoalReplayStats {
  events: number;
  snapshots: number;
  fromSnapshotVersion: number;
}

export function replayGoalState(input: {
  goalId: string;
  events: DomainEventStore;
  snapshots: GoalSnapshotStore;
  atVersion?: number;
}): { state: GoalStateV3; stats: GoalReplayStats } | null {
  const snapshot = input.snapshots.latest(input.goalId, input.atVersion);
  let state: GoalStateV3 | null = snapshot?.state ?? null;
  let applied = 0;

  const events = input.events
    .listAggregate('goal', input.goalId, { afterVersion: snapshot?.version ?? 0 })
    .filter((event) => event.type === 'goal.state.changed'
      && (input.atVersion === undefined || event.aggregateVersion <= input.atVersion));

  for (const event of events) {
    const payload = event.payload as Record<string, any>;
    if (payload.reset === true && payload.resetState && typeof payload.resetState === 'object') {
      state = normalizeGoalState(payload.resetState, payload.resetState.mafwDir ?? '', input.goalId);
      applied += 1;
      continue;
    }
    // A patch without a baseline cannot be reconstructed (history must start
    // with a reset/snapshot). Fail closed instead of returning a partial state.
    if (!state) return null;
    if (!payload.patch || typeof payload.patch !== 'object') continue;

    const patch = payload.patch as Partial<GoalStateV3>;
    const round = typeof payload.round === 'number'
      ? payload.round
      : (typeof patch.round === 'number' ? patch.round : state.round);
    state = {
      ...state,
      ...patch,
      round,
      loop: round,
      stateVersion: typeof payload.stateVersion === 'number' ? payload.stateVersion : state.stateVersion,
      updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : state.updatedAt,
    } as GoalStateV3;
    applied += 1;
  }

  if (!state) return null;
  return {
    state,
    stats: {
      events: applied,
      snapshots: snapshot ? 1 : 0,
      fromSnapshotVersion: snapshot?.version ?? 0,
    },
  };
}
