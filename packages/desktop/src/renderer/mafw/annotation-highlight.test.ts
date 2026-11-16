import { describe, expect, test } from "bun:test"
import { lineHighlightsFor } from "./annotation-highlight"
import type { Annotation } from "../../shared/annotation-types"

const base = (over: Partial<Annotation> = {}): Annotation => ({
  id: "a1",
  sessionID: "s1",
  rel: "a.ts",
  startLine: 3,
  endLine: 3,
  code: "x",
  comment: "note",
  createdAt: 1,
  ...over,
})

describe("lineHighlightsFor", () => {
  test("只保留行号锚（预览锚点不画行高亮）", () => {
    const items = [
      base(),
      base({ id: "a2", anchor: { kind: "quote", quote: "x" } }),
    ]
    expect(lineHighlightsFor(items)).toEqual([{ startLine: 3, endLine: 3, status: "pending" }])
  })

  test("held 映射为 held 状态", () => {
    expect(lineHighlightsFor([base({ held: true })])).toEqual([
      { startLine: 3, endLine: 3, status: "held" },
    ])
  })

  test("多行范围保留起止行", () => {
    expect(lineHighlightsFor([base({ startLine: 4, endLine: 8 })])[0]).toEqual({
      startLine: 4,
      endLine: 8,
      status: "pending",
    })
  })
})
