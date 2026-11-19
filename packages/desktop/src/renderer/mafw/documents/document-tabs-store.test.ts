import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import {
  activateDocumentTab,
  activeDocumentTab,
  activeDocumentTabId,
  activeDocumentTabKind,
  clearActiveDocumentTab,
  closeDocumentTabsToRight,
  closeOtherDocumentTabs,
  configureDocumentListWorld,
  consumeCloseRequest,
  documentTabs,
  moveDocumentTab,
  pendingCloseRequests,
  requestCloseDocumentTab,
  resetDocumentTabsForTests,
  configureFileDocumentRoot,
  syncFileTabs,
  requestDocumentActivation,
} from "./document-tabs-store"
import { closeBrowserDocument, openBrowserDocument, resetBrowserDocumentsForTests, updateBrowserDocument } from "./browser-documents"
import { openChangeSetDocument, resetChangeSetDocumentsForTests, updateChangeSetDocument } from "./change-set-documents"
import { openSceneTab, resetSceneTabsForTests } from "./scene-tabs"
import { clearFileModels, saveFileModel } from "./file-documents"
import { closeFile, createEditorModel, markDirty, openFile } from "../editor-state"
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
  openBrowserDocument(`https://${id}.example`, { id, newTab: true, title: label })
}

beforeEach(() => {
  resetBrowserDocumentsForTests()
  clearFileModels()
  resetDocumentTabsForTests()
  resetDocumentListPersistenceForTests()
  resetChangeSetDocumentsForTests()
  resetSceneTabsForTests()
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

test("clearActiveDocumentTab drops only the matching active page tab", () => {
  configureDocumentListWorld("w")
  openSceneTab({ subject: { kind: "page", id: "triage" }, scope: { kind: "world", worldId: "w" } })
  activateDocumentTab("scene:page:triage")
  assert.equal(activeDocumentTabId(), "scene:page:triage")

  clearActiveDocumentTab("scene:world")
  assert.equal(activeDocumentTabId(), "scene:page:triage")

  clearActiveDocumentTab("scene:page:triage")
  assert.equal(activeDocumentTabId(), null)
})

test("clearActiveDocumentTab keeps a different pending activation", () => {
  syncFileTabs("C:/repo", [view("a.ts")])
  const fileId = documentTabs()[0]!.id
  activateDocumentTab(fileId)

  requestDocumentActivation("web:w1")
  clearActiveDocumentTab(fileId)
  assert.equal(activeDocumentTabId(), null)

  web("w1", "W")
  assert.equal(activeDocumentTabId(), "web:w1")
})

test("re-syncing identical tabs does not rewrite the strip", () => {
  syncFileTabs("C:/repo", [view("a.ts")])
  web("w1", "W")
  const first = documentTabs()

  syncFileTabs("C:/repo", [view("a.ts")])
  updateBrowserDocument("w1", { title: "W" })

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

  closeBrowserDocument("w1")

  assert.deepEqual(documentTabs().map((entry) => entry.kind), ["file"])
  assert.equal(activeDocumentTabId(), null)
})

test("file documents create and update file entries automatically", () => {
  configureFileDocumentRoot("C:/repo")
  const base = { ...createEditorModel(), root: "C:/repo" }
  let model = openFile(base, "a.ts", "A")
  saveFileModel("C:/repo", model)

  assert.deepEqual(documentTabs().map((entry) => entry.kind), ["file"])
  assert.equal(documentTabs()[0]!.view.label, "a.ts")

  model = markDirty(model, "a.ts")
  saveFileModel("C:/repo", model)
  assert.equal(documentTabs()[0]!.view.dirty, true)

  saveFileModel("C:/repo", closeFile(model, "a.ts"))
  assert.deepEqual(documentTabs(), [])
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

const changeSetBase = {
  source: { kind: "session" as const, sessionID: "s1", turnID: "m1", title: "14:32 修复登录" },
  root: "C:/repo",
  scope: { kind: "world" as const, worldId: "C:/repo" },
  files: [{
    file: "src/a.ts",
    patch: "@@ -1 +1 @@\n-a\n+b",
    additions: 1,
    deletions: 1,
  }],
}

test("change sets become active change-set tabs and are not persisted", () => {
  const storage = fakeStorage()
  configureDocumentListStorage(storage)
  configureDocumentListWorld("C:/repo")
  const doc = openChangeSetDocument(changeSetBase)
  requestDocumentActivation(doc.id)
  assert.deepEqual(documentTabs().map((entry) => entry.kind), ["changeset"])
  assert.equal(documentTabs()[0]!.id, doc.id)
  assert.equal(activeDocumentTabId(), doc.id)
  flushDocumentListPersistence()
  const saved = JSON.parse(storage.map.get(documentListStorageKey("C:/repo"))!)
  assert.deepEqual(saved.order, [])
})

test("a live change-set update does not steal the active file tab", () => {
  syncFileTabs("C:/repo", [view("a.ts")])
  const fileId = documentTabs()[0]!.id
  activateDocumentTab(fileId)
  const doc = openChangeSetDocument(changeSetBase)
  activateDocumentTab(fileId)
  updateChangeSetDocument(doc.id, { files: [{ file: "src/a.ts", patch: "@@ -1 +1 @@\n-a\n+c", additions: 1, deletions: 1 }] })
  assert.equal(activeDocumentTabId(), fileId)
})

test("opening the world tab later pins it before existing tabs", () => {
  syncFileTabs("C:/repo", [view("a.ts")])
  web("w1", "W")
  openSceneTab({
    subject: { kind: "world" },
    scope: { kind: "world", worldId: "C:/repo" },
    label: "世界总览",
  })
  assert.equal(documentTabs()[0]?.id, "scene:world")
  assert.deepEqual(documentTabs().slice(1).map((entry) => entry.kind), ["file", "web"])
})

test("scene tabs join the same strip; only world / Goal scenes persist", () => {
  const storage = fakeStorage()
  configureDocumentListStorage(storage)
  configureDocumentListWorld("C:/repo")
  openSceneTab({
    subject: { kind: "world" },
    scope: { kind: "world", worldId: "C:/repo" },
    label: "世界总览",
  })
  openSceneTab({
    subject: { kind: "terminal", id: "local" },
    scope: { kind: "world", worldId: "C:/repo" },
    label: "终端",
  })
  openSceneTab({
    subject: { kind: "goal", goalId: "g1" },
    scope: { kind: "goal", worldId: "C:/repo", goalId: "g1", revision: 2, worktreeDir: "C:/wt" },
    label: "Goal · 修复登录",
  })
  assert.deepEqual(documentTabs().map((entry) => entry.kind), ["scene", "scene", "scene"])
  moveDocumentTab("scene:goal:g1", "scene:world", "before")
  assert.deepEqual(documentTabs().map((entry) => entry.id), ["scene:world", "scene:goal:g1", "scene:terminal:local"])
  flushDocumentListPersistence()
  const saved = JSON.parse(storage.map.get(documentListStorageKey("C:/repo"))!) as { order: string[] }
  assert.deepEqual(saved.order, ["scene:world", "scene:goal:g1"])
})
