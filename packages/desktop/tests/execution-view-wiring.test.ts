import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("execution view reuses all existing panels and has no run controls", () => {
  const src = read("src/renderer/mafw/components/ExecutionView.tsx")
  assert.match(src, /TaskList/)
  assert.match(src, /SubagentDock/)
  assert.match(src, /BackgroundDock/)
  assert.match(src, /TrajectoryDock/)
  assert.match(src, /summarizeExecution/)
  assert.match(src, /todos: props\.todos/)
  assert.match(src, /agentLabel/)
  assert.match(src, /modelLabel/)
  assert.match(src, /runStatus/)
  assert.doesNotMatch(src, /resumeRun|suspendRun|discardRun|pauseRun/)
})
