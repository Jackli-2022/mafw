import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const editor = read("src/renderer/mafw/components/EditorDock.tsx")
const focusOpen = read("src/renderer/mafw/focus/focus-open.ts")

test("review items open through the left changes face", () => {
  assert.match(shell, /openChangesFace/)
  assert.match(shell, /section: "review"/)
  assert.match(shell, /syncStageToFocus\(next\)/)
  assert.doesNotMatch(shell, /openReviewItemToFocus|applyReviewFocus/)
  assert.match(focusOpen, /line\?: number/)
})

test("EditorDock jumps to the requested line after opening", () => {
  assert.match(editor, /FocusOpenRequest/)
  assert.match(editor, /props\.openRequest/)
  assert.match(editor, /gotoLine/)
})
