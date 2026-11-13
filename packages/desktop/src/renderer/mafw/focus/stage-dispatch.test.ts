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

test("goal/world dispatch to their stage", () => {
  assert.equal(stageKindFor(focus({ kind: "goal", goalId: "g1" })), "goal")
  assert.equal(stageKindFor(focus({ kind: "world" })), "world")
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

test("diff subjects dispatch to the diff stage", () => {
  assert.equal(stageKindFor(focus({ kind: "diff", source: "session", id: "d1", rel: "src/a.ts" })), "diff")
})
