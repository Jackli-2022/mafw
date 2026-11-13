import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import {
  activateDocumentTab,
  activeDocumentTab,
  activeDocumentTabId,
  activeDocumentTabKind,
  closeDocumentTabsToRight,
  closeOtherDocumentTabs,
  consumeCloseRequest,
  documentTabs,
  pendingCloseRequests,
  requestCloseDocumentTab,
  resetDocumentTabsForTests,
  syncFileTabs,
  syncWebTabs,
} from "./document-tabs-store"
import type { DocumentTabView } from "../document-frame-model"

const view = (id: string, label = id, extra: Partial<DocumentTabView> = {}): DocumentTabView => ({
  id,
  label,
  icon: "file",
  active: false,
  ...extra,
})

beforeEach(() => resetDocumentTabsForTests())

test("file and web tabs merge into one stable strip", () => {
  syncFileTabs("C:/repo", [view("a.ts")])
  syncWebTabs([view("w1", "Example", { icon: "globe" })])

  assert.deepEqual(documentTabs().map((entry) => entry.kind), ["file", "web"])
  assert.deepEqual(documentTabs().map((entry) => entry.view.label), ["a.ts", "Example"])

  syncFileTabs("C:/repo", [view("a.ts", "a.ts", { dirty: true })])
  assert.equal(documentTabs()[0]!.view.dirty, true)
  assert.deepEqual(documentTabs().map((entry) => entry.kind), ["file", "web"])
})

test("removing files leaves web tabs and keeps their order", () => {
  syncFileTabs("C:/repo", [view("a.ts"), view("b.ts")])
  syncWebTabs([view("w1", "W", { icon: "globe" })])
  syncFileTabs("C:/repo", [])

  assert.deepEqual(documentTabs().map((entry) => entry.kind), ["web"])
  assert.equal(documentTabs()[0]!.view.label, "W")
})

test("a different root replaces stale file tabs but not web tabs", () => {
  syncFileTabs("C:/repo", [view("a.ts")])
  syncWebTabs([view("w1", "W", { icon: "globe" })])
  syncFileTabs("C:/worktree", [view("a.ts")])

  const files = documentTabs().filter((entry) => entry.kind === "file")
  assert.equal(files.length, 1)
  assert.match(files[0]!.id, /worktree/)
  assert.equal(documentTabs().filter((entry) => entry.kind === "web").length, 1)
})

test("activate sets active id and kind; unknown ids are ignored", () => {
  syncFileTabs("C:/repo", [view("a.ts")])
  syncWebTabs([view("w1", "W", { icon: "globe" })])
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
  syncWebTabs([view("w1", "W", { icon: "globe" })])
  const first = documentTabs()

  syncFileTabs("C:/repo", [view("a.ts")])
  syncWebTabs([view("w1", "W", { icon: "globe" })])

  assert.equal(documentTabs(), first)
})

test("activeDocumentTab returns the active entry", () => {
  syncFileTabs("C:/repo", [view("a.ts")])
  const id = documentTabs()[0]!.id
  activateDocumentTab(id)
  assert.equal(activeDocumentTab()?.id, id)
  assert.equal(activeDocumentTab()?.kind, "file")
})

test("close requests are deduped and consumed exactly once", () => {
  syncFileTabs("C:/repo", [view("a.ts")])
  syncWebTabs([view("w1", "W", { icon: "globe" })])
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
  syncWebTabs([view("w1", "W", { icon: "globe" })])
  const [a, b, w] = documentTabs().map((entry) => entry.id)

  closeOtherDocumentTabs(b!)
  assert.deepEqual(pendingCloseRequests(), [a, w])

  consumeCloseRequest(a!)
  consumeCloseRequest(w!)
  closeDocumentTabsToRight(b!)
  assert.deepEqual(pendingCloseRequests(), [w])
})
