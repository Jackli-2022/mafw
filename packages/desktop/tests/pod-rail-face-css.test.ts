import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const css = readFileSync(new URL("../src/renderer/mafw/mafw.css", import.meta.url), "utf8")

test("pod rail face styles survive a 240px dock", () => {
  const start = css.indexOf(".mafw-pod-rail-face {")
  assert.ok(start >= 0, "missing .mafw-pod-rail-face rule")
  const block = css.slice(start, start + 400)
  assert.match(block, /min-width:\s*0/)
  assert.match(block, /flex-direction:\s*column/)

  const memberBlock = css.slice(css.indexOf(".mafw-pod-rail-member {"), css.indexOf(".mafw-pod-rail-member {") + 300)
  assert.match(memberBlock, /min-width:\s*0/)

  const inputBlock = css.slice(css.indexOf(".mafw-pod-rail-input {"), css.indexOf(".mafw-pod-rail-input {") + 400)
  assert.match(inputBlock, /width:\s*100%/)
})
