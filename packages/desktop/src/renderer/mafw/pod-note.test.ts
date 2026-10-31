import { test } from "node:test"
import assert from "node:assert/strict"
import { POD_NOTE_MAX_CHARS, buildPodNoteBody } from "./pod-note"

test("pod note keeps a readable prefix and the source pointers", () => {
  const body = buildPodNoteBody({
    speaker: "Builder",
    sessionId: "ses_1",
    messageId: "msg_1",
    text: "  wave 3 回执已经贴上，\n接着跑 wave 4 的契约测试  ",
  })
  assert.equal(body.split("\n")[0], "[来自 Builder 的会话] wave 3 回执已经贴上， 接着跑 wave 4 的契约测试")
  assert.equal(body.split("\n")[1], "会话 ses_1 / 消息 msg_1")
})

test("pod note truncates long text instead of flooding the log", () => {
  const body = buildPodNoteBody({
    speaker: "Lead",
    sessionId: "ses_2",
    messageId: "msg_2",
    text: "x".repeat(POD_NOTE_MAX_CHARS + 50),
  })
  const first = body.split("\n")[0]
  assert.ok(first.endsWith("…"), "truncated body must end with an ellipsis")
  assert.ok(first.length <= POD_NOTE_MAX_CHARS + "[来自 Lead 的会话] ".length + 1)
})

test("empty text produces no note", () => {
  assert.equal(buildPodNoteBody({ speaker: "Lead", sessionId: "s", messageId: "m", text: "   " }), "")
})
