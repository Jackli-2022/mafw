import { describe, expect, test } from "bun:test"
import {
  VOICE_ORIGIN_MARKER_TEXT,
  hasVoiceOriginMarker,
  stripVoiceOriginMarker,
  appendVoiceOriginMarker,
} from "./voice-origin-marker"

describe("VOICE_ORIGIN_MARKER_TEXT 契约", () => {
  test("单行且以 [语音输入] 开头（剥离正则依赖）", () => {
    expect(VOICE_ORIGIN_MARKER_TEXT.startsWith("[语音输入] ")).toBe(true)
    expect(VOICE_ORIGIN_MARKER_TEXT.includes("\n")).toBe(false)
  })
})

describe("hasVoiceOriginMarker", () => {
  test("行首前缀判存", () => {
    expect(hasVoiceOriginMarker("[语音输入] 回复要短")).toBe(true)
    expect(hasVoiceOriginMarker(`第一行\n${VOICE_ORIGIN_MARKER_TEXT}`)).toBe(true)
    expect(hasVoiceOriginMarker(appendVoiceOriginMarker("你好"))).toBe(true)
  })
  test("正文/缩进出现不算（防误伤用户文本）", () => {
    expect(hasVoiceOriginMarker("你好")).toBe(false)
    expect(hasVoiceOriginMarker("他说[语音输入]这个词")).toBe(false)
    expect(hasVoiceOriginMarker("  [语音输入] 缩进行")).toBe(false)
    expect(hasVoiceOriginMarker("")).toBe(false)
  })
})

describe("stripVoiceOriginMarker", () => {
  test("剥离尾部标记行并去尾空白", () => {
    expect(stripVoiceOriginMarker(`你好\n\n${VOICE_ORIGIN_MARKER_TEXT}`)).toBe("你好")
  })
  test("纯标记 → 空串", () => {
    expect(stripVoiceOriginMarker(VOICE_ORIGIN_MARKER_TEXT)).toBe("")
  })
  test("无标记原样返回（含尾换行也不动）", () => {
    expect(stripVoiceOriginMarker("第一行\n")).toBe("第一行\n")
    expect(stripVoiceOriginMarker("  普通文本  ")).toBe("  普通文本  ")
  })
  test("中间标记行被移除，其余行保留", () => {
    expect(stripVoiceOriginMarker(`第一行\n[语音输入] 中间\n第二行`)).toBe("第一行\n第二行")
  })
  test("多次出现全部移除", () => {
    expect(stripVoiceOriginMarker("A\n[语音输入] 1\nB\n[语音输入] 2\nC")).toBe("A\nB\nC")
  })
  test("正文内出现不剥离（只认行首）", () => {
    expect(stripVoiceOriginMarker("他说[语音输入]这个词")).toBe("他说[语音输入]这个词")
  })
})

describe("appendVoiceOriginMarker", () => {
  test("作为独立段落追加", () => {
    expect(appendVoiceOriginMarker("你好")).toBe(`你好\n\n${VOICE_ORIGIN_MARKER_TEXT}`)
  })
  test("幂等：已有标记原样返回", () => {
    const once = appendVoiceOriginMarker("你好")
    expect(appendVoiceOriginMarker(once)).toBe(once)
  })
  test("空文本返回纯标记", () => {
    expect(appendVoiceOriginMarker("")).toBe(VOICE_ORIGIN_MARKER_TEXT)
  })
})
