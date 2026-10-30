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
  assert.doesNotMatch(src, /<button[\s>]/)
  assert.doesNotMatch(src, /title=/)
})
