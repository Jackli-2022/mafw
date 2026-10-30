import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("../src/renderer/mafw/components/PodDock.tsx", import.meta.url), "utf8")

test("pod dock composes the panel and reacts to project changes", () => {
  assert.match(src, /podStore\.open/)
  assert.match(src, /DockPanelHeader/)
  assert.match(src, /DockEmpty/)
  assert.match(src, /PodTaskBoard/)
  assert.match(src, /PodGoalQueue/)
  assert.match(src, /PodInbox/)
  assert.match(src, /PodMemoryPanel/)
  assert.match(src, /PodTranscriptOverlay/)
  assert.match(src, /memberOpenTarget/)
  assert.match(src, /shouldCloseTranscript/)
  assert.match(src, /props\.active/)
  assert.match(src, /onOpenSession\(target\.sessionId,/)
  assert.doesNotMatch(src, /setInterval/)
  assert.doesNotMatch(src, /<button[\s>]/)
  assert.doesNotMatch(src, / title="/)
})
