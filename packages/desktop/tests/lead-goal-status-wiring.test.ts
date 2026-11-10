import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
const chat = read("../src/renderer/mafw/components/ChatPane.tsx")
const card = read("../src/renderer/mafw/components/LeadGoalStatusCard.tsx")

test("Lead status card is on-demand and above the composer", () => {
  assert.match(chat, /LeadGoalStatusCard/)
  const cardAt = chat.indexOf("LeadGoalStatusCard")
  const composerAt = chat.indexOf('class="mafw-composer"')
  assert.ok(cardAt > 0, "ChatPane must render LeadGoalStatusCard")
  assert.ok(composerAt > 0, "ChatPane must have a composer")
  assert.ok(cardAt < composerAt, "status card must be above the composer")
  assert.match(chat, /showLeadStatus/)
  assert.match(chat, /isLead\(\)/)
  assert.doesNotMatch(chat, /ses_[a-zA-Z0-9]+/)
  assert.match(card, /mafw-queue-bar/)
  assert.doesNotMatch(card, /<button/)
  assert.doesNotMatch(card, /ses_[a-zA-Z0-9]+/)
})
