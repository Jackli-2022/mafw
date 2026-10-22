import { describe, expect, test } from "bun:test"
import { diffEntryFor } from "./editor-diff"

test("diffEntryFor：按 file 名匹配；undefined/未命中 → null", () => {
  const diffs = [{ file: "src/a.ts", additions: 3, deletions: 1 } as any]
  expect(diffEntryFor(diffs, "src/a.ts")!.additions).toBe(3)
  expect(diffEntryFor(diffs, "src/b.ts")).toBeNull()
  expect(diffEntryFor(undefined, "src/a.ts")).toBeNull()
})
