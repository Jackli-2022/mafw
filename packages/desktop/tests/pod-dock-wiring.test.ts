import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("../src/renderer/mafw/components/PodDock.tsx", import.meta.url), "utf8")

test("pod dock composes the panel and reacts to project changes", () => {
  assert.match(src, /podStore\.open/)
  assert.match(src, /DockPanelHeader/)
  assert.match(src, /DockEmpty/)
  assert.match(src, /PodInbox/)
  assert.match(src, /PodMemoryPanel/)
  assert.match(src, /PodTranscriptOverlay/)
  assert.match(src, /memberFocus\(/)
  assert.match(src, /shouldCloseTranscript/)
  assert.match(src, /props\.active/)
  assert.match(src, /onOpenSession\(target\.sessionId\)/)
  assert.doesNotMatch(src, /PodTaskBoard/)
  assert.doesNotMatch(src, /PodGoalQueue/)
  assert.doesNotMatch(src, /PodGoalComposer/)
  assert.doesNotMatch(src, /setInterval/)
  assert.doesNotMatch(src, /<button[\s>]/)
  assert.doesNotMatch(src, / title="/)
})

// 2026-11-04（spec techlead-goal-entry §3.3）：团队行 = 目录 + 当前焦点；
// Tech Lead 行走 Goal 入口（requestPodTechLeadOpen → openTechLead ensure 讨论会话），
// 不再点开「最新会话」抽奖。
test("team rows show the current focus and route techlead rows through the goal entry", () => {
  assert.match(src, /memberFocus\(/)
  assert.match(src, /focus\(\)\.focusText/)
  assert.match(src, /待命/)
  assert.match(src, /requestPodTechLeadOpen\(/)
})
