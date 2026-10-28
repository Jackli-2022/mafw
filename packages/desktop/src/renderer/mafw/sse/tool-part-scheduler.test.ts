import { describe, expect, test } from "bun:test"
import { createToolPartScheduler } from "./tool-part-scheduler"

function part(id: string, status: string, extra: Record<string, any> = {}) {
  return { id, type: "tool", tool: "execute", state: { status, ...extra } }
}

function fakeClock() {
  let pending: (() => void) | undefined
  let cancelled = 0
  return {
    schedule(fn: () => void) {
      pending = fn
      return 1
    },
    cancel() {
      cancelled++
      pending = undefined
    },
    run() {
      const fn = pending
      pending = undefined
      fn?.()
    },
    cancelled: () => cancelled,
  }
}

describe("createToolPartScheduler", () => {
  test("coalesces a same-part running burst into one apply with the latest snapshot", () => {
    const clock = fakeClock()
    const applied: any[][] = []
    const scheduler = createToolPartScheduler({
      schedule: clock.schedule,
      cancel: clock.cancel,
      apply: (parts) => applied.push(parts),
    })

    for (let i = 0; i < 6; i++) {
      scheduler.queue(part("p1", "running", { metadata: { seq: i } }))
    }
    expect(applied).toEqual([])
    expect(scheduler.hasPending()).toBe(true)

    clock.run()
    expect(applied).toHaveLength(1)
    expect(applied[0]).toHaveLength(1)
    expect(applied[0]![0].state.metadata.seq).toBe(5)
    expect(scheduler.hasPending()).toBe(false)
  })

  test("applies terminal states immediately and drops the queued running snapshot", () => {
    const clock = fakeClock()
    const applied: any[][] = []
    const scheduler = createToolPartScheduler({
      schedule: clock.schedule,
      cancel: clock.cancel,
      apply: (parts) => applied.push(parts),
    })

    scheduler.queue(part("p1", "running", { metadata: { seq: 1 } }))
    const result = scheduler.queue(part("p1", "completed", { output: "done" }))

    expect(result).toBe("immediate")
    expect(applied).toHaveLength(1)
    expect(applied[0]![0].state.status).toBe("completed")

    clock.run()
    expect(applied).toHaveLength(1)
    expect(scheduler.hasPending()).toBe(false)
  })

  test("flushes different parts together and preserves queue order", () => {
    const clock = fakeClock()
    const applied: any[][] = []
    const scheduler = createToolPartScheduler({
      schedule: clock.schedule,
      cancel: clock.cancel,
      apply: (parts) => applied.push(parts),
    })

    scheduler.queue(part("p1", "running"))
    scheduler.queue(part("p2", "running"))
    clock.run()

    expect(applied).toHaveLength(1)
    expect(applied[0]!.map((item) => item.id)).toEqual(["p1", "p2"])
  })

  test("flushNow cancels the scheduled frame and applies pending snapshots", () => {
    const clock = fakeClock()
    const applied: any[][] = []
    const scheduler = createToolPartScheduler({
      schedule: clock.schedule,
      cancel: clock.cancel,
      apply: (parts) => applied.push(parts),
    })

    scheduler.queue(part("p1", "running"))
    scheduler.flush()

    expect(clock.cancelled()).toBe(1)
    expect(applied).toHaveLength(1)
    expect(scheduler.hasPending()).toBe(false)

    clock.run()
    expect(applied).toHaveLength(1)
  })

  test("fills a missing sessionID from the queue call", () => {
    const clock = fakeClock()
    const applied: any[][] = []
    const scheduler = createToolPartScheduler({
      schedule: clock.schedule,
      cancel: clock.cancel,
      apply: (parts) => applied.push(parts),
    })

    scheduler.queue(part("p1", "running"), "s1")
    clock.run()

    expect(applied[0]![0].sessionID).toBe("s1")
  })

  test("ignores non-tool parts and parts without an id", () => {
    const clock = fakeClock()
    const applied: any[][] = []
    const scheduler = createToolPartScheduler({
      schedule: clock.schedule,
      cancel: clock.cancel,
      apply: (parts) => applied.push(parts),
    })

    expect(scheduler.queue({ id: "t1", type: "text" })).toBe("ignored")
    expect(scheduler.queue({ type: "tool", state: { status: "running" } })).toBe("ignored")
    expect(scheduler.hasPending()).toBe(false)
    expect(applied).toEqual([])
  })
})
