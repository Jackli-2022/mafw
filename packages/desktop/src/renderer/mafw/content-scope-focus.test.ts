import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const shell = readFileSync(new URL("./MafwShell.tsx", import.meta.url), "utf8")

test("content scope is derived from focus", () => {
  assert.match(shell, /const contentScope = createMemo<ContentScope \| null>/)
  assert.match(shell, /contentScopeFromFocus\(focus\.scope\)/)
  assert.match(shell, /configureEditorDraftStorage\(window\.localStorage\)/)
  assert.match(shell, /configureContentScopeStateStorage\(window\.localStorage\)/)
  assert.doesNotMatch(shell, /content-scope-persistence/)
  assert.doesNotMatch(shell, /contentHistory|rememberContentLocation|backContent|contentReturnGoalId/)
})

test("editor no longer has a reading/editing intent", () => {
  assert.doesNotMatch(shell, /activeFocus\(\)\?\.lens === "edit"/)
  assert.doesNotMatch(shell, /const \[contentIntent, setContentIntent\]/)
})
