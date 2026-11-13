import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("editor promotes a preview tab on first user edit", () => {
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(editor, /promotePreview/)
  assert.match(editor, /onDocChanged/)
  assert.doesNotMatch(editor, /props\.intent/)
})

test("workbench no longer renders the lens bar", () => {
  const shell = read("src/renderer/mafw/components/WorkbenchShell.tsx")
  assert.doesNotMatch(shell, /LensBar/)
  assert.doesNotMatch(shell, /lenses=/)
})
