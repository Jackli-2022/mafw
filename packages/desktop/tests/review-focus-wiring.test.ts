import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const editor = read("src/renderer/mafw/components/EditorDock.tsx")

test("review item focus carries the line into the explicit open request", () => {
  assert.match(shell, /openReviewItemToFocus/)
  assert.match(shell, /requestFocusOpen\(scope\.worktreeDir, item\.rel, line\)/)
  assert.match(shell, /:L/)
})

test("EditorDock jumps to the requested line after opening", () => {
  assert.match(editor, /line\?: number/)
  assert.match(editor, /props\.openRequest/)
  assert.match(editor, /gotoLine/)
})
