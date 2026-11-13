import { test } from "node:test"
import assert from "node:assert/strict"
import {
  closeOtherTabIds,
  closeRightTabIds,
  documentTabViews,
  fileDocumentTabId,
  mergeDocumentTabs,
  moveDocumentTab,
  nextDocumentTabId,
  pinWorldTabFirst,
  syncKindEntries,
  webDocumentTabId,
  WORLD_SCENE_TAB_ID,
  type DocumentTabEntry,
} from "./document-tabs-model"

const view = (id: string, label = id, extra: Record<string, unknown> = {}) => ({
  id,
  label,
  icon: "file" as const,
  active: false,
  ...extra,
})

const file = (id: string, label = id): DocumentTabEntry => ({
  id: fileDocumentTabId("C:/repo", id),
  kind: "file",
  view: view(id, label),
})

const web = (id: string, label = id): DocumentTabEntry => ({
  id: webDocumentTabId(id),
  kind: "web",
  view: view(id, label, { icon: "globe" as const }),
})

test("file ids include the root so equal rel paths cannot collide", () => {
  assert.notEqual(
    fileDocumentTabId("C:/repo", "src/a.ts"),
    fileDocumentTabId("C:/worktree", "src/a.ts"),
  )
  assert.match(fileDocumentTabId("C:/repo", "src/a.ts"), /^file:C:\/repo\u0000src\/a\.ts$/)
  assert.equal(webDocumentTabId("tab-1"), "web:tab-1")
})

test("merge keeps previous order, updates views and appends new ids", () => {
  const a = file("a.ts")
  const b = web("b")
  const c = file("c.ts")

  const merged = mergeDocumentTabs([a, b], [
    { ...a, view: view("a.ts", "a.ts", { dirty: true }) },
    b,
    c,
  ])

  assert.deepEqual(merged.map((entry) => entry.id), [a.id, b.id, c.id])
  assert.equal(merged[0]!.view.dirty, true)
})

test("merge drops ids missing from the incoming list", () => {
  const a = file("a.ts")
  const b = web("b")
  assert.deepEqual(mergeDocumentTabs([a, b], [b]).map((entry) => entry.id), [b.id])
})

test("syncing one kind preserves the other kind's positions", () => {
  const a = file("a.ts")
  const b = web("b")
  const c = file("c.ts")
  const d = web("d")

  const merged = syncKindEntries([a, b, c], "web", [d])

  assert.deepEqual(merged.map((entry) => entry.id), [a.id, c.id, d.id])
})

test("syncing a file root removes stale files but keeps web tabs", () => {
  const a = file("a.ts")
  const b = web("b")
  const c = file("c.ts")
  const next = { ...file("a.ts"), view: view("a.ts", "a.ts", { dirty: true }) }

  const merged = syncKindEntries([a, b, c], "file", [next])

  assert.deepEqual(merged.map((entry) => entry.id), [a.id, b.id])
  assert.equal(merged[0]!.view.dirty, true)
})

test("next active picks left neighbor, then right, then null", () => {
  const a = file("a.ts")
  const b = file("b.ts")
  const c = file("c.ts")
  const entries = [a, b, c]

  assert.equal(nextDocumentTabId(entries, b.id, b.id), a.id)
  assert.equal(nextDocumentTabId(entries, a.id, a.id), b.id)
  assert.equal(nextDocumentTabId(entries, c.id, c.id), b.id)
  assert.equal(nextDocumentTabId([a], a.id, a.id), null)
  assert.equal(nextDocumentTabId(entries, b.id, c.id), c.id)
})

test("close targets follow the clicked tab", () => {
  const a = file("a.ts")
  const b = web("b")
  const c = file("c.ts")
  const entries = [a, b, c]

  assert.deepEqual(closeOtherTabIds(entries, b.id), [a.id, c.id])
  assert.deepEqual(closeRightTabIds(entries, b.id), [c.id])
  assert.deepEqual(closeRightTabIds(entries, c.id), [])
})

test("moveDocumentTab places before or after the target across kinds", () => {
  const a = file("a.ts")
  const b = web("b")
  const c = file("c.ts")
  const entries = [a, b, c]

  assert.deepEqual(
    moveDocumentTab(entries, a.id, c.id, "before").map((entry) => entry.id),
    [b.id, a.id, c.id],
  )
  assert.deepEqual(
    moveDocumentTab(entries, a.id, c.id, "after").map((entry) => entry.id),
    [b.id, c.id, a.id],
  )
  assert.deepEqual(
    moveDocumentTab(entries, c.id, a.id, "before").map((entry) => entry.id),
    [c.id, a.id, b.id],
  )
  assert.deepEqual(
    moveDocumentTab(entries, c.id, a.id, "after").map((entry) => entry.id),
    [a.id, c.id, b.id],
  )
  assert.equal(moveDocumentTab(entries, a.id, a.id, "before"), entries)
  assert.equal(moveDocumentTab(entries, "missing", a.id, "before"), entries)
})

test("documentTabViews marks only the active id and keeps unified ids", () => {
  const a = file("a.ts")
  const b = web("b")
  const views = documentTabViews([a, b], b.id)

  assert.deepEqual(views.map((entry) => entry.id), [a.id, b.id])
  assert.deepEqual(views.map((entry) => entry.active), [false, true])
  assert.deepEqual(views.map((entry) => entry.icon), ["file", "globe"])
})

test("the world tab is pinned to the front", () => {
  const world: DocumentTabEntry = {
    id: WORLD_SCENE_TAB_ID,
    kind: "scene",
    view: view("世界总览", "世界总览", { icon: "world" as const }),
  }
  const a = file("a.ts")
  const b = web("b")

  assert.deepEqual(pinWorldTabFirst([a, b, world]).map((entry) => entry.id), [world.id, a.id, b.id])
  assert.deepEqual(pinWorldTabFirst([world, a, b]).map((entry) => entry.id), [world.id, a.id, b.id])
  assert.deepEqual(pinWorldTabFirst([a, b]).map((entry) => entry.id), [a.id, b.id])
})
