import { describe, expect, test } from "bun:test"
import { NARROW_BREAKPOINT, isNarrowViewport, railAutoAction } from "./layout-breakpoints"

describe("rail auto collapse", () => {
  test("collapses when crossing from wide into narrow", () => {
    expect(railAutoAction(1400, 900, false)).toBe("collapse")
  })

  test("does nothing while staying narrow", () => {
    expect(railAutoAction(900, 800, true)).toBe("none")
  })

  test("expands when leaving narrow only if it auto-collapsed", () => {
    expect(railAutoAction(900, 1400, true)).toBe("expand")
    expect(railAutoAction(900, 1400, false)).toBe("none")
  })

  test("never re-collapses on unrelated width changes within a band", () => {
    expect(railAutoAction(1400, 1300, false)).toBe("none")
    expect(railAutoAction(700, 640, true)).toBe("none")
  })
})

describe("narrow viewport predicate", () => {
  test("uses the shared breakpoint", () => {
    expect(isNarrowViewport(NARROW_BREAKPOINT - 1)).toBe(true)
    expect(isNarrowViewport(NARROW_BREAKPOINT)).toBe(false)
  })
})
