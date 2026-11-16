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

  const events = input.events;
  const PAGE = 500;
  let afterVersion = snapshot?.version ?? 0;
  let reachedEnd = false;

  while (!reachedEnd) {
    const page = events.listAggregate('goal', input.goalId, {
      afterVersion,
      limit: PAGE,
    });
    if (!page.length) break;

    for (const event of page) {
      if (input.atVersion !== undefined && event.aggregateVersion > input.atVersion) {
        reachedEnd = true;
        break;
      }
      if (event.type !== 'goal.state.changed') continue;
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
      const base: any = { ...state };
      // `undefined` values are dropped by JSON; the writer records them as
      // `unset` so replay clears the same keys the live merge cleared.
      if (Array.isArray(payload.unset)) {
        for (const key of payload.unset) delete base[key];
      }
      const round = typeof payload.round === 'number'
        ? payload.round
        : (typeof patch.round === 'number' ? patch.round : base.round);
      state = {
        ...base,
        ...patch,
        round,
        loop: round,
        stateVersion: typeof payload.stateVersion === 'number' ? payload.stateVersion : base.stateVersion,
        updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : base.updatedAt,
      } as GoalStateV3;
      applied += 1;
    }

    afterVersion = page[page.length - 1].aggregateVersion;
    if (reachedEnd || page.length < PAGE) break;
  }

  if (!state) return null;
  // Normalize derived fields (`nodeSession.revision`, `pendingQuestion.resumeNode`,
  // round/loop aliases) exactly like `load()` does, so replay == live row.
  state = normalizeGoalState(state, state.mafwDir ?? '', input.goalId);
  return {
    state,
    stats: {
      events: applied,
      snapshots: snapshot ? 1 : 0,
      fromSnapshotVersion: snapshot?.version ?? 0,
    },
  };
}
