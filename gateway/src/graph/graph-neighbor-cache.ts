import { config } from '../config';

/**
 * In-memory adjacency cache shared by the SQLite graph stores
 * (`anchor_edges`, `coactivation_edges`).
 *
 * Shape: a bounded per-node LRU, **not** a whole-graph mirror. Measured on the
 * real store (635k anchor edges over 5.5k nodes, ~230 neighbours per node) a
 * full mirror costs ~840 ms to load and ~420 MB of heap to save ~0.4 ms per
 * recall pass — the per-seed query is index-backed and already cheap. A node's
 * adjacency is therefore loaded on demand (one query, same rows the SQL read
 * path would fetch) and kept only while it is both fresh and inside the budget.
 *
 * Freshness (`ensure`): an entry is stamped with SQLite's `total_changes()` and
 * `PRAGMA data_version`. `total_changes()` moves for *any* write on this
 * connection — our own upsert/remove, a sibling table, a migration, a test that
 * patches a row — so a write-free window is the only time entries are reused.
 * `data_version` additionally moves when another connection commits, covering a
 * second process on the same WAL file. Both are O(1), so a miss costs exactly
 * one indexed query (never worse than the SQL path) while a hit costs a map
 * walk.
 *
 * Nothing derived is ever stored: coactivation weight decays with time, so the
 * payload keeps `weight` + `updated_at` and the store applies decay per read,
 * exactly like its SQL path.
 *
 * Row order is part of the contract. `ORDER BY weight DESC` alone leaves equal
 * weights to SQLite, which returns them in `rowid` order *within each
 * MULTI-INDEX OR scan* (`unit_a` rows first, then `unit_b` rows) — measured on
 * the real store: an id-sorted tie-break disagreed with SQL for 2/600 nodes at
 * topK=3 and 17/600 at topK=10. The loader therefore fetches each direction
 * with `ORDER BY rowid` and the cache keeps that order verbatim.
 */

export interface NeighborEdgePayload {
  weight: number;
  /** `anchor_edges.shared_anchors` */
  sharedAnchors?: number;
  /** `coactivation_edges.updated_at`; decay input, applied at read time. */
  updatedAt?: number | null;
}

export interface NeighborEntry<P extends NeighborEdgePayload> {
  id: string;
  payload: P;
}

/** One cached node: its rows split by edge direction, each in rowid order. */
export interface CachedNeighbors<P extends NeighborEdgePayload> {
  /**
   * Rows where the node is `unit_a` (`anchor_edges.unit_a = node`), in `rowid`
   * order — SQLite's first `MULTI-INDEX OR` scan, and the order it keeps for
   * equal weights (the temp B-tree sort is rowid-ordered, not id-ordered).
   */
  unitA: NeighborEntry<P>[];
  /** Rows where the node is `unit_b`, in `rowid` order — the second scan. */
  unitB: NeighborEntry<P>[];
}

export interface PrewarmResult {
  /** Whether the cache was enabled for this call. */
  enabled: boolean;
  /** How many requested ids are now cached (freshly loaded or already valid). */
  loaded: number;
  /** Requested ids that could not be cached (cache off, load error, too dense). */
  failed: number;
}

export interface NeighborCacheStats {
  /** Store name (`anchor` / `coactivation`) — diagnostics only. */
  name: string;
  enabled: boolean;
  nodes: number;
  entries: number;
  hits: number;
  misses: number;
  /** Entries dropped because the database moved underneath them. */
  invalidations: number;
  evictions: number;
  maxNodes: number;
  maxEntries: number;
}

/** Node-count ceiling for the LRU (default 512). */
export const DEFAULT_NEIGHBOR_CACHE_MAX_NODES = 512;
/** Neighbour-entry ceiling for the LRU (default 50k ≈ a few MB). */
export const DEFAULT_NEIGHBOR_CACHE_MAX_ENTRIES = 50_000;

/**
 * `search.graph.neighborCache` (`{ enabled, maxNodes, maxEntries }`), default
 * ON. Read per call and defensively: the key is optional in config.yaml, and an
 * absent/short block must keep the fast path (fail-open). A config hot reload
 * flips it without rebuilding the stores.
 */
export function neighborCacheConfig(): { enabled: boolean; maxNodes: number; maxEntries: number } {
  const raw = (config as any)?.search?.graph?.neighborCache;
  const maxNodes = Number(raw?.maxNodes);
  const maxEntries = Number(raw?.maxEntries);
  return {
    enabled: raw?.enabled !== false,
    maxNodes: Number.isFinite(maxNodes) && maxNodes > 0 ? maxNodes : DEFAULT_NEIGHBOR_CACHE_MAX_NODES,
    maxEntries: Number.isFinite(maxEntries) && maxEntries > 0 ? maxEntries : DEFAULT_NEIGHBOR_CACHE_MAX_ENTRIES,
  };
}

