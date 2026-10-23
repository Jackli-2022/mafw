import { describe, expect, test } from "bun:test"
import { createInputHistory, shouldNavigateHistory } from "./input-history"

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
    expect(h.down()).toBe("draft") // bottom → live draft restored (not wiped to "")
    expect(h.down()).toBe(null) // already at live
  })

  test("up saves the live draft, down at the bottom restores it", () => {
    const h = createInputHistory()
    h.push("one")
    expect(h.up("我在打一半的草稿")).toBe("one")
    expect(h.down()).toBe("我在打一半的草稿")
  })

  test("browsing() reflects the history-walk state", () => {
    const h = createInputHistory()
    h.push("a")
    expect(h.browsing()).toBe(false)
    h.up("x")
    expect(h.browsing()).toBe(true)
    h.down()
    expect(h.browsing()).toBe(false)
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

  test("replace loads entries and resets browsing; does not fire onChange", () => {
    let fired = 0
    const h = createInputHistory(50, { onChange: () => fired++ })
    h.replace(["x", "y"])
    expect(h.up("draft")).toBe("y")
    expect(h.up("y")).toBe("x")
    expect(fired).toBe(0)
  })

  test("push fires onChange with a copy", () => {
    let seen: string[] = []
    const h = createInputHistory(50, { onChange: (e) => { seen = e } })
    h.push("a")
    expect(seen).toEqual(["a"])
  })
})

describe("shouldNavigateHistory（↑↓ 翻历史门判定，readline 语义）", () => {
  test("非空输入 caret 在首行 → ↑ 可翻历史（旧实现要求空框的缺陷）", () => {
    expect(shouldNavigateHistory("ArrowUp", "hello world", 5)).toBe(true)
  })
  test("多行 caret 在第二行 → ↑ 让位光标移动", () => {
    expect(shouldNavigateHistory("ArrowUp", "line1\nline2", 8)).toBe(false)
  })
  test("多行 caret 在首行末尾 → ↑ 仍可翻", () => {
    expect(shouldNavigateHistory("ArrowUp", "line1\nline2", 5)).toBe(true)
  })
  test("caret 在末行 → ↓ 可翻", () => {
    expect(shouldNavigateHistory("ArrowDown", "line1\nline2", 8)).toBe(true)
  })
  test("多行 caret 在首行 → ↓ 让位光标", () => {
    expect(shouldNavigateHistory("ArrowDown", "line1\nline2", 3)).toBe(false)
  })
  test("单行任意位置 ↓ 可翻", () => {
    expect(shouldNavigateHistory("ArrowDown", "abc", 0)).toBe(true)
  })
  test("其他键恒 false", () => {
    expect(shouldNavigateHistory("Enter", "abc", 0)).toBe(false)
    expect(shouldNavigateHistory("ArrowLeft", "abc", 1)).toBe(false)
  })
})
