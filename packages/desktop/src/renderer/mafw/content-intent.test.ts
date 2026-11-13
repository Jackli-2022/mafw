import { test } from "node:test"
import assert from "node:assert/strict"
import { contentDocumentLabel, openModeForTab } from "./content-intent"

test("content surface label shows the open document name", () => {
  assert.equal(contentDocumentLabel("docs/architecture/desktop.md"), "desktop.md")
  assert.equal(contentDocumentLabel("AGENTS.md"), "AGENTS.md")
  assert.equal(contentDocumentLabel("C:\\work\\a\\b.ts"), "b.ts")
  assert.equal(contentDocumentLabel(null), "文件")
  assert.equal(contentDocumentLabel(""), "文件")
})

test("plain opens preview; explicit persistent opens keep a tab", () => {
  assert.equal(openModeForTab({}), "preview")
  assert.equal(openModeForTab({ persist: true }), "persistent")
})
