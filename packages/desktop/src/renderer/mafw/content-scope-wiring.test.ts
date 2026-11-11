import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8")
const shell = read("MafwShell.tsx")
const workbench = read("components/WorkbenchShell.tsx")
const header = read("components/ContentScopeHeader.tsx")
const css = read("mafw.css")

test("content workbench is rooted in an explicit scope, not the active session", () => {
  assert.match(shell, /const \[contentScope, setContentScope\] = createSignal<ContentScope \| null>/)
  assert.match(shell, /const contentRoot = createMemo\(\(\) =>/)
  assert.match(shell, /scopeAfterProjectChange/)
  assert.match(shell, /goalContentScope\(/)
  assert.match(shell, /diffsForContentScope/)
  assert.match(shell, /contentRoot=\{contentRoot\(\)\}/)
  assert.match(shell, /diffs=\{contentDiffEntries\(\)\}/)
  assert.doesNotMatch(shell, /const contentRoot = [^\n]*currentSessionID/)
})

test("the workbench always shows the current content scope", () => {
  assert.match(workbench, /ContentScopeHeader/)
  assert.match(workbench, /contentScopeLabel/)
  assert.match(workbench, /contentScopeIsGoal/)
  assert.match(workbench, /onReturnToProjectContent/)
  assert.match(header, /返回项目文件/)
  assert.match(header, /ButtonV2/)
  assert.doesNotMatch(header, /<button/)
  assert.doesNotMatch(header, /\stitle=/)
  assert.match(css, /\.mafw-content-scope\s*\{[^}]*var\(--/)
})
