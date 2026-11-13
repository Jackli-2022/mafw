import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("file tree opens persistent tabs without forcing the edit lens", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  const focusOpen = read("src/renderer/mafw/focus/focus-open.ts")

  const leftStart = shell.indexOf("<LeftDock")
  const leftBlock = shell.slice(leftStart, shell.indexOf("/>", leftStart))
  assert.match(leftBlock, /onOpenFile=\{/)
  assert.match(leftBlock, /persist:\s*true/)

  assert.match(focusOpen, /persist\?:/)
  assert.match(editor, /req\.persist/)
  assert.match(editor, /openModeForTab/)
})
