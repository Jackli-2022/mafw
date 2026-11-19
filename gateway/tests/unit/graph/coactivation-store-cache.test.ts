/**
 * CoactivationGraphStore adjacency cache.
 *
 * The cache is a bounded per-node LRU of a node's edge rows. Payloads keep the
 * *raw* weight and `updated_at`; read-time decay is applied per call, so a cached
 * read cannot drift from the SQL read as time passes. Entries are stamped with
 * SQLite's change counters (`total_changes()` + `PRAGMA data_version`), which is
 * what keeps `UPDATE coactivation_edges SET updated_at = …` visible without an
 * explicit invalidation call.
 *
 * Time is frozen so cached/SQL decay values are exactly comparable.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { config } from '../../../src/config';
import { CoactivationGraphStore } from '../../../src/graph/coactivation-store';
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import Sqlite from 'better-sqlite3';

const DAY = 86_400;
const NOW_MS = Date.parse('2026-11-19T12:00:00.000Z');
const isoAgo = (secAgo: number) => new Date(NOW_MS - secAgo * 1000).toISOString();

type Bucket = Array<[string, number]>;
type Snapshot = Array<[string, Bucket]>;

/** Keep the per-seed map order (that is the caller-visible order) but sort seeds. */
const snap = (m: Map<string, Map<string, number>>): Snapshot =>
  [...m.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([seed, bucket]) => [seed, [...bucket.entries()] as Bucket]);

function setNeighborCache(patch: Record<string, unknown> | null): void {
  const graph = config.search.graph as any;
  if (patch === null) delete graph.neighborCache;
  else graph.neighborCache = { ...(graph.neighborCache ?? {}), ...patch };
}

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

