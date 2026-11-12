import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const shell = readFileSync(new URL("./MafwShell.tsx", import.meta.url), "utf8")

test("contentScope memo initializes after its helpers", () => {
  const activeFocus = shell.indexOf("const activeFocus =")
  const contentScopeFromFocus = shell.indexOf("const contentScopeFromFocus =")
  const contentScopeMemo = shell.indexOf("const contentScope = createMemo")
  assert.ok(activeFocus >= 0)
  assert.ok(contentScopeFromFocus >= 0)
  assert.ok(contentScopeMemo >= 0)
  // createMemo runs its callback immediately; helpers declared below would TDZ.
  assert.ok(activeFocus < contentScopeMemo)
  assert.ok(contentScopeFromFocus < contentScopeMemo)
})
