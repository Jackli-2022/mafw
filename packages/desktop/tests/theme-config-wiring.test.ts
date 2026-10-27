import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("Config Desktop page carries an inline appearance section (no new NavKey)", () => {
  const config = read("src/renderer/mafw/pages/Config.tsx")
  const nav = read("src/renderer/mafw/pages/config-nav.ts")
  assert.match(config, /外观/)
  assert.match(config, /onToggleTheme/)
  assert.doesNotMatch(nav, /appearance/)
})

test("MafwShell threads theme into ConfigPage; rail keeps no theme wiring", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  const start = shell.indexOf("<ConfigPage")
  const block = shell.slice(start, shell.indexOf("/>", start))
  assert.match(block, /theme=/)
  assert.match(block, /onToggleTheme=\{toggleTheme\}/)
  const railStart = shell.indexOf("<IconRail")
  const railBlock = shell.slice(railStart, shell.indexOf("/>", railStart))
  assert.doesNotMatch(railBlock, /onToggleTheme|theme=/)
})

test("ChatPane /theme command survives the move", () => {
  const chat = read("src/renderer/mafw/components/ChatPane.tsx")
  assert.match(chat, /id: "theme"/)
  assert.match(chat, /onToggleTheme/)
})
