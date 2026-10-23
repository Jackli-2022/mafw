import { expect, test } from "bun:test"
import { allHunksPatches, canRewindCode, checkpointsToRewind, isFileRevertible, isInvertiblePatch, revertWarning } from "./checkpoint-revert"
import { checkpointsWithTurnDiffs } from "./checkpoint-model"

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

test("isInvertiblePatch rejects added/deleted files and empty hunks", () => {
  expect(isInvertiblePatch(PATCH)).toBe(true)
  expect(isInvertiblePatch("new file mode 100644\n--- /dev/null\n+++ b/new\n@@ -0,0 +1 @@\n+x")).toBe(false)
  expect(isInvertiblePatch("deleted file mode 100644\n--- a/del\n+++ /dev/null\n@@ -1 +0,0 @@\n-x")).toBe(false)
  expect(isInvertiblePatch("no hunks")).toBe(false)
})

test("isFileRevertible gates non-invertible patches only in strict mode", () => {
  expect(isFileRevertible({ patch: PATCH }, false)).toBe(true)
  expect(isFileRevertible({ patch: "new file mode 100644\n--- /dev/null\n+++ b/new\n@@ -0,0 +1 @@\n+x" }, false)).toBe(false)
  expect(isFileRevertible({ patch: "new file mode 100644\n--- /dev/null\n+++ b/new\n@@ -0,0 +1 @@\n+x" }, true)).toBe(true)
})

test("per-turn diffs feed canRewindCode without weakening the gate", () => {
  const NOW = 1_700_000_000_000
  const cpFor = (id: string, files: any[] | null) =>
    checkpointsWithTurnDiffs([{ id, role: "user", time: { created: NOW } }], {}, NOW, { [id]: files })
  const safe = cpFor("u1", [{ file: "x", patch: PATCH }])
  expect(canRewindCode(safe, "u1")).toBe(true)
  const added = cpFor("u2", [{
    file: "new",
    patch: "new file mode 100644\n--- /dev/null\n+++ b/new\n@@ -0,0 +1 @@\n+x",
  }])
  expect(canRewindCode(added, "u2")).toBe(false)
  const missing = cpFor("u3", null)
  expect(canRewindCode(missing, "u3")).toBe(false)
})

test("canRewindCode requires known, complete, invertible turn data", () => {
  const cp = (id: string, filesKnown: boolean, files: any[]) => ({ messageID: id, createdAt: 0, prompt: "", files, filesKnown })
  const safe = cp("a", true, [{ file: "x", patch: PATCH }])
  const missing = cp("b", false, [])
  const added = cp("c", true, [{ file: "new", patch: "new file mode 100644\n--- /dev/null\n+++ b/new\n@@ -0,0 +1 @@\n+x" }])
  expect(canRewindCode([safe], "a")).toBe(true)
  expect(canRewindCode([safe, missing], "b")).toBe(false)
  expect(canRewindCode([added], "c")).toBe(false)
  expect(canRewindCode([cp("d", true, [])], "d")).toBe(false)
})

test("revertWarning is runtime-aware", () => {
  expect(revertWarning("pi", false, false)).toContain("文件不会回滚")
  expect(revertWarning("opencode", false, true)).toContain("不可撤销")
  expect(revertWarning("opencode", true, true)).toContain("撤销回滚")
  expect(revertWarning("other", false, false)).toContain("以运行时为准")
})
