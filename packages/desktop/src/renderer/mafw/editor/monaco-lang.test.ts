import { describe, expect, test } from "bun:test"
import { monacoLanguage } from "./monaco-lang"

describe("monacoLanguage", () => {
  test("常见语言 id 原样映射", () => {
    expect(monacoLanguage("typescript")).toBe("typescript")
    expect(monacoLanguage("javascript")).toBe("javascript")
    expect(monacoLanguage("python")).toBe("python")
    expect(monacoLanguage("markdown")).toBe("markdown")
    expect(monacoLanguage("json")).toBe("json")
  })

  test("Monaco 没有的 id 走等价语言", () => {
    expect(monacoLanguage("toml")).toBe("ini")
    expect(monacoLanguage("shell")).toBe("shell")
    expect(monacoLanguage("xml")).toBe("xml")
  })

  test("未知/空 → plaintext", () => {
    expect(monacoLanguage(null)).toBe("plaintext")
    expect(monacoLanguage(undefined)).toBe("plaintext")
    expect(monacoLanguage("未知语言")).toBe("plaintext")
  })
})
