import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const rail = read("src/renderer/mafw/components/IconRail.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")

test("the rail Lead button opens Lead and keeps team on right-click", () => {
  assert.match(rail, /onLead:/)
  assert.match(rail, /label: "Lead"/)
  assert.match(rail, /leadActive/)
  assert.match(rail, /buildRailLeadMenu/)
  assert.match(rail, /onTeam/)
  assert.match(shell, /onLead=\{/)
  assert.match(shell, /leadActive=\{activeSessionIsLead\(\)\}/)
  assert.match(shell, /onTeam=\{/)
})
