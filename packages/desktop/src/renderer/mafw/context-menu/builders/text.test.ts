import { describe, expect, test } from "bun:test"
import { buildTextMenu } from "./text"
import { ids } from "../test-helpers"
import { validateMenu } from "../model"

describe("buildTextMenu", () => {
  test("editable fields get cut/copy/paste/select-all", () => {
    const m = buildTextMenu({ editable: true, hasSelection: true, canPaste: true })
    expect(ids(m)).toEqual(["text.cut", "text.copy", "text.paste", "text.selectAll"])
    expect(validateMenu(m)).toEqual([])
  })

  test("no selection disables cut/copy; no clipboard disables paste", () => {
    const m = buildTextMenu({ editable: true, hasSelection: false, canPaste: false })
    const cut = m.items.find((i) => i.type === "item" && i.id === "text.cut") as any
    const copy = m.items.find((i) => i.type === "item" && i.id === "text.copy") as any
    const paste = m.items.find((i) => i.type === "item" && i.id === "text.paste") as any
    expect(cut.disabled).toBe(true)
    expect(copy.disabled).toBe(true)
    expect(paste.disabled).toBe(true)
  })

  test("read-only selection only offers copy", () => {
    const m = buildTextMenu({ editable: false, hasSelection: true, canPaste: false })
    expect(ids(m)).toEqual(["text.copy"])
    expect(validateMenu(m)).toEqual([])
  })
})
