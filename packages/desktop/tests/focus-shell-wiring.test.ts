import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const workbench = read("src/renderer/mafw/components/WorkbenchShell.tsx")

test("MafwShell owns the focus state and stack actions", () => {
  assert.match(shell, /createWorkbenchState/)
  assert.match(shell, /openSubject/)
  assert.match(shell, /popFocus/)
  assert.match(shell, /jumpTo/)
  assert.match(shell, /const \[focusState, setFocusState\] = createSignal/)
  assert.match(shell, /const focusBack =/)
  assert.match(shell, /focusView=\{activeFocus\(\)\}/)
})

test("WorkbenchShell renders the focus shell when focusView is set", () => {
  assert.match(workbench, /FrameBar/)
  assert.doesNotMatch(workbench, /LensBar/)
  assert.match(workbench, /FocusStage/)
  assert.match(workbench, /SubjectPicker/)
  assert.match(workbench, /focusView: Focus \| null/)
  assert.match(workbench, /when=\{props\.focusView\}/)
})

test("WorkbenchShell has no legacy context branch", () => {
  assert.doesNotMatch(workbench, /ContentScopeHeader|WorkbenchCodeView|WorkbenchContext/)
  assert.match(workbench, /when=\{props\.focusView\}[\s\S]*FocusStage/)
})

test("files open editable; preview promotion no longer depends on a lens", () => {
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(editor, /promotePreview/)
  assert.doesNotMatch(editor, /props\.intent/)
  assert.doesNotMatch(shell, /focusLensForIntent/)
})

test("focus changes drive the stage and plugin cache", () => {
  assert.match(shell, /stageActionFor/)
  assert.match(shell, /syncStageToFocus/)
  assert.match(workbench, /PluginSurfaceStage/)
})

test("focus opens use an explicit request instead of the global pending channel", () => {
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(shell, /requestFocusOpen/)
  assert.match(shell, /focusOpenRequest=\{focusOpenRequest\(\)\}/)
  assert.match(workbench, /focusOpenRequest/)
  assert.match(workbench, /openRequest=\{props\.focusOpenRequest\}/)
  assert.match(editor, /props\.openRequest/)
  assert.doesNotMatch(workbench, /lensCounts/)
})
