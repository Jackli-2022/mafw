import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const api = read("src/preload/mafw-api.ts")
const types = read("src/preload/mafw-types.ts")

const commandBlock = (id: string) => {
  const start = chat.indexOf(`id: "${id}"`)
  assert.ok(start >= 0, `missing command ${id}`)
  const end = chat.indexOf('id: "', start + 1)
  return chat.slice(start, end > start ? end : undefined)
}

test("preload exposes session summarize", () => {
  assert.match(types, /summarize: \(sessionID: string\) => Promise<void>/)
  assert.match(
    api,
    /summarize: \(sessionID\) => invoke\("session", "summarize", \{ path: \{ id: sessionID \}, body: \{\} \}\)/,
  )
})

test("local commands clear composer state before running", () => {
  assert.match(
    chat,
    /const runLocalCommand = \(run: \(\) => void\) => \{[\s\S]{0,240}?setInput\(""\)[\s\S]{0,240}?clearDraft\(sidProp\(\)\)[\s\S]{0,240}?closeCommandPicker\(\)[\s\S]{0,120}?run\(\)/,
  )
  assert.match(chat, /if \(item\.run\) \{ runLocalCommand\(item\.run\); return \}/)
})

test("session commands are wired", () => {
  for (const trigger of ["/compact", "/export", "/fork"]) {
    assert.match(chat, new RegExp(`trigger: "${trigger}"`))
  }

  const compact = commandBlock("compact")
  assert.match(compact, /sessions\.summarize\(sid\)/)
  assert.match(compact, /if \(!sid\) return/)
  assert.ok(
    compact.indexOf("sessionBusy()") < compact.indexOf("sessions.summarize"),
    "compact must guard a busy turn before calling summarize",
  )

  assert.match(chat, /props\.onExportCurrentSession/)
  assert.match(chat, /props\.onForkCurrentSession/)
  assert.match(shell, /onExportCurrentSession=\{/)
  assert.match(shell, /if \(sid\) void exportSession\(sid\)/)
  assert.match(shell, /onForkCurrentSession=\{/)
  assert.match(shell, /if \(sid\) void forkSessionFromMenu\(sid\)/)
})
