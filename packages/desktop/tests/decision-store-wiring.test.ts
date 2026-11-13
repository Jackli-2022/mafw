import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const preload = read("src/preload/mafw-api.ts")
const client = read("../gateway-sdk/src/client.ts")

test("MafwShell owns one decision store and feeds the rail badge", () => {
  assert.match(shell, /createDecisionStore/)
  assert.match(shell, /attention: \(dir\) => window\.api\.mafw\.attention\.list\(dir\)/)
  assert.match(shell, /needsYou: decisionStore\.loaded\(\) \? decisionStore\.counts\(\)\.needsYou : undefined/)
  assert.match(shell, /void decisionStore\.refresh\(\)/)
  assert.match(shell, /setTimeout\(\(\) => \{ void decisionStore\.refresh\(\) \}, 250\)/)
  assert.match(shell, /scheduleDecisionRefresh/)
  assert.match(shell, /if \(!decisionStore\.ingest\(event\)\) scheduleDecisionRefresh\(\)/)
})

test("attention is reachable through preload and the SDK client", () => {
  assert.match(preload, /attention: \{/)
  assert.match(preload, /invoke\("attention", "list", projectDir\)/)
  assert.match(client, /\/api\/attention/)
})
