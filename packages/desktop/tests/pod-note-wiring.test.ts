import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const pane = readFileSync(new URL("../src/renderer/mafw/components/ChatPane.tsx", import.meta.url), "utf8")
const shell = readFileSync(new URL("../src/renderer/mafw/MafwShell.tsx", import.meta.url), "utf8")

test("chat messages can be promoted into a pod note (opt-in only)", () => {
  assert.match(pane, /onRecordPodNote/)
  assert.match(pane, /podNote: !!props\.onRecordPodNote/)
  assert.match(pane, /message\.podNote/)
  assert.match(shell, /onRecordPodNote=\{recordPodNote\}/)
  assert.match(shell, /buildPodNoteBody\(/)
  // 不自动镜像：只有菜单动作会写 note
  assert.doesNotMatch(shell, /sendMessage\([^)]*kind: "note"[\s\S]{0,80}promptAsync/)
})
