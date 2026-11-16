import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")
const picker = read("src/renderer/mafw/components/pickers/CommandPicker.tsx")
const css = read("src/renderer/mafw/mafw.css")

test("ChatPane gates runtime-dependent commands through Experience capabilities", () => {
  assert.match(chat, /commandDisabledReason/)
  assert.match(chat, /experienceStore\.supported\("session\.summarize"\)/)
  assert.match(chat, /experienceStore\.supported\("branch\.fork"\)/)
  assert.match(chat, /experienceStore\.supported\("branch\.diff"\)/)
  assert.match(chat, /experienceStore\.supported\("branch\.revert"\)/)
  assert.match(chat, /experienceStore\.supported\("checkpoint\.restore"\)/)
  assert.match(chat, /experienceStore\.supported\("branch\.unrevert"\)/)
  assert.match(chat, /experienceStore\.supported\("session\.rename"\)/)
  assert.match(chat, /experienceStore\.supported\("session\.discovery"\)/)
  assert.match(chat, /COMMAND_GATES/)
  assert.match(chat, /gateCommand\(item, gate, capabilities\)/)
  for (const id of ["compact", "fork", "diff", "undo", "redo", "rename", "plan", "build", "skills", "pause"]) {
    assert.match(chat, new RegExp(`${id}: "${id}"`))
  }
  assert.match(chat, /if \(item\.disabled\) return/)
  assert.match(chat, /experienceStore\.state\(\)\.status !== "ready"/)
  assert.match(chat, /pause: "pause"/)
  assert.match(chat, /experienceStore\.supported\("run\.control"\)/)
})

test("CommandPicker renders and blocks disabled command rows", () => {
  assert.match(picker, /disabled\?: boolean/)
  assert.match(picker, /disabledReason\?: string/)
  assert.match(picker, /if \(it && !it\.disabled\)/)
  assert.match(picker, /if \(!props\.it\.disabled\) props\.onClick\(\)/)
  assert.match(picker, /props\.it\.disabledReason/)
  assert.match(picker, /aria-disabled/)
  assert.match(picker, /disabled/)
  assert.match(css, /\.mafw-picker-row\.disabled/)
})
