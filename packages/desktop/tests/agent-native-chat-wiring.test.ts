import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const send = read("src/renderer/mafw/chat/use-send-message.ts")
const queue = read("src/renderer/mafw/components/turn-queue.ts")
const episodeCss = read("src/renderer/mafw/chat-episodes.css")

test("composer no longer owns a transient mode", () => {
  assert.doesNotMatch(chat, /ChatModeBar|composerMode|modeActionLabel|modeSendsMessage/)
  assert.doesNotMatch(send, /chatMode|modeDirective|modeSendsMessage/)
  assert.doesNotMatch(queue, /chatMode/)
})

test("shell no longer passes mode-only actions to chat", () => {
  assert.doesNotMatch(shell, /canDelegate=|canResolve=|onDelegateDraft=|onResolveRequest=/)
  assert.doesNotMatch(shell, /openGoalComposerWithDraft|openReviewFromChat/)
})

test("episode marking lives in the transcript header, not a mode row", () => {
  const headerStart = chat.indexOf('<div class="mafw-session-titlebar">')
  const composerStart = chat.indexOf('class="mafw-composer"', headerStart)
  assert.ok(headerStart >= 0, "missing session titlebar")
  assert.ok(composerStart > headerStart, "missing composer after titlebar")
  assert.match(chat.slice(headerStart, composerStart), /mafw-episode-mark/)
  assert.match(chat, /startEpisode/)
  assert.doesNotMatch(chat, /mafw-chat-mode-row/)
  assert.doesNotMatch(episodeCss, /\.mafw-chat-mode-row/)
})
