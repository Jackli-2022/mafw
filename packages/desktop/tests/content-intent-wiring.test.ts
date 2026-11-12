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
  assert.match(editor, /props\.intent === "reading"[\s\S]{0,60}\? openPreviewFile/)
  assert.match(editor, /:\s*openFile\(m, rel, content, readOnly, kind\)/)
  assert.match(editor, /props\.intent === "reading"\) props\.onIntent\?\.\("editing"\)/)
  assert.match(editor, /mafw-editor-tab-preview/)
  assert.match(editor, /model\(\)\.files\.length > 1 \|\| props\.intent === "editing"/)
  assert.match(editor, /onActiveFileChange/)
  assert.match(css, /\.mafw-editor-tab-preview/)
})

test("focus lens drives the editor intent", () => {
  assert.match(shell, /activeFocus\(\)\?\.lens === "edit" \? "editing" : "reading"/)
  assert.match(stage, /intent=\{props\.focus\.lens === "edit" \? "editing" : "reading"\}/)
  assert.doesNotMatch(shell, /setContentIntent/)
})
