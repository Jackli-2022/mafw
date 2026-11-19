import { describe, expect, test } from "bun:test"
import { canonicalMetadataFiles, contentLineCount, diffMeta, hasDirectory } from "./diff-tool-model"

describe("diff tool model", () => {
  test("keeps only canonical metadata files", () => {
    expect(canonicalMetadataFiles({ files: [{ file: "a.ts", additions: 1, deletions: 2 }, { path: "b.ts" }, null] })).toEqual([
      { file: "a.ts", additions: 1, deletions: 2 },
    ])
    expect(canonicalMetadataFiles({})).toEqual([])
  })

  test("counts content lines without a phantom trailing line", () => {
    expect(contentLineCount("")).toBe(0)
    expect(contentLineCount("a")).toBe(1)
    expect(contentLineCount("a\nb\n")).toBe(2)
    expect(contentLineCount("a\n\nb")).toBe(3)
    expect(contentLineCount(undefined)).toBe(0)
  })

  test("renders only non-zero sides and hides 0/0", () => {
    expect(diffMeta(4, 1)).toEqual([{ text: "+4", tone: "ok" }, { text: "-1", tone: "err" }])
    expect(diffMeta(3, 0)).toEqual([{ text: "+3", tone: "ok" }])
    expect(diffMeta(0, 3)).toEqual([{ text: "-3", tone: "err" }])
    expect(diffMeta(0, 0)).toBeUndefined()
  })

  test("detects a directory on forward and backslash paths", () => {
    expect(hasDirectory("src/a.ts")).toBe(true)
    expect(hasDirectory("C:\\repo\\src\\a.ts")).toBe(true)
    expect(hasDirectory("a.ts")).toBe(false)
  })
})
