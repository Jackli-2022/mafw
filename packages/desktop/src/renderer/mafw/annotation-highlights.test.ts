import { describe, expect, test } from "bun:test"
import { quoteHighlightState } from "./annotation-highlights"

describe("quoteHighlightState", () => {
  test("active 优先于 held", () => {
    expect(quoteHighlightState(true, false)).toBe("active")
    expect(quoteHighlightState(true, true)).toBe("active")
  })

  test("held 次之，默认 pending", () => {
    expect(quoteHighlightState(false, true)).toBe("held")
    expect(quoteHighlightState(false, false)).toBe("pending")
  })
})
