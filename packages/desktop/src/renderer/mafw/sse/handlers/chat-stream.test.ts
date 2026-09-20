import { describe, expect, test } from "bun:test"
import { handleChatStreamEvent, handleMediaSpeakEvent, type ChatDeps } from "./chat-stream"
import type { ShellEventDeps } from "../dispatcher"

function makeDeps() {
  const calls: { name: string; args: unknown[] }[] = []
  const rec = (name: string) => (...args: unknown[]) => { calls.push({ name, args }) }
  const chat: ChatDeps = {
    trace: rec("trace"),
    getStore: () => ({ message: {}, part: {}, session_status: {} }) as any,
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

  test("message.part.delta → phase(writing) + patchStore (consumed)", () => {
    const { deps, calls } = makeDeps()
    const ok = handleChatStreamEvent({ type: "message.part.delta", sessionID: "s1", properties: { messageID: "m1", partID: "p1", field: "text", delta: "hi" } }, "s1", deps)
    expect(ok).toBe(true)
    expect(calls.find(c => c.name === "phase")!.args).toEqual(["s1", "writing"])
    expect(calls.map(c => c.name)).toContain("patchStore")
  })

  test("message.part.updated → busy + phase + patchStore（落穿：不消费，media_speak 仍需检查）", () => {
    const { deps, calls } = makeDeps()
    const ok = handleChatStreamEvent({ type: "message.part.updated", sessionID: "s1", properties: { part: { id: "p1", type: "text", text: "x", messageID: "m1" } } }, "s1", deps)
    expect(ok).toBe(false)
    expect(calls.find(c => c.name === "setSessionStatus")!.args).toEqual(["s1", { type: "busy" }])
    expect(calls.map(c => c.name)).toContain("patchStore")
  })

  test("message.complete → idle + done + onTurnSettled(expireCards: true)", () => {
    const { deps, calls } = makeDeps()
    handleChatStreamEvent({ type: "message.complete", sessionID: "s1" }, "s1", deps)
    expect(calls.find(c => c.name === "setSessionStatus")!.args).toEqual(["s1", { type: "idle" }])
    expect(calls.map(c => c.name)).toContain("markSessionDone")
    expect(calls.find(c => c.name === "onTurnSettled")!.args[1]).toEqual({ expireCards: true })
  })

  test("message.part.complete → onTurnSettled(expireCards: false)", () => {
    const { deps, calls } = makeDeps()
    handleChatStreamEvent({ type: "message.part.complete", sessionID: "s1" }, "s1", deps)
    expect(calls.find(c => c.name === "onTurnSettled")!.args[1]).toEqual({ expireCards: false })
  })

  test("session.idle → settle(expireCards: true) + notifyIdle", () => {
    const { deps, calls } = makeDeps()
    handleChatStreamEvent({ type: "session.idle", sessionID: "s1" }, "s1", deps)
    expect(calls.map(c => c.name)).toContain("notifyIdle")
    expect(calls.find(c => c.name === "onTurnSettled")!.args[1]).toEqual({ expireCards: true })
  })

  test("session.error → settle，不 notifyIdle", () => {
    const { deps, calls } = makeDeps()
    handleChatStreamEvent({ type: "session.error", sessionID: "s1" }, "s1", deps)
    expect(calls.map(c => c.name)).not.toContain("notifyIdle")
    expect(calls.map(c => c.name)).toContain("onTurnSettled")
  })

  test("session.next.tool.* 新 assistant 消息 → patchStore（落穿）", () => {
    const { deps, calls } = makeDeps()
    const ok = handleChatStreamEvent({ type: "session.next.tool.ended", sessionID: "s1", assistantMessageID: "a7" }, "s1", deps)
    expect(ok).toBe(false)
    expect(calls.map(c => c.name)).toContain("patchStore")
  })

  test("unrelated type → false（无副作用）", () => {
    const { deps, calls } = makeDeps()
    expect(handleChatStreamEvent({ type: "plugin:foo", sessionID: "s1" }, "s1", deps)).toBe(false)
    expect(calls.some(c => c.name === "patchStore")).toBe(false)
  })
})

describe("handleMediaSpeakEvent", () => {
  test("mafw_media_speak input → mediaSpeak，永不消费", () => {
    const { deps, calls } = makeDeps()
    const ok = handleMediaSpeakEvent({ type: "message.part.updated", sessionID: "s1", properties: { tool: "mafw_media_speak", input: { text: "说", voice: "茉莉" } } }, "s1", deps)
    expect(ok).toBe(false)
    expect(calls.find(c => c.name === "mediaSpeak")!.args).toEqual(["s1", "说", "茉莉"])
  })

  test("其他工具 → false 无副作用", () => {
    const { deps, calls } = makeDeps()
    const ok = handleMediaSpeakEvent({ type: "message.part.updated", sessionID: "s1", properties: { tool: "bash" } }, "s1", deps)
    expect(ok).toBe(false)
    expect(calls.some(c => c.name === "mediaSpeak")).toBe(false)
  })
})
