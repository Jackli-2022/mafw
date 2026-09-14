import { describe, expect, test } from "bun:test"
import { getDraft, setDraft, clearDraft } from "./session-drafts"

describe("session drafts", () => {
  test("set then get returns the draft per session", () => {
    setDraft("s1", "hello")
    setDraft("s2", "world")
    expect(getDraft("s1")).toBe("hello")
    expect(getDraft("s2")).toBe("world")
  })

  test("missing draft returns empty string", () => {
    expect(getDraft("nope")).toBe("")
  })

  test("clear removes the draft", () => {
    setDraft("s1", "x")
    clearDraft("s1")
    expect(getDraft("s1")).toBe("")
  })

  test("overwrite keeps the latest", () => {
    setDraft("s1", "old"); setDraft("s1", "new")
    expect(getDraft("s1")).toBe("new")
  })
})
