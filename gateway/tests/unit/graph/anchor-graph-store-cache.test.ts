/**
 * AnchorGraphStore adjacency cache.
 *
 * The cache is a bounded per-node LRU of a node's edge rows: it is loaded with
 * the same query the SQL read path uses for that node, and stamped with SQLite's
 * change counters (`total_changes()` + `PRAGMA data_version`) so any write — ours,
 * a sibling store's, a migration's, a test's — invalidates it.
 *
 * Contract under test:
 *  1. cached reads are byte-identical to the SQL path — same ids, same weights,
 *     same `sharedAnchors`, same order (including the arbitrary-looking order of
 *     equal weights, which is what the topK cut at a hub seed sees);
 *  2. `upsertUnit` / `removeUnit` / `rebuild` / `clear` never return stale
 *     neighbours, and neither does a write that bypasses the store;
 *  3. `search.graph.neighborCache.enabled: false` reproduces the old SQL path;
 *  4. the LRU is bounded (node + entry caps) and does not grow per query.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { config } from '../../../src/config';
import { AnchorGraphStore } from '../../../src/graph/anchor-graph-store';
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import Sqlite from 'better-sqlite3';

type Row = [string, number, number];

function setNeighborCache(patch: Record<string, unknown> | null): void {
  const graph = config.search.graph as any;
  if (patch === null) delete graph.neighborCache;
  else graph.neighborCache = { ...(graph.neighborCache ?? {}), ...patch };
}

/** Read through the legacy SQL path without touching the store's setup. */
function withCacheOff<T>(fn: () => T): T {
  const graph = config.search.graph as any;
  const prev = graph.neighborCache;
  graph.neighborCache = { ...(prev ?? {}), enabled: false };
  try {
    return fn();
  } finally {
    graph.neighborCache = prev;
  }
}

/** Insertion-ordered rows: catches both membership and ordering drift. */
const ordered = (m: Map<string, { weight: number; sharedAnchors: number }>): Row[] =>
  [...m.entries()].map(([id, v]) => [id, v.weight, v.sharedAnchors] as Row);

