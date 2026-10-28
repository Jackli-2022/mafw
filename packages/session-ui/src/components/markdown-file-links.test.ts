import { describe, expect, test } from "bun:test"
import { filePathFromHref } from "./markdown-file-links"

describe("filePathFromHref", () => {
  test("accepts relative and absolute file links", () => {
    expect(filePathFromHref("src/a.ts")).toBe("src/a.ts")
    expect(filePathFromHref("/home/me/a.ts")).toBe("/home/me/a.ts")
    expect(filePathFromHref("C:/work/a.ts")).toBe("C:/work/a.ts")
    expect(filePathFromHref("a%20b.ts")).toBe("a b.ts")
  })

  test("rejects external and non-file schemes", () => {
    expect(filePathFromHref("https://x.dev/a")).toBeNull()
    expect(filePathFromHref("mailto:a@b.c")).toBeNull()
    expect(filePathFromHref("#anchor")).toBeNull()
    expect(filePathFromHref("javascript:alert(1)")).toBeNull()
    expect(filePathFromHref("data:text/plain,x")).toBeNull()
    expect(filePathFromHref("//cdn.dev/a")).toBeNull()
  })

  test("malformed percent sequences fall back to the raw path", () => {
    expect(filePathFromHref("50%")).toBe("50%")
    expect(filePathFromHref("a%2")).toBe("a%2")
  })

  test("strips query and fragment", () => {
    expect(filePathFromHref("src/a.ts?x=1#L2")).toBe("src/a.ts")
  })
})
