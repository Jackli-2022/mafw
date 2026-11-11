import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const workOverviewSrc = readFileSync(join(import.meta.dirname, "components/WorkOverview.tsx"), "utf8")
const prioritySrc = readFileSync(join(import.meta.dirname, "components/WorkPriorityList.tsx"), "utf8")

test("project Goal list uses the user-facing summary projection", () => {
  assert.match(workOverviewSrc, /summarizeGoalForUser/)
  assert.match(workOverviewSrc, /summary\.statusLabel/)
  assert.match(workOverviewSrc, /summary\.nextActionLabel/)
  assert.match(workOverviewSrc, /summary\.progressText/)
  assert.doesNotMatch(workOverviewSrc, /goalModeLabel/)
  assert.match(workOverviewSrc, /props\.onOpenGoal\(goal,/)
})

test("priority cards reuse the same next-action and status vocabulary", () => {
  assert.match(prioritySrc, /summarizeGoalForUser/)
  assert.match(prioritySrc, /summary\.statusLabel/)
  assert.match(prioritySrc, /summary\.nextActionLabel/)
  assert.match(prioritySrc, /props\.onOpen\(item\.goal,/)
})
