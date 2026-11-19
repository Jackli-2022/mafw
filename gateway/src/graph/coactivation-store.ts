import { GatewayDatabase } from '../memory/gateway-db';
import { config } from '../config';
import {
  GraphNeighborCache,
  type CachedNeighbors,
  type NeighborCacheStats,
  type NeighborEntry,
  type PrewarmResult,
} from './graph-neighbor-cache';

export interface CoactivationUnitInput {
  id: string;
  source_session_id?: string;
  created_at?: string;
}

interface CoactivationEdgePayload {
  weight: number;
  /** Raw `updated_at`; decay is applied at read time, never baked in. */
  updatedAt: number | null;
}

const DAY = 86400;

/**
 * SQLite-backed co-activation graph: units that "appeared together" (same
 * session, same goal via goal_sessions, or temporally close) get an undirected
 * weighted edge. Complements AnchorGraphStore (shared cue_anchors = lexical
 * association) with behavioural association (Hebbian co-activation).
 * Edge weights decay at read time; re-activation refreshes updated_at.
 *
 * Reads are served from a bounded per-node LRU of edge rows (see
 * `graph-neighbor-cache.ts`). Entries keep the raw weight + updated_at, so
 * decay stays read-time, and they are dropped by `upsertUnit` / `removeUnit` /
 * `clear` plus invalidated whenever any write moves the connection's change
 * counters.
 */
export class CoactivationGraphStore {
  private db: GatewayDatabase;
  private neighborCache: GraphNeighborCache<CoactivationEdgePayload>;
  private loadNodeAStmt: any = null;
  private loadNodeBStmt: any = null;

  constructor(db: GatewayDatabase) {
    this.db = db;
    this.neighborCache = new GraphNeighborCache<CoactivationEdgePayload>(
      'coactivation',
      (db as any).db,
      nodeId => this.loadNodeEdges(nodeId),
    );
  }

  private get rawDb(): any {
    return (this.db as any).db;
  }

  /** One node's edge rows — the same set the SQL read path would fetch for it,
   *  split by edge direction and kept in `rowid` order. */
  private loadNodeEdges(nodeId: string): CachedNeighbors<CoactivationEdgePayload> {
    if (!this.loadNodeAStmt) {
      this.loadNodeAStmt = this.rawDb.prepare(
        'SELECT unit_b AS nb, weight, updated_at FROM coactivation_edges WHERE unit_a = ? ORDER BY rowid',
      );
      this.loadNodeBStmt = this.rawDb.prepare(
        'SELECT unit_a AS nb, weight, updated_at FROM coactivation_edges WHERE unit_b = ? ORDER BY rowid',
      );
    }
    const toEntry = (row: { nb: string; weight: number; updated_at: number | null }): NeighborEntry<CoactivationEdgePayload> => ({
      id: row.nb,
      payload: { weight: row.weight, updatedAt: row.updated_at },
    });
    return {
      unitA: (this.loadNodeAStmt.all(nodeId) as any[]).map(toEntry),
      unitB: (this.loadNodeBStmt.all(nodeId) as any[]).map(toEntry),
    };
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

  private decay(weight: number, updatedAt: number | null): number {
    const halfLifeSec = config.search.graph.coactivation.halfLifeDays * DAY;
    if (halfLifeSec <= 0) return weight;
    // `null` coerces to 0 exactly like the SQL path's arithmetic on an absent
    // updated_at (→ maximal decay), so mirror and SQL stay bit-identical.
    return weight * Math.exp(-Math.max(0, this.nowSec() - (updatedAt ?? 0)) / halfLifeSec);
  }

  upsertUnit(unit: CoactivationUnitInput): void {
    const id = unit.id;
    if (!id) return;
    this.neighborCache.invalidate(id);
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
    this.neighborCache.invalidate(unitId);
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

    const cached = this.neighborCache.ensure(unitIds);
    if (cached) {
      return this.getNeighborsFromCache(cached, result, unitIds, topK, exclude);
    }

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

  /**
   * Neighbours assembled from cached per-node adjacency. Same filters, same
   * read-time decay and the same per-seed sort/truncation as the SQL path
   * above — only the edge lookup changes.
   */
  private getNeighborsFromCache(
    cached: Map<string, CachedNeighbors<CoactivationEdgePayload>>,
    result: Map<string, Map<string, number>>,
    unitIds: string[],
    topK: number,
    exclude?: Set<string>,
  ): Map<string, Map<string, number>> {
    const idSet = new Set(unitIds);
    const bucketOf = (unitId: string) => result.get(unitId)!;
    const collect = (bucket: Map<string, number>, entries: NeighborEntry<CoactivationEdgePayload>[]) => {
      for (const entry of entries) {
        if (idSet.has(entry.id)) continue;
        if (exclude?.has(entry.id)) continue;
        const w = this.decay(entry.payload.weight, entry.payload.updatedAt);
        if (!bucket.has(entry.id) || bucket.get(entry.id)! < w) bucket.set(entry.id, w);
      }
    };
    for (const unitId of unitIds) {
      const bucket = bucketOf(unitId);
      const node = cached.get(unitId)!;
      collect(bucket, node.unitA);
      collect(bucket, node.unitB);
      const sorted = [...bucket.entries()].sort((x, y) => (y[1] - x[1]) || x[0].localeCompare(y[0]));
      bucket.clear();
      for (const [nb, w] of sorted.slice(0, topK)) bucket.set(nb, w);
    }
    return result;
  }

  /** Test/invalidation hook: drop every cached adjacency. */
  clearNeighborCache(): void {
    this.neighborCache.clear();
  }

  /** Optional warm-up (boot / background): explicit `{ enabled, loaded, failed }`
   *  so a disabled cache and an all-failed load are distinguishable. */
  prewarmNeighbors(ids: string[] = []): PrewarmResult {
    return this.neighborCache.prewarm(ids);
  }

  neighborCacheStats(): NeighborCacheStats {
    return this.neighborCache.stats();
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
    this.neighborCache.clear();
  }
}
