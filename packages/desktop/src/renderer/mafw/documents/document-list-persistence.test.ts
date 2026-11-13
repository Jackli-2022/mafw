import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import {
  configureDocumentListStorage,
  documentListStorageKey,
  flushDocumentListPersistence,
  loadDocumentListSnapshot,
  resetDocumentListPersistenceForTests,
  saveDocumentListSnapshot,
} from "./document-list-persistence"

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
  }
}

beforeEach(() => resetDocumentListPersistenceForTests())

test("document order roundtrips per world", () => {
  const storage = fakeStorage()
  configureDocumentListStorage(storage)
  const world = "C:/repo"

  saveDocumentListSnapshot(world, {
    version: 1,
    order: ["web:browser-tab-1", "file:C:/repo\u0000AGENTS.md"],
    activeId: "web:browser-tab-1",
  })
  flushDocumentListPersistence()

  assert.deepEqual(loadDocumentListSnapshot(world), {
    version: 1,
    order: ["web:browser-tab-1", "file:C:/repo\u0000AGENTS.md"],
    activeId: "web:browser-tab-1",
  })
})

test("worlds are isolated", () => {
  const storage = fakeStorage()
  configureDocumentListStorage(storage)

  saveDocumentListSnapshot("world-a", { version: 1, order: ["a"], activeId: "a" })
  saveDocumentListSnapshot("world-b", { version: 1, order: ["b"], activeId: "b" })
  flushDocumentListPersistence()

  assert.deepEqual(loadDocumentListSnapshot("world-a").order, ["a"])
  assert.deepEqual(loadDocumentListSnapshot("world-b").order, ["b"])
  assert.notEqual(documentListStorageKey("world-a"), documentListStorageKey("world-b"))
})

test("corrupt or unknown snapshots load as empty", () => {
  const storage = fakeStorage()
  configureDocumentListStorage(storage)
  const key = documentListStorageKey("w")

  storage.setItem(key, "{not json")
  assert.deepEqual(loadDocumentListSnapshot("w").order, [])

  storage.setItem(key, JSON.stringify({ version: 2, order: ["x"], activeId: "x" }))
  assert.deepEqual(loadDocumentListSnapshot("w"), { version: 1, order: [], activeId: null })

  storage.setItem(key, JSON.stringify({ version: 1, order: ["x", 3, "x", null], activeId: "missing" }))
  assert.deepEqual(loadDocumentListSnapshot("w"), { version: 1, order: ["x"], activeId: null })
})

test("saving is debounced until flush", () => {
  const storage = fakeStorage()
  configureDocumentListStorage(storage)

  saveDocumentListSnapshot("w", { version: 1, order: ["a"], activeId: null })
  assert.equal(storage.map.size, 0)

  flushDocumentListPersistence()
  assert.equal(storage.map.size, 1)
  assert.deepEqual(loadDocumentListSnapshot("w").order, ["a"])
})

test("flush can target a single world", () => {
  const storage = fakeStorage()
  configureDocumentListStorage(storage)

  saveDocumentListSnapshot("a", { version: 1, order: ["a"], activeId: null })
  saveDocumentListSnapshot("b", { version: 1, order: ["b"], activeId: null })
  flushDocumentListPersistence("a")

  assert.deepEqual(loadDocumentListSnapshot("a").order, ["a"])
  assert.deepEqual(loadDocumentListSnapshot("b").order, [])
})
