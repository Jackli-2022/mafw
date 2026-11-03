import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const css = readFileSync(new URL("./mafw.css", import.meta.url), "utf8")
const theme = readFileSync(new URL("../../../../ui/src/styles/theme.css", import.meta.url), "utf8")

test("chat reading and composer typography use explicit 16px tokens", () => {
  assert.match(css, /\.mafw-chat\s*\{[^}]*--mafw-chat-reading:\s*16px/)
  assert.match(css, /\.mafw-chat\s*\{[^}]*--mafw-chat-composer:\s*16px/)
  assert.match(css, /font-size:\s*var\(--mafw-chat-reading,\s*16px\)/)
  assert.match(
    css,
    /\.mafw-composer[^{]*\.mafw-input[^{]*\[data-slot="textarea-v2-textarea"\][^{]*\{[^}]*font-size:\s*var\(--mafw-chat-composer,\s*16px\)/,
  )
  assert.match(
    css,
    /\.mafw-composer[^{]*\.mafw-input[^{]*\[data-slot="textarea-v2-textarea"\][^{]*\{[^}]*max-height:\s*220px/,
  )
})

test("the global UI base font remains 14px", () => {
  assert.match(theme, /--font-size-base:\s*14px/)
  assert.doesNotMatch(css, /\.mafw-shell,\s*body\s*\{[^}]*--mafw-chat-reading/)
})
