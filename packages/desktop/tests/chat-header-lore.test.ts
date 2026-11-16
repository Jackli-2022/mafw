import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")
const css = read("src/renderer/mafw/mafw.css")

test("chat header uses the Lore avatar and name", () => {
  assert.match(chat, /lead-avatar-20\.png/)
  assert.match(chat, /mafw-agent-avatar-lore/)
  assert.match(chat, /mafw-session-titlebar-name">Lore/)
  assert.match(chat, /<span class="mafw-session-titlebar-text">\{title\(\)\}<\/span>/)
})

test("narrow header keeps Lore and hides the redundant title", () => {
  assert.match(css, /\.mafw-session-titlebar-name\b/)
  const start = css.indexOf("@container (max-width: 700px)")
  assert.ok(start >= 0)
  const block = css.slice(start, css.indexOf("}", start))
  assert.match(block, /\.mafw-session-titlebar-text/)
  assert.doesNotMatch(block, /\.mafw-session-titlebar-name\s*,/)
})
