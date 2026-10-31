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

test("assistant replies expose a visible hover action, not only the context menu", () => {
  const part = readFileSync(
    new URL("../../session-ui/src/components/message-part.tsx", import.meta.url),
    "utf8",
  )
  assert.match(part, /onPodNote\?:/)
  assert.match(part, /icon="team-three"/)
  assert.match(part, /记入鲸群/)
  // 入口必须在 text-part 的可见动作行里（copy 按钮同级）
  const hoverBlock = part.slice(part.indexOf("text-part-copy-wrapper"))
  const noteAt = hoverBlock.indexOf("记入鲸群")
  const copyAt = hoverBlock.indexOf("copyResponse")
  assert.ok(noteAt > 0, "pod note button missing from the visible action row")
  assert.ok(copyAt > noteAt, "pod note button should sit next to copy in the same row")
})
