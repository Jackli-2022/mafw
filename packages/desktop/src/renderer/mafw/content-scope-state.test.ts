import { test } from "node:test"
import assert from "node:assert/strict"
import {
  clearContentScopeStates,
  contentScopeStateFor,
  emptyContentScopeState,
  onContentScopeStateChange,
  readingPositionFor,
  rememberActiveFile,
  rememberOpenFile,
  rememberReadingPosition,
  rememberSelection,
  saveContentScopeState,
  selectTreeFile,
  selectionFor,
  setTreeExpanded,
  toggleTreeExpanded,
  updateContentScopeState,
} from "./content-scope-state"

test("scope state is isolated by scope key", () => {
  clearContentScopeStates()
  updateContentScopeState("project:c:/a", (state) => rememberOpenFile(state, "src/a.ts"))
  assert.deepEqual(contentScopeStateFor("project:c:/a").openFiles, ["src/a.ts"])
  assert.deepEqual(contentScopeStateFor("project:d:/b").openFiles, [])
})

test("tree expand/toggle/select are pure and idempotent", () => {
  let state = setTreeExpanded(emptyContentScopeState(), "src", true)
  state = setTreeExpanded(state, "src", true)
  assert.deepEqual(state.treeExpanded, ["src"])
  state = toggleTreeExpanded(state, "src")
  assert.deepEqual(state.treeExpanded, [])
  state = selectTreeFile(state, "src/a.ts")
  assert.equal(state.treeSelected, "src/a.ts")
  state = selectTreeFile(state, null)
  assert.equal(state.treeSelected, null)
})

test("open files dedupe and active file is added when missing", () => {
  let state = rememberOpenFile(emptyContentScopeState(), "src/a.ts")
  state = rememberOpenFile(state, "src/a.ts")
  assert.deepEqual(state.openFiles, ["src/a.ts"])
  state = rememberActiveFile(state, "src/b.ts")
  assert.equal(state.activeFile, "src/b.ts")
  assert.deepEqual(state.openFiles, ["src/a.ts", "src/b.ts"])
})

test("reading position is clamped and nullable", () => {
  let state = rememberReadingPosition(emptyContentScopeState(), "src/a.ts", 120)
  assert.equal(readingPositionFor(state, "src/a.ts"), 120)
  state = rememberReadingPosition(state, "src/a.ts", -5)
  assert.equal(readingPositionFor(state, "src/a.ts"), 0)
  assert.equal(readingPositionFor(state, "src/missing.ts"), null)
})

test("saving null key is a no-op and returns empty", () => {
  clearContentScopeStates()
  saveContentScopeState(null, rememberOpenFile(emptyContentScopeState(), "a.ts"))
  assert.deepEqual(contentScopeStateFor(null).openFiles, [])
})

test("editor selection is stored per file and can be cleared", () => {
  let state = rememberSelection(emptyContentScopeState(), "src/a.ts", { anchor: 10, head: 12 })
  assert.deepEqual(selectionFor(state, "src/a.ts"), { anchor: 10, head: 12 })
  state = rememberSelection(state, "src/a.ts", { anchor: -3, head: 5.4 })
  assert.deepEqual(selectionFor(state, "src/a.ts"), { anchor: 0, head: 5 })
  state = rememberSelection(state, "src/a.ts", null)
  assert.equal(selectionFor(state, "src/a.ts"), null)
})

test("scope listeners fire on save and stop after unsubscribe", () => {
  clearContentScopeStates()
  const seen: string[] = []
  const off = onContentScopeStateChange((key) => seen.push(key))
  saveContentScopeState("project:c:/a", emptyContentScopeState())
  off()
  saveContentScopeState("project:d:/b", emptyContentScopeState())
  assert.deepEqual(seen, ["project:c:/a"])
})
