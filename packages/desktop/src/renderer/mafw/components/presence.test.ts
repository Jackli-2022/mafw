import { describe, expect, test } from "bun:test"
import { presenceStep, SURFACE_MS } from "./presence"

describe("presenceStep (pure)", () => {
  test("mount when opening", () => {
    expect(presenceStep(false, true, false)).toBe("mount")
    expect(presenceStep(false, true, true)).toBe("mount")
  })
  test("schedule unmount only on the falling edge while still present", () => {
    expect(presenceStep(true, false, true)).toBe("schedule-unmount")
  })
  test("hold when already closing or unchanged-closed", () => {
    expect(presenceStep(true, false, false)).toBe("hold")
    expect(presenceStep(false, false, true)).toBe("hold")
  })
})

describe("SURFACE_MS", () => {
  test("mirrors the CSS surface tier", () => {
    expect(SURFACE_MS).toBe(280)
  })
})
