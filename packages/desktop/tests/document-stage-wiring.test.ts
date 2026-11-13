import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("DocumentStage renders one strip and keeps both bodies mounted", () => {
  const stage = read("src/renderer/mafw/components/DocumentStage.tsx")
  assert.match(stage, /DocumentTabs/)
  assert.match(stage, /documentTabs\(\)/)
  assert.match(stage, /documentTabViews/)
  assert.match(stage, /buildDocumentTabMenu/)
  assert.match(stage, /<EditorDock/)
  assert.match(stage, /<BrowserDock/)
  assert.match(stage, /mafw-document-stage-pane/)
})

test("FocusStage routes editor and browser through DocumentStage", () => {
  const stage = read("src/renderer/mafw/components/FocusStage.tsx")
  assert.match(stage, /DocumentStage/)
  assert.match(stage, /onDocumentSelect/)
  assert.match(stage, /onDocumentClose/)
  assert.match(stage, /onDocumentCloseMany/)
  assert.match(stage, /kind\(\) === "editor" \|\| kind\(\) === "browser"/)
})

test("WorkbenchShell forwards document callbacks", () => {
  const shell = read("src/renderer/mafw/components/WorkbenchShell.tsx")
  assert.match(shell, /onDocumentSelect/)
  assert.match(shell, /onDocumentClose/)
  assert.match(shell, /onDocumentCloseMany/)
  assert.match(shell, /onDocumentSelect=\{props\.onDocumentSelect\}/)
})

test("editor and browser can embed without their own tab strip", () => {
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  const browser = read("src/renderer/mafw/components/BrowserDock.tsx")

  assert.match(editor, /embedded\?: boolean/)
  assert.match(editor, /syncFileTabs/)
  assert.match(editor, /pendingCloseRequests/)
  assert.match(browser, /embedded\?: boolean/)
  assert.match(browser, /syncWebTabs/)
  assert.match(browser, /pendingCloseRequests/)
})
