import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("document stage renders a diff pane and diff toolbar", () => {
  const stage = read("src/renderer/mafw/components/DocumentStage.tsx")
  assert.match(stage, /DiffDocumentView/)
  assert.match(stage, /activeKind\(\) === "diff"/)
  const view = read("src/renderer/mafw/components/DiffDocumentView.tsx")
  assert.match(view, /registerDocumentToolbar\("diff"/)
  assert.match(view, /DiffReviewPanel/)
})

test("the lens and instrument rail chrome are gone", () => {
  const shell = read("src/renderer/mafw/components/WorkbenchShell.tsx")
  assert.doesNotMatch(shell, /InstrumentRail/)
  const focus = read("src/renderer/mafw/focus/focus-model.ts")
  assert.doesNotMatch(focus, /Lens/)
  assert.doesNotMatch(focus, /changeSet/)
})

test("diff tab selection keeps the diff store active id in lockstep", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /setActiveDiffDocument\(/)
  assert.match(shell, /focus\.subject\.kind === "diff"[\s\S]{0,120}setActiveDiffDocument/)
  assert.match(shell, /clearDiffDocuments\(\)/)
})

test("live session diffs update open diff tabs", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /store\.session_diff/)
  assert.match(shell, /updateDiffDocument\(/)
})

test("deep-link context is applied before the face mounts", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /setChangesMode\(input\.context\.kind\)/)
  const face = read("src/renderer/mafw/components/ChangesFace.tsx")
  assert.doesNotMatch(face, /defer: true/)
  assert.match(face, /reviewGoal/)
  assert.match(face, /lastRequestSeq/)
})

test("session diff annotations use the diff doc session, not the current tab", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /doc\?\.source\.kind === "session" \? doc\.source\.sessionID/)
})

test("review anchors and non-invertible revert guard are wired", () => {
  const view = read("src/renderer/mafw/components/DiffDocumentView.tsx")
  assert.match(view, /allowNonInvertibleRevert=\{false\}/)
  assert.match(view, /focusLine=\{props\.doc\.anchorLine\}/)
  const panel = read("src/renderer/mafw/components/DiffReviewPanel.tsx")
  assert.match(panel, /data-new-line/)
  assert.match(panel, /is-focus-line/)
})

test("the dead instrument rail prop and CSS are gone", () => {
  const shell = read("src/renderer/mafw/components/WorkbenchShell.tsx")
  assert.doesNotMatch(shell, /instrumentRail/)
  const css = read("src/renderer/mafw/mafw.css")
  assert.doesNotMatch(css, /mafw-instrument-|mafw-focus-rail-slot/)
})
