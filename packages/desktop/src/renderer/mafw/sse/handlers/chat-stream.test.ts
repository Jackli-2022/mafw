import { describe, expect, test } from "bun:test"
import { handleChatStreamEvent, handleMediaSpeakEvent, type ChatDeps } from "./chat-stream"
import type { ShellEventDeps } from "../dispatcher"

function makeDeps(store: any = { message: {}, part: {}, session_status: {} }) {
  const calls: { name: string; args: unknown[] }[] = []
  const rec = (name: string) => (...args: unknown[]) => { calls.push({ name, args }) }
  const chat: ChatDeps = {
    trace: rec("trace"),
    getStore: () => store,
    patchStore: rec("patchStore"),
    setSessionStatus: rec("setSessionStatus"),
    markSessionDone: rec("markSessionDone"),
    setUserMsgId: rec("setUserMsgId"),
    parentFallback: () => "u1",
    phase: rec("phase"),
    onTurnSettled: rec("onTurnSettled"),
    notifyIdle: rec("notifyIdle"),
    mediaSpeak: rec("mediaSpeak"),
  }
  return { deps: { chat } as unknown as ShellEventDeps, calls }
}

describe("handleChatStreamEvent", () => {
  test("message.updated user → patchStore + setUserMsgId (consumed)", () => {
    const { deps, calls } = makeDeps()
    const ok = handleChatStreamEvent({ type: "message.updated", sessionID: "s1", properties: { info: { id: "m1", role: "user" } } }, "s1", deps)
    expect(ok).toBe(true)
    expect(calls.map(c => c.name)).toContain("patchStore")
    expect(calls.find(c => c.name === "setUserMsgId")!.args).toEqual(["s1", "m1"])
  })

  test("part.delta → phase(writing) + patchStore (consumed)", () => {
    const { deps, calls } = makeDeps()
    const ok = handleChatStreamEvent({ type: "part.delta", sessionID: "s1", properties: { messageID: "m1", partID: "p1", field: "text", delta: "hi" } }, "s1", deps)
    expect(ok).toBe(true)
    expect(calls.find(c => c.name === "phase")!.args).toEqual(["s1", "writing"])
    expect(calls.map(c => c.name)).toContain("patchStore")
  })

  test("part.updated → busy + phase + patchStore（落穿：不消费，media_speak 仍需检查）", () => {
    const { deps, calls } = makeDeps()
    const ok = handleChatStreamEvent({ type: "part.updated", sessionID: "s1", properties: { part: { id: "p1", type: "text", text: "x", messageID: "m1" } } }, "s1", deps)
    expect(ok).toBe(false)
    expect(calls.find(c => c.name === "setSessionStatus")!.args).toEqual(["s1", { type: "busy" }])
    expect(calls.map(c => c.name)).toContain("patchStore")
  })

  test("turn.completed → idle + done + onTurnSettled(expireCards: true) + notifyIdle", () => {
    const { deps, calls } = makeDeps()
    handleChatStreamEvent({ type: "turn.completed", sessionID: "s1" }, "s1", deps)
    expect(calls.find(c => c.name === "setSessionStatus")!.args).toEqual(["s1", { type: "idle" }])
    expect(calls.map(c => c.name)).toContain("markSessionDone")
    expect(calls.map(c => c.name)).toContain("notifyIdle")
    expect(calls.find(c => c.name === "onTurnSettled")!.args[1]).toEqual({ expireCards: true })
  })

  test("part.complete → onTurnSettled(expireCards: false)", () => {
    const { deps, calls } = makeDeps()
    handleChatStreamEvent({ type: "part.complete", sessionID: "s1" }, "s1", deps)
    expect(calls.find(c => c.name === "onTurnSettled")!.args[1]).toEqual({ expireCards: false })
  })

  test("turn.failed → settle，不 notifyIdle", () => {
    const { deps, calls } = makeDeps()
    handleChatStreamEvent({ type: "turn.failed", sessionID: "s1" }, "s1", deps)
    expect(calls.map(c => c.name)).not.toContain("notifyIdle")
    expect(calls.map(c => c.name)).toContain("onTurnSettled")
  })

  test("turn.aborted → settle，不 notifyIdle", () => {
    const { deps, calls } = makeDeps()
    handleChatStreamEvent({ type: "turn.aborted", sessionID: "s1" }, "s1", deps)
    expect(calls.map(c => c.name)).not.toContain("notifyIdle")
    expect(calls.map(c => c.name)).toContain("onTurnSettled")
  })

  test("unrelated type → false（无副作用）", () => {
    const { deps, calls } = makeDeps()
    expect(handleChatStreamEvent({ type: "plugin:foo", sessionID: "s1" }, "s1", deps)).toBe(false)
    expect(calls.some(c => c.name === "patchStore")).toBe(false)
  })
})

describe("turn-end seal（绿色方块兜底：缺 time.completed 的 assistant 消息盖章）", () => {
  const dirtyStore = () => ({
    message: { s1: [
      { id: "u1", role: "user" },
      { id: "a1", role: "assistant", time: { created: 1 } },
    ] },
    part: {},
    session_status: {},
  })
  const sealed = (calls: { name: string; args: unknown[] }[]) => {
    const p = calls.filter(c => c.name === "patchStore").map(c => c.args[0] as any).find(x => x.message?.s1)
    return p ? (p.message.s1[1] as any).time?.completed : undefined
  }

  test.each(["turn.completed", "turn.failed", "turn.aborted"] as const)(
    "%s → seals unfinished assistant message",
    (type) => {
      const { deps, calls } = makeDeps(dirtyStore())
      handleChatStreamEvent({ type, sessionID: "s1" } as any, "s1", deps)
      expect(sealed(calls)).toBeTypeOf("number")
    },
  )

  test("part.complete → 不盖章（per-part 非回合终态）", () => {
    const { deps, calls } = makeDeps(dirtyStore())
    handleChatStreamEvent({ type: "part.complete", sessionID: "s1" }, "s1", deps)
    expect(sealed(calls)).toBeUndefined()
  })

  test("已完结 store → 无盖章 patch", () => {
    const clean = { message: { s1: [{ id: "a1", role: "assistant", time: { created: 1, completed: 9 } }] }, part: {}, session_status: {} }
    const { deps, calls } = makeDeps(clean)
    handleChatStreamEvent({ type: "turn.completed", sessionID: "s1" }, "s1", deps)
    expect(sealed(calls)).toBeUndefined()
  })
})

describe("handleMediaSpeakEvent", () => {
  test("mafw_media_speak input → mediaSpeak，永不消费", () => {
    const { deps, calls } = makeDeps()
    const ok = handleMediaSpeakEvent({ type: "part.updated", sessionID: "s1", properties: { tool: "mafw_media_speak", input: { text: "说", voice: "茉莉" } } }, "s1", deps)
    expect(ok).toBe(false)
    expect(calls.find(c => c.name === "mediaSpeak")!.args).toEqual(["s1", "说", "茉莉"])
  })

  test("其他工具 → false 无副作用", () => {
    const { deps, calls } = makeDeps()
    const ok = handleMediaSpeakEvent({ type: "part.updated", sessionID: "s1", properties: { tool: "bash" } }, "s1", deps)
    expect(ok).toBe(false)
    expect(calls.some(c => c.name === "mediaSpeak")).toBe(false)
  })
})
