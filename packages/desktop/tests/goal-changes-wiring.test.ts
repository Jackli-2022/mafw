import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("changes face fetches goal worktree diff and opens a diff tab", () => {
  const face = read("src/renderer/mafw/components/ChangesFace.tsx")
  assert.match(face, /pod\.worktreeDiff/)
  assert.match(face, /onOpenDiff/)
  assert.match(face, /pinGoalRevision/)
})

test("shell resolves the current goal and worktree directory", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /currentGoalRef/)
  assert.match(shell, /resolveGoalWorktreeDir/)
  assert.match(shell, /onOpenDiff=\{openDiffTab\}/)
})
