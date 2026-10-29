import { describe, expect, test } from "bun:test"
import { buildBrowserPageMenu } from "./browser-page"
import { ids } from "../test-helpers"
import { validateMenu } from "../model"

const base = { url: "https://example.com", canBack: true, canForward: false }

describe("buildBrowserPageMenu", () => {
  test("link target adds copy/open-link before navigation", () => {
    const m = buildBrowserPageMenu({ ...base, linkURL: "https://example.com/doc" })
    expect(ids(m)).toEqual([
      "browserPage.copyLink",
      "browserPage.openLink",
      "browserPage.back",
      "browserPage.forward",
      "browserPage.reload",
      "browserPage.openExternal",
    ])
    expect(validateMenu(m)).toEqual([])
  })

  test("selection and image targets add their actions", () => {
    const m = buildBrowserPageMenu({
      ...base,
      selectionText: "hello",
      imageURL: "https://example.com/a.png",
    })
    expect(ids(m)).toEqual([
      "browserPage.copySelection",
      "browserPage.copyImageUrl",
      "browserPage.back",
      "browserPage.forward",
      "browserPage.reload",
      "browserPage.openExternal",
    ])
    expect(validateMenu(m)).toEqual([])
  })

  test("blank page keeps navigation only", () => {
    expect(ids(buildBrowserPageMenu(base))).toEqual([
      "browserPage.back",
      "browserPage.forward",
      "browserPage.reload",
      "browserPage.openExternal",
    ])
  })
})
