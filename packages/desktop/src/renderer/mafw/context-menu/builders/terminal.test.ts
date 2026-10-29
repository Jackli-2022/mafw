import { describe, expect, test } from "bun:test"
import { buildTerminalMenu } from "./terminal"
import { ids } from "../test-helpers"
import { validateMenu } from "../model"

describe("buildTerminalMenu", () => {
  test("copy disabled without selection; close is danger last", () => {
    const m = buildTerminalMenu({ hasSelection: false, canClose: true })
    expect(ids(m)).toEqual([
      "terminal.copy",
      "terminal.paste",
      "terminal.selectAll",
      "terminal.clear",
      "terminal.openExternal",
      "terminal.close",
    ])
    const copy = m.items.find((i) => i.type === "item" && i.id === "terminal.copy") as any
    expect(copy.disabled).toBe(true)
    const close = m.items.at(-1) as any
    expect(close.danger).toBe(true)
    expect(close.confirms).toBeFalsy()
    expect(validateMenu(m)).toEqual([])
  })

  test("copy is enabled with a selection", () => {
    const m = buildTerminalMenu({ hasSelection: true, canClose: true })
    const copy = m.items.find((i) => i.type === "item" && i.id === "terminal.copy") as any
    expect(copy.disabled).toBeFalsy()
  })

  test("local-only kill; ssh omits openExternal and kill", () => {
    const local = buildTerminalMenu({ hasSelection: false, canClose: true, canKill: true, isLocal: true })
    expect(ids(local)).toContain("terminal.kill")
    expect(ids(local)).toContain("terminal.openExternal")
    const ssh = buildTerminalMenu({ hasSelection: false, canClose: true, canKill: false, isLocal: false })
    expect(ids(ssh)).not.toContain("terminal.kill")
    expect(ids(ssh)).not.toContain("terminal.openExternal")
    expect(validateMenu(ssh)).toEqual([])
  })
})
