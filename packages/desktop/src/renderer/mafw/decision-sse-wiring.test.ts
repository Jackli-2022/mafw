import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")
const shell = read("MafwShell.tsx")
const dispatcher = read("sse/dispatcher.ts")

test("decision updates refresh the board without polling", () => {
  assert.match(dispatcher, /decision\.updated/)
  assert.match(shell, /scheduleDecisionRefresh/)
  assert.match(shell, /decisions: \{ onEvent: scheduleDecisionRefresh \}/)
  assert.doesNotMatch(shell, /setInterval\(\(\) => \{ void decisionStore\.refresh\(\) \}, 15000\)/)
})
