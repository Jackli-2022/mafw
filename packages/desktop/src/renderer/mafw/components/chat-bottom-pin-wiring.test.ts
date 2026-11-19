import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")

test("ChatPane re-pins the viewport after async layout growth", () => {
  const pane = read("ChatPane.tsx")
  // Stored text changes are not the only source of height: markdown, images,
  // tool cards and the Lead inbox finish laying out later. While pinned, any
  // mutation/resize re-anchors to the very bottom.
  assert.match(pane, /const schedulePin = \(\) =>/)
  assert.match(pane, /new MutationObserver\(schedulePin\)/)
  assert.match(pane, /new ResizeObserver\(schedulePin\)/)
  assert.match(pane, /mo\.observe\(el, \{ childList: true, subtree: true, characterData: true \}\)/)
  assert.match(pane, /ro\.observe\(el\)/)
  assert.match(pane, /if \(!el \|\| !pinned\(\)\) return/)
})

test("switching sessions anchors the pane to the latest message", () => {
  const pane = read("ChatPane.tsx")
  assert.match(pane, /\(\) => \[props\.focused, sidProp\(\)\] as const/)
})
