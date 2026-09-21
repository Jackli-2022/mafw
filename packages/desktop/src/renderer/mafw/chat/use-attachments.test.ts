import { describe, expect, test } from "bun:test"
import { mimeOf, fitWithin } from "./use-attachments"

describe("mimeOf", () => {
  test("按扩展名映射 mime", () => {
    expect(mimeOf("a.png")).toBe("image/png")
    expect(mimeOf("b.MP4")).toBe("video/mp4")
    expect(mimeOf("c.wav")).toBe("audio/wav")
    expect(mimeOf("d.pdf")).toBe("application/pdf")
    expect(mimeOf("e.md")).toBe("text/markdown")
  })
  test("未知扩展名回落 octet-stream", () => {
    expect(mimeOf("x.zzz")).toBe("application/octet-stream")
    expect(mimeOf("noext")).toBe("application/octet-stream")
  })
})

describe("fitWithin", () => {
  test("超限时等比缩小", () => {
    expect(fitWithin(4000, 2000, 2000)).toEqual([2000, 1000])
    expect(fitWithin(2048, 1024, 2000)).toEqual([2000, 1000])
  })
  test("未超限原样返回", () => {
    expect(fitWithin(800, 600, 2000)).toEqual([800, 600])
  })
  test("竖图按高度约束", () => {
    expect(fitWithin(1000, 4000, 2000)).toEqual([500, 2000])
  })
})
