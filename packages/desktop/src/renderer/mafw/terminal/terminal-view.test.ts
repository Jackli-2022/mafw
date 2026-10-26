import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { viewFor } from "./terminal-view"

describe("terminal-view", () => {
  test("六态映射：probing busy；live 无 banner；closed/gone/unavailable 各有动作", () => {
    assert.equal(viewFor("probing").busy, true)
    assert.equal(viewFor("live").banner, undefined)

    const closed = viewFor("closed")
    assert.equal(closed.banner, "终端已断开")
    assert.equal(closed.action, "reconnect")

    const gone = viewFor("gone")
    assert.equal(gone.banner, "终端已随服务重启关闭")
    assert.equal(gone.action, "reopen")

    const un = viewFor("unavailable")
    assert.equal(un.banner, "当前环境不支持内嵌终端")
    assert.equal(un.action, "external")

    const idle = viewFor("idle")
    assert.equal(idle.banner, "打开一个会话后此处可用终端")
    assert.equal(idle.action, "open")
  })
})
