import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const shell = readFileSync(new URL("./MafwShell.tsx", import.meta.url), "utf8")

test("workbench entry points go through focus actions", () => {
  for (const name of [
    "revealWorkbench",
    "openWorldOverview",
    "openGoalFocus",
    "openBrowserFocus",
    "openTerminalFocus",
    "openPluginFocus",
    "openChangesFace",
    "showWorkbenchLanding",
  ]) {
    assert.match(shell, new RegExp(name))
  }
  assert.doesNotMatch(shell, /openWorkbenchContext\(/)
  assert.doesNotMatch(shell, /openWorkbenchSurface\(/)
  assert.doesNotMatch(shell, /applyWorkbenchContext\(/)
})
