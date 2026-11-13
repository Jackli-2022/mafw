import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")

test("MafwShell routes resolve mode to the left changes face", () => {
  assert.match(shell, /openReviewFromChat/)
  assert.match(shell, /openChangesFace\(\{[\s\S]{0,200}section: "review"/)
  assert.match(shell, /onResolveRequest=\{openReviewFromChat\}/)
})

test("ChatPane resolve mode does not send or resolve", () => {
  assert.match(chat, /chatMode === "resolve"/)
  assert.match(chat, /onResolveRequest\?\.\(\)/)
  assert.doesNotMatch(chat, /resolveReviewItem/)
})
