import { describe, expect, test } from "bun:test"
import { createConnectionState, allWithFailureFlag } from "./connection-state"

describe("createConnectionState", () => {
  test("initial → sse-open → connected (first connect, not recovered)", () => {
    const c = createConnectionState()
    expect(c.phase).toBe("initial")
    const ev = c.report("sse-open")
    expect(ev).not.toBeNull()
    expect(ev!.phase).toBe("connected")
    expect(ev!.prev).toBe("initial")
    expect(ev!.recovered).toBe(false)
    expect(c.phase).toBe("connected")
  })

  test("connected → sse-error → reconnecting event", () => {
    const c = createConnectionState()
    c.report("sse-open")
    const ev = c.report("sse-error")
    expect(ev).not.toBeNull()
    expect(ev!.phase).toBe("reconnecting")
    expect(ev!.prev).toBe("connected")
    expect(c.phase).toBe("reconnecting")
  })

  test("reconnecting → repeated sse-error → no event, attempts grow", () => {
    const c = createConnectionState()
    c.report("sse-open")
    c.report("sse-error")
    expect(c.attempts()).toBe(1)
    const ev = c.report("sse-error")
    expect(ev).toBeNull()
    expect(c.attempts()).toBe(2)
    expect(c.phase).toBe("reconnecting")
  })

  test("reconnecting → sse-open → connected with recovered=true, attempts reset", () => {
    const c = createConnectionState()
    c.report("sse-open")
    c.report("sse-error")
    c.report("sse-error")
    const ev = c.report("sse-open")
    expect(ev).not.toBeNull()
    expect(ev!.phase).toBe("connected")
    expect(ev!.recovered).toBe(true)
    expect(c.attempts()).toBe(0)
  })

  test("connected → gateway-failed → down (process exit signal)", () => {
    const c = createConnectionState()
    c.report("sse-open")
    const ev = c.report("gateway-failed")
    expect(ev).not.toBeNull()
    expect(ev!.phase).toBe("down")
    expect(c.phase).toBe("down")
  })

  test("down → gateway-ready → reconnecting (wait for SSE to confirm recovery)", () => {
    const c = createConnectionState()
    c.report("sse-open")
    c.report("gateway-failed")
    const ev = c.report("gateway-ready")
    expect(ev).not.toBeNull()
    expect(ev!.phase).toBe("reconnecting")
    expect(ev!.recovered).toBe(false)
    expect(c.phase).toBe("reconnecting")
  })

  test("down → repeated gateway-failed → no event (already down)", () => {
    const c = createConnectionState()
    c.report("gateway-failed")
    expect(c.report("gateway-failed")).toBeNull()
    expect(c.phase).toBe("down")
  })

  test("initial → sse-error → stays initial (never connected: no false alarm), attempts count", () => {
    const c = createConnectionState()
    expect(c.report("sse-error")).toBeNull()
    expect(c.phase).toBe("initial")
    expect(c.attempts()).toBe(1)
  })

  test("initial → gateway-failed → down (health monitor catches dead gateway)", () => {
    const c = createConnectionState()
    const ev = c.report("gateway-failed")
    expect(ev).not.toBeNull()
    expect(ev!.phase).toBe("down")
  })

  test("initial → gateway-ready → no event (normal startup ordering)", () => {
    const c = createConnectionState()
    expect(c.report("gateway-ready")).toBeNull()
    expect(c.phase).toBe("initial")
  })

  test("connected → gateway-ready → no event (routine state push)", () => {
    const c = createConnectionState()
    c.report("sse-open")
    expect(c.report("gateway-ready")).toBeNull()
    expect(c.phase).toBe("connected")
  })

  test("connected → sse-open → no event (duplicate open)", () => {
    const c = createConnectionState()
    c.report("sse-open")
    expect(c.report("sse-open")).toBeNull()
    expect(c.phase).toBe("connected")
  })

  test("down → sse-open → connected directly (SSE recovered before state push)", () => {
    const c = createConnectionState()
    c.report("gateway-failed")
    const ev = c.report("sse-open")
    expect(ev).not.toBeNull()
    expect(ev!.phase).toBe("connected")
    expect(ev!.recovered).toBe(true)
  })

  test("subscribe receives events, unsubscribe stops delivery", () => {
    const c = createConnectionState()
    const seen: string[] = []
    const unsub = c.subscribe((ev) => seen.push(`${ev.prev}->${ev.phase}`))
    c.report("sse-open")
    unsub()
    c.report("sse-error")
    expect(seen).toEqual(["initial->connected"])
  })
})

describe("allWithFailureFlag", () => {
  test("resolves with values when all succeed", async () => {
    const out = await allWithFailureFlag([async () => 1, async () => 2], 0)
    expect(out).toEqual({ values: [1, 2], failed: false })
  })

  test("failed=true when any promise rejects, others keep fallback", async () => {
    const out = await allWithFailureFlag([
      async () => 1,
      async () => { throw new Error("boom") },
      async () => 3,
    ], -1)
    expect(out.values).toEqual([1, -1, 3])
    expect(out.failed).toBe(true)
  })
})
