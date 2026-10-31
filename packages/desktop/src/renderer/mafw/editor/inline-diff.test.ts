import { describe, expect, test } from "bun:test"
import { inlineDiffRanges } from "./inline-diff"

describe("inlineDiffRanges（unified patch → 编辑器行范围）", () => {
  test("新增行合并为连续范围；被新增覆盖的删除行不重复标红", () => {
    const patch = [
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,3 +1,4 @@",
      " line1",
      "-old",
      "+new1",
      "+new2",
      " line4",
    ].join("\n")
    expect(inlineDiffRanges(patch)).toEqual([{ from: 2, to: 3, kind: "add" }])
  })

  test("纯删除在删除位置标红", () => {
    const patch = ["@@ -1,2 +1,1 @@", " a", "-b"].join("\n")
    expect(inlineDiffRanges(patch)).toEqual([{ from: 2, to: 2, kind: "del" }])
  })

  test("多 hunk 行号按 newStart 独立计算", () => {
    const patch = [
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "@@ -10 +10 @@",
      "-c",
      "+d",
    ].join("\n")
    expect(inlineDiffRanges(patch)).toEqual([
      { from: 1, to: 1, kind: "add" },
      { from: 10, to: 10, kind: "add" },
    ])
  })

  test("空 patch / 无 hunk → 空", () => {
    expect(inlineDiffRanges("")).toEqual([])
    expect(inlineDiffRanges(null)).toEqual([])
    expect(inlineDiffRanges("--- a\n+++ b\n")).toEqual([])
  })

  test("仅上下文（无 +/-）→ 空", () => {
    const patch = ["@@ -1,2 +1,2 @@", " a", " b"].join("\n")
    expect(inlineDiffRanges(patch)).toEqual([])
  })
})
