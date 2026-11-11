import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

const shell = read("src/renderer/mafw/MafwShell.tsx")
const workbench = read("src/renderer/mafw/components/WorkbenchShell.tsx")
const codeView = read("src/renderer/mafw/components/WorkbenchCodeView.tsx")
const editor = read("src/renderer/mafw/components/EditorDock.tsx")
const header = read("src/renderer/mafw/components/ContentScopeHeader.tsx")
const css = read("src/renderer/mafw/mafw.css")

test("content header exposes reading / editing and a Goal review shortcut", () => {
  assert.match(header, /mafw-content-intents/)
  assert.match(header, /阅读/)
  assert.match(header, /修改/)
  assert.match(header, /验收/)
  assert.match(header, /onIntent/)
  assert.match(header, /canReview/)
  assert.match(header, /onReview/)
  assert.match(css, /\.mafw-content-intent\[aria-pressed="true"\]/)
})

test("editor opens preview tabs while reading and promotes on first edit", () => {
  assert.match(editor, /openPreviewFile/)
  assert.match(editor, /intent:\s*ContentIntent/)
  assert.match(editor, /onIntent\?:\s*\(intent:\s*ContentIntent\)/)
  assert.match(editor, /props\.intent === "reading"[\s\S]{0,60}\? openPreviewFile/)
  assert.match(editor, /:\s*openFile\(m, rel, content, readOnly, kind\)/)
  assert.match(editor, /props\.intent === "reading"\) props\.onIntent\?\.\("editing"\)/)
  assert.match(editor, /mafw-editor-tab-preview/)
  assert.match(css, /\.mafw-editor-tab-preview/)
})

test("shell owns the content intent and resets project opens to reading", () => {
  assert.match(shell, /contentIntent/)
  assert.match(shell, /setContentIntent/)
  assert.match(shell, /openProjectFile[\s\S]{0,500}"reading"/)
  assert.match(shell, /contentIntent=\{contentIntent\(\)\}/)
  assert.match(shell, /onContentIntent=\{setContentIntent\}/)
  assert.match(shell, /canReview=\{contentScopeIsGoal\(\)\}/)
  assert.match(shell, /onContentReview=/)
  assert.match(shell, /openGoalDetail\(scope\.goalId, "result"\)/)
})

test("intent flows through WorkbenchShell into EditorDock", () => {
  assert.match(workbench, /contentIntent:\s*ContentIntent/)
  assert.match(workbench, /onContentIntent:\s*\(intent:\s*ContentIntent\)/)
  assert.match(workbench, /onContentReview/)
  assert.match(codeView, /intent:\s*ContentIntent/)
  assert.match(codeView, /onIntent:\s*\(intent:\s*ContentIntent\)/)
})
