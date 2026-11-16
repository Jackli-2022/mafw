import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const shell = read("src/renderer/mafw/MafwShell.tsx")

test("restored Lead tabs resolve to the current Pod Lead, not the saved id", () => {
  assert.match(shell, /planLeadTabRestore/)
  assert.match(shell, /pendingLeadRestore/)
  assert.match(shell, /activate: leadPlan\.activate/)
  assert.match(shell, /podRoleForSession\(podStore\.detail\(\), t\.id\) === "lead"/)
  assert.match(shell, /staleIds/)
  assert.match(shell, /stale\.some\(\(tab\) => tab\.id === activeSessionId\(\)\)/)
  assert.match(shell, /openSessionTab\(leadId, "Lead", true, leadTabMetadata\(\), \{ activate \}\)/)
})

test("historical Lead sessions are not marked as the current Lead tab", () => {
  const strip = read("src/renderer/mafw/components/SessionStrip.tsx")
  assert.match(strip, /leadSessionId\?: string \| null/)
  assert.match(strip, /s\.id === props\.leadSessionId/)
  assert.doesNotMatch(strip, /props\.podRoleOf\?\.\(s\.id\) === "lead"/)
  assert.match(shell, /leadSessionId=\{currentLeadId\(currentProject\(\)\)\}/)
})

test("restored non-Lead tabs do not steal focus", () => {
  assert.match(shell, /const activate = options\?\.activate !== false/)
  assert.match(shell, /activate: pruned\.activeViewId === t\.id/)
})

test("the project Pod detail is refreshed before Lead reconciliation", () => {
  assert.match(shell, /podStore\.open\(dir\)\.then\(\(\) => podStore\.refresh\(\)\)/)
})
