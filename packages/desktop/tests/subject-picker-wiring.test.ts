import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const picker = read("src/renderer/mafw/components/SubjectPicker.tsx")
const css = read("src/renderer/mafw/mafw.css")

test("SubjectPicker is a modal v2 picker", () => {
  assert.match(picker, /TextInputV2/)
  assert.match(picker, /ButtonV2/)
  assert.match(picker, /Icon/)
  assert.match(picker, /role="dialog"/)
  assert.match(picker, /aria-modal="true"/)
  assert.match(picker, /mafw-subject-picker/)
  assert.match(picker, /onPick/)
  assert.match(picker, /onClose/)
  assert.doesNotMatch(picker, /<input/)
  assert.doesNotMatch(picker, /<button/)
})

test("SubjectPicker handles keyboard navigation", () => {
  assert.match(picker, /Escape/)
  assert.match(picker, /ArrowDown/)
  assert.match(picker, /ArrowUp/)
  assert.match(picker, /Enter/)
  assert.match(picker, /filterPickerItems/)
  assert.match(picker, /autofocus/)
})

test("picker CSS uses tokens and selected state", () => {
  const start = css.indexOf("/* ── subject picker")
  const end = css.indexOf("/* ── end subject picker")
  assert.ok(start >= 0 && end > start, "subject picker CSS block exists")
  const block = css.slice(start, end)
  assert.match(block, /\.mafw-subject-picker\s*\{/)
  assert.match(block, /aria-selected="true"/)
  assert.match(block, /var\(--/)
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}/)
})
