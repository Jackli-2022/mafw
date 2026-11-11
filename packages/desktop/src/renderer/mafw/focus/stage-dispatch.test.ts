import { test } from "node:test"
import assert from "node:assert/strict"
import { stageKindFor } from "./stage-dispatch"
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
  assert.equal(stageKindFor(focus({ kind: "reviewItem", id: "r1" }, "decide")), "world")
})
