import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const stage = read("src/renderer/mafw/components/FocusStage.tsx")
const css = read("src/renderer/mafw/focus-goal-stage.css")

test("Goal focus stage scrolls internally and keeps a visible back", () => {
  assert.match(stage, /mafw-focus-goal-stage/)
  assert.match(css, /\.mafw-focus-goal-stage/)
  assert.match(css, /overflow-y:\s*auto/)
  assert.match(css, /position:\s*sticky/)
  assert.match(css, /top:\s*0/)
  assert.match(css, /var\(--bg-base\)/)
})

test("Goal panel is not squeezed by the scroll wrapper", () => {
  assert.match(css, /\.mafw-focus-goal-stage\s*>\s*\.mafw-goal-inline/)
  assert.match(css, /flex:\s*none/)
})
