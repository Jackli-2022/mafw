import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")
const shell = read("MafwShell.tsx")
const chat = read("components/ChatPane.tsx")

test("picker and Chat file opens share the focus-aware file route", () => {
  assert.match(shell, /const openFileInScope =/)
  assert.match(shell, /fileOpenPlan\(rel\)/)
  assert.match(shell, /kind: "web", url/)
  assert.match(shell, /kind: "file", root, rel/)
  assert.match(shell, /openFileInScope\(\s*item\.subject\.rel,/)
  assert.match(shell, /onOpenFile=\{\(root, rel\) => openFileInScope\(/)
  assert.doesNotMatch(chat, /requestOpenEditor/)
  assert.match(chat, /props\.onOpenFile\?\.\(root, rel\)/)
})

test("the dead editor-open signal channel is gone", () => {
  const editor = read("components/EditorDock.tsx")
  assert.doesNotMatch(shell, /editor-open|requestOpenEditor/)
  assert.doesNotMatch(editor, /editor-open|pendingEditorOpen|consumeEditorOpen/)
  assert.match(editor, /props\.openRequest/)
})

test("episode grouping never calls the later-declared allTurns accessor", () => {
  const chat = read("components/ChatPane.tsx")
  const block = chat.slice(
    chat.indexOf("const episodeGroups ="),
    chat.indexOf("const episodeForMessage ="),
  )
  assert.match(block, /userMessages\(\)/)
  assert.doesNotMatch(block, /allTurns\(\)/)
})

test("goal diffs use the Pod revision diff, not the session scope", () => {
  const face = read("components/ChangesFace.tsx")
  assert.match(face, /worktreeDiff\(goal\.podId, goal\.goalId, goal\.revision\)/)
  const goalChanges = read("changes/goal-changes.ts")
  assert.match(goalChanges, /PodWorktreeDiffFile/)
})
