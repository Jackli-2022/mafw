import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const workOverviewSrc = readFileSync(join(import.meta.dirname, "components/WorkOverview.tsx"), "utf8")
const prioritySrc = readFileSync(join(import.meta.dirname, "components/WorkPriorityList.tsx"), "utf8")
const goalDetailSrc = readFileSync(join(import.meta.dirname, "components/GoalDetailPanel.tsx"), "utf8")
const mafwShellSrc = readFileSync(join(import.meta.dirname, "MafwShell.tsx"), "utf8")
const chatPaneSrc = readFileSync(join(import.meta.dirname, "components/ChatPane.tsx"), "utf8")
const goalUserHeroSrc = readFileSync(join(import.meta.dirname, "components/GoalUserHero.tsx"), "utf8")
const mafwCssSrc = readFileSync(join(import.meta.dirname, "mafw.css"), "utf8")

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

function between(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0, `missing start marker: ${startMarker}`)
  assert.ok(end > start, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

test("Goal actions keep the right Goal detail open", () => {
  assert.doesNotMatch(between(goalDetailSrc, "const techLeadEntry", "// Task 21"), /props\.onClose\(\)/)
  assert.doesNotMatch(between(goalDetailSrc, "const rejectGoal", "async function answerQuestion"), /props\.onClose\(\)/)
  assert.doesNotMatch(between(goalDetailSrc, "onOpenSession={(sid) => {", "onRetry={"), /props\.onClose\(\)/)
})

test("opening a Goal enters its Tech Lead discussion without losing the Goal", () => {
  assert.match(mafwShellSrc, /openGoalAndDiscuss/)
  assert.match(mafwShellSrc, /shouldOpenTechLeadForGoal/)
  assert.match(mafwShellSrc, /goalDiscussionTarget/)
  assert.match(mafwShellSrc, /onOpenGoal=\{\(goal, focus\) => \{ void openGoalAndDiscuss\(goal\.goalId, focus\) \}\}/)
  assert.match(mafwShellSrc, /onGoalCreated=\{\(goalId\) => \{ void openGoalAndDiscuss\(goalId\) \}\}/)
  assert.doesNotMatch(mafwShellSrc, /onOpenGoal=\{\(goal, focus\) => openGoalDetail\(/)
  assert.doesNotMatch(mafwShellSrc, /onGoalCreated=\{\(goalId\) => openGoalDetail\(/)
})

test("ChatPane exposes Return to Lead only through the shared context rule", () => {
  assert.match(chatPaneSrc, /showReturnLead\?: \(\) => boolean/)
  assert.match(chatPaneSrc, /onReturnLead\?: \(\) => void/)
  assert.match(chatPaneSrc, /props\.showReturnLead\?\.\(\)/)
  assert.match(chatPaneSrc, /返回项目 Lead/)
  assert.match(chatPaneSrc, /class="mafw-return-lead"/)
  assert.doesNotMatch(chatPaneSrc, /<button\b/)
})

test("Goal user-view styles use theme tokens and no mounted display:none", () => {
  for (const className of [
    "mafw-goal-user-hero",
    "mafw-goal-user-status",
    "mafw-goal-user-progress",
    "mafw-goal-user-next",
    "mafw-goal-technical",
    "mafw-return-lead",
  ]) {
    assert.match(mafwCssSrc, new RegExp(`\\.${className}\\s*\\{[^}]*var\\(--`), `${className} must use theme tokens`)
  }
  assert.doesNotMatch(mafwCssSrc, /\.mafw-goal-technical\s*\{[^}]*display\s*:\s*none/)
  assert.doesNotMatch(goalUserHeroSrc, /<(button|input)\b/)
})
