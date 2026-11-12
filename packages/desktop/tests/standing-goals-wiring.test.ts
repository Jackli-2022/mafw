import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

test("standing goals panel shows goal rows and run history without session ids", () => {
  const source = read("../src/renderer/mafw/components/StandingGoalsPanel.tsx")
  assert.match(source, /standingGoals\.list/)
  assert.match(source, /standingGoals\.runs/)
  assert.match(source, /next run/i)
  assert.match(source, /还没有长效目标/)
  assert.match(source, /onOpenGoal/)
  assert.doesNotMatch(source, /ses_[a-zA-Z0-9]+/)
})

test("project work view mounts the standing goals panel above priorities", () => {
  const source = read("../src/renderer/mafw/components/WorldOverviewStage.tsx")
  assert.match(source, /<StandingGoalsPanel/)
  assert.match(source, /projectDir=\{props\.projectDir\}/)
  assert.ok(source.indexOf("<StandingGoalsPanel") < source.indexOf("<WorkPriorityList"))
})
