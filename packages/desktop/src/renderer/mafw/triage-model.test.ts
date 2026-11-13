import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { TriageItem } from "@mafw/sdk"
import { triageCardModel } from "./triage-model"

// Wire shape (E10b-2): the gateway serves the on-disk triage record verbatim.
// `summary` is a free-form draft bag; no writer ever produced goalId/reason/severity/createdAt.
function item(input: Partial<TriageItem> = {}): TriageItem {
  return {
    id: "triage_1",
    automationId: "automation_1",
    discoveredAt: "2026-11-13T08:30:00.000Z",
    source: "skill-scan",
    summary: {},
    state: "PENDING_CONFIRMATION",
    userAction: null,
    deadline: "2026-11-14T08:30:00.000Z",
    ...input,
  }
}

test("title prefers proposedGoal, then summary draft names, then id", () => {
  assert.equal(
    triageCardModel(item({
      proposedGoal: { title: "把 nightly 扫描改成可验收 Goal", boundaries: [], estimatedLoops: 2 },
      summary: { title: "draft title" },
    })).title,
    "把 nightly 扫描改成可验收 Goal",
  )

  assert.equal(triageCardModel(item({ summary: { title: "draft title" } })).title, "draft title")

  assert.equal(
    triageCardModel(item({ summary: { skillDraft: { name: "release-notes" } } })).title,
    "release-notes",
  )

  assert.equal(
    triageCardModel(item({ summary: { axiomDraft: { name: "axiom-no-hex-colors" } } })).title,
    "axiom-no-hex-colors",
  )

  assert.equal(triageCardModel(item({ summary: { note: "no usable title" } })).title, "triage_1")
})

test("meta is source plus localized discoveredAt, deadline only when valid", () => {
  const full = triageCardModel(item()).meta.split(" · ")
  assert.equal(full[0], "skill-scan")
  assert.equal(full.length, 3, "source, discoveredAt, deadline")
  assert.ok(!full.join(" ").includes("Invalid Date"))

  const noDiscovered = triageCardModel(item({ discoveredAt: "not-a-date" })).meta
  assert.ok(!noDiscovered.includes("Invalid Date"), "invalid discoveredAt is omitted, not printed")
  assert.equal(noDiscovered.split(" · ")[0], "skill-scan")
  assert.ok(noDiscovered.split(" · ").length === 2, "only the valid deadline remains")

  const noDeadline = triageCardModel(item({ deadline: "" })).meta
  assert.equal(noDeadline.split(" · ").length, 2, "invalid deadline is not appended")

  const badDeadline = triageCardModel(item({ deadline: "deadline-tbd" })).meta
  assert.equal(badDeadline.split(" · ").length, 2)
})

test("badge follows real state with neutral/warn/danger tones", () => {
  assert.deepEqual(triageCardModel(item({ state: "PENDING_CONFIRMATION" })).badge, {
    label: "待确认",
    tone: "warn",
  })
  assert.deepEqual(triageCardModel(item({ state: "CONFIRMED" })).badge, {
    label: "已确认",
    tone: "neutral",
  })
  assert.deepEqual(triageCardModel(item({ state: "REJECTED" })).badge, {
    label: "已拒绝",
    tone: "danger",
  })
})

test("badge appends only the highest-priority llm suggestion", () => {
  const badge = triageCardModel(item({
    llmSuggestions: [
      { action: "reject", reason: "low confidence", priority: "low", timestamp: "2026-11-13T09:00:00.000Z" },
      { action: "confirm", reason: "matches last week", priority: "high", timestamp: "2026-11-13T09:01:00.000Z" },
      { action: "reject", reason: "duplicate", priority: "medium", timestamp: "2026-11-13T09:02:00.000Z" },
    ],
  })).badge

  assert.equal(badge.tone, "warn", "suggestions never invent a severity tone")
  assert.ok(badge.label.startsWith("待确认"))
  assert.ok(badge.label.includes("建议确认"), "highest priority action is rendered")
  assert.ok(badge.label.includes("high"), "highest priority level is rendered")
  assert.ok(!badge.label.includes("medium") && !badge.label.includes("low"))

  assert.deepEqual(triageCardModel(item({ llmSuggestions: [] })).badge, {
    label: "待确认",
    tone: "warn",
  })
})

test("TriagePage renders the model and no retired wire fields", () => {
  const page = readFileSync(join(import.meta.dirname, "pages/TriagePage.tsx"), "utf8")
  assert.ok(page.includes("triageCardModel(t)"), "page renders the shared model")
  assert.ok(page.includes("card.badge"), "page renders the state badge")
  for (const ghost of ["t.reason", "t.goalId", "t.severity", "t.createdAt", "as any[]"]) {
    assert.ok(!page.includes(ghost), `page must not read retired wire field: ${ghost}`)
  }
})
