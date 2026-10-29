import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  BROWSER_TAB_LIMIT,
  activeBrowserTabId,
  browserTabTitle,
  browserTabs,
  closeBrowserTab,
  createBrowserTab,
  nextBrowserTabAfterClose,
  openBrowserTab,
  resetBrowserTabsForTests,
} from "./browser-tabs"

describe("browser-tabs", () => {
  test("new tabs append, current-tab updates, close picks left neighbor", () => {
    resetBrowserTabsForTests()
    const a = openBrowserTab("https://a.example", { newTab: true })!
    const b = openBrowserTab("https://b.example", { newTab: true })!
    assert.equal(browserTabs().length, 2)
    assert.equal(activeBrowserTabId(), b.id)
    openBrowserTab("https://c.example", { newTab: false })
    assert.equal(browserTabs()[1].url, "https://c.example")
    closeBrowserTab(b.id)
    assert.equal(activeBrowserTabId(), a.id)
  })

  test("title falls back to host, then 新标签页; limit is 12", () => {
    resetBrowserTabsForTests()
    assert.equal(browserTabTitle(createBrowserTab("https://x.example/a", "t1")), "x.example")
    assert.equal(browserTabTitle(createBrowserTab("", "t2")), "新标签页")
    for (let i = 0; i < BROWSER_TAB_LIMIT; i++) {
      assert.ok(openBrowserTab(`https://${i}.example`, { newTab: true }))
    }
    assert.equal(openBrowserTab("https://overflow.example", { newTab: true }), null)
    assert.equal(browserTabs().length, BROWSER_TAB_LIMIT)
  })

  test("close non-active leaves active; closing last clears active", () => {
    resetBrowserTabsForTests()
    const a = openBrowserTab("https://a.example", { newTab: true })!
    const b = openBrowserTab("https://b.example", { newTab: true })!
    closeBrowserTab(a.id)
    assert.equal(activeBrowserTabId(), b.id)
    closeBrowserTab(b.id)
    assert.equal(activeBrowserTabId(), null)
    assert.equal(browserTabs().length, 0)
  })

  test("nextBrowserTabAfterClose handles no match and non-active close", () => {
    const tabs = [
      createBrowserTab("", "a", "A"),
      createBrowserTab("", "b", "B"),
    ]
    assert.equal(nextBrowserTabAfterClose(tabs, "b", "a"), "b")
    assert.equal(nextBrowserTabAfterClose(tabs, "a", "a"), "b")
    assert.equal(nextBrowserTabAfterClose([], null, "x"), null)
  })
})
