import { describe, expect, test } from "bun:test"
import { countUserTurns, shouldKeepPaging } from "./history-paging"

describe("countUserTurns", () => {
  test("counts only user-role messages", () => {
    const msgs = [
      { role: "user" }, { role: "assistant" }, { role: "assistant" },
      { role: "user" }, { role: "assistant" },
    ]
    expect(countUserTurns(msgs as any)).toBe(2)
  })
  test("empty window → 0", () => {
    expect(countUserTurns([])).toBe(0)
    expect(countUserTurns([{ role: "assistant" }, { role: "tool" }] as any)).toBe(0)
  })
})

describe("shouldKeepPaging", () => {
  const base = { collected: 0, target: 10, nextCursor: "c2" as string | null, pageCount: 1, maxPages: 5 }
  test("keeps going while turns < target and cursor exists", () => {
    expect(shouldKeepPaging({ ...base, collected: 3, nextCursor: "c2" })).toBe(true)
  })
  test("stops at target", () => {
    expect(shouldKeepPaging({ ...base, collected: 10, nextCursor: "c2" })).toBe(false)
  })
  test("stops when cursor exhausted", () => {
    expect(shouldKeepPaging({ ...base, collected: 2, nextCursor: null })).toBe(false)
  })
  test("stops at max pages", () => {
    expect(shouldKeepPaging({ ...base, collected: 2, pageCount: 5, maxPages: 5 })).toBe(false)
  })
})
