import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const lens = read("src/renderer/mafw/components/LensBar.tsx")
const css = read("src/renderer/mafw/mafw.css")

test("LensBar renders only the provided lenses with pressed state", () => {
  assert.match(lens, /ButtonV2/)
  assert.match(lens, /TooltipV2/)
  assert.match(lens, /Icon/)
  assert.match(lens, /mafw-lens-bar/)
  assert.match(lens, /mafw-lens-btn/)
  assert.match(lens, /mafw-lens-count/)
  assert.match(lens, /For each=\{props\.lenses\}/)
  assert.match(lens, /aria-pressed=\{props\.active === lens\}/)
  assert.match(lens, /props\.onLens\(lens\)/)
  assert.doesNotMatch(lens, /WorkbenchContext/)
  assert.doesNotMatch(lens, /onContext/)
})

test("LensBar offers an optional split toggle", () => {
  assert.match(lens, /onToggleSplit/)
  assert.match(lens, /mafw-lens-split/)
  assert.match(lens, /aria-pressed=\{!!props\.splitOpen\}/)
  assert.match(lens, /分屏对照/)
  assert.match(lens, /关闭分屏/)
})

test("lens bar CSS uses tokens and pressed state", () => {
  const start = css.indexOf("/* ── lens bar")
  const end = css.indexOf("/* ── end lens bar")
  assert.ok(start >= 0 && end > start, "lens bar CSS block exists")
  const block = css.slice(start, end)
  assert.match(block, /\.mafw-lens-bar\s*\{/)
  assert.match(block, /\.mafw-lens-btn/)
  assert.match(block, /aria-pressed="true"/)
  assert.match(block, /var\(--/)
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}/)
})
