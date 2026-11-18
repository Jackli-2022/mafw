import { test } from "node:test"
import assert from "node:assert/strict"
import { buildSessionMenu, sessionMenuActionCount } from "./session-header-menu"

const base = {
  detailsMode: false,
  hasTurns: true,
  worktreeEnabled: true,
  isLead: false,
  topicsOpen: false,
  leadStatusOpen: false,
  showReturnLead: false,
  hasParent: false,
  canClosePane: false,
}

test("a plain session keeps only view + session groups", () => {
  const groups = buildSessionMenu(base)
  assert.deepEqual(groups.map((g) => g.id), ["view", "session"])
  const ids = groups.flatMap((g) => g.items.map((i) => i.id))
  assert.deepEqual(ids, ["details", "timeline", "mark-episode", "parallel"])
})

test("Lead sessions add topics and Goal status with their open state", () => {
  const groups = buildSessionMenu({
    ...base,
    isLead: true,
    topicsOpen: true,
    leadStatusOpen: false,
  })
  const lead = groups.find((g) => g.id === "lead")
  assert.ok(lead)
  assert.deepEqual(lead!.items.map((i) => [i.id, i.kind, i.checked]), [
    ["topics", "toggle", true],
    ["lead-status", "toggle", false],
  ])
})

test("marking an episode start is disabled until the session has turns", () => {
  const items = buildSessionMenu({ ...base, hasTurns: false }).flatMap((g) => g.items)
  const mark = items.find((i) => i.id === "mark-episode")
  assert.ok(mark)
  assert.equal(mark!.disabled, true)
})

test("the parallel action only exists when worktree isolation is available", () => {
  const without = buildSessionMenu({ ...base, worktreeEnabled: false }).flatMap((g) => g.items)
  assert.equal(without.some((i) => i.id === "parallel"), false)
  const withIt = buildSessionMenu(base).flatMap((g) => g.items)
  assert.equal(withIt.some((i) => i.id === "parallel"), true)
})

test("the navigation group carries only entries the session actually has", () => {
  assert.equal(buildSessionMenu(base).some((g) => g.id === "nav"), false)

  const groups = buildSessionMenu({ ...base, showReturnLead: true, hasParent: true, canClosePane: true })
  const nav = groups.find((g) => g.id === "nav")
  assert.ok(nav)
  assert.deepEqual(nav!.items.map((i) => i.id), ["return-lead", "back-parent", "close-pane"])
})

test("the details toggle reflects the stored preference and carries its shortcut", () => {
  const details = buildSessionMenu({ ...base, detailsMode: true })
    .flatMap((g) => g.items)
    .find((i) => i.id === "details")
  assert.ok(details)
  assert.equal(details!.kind, "toggle")
  assert.equal(details!.checked, true)
  assert.equal(details!.shortcut, "Ctrl+O")
})

test("action count ignores group headers so the menu stays scannable", () => {
  const groups = buildSessionMenu({
    ...base,
    isLead: true,
    showReturnLead: true,
    hasParent: true,
    canClosePane: true,
  })
  assert.equal(sessionMenuActionCount(groups), 9)
})
