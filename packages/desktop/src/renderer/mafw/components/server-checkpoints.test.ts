// T2-1 Task 9: 服务端检查点 → 时间线行纯逻辑。
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  leftoverNotice,
  restoreWarning,
  toServerRows,
} from "./server-checkpoints"

const base = {
  sessionID: "s1",
  projectDir: "/p",
  anchorMessageID: "u1",
  untracked: [] as string[],
  kind: "auto" as const,
}

test("toServerRows sorts newest first and labels kind/file availability", () => {
  const rows = toServerRows([
    { ...base, id: "ckpt_old", snapshotTree: null, createdAt: "2026-10-26T00:00:00Z" },
    { ...base, id: "ckpt_new", snapshotTree: "a".repeat(40), createdAt: "2026-10-26T02:00:00Z", kind: "manual" },
    { ...base, id: "ckpt_mid", snapshotTree: "b".repeat(40), createdAt: "2026-10-26T01:00:00Z" },
  ])

  assert.deepEqual(rows.map((r) => r.checkpoint.id), ["ckpt_new", "ckpt_mid", "ckpt_old"])
  assert.equal(rows[0].kindBadge, "手动")
  assert.equal(rows[1].kindBadge, "自动")
  assert.equal(rows[0].filesAvailable, true)
  assert.equal(rows[0].filesLabel, "仅代码")
  assert.equal(rows[1].filesLabel, "代码+对话")
  assert.equal(rows[2].filesAvailable, false)
  assert.equal(rows[2].filesLabel, "仅对话")
})

test("toServerRows tolerates empty collections", () => {
  assert.deepEqual(toServerRows([]), [])
})

test("restoreWarning is scope- and runtime-aware", () => {
  const session = restoreWarning("session", "opencode", false)
  assert.match(session, /撤回该消息及其后内容/)
  assert.match(session, /不动文件/)

  const files = restoreWarning("files", "opencode", false)
  assert.match(files, /只回滚文件/)
  assert.match(files, /对话保留/)

  const both = restoreWarning("both", "opencode", false)
  assert.match(both, /不可逆/)

  const undoable = restoreWarning("both", "opencode", true)
  assert.match(undoable, /撤销回滚/)
})

test("leftoverNotice lists untracked leftovers only when present", () => {
  assert.equal(leftoverNotice({ scope: "files" }), null)
  assert.equal(leftoverNotice({ scope: "files", leftoverUntracked: [] }), null)
  const lines = leftoverNotice({ scope: "files", leftoverUntracked: ["a.txt", "dir/"] })
  assert.ok(lines && lines.length >= 1)
  assert.match(lines.join("\n"), /a\.txt/)
  assert.match(lines.join("\n"), /dir\//)
})

test("leftoverNotice explains the files-skipped degradation", () => {
  const lines = leftoverNotice({ scope: "both", filesSkipped: true })
  assert.ok(lines)
  assert.match(lines!.join("\n"), /仅截断对话/)
})
