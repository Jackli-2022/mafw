import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("../src/renderer/mafw/components/PodTranscriptOverlay.tsx", import.meta.url), "utf8")

test("transcript overlay fetches a snapshot and closes on Escape/backdrop", () => {
  assert.match(src, /pod\.transcript/)
  assert.match(src, /transcriptTurns/)
  assert.match(src, /LoaderV2/)
  assert.match(src, /mafw-pod-transcript/)
  assert.match(src, /Escape/)
  assert.match(src, /onClose/)
  assert.match(src, /stopImmediatePropagation/)
  assert.doesNotMatch(src, /<button[\s>]/)
  assert.doesNotMatch(src, /title=/)
})
