// gateway/src/core/goal/goal-state-store.ts
// SQLite is the GoalState write authority (Phase 2). The JSON file stays as a
// best-effort mirror: a mirror failure never blocks a state transition, and a
// missing DB row lazily imports the legacy file on first read.
import type Database from 'better-sqlite3';
import type { DomainEventStore } from '../events/domain-event-store';
import { replayGoalState, type GoalSnapshotStore } from './goal-history';
import {
  archiveGoalStateFile,
  loadGoalStateFile,
  normalizeRevision,
  saveGoalStateFile,
} from './goal-state-file';
import {
  normalizeGoalState,
  type GoalStateV3,
  type GoalStateV3 as GoalState,
} from './state-v3';

export interface GoalStateHistoryMeta {
  /** Fields changed by this write (writeGoalState). */
  patch?: Partial<GoalStateV3>;
  /** Keys explicitly cleared by the patch (`undefined` values do not survive JSON). */
  unset?: string[];
  /** New revision / brand-new state: replay must replace, not merge. */
  reset?: boolean;
}

export interface GoalStateStoreOptions {
  events?: DomainEventStore;
  snapshots?: GoalSnapshotStore;
  snapshotEvery?: number;
  now?(): string;
}

export interface GoalStateBackend {
  load(mafwDir: string, goalId: string): GoalStateV3 | null;
  save(mafwDir: string, goalId: string, state: GoalStateV3, meta?: GoalStateHistoryMeta): void;
  archiveRevision(mafwDir: string, goalId: string, revision: number): void;
  list(): GoalStateV3[];
}

