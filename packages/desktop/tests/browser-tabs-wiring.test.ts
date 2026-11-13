import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (file: string) =>
  readFileSync(join(import.meta.dirname, "..", "src", "renderer", "mafw", "components", file), "utf8")

test("BrowserDock uses the shared DocumentTabs and one pane per tab", () => {
  const src = read("BrowserDock.tsx")
  assert.match(src, /DocumentTabs/)
  assert.match(src, /browserDocumentTabs/)
  assert.match(src, /onMiddleClick/)
  assert.match(src, /browserDocuments\(\)/)
  assert.match(src, /createBrowserViewRegistry/)
  assert.match(src, /navigateExistingView/)
  assert.match(src, /mafw-browser-tab-pane/)
  assert.doesNotMatch(src, /TabsV2/)
})

test("browser tabs have a per-tab context menu", () => {
  const src = read("BrowserDock.tsx")
  assert.match(src, /buildBrowserTabMenu/)
  assert.match(src, /onContextMenu=\{requestTabMenu\}/)
  assert.match(src, /closeOtherBrowserDocuments/)
  assert.match(src, /closeBrowserDocumentsToRight/)
})
