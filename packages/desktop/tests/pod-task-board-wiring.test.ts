import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("../src/renderer/mafw/components/PodTaskBoard.tsx", import.meta.url), "utf8")

test("task board uses model grouping and V2 primitives", () => {
  assert.match(src, /groupPodTasks/)
  assert.match(src, /TextInputV2/)
  assert.match(src, /ButtonV2/)
  assert.match(src, /onCreate/)
  assert.match(src, /Promise<boolean>/)
  assert.match(src, /if \(!ok\)/)
  assert.match(src, /onOpenGoal/)
  assert.match(src, /PodGoalQueue/)
  assert.doesNotMatch(src, /<button[\s>]/)
  assert.doesNotMatch(src, /title=/)
})
