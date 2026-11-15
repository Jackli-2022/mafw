import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const items = read("src/renderer/mafw/components/PodReviewItems.tsx")

test("Tech Lead chat surfaces unresolved review items inline", () => {
  assert.match(chat, /PodReviewItems/)
  assert.match(chat, /visibleChatReviewItems/)
  assert.match(chat, /pod\.reviewItems/)
  assert.match(chat, /resolveReviewItem/)
  assert.match(chat, /reopenReviewItem/)
  assert.match(chat, /mafw-chat-review-inline/)
  assert.match(chat, /onOpenReview/)
  assert.match(items, /确认解决/)
})

test("shell supplies the review refresh key and full-review entry", () => {
  assert.match(shell, /reviewRefreshKey=\{\(\) => podStore\.reviewRevision\(\)\}/)
  assert.match(shell, /reviewActive=\{/)
  assert.match(shell, /reviewAccepted=\{/)
  assert.match(shell, /onOpenReview=\{/)
  assert.match(shell, /setPodGoalId\(goalId\)/)
  assert.match(shell, /openChangesFace\(\{ section: "review" \}\)/)
})
