import { test } from "node:test"
import assert from "node:assert/strict"
import {
  clearContentScopeStates,
  contentScopeStateFor,
  emptyContentScopeState,
  readingPositionFor,
  rememberActiveFile,
  rememberOpenFile,
  rememberReadingPosition,
  saveContentScopeState,
  selectTreeFile,
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
