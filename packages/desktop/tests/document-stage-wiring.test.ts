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

test("DocumentStage renders the active toolbar from the registry", () => {
  const stage = read("src/renderer/mafw/components/DocumentStage.tsx")
  assert.match(stage, /DocumentToolbar/)
  assert.match(stage, /documentToolbarProvider/)
  assert.match(stage, /spec\(\)\.ariaLabel/)
  assert.match(stage, /spec\(\)\.leading/)
  assert.match(stage, /spec\(\)\.center/)
  assert.match(stage, /spec\(\)\.trailing/)
})

test("document tabs expose drag reorder wiring", () => {
  const frame = read("src/renderer/mafw/components/document-frame.tsx")
  const stage = read("src/renderer/mafw/components/DocumentStage.tsx")
  const css = read("src/renderer/mafw/mafw.css")

  assert.match(frame, /onReorder\?:/)
  assert.match(frame, /draggable=/)
  assert.match(frame, /onDragStart=/)
  assert.match(frame, /onDragOver=/)
  assert.match(frame, /onDrop=/)
  assert.match(stage, /moveDocumentTab/)
  assert.match(css, /\.mafw-document-tab\.is-dragging/)
  assert.match(css, /\.mafw-document-tab\.drop-before/)
  assert.match(css, /\.mafw-document-tab\.drop-after/)
})

test("browser dock restores and persists tab snapshots", () => {
  const browser = read("src/renderer/mafw/components/BrowserDock.tsx")
  assert.match(browser, /restoreBrowserTabsOnce/)
  assert.match(browser, /saveBrowserTabsSnapshot/)
  assert.match(browser, /activeBrowserDocumentId/)
})

test("editor and browser can embed without their own tab strip", () => {
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  const browser = read("src/renderer/mafw/components/BrowserDock.tsx")

  assert.match(editor, /embedded\?: boolean/)
  assert.match(editor, /configureFileDocumentRoot/)
  assert.doesNotMatch(editor, /syncFileTabs/)
  assert.match(editor, /pendingCloseRequests/)
  assert.match(editor, /registerDocumentToolbar\("file"/)
  assert.match(editor, /if \(props\.embedded\) return body/)
  assert.match(browser, /embedded\?: boolean/)
  assert.doesNotMatch(browser, /syncWebTabs/)
  const store = read("src/renderer/mafw/documents/document-tabs-store.ts")
  assert.match(store, /fileModelFor/)
  assert.match(store, /syncFileDocuments/)
  assert.match(store, /browserDocuments\(\)/)
  assert.match(store, /createEffect\(syncBrowserDocuments\)/)
  assert.match(browser, /pendingCloseRequests/)
  assert.match(browser, /registerDocumentToolbar\("web"/)
  assert.match(browser, /if \(props\.embedded\) return body/)
  assert.match(browser, /onContextMenu=\{props\.embedded \? requestDockMenu : undefined\}/)
})
