import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")

test("TriagePage has a compact dock mode", () => {
  const page = read("TriagePage.tsx")
  assert.match(page, /compact\?: boolean/)
  assert.match(page, /class="mafw-triage-page"/)
  assert.match(page, /classList=\{\{ "is-compact": !!props\.compact \}\}/)
  assert.match(page, /when=\{!props\.compact\}/)
  assert.match(page, /class="mafw-triage-actions"/)
})

test("triage opens in the right workbench from the palette and renderPage", () => {
  const shell = read("../MafwShell.tsx")
  assert.match(shell, /openPageFocus\("triage"\)/)
  assert.match(shell, /case "triage":\s*\n\s*return <TriagePage compact onOpenGoals=\{openProjectWork\} \/>/)
})
