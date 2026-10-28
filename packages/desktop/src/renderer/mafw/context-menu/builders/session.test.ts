import { describe, expect, test } from "bun:test"
import { buildSessionMenu } from "./session"
import { ids } from "../test-helpers"
import { validateMenu } from "../model"

const row = { id: "s1", title: "会话", kind: "row" as const, canFork: true, canDelete: true }

describe("buildSessionMenu", () => {
  test("row menu is open/rename/fork/export/copyId then delete", () => {
    const m = buildSessionMenu(row)
    expect(ids(m)).toEqual([
      "session.open",
      "session.rename",
      "session.fork",
      "session.export",
      "session.copyId",
      "session.delete",
    ])
    expect(validateMenu(m)).toEqual([])
  })

  test("tab menu swaps delete for close", () => {
    const m = buildSessionMenu({ ...row, kind: "tab" })
    expect(ids(m)).toEqual([
      "session.open",
      "session.rename",
      "session.fork",
      "session.export",
      "session.copyId",
      "session.closeTab",
    ])
    expect(validateMenu(m)).toEqual([])
  })

  test("fork is disabled with a reason when unavailable; delete is danger", () => {
    const m = buildSessionMenu({ ...row, canFork: false })
    const fork = m.items.find((i) => i.type === "item" && i.id === "session.fork") as any
    const del = m.items.find((i) => i.type === "item" && i.id === "session.delete") as any
    expect(fork.disabled).toBe(true)
    expect(fork.disabledReason).toBe("当前运行时不支持分叉")
    expect(del.danger).toBe(true)
    expect(del.confirms).toBe(true)
  })

  test("delete is disabled while the session is running", () => {
    const m = buildSessionMenu({ ...row, canDelete: false })
    const del = m.items.find((i) => i.type === "item" && i.id === "session.delete") as any
    expect(del.disabled).toBe(true)
    expect(del.disabledReason).toBe("会话正在运行")
  })
})
