import { expect, test } from "bun:test"
import {
  applyTurnDiffsToCheckpoints,
  collectTurnDiffCandidates,
  loadTurnDiffs,
  mergeDiffLists,
  shouldFetchSessionDiff,
  turnDiffRequestKey,
} from "./turn-diffs"

const user = (id: string, created: number) => ({ id, role: "user", time: { created } })
const asst = (id: string, created: number, snapshot: any) => ({ id, role: "assistant", time: { created }, snapshot })
const PATCH = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n"

test("collects user turns with assistant snapshots and excludes local ids", () => {
  const msgs = [
    asst("a0", 1, { start: "s0", end: "e0" }),
    user("u1", 2), asst("a1", 3, { start: "s1", end: "e1" }),
    user("local-1", 4), asst("a2", 5, { start: "s2", end: "e2" }),
    user("u2", 6), asst("a3", 7, {}),
  ]
  const out = collectTurnDiffCandidates(msgs)
  expect(out.map(c => c.messageID)).toEqual(["u1"])
  expect(out[0].snapshotKey).toContain("e1")
})

test("fetch is per-turn, failures become null, and merge keeps per-turn wins", async () => {
  const msgs = [user("u1", 1), asst("a1", 2, { start: "s", end: "e" }), user("u2", 3), asst("a2", 4, { start: "s2", end: "e2" })]
  const called: string[] = []
  const map = await loadTurnDiffs("s1", msgs, async (_sid, mid) => {
    called.push(mid)
    if (mid === "u2") throw new Error("404")
    return { files: [{ file: "x", patch: PATCH }] }
  })
  expect(called.sort()).toEqual(["u1", "u2"])
  expect(map.u1).toHaveLength(1)
  expect(map.u2).toBeNull()
  const merged = mergeDiffLists([{ file: "x", patch: "OLD" }, { file: "base", patch: "B" }], map)
  expect(merged.find(f => f.file === "x")!.patch).toBe(PATCH)
  expect(merged.some(f => f.file === "base")).toBe(true)
})

test("applyTurnDiffsToCheckpoints distinguishes known-empty from unavailable", () => {
  const cps = [
    { messageID: "u1", createdAt: 0, prompt: "", files: [], filesKnown: false },
    { messageID: "u2", createdAt: 0, prompt: "", files: [], filesKnown: false },
  ] as any
  const out = applyTurnDiffsToCheckpoints(cps, { u1: [], u2: null })
  expect(out[0]).toMatchObject({ filesKnown: true, files: [] })
  expect(out[1].filesKnown).toBe(false)
})

test("session fallback and request key", () => {
  expect(shouldFetchSessionDiff(false, false)).toBe(false)
  expect(shouldFetchSessionDiff(true, true)).toBe(false)
  expect(shouldFetchSessionDiff(false, true)).toBe(true)
  expect(turnDiffRequestKey("opencode", "s", [{ messageID: "u", snapshotKey: "a" }])).toBe("opencode|s|u:a")
})
