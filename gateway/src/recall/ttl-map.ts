// Time-to-live map with lazy expiry. All per-session bookkeeping in MAFW
// (recall cursors, dedup sets, injection queues, worker pools) uses this so
// entries for ended/idle sessions are released instead of leaking.
//
// Semantics:
//  - `get` expires entries lazily but does NOT refresh the TTL.
//  - `getAndTouch` refreshes the TTL (for entries that prove activity).
//  - `delete` invokes an optional onEvict callback (e.g. to dispose pooled
//    workers). The callback receives the key and value; the map entry is
//    removed first, so the callback may safely re-set the key.
//
// NOTE: the plugin-side hook (`src/utils/ttl-map.ts`) carries a simplified
// copy of this class. Keep the two in sync when changing TTL semantics.
export interface TtlMapOptions<V> {
  onEvict?: (key: unknown, value: V) => void;
}

export class TtlMap<K, V> {
  private map = new Map<K, { value: V; expiresAt: number }>();
  private onEvict?: (key: K, value: V) => void;

  constructor(private ttlMs: number = 24 * 60 * 60 * 1000, options?: TtlMapOptions<V>) {
    this.onEvict = options?.onEvict;
  }

  set(key: K, value: V, ttlMs: number = this.ttlMs): void {
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      this.onEvict?.(key, entry.value);
      return undefined;
    }
    return entry.value;
  }

  /** Like get, but refreshes the TTL — use for entries whose access proves activity. */
  getAndTouch(key: K, ttlMs: number = this.ttlMs): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      this.onEvict?.(key, entry.value);
      return undefined;
    }
    entry.expiresAt = Date.now() + ttlMs;
    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.map.delete(key);
    this.onEvict?.(key, entry.value);
    return true;
  }

  /** Removes expired entries; returns how many were dropped. */
  sweep(now: number = Date.now()): number {
    let removed = 0;
    for (const [key, entry] of this.map) {
      if (entry.expiresAt <= now) {
        this.map.delete(key);
        this.onEvict?.(key, entry.value);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.map.size;
  }

  clear(): void {
    for (const [key, entry] of this.map) {
      this.onEvict?.(key, entry.value);
    }
    this.map.clear();
  }
}
