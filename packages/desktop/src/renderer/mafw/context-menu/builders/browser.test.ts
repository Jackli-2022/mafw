import { describe, expect, test } from "bun:test"
import { buildBrowserMenu, buildBrowserTabMenu } from "./browser"
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

describe("buildBrowserTabMenu", () => {
  test("targets the clicked tab with close/copy/open actions", () => {
    const m = buildBrowserTabMenu({ url: "https://x", canCloseOthers: true, canCloseRight: true })
    expect(ids(m)).toEqual([
      "browserTab.close",
      "browserTab.closeOthers",
      "browserTab.closeRight",
      "browserTab.copyLink",
      "browserTab.openExternal",
    ])
    for (const entry of m.items) {
      if (entry.type === "item") expect(entry.disabled).toBeFalsy()
    }
    expect(validateMenu(m)).toEqual([])
  })

  test("single tab and empty URL disable the impossible actions", () => {
    const m = buildBrowserTabMenu({ url: "", canCloseOthers: false, canCloseRight: false })
    const byId = (id: string) => m.items.find((entry) => entry.type === "item" && entry.id === id) as any

    expect(byId("browserTab.closeOthers").disabled).toBe(true)
    expect(byId("browserTab.closeRight").disabled).toBe(true)
    expect(byId("browserTab.copyLink").disabled).toBe(true)
    expect(byId("browserTab.openExternal").disabled).toBe(true)
    expect(byId("browserTab.close").disabled).toBeFalsy()
    expect(validateMenu(m)).toEqual([])
  })
})
