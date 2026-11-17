import { describe, expect, test } from "bun:test"
import { NotificationPresenter } from "./notification-presenter"
import type { MafwNotification } from "../shared/notifications"

const item = (id: string, createdAt = 0): MafwNotification => ({
  id,
  kind: "attention",
  severity: "p2",
  title: id,
  reason: "需要你",
  createdAt,
})

function fakeTimers() {
  let next = 0
  const timers = new Map<number, { fn: () => void; ms: number }>()
  return {
    setTimer: (fn: () => void, ms: number) => {
      const handle = ++next
      timers.set(handle, { fn, ms })
      return handle
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number)
    },
    fireAll: () => {
      const pending = [...timers.entries()]
      timers.clear()
      for (const [, timer] of pending) timer.fn()
    },
    size: () => timers.size,
    delays: () => [...timers.values()].map((timer) => timer.ms),
  }
}

describe("NotificationPresenter", () => {
  test("push shows a card and auto-dismisses after 6s", () => {
    const timers = fakeTimers()
    const seen: string[][] = []
    const presenter = new NotificationPresenter({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      onVisibleChange: (items) => seen.push(items.map((entry) => entry.id)),
    })
    presenter.push(item("a"))
    expect(presenter.visible().map((entry) => entry.id)).toEqual(["a"])
    expect(timers.delays()).toEqual([6000])
    timers.fireAll()
    expect(presenter.visible()).toEqual([])
    expect(seen.at(-1)).toEqual([])
  })

  test("hover pauses the dismiss timer and leaving resumes the remaining time", () => {
    const timers = fakeTimers()
    let clock = 0
    const presenter = new NotificationPresenter({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: () => clock,
    })
    presenter.push(item("a"))
    expect(timers.delays()).toEqual([6000])
    clock = 2000
    presenter.hover("a", true)
    expect(timers.size()).toBe(0)
    presenter.hover("a", false)
    // 只跑剩余的 4000ms，而不是重开满 6000ms。
    expect(timers.delays()).toEqual([4000])
  })

  test("keeps at most three cards and drops the oldest", () => {
    const timers = fakeTimers()
    const presenter = new NotificationPresenter({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })
    presenter.push(item("a", 1))
    presenter.push(item("b", 2))
    presenter.push(item("c", 3))
    presenter.push(item("d", 4))
    expect(presenter.visible().map((entry) => entry.id)).toEqual(["b", "c", "d"])
  })

  test("take removes one card and returns it", () => {
    const timers = fakeTimers()
    const presenter = new NotificationPresenter({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })
    presenter.push(item("a"))
    presenter.push(item("b"))
    expect(presenter.take("a")?.id).toBe("a")
    expect(presenter.visible().map((entry) => entry.id)).toEqual(["b"])
    expect(presenter.take("missing")).toBeUndefined()
  })
})
