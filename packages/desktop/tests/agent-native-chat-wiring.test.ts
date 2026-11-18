import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const send = read("src/renderer/mafw/chat/use-send-message.ts")
const queue = read("src/renderer/mafw/components/turn-queue.ts")
const episodeCss = read("src/renderer/mafw/chat-episodes.css")
const sessionMenu = read("src/renderer/mafw/components/session-header-menu.ts")

test("composer no longer owns a transient mode", () => {
  assert.doesNotMatch(chat, /ChatModeBar|composerMode|modeActionLabel|modeSendsMessage/)
  assert.doesNotMatch(send, /chatMode|modeDirective|modeSendsMessage/)
  assert.doesNotMatch(queue, /chatMode/)
})

test("shell no longer passes mode-only actions to chat", () => {
  assert.doesNotMatch(shell, /canDelegate=|canResolve=|onDelegateDraft=|onResolveRequest=/)
  assert.doesNotMatch(shell, /openGoalComposerWithDraft|openReviewFromChat/)
})

test("episode marking lives in the session header menu, not a mode row", () => {
  // 2026-11-18：回合级「标记段落」从标题栏按钮收进 ⋯ 菜单（菜单仍在 transcript header 内）。
  assert.match(chat, /runSessionMenuAction/)
  assert.match(chat, /startEpisode/)
  assert.match(sessionMenu, /mark-episode/)
  assert.match(sessionMenu, /从这里开始新段落/)
  assert.doesNotMatch(chat, /mafw-chat-mode-row/)
  assert.doesNotMatch(episodeCss, /\.mafw-chat-mode-row/)
})
