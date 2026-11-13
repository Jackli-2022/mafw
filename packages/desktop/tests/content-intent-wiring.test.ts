import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

const shell = read("src/renderer/mafw/MafwShell.tsx")
const stage = read("src/renderer/mafw/components/FocusStage.tsx")
const editor = read("src/renderer/mafw/components/EditorDock.tsx")
const css = read("src/renderer/mafw/mafw.css")

test("editor opens preview tabs and promotes them on first edit", () => {
  assert.match(editor, /openPreviewFile/)
  assert.match(editor, /openModeForTab\(\{ persist \}\)/)
  assert.match(editor, /mode === "persistent"[\s\S]{0,80}\? openFile/)
  assert.match(editor, /:\s*openPreviewFile/)
  assert.match(editor, /promotePreview/)
  assert.doesNotMatch(editor, /props\.intent/)
  assert.match(editor, /editorDocumentTabs/)
  assert.match(editor, /DocumentTabs/)
  assert.match(editor, /onActiveFileChange/)
  assert.match(css, /\.mafw-document-tab-preview/)
})

test("focus no longer drives an editor intent", () => {
  assert.doesNotMatch(shell, /contentIntent/)
  assert.doesNotMatch(stage, /intent=/)
  assert.doesNotMatch(shell, /setContentIntent/)
})
