import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createWorkbenchState,
  openSubject,
  updatePlace,
  type Scope,
  type SubjectRef,
} from "./focus-model"
import {
  clearFocusPersistence,
  configureFocusStorage,
  flushFocusPersistence,
  loadFocusState,
  resetFocusPersistence,
  saveFocusState,
} from "./focus-persistence"

function fakeStorage() {
  const data = new Map<string, string>()
  let writes = 0
  return {
    data,
    get writes() {
      return writes
    },
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes += 1
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
  }
}

const worldScope: Scope = { kind: "world", worldId: "w1" }
const file: SubjectRef = { kind: "file", root: "C:/repo", rel: "src/a.ts" }
const file2: SubjectRef = { kind: "file", root: "C:/repo", rel: "src/b.ts" }

test("focus state round-trips per world", () => {
  const io = fakeStorage()
  resetFocusPersistence()
  configureFocusStorage(io)

  let state = openSubject(createWorkbenchState("w1"), worldScope, file)
  state = updatePlace(state, { scroll: 42, selection: { anchor: 1, head: 5 } })
  state = { ...state, kept: [file] }
  saveFocusState(state)
  flushFocusPersistence("w1")

  resetFocusPersistence()
  configureFocusStorage(io)
  const loaded = loadFocusState("w1")
  assert.ok(loaded)
  assert.equal(loaded.stack.length, 1)
  assert.equal(loaded.stack[0]!.lens, "read")
  assert.equal(loaded.stack[0]!.place.scroll, 42)
  assert.deepEqual(loaded.stack[0]!.place.selection, { anchor: 1, head: 5 })
  assert.equal(loaded.kept.length, 1)
})

test("invalid or partial payload falls back to null", () => {
  const io = fakeStorage()
  io.data.set("mafw-focus:v1:w1", "{not json")
  resetFocusPersistence()
  configureFocusStorage(io)
  assert.equal(loadFocusState("w1"), null)

  io.data.set("mafw-focus:v1:w2", JSON.stringify({ v: 2, stack: [], kept: [] }))
  assert.equal(loadFocusState("w2"), null)

  io.data.set("mafw-focus:v1:w3", JSON.stringify({
    v: 1,
    stack: [
      {
        scope: { kind: "world", worldId: "w3" },
        subject: { kind: "file", root: "C:/repo", rel: "src/a.ts" },
        lens: "read",
        place: {},
      },
      { bad: true },
    ],
    kept: [{ kind: "file", root: "C:/repo", rel: "src/a.ts" }, { bad: true }],
  }))
  const partial = loadFocusState("w3")
  assert.ok(partial)
  assert.equal(partial.stack.length, 1)
  assert.equal(partial.kept.length, 1)
})

test("debounced writes flush on demand", () => {
  const io = fakeStorage()
  resetFocusPersistence()
  configureFocusStorage(io)

  const state = openSubject(createWorkbenchState("w1"), worldScope, file)
  saveFocusState(state)
  assert.equal(io.writes, 0)
  flushFocusPersistence("w1")
  assert.equal(io.writes, 1)
  assert.ok(io.data.get("mafw-focus:v1:w1"))
})

test("no storage keeps the in-memory behavior", () => {
  resetFocusPersistence()
  configureFocusStorage(null)
  const state = openSubject(createWorkbenchState("w1"), worldScope, file)
  saveFocusState(state)
  assert.equal(loadFocusState("w1")?.stack.length, 1)
  assert.doesNotThrow(() => flushFocusPersistence("w1"))
})

test("stack and kept lists are capped", () => {
  const io = fakeStorage()
  resetFocusPersistence()
  configureFocusStorage(io)

  let state = createWorkbenchState("w1")
  for (let i = 0; i < 60; i += 1) {
    state = openSubject(state, worldScope, { kind: "file", root: "C:/repo", rel: `src/${i}.ts` })
  }
  state = {
    ...state,
    kept: Array.from({ length: 30 }, (_, i) => ({ kind: "file", root: "C:/repo", rel: `kept/${i}.ts` })),
  }
  saveFocusState(state)
  flushFocusPersistence("w1")

  resetFocusPersistence()
  configureFocusStorage(io)
  const loaded = loadFocusState("w1")
  assert.ok(loaded)
  assert.equal(loaded.stack.length, 50)
  assert.equal(loaded.kept.length, 20)
})

test("clearing persistence removes loaded keys from storage", () => {
  const io = fakeStorage()
  resetFocusPersistence()
  configureFocusStorage(io)
  const state = openSubject(createWorkbenchState("w1"), worldScope, file)
  saveFocusState(state)
  flushFocusPersistence("w1")
  assert.ok(io.data.has("mafw-focus:v1:w1"))

  clearFocusPersistence()
  assert.equal(io.data.has("mafw-focus:v1:w1"), false)

  configureFocusStorage(io)
  assert.equal(loadFocusState("w1"), null)
})

test("worlds do not share stacks", () => {
  const io = fakeStorage()
  resetFocusPersistence()
  configureFocusStorage(io)

  const w1 = openSubject(createWorkbenchState("w1"), worldScope, file)
  const w2Scope: Scope = { kind: "world", worldId: "w2" }
  const w2 = openSubject(createWorkbenchState("w2"), w2Scope, file2)
  saveFocusState(w1)
  saveFocusState(w2)
  flushFocusPersistence()

  resetFocusPersistence()
  configureFocusStorage(io)
  assert.equal((loadFocusState("w1")?.stack[0]!.subject as { rel: string }).rel, "src/a.ts")
  assert.equal((loadFocusState("w2")?.stack[0]!.subject as { rel: string }).rel, "src/b.ts")
})

test("drops the retired split subject from loaded places", () => {
  const io = fakeStorage()
  io.data.set("mafw-focus:v1:w1", JSON.stringify({
    v: 1,
    stack: [{
      scope: { kind: "world", worldId: "w1" },
      subject: { kind: "file", root: "C:/repo", rel: "src/a.ts" },
      lens: "read",
      place: {
        scroll: 10,
        split: { kind: "file", root: "C:/repo", rel: "src/b.ts" },
      },
    }],
    kept: [],
  }))
  resetFocusPersistence()
  configureFocusStorage(io)
  const loaded = loadFocusState("w1")
  assert.ok(loaded)
  assert.equal(loaded.stack[0]!.place.scroll, 10)
  assert.equal("split" in loaded.stack[0]!.place, false)
})
