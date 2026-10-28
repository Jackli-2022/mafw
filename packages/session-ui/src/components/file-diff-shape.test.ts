import { describe, expect, test } from "bun:test"
import { normalizeFileDiffs } from "./file-diff-shape"

describe("normalizeFileDiffs", () => {
  test("reads opencode 2.1 metadata.files", () => {
    const file = { file: "a.ts", patch: "Index: a.ts", additions: 2, deletions: 1, status: "modified" }
    expect(normalizeFileDiffs({ files: [file] }, "fallback.ts")).toEqual([file])
  })

  test("reads legacy metadata.filediff", () => {
    const filediff = { file: "b.ts", patch: "Index: b.ts" }
    expect(normalizeFileDiffs({ filediff }, "fallback.ts")).toEqual([filediff])
  })

  test("wraps legacy metadata.diff string with the input path", () => {
    expect(normalizeFileDiffs({ diff: "Index: c.ts" }, "c.ts")).toEqual([{ file: "c.ts", patch: "Index: c.ts" }])
  })

  test("prefers files array over legacy fields", () => {
    const file = { file: "new.ts", patch: "new" }
    expect(normalizeFileDiffs({ files: [file], filediff: { file: "old.ts", patch: "old" } }, "x.ts")).toEqual([file])
  })

  test("returns [] when metadata is missing or malformed", () => {
    expect(normalizeFileDiffs(undefined, "x.ts")).toEqual([])
    expect(normalizeFileDiffs({}, "x.ts")).toEqual([])
    expect(normalizeFileDiffs({ files: "nope" }, "x.ts")).toEqual([])
    expect(normalizeFileDiffs({ files: [null, "x", { patch: "no file" }] }, "x.ts")).toEqual([
      { file: "x.ts", patch: "no file" },
    ])
  })

  test("uses fallback path when diff entry has no file", () => {
    expect(normalizeFileDiffs({ files: [{ patch: "p" }] }, "fallback.ts")).toEqual([
      { patch: "p", file: "fallback.ts" },
    ])
  })
})
