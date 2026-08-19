// Simplified time-to-live map for plugin-side per-session bookkeeping
// (recall cursors). Lazy expiry only — no timer.
//
// NOTE: this mirrors `gateway/src/recall/ttl-map.ts`. The plugin cannot import
// from the gateway package (separate build contexts); keep the two in sync
// when changing TTL semantics.

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface TtlMapOptions<V> {
  onEvict?: (key: unknown, value: V) => void;
}

export class TtlMap<K, V> {
  private map = new Map<K, { value: V; expiresAt: number }>();
  private onEvict?: (key: K, value: V) => void;

  constructor(private ttlMs: number = DEFAULT_TTL_MS, options?: TtlMapOptions<V>) {
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
