import { describe, expect, test } from "bun:test"
import { partOutputText } from "./tool-output"

describe("partOutputText", () => {
  test("prefers live state.output", () => {
    expect(partOutputText({ output: "live result", content: [{ type: "text", text: "content result" }] })).toBe(
      "live result",
    )
  })

  test("joins history content text parts", () => {
    expect(
      partOutputText({
        content: [
          { type: "text", text: "first" },
          { type: "file", uri: "data:image/png;base64,xxx" },
          { type: "text", text: "second" },
        ],
      }),
    ).toBe("first\nsecond")
  })

  test("returns undefined for empty or missing content", () => {
    expect(partOutputText(undefined)).toBeUndefined()
    expect(partOutputText({})).toBeUndefined()
    expect(partOutputText({ content: [] })).toBeUndefined()
    expect(partOutputText({ content: [{ type: "text", text: "   " }] })).toBeUndefined()
  })

  test("ignores malformed content entries", () => {
    expect(
      partOutputText({
        content: [null, { type: "text" }, { type: "text", text: 42 }, { type: "text", text: "ok" }],
      }),
    ).toBe("ok")
  })
})