describe('AnchorGraphStore adjacency cache', () => {
  let dir: string;
  let db: GatewayDatabase;
  let store: AnchorGraphStore;
  let raw: any;

  const sqlNeighbors = (ids: string[], topK: number, exclude?: Set<string>) =>
    withCacheOff(() => ordered(store.getNeighbors(ids, topK, exclude)));

  /** Overlapping anchor clusters → a mix of shared-anchor counts and IDF sums. */
  const seedGraph = () => {
    store.upsertUnit('a', ['alpha', 'shared']);
    store.upsertUnit('b', ['alpha']);
    store.upsertUnit('c', ['shared']);
    store.upsertUnit('d', ['alpha', 'beta']);
    store.upsertUnit('e', ['beta']);
    store.upsertUnit('f', ['gamma']);
    store.upsertUnit('g', ['gamma', 'shared']);
  };

  beforeEach(() => {
    setNeighborCache(null); // defaults: cache on, default caps
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-cache-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
    raw = (db as any).db;
    store = new AnchorGraphStore(db);
  });

  afterEach(() => {
    setNeighborCache(null);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('cached reads mirror SQL per id, per weight, per sharedAnchors (single + multi seed, exclude, topK)', () => {
    seedGraph();

    const cases: Array<{ ids: string[]; topK: number; exclude?: Set<string> }> = [
      { ids: ['a'], topK: 10 },
      { ids: ['a'], topK: 1 },
      { ids: ['a'], topK: 10, exclude: new Set(['b']) },
      { ids: ['c'], topK: 10, exclude: new Set(['a', 'g']) },
      { ids: ['a', 'c', 'e'], topK: 10 },
      { ids: ['a', 'c', 'e'], topK: 2 },
      { ids: ['f'], topK: 10 },
      { ids: ['zzz'], topK: 10 },
    ];

    for (const c of cases) {
      const cached = ordered(store.getNeighbors(c.ids, c.topK, c.exclude));
      expect(cached).toEqual(sqlNeighbors(c.ids, c.topK, c.exclude));
    }
    // Sanity: the fixture really produces neighbours (not an all-empty parity).
    expect(ordered(store.getNeighbors(['a'], 10)).length).toBeGreaterThan(0);
  });

  test('repeat reads are served from the cache and stay identical', () => {
    seedGraph();
    const reference = sqlNeighbors(['a', 'c'], 10);

    store.getNeighbors(['a', 'c'], 10);
    const first = store.neighborCacheStats();
    expect(first.nodes).toBeGreaterThan(0);
    expect(first.misses).toBe(2);

    for (let i = 0; i < 20; i++) {
      expect(ordered(store.getNeighbors(['a', 'c'], 10))).toEqual(reference);
    }
    const after = store.neighborCacheStats();
    expect(after.hits).toBe(first.hits + 40);
    expect(after.misses).toBe(first.misses); // no extra SQL for warm nodes
    expect(after.nodes).toBe(first.nodes);
    expect(after.entries).toBe(first.entries);

    // A warm read prepares no SQL against anchor_edges.
    const statements: string[] = [];
    const realPrepare = raw.prepare.bind(raw);
    const spy = jest.spyOn(raw, 'prepare').mockImplementation(((sql: unknown) => {
      if (/anchor_edges/i.test(String(sql))) statements.push(String(sql));
      return realPrepare(sql as string);
    }) as any);
    try {
      for (let i = 0; i < 20; i++) store.getNeighbors(['a', 'c'], 10);
    } finally {
      spy.mockRestore();
    }
    expect(statements).toEqual([]);
  });

  test('tie-heavy hub seed: topK cut picks exactly what SQL picks', () => {
    for (let i = 0; i < 60; i++) store.upsertUnit(`h${String(i).padStart(2, '0')}`, ['hub']);
    // Equalise every edge so the read path has to break ties (real hub anchors
    // produce identical IDF sums, so this is the common shape).
    raw.prepare('UPDATE anchor_edges SET weight = 1.0').run();

    for (const seed of ['h00', 'h30', 'h59']) {
      for (const topK of [1, 2, 3, 10, 100]) {
        expect(ordered(store.getNeighbors([seed], topK))).toEqual(sqlNeighbors([seed], topK));
        expect(ordered(store.getNeighbors([seed, 'h15'], topK))).toEqual(sqlNeighbors([seed, 'h15'], topK));
      }
    }
  });

  test('scrambled insertion order: tied weights follow SQLite rowid order, not id order', () => {
    // Insert in reverse so rowid order and id order disagree for the ties
    // (ascending insertion makes the two orders coincide and hides the bug).
    const ids = Array.from({ length: 40 }, (_, i) => `h${String(i).padStart(2, '0')}`);
    for (const id of [...ids].reverse()) store.upsertUnit(id, ['hub']);
    raw.prepare('UPDATE anchor_edges SET weight = 1.0').run();

    for (const seed of ['h00', 'h07', 'h20', 'h39']) {
      // topK 50 reaches past the first scan group, so the tie order of both
      // groups is exercised (a cut inside group 1 alone can look identical).
      for (const topK of [1, 2, 3, 5, 10, 20, 50]) {
        expect(ordered(store.getNeighbors([seed], topK))).toEqual(sqlNeighbors([seed], topK));
      }
    }

    // Multi-seed: the SQL result does not depend on the IN-list order, and the
    // cached path has to match both spellings.
    for (const topK of [3, 10, 40]) {
      const forward = ordered(store.getNeighbors(['h07', 'h20'], topK));
      const reverse = ordered(store.getNeighbors(['h20', 'h07'], topK));
      expect(forward).toEqual(sqlNeighbors(['h07', 'h20'], topK));
      expect(reverse).toEqual(sqlNeighbors(['h20', 'h07'], topK));
      expect(reverse).toEqual(forward);
    }
  });

  test('ties are ordered by rowid per scan group (explicit rowids, both directions)', () => {
    // Hand-built fixture: rowids disagree with ids in *both* directions, so any
    // id-based tie-break is visible from topK=2 on.
    const insert = raw.prepare(
      'INSERT INTO anchor_edges (rowid, unit_a, unit_b, shared_anchors, weight) VALUES (?,?,?,?,?)',
    );
    insert.run(1, 'm', 'zz', 1, 1.0); // neighbours above 'm', rowids reversed vs ids
    insert.run(2, 'm', 'x', 1, 1.0);
    insert.run(3, 'm', 'v', 1, 1.0);
    insert.run(4, 'm', 't', 1, 1.0);
    insert.run(5, 'k', 'm', 1, 1.0); // neighbours below 'm', rowids reversed vs ids
    insert.run(6, 'a', 'm', 1, 1.0);
    insert.run(7, 'c', 'm', 1, 1.0);
    insert.run(8, 'm', 'q', 1, 2.0); // heavier row exercises the weight sort

    for (const topK of [1, 2, 3, 5, 10]) {
      expect(ordered(store.getNeighbors(['m'], topK))).toEqual(sqlNeighbors(['m'], topK));
    }

    // Guard: the fixture must actually tell rowid order from id order.
    const sqlTop3 = sqlNeighbors(['m'], 3).map(row => row[0]);
    expect(sqlTop3).not.toEqual([...sqlTop3].sort());

    // Reverse-inserted star: for seed 'hub' every edge sits on the unit_b side,
    // where idx_anchor_edges_b yields id order (id asc) but SQL returns rowid
    // order (insertion). Same for the unit_a spelling.
    const insertAuto = raw.prepare(
      'INSERT INTO anchor_edges (unit_a, unit_b, shared_anchors, weight) VALUES (?,?,?,?)',
    );
    for (let i = 39; i >= 0; i--) insertAuto.run(`s${String(i).padStart(2, '0')}`, 'hub', 1, 1.0);
    for (const topK of [1, 2, 3, 5, 10, 20, 40]) {
      expect(ordered(store.getNeighbors(['hub'], topK))).toEqual(sqlNeighbors(['hub'], topK));
    }
    const starTop5 = sqlNeighbors(['hub'], 5).map(row => row[0]);
    expect(starTop5).not.toEqual([...starTop5].sort());
  });

  test('upsertUnit never returns the old neighbours', () => {
    store.upsertUnit('a', ['x']);
    store.upsertUnit('b', ['x']);
    expect(store.getNeighbors(['a'], 10).has('b')).toBe(true);

    // Re-anchoring a drops the a↔b edge in SQL; the cache must drop it too.
    store.upsertUnit('a', ['y']);
    expect(store.getNeighbors(['a'], 10).has('b')).toBe(false);
    expect(ordered(store.getNeighbors(['a'], 10))).toEqual(sqlNeighbors(['a'], 10));

    // ... and picks up the new one.
    store.upsertUnit('c', ['y']);
    expect(store.getNeighbors(['a'], 10).has('c')).toBe(true);
    expect(ordered(store.getNeighbors(['a'], 10))).toEqual(sqlNeighbors(['a'], 10));

    // Empty anchor list clears the unit's edges as well.
    store.upsertUnit('a', []);
    expect(store.getNeighbors(['a'], 10).size).toBe(0);
  });

  test('removeUnit evicts the node from the cache', () => {
    seedGraph();
    store.getNeighbors(['a', 'b'], 10);
    const before = store.neighborCacheStats();
    expect(before.nodes).toBe(2);

    store.removeUnit('b');
    expect(store.neighborCacheStats().nodes).toBe(1); // b evicted from the cache
    expect(store.getNeighbors(['b'], 10).size).toBe(0);
    expect(store.getNeighbors(['a'], 10).has('b')).toBe(false);
    expect(ordered(store.getNeighbors(['a'], 10))).toEqual(sqlNeighbors(['a'], 10));
  });

  test('rebuild replaces the cached adjacency instead of merging into it', () => {
    seedGraph();
    expect(store.getNeighbors(['a'], 10).size).toBeGreaterThan(0);

    store.rebuild({
      entries: [
        { id: 'n1', cue_anchors: ['fresh'] },
        { id: 'n2', cue_anchors: ['fresh'] },
        { id: 'n3', cue_anchors: ['fresh'], superseded_by: 'n2' },
      ],
    });

    expect(store.getNeighbors(['a'], 10).size).toBe(0);
    expect(store.getNeighbors(['n1'], 10).has('n2')).toBe(true);
    expect(store.getNeighbors(['n1'], 10).has('n3')).toBe(false);
    expect(ordered(store.getNeighbors(['n1'], 10))).toEqual(sqlNeighbors(['n1'], 10));
  });

  test('clear() drops the cached adjacency and the next read reloads it', () => {
    seedGraph();
    expect(store.getNeighbors(['a'], 10).size).toBeGreaterThan(0);

    store.clear();
    expect(store.neighborCacheStats()).toMatchObject({ nodes: 0, entries: 0 });
    expect(store.getNeighbors(['a'], 10).size).toBe(0);

    store.upsertUnit('p', ['later']);
    store.upsertUnit('q', ['later']);
    expect(store.getNeighbors(['p'], 10).has('q')).toBe(true);
    expect(ordered(store.getNeighbors(['p'], 10))).toEqual(sqlNeighbors(['p'], 10));
  });

  test('clearNeighborCache() is a real invalidation hook', () => {
    seedGraph();
    store.getNeighbors(['a', 'b'], 10);
    expect(store.neighborCacheStats().nodes).toBe(2);

    store.clearNeighborCache();
    expect(store.neighborCacheStats()).toMatchObject({ nodes: 0, entries: 0 });

    const reloaded = ordered(store.getNeighbors(['a'], 10));
    expect(store.neighborCacheStats().nodes).toBe(1);
    expect(reloaded).toEqual(sqlNeighbors(['a'], 10));
  });

  test('writes that bypass the store are detected, not served stale', () => {
    store.upsertUnit('a', ['x']);
    store.upsertUnit('b', ['x']);
    expect(store.getNeighbors(['a'], 10).has('c')).toBe(false); // warm 'a'

    // Foreign writer (another store / migration / test) inserts an edge.
    raw.prepare('INSERT INTO anchor_edges (unit_a, unit_b, shared_anchors, weight) VALUES (?,?,?,?)').run('a', 'c', 2, 9.5);

    const nb = store.getNeighbors(['a'], 10);
    expect(nb.get('c')).toEqual({ weight: 9.5, sharedAnchors: 2 });
    expect(store.neighborCacheStats().invalidations).toBeGreaterThan(0);
    expect(ordered(nb)).toEqual(sqlNeighbors(['a'], 10));
  });

  test('a store write after a foreign write does not lose the foreign change', () => {
    store.upsertUnit('a', ['x']);
    store.upsertUnit('b', ['x']);
    store.getNeighbors(['a', 'd'], 10); // warm 'a' and the (absent) 'd'

    // Foreign writer adds an edge that the following upsert does not touch.
    raw.prepare('INSERT INTO anchor_edges (unit_a, unit_b, shared_anchors, weight) VALUES (?,?,?,?)').run('d', 'e', 1, 7);
    store.upsertUnit('b', ['x', 'z']);

    expect(store.getNeighbors(['d'], 10).get('e')).toEqual({ weight: 7, sharedAnchors: 1 });
    expect(ordered(store.getNeighbors(['d'], 10))).toEqual(sqlNeighbors(['d'], 10));
  });

  test('writes from another connection invalidate the cache (data_version)', () => {
    store.upsertUnit('a', ['x']);
    store.upsertUnit('b', ['x']);
    expect(store.getNeighbors(['a'], 10).has('c')).toBe(false); // warm 'a'

    // Second connection on the same WAL file: `total_changes()` cannot see it,
    // only `PRAGMA data_version` moves.
    const other = new Sqlite(path.join(dir, 'test.db'));
    try {
      other.prepare('INSERT INTO anchor_edges (unit_a, unit_b, shared_anchors, weight) VALUES (?,?,?,?)').run('a', 'c', 3, 8.25);
    } finally {
      other.close();
    }

    const nb = store.getNeighbors(['a'], 10);
    expect(nb.get('c')).toEqual({ weight: 8.25, sharedAnchors: 3 });
    expect(store.neighborCacheStats().invalidations).toBeGreaterThan(0);
    expect(ordered(nb)).toEqual(sqlNeighbors(['a'], 10));
  });

  test('prewarmNeighbors reports what it actually did', () => {
    seedGraph();

    expect(store.prewarmNeighbors()).toEqual({ enabled: true, loaded: 0, failed: 0 });
    expect(store.prewarmNeighbors(['a', 'b'])).toEqual({ enabled: true, loaded: 2, failed: 0 });
    expect(store.neighborCacheStats().nodes).toBe(2);
    // Already-warm ids count as loaded and must not re-query.
    expect(store.prewarmNeighbors(['a', 'b'])).toEqual({ enabled: true, loaded: 2, failed: 0 });
    expect(store.neighborCacheStats().misses).toBe(2);

    setNeighborCache({ enabled: false });
    expect(store.prewarmNeighbors(['a', 'b'])).toEqual({ enabled: false, loaded: 0, failed: 2 });

    // Too dense to fit the entry budget → honestly reported as failed.
    setNeighborCache({ enabled: true, maxEntries: 1 });
    expect(store.prewarmNeighbors(['a'])).toEqual({ enabled: true, loaded: 0, failed: 1 });
  });

  test('switch off reproduces the old SQL path exactly (and holds nothing)', () => {
    seedGraph();

    const off = withCacheOff(() => {
      const rows = ordered(store.getNeighbors(['a', 'c'], 3));
      expect(store.neighborCacheStats()).toMatchObject({ enabled: false, nodes: 0 });
      return rows;
    });

    const on = ordered(store.getNeighbors(['a', 'c'], 3));
    expect(on).toEqual(off);
    expect(store.neighborCacheStats().nodes).toBe(2);
  });

  test('the LRU is bounded by node and entry caps without changing results', () => {
    seedGraph();
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    // SQL references first (the cache-off reads also leave the cache empty).
    const references = new Map(ids.map(id => [id, sqlNeighbors([id], 10)]));

    // Node cap: 7 units in the fixture, keep at most 3 at a time.
    setNeighborCache({ maxNodes: 3 });
    for (const id of ids) {
      expect(ordered(store.getNeighbors([id], 10))).toEqual(references.get(id)!);
    }
    const capped = store.neighborCacheStats();
    expect(capped.nodes).toBe(3);
    expect(capped.evictions).toBe(4);

    // Entry cap: a node denser than the whole budget rides the SQL path.
    setNeighborCache({ maxEntries: 1 });
    store.clearNeighborCache();
    expect(ordered(store.getNeighbors(['a'], 10))).toEqual(references.get('a')!);
    expect(store.neighborCacheStats()).toMatchObject({ nodes: 0, entries: 0 });
  });
});
