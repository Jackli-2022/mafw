import { test } from "node:test"
import assert from "node:assert/strict"
import { stageActionFor, stageKindFor } from "./stage-dispatch"
import type { Focus, SubjectRef } from "./focus-model"

const scope = { kind: "world", worldId: "w1" } as const
const file: SubjectRef = { kind: "file", root: "C:/repo", rel: "src/a.ts" }

function focus(subject: SubjectRef): Focus {
  return { scope, subject, place: {} }
}

test("file subjects dispatch to the editor", () => {
  assert.equal(stageKindFor(focus(file)), "editor")
})

test("web/terminal/plugin dispatch to their surfaces", () => {
  assert.equal(stageKindFor(focus({ kind: "web", url: "https://example.com" })), "browser")
  assert.equal(stageKindFor(focus({ kind: "terminal", id: "t1" })), "terminal")
  assert.equal(stageKindFor(focus({ kind: "plugin", package: "p", panel: "x" })), "plugin")
})

test("changeSet/goal/world dispatch to their stage", () => {
  assert.equal(
    stageKindFor(focus({ kind: "changeSet", scope: "project", baseline: "HEAD" })),
    "changeSet",
  )
  assert.equal(stageKindFor(focus({ kind: "goal", goalId: "g1" })), "goal")
  assert.equal(stageKindFor(focus({ kind: "world" })), "world")
})

test("unknown subjects fall back to world", () => {
  assert.equal(stageKindFor(focus({ kind: "evidence", id: "e1" })), "world")
  assert.equal(stageKindFor(focus({ kind: "reviewItem", id: "r1", anchor: { rel: "src/a.ts", line: 4 } })), "editor")
})

test("stageActionFor drives the editor for file subjects", () => {
  assert.deepEqual(stageActionFor(focus(file)), {
    kind: "editor",
    root: "C:/repo",
    rel: "src/a.ts",
  })
})

test("stageActionFor drives the browser for web subjects", () => {
  assert.deepEqual(stageActionFor(focus({ kind: "web", url: "https://example.com" })), {
    kind: "browser",
    url: "https://example.com",
  })
})

test("stageActionFor leaves non-file stages alone", () => {
  assert.deepEqual(stageActionFor(focus({ kind: "terminal", id: "t1" })), { kind: "none" })
  assert.deepEqual(stageActionFor(focus({ kind: "goal", goalId: "g1" })), { kind: "none" })
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
    place: {},
  }
  assert.deepEqual(stageActionFor(reviewFocus), {
    kind: "editor",
    root: "C:/repo-wt",
    rel: "src/a.ts",
    line: 12,
  })
})

test("diff subjects dispatch to the diff stage", () => {
  assert.equal(stageKindFor(focus({ kind: "diff", source: "session", id: "d1", rel: "src/a.ts" })), "diff")
})
