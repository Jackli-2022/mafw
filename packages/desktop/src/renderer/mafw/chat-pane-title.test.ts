import { test } from "node:test"
import assert from "node:assert/strict"
import { chatPaneTitle } from "./chat-pane-title"

test("Lead 会话头部恒显示角色名，不跟随 runtime 自动标题", () => {
  assert.equal(chatPaneTitle({ lead: true, title: "问候" }), "Lead")
  assert.equal(chatPaneTitle({ lead: true, title: undefined }), "Lead")
})

test("普通会话头部继续用展示格式化（空标题有兜底）", () => {
  assert.equal(chatPaneTitle({ lead: false, title: "修复登录" }), "修复登录")
  assert.equal(chatPaneTitle({ lead: false, title: "" }), "Chat")
  assert.equal(chatPaneTitle({ lead: false, title: "New conversation" }), "未命名")
})
