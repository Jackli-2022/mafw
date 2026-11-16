import { describe, expect, test } from "bun:test"
import { formatWebContext, isDocsPath, normalizeWebUrl } from "./mention-sources"

describe("isDocsPath", () => {
  test("recognizes project docs and root instruction files", () => {
    expect(isDocsPath("/docs/architecture/desktop.md")).toBe(true)
    expect(isDocsPath("docs/guide.md")).toBe(true)
    expect(isDocsPath("/README.md")).toBe(true)
    expect(isDocsPath("AGENTS.md")).toBe(true)
    expect(isDocsPath("packages/desktop/AGENTS.md")).toBe(true)
    expect(isDocsPath("src/index.ts")).toBe(false)
    expect(isDocsPath("notes/README.md")).toBe(false)
  })
})

describe("formatWebContext", () => {
  test("renders one bullet per URL and stays empty without links", () => {
    expect(formatWebContext([])).toBe("")
    expect(formatWebContext([{ url: "https://a.test" }, { url: "https://b.test" }]))
      .toBe("Web context:\n- https://a.test\n- https://b.test")
  })
})

describe("normalizeWebUrl", () => {
  test("adds https when the scheme is missing", () => {
    expect(normalizeWebUrl("example.com/docs")).toBe("https://example.com/docs")
    expect(normalizeWebUrl("example.com/docs?q=1")).toBe("https://example.com/docs?q=1")
  })

  test("keeps http/https and rejects other schemes or empty input", () => {
    expect(normalizeWebUrl("http://example.com/a")).toBe("http://example.com/a")
    expect(normalizeWebUrl("https://example.com/a")).toBe("https://example.com/a")
    expect(normalizeWebUrl("file:///etc/passwd")).toBeNull()
    expect(normalizeWebUrl("javascript:alert(1)")).toBeNull()
    expect(normalizeWebUrl("   ")).toBeNull()
  })
})
