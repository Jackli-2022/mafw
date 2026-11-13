import { test } from "node:test"
import assert from "node:assert/strict"
import {
  CONTENT_INTENTS,
  contentDocumentLabel,
  contentIntentLabel,
  normalizeContentIntent,
  openModeForTab,
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

test("content surface label shows the open document name", () => {
  assert.equal(contentDocumentLabel("docs/architecture/desktop.md"), "desktop.md")
  assert.equal(contentDocumentLabel("AGENTS.md"), "AGENTS.md")
  assert.equal(contentDocumentLabel("C:\\work\\a\\b.ts"), "b.ts")
  assert.equal(contentDocumentLabel(null), "文件")
  assert.equal(contentDocumentLabel(""), "文件")
})

test("explicit persistent opens keep a tab even in reading intent", () => {
  assert.equal(openModeForTab({ intent: "reading" }), "preview")
  assert.equal(openModeForTab({ intent: "reading", persist: true }), "persistent")
  assert.equal(openModeForTab({ intent: "editing" }), "persistent")
  assert.equal(openModeForTab({ intent: "editing", persist: true }), "persistent")
})
