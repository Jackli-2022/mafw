import { GatewayDatabase } from '../memory/gateway-db';
import { IDFStats } from '../retrieval/idf-stats';

export interface AnchorNeighbor {
  weight: number;
  sharedAnchors: number;
}

/**
 * SQLite-backed anchor graph for multi-hop retrieval (Memora-style). Maps
 * cue_anchors → units (anchor_units) and derives unit↔unit edges from shared
 * anchors (anchor_edges). Edge weight = sum of shared anchors' IDF (noisy/hub
 * anchors filtered by IDFStats). Kept in sync by the harmonic file-store write
 * path; rebuilt on gateway startup for consistency.
 */
export class AnchorGraphStore {
  private db: GatewayDatabase;
  private idf: IDFStats | null;

  constructor(db: GatewayDatabase, idf?: IDFStats) {
    this.db = db;
    this.idf = idf ?? null;
  }

  private get rawDb(): any {
    return (this.db as any).db;
  }

  private normalizePair(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
  }

  upsertUnit(unitId: string, anchors: string[]): void {
    if (!unitId || !Array.isArray(anchors)) return;
    const unique = [...new Set(anchors.filter(a => typeof a === 'string' && a.length > 0))];
    // 删除旧锚点行与旧边（全量重算该单元）
    this.rawDb.prepare('DELETE FROM anchor_units WHERE unit_id = ?').run(unitId);
    this.rawDb.prepare('DELETE FROM anchor_edges WHERE unit_a = ? OR unit_b = ?').run(unitId, unitId);

    if (unique.length === 0) return;

    // 1. 插入锚点行
    const insAnchor = this.rawDb.prepare('INSERT OR IGNORE INTO anchor_units (anchor, unit_id) VALUES (?, ?)');
    for (const anchor of unique) insAnchor.run(anchor, unitId);

    // 2. 对每个锚点，找共享单元并建边。边权 = 共享锚点的 IDF 和，IDF 由
    //    anchor_units 的度数现算（log(N/df)）：hub 锚点低增益、稀有锚点高增益，
    //    但不删除 hub 边（大脑"保留 hub + 降增益"，非跳过）。
    const n = (this.rawDb.prepare('SELECT COUNT(DISTINCT unit_id) AS c FROM anchor_units').get() as { c: number }).c;
    const idfOf = (anchor: string): number => {
      const df = (this.rawDb
        .prepare('SELECT COUNT(DISTINCT unit_id) AS c FROM anchor_units WHERE anchor = ?')
        .get(anchor) as { c: number }).c;
      // 平滑 IDF（恒正）：df=N（全共享）仍 >0，小语料不归零
      return Math.log(1 + n / Math.max(1, df));
    };
    const candidates = new Map<string, Set<string>>(); // unitId -> anchors
    const sel = this.rawDb.prepare('SELECT unit_id FROM anchor_units WHERE anchor = ?');
    for (const anchor of unique) {
      if (this.idf && this.idf.isNoisy(anchor)) continue;
      const rows = sel.all(anchor) as Array<{ unit_id: string }>;
      for (const row of rows) {
        if (row.unit_id === unitId) continue;
        if (!candidates.has(row.unit_id)) candidates.set(row.unit_id, new Set());
        candidates.get(row.unit_id)!.add(anchor);
      }
    }

    const insEdge = this.rawDb.prepare(
      `INSERT INTO anchor_edges (unit_a, unit_b, shared_anchors, weight) VALUES (?, ?, ?, ?)
       ON CONFLICT(unit_a, unit_b) DO UPDATE SET
         shared_anchors = excluded.shared_anchors,
         weight = excluded.weight,
         updated_at = unixepoch()`,
    );
    for (const [otherId, sharedAnchors] of candidates) {
      const [a, b] = this.normalizePair(unitId, otherId);
      const weight = [...sharedAnchors].reduce((sum, anchor) => sum + idfOf(anchor), 0);
      insEdge.run(a, b, sharedAnchors.size, weight);
    }
  }

  removeUnit(unitId: string): void {
    this.rawDb.prepare('DELETE FROM anchor_units WHERE unit_id = ?').run(unitId);
    this.rawDb.prepare('DELETE FROM anchor_edges WHERE unit_a = ? OR unit_b = ?').run(unitId, unitId);
  }

  getNeighbors(
    unitIds: string[],
    topK: number,
    exclude?: Set<string>,
  ): Map<string, AnchorNeighbor> {
    if (unitIds.length === 0) return new Map();
    const placeholders = unitIds.map(() => '?').join(',');
    const rows = this.rawDb
      .prepare(
        `SELECT unit_a, unit_b, shared_anchors, weight FROM anchor_edges
         WHERE unit_a IN (${placeholders}) OR unit_b IN (${placeholders})
         ORDER BY weight DESC`,
      )
      .all(...unitIds, ...unitIds) as Array<{ unit_a: string; unit_b: string; shared_anchors: number; weight: number }>;

    const idSet = new Set(unitIds);
    const result = new Map<string, AnchorNeighbor>();
    for (const row of rows) {
      const nb = idSet.has(row.unit_a) ? row.unit_b : row.unit_a;
      if (idSet.has(nb)) continue; // 命中-命中边跳过（非邻居）
      if (exclude?.has(nb)) continue;
      if (result.has(nb)) continue;
      result.set(nb, { weight: row.weight, sharedAnchors: row.shared_anchors });
      if (result.size >= topK) break;
    }
    return result;
  }

  getSharedAnchors(a: string, b: string): number {
    const [x, y] = this.normalizePair(a, b);
    const row = this.rawDb.prepare('SELECT shared_anchors FROM anchor_edges WHERE unit_a = ? AND unit_b = ?').get(x, y) as
      | { shared_anchors: number }
      | undefined;
    return row?.shared_anchors ?? 0;
  }

  rebuild(index: { entries: Array<{ id: string; cue_anchors?: string[]; superseded_by?: string }> }): void {
    this.clear();
    for (const entry of index.entries) {
      if (entry.superseded_by) continue;
      this.upsertUnit(entry.id, entry.cue_anchors ?? []);
    }
  }

  clear(): void {
    this.rawDb.prepare('DELETE FROM anchor_edges').run();
    this.rawDb.prepare('DELETE FROM anchor_units').run();
  }
}
