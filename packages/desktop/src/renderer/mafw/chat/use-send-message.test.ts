import { describe, expect, test } from "bun:test"
import { parseSlashShape, buildOptimisticParts } from "./use-send-message"

describe("parseSlashShape", () => {
  test("解析 /cmd args", () => {
    expect(parseSlashShape("/btw 这是啥")).toEqual({ name: "btw", args: "这是啥" })
  })
  test("无参数", () => {
    expect(parseSlashShape("/compact")).toEqual({ name: "compact", args: "" })
  })
  test("非 slash 返回 null", () => {
    expect(parseSlashShape("hello")).toBeNull()
    expect(parseSlashShape("路径 /tmp 测试")).toBeNull()
  })
})

describe("buildOptimisticParts", () => {
  test("组装 body + 缩略图 + 文件 + agent parts", () => {
    const parts = buildOptimisticParts({
      userMsgId: "user-1",
      ts: 1000,
      sid: "s1",
      bodyMessage: "你好",
      visionThumbs: [{ name: "a.wav", mime: "audio/wav", dataUrl: "data:audio/wav" }],
      fileParts: [{ type: "file", id: "prt_att_0", mime: "application/pdf", filename: "b.pdf", url: "file:///b.pdf" }],
      agentParts: [{ type: "agent", id: "prt_agent_x", name: "x" }],
    })
    expect(parts[0]).toMatchObject({ type: "text", id: "user-1-text", text: "你好", messageID: "user-1" })
    expect(parts[1]).toMatchObject({ type: "file", id: "prt_local_1000_0", localOnly: true })
    expect(parts[2]).toMatchObject({ type: "file", id: "prt_att_0", messageID: "user-1" })
    expect(parts[3]).toMatchObject({ type: "agent", id: "prt_agent_x", messageID: "user-1" })
  })
  test("空 body 时不产生 text part", () => {
    const parts = buildOptimisticParts({
      userMsgId: "user-2", ts: 1, sid: "s1", bodyMessage: "",
      visionThumbs: [], fileParts: [], agentParts: [],
    })
    expect(parts).toEqual([])
  })
})
