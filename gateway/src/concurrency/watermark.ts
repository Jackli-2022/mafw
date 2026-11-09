// gateway/src/concurrency/watermark.ts
// Tracks "has activity happened since a snapshot point" per key.
// Used to detect stale events (e.g., idle events with no prior activity).

export class Watermark {
  private readonly counters = new Map<string, number>();

  /** Snapshot the current counter value for a key (the "watermark"). */
  mark(key: string): number {
    return this.counters.get(key) ?? 0;
  }

  /** Record activity — increments the counter. */
  bump(key: string): void {
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  /** True if the counter has advanced past the watermark since it was taken. */
  hasActivitySince(key: string, watermark: number): boolean {
    return (this.counters.get(key) ?? 0) > watermark;
  }

  /** Remove a key's counter (next mark starts from 0). */
  delete(key: string): void {
    this.counters.delete(key);
  }

  /** Remove all counters. */
  clear(): void {
    this.counters.clear();
  }
}
