import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const work = read("src/renderer/mafw/components/ProjectWorkView.tsx")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")

test("MafwShell opens the Goal composer with the chat draft", () => {
  assert.match(shell, /goalComposerInitial/)
  assert.match(shell, /setGoalComposerInitial/)
  assert.match(shell, /openGoalComposerWithDraft/)
  assert.match(shell, /openGoalComposer\(\{/)
  assert.match(shell, /composerInitial=\{goalComposerInitial\(\)\}/)
})

test("ProjectWorkView passes the draft into PodGoalComposer", () => {
  assert.match(work, /composerInitial\?:/)
  assert.match(work, /initial=\{props\.composerInitial \?\? undefined\}/)
})

test("ChatPane delegates without sending", () => {
  assert.match(chat, /onDelegateDraft\?\.\(\{ text: input\(\) \}\)/)
  assert.match(chat, /clearDraft\(sidProp\(\)\)/)
  assert.match(chat, /modeSendsMessage/)
})
