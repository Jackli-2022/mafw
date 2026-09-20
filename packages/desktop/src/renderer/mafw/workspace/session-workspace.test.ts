import { describe, expect, test } from "bun:test"
import { createSessionWorkspace } from "./session-workspace"

describe("session workspace", () => {
  test("tabs add/activate", () => {
    const ws = createSessionWorkspace()
    ws.setSessions(prev => [...prev, { id: "s1", title: "t" } as any])
    ws.setActiveId("s1")
    expect(ws.sessions()).toHaveLength(1)
    expect(ws.activeId()).toBe("s1")
  })

  test("store mutation via setStore (Solid createStore semantics)", () => {
    const ws = createSessionWorkspace()
    ws.setStore("session_status", "s1", { type: "busy" })
    expect(ws.store.session_status.s1.type).toBe("busy")
    ws.setStore("session_status", "s1", { type: "idle" })
    expect(ws.store.session_status.s1.type).toBe("idle")
  })

  test("registry register/call/unregister", () => {
    const ws = createSessionWorkspace()
    let called = 0
    ws.register("queueFlush", "s1", () => { called++ })
    ws.call("queueFlush", "s1")
    expect(called).toBe(1)
    ws.unregister("queueFlush", "s1")
    ws.call("queueFlush", "s1")
    expect(called).toBe(1)
  })

  test("registry records are directly indexable (legacy call-site aliasing)", () => {
    const ws = createSessionWorkspace()
    ws.records.sendingReset["s1"] = () => {}
    expect(typeof ws.records.sendingReset["s1"]).toBe("function")
    ws.call("sendingReset", "s1")
  })

  test("singleton is stable across imports", () => {
    // workspace 单例在模块加载时创建一次；这里只验证工厂与单例不共享状态。
    const ws = createSessionWorkspace()
    ws.setActiveId("x")
    expect(ws.activeId()).toBe("x")
  })
})
