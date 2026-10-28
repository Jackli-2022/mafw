import { describe, expect, test } from "bun:test"
import { buildEditorTabMenu } from "./editor-tab"
import { ids } from "../test-helpers"
import { validateMenu } from "../model"

describe("buildEditorTabMenu", () => {
  test("close family then copy/reveal", () => {
    const m = buildEditorTabMenu({ rel: "a.ts", index: 0, count: 3 })
    expect(ids(m)).toEqual([
      "editorTab.close",
      "editorTab.closeOthers",
      "editorTab.closeRight",
      "editorTab.copyPath",
      "editorTab.reveal",
    ])
    expect(validateMenu(m)).toEqual([])
  })

  test("single tab disables close-others and close-right", () => {
    const m = buildEditorTabMenu({ rel: "a.ts", index: 0, count: 1 })
    const others = m.items.find((i) => i.type === "item" && i.id === "editorTab.closeOthers") as any
    const right = m.items.find((i) => i.type === "item" && i.id === "editorTab.closeRight") as any
    expect(others.disabled).toBe(true)
    expect(right.disabled).toBe(true)
  })

  test("last tab cannot close to the right", () => {
    const m = buildEditorTabMenu({ rel: "c.ts", index: 2, count: 3 })
    const right = m.items.find((i) => i.type === "item" && i.id === "editorTab.closeRight") as any
    expect(right.disabled).toBe(true)
  })
})
