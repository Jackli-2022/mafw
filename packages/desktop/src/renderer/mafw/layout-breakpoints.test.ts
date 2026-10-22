import { describe, expect, test } from "bun:test"
import { NARROW_BREAKPOINT, isNarrowViewport } from "./layout-breakpoints"

describe("narrow viewport predicate", () => {
  test("uses the shared breakpoint", () => {
    expect(isNarrowViewport(NARROW_BREAKPOINT - 1)).toBe(true)
    expect(isNarrowViewport(NARROW_BREAKPOINT)).toBe(false)
  })
})
