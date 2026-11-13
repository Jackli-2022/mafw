import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import {
  activeChangeSetDocument,
  activeChangeSetDocumentId,
  changeSetDocumentId,
  changeSetSourceKey,
  closeChangeSetDocument,
  openChangeSetDocument,
  pickChangeSetFile,
  resetChangeSetDocumentsForTests,
  setActiveChangeSetFile,
  updateChangeSetDocument,
} from "./change-set-documents"

const files = (name: string) => [
  { file: `${name}.a.ts`, additions: 2, deletions: 1 },
  { file: `${name}.b.ts`, additions: 3, deletions: 0 },
]

const turnSource = (turnID: string) => ({
  kind: "session" as const,
  sessionID: "s1",
  turnID,
  title: "14:32 修复登录",
})

const goalSource = {
  kind: "goal" as const,
  podId: "p1",
  goalId: "g1",
  revision: 2,
  title: "修复登录",
}

beforeEach(() => resetChangeSetDocumentsForTests())

test("turn and goal change sets get distinct stable ids", () => {
  assert.equal(changeSetSourceKey(turnSource("m1")), "session:s1:m1")
  assert.equal(changeSetSourceKey({ ...turnSource("m1"), turnID: null }), "session:s1:all")
  assert.equal(changeSetSourceKey(goalSource), "goal:p1:g1:2")
  assert.equal(changeSetDocumentId(goalSource), "changeset:goal:p1:g1:2")
})

test("opening the same source updates instead of duplicating", () => {
  const first = openChangeSetDocument({
    source: turnSource("m1"),
    root: "C:/repo",
    scope: { kind: "world", worldId: "C:/repo" },
    files: files("one"),
  })
  const second = openChangeSetDocument({
    source: turnSource("m1"),
    root: "C:/repo",
    scope: { kind: "world", worldId: "C:/repo" },
    files: files("two"),
  })
  assert.equal(first.id, second.id)
  assert.equal(activeChangeSetDocumentId(), second.id)
  assert.equal(activeChangeSetDocument()?.files.length, 2)
  assert.equal(activeChangeSetDocument()?.files[0]?.file, "two.a.ts")
})

test("turn and Goal tabs stay separate change sets", () => {
  openChangeSetDocument({
    source: turnSource("m1"),
    root: "C:/repo",
    scope: { kind: "world", worldId: "C:/repo" },
    files: files("turn"),
  })
  openChangeSetDocument({
    source: goalSource,
    root: "C:/wt",
    scope: { kind: "goal", worldId: "C:/repo", goalId: "g1", revision: 2, worktreeDir: "C:/wt" },
  })
  assert.equal(activeChangeSetDocument()?.source.kind, "goal")
  assert.match(activeChangeSetDocument()?.label ?? "", /rev 2/)
})

test("default labels name the source", () => {
  const turn = openChangeSetDocument({
    source: turnSource("m1"),
    root: null,
    scope: { kind: "world", worldId: "C:/repo" },
  })
  assert.match(turn.label, /改动 · 14:32 修复登录/)
  const goal = openChangeSetDocument({
    source: goalSource,
    root: null,
    scope: { kind: "world", worldId: "C:/repo" },
  })
  assert.match(goal.label, /Goal 修复登录 · rev 2/)
})

test("file selection survives refresh while present and falls back when removed", () => {
  const doc = openChangeSetDocument({
    source: turnSource("m1"),
    root: null,
    scope: { kind: "world", worldId: "C:/repo" },
    files: files("one"),
  })
  setActiveChangeSetFile(doc.id, "one.b.ts")
  assert.equal(activeChangeSetDocument()?.activeFile, "one.b.ts")

  updateChangeSetDocument(doc.id, { files: files("one") })
  assert.equal(activeChangeSetDocument()?.activeFile, "one.b.ts")

  updateChangeSetDocument(doc.id, { files: [{ file: "one.c.ts" }] })
  assert.equal(activeChangeSetDocument()?.activeFile, "one.c.ts")
})

test("closing an active change set selects a neighbour", () => {
  const first = openChangeSetDocument({
    source: turnSource("m1"), root: null, scope: { kind: "world", worldId: "C:/repo" },
  })
  const second = openChangeSetDocument({
    source: turnSource("m2"), root: null, scope: { kind: "world", worldId: "C:/repo" },
  })
  closeChangeSetDocument(second.id)
  assert.equal(activeChangeSetDocumentId(), first.id)
})

test("pickChangeSetFile prefers the current file and never returns a stale path", () => {
  const list = [{ file: "a.ts" }, { file: "b.ts" }]
  assert.equal(pickChangeSetFile(list, "b.ts"), "b.ts")
  assert.equal(pickChangeSetFile(list, "gone.ts"), "a.ts")
  assert.equal(pickChangeSetFile([], "a.ts"), null)
})
