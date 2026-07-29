import { createHash } from 'crypto';

export class ObservationDeduplicator {
  private recentHashes: Map<string, number>;
  private windowMs: number;

  constructor(windowMs: number = 5 * 60 * 1000) {
    this.recentHashes = new Map();
    this.windowMs = windowMs;
  }

  deduplicate(observations: any[]): any[] {
    this.cleanExpired();

    const result: any[] = [];
    const now = Date.now();

    for (const obs of observations) {
      const hash = this.computeHash(obs);
      const existing = this.recentHashes.get(hash);

      if (existing !== undefined && (now - existing) < this.windowMs) {
        continue;
      }

      this.recentHashes.set(hash, now);
      result.push(obs);
    }

    return result;
  }

  clear(): void {
    this.recentHashes.clear();
  }

  private computeHash(obs: any): string {
    const content = `${obs.type}:${obs.phase}:${obs.content}`;
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  private cleanExpired(): void {
    const now = Date.now();
    for (const [hash, timestamp] of this.recentHashes) {
      if ((now - timestamp) >= this.windowMs) {
        this.recentHashes.delete(hash);
      }
    }
  }
}
