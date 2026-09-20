import { describe, test, expect } from "bun:test"
import { mergeAssistantMessage } from "../src/renderer/mafw/message-model"

const sid = "ses_x"
const base = { id: "msg_1", role: "assistant", sessionID: sid, parentID: "u1", time: { created: 1000 }, parts: [] }

describe("mergeAssistantMessage — SSE message.updated assistant 分支", () => {
  test("不存在：push 新消息（带 parentFallback/time 兜底）", () => {
    const out = mergeAssistantMessage([], { id: "msg_1", role: "assistant" }, { sid, parentFallback: "u1" })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: "msg_1", sessionID: sid, parentID: "u1" })
    expect(typeof out[0].time.created).toBe("number")
  })

  test("存在：合并更新并回填 time.completed（bug 根因：live turn 永远思考中）", () => {
    const out = mergeAssistantMessage(
      [base],
      { id: "msg_1", role: "assistant", time: { created: 1000, completed: 9000 } },
      { sid, parentFallback: "u1" },
    )
    expect(out).toHaveLength(1)
    expect(out[0].time).toEqual({ created: 1000, completed: 9000 })
  })

  test("存在：无新信息的更新不产生新数组引用（防无效重渲染）", () => {
    const info = { id: "msg_1", role: "assistant" }
    const arr = [base]
    const out = mergeAssistantMessage(arr, info, { sid, parentFallback: "u1" })
    expect(out).toBe(arr)
  })

  test("合并保留本地字段（如语音 UI 状态）", () => {
    const local = { ...base, voiceStatus: "done" }
    const out = mergeAssistantMessage(
      [local],
      { id: "msg_1", role: "assistant", time: { completed: 9000 } },
      { sid, parentFallback: "u1" },
    )
    expect(out[0].voiceStatus).toBe("done")
    expect(out[0].time.created).toBe(1000)
    expect(out[0].time.completed).toBe(9000)
  })

  test("parentID：info 有值优先，缺省不动已有值", () => {
    const out = mergeAssistantMessage(
      [base],
      { id: "msg_1", role: "assistant", parentID: "u2" },
      { sid, parentFallback: "u9" },
    )
    expect(out[0].parentID).toBe("u2")
    const arr = [base]
    const out2 = mergeAssistantMessage(arr, { id: "msg_1", role: "assistant" }, { sid, parentFallback: "u9" })
    expect(out2).toBe(arr) // 不变
  })
})
