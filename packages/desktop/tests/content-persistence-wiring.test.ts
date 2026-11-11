import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const editor = read("src/renderer/mafw/components/EditorDock.tsx")
const codeView = read("src/renderer/mafw/components/WorkbenchCodeView.tsx")

test("shell wires localStorage into scope state and drafts", () => {
  assert.match(shell, /configureContentScopeStateStorage\(window\.localStorage\)/)
  assert.match(shell, /configureEditorDraftStorage\(window\.localStorage\)/)
})

test("editor restores the last active document and treats restored drafts as dirty", () => {
  assert.match(editor, /const activeRel = scopeKey \? contentScopeStateFor\(scopeKey\)\.activeFile : null/)
  assert.match(editor, /const shouldRestore = !!root && restored\.files\.length === 0 && !!activeRel/)
  assert.match(editor, /void openRel\(activeRel\)/)
  assert.match(editor, /if \(!current\.root \|\| current\.root !== props\.contentRoot\) return/)
  assert.match(editor, /if \(current\.files\.length === 0 && !allowEmptyPersist && scopeState\.activeFile\) return/)
  assert.match(editor, /restoringActive = shouldRestore/)
  assert.match(editor, /if \(restoringActive && current\.files\.length === 0\) return/)
  assert.match(editor, /getDraft\(root, rel\) !== undefined \? markDirty\(next, rel\) : next/)
})

test("file tree drawer preference is persisted per content scope", () => {
  assert.match(codeView, /contentScopeStateFor\(props\.contentScopeKey\)\.filesOpen/)
  assert.match(codeView, /saveContentScopeState\(props\.contentScopeKey, \{/)
  assert.match(codeView, /filesOpen: open/)
  assert.match(codeView, /persistFilesOpen\(false\)/)
})
