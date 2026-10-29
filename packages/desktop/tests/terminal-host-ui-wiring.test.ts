import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (file: string) =>
  readFileSync(join(import.meta.dirname, "..", "src", "renderer", "mafw", "components", file), "utf8")

test("host drawer is props-driven and groups hosts", () => {
  const src = read("TerminalHostDrawer.tsx")
  assert.match(src, /groupHosts/)
  assert.match(src, /onNewSession/)
  assert.match(src, /onRemove/)
  assert.match(src, /onConnect/)
  assert.doesNotMatch(src, /window\.api/)
  assert.doesNotMatch(src, /localStorage/)
  assert.doesNotMatch(src, /<button[\s>]/)
})

test("host dialog validates and keeps secrets local until save", () => {
  const src = read("SshHostDialog.tsx")
  assert.match(src, /validateSshHostProfile/)
  assert.match(src, /TextInputV2/)
  assert.match(src, /SwitchV2|Switch as SwitchV2/)
  assert.match(src, /type="password"/)
  assert.match(src, /clearPassword/)
  assert.match(src, /clearPassphrase/)
  assert.doesNotMatch(src, /localStorage/)
  assert.doesNotMatch(src, /<input[\s>]/)
})

test("host key dialog defaults to cancel and distinguishes changed keys", () => {
  const src = read("HostKeyDialog.tsx")
  assert.match(src, /cancelButton\?\.focus/)
  assert.match(src, /trust-and-save/)
  assert.match(src, /replace/)
  assert.match(src, /reject/)
  assert.match(src, /is-danger/)
})

test("prompt dialog masks non-echo prompts", () => {
  const src = read("TerminalPromptDialog.tsx")
  assert.match(src, /prompt\.echo \? "text" : "password"/)
  assert.match(src, /onRespond\(answers\(\)\)/)
})

test("status bar ticks connected duration and hides size via CSS", () => {
  const src = read("TerminalStatusBar.tsx")
  assert.match(src, /setInterval/)
  assert.match(src, /clearInterval/)
  assert.match(src, /UTF-8/)
  assert.match(src, /mafw-terminal-status-size/)
})
