import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("editor and browser share one DocumentFrame tab/toolbar language", () => {
  const component = read("src/renderer/mafw/components/document-frame.tsx")
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  const browser = read("src/renderer/mafw/components/BrowserDock.tsx")

  assert.match(component, /export function DocumentFrame/)
  assert.match(component, /export function DocumentTabs/)
  assert.match(component, /export function DocumentToolbar/)
  assert.match(editor, /DocumentFrame/)
  assert.match(editor, /DocumentTabs/)
  assert.match(editor, /DocumentToolbar/)
  assert.match(browser, /DocumentFrame/)
  assert.match(browser, /DocumentTabs/)
  assert.match(browser, /DocumentToolbar/)
})

test("editor drops its private header and tab strip", () => {
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.doesNotMatch(editor, /DockPanelHeader\s+title="编辑器"/)
  assert.doesNotMatch(editor, /mafw-editor-tabs/)
  assert.match(editor, /editorDocumentTabs/)
})

test("browser drops its private pill tab bar and address bar", () => {
  const browser = read("src/renderer/mafw/components/BrowserDock.tsx")
  assert.doesNotMatch(browser, /TabsV2/)
  assert.doesNotMatch(browser, /mafw-browser-tabbar/)
  assert.doesNotMatch(browser, /mafw-browser-bar/)
  assert.match(browser, /browserDocumentTabs/)
})

test("tab strip handles wheel-to-horizontal scrolling", () => {
  const component = read("src/renderer/mafw/components/document-frame.tsx")
  assert.match(component, /onWheel/)
  assert.match(component, /scrollLeft/)
  assert.match(component, /tabStripWheelDelta/)
})

test("document chrome CSS is shared", () => {
  const css = read("src/renderer/mafw/mafw.css")
  for (const cls of [
    ".mafw-document-frame",
    ".mafw-document-tabs",
    ".mafw-document-tab",
    ".mafw-document-toolbar",
    ".mafw-document-body",
  ]) {
    assert.ok(css.includes(cls), `missing ${cls}`)
  }
})
