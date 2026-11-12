import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("MafwShell renders the focus shell and no legacy SessionRail", () => {
  const src = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(src, /WorkbenchShell/)
  assert.match(src, /openProjectChangeSetFocus\("review"\)/)
  assert.doesNotMatch(src, /SessionRail/)
  assert.doesNotMatch(src, /rightDockTab/)
  assert.doesNotMatch(src, /ExecutionView|openExecutionDrawer|openWorkbenchContext|migrateWorkbenchStorage/)
})
