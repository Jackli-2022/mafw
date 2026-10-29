import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("right workbench owns L1/L2 and the terminal surface", () => {
  const shell = read("src/renderer/mafw/components/WorkbenchShell.tsx")
  const code = read("src/renderer/mafw/components/WorkbenchCodeView.tsx")

  assert.match(shell, /WORKBENCH_VIEWS/)
  assert.match(shell, /EXECUTION_SECTIONS/)
  assert.match(shell, /DropdownMenu/)
  assert.doesNotMatch(shell, /TerminalDock/)
  assert.doesNotMatch(shell, /mafw-rw-terminal/)
  assert.match(shell, /executionView/)
  assert.match(shell, /reviewView/)
  assert.match(shell, /role="tablist"/)
  assert.match(shell, /role="tab"/)
  assert.match(shell, /DropdownMenu\.Trigger as=\{ButtonV2\}/)
  assert.doesNotMatch(shell, /SessionRail/)

  assert.match(code, /FilesDock/)
  assert.match(code, /setFilesOpen\(false\)/)
  assert.match(code, /EditorDock/)
  assert.match(code, /BrowserDock/)
  assert.match(code, /TerminalSurface/)
  assert.match(code, /active=\{props\.active && props\.surface === "terminal"\}/)
  assert.match(code, /mafw-rw-files-toggle/)
  assert.match(code, /files-open/)
})
