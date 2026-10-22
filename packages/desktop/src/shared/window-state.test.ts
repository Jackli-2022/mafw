import { describe, expect, test } from "bun:test"
import { windowExpanded } from "./window-state"

describe("windowExpanded（最大化或全屏都算“大窗口”）", () => {
  test("仅最大化 → true", () => {
    expect(windowExpanded(true, false)).toBe(true)
  })
  test("仅全屏 → true", () => {
    expect(windowExpanded(false, true)).toBe(true)
  })
  test("都否 → false", () => {
    expect(windowExpanded(false, false)).toBe(false)
  })
})
