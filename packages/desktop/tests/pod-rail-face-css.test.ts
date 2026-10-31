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
})

test("recent message rows stay single-line and truncate", () => {
  const preview = css.slice(css.indexOf(".mafw-pod-rail-message-preview {"), css.indexOf(".mafw-pod-rail-message-preview {") + 300)
  assert.match(preview, /text-overflow:\s*ellipsis/)
  assert.match(preview, /white-space:\s*nowrap/)
  const unread = css.slice(css.indexOf(".mafw-pod-rail-message.unread {"), css.indexOf(".mafw-pod-rail-message.unread {") + 200)
  assert.match(unread, /inset 2px 0 0 var\(--accent\)/)
})

test("the rail no longer carries a composer", () => {
  assert.doesNotMatch(css, /\.mafw-pod-rail-compose/)
  assert.doesNotMatch(css, /\.mafw-pod-rail-input/)
})

test("unread mailbox rows are visible and interactive", () => {
  const rowBlock = css.slice(css.indexOf(".mafw-pod-message-row {"), css.indexOf(".mafw-pod-message-row {") + 400)
  assert.match(rowBlock, /cursor:\s*pointer/)
  const unreadBlock = css.slice(css.indexOf(".mafw-pod-message-row.unread {"), css.indexOf(".mafw-pod-message-row.unread {") + 300)
  assert.match(unreadBlock, /border-left/)
})
