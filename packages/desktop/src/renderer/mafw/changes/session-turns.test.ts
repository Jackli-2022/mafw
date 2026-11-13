import { test } from "node:test"
import assert from "node:assert/strict"
import { buildSessionTurnChanges, turnTimeLabel, turnTitle } from "./session-turns"
import type { MafwMessage } from "@mafw/sdk"

const message = (id: string, role: "user" | "assistant", created: number, text: string): MafwMessage => ({
  id,
  role,
  time: { created },
} as MafwMessage)

test("turn titles take the first non-empty line and truncate", () => {
  assert.equal(turnTitle("\n  修复登录失败  \n第二行"), "修复登录失败")
  assert.equal(turnTitle(""), "(无文本)")
  assert.equal(turnTitle("x".repeat(60)).length, 40)
})

test("turn time labels are zero-padded HH:MM", () => {
  const date = new Date(2026, 10, 13, 9, 5, 0)
  assert.equal(turnTimeLabel(date.getTime()), "09:05")
  assert.equal(turnTimeLabel(null), "")
})

test("only user turns with fetched per-turn files become rows", () => {
  const messages = [
    message("m1", "user", 1000, "修复登录失败"),
    message("a1", "assistant", 1100, "done"),
    message("m2", "user", 2000, "补登录测试"),
    message("m3", "user", 3000, "这次没有文件"),
  ]
  const rows = buildSessionTurnChanges(
    messages,
    { m1: [{ type: "text", text: "修复登录失败" }], m2: [{ type: "text", text: "补登录测试" }] },
    {
      m1: [{ file: "src/a.ts", additions: 2, deletions: 1 }],
      m2: null,
      m3: [],
    },
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.id, "m1")
  assert.equal(rows[0]?.title, "修复登录失败")
  assert.equal(rows[0]?.additions, 2)
  assert.equal(rows[0]?.deletions, 1)
})

test("local optimistic turns are skipped", () => {
  const rows = buildSessionTurnChanges(
    [message("user-local-1", "user", 1000, "hi")],
    {},
    { "user-local-1": [{ file: "a.ts" }] },
  )
  assert.deepEqual(rows, [])
})
