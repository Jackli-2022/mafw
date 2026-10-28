import { describe, expect, test } from "bun:test"
import { codeFence, markdownFromParts, textFromParts } from "./message-text"

describe("message text extraction", () => {
  test("joins text parts and drops tool/reasoning parts", () => {
    const parts = [
      { type: "text", text: "hello" },
      { type: "tool", text: "ignored" },
      { type: "reasoning", text: "ignored" },
      { type: "text", text: "world" },
    ]
    expect(textFromParts(parts)).toBe("hello\n\nworld")
    expect(markdownFromParts(parts)).toBe("hello\n\nworld")
  })

  test("ignores parts without text", () => {
    expect(textFromParts([{ type: "text" }, { type: "text", text: "" }])).toBe("")
  })

  test("wraps code in a fenced block with an optional language", () => {
    expect(codeFence("const x = 1", "ts")).toBe("```ts\nconst x = 1\n```")
    expect(codeFence("plain")).toBe("```\nplain\n```")
  })
})
