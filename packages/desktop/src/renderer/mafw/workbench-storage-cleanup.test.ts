import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const shell = readFileSync(new URL("./MafwShell.tsx", import.meta.url), "utf8")

test("retired workbench keys are cleared and not read", () => {
  for (const key of [
    "mafw-workbench-context",
    "mafw-workbench-surface",
    "mafw-execution-section",
    "mafw-workbench-view",
  ]) {
    assert.match(shell, new RegExp(key))
  }
  assert.doesNotMatch(shell, /workbenchContext|applyWorkbenchContext|persistedWorkbenchContext|migrateWorkbenchStorage/)
})
