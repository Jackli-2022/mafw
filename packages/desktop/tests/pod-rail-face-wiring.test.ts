import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("../src/renderer/mafw/components/PodRailFace.tsx", import.meta.url), "utf8")
const dock = readFileSync(new URL("../src/renderer/mafw/components/LeftDock.tsx", import.meta.url), "utf8")

test("pod rail face composes V2 controls and guards narrow width", () => {
  assert.match(src, /SelectV2/)
  assert.match(src, /SwitchV2/)
  assert.match(src, /applyReadlineKey/)
  assert.match(src, /立即提醒/)
  assert.match(src, /mafw-pod-rail-face/)
  assert.match(src, /deliveryToast|onSend/)
  assert.doesNotMatch(src, /<button[\s>]/)
  assert.doesNotMatch(src, /\btitle=/)
})

test("left dock renders the pod face and stays out of the session list path", () => {
  assert.match(dock, /PodRailFace/)
  assert.match(dock, /face === "pod"/)
  assert.match(dock, /props\.face !== "notes" && props\.face !== "pod"/)
  assert.match(dock, /podDetail\?: PodDetail \| null/)
  assert.doesNotMatch(dock, /podDetail\?: any/)
})

test("pod face has a header, loading and error states", () => {
  assert.match(src, /mafw-pod-rail-head/)
  assert.match(src, /onRefresh/)
  assert.match(src, /加载中/)
  assert.match(src, /props\.error/)
  assert.match(src, /statusLabel|podStatusLabel/)
})
