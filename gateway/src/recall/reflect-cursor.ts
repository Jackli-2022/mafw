// Incremental reflection cursor: per-session list of episodic ids already fed
// to the reflector. Stored in the gateway DB (kv_store scope=reflect-cursor)
// so it moves with the unified database and is atomic with T1 operations.
import { GatewayDatabase } from '../memory/gateway-db';

export const MAX_IDS_PER_SESSION = 500;
const SCOPE = 'reflect-cursor';

export class ReflectCursor {
  constructor(private db: GatewayDatabase) {}

  reflectedIds(sessionID: string): Set<string> {
    const ids = this.db.kvGet<string[]>(SCOPE, sessionID);
    return new Set(Array.isArray(ids) ? ids : []);
  }

  isReflected(sessionID: string, id: string): boolean {
    const ids = this.db.kvGet<string[]>(SCOPE, sessionID);
    return Array.isArray(ids) && ids.includes(id);
  }

  /** Mark ids as reflected (atomic single-row upsert). */
  markReflected(sessionID: string, ids: string[]): void {
    if (ids.length === 0) return;
    const existing = this.db.kvGet<string[]>(SCOPE, sessionID) ?? [];
    const seen = new Set(existing);
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        existing.push(id);
      }
    }
    // bound the list (prune oldest beyond the cap)
    const trimmed = existing.length > MAX_IDS_PER_SESSION ? existing.slice(-MAX_IDS_PER_SESSION) : existing;
    this.db.kvSet(SCOPE, sessionID, trimmed);
  }

  /** Drop ids that no longer exist in the index (best-effort maintenance). */
  prune(liveIds: Set<string>): void {
    for (const { key, value } of this.db.kvAll<string[]>(SCOPE)) {
      if (!Array.isArray(value)) continue;
      const kept = value.filter((id) => liveIds.has(id));
      if (kept.length !== value.length) {
        if (kept.length === 0) this.db.kvDelete(SCOPE, key);
        else this.db.kvSet(SCOPE, key, kept);
      }
    }
  }
}
