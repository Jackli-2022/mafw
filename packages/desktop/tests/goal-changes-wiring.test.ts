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

test("goal diff root never falls back to the project directory", () => {
  const face = read("src/renderer/mafw/components/ChangesFace.tsx")
  assert.match(face, /root === props\.projectDir/)
  assert.match(face, /这一版没有可预览的分支/)
  assert.match(face, /reviewGoal\(\)/)
})

test("project index rows switch the changes mode", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /setChangesMode\("goal"\); openGoalFocus/)
  assert.match(shell, /setChangesMode\("session"\); openSessionTab/)
})
