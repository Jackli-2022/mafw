// T2-2 run store / banner pure logic.
import { test } from "node:test"
import assert from "node:assert/strict"
import { applyRunSnapshot, runForSession, setRun, clearRun } from "./run-store"
import { runBanner } from "./run-banner"

const base = {
  id: "run_1",
  sessionID: "s1",
  projectDir: "/p",
  brief: { lastUserText: "refactor the parser and run the tests", lastAssistantTail: "", anchorMessageID: "u1", queuedCount: 0 },
  createdAt: "2026-10-26T00:00:00Z",
  suspendedAt: "2026-10-26T00:00:00Z",
}

test("applyRunSnapshot keeps suspended/resumed and clears terminal runs", () => {
  const suspended = applyRunSnapshot({}, { ...base, status: "suspended" })
  assert.equal(suspended.s1.status, "suspended")
  const resumed = applyRunSnapshot(suspended, { ...base, status: "resumed" })
  assert.equal(resumed.s1.status, "resumed")
  const done = applyRunSnapshot(resumed, { ...base, status: "completed" })
  assert.equal(done.s1, null)
})

test("setRun / runForSession / clearRun", () => {
  setRun({ ...base, status: "suspended" })
  assert.equal(runForSession("s1")?.id, "run_1")
  clearRun("s1")
  assert.equal(runForSession("s1"), null)
})

test("runBanner shows a snippet and gates actions by busy", () => {
  const suspended = { ...base, status: "suspended" as const }
  const idle = runBanner(suspended, false)!
  assert.match(idle.text, /^已暂停 · refactor the parser/)
  assert.equal(idle.canResume, true)
  assert.equal(idle.canDiscard, true)

  const busy = runBanner(suspended, true)!
  assert.equal(busy.canResume, false)
  assert.equal(busy.canDiscard, true)

  const resumedBusy = runBanner({ ...base, status: "resumed" }, true)!
  assert.match(resumedBusy.text, /^恢复中/)
  assert.equal(resumedBusy.canResume, false)
  assert.equal(resumedBusy.canDiscard, false)
})

test("runBanner returns null for missing or terminal runs", () => {
  assert.equal(runBanner(null, false), null)
  assert.equal(runBanner({ ...base, status: "completed" }, false), null)
})

test("snippet truncates long prompts", () => {
  const view = runBanner({ ...base, status: "suspended", brief: { ...base.brief, lastUserText: "x".repeat(120) } }, false)!
  assert.ok(view.text.length <= "已暂停 · ".length + 60)
})
