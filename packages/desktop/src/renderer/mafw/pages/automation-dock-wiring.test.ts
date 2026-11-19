import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")

test("AutomationsPage has a compact dock mode with a compact header", () => {
  const page = read("Automations.tsx")
  assert.match(page, /compact\?: boolean/)
  assert.match(page, /class="mafw-automations-page"/)
  assert.match(page, /classList=\{\{ "is-compact": !!props\.compact \}\}/)
  assert.match(page, /class="mafw-automations-header"/)
  assert.match(page, /when=\{!props\.compact\}/)
  assert.match(page, /\+ 新建规则/)
})

test("automation form fields are class-driven, not fixed inline widths", () => {
  const page = read("Automations.tsx")
  assert.match(page, /class="mafw-automations-field/)
  assert.doesNotMatch(page, /style=\{\{ width: "\d+px" \}\}/)
})

test("automations opens in the right workbench from the palette and renderPage", () => {
  const shell = read("../MafwShell.tsx")
  assert.match(shell, /navigateWorkbench\("automation"\)/)
  assert.match(shell, /case "automation":\s*\n\s*return <AutomationsPage compact \/>/)
})
