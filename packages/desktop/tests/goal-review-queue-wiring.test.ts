import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const queue = read("src/renderer/mafw/components/GoalReviewQueue.tsx")

test("GoalReviewQueue projects review items through PodReviewItems", () => {
  assert.match(queue, /window\.api\.mafw\.pod\.reviewItems/)
  assert.match(queue, /PodReviewItems/)
  assert.match(queue, /onFocusItem/)
  assert.match(queue, /reviewItems/)
})

test("GoalReviewQueue keeps human-only resolve and reopen", () => {
  assert.match(queue, /resolveReviewItem/)
  assert.match(queue, /reopenReviewItem/)
  assert.match(queue, /catch/)
  assert.doesNotMatch(queue, /mark.*resolved/i)
})
