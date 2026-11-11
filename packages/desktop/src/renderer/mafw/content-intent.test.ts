import { test } from "node:test"
import assert from "node:assert/strict"
import {
  CONTENT_INTENTS,
  contentIntentLabel,
  normalizeContentIntent,
} from "./content-intent"

test("content intent only exposes reading and editing", () => {
  assert.deepEqual(CONTENT_INTENTS.map((item) => item.id), ["reading", "editing"])
  assert.deepEqual(CONTENT_INTENTS.map((item) => item.label), ["阅读", "修改"])
})

test("unknown or empty intent falls back to reading", () => {
  assert.equal(normalizeContentIntent("editing"), "editing")
  assert.equal(normalizeContentIntent("reading"), "reading")
  assert.equal(normalizeContentIntent("review"), "reading")
  assert.equal(normalizeContentIntent(null), "reading")
  assert.equal(contentIntentLabel("editing"), "修改")
  assert.equal(contentIntentLabel("nope"), "阅读")
})
