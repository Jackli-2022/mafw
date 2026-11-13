import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("changes face loads review items and hides actions when accepted", () => {
  const face = read("src/renderer/mafw/components/ChangesFace.tsx")
  assert.match(face, /pod\.reviewItems/)
  assert.match(face, /reviewActionsVisible/)
  assert.match(face, /resolveReviewItem/)
})

test("goal result links into the changes face", () => {
  const result = read("src/renderer/mafw/components/PodResultView.tsx")
  assert.match(result, /onOpenChanges/)
  assert.match(result, /改动面板/)
  const goal = read("src/renderer/mafw/components/GoalDetailPanel.tsx")
  assert.match(goal, /onOpenChanges/)
})

test("shell passes the review badge and project index", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /changesBadge/)
  assert.match(shell, /reviewCountForGoal/)
  assert.match(shell, /onOpenSession/)
})

test("session context with a goal still shows the review queue", () => {
  const face = read("src/renderer/mafw/components/ChangesFace.tsx")
  assert.match(face, /reviewGoal/)
  assert.match(face, /const goal = props\.reviewGoal/)
  assert.match(face, /reviewSection\(\)/)
})

test("review load failures render a neutral error outside the item list", () => {
  const face = read("src/renderer/mafw/components/ChangesFace.tsx")
  assert.match(face, /reviewItems\(\)\.length > 0 \|\| reviewError\(\)/)
  assert.match(face, /评审意见加载失败/)
  assert.doesNotMatch(face, /String\(\(error as any\)\?\.message/)
})
