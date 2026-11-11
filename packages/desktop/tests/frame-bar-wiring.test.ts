import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const bar = read("src/renderer/mafw/components/FrameBar.tsx")
const css = read("src/renderer/mafw/mafw.css")

test("FrameBar uses the v2 primitives and one-row structure", () => {
  assert.match(bar, /ButtonV2/)
  assert.match(bar, /TooltipV2/)
  assert.match(bar, /Icon/)
  assert.match(bar, /mafw-frame-bar/)
  assert.match(bar, /mafw-frame-crumbs/)
  assert.match(bar, /mafw-frame-badges/)
  assert.match(bar, /mafw-frame-badge/)
  assert.match(bar, /aria-label="返回"/)
  assert.match(bar, /⌘P/)
  assert.doesNotMatch(bar, /<button/)
  assert.doesNotMatch(bar, /<input/)
})

test("FrameBar only navigates crumbs with a stack index", () => {
  assert.match(bar, /crumb\.stackIndex !== undefined/)
  assert.match(bar, /props\.onCrumb\(crumb\.stackIndex\)/)
  assert.match(bar, /aria-current=/)
})

test("frame bar CSS is a normal flex child and uses theme tokens", () => {
  const start = css.indexOf("/* ── frame bar")
  const end = css.indexOf("/* ── end frame bar")
  assert.ok(start >= 0 && end > start, "frame bar CSS block exists")
  const block = css.slice(start, end)
  assert.match(block, /\.mafw-frame-bar\s*\{/)
  assert.doesNotMatch(block, /position:\s*(absolute|fixed)/)
  assert.match(block, /var\(--/)
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}/)
})
