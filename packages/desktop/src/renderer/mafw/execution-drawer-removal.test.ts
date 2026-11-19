import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")
const shell = read("MafwShell.tsx")
const chat = read("components/ChatPane.tsx")
const shellUi = read("components/WorkbenchShell.tsx")

test("ChatPane hosts background runs inline", () => {
  assert.match(chat, /BackgroundDock/)
  assert.match(chat, /runsOpen/)
  assert.match(chat, /mafw-chat-runs/)
})

test("the execution drawer is gone", () => {
  for (const source of [shell, shellUi]) {
    assert.doesNotMatch(source, /ExecutionView|executionOpen|executionSection|openExecutionDrawer|applyExecutionSection|applyExecutionOpen|mafw-rw-exec-drawer/)
  }
})

test("usage opens the config usage page", () => {
  assert.match(shell, /openConfigPage\("usage"\)/)
})
