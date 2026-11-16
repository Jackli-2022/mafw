import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { usePresence } from "./use-presence"

function fakeTimers() {
  let next = 0
  const pending = new Map<number, () => void>()
  return {
    setTimeout: (fn: () => void) => {
      pending.set(++next, fn)
      return next
    },
    clearTimeout: (handle: unknown) => {
      pending.delete(handle as number)
    },
    runAll: () => {
      const fns = [...pending.values()]
      pending.clear()
      for (const fn of fns) fn()
    },
    pending: () => pending.size,
  }
}

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe("usePresence", () => {
  test("keeps the surface rendered for the exit frame, then unmounts", async () => {
    const timers = fakeTimers()
    const [open, setOpen] = createSignal(true)
    let presence!: ReturnType<typeof usePresence>
    const dispose = createRoot((d) => {
      presence = usePresence(open, { exitMs: 140, timers })
      return d
    })

    await flush()
    expect(presence.rendered()).toBe(true)
    expect(presence.closing()).toBe(false)

    setOpen(false)
    await flush()
    expect(presence.rendered()).toBe(true)
    expect(presence.closing()).toBe(true)

    timers.runAll()
    await flush()
    expect(presence.rendered()).toBe(false)
    expect(presence.closing()).toBe(false)

    dispose()
  })

  test("reopening during the exit window cancels the unmount", async () => {
    const timers = fakeTimers()
    const [open, setOpen] = createSignal(true)
    let presence!: ReturnType<typeof usePresence>
    const dispose = createRoot((d) => {
      presence = usePresence(open, { exitMs: 140, timers })
      return d
    })

    await flush()
    setOpen(false)
    await flush()
    expect(presence.closing()).toBe(true)
    expect(timers.pending()).toBe(1)

    setOpen(true)
    await flush()
    expect(timers.pending()).toBe(0)
    expect(presence.rendered()).toBe(true)
    expect(presence.closing()).toBe(false)

    dispose()
  })
})
