import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("MafwShell renders the B1 shell and no SessionRail", () => {
  const src = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(src, /WorkbenchShell/)
  assert.match(src, /ExecutionView/)
  assert.match(src, /workbenchStateFromStorage/)
  assert.doesNotMatch(src, /SessionRail/)
  assert.doesNotMatch(src, /rightDockTab/)
  assert.match(src, /openWorkbench\("execution",\s*"background"\)/)
  assert.match(src, /openWorkbench\("review"\)/)
})
