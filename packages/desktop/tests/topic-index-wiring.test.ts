import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
const chat = read("../src/renderer/mafw/components/ChatPane.tsx")
const shell = read("../src/renderer/mafw/MafwShell.tsx")
const panel = read("../src/renderer/mafw/components/TopicIndexPanel.tsx")

test("topic index is Lead-only and resumes through the shell", () => {
  assert.match(chat, /isLead\(\)/)
  assert.match(chat, /TopicIndexPanel/)
  assert.match(chat, /onOpenTopics/)
  assert.match(shell, /lead\.topics\.resume|resumeTopic/)
  assert.match(shell, /showTopics/)
  assert.match(shell, /openPodSession\(result\.sessionID\)/)
  assert.doesNotMatch(panel, /ses_[a-zA-Z0-9]+/)
  assert.match(panel, /mafw-topic-index/)
  assert.match(panel, /还没有可恢复的话题/)
})
