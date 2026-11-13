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
