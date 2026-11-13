import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  BROWSER_TAB_LIMIT,
  activeBrowserTabId,
  browserTabTitle,
  browserTabs,
  closeBrowserTab,
  closeBrowserTabsToRight,
  closeOtherBrowserTabs,
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
    assert.equal(
      browserTabTitle(createBrowserTab("mafw-file://ab12cd34/docs/index.html", "t3")),
      "index.html",
    )
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

  test("closeOtherBrowserTabs keeps only the target and activates it", () => {
    resetBrowserTabsForTests()
    const a = openBrowserTab("https://a.example", { newTab: true })!
    const b = openBrowserTab("https://b.example", { newTab: true })!
    openBrowserTab("https://c.example", { newTab: true })

    closeOtherBrowserTabs(a.id)

    assert.deepEqual(browserTabs().map((tab) => tab.id), [a.id])
    assert.equal(activeBrowserTabId(), a.id)
    assert.ok(!browserTabs().some((tab) => tab.id === b.id))
  })

  test("closeBrowserTabsToRight keeps the left side and moves active left", () => {
    resetBrowserTabsForTests()
    const a = openBrowserTab("https://a.example", { newTab: true })!
    const b = openBrowserTab("https://b.example", { newTab: true })!
    openBrowserTab("https://c.example", { newTab: true })

    closeBrowserTabsToRight(b.id)

    assert.deepEqual(browserTabs().map((tab) => tab.id), [a.id, b.id])
    assert.equal(activeBrowserTabId(), b.id)

    closeBrowserTabsToRight(a.id)
    assert.deepEqual(browserTabs().map((tab) => tab.id), [a.id])
    assert.equal(activeBrowserTabId(), a.id)
  })

  test("explicit browser-tab ids advance the id sequence", () => {
    resetBrowserTabsForTests()
    openBrowserTab("https://restored.example", { id: "browser-tab-7", newTab: true })
    const next = openBrowserTab("https://next.example", { newTab: true })!
    assert.notEqual(next.id, "browser-tab-1")
    assert.equal(next.id, "browser-tab-8")
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
