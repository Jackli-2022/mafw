import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import {
  activeBrowserDocumentId,
  browserDocuments,
  resetBrowserDocumentsForTests,
} from "./browser-documents"
import {
  configureBrowserTabsStorage,
  flushBrowserTabsPersistence,
  loadBrowserTabsSnapshot,
  resetBrowserTabsPersistenceForTests,
  restoreBrowserTabsOnce,
  saveBrowserTabsSnapshot,
} from "./browser-tabs-persistence"

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
  }
}

beforeEach(() => {
  resetBrowserDocumentsForTests()
  resetBrowserTabsPersistenceForTests()
})

test("browser tabs restore ids, urls, titles and active once", () => {
  const storage = fakeStorage()
  configureBrowserTabsStorage(storage)
  storage.setItem("mafw-browser-tabs:v1", JSON.stringify({
    version: 1,
    activeId: "browser-tab-7",
    tabs: [
      { id: "browser-tab-7", url: "https://example.com/", title: "Example Domain" },
      { id: "browser-tab-3", url: "mafw-file://abc/docs/index.html", title: "index.html" },
    ],
  }))

  assert.equal(restoreBrowserTabsOnce(), 2)
  assert.deepEqual(browserDocuments().map((tab) => tab.id), ["browser-tab-7", "browser-tab-3"])
  assert.equal(browserDocuments()[0].title, "Example Domain")
  assert.equal(activeBrowserDocumentId(), "browser-tab-7")

  assert.equal(restoreBrowserTabsOnce(), 0)
  assert.equal(browserDocuments().length, 2)
})

test("restore skips invalid urls and unknown active ids", () => {
  const storage = fakeStorage()
  configureBrowserTabsStorage(storage)
  storage.setItem("mafw-browser-tabs:v1", JSON.stringify({
    version: 1,
    activeId: "missing",
    tabs: [
      { id: "ok", url: "https://example.com" },
      { id: "js", url: "javascript:alert(1)" },
      { id: "file", url: "file:///etc/passwd" },
      { id: "data", url: "data:text/html,x" },
      { id: "dup", url: "https://a.example" },
      { id: "dup", url: "https://b.example" },
    ],
  }))

  assert.equal(restoreBrowserTabsOnce(), 2)
  assert.deepEqual(browserDocuments().map((tab) => tab.id), ["ok", "dup"])
  assert.equal(browserDocuments()[1].url, "https://a.example")
  assert.equal(activeBrowserDocumentId(), "dup")
})

test("browser snapshots roundtrip and keep only restorable urls", () => {
  const storage = fakeStorage()
  configureBrowserTabsStorage(storage)

  saveBrowserTabsSnapshot({
    version: 1,
    activeId: "b",
    tabs: [
      { id: "a", url: "https://a.example", title: "A" },
      { id: "b", url: "javascript:alert(1)" },
      { id: "c", url: "mafw-file://abc/index.html" },
    ],
  })
  assert.equal(storage.map.size, 0)
  flushBrowserTabsPersistence()

  assert.deepEqual(loadBrowserTabsSnapshot(), {
    version: 1,
    activeId: null,
    tabs: [
      { id: "a", url: "https://a.example", title: "A" },
      { id: "c", url: "mafw-file://abc/index.html" },
    ],
  })
})

test("restored snapshot drops tabs beyond the limit", () => {
  const storage = fakeStorage()
  configureBrowserTabsStorage(storage)
  storage.setItem("mafw-browser-tabs:v1", JSON.stringify({
    version: 1,
    activeId: null,
    tabs: Array.from({ length: 15 }, (_, index) => ({
      id: `t${index}`,
      url: `https://${index}.example`,
    })),
  }))

  assert.equal(restoreBrowserTabsOnce(), 12)
  assert.equal(browserDocuments().length, 12)
})
