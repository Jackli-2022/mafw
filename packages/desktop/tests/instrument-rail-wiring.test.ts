import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const rail = read("src/renderer/mafw/components/InstrumentRail.tsx")
const shell = read("src/renderer/mafw/components/WorkbenchShell.tsx")
const css = read("src/renderer/mafw/mafw.css")

test("InstrumentRail renders sections with v2 controls", () => {
  assert.match(rail, /mafw-instrument-rail/)
  assert.match(rail, /aria-label/)
  assert.match(rail, /props\.sections/)
  assert.match(rail, /ButtonV2/)
  assert.match(rail, /TooltipV2/)
  assert.doesNotMatch(rail, /<button/)
})

test("WorkbenchShell places the rail beside the focus stage", () => {
  assert.match(shell, /InstrumentRail|instrumentRail/)
  assert.match(shell, /mafw-focus-body/)
  assert.match(shell, /focusView/)
  assert.match(shell, /mafw-focus-rail-slot/)
})

test("instrument rail CSS uses tokens and never covers the frame", () => {
  const start = css.indexOf("/* ── instrument rail")
  const end = css.indexOf("/* ── end instrument rail")
  assert.ok(start >= 0 && end > start, "instrument rail CSS block exists")
  const block = css.slice(start, end)
  assert.match(block, /\.mafw-instrument-rail/)
  assert.match(block, /var\(--/)
  assert.doesNotMatch(block, /position:\s*absolute/)
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}/)
})
