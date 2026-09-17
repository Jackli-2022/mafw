import { describe, expect, test } from "bun:test"
import { countPending, trayMenuStatusLabel, trayTooltip } from "./tray-status"

describe("countPending", () => {
  test("sums pending approvals and permission requests", () => {
    const approvals = { approvals: [{ status: "pending" }, { status: "answered" }, { status: "pending" }] }
    const permissions = { items: [{ id: "p1" }] }
    expect(countPending(approvals, permissions)).toBe(3)
  })

  test("tolerates missing or malformed payloads (fail-open)", () => {
    expect(countPending(null, null)).toBe(0)
    expect(countPending({}, undefined)).toBe(0)
    expect(countPending({ approvals: "nope" }, { items: null })).toBe(0)
  })
})

describe("trayTooltip", () => {
  test("plain app name when nothing is pending", () => {
    expect(trayTooltip(0)).toBe("MAFW Desktop")
  })

  test("shows pending count when work awaits the user", () => {
    expect(trayTooltip(1)).toBe("MAFW Desktop — 1 pending approval")
    expect(trayTooltip(3)).toBe("MAFW Desktop — 3 pending approvals")
  })
})

describe("trayMenuStatusLabel", () => {
  test("explicit idle label when nothing is pending", () => {
    expect(trayMenuStatusLabel(0)).toBe("No pending approvals")
  })

  test("count label when work awaits the user", () => {
    expect(trayMenuStatusLabel(2)).toBe("2 pending approvals")
  })
})
