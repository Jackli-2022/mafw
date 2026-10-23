import { expect, test } from "bun:test"
import { allHunksPatches, checkpointsToRewind, revertWarning } from "./checkpoint-revert"

const PATCH = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n@@ -3 +3 @@\n-c\n+d"

test("allHunksPatches selects every hunk", () => {
  expect(allHunksPatches([{ file: "x", patch: PATCH }])).toEqual([{ file: "x", patch: PATCH, hunkIndices: [0, 1] }])
})

test("skips missing/empty patches and zero-hunk patches", () => {
  expect(allHunksPatches([{ file: "a" }, { file: "b", patch: "  " }, { file: "c", patch: "no hunks" }])).toEqual([])
})

test("multiple files", () => {
  expect(allHunksPatches([{ file: "a", patch: PATCH }, { file: "b", patch: PATCH }]).map(p => p.file)).toEqual(["a", "b"])
})

test("checkpointsToRewind includes target and newer, newest first", () => {
  const cps = [{ messageID: "c" }, { messageID: "b" }, { messageID: "a" }] as any
  expect(checkpointsToRewind(cps, "b").map(c => c.messageID)).toEqual(["c", "b"])
  expect(checkpointsToRewind(cps, "c").map(c => c.messageID)).toEqual(["c"])
  expect(checkpointsToRewind(cps, "missing")).toEqual([])
})

test("revertWarning is runtime-aware", () => {
  expect(revertWarning("pi", false, false)).toContain("文件不会回滚")
  expect(revertWarning("opencode", false, true)).toContain("不可撤销")
  expect(revertWarning("opencode", true, true)).toContain("撤销回滚")
  expect(revertWarning("other", false, false)).toContain("以运行时为准")
})
