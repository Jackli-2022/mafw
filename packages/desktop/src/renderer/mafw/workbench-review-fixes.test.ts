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

test("goal change sets use the Pod revision diff, not the session scope", () => {
  assert.match(shell, /GoalChangeSetStage/)
  assert.match(shell, /podIdForCurrentProject\(\)/)
  const stage = read("components/GoalChangeSetStage.tsx")
  assert.match(stage, /worktreeDiff\(podId, goalId, revision\)/)
  assert.match(stage, /ChangesDock/)
})
