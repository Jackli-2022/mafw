import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const bar = read("src/renderer/mafw/components/ChatModeBar.tsx")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const css = read("src/renderer/mafw/chat-mode-bar.css")

test("ChatModeBar renders four mode chips with v2 controls", () => {
  assert.match(bar, /mafw-chat-mode-bar/)
  assert.match(bar, /CHAT_MODE_ITEMS/)
  assert.match(bar, /ButtonV2/)
  assert.match(bar, /TooltipV2/)
  assert.match(bar, /openDelay=\{300\}/)
  assert.match(bar, /aria-pressed=\{props\.mode === item\.id\}/)
  assert.doesNotMatch(bar, /<button/)
})

test("ChatPane owns the transient composer mode", () => {
  assert.match(chat, /ChatModeBar/)
  assert.match(chat, /composerMode/)
  assert.match(chat, /modeActionLabel/)
  assert.match(chat, /composerActionEnabled/)
  assert.match(chat, /canDelegate\?: \(\) => boolean/)
  assert.match(chat, /canResolve\?: \(\) => boolean/)
  assert.match(chat, /onDelegateDraft\?:/)
  assert.match(chat, /onResolveRequest\?:/)
})

test("MafwShell supplies delegate and resolve availability", () => {
  assert.match(shell, /canDelegate=\{/)
  assert.match(shell, /canResolve=\{/)
  assert.match(shell, /onDelegateDraft=\{/)
  assert.match(shell, /onResolveRequest=\{/)
})

test("mode bar CSS uses tokens and stays in flow", () => {
  assert.match(css, /\.mafw-chat-mode-bar/)
  assert.match(css, /var\(--/)
  assert.doesNotMatch(css, /position:\s*absolute/)
})
