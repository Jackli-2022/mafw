import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")

test("ConfigPage has a compact section picker and hides the left nav", () => {
  const page = read("Config.tsx")
  const css = read("../mafw.css")
  assert.match(page, /compact\?: boolean/)
  assert.match(page, /class="mafw-config-layout"/)
  assert.match(page, /classList=\{\{ "is-compact": !!props\.compact \}\}/)
  assert.match(page, /class="mafw-config-compact-nav"/)
  assert.match(page, /SelectV2/)
  assert.match(css, /\.mafw-config-layout\.is-compact \.mafw-config-nav \{\s*display: none;/)
  assert.doesNotMatch(page, /props\.onBack/)
})

test("MafwShell opens config in the dock and dispatches the section event", () => {
  const shell = read("../MafwShell.tsx")
  assert.match(shell, /const openConfigPage = \(section\?: NavKey\) =>/)
  assert.match(shell, /setConfigSection\(section\)/)
  assert.match(shell, /openPageFocus\("config"\)/)
  assert.match(shell, /requestAnimationFrame\(\(\) => window\.dispatchEvent\(new CustomEvent\("mafw:open-config"/)
  assert.match(shell, /onConfig=\{\(\) => openConfigPage\(\)\}/)
  assert.match(shell, /onOpenUsage=\{\(\) => openConfigPage\("usage"\)\}/)
  assert.match(shell, /onOpenSettings=\{\(\) => openConfigPage\(\)\}/)
  assert.doesNotMatch(shell, /showConfig/)
  assert.doesNotMatch(shell, /<ConfigPage onBack=/)
})

test("renderPage owns ConfigPage and keeps the normalized project dir", () => {
  const shell = read("../MafwShell.tsx")
  assert.match(shell, /case "config":\s*\n\s*return <ConfigPage compact /)
  assert.match(shell, /projectDir=\{benchRoot\(\) \?\? undefined\}/)
})
