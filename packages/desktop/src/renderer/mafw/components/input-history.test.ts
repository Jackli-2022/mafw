import { describe, expect, test } from "bun:test"
import { createInputHistory } from "./input-history"

describe("input history", () => {
  test("push stores entries and skips blank/duplicate", () => {
    const h = createInputHistory()
    h.push("a"); h.push("   "); h.push("a"); h.push("b")
    expect(h.up("x")).toBe("b")
    expect(h.up("b")).toBe("a")
    expect(h.up("a")).toBe(null)
  })

  test("up enters history from live input, down returns to live", () => {
    const h = createInputHistory()
    h.push("one"); h.push("two")
    expect(h.up("draft")).toBe("two")
    expect(h.up("two")).toBe("one")
    expect(h.down()).toBe("two")
    expect(h.down()).toBe("")   // back to live
    expect(h.down()).toBe(null) // already at live
  })

  test("push while browsing resets the cursor to live", () => {
    const h = createInputHistory()
    h.push("a"); h.push("b")
    h.up("x"); h.up("b")
    h.push("c")
    expect(h.up("x")).toBe("c") // newest first after a fresh push
  })

  test("caps at max entries (oldest dropped)", () => {
    const h = createInputHistory(2)
    h.push("a"); h.push("b"); h.push("c")
    expect(h.up("x")).toBe("c")
    expect(h.up("c")).toBe("b")
    expect(h.up("b")).toBe(null) // "a" was dropped
  })
})
