import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const editor = read("src/renderer/mafw/components/EditorDock.tsx")
const sheet = read("src/renderer/mafw/components/InlineEditSheet.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")

test("editor selection toolbar exposes AI edit for source selections", () => {
  assert.match(editor, /AI 编辑/)
  assert.match(editor, /openInlineEditFromBar/)
  assert.match(editor, /InlineEditSheet/)
  assert.match(editor, /onInlineEdit\?\.\(/)
  assert.match(editor, /selectionBar\(\)!\.kind === "source"/)
  assert.match(editor, /e\.key\.toLowerCase\(\) === "k"/)
})

test("inline edit sheet is v2-only and submits an instruction", () => {
  assert.match(sheet, /TextareaV2/)
  assert.match(sheet, /ButtonV2/)
  assert.match(sheet, /QUICK_INSTRUCTIONS/)
  assert.match(sheet, /发送给 Agent/)
  assert.doesNotMatch(sheet, /<button/)
  assert.doesNotMatch(sheet, /<input/)
})

test("MafwShell forwards inline edits through the normal prompt channel", () => {
  assert.match(shell, /buildInlineEditPrompt/)
  assert.match(shell, /onInlineEdit=\{/)
  assert.match(shell, /sessions\.promptAsync/)
  assert.match(shell, /已发送 AI 编辑请求/)
})
