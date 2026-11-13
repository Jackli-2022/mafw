import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("MafwShell owns the unified document strip routing", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")

  assert.match(shell, /onDocumentSelect=\{focusDocumentTab\}/)
  assert.match(shell, /onDocumentClose=\{closeDocumentTab\}/)
  assert.match(shell, /onDocumentCloseMany=\{closeDocumentTabs\}/)
  assert.match(shell, /const focusDocumentTab =/)
  assert.match(shell, /const closeDocumentTab =/)
  assert.match(shell, /const closeDocumentTabs =/)
  assert.match(shell, /activateDocumentTab/)
  assert.match(shell, /requestCloseDocumentTab/)
  assert.match(shell, /nextDocumentTabId/)
  assert.match(shell, /fileDocumentTabId/)
  assert.match(shell, /webDocumentTabId/)
  assert.match(shell, /activeBrowserDocumentId/)
})

test("DocumentStage mounts both embedded bodies", () => {
  const stage = read("src/renderer/mafw/components/DocumentStage.tsx")
  assert.match(stage, /<EditorDock/)
  assert.match(stage, /embedded/)
  assert.match(stage, /<BrowserDock/)
  assert.match(stage, /onSelect=/)
  assert.match(stage, /onClose=/)
  assert.match(stage, /onCloseMany/)
})

test("MafwShell opens a blank browser tab for the browser command", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /target\.length === 0 \|\| target === "about:blank"/)
  assert.match(shell, /openBrowserDocument\("", \{ newTab: true \}\)/)
  assert.match(shell, /if \(item\.subject\.kind === "web"\)/)
  assert.match(shell, /openBrowserFocus\(item\.subject\.url, \{ newTab: true \}\)/)
})

test("MafwShell configures document persistence per world", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /configureDocumentListStorage/)
  assert.match(shell, /configureBrowserTabsStorage/)
  assert.match(shell, /configureDocumentListWorld/)
  assert.match(shell, /configureDocumentListWorld\(project \?\? "unscoped"\)/)
  assert.match(shell, /\(\) => currentProject\(\)/)
})
