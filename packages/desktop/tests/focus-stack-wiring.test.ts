import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const shell = read("src/renderer/mafw/MafwShell.tsx")

test("MafwShell wires focus persistence at boot and on change", () => {
  assert.match(shell, /configureFocusStorage\(window\.localStorage\)/)
  assert.match(shell, /loadFocusState/)
  assert.match(shell, /saveFocusState/)
  assert.match(shell, /flushFocusPersistence/)
})

test("MafwShell restores and validates per-world focus", () => {
  assert.match(shell, /currentProject\(\) \?\? "unscoped"/)
  assert.match(shell, /window\.api\.fs\.listDir\(scope\.worktreeDir, ""\)/)
  assert.match(shell, /popFocus\(/)
  assert.match(shell, /jumpTo\(/)
})

test("focus back closes the last focus and lands on the picker", () => {
  assert.match(shell, /focusState\(\)\.stack\.length === 1/)
  assert.match(shell, /showWorkbenchLanding\(\)/)
  assert.match(shell, /onFocusBack=\{focusBack\}/)
  assert.match(shell, /syncStageToFocus\(next\)/)
  assert.match(shell, /const focusCrumb = \(index: number\) => \{/)
})

test("picker opens with Meta+P or Ctrl+P and closes with Escape", () => {
  assert.match(shell, /event\.key === "p"/)
  assert.match(shell, /event\.metaKey \|\| event\.ctrlKey/)
  assert.match(shell, /event\.key === "Escape"/)
  assert.match(shell, /window\.addEventListener\("keydown"/)
  assert.match(shell, /window\.removeEventListener\("keydown"/)
  assert.match(shell, /onCleanup/)
})

test("picking an item opens its scope and subject", () => {
  assert.match(shell, /openSubject\([\s\S]{0,160}?item\.scope,[\s\S]{0,80}?item\.subject,[\s\S]{0,40}?item\.lens/)
  assert.match(shell, /setPickerOpen\(false\)/)
})
