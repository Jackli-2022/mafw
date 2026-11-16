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

test("chat reading leading is 1.6 for assistant and user text", () => {
  assert.match(css, /\.mafw-chat\s*\{[^}]*--mafw-chat-leading:\s*1\.6/)
  assert.match(
    css,
    /\.mafw-shell \[data-component="text-part"\] \[data-component="markdown"\]\s*\{[^}]*line-height:\s*var\(--mafw-chat-leading,\s*1\.6\)/,
  )
  assert.match(
    css,
    /\[data-slot="user-message-text"\]\s*\{[^}]*line-height:\s*var\(--mafw-chat-leading,\s*1\.6\)/,
  )
})

test("thinking summary sits 12px above the answer", () => {
  assert.match(
    css,
    /\.mafw-session-turn-container \.mafw-thinking\s*\{[^}]*margin-bottom:\s*0/,
  )
  assert.match(
    css,
    /\.mafw-session-turn-container \.mafw-thinking \+ \[data-component="text-part"\]\s*\{[^}]*margin-top:\s*0/,
  )
})
