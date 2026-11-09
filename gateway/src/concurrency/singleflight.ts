// gateway/src/concurrency/singleflight.ts
// Same-key calls merge into one in-flight promise; all callers share the result.

export class Singleflight {
  private readonly inflight = new Map<string, Promise<unknown>>();

  /**
   * Same-key concurrent calls merge into one promise; all callers share the result.
   *
   * ⚠ Type safety caveat: the internal map stores `Promise<unknown>`, and the
   * same-key cast back to `Promise<T>` is unchecked. If different call sites
   * use the same key with different `T` types, the later caller may get a
   * value of the wrong type. Keys should be namespaced to avoid this
   * (e.g. `manager:${projectDir}` rather than just `manager`).
   */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = fn().finally(() => {
      if (this.inflight.get(key) === promise) this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  get size(): number {
    return this.inflight.size;
  }

  has(key: string): boolean {
    return this.inflight.has(key);
  }

  clear(): void {
    this.inflight.clear();
  }
}
