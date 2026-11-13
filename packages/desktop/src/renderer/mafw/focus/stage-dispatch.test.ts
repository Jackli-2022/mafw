import { test } from "node:test"
import assert from "node:assert/strict"
import { stageActionFor, stageKindFor } from "./stage-dispatch"
import type { Focus, Lens, SubjectRef } from "./focus-model"

const scope = { kind: "world", worldId: "w1" } as const
const file: SubjectRef = { kind: "file", root: "C:/repo", rel: "src/a.ts" }

function focus(subject: SubjectRef, lens: Lens): Focus {
  return { scope, subject, lens, place: {} }
}

test("file read/edit/changes/review dispatch to editor", () => {
  for (const lens of ["read", "edit", "changes", "review"] as const) {
    assert.equal(stageKindFor(focus(file, lens)), "editor")
  }
})

test("web/terminal/plugin dispatch to their surfaces", () => {
  assert.equal(stageKindFor(focus({ kind: "web", url: "https://example.com" }, "interact")), "browser")
  assert.equal(stageKindFor(focus({ kind: "terminal", id: "t1" }, "interact")), "terminal")
  assert.equal(stageKindFor(focus({ kind: "plugin", package: "p", panel: "x" }, "interact")), "plugin")
})

test("changeSet/goal/world dispatch to their stage", () => {
  assert.equal(
    stageKindFor(focus({ kind: "changeSet", scope: "project", baseline: "HEAD" }, "changes")),
    "changeSet",
  )
  assert.equal(stageKindFor(focus({ kind: "goal", goalId: "g1" }, "orient")), "goal")
  assert.equal(stageKindFor(focus({ kind: "world" }, "orient")), "world")
})

test("unknown subject/lens combination falls back to world", () => {
  assert.equal(stageKindFor(focus(file, "interact")), "world")
  assert.equal(stageKindFor(focus({ kind: "evidence", id: "e1" }, "evidence")), "world")
  assert.equal(stageKindFor(focus({ kind: "reviewItem", id: "r1", anchor: { rel: "src/a.ts", line: 4 } }, "decide")), "editor")
})

test("stageActionFor drives the editor for file subjects", () => {
  assert.deepEqual(stageActionFor(focus(file, "read")), {
    kind: "editor",
    root: "C:/repo",
    rel: "src/a.ts",
    intent: "reading",
  })
  assert.deepEqual(stageActionFor(focus(file, "edit")), {
    kind: "editor",
    root: "C:/repo",
    rel: "src/a.ts",
    intent: "editing",
  })
  assert.equal(stageActionFor(focus(file, "changes")).kind, "editor")
  assert.equal(stageActionFor(focus(file, "review")).kind, "editor")
})

test("stageActionFor drives the browser for web subjects", () => {
  assert.deepEqual(stageActionFor(focus({ kind: "web", url: "https://example.com" }, "interact")), {
    kind: "browser",
    url: "https://example.com",
  })
})

test("stageActionFor leaves non-file stages alone", () => {
  assert.deepEqual(stageActionFor(focus({ kind: "terminal", id: "t1" }, "interact")), { kind: "none" })
  assert.deepEqual(stageActionFor(focus({ kind: "goal", goalId: "g1" }, "orient")), { kind: "none" })
  assert.deepEqual(stageActionFor(focus(file, "interact")), { kind: "none" })
})

test("stageActionFor opens a review item at its anchor", () => {
  const goalScope = {
    kind: "goal",
    worldId: "C:/repo",
    goalId: "g1",
    revision: 3,
    worktreeDir: "C:/repo-wt",
  } as const
  const reviewFocus: Focus = {
    scope: goalScope,
    subject: { kind: "reviewItem", id: "r1", anchor: { rel: "src/a.ts", line: 12 } },
    lens: "decide",
    place: {},
  }
  assert.deepEqual(stageActionFor(reviewFocus), {
    kind: "editor",
    root: "C:/repo-wt",
    rel: "src/a.ts",
    intent: "reading",
    line: 12,
  })
})

test("diff subjects dispatch to the diff stage", () => {
  assert.equal(stageKindFor(focus({ kind: "diff", source: "session", id: "d1", rel: "src/a.ts" }, "interact")), "diff")
})
