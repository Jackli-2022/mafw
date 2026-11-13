import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import {
  activateDocumentTab,
  activeDocumentTab,
  activeDocumentTabId,
  activeDocumentTabKind,
  closeDocumentTabsToRight,
  closeOtherDocumentTabs,
  configureDocumentListWorld,
  consumeCloseRequest,
  documentTabs,
  moveDocumentTab,
  pendingCloseRequests,
  requestCloseDocumentTab,
  resetDocumentTabsForTests,
  syncFileTabs,
} from "./document-tabs-store"
import { closeBrowserTab, openBrowserTab, resetBrowserTabsForTests, updateBrowserTab } from "../browser-tabs"
import {
  configureDocumentListStorage,
  documentListStorageKey,
  flushDocumentListPersistence,
  resetDocumentListPersistenceForTests,
} from "./document-list-persistence"
import type { DocumentTabView } from "../document-frame-model"

const view = (id: string, label = id, extra: Partial<DocumentTabView> = {}): DocumentTabView => ({
  id,
  label,
  icon: "file",
  active: false,
  ...extra,
})

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
  }
}

const fileId = (rel: string) => `file:C:/repo\u0000${rel}`

function web(id: string, label = id): void {
  openBrowserTab(`https://${id}.example`, { id, newTab: true, title: label })
}

beforeEach(() => {
  resetBrowserTabsForTests()
  resetDocumentTabsForTests()
  resetDocumentListPersistenceForTests()
})

test("file and web tabs merge into one stable strip", () => {
  syncFileTabs("C:/repo", [view("a.ts")])
  web("w1", "Example")

  assert.deepEqual(documentTabs().map((entry) => entry.kind), ["file", "web"])
  assert.deepEqual(documentTabs().map((entry) => entry.view.label), ["a.ts", "Example"])

  syncFileTabs("C:/repo", [view("a.ts", "a.ts", { dirty: true })])
  assert.equal(documentTabs()[0]!.view.dirty, true)
  assert.deepEqual(documentTabs().map((entry) => entry.kind), ["file", "web"])
})

test("removing files leaves web tabs and keeps their order", () => {
  syncFileTabs("C:/repo", [view("a.ts"), view("b.ts")])
  web("w1", "W")
  syncFileTabs("C:/repo", [])

  assert.deepEqual(documentTabs().map((entry) => entry.kind), ["web"])
  assert.equal(documentTabs()[0]!.view.label, "W")
})

test("a different root replaces stale file tabs but not web tabs", () => {
  syncFileTabs("C:/repo", [view("a.ts")])
  web("w1", "W")
  syncFileTabs("C:/worktree", [view("a.ts")])

  const files = documentTabs().filter((entry) => entry.kind === "file")
  assert.equal(files.length, 1)
  assert.match(files[0]!.id, /worktree/)
  assert.equal(documentTabs().filter((entry) => entry.kind === "web").length, 1)
})

test("activate sets active id and kind; unknown ids are ignored", () => {
  syncFileTabs("C:/repo", [view("a.ts")])
  web("w1", "W")
  const fileId = documentTabs()[0]!.id
  const webId = documentTabs()[1]!.id

  activateDocumentTab(fileId)
  assert.equal(activeDocumentTabId(), fileId)
  assert.equal(activeDocumentTabKind(), "file")
  activateDocumentTab(webId)
  assert.equal(activeDocumentTabKind(), "web")
  activateDocumentTab("missing")
  assert.equal(activeDocumentTabId(), webId)
})

test("re-syncing identical tabs does not rewrite the strip", () => {
  syncFileTabs("C:/repo", [view("a.ts")])
  web("w1", "W")
  const first = documentTabs()

  syncFileTabs("C:/repo", [view("a.ts")])
  updateBrowserTab("w1", { title: "W" })

  assert.equal(documentTabs(), first)
})

test("activeDocumentTab returns the active entry", () => {
  syncFileTabs("C:/repo", [view("a.ts")])
  const id = documentTabs()[0]!.id
  activateDocumentTab(id)
  assert.equal(activeDocumentTab()?.id, id)
  assert.equal(activeDocumentTab()?.kind, "file")
})

test("browser documents create and remove web entries automatically", () => {
  syncFileTabs("C:/repo", [view("a.ts")])
  web("w1", "W")
  const [, webDocumentId] = documentTabs().map((entry) => entry.id)
  activateDocumentTab(webDocumentId!)

  assert.deepEqual(documentTabs().map((entry) => entry.kind), ["file", "web"])
  assert.equal(activeDocumentTabId(), webDocumentId)

  closeBrowserTab("w1")

  assert.deepEqual(documentTabs().map((entry) => entry.kind), ["file"])
  assert.equal(activeDocumentTabId(), null)
})