interface GoalStateDbRow {
  goal_id: string;
  revision: number;
  phase: string | null;
  next_action: string;
  state_json: string;
  updated_at: string;
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export class GoalStateStore implements GoalStateBackend {
  private readonly events?: DomainEventStore;
  private readonly snapshots?: GoalSnapshotStore;
  private readonly snapshotEvery: number;
  private readonly now: () => string;
  private replays = 0;
  private divergences = 0;
  private failures = 0;

  constructor(private readonly db: Database.Database, opts: GoalStateStoreOptions = {}) {
    this.events = opts.events;
    this.snapshots = opts.snapshots;
    this.snapshotEvery = Math.max(1, Math.trunc(opts.snapshotEvery ?? 20));
    this.now = opts.now ?? (() => new Date().toISOString());
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS goal_state (
        goal_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        phase TEXT,
        next_action TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS goal_state_revisions (
        goal_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        archived_at TEXT NOT NULL,
        PRIMARY KEY (goal_id, revision)
      );
    `);
  }

  private parse(row: GoalStateDbRow): GoalState | null {
    try {
      const raw = JSON.parse(row.state_json);
      if (!raw || typeof raw !== 'object') return null;
      return normalizeGoalState(raw, raw.mafwDir ?? '', row.goal_id);
    } catch {
      return null;
    }
  }

  load(mafwDir: string, goalId: string): GoalStateV3 | null {
    const row = this.db.prepare('SELECT * FROM goal_state WHERE goal_id = ?')
      .get(goalId) as GoalStateDbRow | undefined;
    if (row) {
      const parsed = this.parse(row);
      if (parsed) {
        const replayed = this.replayIfEnabled(goalId);
        if (replayed) {
          this.replays += 1;
          if (stableJson(replayed.state) !== stableJson(parsed)) {
            this.divergences += 1;
            console.warn(`[GoalHistory] divergence for ${goalId}: replay != goal_state`);
          }
          return replayed.state;
        }
        return parsed;
      }
    }

    const legacy = loadGoalStateFile(mafwDir, goalId);
    if (legacy) {
      this.save(mafwDir, goalId, legacy, { reset: true });
      return legacy;
    }

    // Row and legacy file are both gone: rebuild from history (pure replay).
    const replayed = this.replayFromHistory(goalId);
    if (replayed) {
      this.replays += 1;
      this.persistRow(goalId, replayed.state, this.now());
      try {
        saveGoalStateFile(mafwDir, goalId, replayed.state);
      } catch {
        /* mirror only */
      }
      return replayed.state;
    }
    return null;
  }

  replayStats(): { replays: number; divergences: number; failures: number } {
    return {
      replays: this.replays,
      divergences: this.divergences,
      failures: this.failures,
    };
  }

  private replayIfEnabled(goalId: string): { state: GoalStateV3 } | null {
    if (process.env.MAFW_GOAL_REPLAY_READ !== '1') return null;
    return this.replayFromHistory(goalId);
  }

  private replayFromHistory(goalId: string): { state: GoalStateV3 } | null {
    if (!this.events || !this.snapshots) return null;
    try {
      const replayed = replayGoalState({
        goalId,
        events: this.events,
        snapshots: this.snapshots,
      });
      if (!replayed) {
        this.failures += 1;
        return null;
      }
      return replayed;
    } catch (error: any) {
      this.failures += 1;
      console.warn(`[GoalHistory] replay failed for ${goalId}: ${error?.message ?? error}`);
      return null;
    }
  }

  private persistRow(goalId: string, state: GoalStateV3, now: string): void {
    this.db.prepare(`
      INSERT INTO goal_state (goal_id, revision, phase, next_action, state_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(goal_id) DO UPDATE SET
        revision = excluded.revision,
        phase = excluded.phase,
        next_action = excluded.next_action,
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `).run(
      goalId,
      normalizeRevision(state.revision),
      state.phase ?? null,
      state.nextAction,
      JSON.stringify(state),
      now,
    );
  }

  save(mafwDir: string, goalId: string, state: GoalStateV3, meta?: GoalStateHistoryMeta): void {
    const now = this.now();
    this.db.transaction(() => {
      this.persistRow(goalId, state, now);

      if (this.events) {
        const reset = meta?.reset === true;
        const appended = this.events.append({
          type: 'goal.state.changed',
          aggregateType: 'goal',
          aggregateId: goalId,
          occurredAt: state.updatedAt || now,
          audience: 'none',
          payload: {
            goalId,
            revision: normalizeRevision(state.revision),
            stateVersion: state.stateVersion ?? 0,
            round: state.round,
            loop: state.loop,
            updatedAt: state.updatedAt || now,
            reset,
            ...(reset ? { resetState: state } : {}),
            ...(meta?.patch ? { patch: meta.patch } : {}),
            ...(meta?.unset?.length ? { unset: meta.unset } : {}),
          },
        });
        if (this.snapshots) {
          const last = this.snapshots.latest(goalId);
          const changes = this.snapshots.countStateChangesAfter(goalId, last?.version ?? 0);
          // Baseline snapshot on the first event, on every reset, then every N
          // state changes (semantic goal.* events do not shift the cadence).
          if (!last || reset || changes >= this.snapshotEvery) {
            this.snapshots.save(goalId, appended.aggregateVersion, state, now);
          }
        }
      }
    })();

    try {
      saveGoalStateFile(mafwDir, goalId, state);
    } catch (error: any) {
      // Mirror only: the SQLite row is authoritative.
      console.warn(`[GoalState] json mirror failed for ${goalId}: ${error?.message ?? error}`);
    }
  }

  archiveRevision(mafwDir: string, goalId: string, revision: number): void {
    const current = this.load(mafwDir, goalId);
    const target = normalizeRevision(revision);
    if (!current) return;

    const snapshot: GoalStateV3 = { ...current, revision: target };
    this.db.prepare(`
      INSERT OR IGNORE INTO goal_state_revisions (goal_id, revision, state_json, archived_at)
      VALUES (?, ?, ?, ?)
    `).run(goalId, target, JSON.stringify(snapshot), new Date().toISOString());

    try {
      archiveGoalStateFile(mafwDir, goalId, target);
    } catch (error: any) {
      console.warn(`[GoalState] revision mirror failed for ${goalId}#${target}: ${error?.message ?? error}`);
    }
  }

  list(): GoalStateV3[] {
    const rows = this.db.prepare('SELECT * FROM goal_state ORDER BY updated_at ASC')
      .all() as GoalStateDbRow[];
    const out: GoalStateV3[] = [];
    const known = new Set<string>();
    for (const row of rows) {
      const parsed = this.parse(row);
      if (!parsed) continue;
      out.push(parsed);
      known.add(parsed.goalId);
    }

    // History-only goals (row + mirror both gone) must still be discovered so
    // boot recovery can rebuild them. Replay-recover them here.
    if (this.events && this.snapshots) {
      const ids = this.db.prepare(`
        SELECT DISTINCT aggregate_id AS id FROM domain_events
        WHERE aggregate_type = 'goal' AND type = 'goal.state.changed'
      `).all() as Array<{ id: string }>;
      for (const { id } of ids) {
        if (known.has(id)) continue;
        const replayed = this.replayFromHistory(id);
        if (!replayed) continue;
        this.persistRow(id, replayed.state, this.now());
        if (replayed.state.mafwDir) {
          try {
            saveGoalStateFile(replayed.state.mafwDir, id, replayed.state);
          } catch {
            /* mirror only */
          }
        }
        out.push(replayed.state);
        known.add(id);
      }
    }
    return out;
  }

  /** Test/debug helper: archived revision rows for one goal. */
  listRevisions(goalId: string): Array<{ revision: number; archivedAt: string }> {
    const rows = this.db.prepare(
      'SELECT revision, archived_at FROM goal_state_revisions WHERE goal_id = ? ORDER BY revision ASC',
    ).all(goalId) as Array<{ revision: number; archived_at: string }>;
    return rows.map((row) => ({ revision: row.revision, archivedAt: row.archived_at }));
  }
}
