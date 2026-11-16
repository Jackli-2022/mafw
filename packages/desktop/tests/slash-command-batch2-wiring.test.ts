import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")
const renameDialog = read("src/renderer/mafw/components/RenameSessionDialog.tsx")
const helpOverlay = read("src/renderer/mafw/components/ChatHelpOverlay.tsx")
const css = read("src/renderer/mafw/mafw.css")

const commandBlock = (id: string) => {
  const start = chat.indexOf(`id: "${id}"`)
  assert.ok(start >= 0, `missing command ${id}`)
  const end = chat.indexOf("\n      },", start)
  assert.ok(end > start, `unterminated command ${id}`)
  return chat.slice(start, end)
}

test("rename command opens the dialog and writes through sessions.rename", () => {
  assert.match(chat, /trigger: "\/rename"/)
  assert.match(commandBlock("rename"), /setRenameOpen\(true\)/)
  assert.match(chat, /<RenameSessionDialog/)
  assert.match(chat, /initialTitle=\{title\(\)\}/)
  assert.match(chat, /sessions\.rename\(sid, title\)/)
  assert.match(renameDialog, /TextInputV2/)
  assert.match(renameDialog, /ButtonV2/)
  assert.doesNotMatch(renameDialog, /<button/)
  assert.doesNotMatch(renameDialog, /<input/)
})

test("help command opens the overlay with commands and keybindings", () => {
  assert.match(chat, /trigger: "\/help"/)
  assert.match(commandBlock("help"), /setHelpOpen\(true\)/)
  assert.match(chat, /<ChatHelpOverlay/)
  assert.match(chat, /commands=\{cmdItems\(\)\.filter\(c => c\.group === "local"\)\}/)
  assert.match(helpOverlay, /allKeybindings/)
  assert.match(helpOverlay, /formatCombo/)
  assert.match(helpOverlay, /ButtonV2/)
  assert.doesNotMatch(helpOverlay, /<button/)
  assert.match(css, /\.mafw-help-backdrop/)
  assert.match(css, /\.mafw-help \{/)
})
