import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const shell = readFileSync(new URL("./MafwShell.tsx", import.meta.url), "utf8")

test("content scope is derived from focus", () => {
  assert.match(shell, /const contentScope = createMemo<ContentScope \| null>/)
  assert.match(shell, /contentScopeFromFocus\(focus\.scope\)/)
  assert.doesNotMatch(shell, /content-scope-persistence/)
  assert.doesNotMatch(shell, /contentHistory|rememberContentLocation|backContent|contentReturnGoalId/)
})

test("editor intent is derived from the focus lens", () => {
  assert.match(shell, /activeFocus\(\)\?\.lens === "edit" \? "editing" : "reading"/)
  assert.doesNotMatch(shell, /const \[contentIntent, setContentIntent\]/)
})
