import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const stage = read("src/renderer/mafw/components/FocusStage.tsx")
const css = read("src/renderer/mafw/mafw.css")

test("FocusStage delegates document surfaces through DocumentStage", () => {
  assert.match(stage, /DocumentStage/)
  assert.match(stage, /TerminalSurface/)
  assert.match(stage, /stageKindFor/)
  assert.match(stage, /mafw-focus-stage/)
  assert.match(stage, /renderPluginSurface/)
  assert.match(stage, /plugin:\$\{subject\.package\}:\$\{subject\.panel\}/)
  assert.doesNotMatch(stage, /FilesDock/)
  assert.doesNotMatch(stage, /ContentScopeHeader/)
  assert.doesNotMatch(stage, /onOpenFile/)
})

test("FocusStage uses DockEmpty fallbacks and no raw controls", () => {
  assert.match(stage, /DockEmpty/)
  assert.match(stage, /ChangeSetStage/)
  assert.match(stage, /Goal 总览待接入/)
  assert.match(stage, /世界总览待接入/)
  assert.doesNotMatch(stage, /<button/)
  assert.doesNotMatch(stage, /<input/)
})

test("focus stage CSS is a flex child with tokens", () => {
  const start = css.indexOf("/* ── focus stage")
  const end = css.indexOf("/* ── end focus stage")
  assert.ok(start >= 0 && end > start, "focus stage CSS block exists")
  const block = css.slice(start, end)
  assert.match(block, /\.mafw-focus-stage\s*\{/)
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}/)
})
