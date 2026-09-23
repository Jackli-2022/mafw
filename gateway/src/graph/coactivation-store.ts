import { GatewayDatabase } from '../memory/gateway-db';
import { config } from '../config';

export interface CoactivationUnitInput {
  id: string;
  source_session_id?: string;
  created_at?: string;
}

const DAY = 86400;

/**
 * SQLite-backed co-activation graph: units that "appeared together" (same
 * session, same goal via goal_sessions, or temporally close) get an undirected
 * weighted edge. Complements AnchorGraphStore (shared cue_anchors = lexical
 * association) with behavioural association (Hebbian co-activation).
 * Edge weights decay at read time; re-activation refreshes updated_at.
 */
export class CoactivationGraphStore {
  private db: GatewayDatabase;

  constructor(db: GatewayDatabase) {
    this.db = db;
  }

  private get rawDb(): any {
    return (this.db as any).db;
  }

  private nowSec(): number {
    return Math.floor(Date.now() / 1000);
  }

  private toSec(iso?: string): number | null {
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  }

  private normalizePair(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
  }

  private decay(weight: number, updatedAt: number): number {
    const halfLifeSec = config.search.graph.coactivation.halfLifeDays * DAY;
    if (halfLifeSec <= 0) return weight;
    return weight * Math.exp(-Math.max(0, this.nowSec() - updatedAt) / halfLifeSec);
  }

