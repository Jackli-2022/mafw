import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { viewFor, planAttach } from "./terminal-view"

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

  test("Important-4/5：planAttach——不可见不挂载；同目录忽略；in-flight 队列最新目录", () => {
    // 终端 tab 不可见 → 不创建 PTY（不再后台起 shell）
    assert.equal(planAttach({ active: false, attaching: false, requestedDir: "A", currentDir: null }), "ignore")
    // 无目录 → 忽略
    assert.equal(planAttach({ active: true, attaching: false, requestedDir: null, currentDir: null }), "ignore")
    // 目录未变 → 忽略
    assert.equal(planAttach({ active: true, attaching: false, requestedDir: "A", currentDir: "A" }), "ignore")
    // 可启动
    assert.equal(planAttach({ active: true, attaching: false, requestedDir: "A", currentDir: null }), "start")
    // in-flight 中切目录 → 排队（完成后跑最新目录，不得丢）
    assert.equal(planAttach({ active: true, attaching: true, requestedDir: "B", currentDir: "A" }), "queue")
    // in-flight 中切回当前目录 → 忽略
    assert.equal(planAttach({ active: true, attaching: true, requestedDir: "A", currentDir: "A" }), "ignore")
  })
})
