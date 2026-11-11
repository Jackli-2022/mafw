import { test } from "node:test"
import assert from "node:assert/strict"
import {
  clearContentScopeStates,
  configureContentScopeStateStorage,
  contentScopeStateFor,
  emptyContentScopeState,
  flushContentScopeStatePersistence,
  rememberActiveFile,
  rememberReadingPosition,
  rememberSelection,
  saveContentScopeState,
  selectTreeFile,
  setTreeExpanded,
  toggleTreeExpanded,
} from "./content-scope-state"

function fakeStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    data,
  }
}

test("content scope state survives a renderer restart", () => {
  const io = fakeStorage()
  clearContentScopeStates()
  configureContentScopeStateStorage(io)

  let state = setTreeExpanded(emptyContentScopeState(), "docs", true)
  state = toggleTreeExpanded(state, "src")
  state = rememberActiveFile(state, "src/a.ts")
  state = selectTreeFile(state, "src/a.ts")
  state = rememberReadingPosition(state, "src/a.ts", 240)
  state = rememberSelection(state, "src/a.ts", { anchor: 3, head: 9 })
  state = { ...state, filesOpen: true }
  saveContentScopeState("project:c:/a", state)
  flushContentScopeStatePersistence("project:c:/a")

  clearContentScopeStates()
  configureContentScopeStateStorage(io)
  const restored = contentScopeStateFor("project:c:/a")
  assert.deepEqual(restored.treeExpanded, ["docs", "src"])
  assert.equal(restored.treeSelected, "src/a.ts")
  assert.deepEqual(restored.openFiles, ["src/a.ts"])
  assert.equal(restored.activeFile, "src/a.ts")
  assert.equal(restored.readingPositions["src/a.ts"], 240)
  assert.deepEqual(restored.selections["src/a.ts"], { anchor: 3, head: 9 })
  assert.equal(restored.filesOpen, true)
})

test("invalid persisted state falls back to empty without throwing", () => {
  const io = fakeStorage()
  io.data.set("mafw-content-state:project:c:/bad", "{not json")
  clearContentScopeStates()
  configureContentScopeStateStorage(io)
  assert.deepEqual(contentScopeStateFor("project:c:/bad"), emptyContentScopeState())
})

test("disabling storage keeps the in-memory behavior", () => {
  clearContentScopeStates()
  configureContentScopeStateStorage(null)
  saveContentScopeState("project:c:/a", rememberActiveFile(emptyContentScopeState(), "a.ts"))
  assert.deepEqual(contentScopeStateFor("project:c:/a").openFiles, ["a.ts"])
})
