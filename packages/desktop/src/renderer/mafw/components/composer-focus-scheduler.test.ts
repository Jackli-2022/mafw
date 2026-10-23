import { expect, test } from "bun:test"
import { createFocusScheduler } from "./composer-focus-scheduler"

function harness(opts?: { collapsed?: boolean }) {
  let fn: (() => void) | null = null
  let cancelled = 0
  let focused = 0
  const s = createFocusScheduler({
    schedule: (f) => { fn = f; return 1 },
    cancel: () => { fn = null; cancelled++ },
    focus: () => { focused++ },
    selectionCollapsed: () => opts?.collapsed ?? true,
    delayMs: 220,
  })
  return {
    s,
    fire: () => fn?.(),
    get focused() { return focused },
    get cancelled() { return cancelled },
    get pending() { return fn !== null },
  }
}

test("request focuses after the delay when selection is collapsed", () => {
  const h = harness()
  h.s.request()
  expect(h.focused).toBe(0)
  h.fire()
  expect(h.focused).toBe(1)
})

test("cancel prevents the pending focus", () => {
  const h = harness()
  h.s.request()
  h.s.cancel()
  h.fire()
  expect(h.focused).toBe(0)
})

test("a second request cancels the first", () => {
  const h = harness()
  h.s.request()
  h.s.request()
  h.fire()
  expect(h.focused).toBe(1)
  expect(h.cancelled).toBeGreaterThanOrEqual(1)
})

test("non-collapsed selection skips focus", () => {
  const h = harness({ collapsed: false })
  h.s.request()
  h.fire()
  expect(h.focused).toBe(0)
})
