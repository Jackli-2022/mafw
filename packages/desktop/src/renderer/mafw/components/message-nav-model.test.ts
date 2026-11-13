import { describe, expect, test } from "bun:test"
import { normalizeMessageNavTurns } from "./message-nav-model"

describe("normalizeMessageNavTurns", () => {
  test("undefined / null / non-array degrade to empty", () => {
    expect(normalizeMessageNavTurns(undefined)).toEqual([])
    expect(normalizeMessageNavTurns(null)).toEqual([])
    expect(normalizeMessageNavTurns({ length: 3 })).toEqual([])
    expect(normalizeMessageNavTurns("nope")).toEqual([])
  })

  test("keeps valid turns and drops malformed entries", () => {
    expect(normalizeMessageNavTurns([
      { id: "u1", text: "hello" },
      null,
      { id: 42, text: "bad" },
      { id: "u2" },
    ])).toEqual([
      { id: "u1", text: "hello" },
      { id: "u2", text: "" },
    ])
  })
})
