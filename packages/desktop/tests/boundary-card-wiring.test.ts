import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")
const card = read("src/renderer/mafw/components/BoundaryCard.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")

test("Lead chat renders proposed topic boundaries inline", () => {
  assert.match(chat, /BoundaryCard/)
  assert.match(chat, /visibleBoundaryProposals/)
  assert.match(chat, /residentTopicId/)
  assert.match(chat, /item\.state === "resident"/)
  assert.match(chat, /isLead\(\) && proposedBoundaryCards\(\)\.length > 0/)
  assert.match(card, /分开/)
  assert.match(card, /合并/)
  assert.match(card, /忽略/)
  assert.match(card, /ButtonV2/)
  assert.doesNotMatch(card, /<button/)
})

test("shell refreshes boundaries on Lead entry and after sending", () => {
  assert.match(shell, /refreshTopicsThrottled/)
  assert.match(shell, /onMessageSent=/)
  assert.match(shell, /lastTopicsRefreshAt/)
  assert.match(shell, /topicBusy=\{topicBusy\(\)\}/)
})
