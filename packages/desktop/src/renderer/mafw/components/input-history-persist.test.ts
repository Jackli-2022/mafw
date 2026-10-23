import { expect, test } from "bun:test"
import {
  INPUT_HISTORY_MAX_ENTRY_CHARS,
  INPUT_HISTORY_MAX_TOTAL_CHARS,
  inputHistoryKey,
  loadInputHistory,
  saveInputHistory,
} from "./input-history-persist"

const mem = () => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    _m: m,
  }
}

test("round-trips per session", () => {
  const s = mem()
  saveInputHistory(s, "s1", ["a", "b"])
  expect(loadInputHistory(s, "s1")).toEqual(["a", "b"])
  expect(loadInputHistory(s, "s2")).toEqual([])
})

test("drops entries over 4KB", () => {
  const s = mem()
  saveInputHistory(s, "s1", ["ok", "x".repeat(INPUT_HISTORY_MAX_ENTRY_CHARS + 1)])
  expect(loadInputHistory(s, "s1")).toEqual(["ok"])
})

test("keeps total under 20KB by dropping oldest whole entries", () => {
  const s = mem()
  const big = "y".repeat(4000)
  saveInputHistory(s, "s1", ["old", big, big, big, big, big, big])
  const out = loadInputHistory(s, "s1")
  expect(out.reduce((n, x) => n + x.length, 0)).toBeLessThanOrEqual(INPUT_HISTORY_MAX_TOTAL_CHARS)
  expect(out).not.toContain("old")
})

test("corrupt JSON fails open", () => {
  const s = mem()
  s.setItem(inputHistoryKey("s1"), "{not json")
  expect(loadInputHistory(s, "s1")).toEqual([])
})

test("empty history removes the key", () => {
  const s = mem()
  saveInputHistory(s, "s1", ["a"])
  saveInputHistory(s, "s1", [])
  expect(s.getItem(inputHistoryKey("s1"))).toBeNull()
})
