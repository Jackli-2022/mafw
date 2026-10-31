import { describe, expect, test } from "bun:test"
import { buildCodeBlockMenu, buildMessageMenu } from "./message"
import { ids } from "../test-helpers"
import { validateMenu } from "../model"

describe("buildMessageMenu", () => {
  test("user message: copy, copy markdown, quote, fork", () => {
    const m = buildMessageMenu({ id: "m", role: "user", hasText: true, canFork: true, tts: false })
    expect(ids(m)).toEqual(["message.copy", "message.copyMarkdown", "message.quote", "message.fork"])
    expect(validateMenu(m)).toEqual([])
  })

  test("assistant message substitutes read-aloud for fork when TTS is available", () => {
    const withTts = buildMessageMenu({ id: "m", role: "assistant", hasText: true, canFork: false, tts: true })
    expect(ids(withTts)).toEqual(["message.copy", "message.copyMarkdown", "message.quote", "message.readAloud"])

    const withoutTts = buildMessageMenu({ id: "m", role: "assistant", hasText: true, canFork: false, tts: false })
    expect(ids(withoutTts)).toEqual(["message.copy", "message.copyMarkdown", "message.quote"])
  })

  test("copy actions are disabled when there is no text", () => {
    const m = buildMessageMenu({ id: "m", role: "assistant", hasText: false, canFork: false, tts: false })
    const copy = m.items.find((i) => i.type === "item" && i.id === "message.copy") as any
    expect(copy.disabled).toBe(true)
    expect(copy.disabledReason).toBe("没有可复制的文本")
  })

  test("pod note is offered only when a pod is available and the message has text", () => {
    const withPod = buildMessageMenu({ id: "m", role: "assistant", hasText: true, canFork: false, tts: false, podNote: true })
    expect(ids(withPod)).toEqual(["message.copy", "message.copyMarkdown", "message.quote", "message.podNote"])
    expect(validateMenu(withPod)).toEqual([])

    const withoutPod = buildMessageMenu({ id: "m", role: "assistant", hasText: true, canFork: false, tts: false })
    expect(ids(withoutPod)).not.toContain("message.podNote")

    const empty = buildMessageMenu({ id: "m", role: "assistant", hasText: false, canFork: false, tts: false, podNote: true })
    const note = empty.items.find((i) => i.type === "item" && i.id === "message.podNote") as any
    expect(note.disabled).toBe(true)
  })
})

describe("buildCodeBlockMenu", () => {
  test("copy code, copy markdown", () => {
    const m = buildCodeBlockMenu({ code: "x" })
    expect(ids(m)).toEqual(["code.copy", "code.copyMarkdown"])
    expect(validateMenu(m)).toEqual([])
  })
})
