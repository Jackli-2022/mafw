import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

const shell = read("src/renderer/mafw/MafwShell.tsx")
const stage = read("src/renderer/mafw/components/FocusStage.tsx")
const editor = read("src/renderer/mafw/components/EditorDock.tsx")
const css = read("src/renderer/mafw/mafw.css")

test("editor opens preview tabs while reading and promotes on first edit", () => {
  assert.match(editor, /openPreviewFile/)
  assert.match(editor, /intent:\s*ContentIntent/)
  assert.match(editor, /onIntent\?:\s*\(intent:\s*ContentIntent\)/)
  assert.match(editor, /openModeForTab\(\{ intent: props\.intent, persist \}\)/)
  assert.match(editor, /mode === "persistent"[\s\S]{0,80}\? openFile/)
  assert.match(editor, /:\s*openPreviewFile/)
  assert.match(editor, /props\.intent === "reading"\) props\.onIntent\?\.\("editing"\)/)
  assert.match(editor, /editorDocumentTabs/)
  assert.match(editor, /DocumentTabs/)
  assert.match(editor, /onActiveFileChange/)
  assert.match(css, /\.mafw-document-tab-preview/)
})

test("focus lens drives the editor intent", () => {
  assert.match(shell, /activeFocus\(\)\?\.lens === "edit" \? "editing" : "reading"/)
  assert.match(stage, /DocumentStage/)
  assert.doesNotMatch(shell, /setContentIntent/)
})
