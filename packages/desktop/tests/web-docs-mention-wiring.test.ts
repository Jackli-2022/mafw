import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")
const picker = read("src/renderer/mafw/components/pickers/FilePicker.tsx")
const webDialog = read("src/renderer/mafw/components/WebUrlDialog.tsx")
const send = read("src/renderer/mafw/chat/use-send-message.ts")

test("composer mentions offer docs and web sources", () => {
  assert.match(chat, /isDocsPath/)
  assert.match(chat, /kind: "web" as const/)
  assert.match(chat, /kind: isDocsPath\(f\) \? "doc" as const : "file" as const/)
  assert.match(chat, /openWebDialog/)
  assert.match(chat, /setWebLinks/)
  assert.match(chat, /<WebUrlDialog/)
  assert.match(picker, /"agent" \| "file" \| "doc" \| "web"/)
  assert.match(picker, /Web 页面/)
  assert.match(picker, /Docs ·/)
})

test("web URL dialog is v2-only and validates http(s) URLs", () => {
  assert.match(webDialog, /TextInputV2/)
  assert.match(webDialog, /ButtonV2/)
  assert.match(webDialog, /normalizeWebUrl/)
  assert.doesNotMatch(webDialog, /<button/)
  assert.doesNotMatch(webDialog, /<input/)
})

test("web context is appended to immediate, queued, and enriched sends", () => {
  assert.match(send, /formatWebContext/)
  assert.match(send, /\[webBlock, text\.trim\(\)/)
  assert.match(send, /\[webBlock, filePrefix, text\.trim\(\)/)
  assert.match(send, /deps\.setWebLinks\?\.\(\[\]\)/)
})