  upsertUnit(unit: CoactivationUnitInput): void {
    const id = unit.id;
    if (!id) return;
    const createdSec = this.toSec(unit.created_at);

    let goalId: string | null = null;
    if (unit.source_session_id) {
      const row = this.rawDb
        .prepare('SELECT goal_id FROM goal_sessions WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(unit.source_session_id) as { goal_id: string } | undefined;
      goalId = row?.goal_id ?? null;
    }

    this.rawDb
      .prepare(
        `INSERT INTO coactivation_units (unit_id, session_id, goal_id, created_at) VALUES (?,?,?,?)
         ON CONFLICT(unit_id) DO UPDATE SET
           session_id = excluded.session_id,
           goal_id = excluded.goal_id,
           created_at = excluded.created_at`,
      )
      .run(id, unit.source_session_id ?? null, goalId, createdSec);

    const cfg = config.search.graph.coactivation;
    if (!cfg.enabled) return;

    const contributions = new Map<string, { session: number; goal: number; time: number }>();
    const bump = (otherId: string, key: 'session' | 'goal' | 'time', val: number) => {
      if (otherId === id) return;
      if (!contributions.has(otherId)) contributions.set(otherId, { session: 0, goal: 0, time: 0 });
      const c = contributions.get(otherId)!;
      if (val > c[key]) c[key] = val;
    };

    // same session (hub-protected)
    if (unit.source_session_id) {
      const count = (this.rawDb
        .prepare('SELECT COUNT(*) AS c FROM coactivation_units WHERE session_id = ?')
        .get(unit.source_session_id) as { c: number }).c;
      if (count <= cfg.maxGroupSize) {
        const rows = this.rawDb
          .prepare('SELECT unit_id FROM coactivation_units WHERE session_id = ? AND unit_id != ? LIMIT ?')
          .all(unit.source_session_id, id, cfg.maxNeighbors) as Array<{ unit_id: string }>;
        for (const r of rows) bump(r.unit_id, 'session', 1);
      }
    }

    // same goal (hub-protected)
    if (goalId) {
      const count = (this.rawDb
        .prepare('SELECT COUNT(*) AS c FROM coactivation_units WHERE goal_id = ?')
        .get(goalId) as { c: number }).c;
      if (count <= cfg.maxGroupSize) {
        const rows = this.rawDb
          .prepare('SELECT unit_id FROM coactivation_units WHERE goal_id = ? AND unit_id != ? LIMIT ?')
          .all(goalId, id, cfg.maxNeighbors) as Array<{ unit_id: string }>;
        for (const r of rows) bump(r.unit_id, 'goal', 1);
      }
    }

    // temporal proximity (symmetric window on created_at)
    if (createdSec !== null) {
      const win = cfg.timeWindowSec;
      const rows = this.rawDb
        .prepare(
          'SELECT unit_id, created_at FROM coactivation_units WHERE unit_id != ? AND created_at BETWEEN ? AND ? LIMIT ?',
        )
        .all(id, createdSec - win, createdSec + win, cfg.maxNeighbors) as Array<{ unit_id: string; created_at: number }>;
      for (const r of rows) {
        const dt = Math.abs(r.created_at - createdSec);
        bump(r.unit_id, 'time', Math.max(0, 1 - dt / win));
      }
    }

    const insEdge = this.rawDb.prepare(
      `INSERT INTO coactivation_edges (unit_a, unit_b, session_co, goal_co, time_co, weight) VALUES (?,?,?,?,?,?)
       ON CONFLICT(unit_a, unit_b) DO UPDATE SET
         session_co = excluded.session_co,
         goal_co = excluded.goal_co,
         time_co = excluded.time_co,
         weight = excluded.weight,
         updated_at = unixepoch()`,
    );
    for (const [otherId, c] of contributions) {
      const [a, b] = this.normalizePair(id, otherId);
      const weight = cfg.sessionWeight * c.session + cfg.goalWeight * c.goal + cfg.timeWeight * c.time;
      if (weight <= 0) continue;
      insEdge.run(a, b, c.session, c.goal, c.time, weight);
    }
  }

  removeUnit(unitId: string): void {
    this.rawDb.prepare('DELETE FROM coactivation_units WHERE unit_id = ?').run(unitId);
    this.rawDb.prepare('DELETE FROM coactivation_edges WHERE unit_a = ? OR unit_b = ?').run(unitId, unitId);
  }

  rebuild(index: { entries: Array<{ id: string; source_session_id?: string; created_at?: string; superseded_by?: string }> }): void {
    this.clear();
    for (const entry of index.entries) {
      if (entry.superseded_by) continue;
      this.upsertUnit({ id: entry.id, source_session_id: entry.source_session_id, created_at: entry.created_at });
    }
  }

  getNeighbors(unitIds: string[], topK: number, exclude?: Set<string>): Map<string, Map<string, number>> {
    const result = new Map<string, Map<string, number>>();
    for (const unitId of unitIds) result.set(unitId, new Map());
    if (unitIds.length === 0) return result;

    const placeholders = unitIds.map(() => '?').join(',');
    const rows = this.rawDb
      .prepare(
        `SELECT unit_a, unit_b, weight, updated_at FROM coactivation_edges
         WHERE unit_a IN (${placeholders}) OR unit_b IN (${placeholders})`,
      )
      .all(...unitIds, ...unitIds) as Array<{ unit_a: string; unit_b: string; weight: number; updated_at: number }>;

    const idSet = new Set(unitIds);
    for (const row of rows) {
      const seed = idSet.has(row.unit_a) ? row.unit_a : row.unit_b;
      const nb = seed === row.unit_a ? row.unit_b : row.unit_a;
      if (idSet.has(nb)) continue;
      if (exclude?.has(nb)) continue;
      const bucket = result.get(seed)!;
      const w = this.decay(row.weight, row.updated_at);
      if (!bucket.has(nb) || bucket.get(nb)! < w) bucket.set(nb, w);
    }

    for (const [, bucket] of result) {
      const sorted = [...bucket.entries()].sort((x, y) => (y[1] - x[1]) || x[0].localeCompare(y[0]));
      bucket.clear();
      for (const [nb, w] of sorted.slice(0, topK)) bucket.set(nb, w);
    }
    return result;
  }

  stats(): { edges: number; session: number; goal: number; time: number } {
    const edges = (this.rawDb.prepare('SELECT COUNT(*) AS c FROM coactivation_edges').get() as { c: number }).c;
    const one = (col: string) =>
      (this.rawDb.prepare(`SELECT COUNT(*) AS c FROM coactivation_edges WHERE ${col} > 0`).get() as { c: number }).c;
    return { edges, session: one('session_co'), goal: one('goal_co'), time: one('time_co') };
  }

  clear(): void {
    this.rawDb.prepare('DELETE FROM coactivation_edges').run();
    this.rawDb.prepare('DELETE FROM coactivation_units').run();
  }
}
