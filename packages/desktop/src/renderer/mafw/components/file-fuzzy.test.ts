import { describe, expect, test } from "bun:test"
import { fuzzyMatchFiles } from "./file-fuzzy"

const files = [
  "src/index.ts",
  "src/renderer/mafw/MafwShell.tsx",
  "gateway/src/core/memory/harmonic-index.ts",
  "docs/research/survey.md",
]

describe("file fuzzy matcher", () => {
  test("empty query returns alphabetical head", () => {
    const out = fuzzyMatchFiles(files, "")
    expect(out).toHaveLength(4)
    expect(out[0]).toBe("docs/research/survey.md")
  })

  test("substring match ranks first", () => {
    const out = fuzzyMatchFiles(files, "harmonic")
    expect(out).toEqual(["gateway/src/core/memory/harmonic-index.ts"])
  })

  test("subsequence match across path segments", () => {
    // "mfs" matches MafwShell.tsx as subsequence
    const out = fuzzyMatchFiles(files, "mfs")
    expect(out).toContain("src/renderer/mafw/MafwShell.tsx")
  })

  test("no match returns empty", () => {
    expect(fuzzyMatchFiles(files, "zzzzz")).toEqual([])
  })

  test("respects the limit", () => {
    const many = Array.from({ length: 50 }, (_, i) => `dir/file${i}.ts`)
    expect(fuzzyMatchFiles(many, "file", 10)).toHaveLength(10)
  })
})