/** Fetch one node's rows (both directions, each in rowid order) from the store's SQL. */
export type NeighborNodeLoader<P extends NeighborEdgePayload> = (nodeId: string) => CachedNeighbors<P>;

interface StampedNode<P extends NeighborEdgePayload> extends CachedNeighbors<P> {
  /** `total_changes()` when loaded (this connection's writes). */
  stamp: number;
  /** `PRAGMA data_version` when loaded (other connections' commits). */
  version: number;
}

export class GraphNeighborCache<P extends NeighborEdgePayload> {
  private nodes = new Map<string, StampedNode<P>>();
  private entries = 0;
  private hits = 0;
  private misses = 0;
  private invalidations = 0;
  private evictions = 0;
  private stampStmt: any = null;

  constructor(
    private readonly name: string,
    private readonly db: any,
    private readonly loadNode: NeighborNodeLoader<P>,
  ) {}

  /**
   * Per-node adjacency for every requested id, in request order, or null when
   * this read must ride the SQL path (cache off, load failure, or a node too
   * dense to keep inside the entry budget).
   */
  ensure(ids: string[]): Map<string, CachedNeighbors<P>> | null {
    const { enabled, maxNodes, maxEntries } = neighborCacheConfig();
    if (!enabled) {
      if (this.nodes.size > 0) this.reset();
      return null;
    }

    const snapshot = this.snapshot();
    const out = new Map<string, CachedNeighbors<P>>();
    for (const id of ids) {
      const hit = this.nodes.get(id);
      if (hit && hit.stamp === snapshot.stamp && hit.version === snapshot.version) {
        this.hits += 1;
        this.touch(id, hit);
        out.set(id, hit);
        continue;
      }
      if (hit) {
        this.invalidations += 1;
        this.drop(id);
      }
      this.misses += 1;

      let loaded: CachedNeighbors<P>;
      try {
        loaded = this.loadNode(id);
      } catch {
        return null;
      }
      const size = loaded.unitA.length + loaded.unitB.length;
      if (size > maxEntries) return null; // too dense to mirror: one SQL read
      const node: StampedNode<P> = {
        unitA: loaded.unitA,
        unitB: loaded.unitB,
        stamp: snapshot.stamp,
        version: snapshot.version,
      };
      this.nodes.set(id, node);
      this.entries += size;
      out.set(id, node);
      this.evict(maxNodes, maxEntries);
    }
    return out;
  }

  /**
   * Load the given ids into the cache ahead of a read. Explicit result instead
   * of a bare boolean: "no ids" and "cache off" must not look the same.
   */
  prewarm(ids: string[]): PrewarmResult {
    const unique = [...new Set(ids)];
    const { enabled } = neighborCacheConfig();
    if (!enabled) {
      if (this.nodes.size > 0) this.reset();
      return { enabled: false, loaded: 0, failed: unique.length };
    }
    const loaded = this.ensure(unique);
    const count = loaded?.size ?? 0;
    return { enabled: true, loaded: count, failed: unique.length - count };
  }

  /** Drop one node's entry (write path / explicit invalidation). */
  invalidate(id: string): void {
    this.drop(id);
  }

  /** Drop everything; the next reads reload from SQL. */
  clear(): void {
    this.reset();
  }

  stats(): NeighborCacheStats {
    const { enabled, maxNodes, maxEntries } = neighborCacheConfig();
    return {
      name: this.name,
      enabled,
      nodes: this.nodes.size,
      entries: this.entries,
      hits: this.hits,
      misses: this.misses,
      invalidations: this.invalidations,
      evictions: this.evictions,
      maxNodes,
      maxEntries,
    };
  }

  /** LRU touch: re-insert moves the node to the tail of the Map. */
  private touch(id: string, node: StampedNode<P>): void {
    this.nodes.delete(id);
    this.nodes.set(id, node);
  }

  private evict(maxNodes: number, maxEntries: number): void {
    while (this.nodes.size > maxNodes || this.entries > maxEntries) {
      const oldest = this.nodes.keys().next();
      if (oldest.done) return;
      this.evictions += 1;
      this.drop(oldest.value as string);
    }
  }

  private drop(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    this.nodes.delete(id);
    this.entries -= node.unitA.length + node.unitB.length;
  }

  private snapshot(): { stamp: number; version: number } {
    if (!this.stampStmt) this.stampStmt = this.db.prepare('SELECT total_changes() AS c');
    const stamp = (this.stampStmt.get() as { c: number }).c;
    const version = Number(this.db.pragma('data_version', { simple: true })) || 0;
    return { stamp, version };
  }

  private reset(): void {
    this.nodes = new Map<string, StampedNode<P>>();
    this.entries = 0;
    this.hits = 0;
    this.misses = 0;
    this.invalidations = 0;
    this.evictions = 0;
  }
}
