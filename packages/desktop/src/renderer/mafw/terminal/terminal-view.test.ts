import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { viewFor, planAttach, buildTerminalTheme, createResizeScheduler } from "./terminal-view"

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
    assert.equal(idle.action, undefined, "无会话目录不得给死按钮")
  })

  test("idle 有目录：可重新打开；closed+error：服务不可用文案（不误报环境不支持）", () => {
    const withDir = viewFor("idle", { hasDirectory: true })
    assert.equal(withDir.action, "open")
    assert.equal(withDir.banner, "终端已关闭，可重新打开")

    const err = viewFor("closed", { error: "fetch failed" })
    assert.equal(err.banner, "终端服务不可用，请检查 gateway 或重启应用")
    assert.equal(err.action, "reconnect")
  })

  test("Important-4/5：planAttach——不可见不挂载；同目录忽略；in-flight 队列最新目录", () => {
    assert.equal(planAttach({ active: false, attaching: false, requestedDir: "A", currentDir: null }), "ignore")
    assert.equal(planAttach({ active: true, attaching: false, requestedDir: null, currentDir: null }), "ignore")
    assert.equal(planAttach({ active: true, attaching: false, requestedDir: "A", currentDir: "A" }), "ignore")
    assert.equal(planAttach({ active: true, attaching: false, requestedDir: "A", currentDir: null }), "start")
    assert.equal(planAttach({ active: true, attaching: true, requestedDir: "B", currentDir: "A" }), "queue")
    assert.equal(planAttach({ active: true, attaching: true, requestedDir: "A", currentDir: "A" }), "ignore")
  })

  test("buildTerminalTheme：token 读取 + 空值回退（selection 用 --selection 而非不存在的 --bg-selected）", () => {
    const read = (name: string) => (name === "--accent" ? "#123456" : name === "--selection" ? "  " : "")
    const t = buildTerminalTheme(read)
    assert.equal(t.cursor, "#123456")
    assert.equal(t.selectionBackground, "#264f78")
    assert.ok(t.fontFamily.length > 0)
    assert.ok(t.background.length > 0)
  })

  test("resize scheduler：尾部防抖，只跑最后一次；flush 立即执行；cancel 不执行", () => {
    let runs = 0
    const timers: Array<() => void> = []
    const cleared: number[] = []
    const sched = createResizeScheduler(120, () => runs++, {
      set: (fn: () => void) => { timers.push(fn); return timers.length },
      clear: (h: any) => cleared.push(h),
    } as any)
    sched.schedule()
    sched.schedule()
    assert.equal(cleared.length, 1, "连续 schedule 必须清掉前一个定时器")
    timers[timers.length - 1]()
    assert.equal(runs, 1)
    sched.schedule()
    sched.flush()
    assert.equal(runs, 2)
    sched.schedule()
    sched.cancel()
    assert.equal(runs, 2)
  })

  test("默认 timers 以 globalThis 为 receiver（浏览器裸 setTimeout/clearTimeout 会 Illegal invocation）", () => {
    const g = globalThis as any
    const origSet = g.setTimeout
    const origClear = g.clearTimeout
    const seen: Array<{ fn: string; self: any }> = []
    g.setTimeout = function (this: any, fn: () => void, ms?: number) {
      seen.push({ fn: "set", self: this })
      return origSet(fn, ms)
    }
    g.clearTimeout = function (this: any, handle: any) {
      seen.push({ fn: "clear", self: this })
      return origClear(handle)
    }
    try {
      const sched = createResizeScheduler(1000, () => {})
      sched.schedule()
      sched.cancel()
      assert.deepEqual(seen.map((s) => s.fn), ["set", "clear"])
      assert.equal(seen[0].self, globalThis)
      assert.equal(seen[1].self, globalThis)
    } finally {
      g.setTimeout = origSet
      g.clearTimeout = origClear
    }
  })
})
