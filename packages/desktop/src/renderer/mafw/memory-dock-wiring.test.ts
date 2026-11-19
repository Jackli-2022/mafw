import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")

test("Memory opens as a right-workbench focus, not a main-area tab", () => {
  const shell = read("MafwShell.tsx")
  assert.match(shell, /const openMemoryFocus = \(\) =>/)
  assert.match(shell, /subject: \{ kind: "memory" \}/)
  assert.match(shell, /onOpenMemory=\{openMemoryFocus\}/)
  assert.match(shell, /renderMemory=\{\(\) => <MemoryPage compact \/>\}/)
  assert.match(shell, /subject\.kind === "memory" \? "项目" : focusScopeLabel\(focus\.scope\)/)
  assert.match(shell, /id: "memory", label: "记忆", hint: "Memory", group: "导航"/)
  assert.match(shell, /run: \(\) => openMemoryFocus\(\)/)
  assert.doesNotMatch(shell, /nav\("memory"/)
  assert.doesNotMatch(shell, /setActiveTab\("memory"\)/)
  assert.doesNotMatch(shell, /activeTab\(\) === "memory"/)
})

test("FocusStage renders the memory subject through a renderMemory slot", () => {
  const stage = read("components/FocusStage.tsx")
  assert.match(stage, /renderMemory\?: \(\) => JSX\.Element/)
  assert.match(stage, /kind\(\) === "memory"/)
  assert.match(stage, /props\.renderMemory\?\.\(\)/)
})

test("MemoryPage has a compact dock mode without the page header", () => {
  const page = read("pages/Memory.tsx")
  assert.match(page, /compact\?: boolean/)
  assert.match(page, /mafw-memory-page/)
  assert.match(page, /when=\{!props\.compact\}/)
})
