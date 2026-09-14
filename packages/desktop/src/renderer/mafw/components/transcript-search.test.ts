import { describe, expect, test } from "bun:test"
import { searchTurns } from "./transcript-search"

const turns = [
  { id: "u1", role: "user", text: "重构一下认证逻辑" },
  { id: "a1", role: "assistant", text: "认证由 gateway/src/auth.ts 处理" },
  { id: "u2", role: "user", text: "顺便看看 AUTH 的测试" },
]

describe("transcript search", () => {
  test("case-insensitive match across roles", () => {
    const hits = searchTurns(turns, "auth")
    expect(hits.map(h => h.id)).toEqual(["a1", "u2"])
  })

  test("snippet centers on the match", () => {
    const [hit] = searchTurns(turns, "auth")
    expect(hit.snippet.toLowerCase()).toContain("auth")
    expect(hit.role).toBe("assistant")
  })

  test("empty query returns no hits", () => {
    expect(searchTurns(turns, "")).toEqual([])
    expect(searchTurns(turns, "   ")).toEqual([])
  })

  test("caps results at maxHits in turn order", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, role: "user", text: "needle" }))
    expect(searchTurns(many, "needle")).toHaveLength(30)
    expect(searchTurns(many, "needle")[0].id).toBe("t0")
  })

  test("snippet truncated around long text keeps the match visible", () => {
    const long = { id: "x", role: "user", text: "A".repeat(100) + "needle" + "B".repeat(100) }
    const [hit] = searchTurns([long], "needle")
    expect(hit.snippet).toContain("needle")
    expect(hit.snippet.length).toBeLessThanOrEqual(100)
  })
})
