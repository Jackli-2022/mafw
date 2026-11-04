import { describe, expect, test } from "bun:test"
import { extractVoiceReplies, cleanAssistantText, markVoiceStatus, shouldAutoPlayVoiceReply } from "./use-voice-binding"

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

describe("markVoiceStatus", () => {
  test("只更新目标消息，不能被更早的本地消息抢走", () => {
    const messages = [
      { id: "user-old", text: "之前的一条本地消息" },
      { id: "user-voice", text: "[媒体附件 …]", voiceStatus: "analyzing" },
      { id: "msg-server", text: "服务端消息" },
    ]
    const next = markVoiceStatus(messages, "user-voice", "done")
    expect(next.find((m) => m.id === "user-old")?.voiceStatus).toBeUndefined()
    expect(next.find((m) => m.id === "user-voice")?.voiceStatus).toBe("done")
    expect(next.find((m) => m.id === "msg-server")?.voiceStatus).toBeUndefined()
  })

  test("目标不存在时不改任何消息", () => {
    const messages = [{ id: "user-old" }, { id: "user-voice", voiceStatus: "analyzing" }]
    const next = markVoiceStatus(messages, "missing", "failed")
    expect(next).toEqual(messages)
  })
})

describe("shouldAutoPlayVoiceReply（进入会话不重播历史语音）", () => {
  const ctx = (over: Partial<{ sending: boolean; played: Set<string>; hasRecentHash: (h: string) => boolean }> = {}) => ({
    sending: true,
    played: new Set<string>(),
    hasRecentHash: () => false,
    ...over,
  })

  test("历史加载（sending=false）不自动播放——进入会话静默", () => {
    expect(shouldAutoPlayVoiceReply({ artifactId: "a1" }, ctx({ sending: false }))).toBe(false)
  })

  test("本面板实时回合（sending=true）自动播放", () => {
    expect(shouldAutoPlayVoiceReply({ artifactId: "a1" }, ctx())).toBe(true)
  })

  test("同文本已流式播放（60s hash）→ 跳过（防双播）", () => {
    const c = ctx({ hasRecentHash: (h: string) => h === "deadbeef" })
    expect(shouldAutoPlayVoiceReply({ artifactId: "a1", hash: "deadbeef" }, c)).toBe(false)
    expect(shouldAutoPlayVoiceReply({ artifactId: "a1", hash: "cafebabe" }, c)).toBe(true)
  })

  test("已播放过的 artifact → 跳过", () => {
    expect(shouldAutoPlayVoiceReply({ artifactId: "a1" }, ctx({ played: new Set(["a1"]) }))).toBe(false)
  })
})