describe('CoactivationGraphStore adjacency cache', () => {
  let dir: string;
  let db: GatewayDatabase;
  let store: CoactivationGraphStore;
  let raw: any;
  let nowSpy: any;

  const sqlNeighbors = (ids: string[], topK: number, exclude?: Set<string>) =>
    withCacheOff(() => snap(store.getNeighbors(ids, topK, exclude)));

  /** Same-session + same-goal + time-proximity signals, mixed session sizes. */
  const seedGraph = () => {
    raw.prepare('INSERT INTO goal_sessions (goal_id, session_id, phase, loop, created_at) VALUES (?,?,?,?,?)')
      .run('g1', 's1', 'execute', 1, isoAgo(1000));
    raw.prepare('INSERT INTO goal_sessions (goal_id, session_id, phase, loop, created_at) VALUES (?,?,?,?,?)')
      .run('g1', 's3', 'execute', 1, isoAgo(5 * DAY));

    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: isoAgo(100) });
    store.upsertUnit({ id: 'b', source_session_id: 's1', created_at: isoAgo(100) });
    store.upsertUnit({ id: 'c', source_session_id: 's2', created_at: isoAgo(50) });
    store.upsertUnit({ id: 'd', source_session_id: 's3', created_at: isoAgo(5 * DAY) });
    store.upsertUnit({ id: 'e', source_session_id: 's3', created_at: isoAgo(5 * DAY + 120) });
  };

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    setNeighborCache(null);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coact-cache-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
    raw = (db as any).db;
    store = new CoactivationGraphStore(db);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    setNeighborCache(null);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('cached reads mirror SQL per seed, per neighbour, per decayed weight', () => {
    seedGraph();

    const cases: Array<{ ids: string[]; topK: number; exclude?: Set<string> }> = [
      { ids: ['a'], topK: 10 },
      { ids: ['a'], topK: 1 },
      { ids: ['a'], topK: 10, exclude: new Set(['b']) },
      { ids: ['d'], topK: 10 },
      { ids: ['a', 'c', 'd'], topK: 10 },
      { ids: ['a', 'c', 'd'], topK: 1 },
      { ids: ['unknown'], topK: 10 },
    ];

    for (const c of cases) {
      const cached = snap(store.getNeighbors(c.ids, c.topK, c.exclude));
      expect(cached).toEqual(sqlNeighbors(c.ids, c.topK, c.exclude));
    }

    const a = store.getNeighbors(['a'], 10);
    expect(a.get('a')!.size).toBeGreaterThan(0);
    expect(a.get('a')!.get('b')).toBeGreaterThan(0);
  });

  test('repeat reads are served from the cache and stay identical', () => {
    seedGraph();
    const reference = sqlNeighbors(['a', 'c'], 10);

    store.getNeighbors(['a', 'c'], 10);
    const first = store.neighborCacheStats();
    expect(first).toMatchObject({ nodes: 2, misses: 2, hits: 0 });

    for (let i = 0; i < 20; i++) {
      expect(snap(store.getNeighbors(['a', 'c'], 10))).toEqual(reference);
    }
    const after = store.neighborCacheStats();
    expect(after.hits).toBe(40);
    expect(after.misses).toBe(2);
    expect(after.entries).toBe(first.entries);

    // A warm read prepares no SQL against coactivation_edges.
    const statements: string[] = [];
    const realPrepare = raw.prepare.bind(raw);
    const spy = jest.spyOn(raw, 'prepare').mockImplementation(((sql: unknown) => {
      if (/coactivation_edges/i.test(String(sql))) statements.push(String(sql));
      return realPrepare(sql as string);
    }) as any);
    try {
      for (let i = 0; i < 20; i++) store.getNeighbors(['a', 'c'], 10);
    } finally {
      spy.mockRestore();
    }
    expect(statements).toEqual([]);
  });

  test('decay is applied at read time, not baked into the cache', () => {
    seedGraph();
    const fresh = store.getNeighbors(['a'], 10).get('a')!.get('b')!;

    nowSpy.mockReturnValue(NOW_MS + 7 * DAY * 1000);
    const stale = store.getNeighbors(['a'], 10).get('a')!.get('b')!;

    expect(stale).toBeLessThan(fresh);
    expect(snap(store.getNeighbors(['a'], 10))).toEqual(sqlNeighbors(['a'], 10));
  });

  test('upsertUnit refreshes the cached edge (weight and updated_at)', () => {
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: isoAgo(100) });
    store.upsertUnit({ id: 'b', source_session_id: 's1', created_at: isoAgo(100) });
    expect(store.getNeighbors(['a'], 10).get('a')!.has('b')).toBe(true);

    // Age the edge in SQL (foreign writer): the cached row must be reloaded.
    raw.prepare('UPDATE coactivation_edges SET updated_at = ?')
      .run(Math.floor(NOW_MS / 1000) - 30 * DAY);
    const decayed = store.getNeighbors(['a'], 10).get('a')!.get('b')!;

    // Re-activation through the store touches updated_at in SQL; the reload
    // must carry the refreshed timestamp (and weight), not the aged one.
    store.upsertUnit({ id: 'b', source_session_id: 's1', created_at: isoAgo(0) });
    const refreshed = store.getNeighbors(['a'], 10).get('a')!.get('b')!;

    expect(refreshed).toBeGreaterThan(decayed);
    expect(snap(store.getNeighbors(['a'], 10))).toEqual(sqlNeighbors(['a'], 10));
    expect(snap(store.getNeighbors(['a', 'b'], 10))).toEqual(sqlNeighbors(['a', 'b'], 10));
  });

  test('removeUnit evicts the node from the cache', () => {
    seedGraph();
    store.getNeighbors(['a', 'b'], 10);
    expect(store.neighborCacheStats().nodes).toBe(2);

    store.removeUnit('b');
    expect(store.neighborCacheStats().nodes).toBe(1); // b evicted

    expect(store.getNeighbors(['a'], 10).get('a')!.has('b')).toBe(false);
    expect(store.getNeighbors(['b'], 10).get('b')!.size).toBe(0);
    expect(snap(store.getNeighbors(['a', 'b', 'c'], 10))).toEqual(sqlNeighbors(['a', 'b', 'c'], 10));
  });

  test('rebuild drops the previous adjacency instead of merging into it', () => {
    seedGraph();
    expect(store.getNeighbors(['a'], 10).get('a')!.size).toBeGreaterThan(0);

    store.rebuild({
      entries: [
        { id: 'n1', source_session_id: 'sx', created_at: isoAgo(10) },
        { id: 'n2', source_session_id: 'sx', created_at: isoAgo(10) },
        { id: 'n3', source_session_id: 'sx', created_at: isoAgo(10), superseded_by: 'n2' },
      ],
    });

    expect(store.neighborCacheStats()).toMatchObject({ nodes: 0, entries: 0 });
    expect(store.getNeighbors(['a'], 10).get('a')!.size).toBe(0);
    expect(store.getNeighbors(['n1'], 10).get('n1')!.has('n2')).toBe(true);
    expect(store.getNeighbors(['n1'], 10).get('n1')!.has('n3')).toBe(false);
    expect(snap(store.getNeighbors(['n1', 'n2'], 10))).toEqual(sqlNeighbors(['n1', 'n2'], 10));
  });

  test('clear() drops the cached adjacency and the next read reloads it', () => {
    seedGraph();
    expect(store.getNeighbors(['a'], 10).get('a')!.size).toBeGreaterThan(0);

    store.clear();
    expect(store.neighborCacheStats()).toMatchObject({ nodes: 0, entries: 0 });
    expect(store.getNeighbors(['a'], 10).get('a')!.size).toBe(0);

    store.upsertUnit({ id: 'p', source_session_id: 'sp', created_at: isoAgo(10) });
    store.upsertUnit({ id: 'q', source_session_id: 'sp', created_at: isoAgo(10) });
    expect(store.getNeighbors(['p'], 10).get('p')!.has('q')).toBe(true);
    expect(snap(store.getNeighbors(['p'], 10))).toEqual(sqlNeighbors(['p'], 10));
  });

  test('clearNeighborCache() forces a reload from SQL', () => {
    seedGraph();
    store.getNeighbors(['a', 'b'], 10);
    expect(store.neighborCacheStats().nodes).toBe(2);

    store.clearNeighborCache();
    expect(store.neighborCacheStats()).toMatchObject({ nodes: 0, entries: 0 });

    const reloaded = snap(store.getNeighbors(['a'], 10));
    expect(store.neighborCacheStats().nodes).toBe(1);
    expect(reloaded).toEqual(sqlNeighbors(['a'], 10));
  });

  test('foreign updated_at rewrites are detected (no stale decay)', () => {
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: isoAgo(10) });
    store.upsertUnit({ id: 'b', source_session_id: 's1', created_at: isoAgo(10) });
    const fresh = store.getNeighbors(['a'], 10).get('a')!.get('b')!; // cached

    raw.prepare('UPDATE coactivation_edges SET updated_at = ?')
      .run(Math.floor(NOW_MS / 1000) - 30 * DAY);

    const stale = store.getNeighbors(['a'], 10).get('a')!.get('b')!;
    expect(stale).toBeLessThan(fresh);
    expect(store.neighborCacheStats().invalidations).toBeGreaterThan(0);
    expect(snap(store.getNeighbors(['a'], 10))).toEqual(sqlNeighbors(['a'], 10));
  });

  test('a store write after a foreign write does not lose the foreign change', () => {
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: isoAgo(10) });
    store.upsertUnit({ id: 'b', source_session_id: 's1', created_at: isoAgo(10) });
    store.getNeighbors(['a', 'd'], 10); // warm 'a' and the (absent) 'd'

    // Foreign writer adds an edge the following upsert does not touch.
    raw.prepare(
      'INSERT INTO coactivation_edges (unit_a, unit_b, session_co, goal_co, time_co, weight) VALUES (?,?,?,?,?,?)',
    ).run('d', 'e', 0, 0, 0.5, 0.15);
    store.upsertUnit({ id: 'b', source_session_id: 's2', created_at: isoAgo(5) });

    expect(store.getNeighbors(['d'], 10).get('d')!.has('e')).toBe(true);
    expect(snap(store.getNeighbors(['d'], 10))).toEqual(sqlNeighbors(['d'], 10));
  });

  test('writes from another connection invalidate the cache (data_version)', () => {
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: isoAgo(10) });
    store.upsertUnit({ id: 'b', source_session_id: 's1', created_at: isoAgo(10) });
    const fresh = store.getNeighbors(['a'], 10).get('a')!.get('b')!; // warm 'a'

    // Second connection on the same WAL file: `total_changes()` cannot see it,
    // only `PRAGMA data_version` moves.
    const other = new Sqlite(path.join(dir, 'test.db'));
    try {
      other.prepare('UPDATE coactivation_edges SET updated_at = ?')
        .run(Math.floor(NOW_MS / 1000) - 30 * DAY);
    } finally {
      other.close();
    }

    const stale = store.getNeighbors(['a'], 10).get('a')!.get('b')!;
    expect(stale).toBeLessThan(fresh);
    expect(store.neighborCacheStats().invalidations).toBeGreaterThan(0);
    expect(snap(store.getNeighbors(['a'], 10))).toEqual(sqlNeighbors(['a'], 10));
  });

  test('prewarmNeighbors reports what it actually did', () => {
    seedGraph();

    expect(store.prewarmNeighbors()).toEqual({ enabled: true, loaded: 0, failed: 0 });
    expect(store.prewarmNeighbors(['a', 'b'])).toEqual({ enabled: true, loaded: 2, failed: 0 });
    expect(store.neighborCacheStats().nodes).toBe(2);
    expect(store.prewarmNeighbors(['a'])).toEqual({ enabled: true, loaded: 1, failed: 0 });
    expect(store.neighborCacheStats().misses).toBe(2);

    setNeighborCache({ enabled: false });
    expect(store.prewarmNeighbors(['a', 'b'])).toEqual({ enabled: false, loaded: 0, failed: 2 });

    setNeighborCache({ enabled: true, maxEntries: 1 });
    expect(store.prewarmNeighbors(['a'])).toEqual({ enabled: true, loaded: 0, failed: 1 });
  });

  test('switch off reproduces the old SQL path exactly (and holds nothing)', () => {
    seedGraph();

    const off = withCacheOff(() => {
      const rows = snap(store.getNeighbors(['a', 'c'], 2));
      expect(store.neighborCacheStats()).toMatchObject({ enabled: false, nodes: 0 });
      return rows;
    });

    const on = snap(store.getNeighbors(['a', 'c'], 2));
    expect(on).toEqual(off);
    expect(store.neighborCacheStats().nodes).toBe(2);
  });

  test('the LRU is bounded by node and entry caps without changing results', () => {
    seedGraph();
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const references = new Map(ids.map(id => [id, sqlNeighbors([id], 10)]));

    setNeighborCache({ maxNodes: 2 });
    for (const id of ids) {
      expect(snap(store.getNeighbors([id], 10))).toEqual(references.get(id)!);
    }
    const capped = store.neighborCacheStats();
    expect(capped.nodes).toBe(2);
    expect(capped.evictions).toBe(3);

    // Entry cap: a node denser than the whole budget rides the SQL path.
    setNeighborCache({ maxEntries: 1 });
    store.clearNeighborCache();
    expect(snap(store.getNeighbors(['a'], 10))).toEqual(references.get('a')!);
    expect(store.neighborCacheStats()).toMatchObject({ nodes: 0, entries: 0 });
  });
});
