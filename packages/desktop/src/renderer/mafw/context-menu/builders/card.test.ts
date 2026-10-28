import { describe, expect, test } from "bun:test"
import {
  buildApprovalPermissionMenu,
  buildApprovalQuestionMenu,
  buildAutomationCardMenu,
  buildGoalCardMenu,
  buildGoalCellMenu,
  buildMemoryCardMenu,
  buildNotesCardMenu,
  buildTriageCardMenu,
} from "./card"
import { ids } from "../test-helpers"
import { validateMenu } from "../model"

describe("buildGoalCardMenu", () => {
  test("omits resume entirely and shows pause only while running", () => {
    const running = buildGoalCardMenu({ goalId: "g", running: true, canPause: true })
    expect(ids(running)).toEqual(["goal.details", "goal.timeline", "goal.copyId", "goal.pause", "goal.cancel"])
    expect(validateMenu(running)).toEqual([])

    const idle = buildGoalCardMenu({ goalId: "g", running: false, canPause: false })
    expect(ids(idle)).toEqual(["goal.details", "goal.timeline", "goal.copyId", "goal.cancel"])
    expect(ids(running)).not.toContain("goal.resume")
  })
})

describe("buildGoalCellMenu", () => {
  test("retry is disabled when the node cannot run again", () => {
    const m = buildGoalCellMenu({ goalId: "g", runId: "r", sessionID: "s", canRetry: false })
    expect(ids(m)).toEqual(["goalCell.openSession", "goalCell.retry", "goalCell.copyArtifact"])
    const retry = m.items.find((i) => i.type === "item" && i.id === "goalCell.retry") as any
    expect(retry.disabled).toBe(true)
    expect(validateMenu(m)).toEqual([])
  })

  test("artifact copy is disabled without an artifact", () => {
    const m = buildGoalCellMenu({ goalId: "g", runId: "r", canRetry: true })
    const copy = m.items.find((i) => i.type === "item" && i.id === "goalCell.copyArtifact") as any
    expect(copy.disabled).toBe(true)
  })
})

describe("buildMemoryCardMenu", () => {
  test("pinned/sticky variants", () => {
    const plain = buildMemoryCardMenu({ id: "m", pinned: false, sticky: false })
    expect(ids(plain)).toEqual([
      "memory.copyAbstraction",
      "memory.copyFull",
      "memory.pin",
      "memory.sticky",
      "memory.delete",
    ])
    expect(validateMenu(plain)).toEqual([])

    const sticky = buildMemoryCardMenu({ id: "m", pinned: true, sticky: true })
    expect(ids(sticky)).toEqual([
      "memory.copyAbstraction",
      "memory.copyFull",
      "memory.pin",
      "memory.sticky",
      "memory.unsticky",
      "memory.delete",
    ])
    expect(validateMenu(sticky)).toEqual([])
  })
})

describe("buildNotesCardMenu", () => {
  test("renew, unsticky, delete", () => {
    const m = buildNotesCardMenu({ id: "n" })
    expect(ids(m)).toEqual(["notes.renew", "notes.unsticky", "notes.delete"])
    expect(validateMenu(m)).toEqual([])
  })
})

describe("approval menus", () => {
  test("question cards", () => {
    const m = buildApprovalQuestionMenu({ id: "q" })
    expect(ids(m)).toEqual(["approvalQ.approve", "approvalQ.reject", "approvalQ.copyQuestion"])
    expect(validateMenu(m)).toEqual([])
  })

  test("permission cards hide copy when there is no command", () => {
    const m = buildApprovalPermissionMenu({ id: "a" })
    expect(ids(m)).toEqual([
      "approvalP.allowOnce",
      "approvalP.alwaysAllow",
      "approvalP.reject",
      "approvalP.rememberPrefix",
      "approvalP.rememberTool",
    ])
    expect(validateMenu(m)).toEqual([])
    expect(ids(buildApprovalPermissionMenu({ id: "a", command: "rm -rf x" }))).toContain("approvalP.copyCommand")
  })
})

describe("buildTriageCardMenu", () => {
  test("has all three decisions", () => {
    const m = buildTriageCardMenu({ id: "t", goalId: "g" })
    expect(ids(m)).toEqual([
      "triage.confirm",
      "triage.proposeConfirm",
      "triage.proposeReject",
      "triage.viewGoal",
      "triage.dismiss",
    ])
    expect(validateMenu(m)).toEqual([])
  })
})

describe("buildAutomationCardMenu", () => {
  test("toggle label follows state", () => {
    const on = buildAutomationCardMenu({ id: "r", enabled: true })
    const off = buildAutomationCardMenu({ id: "r", enabled: false })
    expect((on.items[0] as any).label).toBe("停用")
    expect((off.items[0] as any).label).toBe("启用")
    expect(ids(off)).toEqual(["automation.toggle", "automation.copyId", "automation.delete"])
    expect(validateMenu(on)).toEqual([])
    expect(validateMenu(off)).toEqual([])
  })
})
