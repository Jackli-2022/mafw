import { SessionCache } from "./session-cache"
import type { CachedMessage } from "./session-cache"

function msg(id: string, sessionID: string, timeCreated: number, text?: string): CachedMessage {
  return { id, sessionID, role: "user", text, timeCreated, cachedAt: Date.now() }
}

describe("SessionCache", () => {
  let cache: SessionCache

  beforeEach(() => {
    cache = new SessionCache()
  })

  test("put and get stores message", () => {
    const m = msg("m1", "s1", 1, "hello")
    cache.put(m)
    expect(cache.get("m1")).toMatchObject({ id: "m1", text: "hello" })
  })

  test("get returns undefined for missing id", () => {
    expect(cache.get("nope")).toBeUndefined()
  })

  test("getBySession returns messages for a session sorted by timeCreated", () => {
    cache.put(msg("m1", "s1", 10))
    cache.put(msg("m2", "s1", 5))
    cache.put(msg("m3", "s2", 1))

    const result = cache.getBySession("s1")
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe("m2")
    expect(result[1].id).toBe("m1")
  })

  test("getBySession returns empty for unknown session", () => {
    expect(cache.getBySession("unknown")).toEqual([])
  })

  test("evicts oldest when exceeding limit", () => {
    cache = new SessionCache({ limitPerSession: 2 })
    cache.put(msg("m0", "s1", 0))
    cache.put(msg("m1", "s1", 1))
    cache.put(msg("m2", "s1", 2))

    expect(cache.getBySession("s1")).toHaveLength(2)
    expect(cache.get("m0")).toBeUndefined()
    expect(cache.get("m1")).toBeDefined()
    expect(cache.get("m2")).toBeDefined()
  })

  test("remove deletes a message", () => {
    cache.put(msg("m1", "s1", 1))
    cache.remove("m1")
    expect(cache.get("m1")).toBeUndefined()
  })

  test("clearSession removes all messages for a session", () => {
    cache.put(msg("m1", "s1", 1))
    cache.put(msg("m2", "s1", 2))
    cache.put(msg("m3", "s2", 3))

    cache.clearSession("s1")
    expect(cache.getBySession("s1")).toEqual([])
    expect(cache.getBySession("s2")).toHaveLength(1)
  })

  test("clear removes all messages", () => {
    cache.put(msg("m1", "s1", 1))
    cache.put(msg("m2", "s2", 2))
    cache.clear()
    expect(cache.size).toBe(0)
  })

  test("expired entries are evicted on access", () => {
    cache = new SessionCache({ ttlMs: 50 })
    cache.put(msg("m1", "s1", 1))
    expect(cache.get("m1")).toBeDefined()

    // Wait for TTL
    const start = Date.now()
    while (Date.now() - start < 60) {
      /* busy wait for deterministic test */
    }

    expect(cache.get("m1")).toBeUndefined()
  })

  test("size reports total count", () => {
    cache.put(msg("m1", "s1", 1))
    cache.put(msg("m2", "s2", 2))
    expect(cache.size).toBe(2)
  })

  test("limit only affects the target session", () => {
    cache = new SessionCache({ limitPerSession: 2 })
    cache.put(msg("m1", "s1", 1))
    cache.put(msg("m2", "s1", 2))
    cache.put(msg("m3", "s2", 3))

    expect(cache.getBySession("s1")).toHaveLength(2)
    expect(cache.getBySession("s2")).toHaveLength(1)
  })
})
