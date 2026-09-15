import { describe, expect, test } from "bun:test"
import { shouldAutoApprove, nextPermissionMode } from "./permission-mode"

describe("permission mode", () => {
  test("manual mode never auto-approves", () => {
    expect(shouldAutoApprove({ mode: "manual", isDangerous: false })).toBe(false)
    expect(shouldAutoApprove({ mode: "manual", isDangerous: true })).toBe(false)
  })

  test("auto mode approves safe commands only", () => {
    expect(shouldAutoApprove({ mode: "auto", isDangerous: false })).toBe(true)
    expect(shouldAutoApprove({ mode: "auto", isDangerous: true })).toBe(false)
  })

  test("mode cycle is manual <-> auto (two states)", () => {
    expect(nextPermissionMode("manual")).toBe("auto")
    expect(nextPermissionMode("auto")).toBe("manual")
  })

  test("auto-approval budget depletes: at most N approvals before falling back", () => {
    // After 25 consecutive auto-approvals in one session the mode falls back
    // to manual — runaway loops must not auto-approve forever.
    let mode = "auto" as "manual" | "auto"
    let approvals = 0
    for (let i = 0; i < 40; i++) {
      if (shouldAutoApprove({ mode, isDangerous: false, autoApprovals: approvals })) {
        approvals++
      } else {
        mode = "manual"
        break
      }
    }
    expect(mode).toBe("manual")
    expect(approvals).toBe(25)
  })
})
