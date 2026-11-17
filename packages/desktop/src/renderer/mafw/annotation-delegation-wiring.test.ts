import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8")

test("Goal delegation is wired through one batch executor and the composer", () => {
  const dialog = read("./components/AnnotationActionDialog.tsx")
  assert.match(dialog, /onDelegateGoal/)
  assert.match(dialog, /onCreateGoal/)
  assert.match(dialog, /eligibleDelegationGoals\(/)
  assert.match(dialog, /PodGoalComposer/)
  assert.doesNotMatch(dialog, /<button[\s>]/)

  const composer = read("./components/PodGoalComposer.tsx")
  assert.match(composer, /initialTitle/)
  assert.match(composer, /initialObjective/)
  assert.match(composer, /initialAcceptance/)
  assert.match(composer, /heading/)

  const shell = read("./MafwShell.tsx")
  assert.match(shell, /delegateAnnotationBatch\(/)
  assert.match(shell, /verifyDelegationTarget\(/)
  assert.match(shell, /createReviewItems\(/)
  assert.match(shell, /onDelegateGoal=\{delegateToGoalAction\}/)
  assert.match(shell, /onCreateGoal=\{createGoalForAnnotations\}/)
  const discussionOnly = shell.slice(
    shell.indexOf("const deliverDiscussionFor"),
    shell.indexOf("const verifyDelegationTarget"),
  )
  assert.doesNotMatch(discussionOnly, /createReviewItems/)
})
