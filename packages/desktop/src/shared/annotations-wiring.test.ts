import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8")

test("held 批注的 IPC 在 main 与 preload 都已接线", () => {
  const ipc = read("../main/ipc.ts")
  assert.match(ipc, /"annotations-set-held"/)
  assert.match(ipc, /annotations\.setHeld\(/)

  const preload = read("../preload/index.ts")
  assert.match(preload, /setHeld: \(sessionID, id, held\) => ipcRenderer\.invoke\("annotations-set-held"/)
})

test("patch/findByIds annotation IPC is wired", () => {
  const ipc = read("../main/ipc.ts")
  assert.match(ipc, /"annotations-patch"/)
  assert.match(ipc, /"annotations-find-by-ids"/)
  assert.match(ipc, /annotations\.patch\(/)
  assert.match(ipc, /annotations\.findByIds\(/)

  const preload = read("../preload/index.ts")
  assert.match(preload, /patch: \(sessionID, id, patch\) => ipcRenderer\.invoke\("annotations-patch"/)
  assert.match(preload, /findByIds: \(ids\) => ipcRenderer\.invoke\("annotations-find-by-ids"/)
})
