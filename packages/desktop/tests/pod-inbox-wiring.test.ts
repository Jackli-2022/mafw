import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("../src/renderer/mafw/components/PodInbox.tsx", import.meta.url), "utf8")

test("inbox composes with V2 selects and sends as Lead", () => {
  assert.match(src, /SelectV2/)
  assert.match(src, /podMemberName/)
  assert.match(src, /onSend/)
  assert.match(src, /广播/)
  assert.match(src, /mafw-pod-inbox-input/)
  assert.match(src, /role="lead"|lead/)
  assert.match(src, /onRead/)
  assert.match(src, /mafw-pod-message-row/)
  assert.doesNotMatch(src, /<button[\s>]/)
  assert.doesNotMatch(src, /title=/)
})

test("inbox owns the 立即提醒 toggle that used to live in the rail", () => {
  assert.match(src, /SwitchV2/)
  assert.match(src, /立即提醒/)
  assert.match(src, /canNotify/)
  assert.match(src, /notify: notify\(\) && notifyEnabled\(\)/)
})
