import { expect, test } from "bun:test"
import { shouldInvokeNavigate } from "./tool-error-link"

const base = { button: 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }

test("href wins over onNavigate", () => {
  expect(shouldInvokeNavigate({ ...base, href: "/x" })).toBe(false)
})

test("plain primary click without href invokes onNavigate", () => {
  expect(shouldInvokeNavigate(base)).toBe(true)
})

test("modified or non-primary clicks are ignored", () => {
  expect(shouldInvokeNavigate({ ...base, button: 1 })).toBe(false)
  expect(shouldInvokeNavigate({ ...base, button: 2 })).toBe(false)
  expect(shouldInvokeNavigate({ ...base, ctrlKey: true })).toBe(false)
  expect(shouldInvokeNavigate({ ...base, metaKey: true })).toBe(false)
  expect(shouldInvokeNavigate({ ...base, altKey: true })).toBe(false)
  expect(shouldInvokeNavigate({ ...base, shiftKey: true })).toBe(false)
})
