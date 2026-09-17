import { describe, expect, test } from "bun:test"
import {
  createGatewayHealthMonitor,
  createRestartScheduler,
  exitNotification,
  waitForGatewayDown,
} from "./gateway-health"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("exitNotification (sidecar exit → state decision)", () => {
  test("unexpected exit while ready notifies failed (the self-update/crash gap)", () => {
    expect(exitNotification("ready", false)).toBe("failed")
  })

  test("unexpected exit while starting notifies failed (preserved behavior)", () => {
    expect(exitNotification("starting", false)).toBe("failed")
  })

  test("expected exit (stopGateway / will-quit) notifies nothing", () => {
    expect(exitNotification("ready", true)).toBeNull()
    expect(exitNotification("starting", true)).toBeNull()
  })
})

describe("createGatewayHealthMonitor", () => {
  test("first failure fires onFirstFailure(1), later failures onAttemptFail with count", async () => {
    const events: string[] = []
    const m = createGatewayHealthMonitor(
      {
        probe: async () => { throw new Error("down") },
        onFirstFailure: () => events.push("first"),
        onAttemptFail: (n) => events.push(`attempt:${n}`),
      },
      { intervalMs: 1000, maxFailures: 5 },
    )
    await m.tick()
    await m.tick()
    await m.tick()
    expect(events).toEqual(["first", "attempt:2", "attempt:3"])
    expect(m.failures).toBe(3)
  })

  test("recovery after failures fires onRecovery and resets count", async () => {
    let healthy = false
    const events: string[] = []
    const m = createGatewayHealthMonitor(
      {
        probe: async () => { if (!healthy) throw new Error("down") },
        onFirstFailure: () => events.push("first"),
        onRecovery: () => events.push("recovered"),
      },
      { intervalMs: 1000, maxFailures: 5 },
    )
    await m.tick()
    await m.tick()
    healthy = true
    await m.tick()
    expect(events).toEqual(["first", "recovered"])
    expect(m.failures).toBe(0)
  })

  test("reaching maxFailures stops the monitor and fires onGiveUp with the count", async () => {
    let giveUp = 0
    const m = createGatewayHealthMonitor(
      { probe: async () => { throw new Error("down") }, onGiveUp: (n) => { giveUp = n } },
      { intervalMs: 1000, maxFailures: 3 },
    )
    m.start()
    expect(m.isRunning()).toBe(true)
    await m.tick()
    await m.tick()
    await m.tick()
    expect(giveUp).toBe(3)
    expect(m.isRunning()).toBe(false)
  })

  test("successful probes alone never fire failure callbacks", async () => {
    const events: string[] = []
    const m = createGatewayHealthMonitor(
      {
        probe: async () => {},
        onFirstFailure: () => events.push("first"),
        onRecovery: () => events.push("recovered"),
      },
      { intervalMs: 1000, maxFailures: 5 },
    )
    await m.tick()
    await m.tick()
    expect(events).toEqual([])
  })
})

describe("createRestartScheduler", () => {
  test("request schedules exactly one run after delay; repeated requests do not stack", async () => {
    let runs = 0
    const s = createRestartScheduler({ delayMs: 10, maxAttempts: 3, run: () => { runs++ } })
    s.request()
    s.request()
    s.request()
    expect(s.pending).toBe(true)
    await sleep(30)
    expect(runs).toBe(1)
    expect(s.pending).toBe(false)
  })

  test("reset restores the attempt budget after exhaustion", async () => {
    let runs = 0
    const s = createRestartScheduler({ delayMs: 5, maxAttempts: 1, run: () => { runs++ } })
    s.request()
    await sleep(15)
    expect(runs).toBe(1)
    s.request()
    expect(s.attempts).toBe(2)
    s.reset()
    expect(s.attempts).toBe(0)
    s.request()
    await sleep(15)
    expect(runs).toBe(2)
  })

  test("beyond maxAttempts fires onExhausted once and stops scheduling", async () => {
    let runs = 0
    let exhausted = 0
    const s = createRestartScheduler({
      delayMs: 5,
      maxAttempts: 2,
      run: () => { runs++ },
      onExhausted: (n) => { exhausted = n },
    })
    s.request()
    await sleep(15)
    s.request()
    await sleep(15)
    s.request()
    s.request()
    await sleep(15)
    expect(runs).toBe(2)
    expect(exhausted).toBe(3)
    expect(s.pending).toBe(false)
  })

  test("cancel drops the pending run", async () => {
    let runs = 0
    const s = createRestartScheduler({ delayMs: 10, maxAttempts: 3, run: () => { runs++ } })
    s.request()
    s.cancel()
    await sleep(25)
    expect(runs).toBe(0)
  })
})

describe("waitForGatewayDown (restart adopt-race guard)", () => {
  test("resolves true once the gateway stops answering", async () => {
    let alive = true
    setTimeout(() => { alive = false }, 30)
    const t0 = Date.now()
    const down = await waitForGatewayDown(() => Promise.resolve(alive), { timeoutMs: 2000, intervalMs: 10 })
    expect(down).toBe(true)
    expect(Date.now() - t0).toBeLessThan(1500)
  })

  test("resolves true immediately when already down", async () => {
    const down = await waitForGatewayDown(() => Promise.resolve(false), { timeoutMs: 1000, intervalMs: 10 })
    expect(down).toBe(true)
  })

  test("resolves false on timeout while still answering (best-effort proceed)", async () => {
    const down = await waitForGatewayDown(() => Promise.resolve(true), { timeoutMs: 60, intervalMs: 10 })
    expect(down).toBe(false)
  })
})
