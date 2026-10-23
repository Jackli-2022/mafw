import { expect, test } from "bun:test"
import { buildChangeTree, changedDiffPaths, changeStatusLetter, normalizeDiffPath } from "./change-tree"

test("nested dirs aggregate counts and sort dirs before files", () => {
  const tree = buildChangeTree([
    { file: "src/a.ts", additions: 2, deletions: 1 },
    { file: "src/ui/b.ts", additions: 3, deletions: 0 },
    { file: "README.md", additions: 1, deletions: 1 },
  ])
  expect(tree[0]).toMatchObject({ kind: "dir", name: "src", additions: 5, deletions: 1 })
  expect(tree[0].children[0]).toMatchObject({ kind: "dir", name: "ui" })
  expect(tree[0].children[1]).toMatchObject({ kind: "file", name: "a.ts" })
  expect(tree[1]).toMatchObject({ kind: "file", name: "README.md" })
})

test("windows separators, root files, unknown", () => {
  const tree = buildChangeTree([{ file: "src\\a.ts" }, { file: undefined }])
  expect(tree[0].name).toBe("src")
  expect(tree[0].children[0].name).toBe("a.ts")
  expect(tree.find(n => n.name === "(unknown)")).toBeTruthy()
  expect(normalizeDiffPath(".\\src\\a.ts")).toBe("src/a.ts")
})

test("status letter", () => {
  expect(changeStatusLetter("added")).toBe("A")
  expect(changeStatusLetter("deleted")).toBe("D")
  expect(changeStatusLetter("modified")).toBe("M")
  expect(changeStatusLetter(undefined)).toBe("")
})

test("changedDiffPaths: null baseline is silent, new/count changes pulse, unchanged don't", () => {
  expect(changedDiffPaths(null, [{ file: "a", additions: 1 }])).toEqual(new Set())
  const prev = [{ file: "a", additions: 1 }, { file: "b", additions: 2 }]
  const next = [{ file: "a", additions: 1 }, { file: "b", additions: 3 }, { file: "c", additions: 1 }]
  expect(changedDiffPaths(prev, next)).toEqual(new Set(["b", "c"]))
  expect(changedDiffPaths(prev, prev)).toEqual(new Set())
})