test("close requests are deduped and consumed exactly once", () => {
  syncFileTabs("C:/repo", [view("a.ts")])
  web("w1", "W")
  const [fileId, webId] = documentTabs().map((entry) => entry.id)

  requestCloseDocumentTab(fileId!)
  requestCloseDocumentTab(fileId!)
  requestCloseDocumentTab(webId!)
  assert.deepEqual(pendingCloseRequests(), [fileId, webId])

  consumeCloseRequest(fileId!)
  assert.deepEqual(pendingCloseRequests(), [webId])
  consumeCloseRequest("missing")
  assert.deepEqual(pendingCloseRequests(), [webId])
})

test("close other and close right enqueue the clicked tab's targets", () => {
  syncFileTabs("C:/repo", [view("a.ts"), view("b.ts")])
  web("w1", "W")
  const [a, b, w] = documentTabs().map((entry) => entry.id)

  closeOtherDocumentTabs(b!)
  assert.deepEqual(pendingCloseRequests(), [a, w])

  consumeCloseRequest(a!)
  consumeCloseRequest(w!)
  closeDocumentTabsToRight(b!)
  assert.deepEqual(pendingCloseRequests(), [w])
})

test("configured world applies saved mixed order before both bodies sync", () => {
  const storage = fakeStorage()
  configureDocumentListStorage(storage)
  storage.setItem(documentListStorageKey("w"), JSON.stringify({
    version: 1,
    order: ["web:w1", fileId("a.ts")],
    activeId: "web:w1",
  }))

  configureDocumentListWorld("w")
  syncFileTabs("C:/repo", [view("a.ts")])
  assert.deepEqual(documentTabs().map((entry) => entry.id), [fileId("a.ts")])

  web("w1", "W")
  assert.deepEqual(documentTabs().map((entry) => entry.id), ["web:w1", fileId("a.ts")])
  assert.equal(activeDocumentTabId(), "web:w1")
})

test("new tabs append and closing prunes the saved order", () => {
  const storage = fakeStorage()
  configureDocumentListStorage(storage)
  storage.setItem(documentListStorageKey("w"), JSON.stringify({
    version: 1,
    order: ["file:C:/repo\u0000a.ts", "web:w1"],
    activeId: null,
  }))
  configureDocumentListWorld("w")

  syncFileTabs("C:/repo", [view("a.ts"), view("b.ts")])
  web("w1", "W")
  web("w2", "W2")
  assert.deepEqual(documentTabs().map((entry) => entry.id), [
    fileId("a.ts"),
    "web:w1",
    fileId("b.ts"),
    "web:w2",
  ])

  syncFileTabs("C:/repo", [view("a.ts")])
  flushDocumentListPersistence()
  const saved = JSON.parse(storage.map.get(documentListStorageKey("w"))!) as { order: string[] }
  assert.deepEqual(saved.order, [fileId("a.ts"), "web:w1", "web:w2"])
})

test("moving a tab persists the new mixed order and survives syncs", () => {
  const storage = fakeStorage()
  configureDocumentListStorage(storage)
  configureDocumentListWorld("w")
  syncFileTabs("C:/repo", [view("a.ts"), view("b.ts")])
  web("w1", "W")

  moveDocumentTab("web:w1", fileId("a.ts"), "before")
  assert.deepEqual(documentTabs().map((entry) => entry.id), [
    "web:w1",
    fileId("a.ts"),
    fileId("b.ts"),
  ])

  web("w1", "W")
  assert.deepEqual(documentTabs().map((entry) => entry.id), [
    "web:w1",
    fileId("a.ts"),
    fileId("b.ts"),
  ])

  flushDocumentListPersistence()
  const saved = JSON.parse(storage.map.get(documentListStorageKey("w"))!) as { order: string[] }
  assert.deepEqual(saved.order, ["web:w1", fileId("a.ts"), fileId("b.ts")])
})

test("switching worlds loads that world's order", () => {
  const storage = fakeStorage()
  configureDocumentListStorage(storage)
  storage.setItem(documentListStorageKey("w1"), JSON.stringify({
    version: 1,
    order: [fileId("a.ts"), fileId("b.ts")],
    activeId: null,
  }))
  storage.setItem(documentListStorageKey("w2"), JSON.stringify({
    version: 1,
    order: [fileId("b.ts"), fileId("a.ts")],
    activeId: null,
  }))

  configureDocumentListWorld("w1")
  syncFileTabs("C:/repo", [view("a.ts"), view("b.ts")])
  assert.deepEqual(documentTabs().map((entry) => entry.id), [fileId("a.ts"), fileId("b.ts")])

  configureDocumentListWorld("w2")
  assert.deepEqual(documentTabs().map((entry) => entry.id), [fileId("b.ts"), fileId("a.ts")])
})

test("no order is persisted before a world is configured", () => {
  const storage = fakeStorage()
  configureDocumentListStorage(storage)
  syncFileTabs("C:/repo", [view("a.ts")])
  flushDocumentListPersistence()
  assert.equal(storage.map.size, 0)
})
