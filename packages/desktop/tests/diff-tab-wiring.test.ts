import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("document stage renders a change-set pane with a toolbar", () => {
  const stage = read("src/renderer/mafw/components/DocumentStage.tsx")
  assert.match(stage, /ChangeSetView/)
  assert.match(stage, /activeKind\(\) === "changeset"/)
  const view = read("src/renderer/mafw/components/ChangeSetView.tsx")
  assert.match(view, /registerDocumentToolbar\("changeset"/)
  assert.match(view, /DiffReviewPanel/)
})

test("the lens and instrument rail chrome are gone", () => {
  const shell = read("src/renderer/mafw/components/WorkbenchShell.tsx")
  assert.doesNotMatch(shell, /InstrumentRail/)
  const focus = read("src/renderer/mafw/focus/focus-model.ts")
  assert.doesNotMatch(focus, /Lens/)
})

test("change-set selection keeps the change-set store active id in lockstep", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /setActiveChangeSetDocument\(/)
  assert.match(shell, /focus\.subject\.kind === "changeset"[\s\S]{0,160}setActiveChangeSetDocument/)
  assert.match(shell, /clearChangeSetDocuments\(\)/)
})

test("live session diffs update open change-set tabs", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /store\.session_diff/)
  assert.match(shell, /updateChangeSetDocument\(/)
})

test("deep-link context is applied before the face mounts", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /setChangesRequest\(\(previous\) => nextChangesRequest/)
  const face = read("src/renderer/mafw/components/ChangesFace.tsx")
  assert.doesNotMatch(face, /defer: true/)
  assert.match(face, /reviewGoal/)
  assert.match(face, /lastRequestSeq/)
})

test("session diff annotations use the change-set session and keep project provenance", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /doc\?\.source\.kind === "session" \? doc\.source\.sessionID/)
  assert.match(shell, /projectChangeSetAnnotationScope\(/)
  assert.match(shell, /addAnnotation\(\{ \.\.\.a, sessionID: sid, \.\.\.scope \}\)/)
  assert.doesNotMatch(shell, /addPending\(\{ sessionID: sid, \.\.\.a \}\)/)
})

test("goal change sets capture annotation drafts instead of promptAsync", () => {
  const view = read("src/renderer/mafw/components/ChangeSetView.tsx")
  assert.match(view, /previewOnly=\{props\.doc\.source\.kind !== "goal"\}/)
  assert.match(view, /onAddAnnotation=\{props\.doc\.source\.kind === "goal" \? props\.onAddAnnotation : undefined\}/)
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /doc\?\.source\.kind === "goal"/)
  assert.match(shell, /goalChangeSetAnnotationScope\(/)
  assert.match(shell, /addAnnotation\(\{ \.\.\.a, \.\.\.scope \}\)/)
})

test("review anchors and non-invertible revert guard are wired", () => {
  const view = read("src/renderer/mafw/components/ChangeSetView.tsx")
  assert.match(view, /allowNonInvertibleRevert=\{false\}/)
  assert.match(view, /focusLine=\{props\.doc\.anchorLine\}/)
  const panel = read("src/renderer/mafw/components/DiffReviewPanel.tsx")
  assert.match(panel, /data-new-line/)
  assert.match(panel, /is-focus-line/)
})

test("change-set dropdown is content-driven but bounded by the dock", () => {
  const css = read("src/renderer/mafw/mafw.css")
  const block = (selector: string) => {
    const start = css.indexOf(selector)
    if (start < 0) return ""
    const open = css.indexOf("{", start)
    const close = css.indexOf("}", open)
    return css.slice(open + 1, close)
  }
  const menu = block(".mafw-changeset-menu {")
  assert.match(menu, /width: max-content/)
  assert.match(menu, /max-width: calc\(100% - 16px\)/)
  assert.match(menu, /min-width: min\(300px, calc\(100% - 16px\)\)/)
  const trigger = block(".mafw-changeset-trigger {")
  assert.match(trigger, /background: none/)
  assert.match(trigger, /border: 0/)
  assert.doesNotMatch(trigger, /border-radius/)
  const panel = read("src/renderer/mafw/components/DiffReviewPanel.tsx")
  assert.match(panel, /props\.chrome !== "tab"/)
})

test("the dead instrument rail prop and CSS are gone", () => {
  const shell = read("src/renderer/mafw/components/WorkbenchShell.tsx")
  assert.doesNotMatch(shell, /instrumentRail/)
  const css = read("src/renderer/mafw/mafw.css")
  assert.doesNotMatch(css, /mafw-instrument-|mafw-focus-rail-slot/)
})

test("document toolbar only carries document actions, not diff/review", () => {
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.doesNotMatch(editor, /aria-label="改动"/)
  assert.doesNotMatch(editor, /mode\(\) === "diff"/)
  assert.doesNotMatch(editor, /<DiffReviewPanel/)
})
