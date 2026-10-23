import { expect, test } from "bun:test"
import { appendQuote, formatQuote, QUOTE_MAX_CHARS } from "./quote-format"

test("single line", () => {
  expect(formatQuote("hello")).toBe("> hello")
})

test("multi-line preserves blank lines", () => {
  expect(formatQuote("a\n\nb")).toBe("> a\n>\n> b")
})

test("CRLF normalized", () => {
  expect(formatQuote("a\r\nb")).toBe("> a\n> b")
})

test("leading/trailing blank lines removed, indentation preserved", () => {
  expect(formatQuote("\n  const x = 1\n\n")).toBe(">   const x = 1")
})

test("whitespace-only returns empty", () => {
  expect(formatQuote("  \n ")).toBe("")
})

test("truncates with a visible marker", () => {
  const out = formatQuote("x".repeat(QUOTE_MAX_CHARS + 1))
  expect(out.split("\n").at(-1)).toBe("> …（引用已截断）")
  expect(out.length).toBeGreaterThan(QUOTE_MAX_CHARS)
})

test("truncation never splits a surrogate pair", () => {
  const out = formatQuote("a😀😀", { maxChars: 2 })
  expect(out.startsWith("> a😀")).toBe(true)
  expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
})

test("Chinese text", () => {
  expect(formatQuote("为什么这样写？")).toBe("> 为什么这样写？")
})

test("appendQuote preserves draft and adds spacing", () => {
  expect(appendQuote("", "> q")).toBe("> q\n\n")
  expect(appendQuote("draft  ", "> q")).toBe("draft\n\n> q\n\n")
  expect(appendQuote("  \n", "> q")).toBe("> q\n\n")
})
