import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")

test("MafwShell opens pages through the generic page focus", () => {
  const shell = read("MafwShell.tsx")
  assert.match(shell, /const openPageFocus = \(id: WorkbenchPageId\) =>/)
  assert.match(shell, /subject: \{ kind: "page", id \}/)
  assert.match(shell, /selectFocus\(seedWorldRoot\(state, worldScope\), worldScope, \{ kind: "page", id \}\)/)
  assert.match(shell, /const activePageId = \(\): WorkbenchPageId \| null =>/)
  assert.match(shell, /renderPage=\{\(id\) =>/)
  assert.match(shell, /subject\.kind === "page" \? WORKBENCH_PAGE_META\[subject\.id\]\.label/)
  assert.match(shell, /isStalePageActiveTab\(activeDocumentTabId\(\), focusState\(\)\.stack\.map/)
})

test("scene helpers understand page subjects without using kind as the icon", () => {
  const shell = read("MafwShell.tsx")
  assert.match(shell, /WORKBENCH_PAGE_META\[subject\.id\]\.label/)
  assert.match(shell, /sceneTabIconFor\(scene\)/)
  assert.doesNotMatch(shell, /icon: scene\.kind/)
})

test("FocusStage has a page stage slot", () => {
  const stage = read("components/FocusStage.tsx")
  assert.match(stage, /renderPage\?: \(id: WorkbenchPageId\) => JSX\.Element/)
  assert.match(stage, /kind\(\) === "page"/)
  assert.match(stage, /mafw-focus-page-stage/)
  assert.match(stage, /props\.renderPage\?\.\(pageId\(\)!\)/)
})

test("scene tabs reserve a persistent scene:page:<id> id", () => {
  const tabs = read("documents/scene-tabs.ts")
  assert.match(tabs, /return `scene:page:\$\{subject\.id\}`/)
  assert.match(tabs, /subject\.kind === "page"/)
  assert.match(tabs, /WORKBENCH_PAGE_META\[subject\.id\]\.icon/)
  assert.match(tabs, /export function sceneTabIconFor/)
})

test("focus persistence accepts page focuses", () => {
  const persistence = read("focus/focus-persistence.ts")
  assert.match(persistence, /case "page":/)
  assert.match(persistence, /isWorkbenchPageId\(value\.id\)/)
})
