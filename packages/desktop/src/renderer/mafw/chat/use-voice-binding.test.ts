import { describe, expect, test } from "bun:test"
import { extractVoiceReplies, cleanAssistantText } from "./use-voice-binding"

describe("extractVoiceReplies", () => {
  test("提取完整标记（artifactId/voice/hash）", () => {
    const text = "前言 [语音回复 art:abc-123 音色:茉莉 h:deadbeef] 后记"
    expect(extractVoiceReplies(text)).toEqual([
      { artifactId: "abc-123", voice: "茉莉", hash: "deadbeef" },
    ])
  })
  test("无音色无 hash 的标记", () => {
    expect(extractVoiceReplies("[语音回复 art:x1]")).toEqual([{ artifactId: "x1", voice: undefined, hash: undefined }])
  })
  test("多标记按序提取", () => {
    const out = extractVoiceReplies("[语音回复 art:a] 中间 [语音回复 art:b 音色:苏打]")
    expect(out.map((r) => r.artifactId)).toEqual(["a", "b"])
  })
  test("无标记返回空数组", () => {
    expect(extractVoiceReplies("普通文本")).toEqual([])
  })
})

describe("cleanAssistantText", () => {
  test("去掉语音回复标记并 trim", () => {
    expect(cleanAssistantText("回答正文 [语音回复 art:abc]")).toBe("回答正文")
  })
  test("无标记原样 trim", () => {
    expect(cleanAssistantText("  正文  ")).toBe("正文")
  })
})
