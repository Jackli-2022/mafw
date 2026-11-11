import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const workOverviewSrc = readFileSync(join(import.meta.dirname, "components/WorkOverview.tsx"), "utf8")
const prioritySrc = readFileSync(join(import.meta.dirname, "components/WorkPriorityList.tsx"), "utf8")
const goalDetailSrc = readFileSync(join(import.meta.dirname, "components/GoalDetailPanel.tsx"), "utf8")

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

test("Goal detail derives user faces from the shared summary", () => {
  assert.match(goalDetailSrc, /summarizeGoalForUser/)
  assert.match(goalDetailSrc, /GoalUserHero/)
  assert.match(goalDetailSrc, /technicalOpen/)
  assert.match(goalDetailSrc, /summary\(\)\.statusLabel/)
  assert.match(goalDetailSrc, /mafw-goal-technical/)
  assert.match(goalDetailSrc, /<PodTaskBoard/)
  assert.match(goalDetailSrc, /<GoalTimelineLane/)
})

test("result and change evidence precede collapsed technical diagnostics", () => {
  const resultIndex = goalDetailSrc.indexOf("<PodResultView")
  const technicalIndex = goalDetailSrc.indexOf("mafw-goal-technical")
  assert.ok(resultIndex >= 0, "PodResultView must remain in Goal detail")
  assert.ok(technicalIndex >= 0, "technical diagnostics section must exist")
  assert.ok(resultIndex < technicalIndex, "result must come before technical diagnostics")
})

test("the primary Goal header does not expose the internal Goal id", () => {
  const headerStart = goalDetailSrc.indexOf('class="mafw-goal-head"')
  const metaStart = goalDetailSrc.indexOf('class="mafw-goal-meta"')
  assert.ok(headerStart >= 0 && metaStart > headerStart)
  assert.doesNotMatch(goalDetailSrc.slice(headerStart, metaStart), /mafw-goal-id/)
})
