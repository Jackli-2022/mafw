import { describe, expect, test } from "bun:test"
import { applyUserMessageArrival, applyPartDelta, applyPartUpsert, applyAssistantMessage, ensureAssistantMessage, extractMediaSpeak, sealUnfinishedAssistantMessages } from "./chat-reducers"

describe("applyUserMessageArrival", () => {
  test("replaces optimistic user message, remaps parentIDs, migrates parts", () => {
    const state = {
      message: { s1: [
        { id: "user-1", role: "user", voiceStatus: "done", voiceDuration: 3 },
        { id: "a1", role: "assistant", parentID: "user-1" },
      ] },
      part: { "user-1": [{ id: "user-1-text", type: "text", text: "hi" }] },
    }
    const out = applyUserMessageArrival(state as any, "s1", { id: "m-real", role: "user", time: { created: 1 } })!
    const msgs = out.message.s1
    expect(msgs[0].id).toBe("m-real")
    expect((msgs[0] as any).voiceStatus).toBe("done")
    expect(msgs[1].parentID).toBe("m-real")
    expect(out.part["m-real"]).toHaveLength(1)
    expect(out.part["user-1"]).toBeUndefined()
  })

  test("duplicate real id → null (no change)", () => {
    const state = { message: { s1: [{ id: "m-real", role: "user" }] }, part: {} }
    expect(applyUserMessageArrival(state as any, "s1", { id: "m-real", role: "user" })).toBeNull()
  })

  test("no optimistic → append", () => {
    const state = { message: { s1: [] }, part: {} }
    const out = applyUserMessageArrival(state as any, "s1", { id: "m1", role: "user" })!
    expect(out.message.s1).toHaveLength(1)
  })
})

describe("applyAssistantMessage", () => {
  test("appends new assistant message with parentFallback", () => {
    const state = { message: { s1: [] }, part: {} }
    const out = applyAssistantMessage(state as any, "s1", { id: "a1", role: "assistant" }, "u1")!
    expect(out!.message.s1[0]).toMatchObject({ id: "a1", parentID: "u1" })
  })
  test("unchanged info → null (identity preserved)", () => {
    const info = { id: "a1", role: "assistant", time: { created: 5 } }
    const state = { message: { s1: [{ ...info, sessionID: "s1", parentID: null, time: { created: 5 }, parts: [] }] }, part: {} }
    expect(applyAssistantMessage(state as any, "s1", info, null)).toBeNull()
  })
})

describe("applyPartDelta", () => {
  test("appends to existing text part", () => {
    const state = { message: {}, part: { m1: [{ id: "p1", type: "text", text: "he" }] } }
    const out = applyPartDelta(state as any, "s1", "m1", "p1", "llo")!
    expect(out.part.m1[0].text).toBe("hello")
  })
  test("creates part when missing", () => {
    const out = applyPartDelta({ message: {}, part: {} } as any, "s1", "m1", "p1", "hi")!
    expect(out.part.m1[0]).toMatchObject({ id: "p1", type: "text", text: "hi", sessionID: "s1" })
  })
  test("non-text existing part → null", () => {
    const state = { message: {}, part: { m1: [{ id: "p1", type: "tool" }] } }
    expect(applyPartDelta(state as any, "s1", "m1", "p1", "x")).toBeNull()
  })
})

describe("applyPartUpsert", () => {
  test("absorbs optimistic user text part with identical text", () => {
    const state = { message: {}, part: { m1: [{ id: "user-1-text", type: "text", text: "hi" }] } }
    const out = applyPartUpsert(state as any, "s1", { id: "real-p", type: "text", text: "hi", messageID: "m1" })!
    expect(out.part.m1).toHaveLength(1)
    expect(out.part.m1[0].id).toBe("real-p")
  })
  test("upserts by part id when present", () => {
    const state = { message: {}, part: { m1: [{ id: "p1", type: "text", text: "old" }] } }
    const out = applyPartUpsert(state as any, "s1", { id: "p1", type: "text", text: "new", messageID: "m1" })!
    expect(out.part.m1[0].text).toBe("new")
  })
})

describe("ensureAssistantMessage", () => {
  test("pushes assistant message when missing", () => {
    const out = ensureAssistantMessage({ message: {}, part: {} } as any, "s1", "a9", "u9")!
    expect(out.message.s1[0]).toMatchObject({ id: "a9", role: "assistant", parentID: "u9" })
  })
  test("existing → null", () => {
    const state = { message: { s1: [{ id: "a9", role: "assistant" }] }, part: {} }
    expect(ensureAssistantMessage(state as any, "s1", "a9", "u9")).toBeNull()
  })
})

describe("sealUnfinishedAssistantMessages", () => {
  test("stamps completed on assistant messages missing it", () => {
    const state = { message: { s1: [
      { id: "u1", role: "user", time: { created: 1 } },
      { id: "a1", role: "assistant", time: { created: 2 } },
      { id: "a2", role: "assistant", time: { created: 3, completed: 99 } },
    ] }, part: {} }
    const out = sealUnfinishedAssistantMessages(state as any, "s1", 1234)!
    const msgs = out.message.s1
    expect((msgs[0] as any).time.completed).toBeUndefined()
    expect((msgs[1] as any).time.completed).toBe(1234)
    expect((msgs[1] as any).time.created).toBe(2)
    expect((msgs[2] as any).time.completed).toBe(99)
  })
  test("assistant message without time object gets one", () => {
    const state = { message: { s1: [{ id: "a1", role: "assistant" }] }, part: {} }
    const out = sealUnfinishedAssistantMessages(state as any, "s1", 77)!
    expect((out.message.s1[0] as any).time.completed).toBe(77)
  })
  test("other sessions untouched", () => {
    const state = { message: { s1: [{ id: "a1", role: "assistant" }], s2: [{ id: "a2", role: "assistant" }] }, part: {} }
    const out = sealUnfinishedAssistantMessages(state as any, "s1", 5)!
    expect((out.message.s1[0] as any).time.completed).toBe(5)
    expect((out.message.s2[0] as any).time?.completed).toBeUndefined()
  })
  test("nothing to seal → null (no patchStore churn)", () => {
    const state = { message: { s1: [
      { id: "u1", role: "user" },
      { id: "a1", role: "assistant", time: { created: 1, completed: 2 } },
    ] }, part: {} }
    expect(sealUnfinishedAssistantMessages(state as any, "s1")).toBeNull()
    expect(sealUnfinishedAssistantMessages({ message: {}, part: {} } as any, "s1")).toBeNull()
  })
})

describe("extractMediaSpeak", () => {
  test("reads text from properties.input", () => {
    expect(extractMediaSpeak({ properties: { input: { text: "说", voice: "茉莉" } } }, {})).toEqual({ text: "说", voice: "茉莉" })
  })
  test("falls back to store tool part", () => {
    const out = extractMediaSpeak({ assistantMessageID: "a1", properties: {} }, { a1: [{ type: "tool", tool: "mafw_media_speak", input: { text: "嗨" } }] })
    expect(out).toEqual({ text: "嗨", voice: undefined })
  })
  test("no text → null", () => {
    expect(extractMediaSpeak({ properties: {} }, {})).toBeNull()
  })
})
