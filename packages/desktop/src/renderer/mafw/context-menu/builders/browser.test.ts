import { describe, expect, test } from "bun:test"
import { buildBrowserMenu } from "./browser"
import { ids } from "../test-helpers"
import { validateMenu } from "../model"

describe("buildBrowserMenu", () => {
  test("disabled states follow capabilities", () => {
    const m = buildBrowserMenu({ url: "", canBack: false, canForward: false, started: false, canPick: false })
    expect(ids(m)).toEqual([
      "browser.back",
      "browser.forward",
      "browser.reload",
      "browser.copyLink",
      "browser.openExternal",
      "browser.pick",
    ])
    const back = m.items.find((i) => i.type === "item" && i.id === "browser.back") as any
    const copy = m.items.find((i) => i.type === "item" && i.id === "browser.copyLink") as any
    const pick = m.items.find((i) => i.type === "item" && i.id === "browser.pick") as any
    expect(back.disabled).toBe(true)
    expect(copy.disabled).toBe(true)
    expect(pick.disabled).toBe(true)
    expect(validateMenu(m)).toEqual([])
  })

  test("reachable page enables navigation", () => {
    const m = buildBrowserMenu({ url: "https://x", canBack: true, canForward: true, started: true, canPick: true })
    for (const entry of m.items) {
      if (entry.type === "item") expect(entry.disabled).toBeFalsy()
    }
  })
})
