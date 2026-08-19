/** TypeScript port of Dart SessionCache for mobile session messages. */

export interface CachedMessage {
  id: string
  sessionID: string
  role: string
  text?: string
  timeCreated: number
  cachedAt: number
}

export interface SessionCacheOptions {
  /** TTL in milliseconds. Default 24h. */
  ttlMs?: number
  /** Max messages per session. Default 50. */
  limitPerSession?: number
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const DEFAULT_LIMIT = 50

export class SessionCache {
  private readonly ttlMs: number
  private readonly limit: number
  private readonly store = new Map<string, CachedMessage>()

  constructor(opts?: SessionCacheOptions) {
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS
    this.limit = opts?.limitPerSession ?? DEFAULT_LIMIT
  }

  put(msg: CachedMessage): void {
    this.store.set(msg.id, { ...msg, cachedAt: msg.cachedAt ?? Date.now() })
    this._enforceLimit(msg.sessionID)
  }

  get(id: string): CachedMessage | undefined {
    const msg = this.store.get(id)
    if (!msg) return undefined
    if (this._isExpired(msg)) {
      this.store.delete(id)
      return undefined
    }
    return msg
  }

  getBySession(sessionID: string): CachedMessage[] {
    const now = Date.now()
    return Array.from(this.store.values())
      .filter((m) => m.sessionID === sessionID && now - m.cachedAt < this.ttlMs)
      .sort((a, b) => a.timeCreated - b.timeCreated)
  }

  remove(id: string): void {
    this.store.delete(id)
  }

  clearSession(sessionID: string): void {
    for (const [id, msg] of this.store) {
      if (msg.sessionID === sessionID) this.store.delete(id)
    }
  }

  clear(): void {
    this.store.clear()
  }

  get size(): number {
    return this.store.size
  }

  // ── Private ──

  private _isExpired(msg: CachedMessage): boolean {
    return Date.now() - msg.cachedAt >= this.ttlMs
  }

  private _enforceLimit(sessionID: string): void {
    const sessionMsgs = this.getBySession(sessionID)
    if (sessionMsgs.length <= this.limit) return
    const excess = sessionMsgs.length - this.limit
    // Remove oldest (already sorted ascending by timeCreated)
    for (let i = 0; i < excess; i++) {
      this.store.delete(sessionMsgs[i].id)
    }
  }
}
