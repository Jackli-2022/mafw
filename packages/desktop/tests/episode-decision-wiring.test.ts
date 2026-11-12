import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")
const header = read("src/renderer/mafw/components/EpisodeHeader.tsx")

test("MafwShell drafts a user-sourced decision when an episode closes", () => {
  assert.match(shell, /closeEpisodeToDecision/)
  assert.match(shell, /decisions\.draft/)
  assert.match(shell, /source: "user"/)
  assert.match(shell, /goalId: goal\?\.goalId \?\? null/)
  assert.match(shell, /evidence: \[\{/)
  assert.match(shell, /onCloseEpisode=\{closeEpisodeToDecision\}/)
})

test("ChatPane keeps the draft record id on the episode and expands the board", () => {
  assert.match(chat, /onCloseEpisode\?:/)
  assert.match(chat, /closeEpisodeWithRecord/)
  assert.match(chat, /decisionRecordId/)
  assert.match(chat, /openDecisionRecord/)
  assert.match(chat, /focusRecord=\{decisionRecordFocus\(\)\}/)
})

test("EpisodeHeader offers close-only and close-with-record", () => {
  assert.match(header, /仅关闭/)
  assert.match(header, /关闭并记录决定/)
  assert.match(header, /onCloseWithRecord/)
  assert.match(header, /TextareaV2/)
  assert.match(header, /TextInputV2/)
  assert.doesNotMatch(header, /<button/)
})
