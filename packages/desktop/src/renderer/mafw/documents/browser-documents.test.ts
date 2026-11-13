import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  BROWSER_TAB_LIMIT,
  activeBrowserDocumentId,
  browserDocumentTitle,
  browserDocuments,
  closeBrowserDocument,
  closeBrowserDocumentsToRight,
  closeOtherBrowserDocuments,
  createBrowserDocument,
  nextBrowserDocumentAfterClose,
  openBrowserDocument,
  resetBrowserDocumentsForTests,
} from "./browser-documents"

describe("browser-documents", () => {
  test("new tabs append, current-tab updates, close picks left neighbor", () => {
    resetBrowserDocumentsForTests()
    const a = openBrowserDocument("https://a.example", { newTab: true })!
    const b = openBrowserDocument("https://b.example", { newTab: true })!
    assert.equal(browserDocuments().length, 2)
    assert.equal(activeBrowserDocumentId(), b.id)
    openBrowserDocument("https://c.example", { newTab: false })
    assert.equal(browserDocuments()[1].url, "https://c.example")
    closeBrowserDocument(b.id)
    assert.equal(activeBrowserDocumentId(), a.id)
  })

  test("title falls back to host, then 新标签页; limit is 12", () => {
    resetBrowserDocumentsForTests()
    assert.equal(browserDocumentTitle(createBrowserDocument("https://x.example/a", "t1")), "x.example")
    assert.equal(browserDocumentTitle(createBrowserDocument("", "t2")), "新标签页")
    assert.equal(
      browserDocumentTitle(createBrowserDocument("mafw-file://ab12cd34/docs/index.html", "t3")),
      "index.html",
    )
    for (let i = 0; i < BROWSER_TAB_LIMIT; i++) {
      assert.ok(openBrowserDocument(`https://${i}.example`, { newTab: true }))
    }
    assert.equal(openBrowserDocument("https://overflow.example", { newTab: true }), null)
    assert.equal(browserDocuments().length, BROWSER_TAB_LIMIT)
  })

  test("close non-active leaves active; closing last clears active", () => {
    resetBrowserDocumentsForTests()
    const a = openBrowserDocument("https://a.example", { newTab: true })!
    const b = openBrowserDocument("https://b.example", { newTab: true })!
    closeBrowserDocument(a.id)
    assert.equal(activeBrowserDocumentId(), b.id)
    closeBrowserDocument(b.id)
    assert.equal(activeBrowserDocumentId(), null)
    assert.equal(browserDocuments().length, 0)
  })

  test("closeOtherBrowserTabs keeps only the target and activates it", () => {
    resetBrowserDocumentsForTests()
    const a = openBrowserDocument("https://a.example", { newTab: true })!
    const b = openBrowserDocument("https://b.example", { newTab: true })!
    openBrowserDocument("https://c.example", { newTab: true })

    closeOtherBrowserDocuments(a.id)

    assert.deepEqual(browserDocuments().map((tab) => tab.id), [a.id])
    assert.equal(activeBrowserDocumentId(), a.id)
    assert.ok(!browserDocuments().some((tab) => tab.id === b.id))
  })

  test("closeBrowserDocumentsToRight keeps the left side and moves active left", () => {
    resetBrowserDocumentsForTests()
    const a = openBrowserDocument("https://a.example", { newTab: true })!
    const b = openBrowserDocument("https://b.example", { newTab: true })!
    openBrowserDocument("https://c.example", { newTab: true })

    closeBrowserDocumentsToRight(b.id)

    assert.deepEqual(browserDocuments().map((tab) => tab.id), [a.id, b.id])
    assert.equal(activeBrowserDocumentId(), b.id)

    closeBrowserDocumentsToRight(a.id)
    assert.deepEqual(browserDocuments().map((tab) => tab.id), [a.id])
    assert.equal(activeBrowserDocumentId(), a.id)
  })

  test("explicit browser-tab ids advance the id sequence", () => {
    resetBrowserDocumentsForTests()
    openBrowserDocument("https://restored.example", { id: "browser-tab-7", newTab: true })
    const next = openBrowserDocument("https://next.example", { newTab: true })!
    assert.notEqual(next.id, "browser-tab-1")
    assert.equal(next.id, "browser-tab-8")
  })

  test("nextBrowserTabAfterClose handles no match and non-active close", () => {
    const tabs = [
      createBrowserDocument("", "a", "A"),
      createBrowserDocument("", "b", "B"),
    ]
    assert.equal(nextBrowserDocumentAfterClose(tabs, "b", "a"), "b")
    assert.equal(nextBrowserDocumentAfterClose(tabs, "a", "a"), "b")
    assert.equal(nextBrowserDocumentAfterClose([], null, "x"), null)
  })
})
