import { expect, test } from "bun:test"
import { applyReadlineKey } from "./composer-readline"

const S = (value: string, start: number, end = start) => ({ value, start, end })

test("Ctrl+A to line start", () => {
  expect(applyReadlineKey(S("abc def\nghi", 6), "a", { ctrl: true })).toEqual(S("abc def\nghi", 0))
  expect(applyReadlineKey(S("abc\ndef", 6), "a", { ctrl: true })).toEqual(S("abc\ndef", 4))
})

test("Ctrl+E to line end", () => {
  expect(applyReadlineKey(S("abc def\nghi", 6), "e", { ctrl: true })).toEqual(S("abc def\nghi", 7))
  expect(applyReadlineKey(S("abc\ndef", 6), "e", { ctrl: true })).toEqual(S("abc\ndef", 7))
})

test("Ctrl+B/F move one char and clamp", () => {
  expect(applyReadlineKey(S("abc", 1), "b", { ctrl: true })).toEqual(S("abc", 0))
  expect(applyReadlineKey(S("abc", 1), "f", { ctrl: true })).toEqual(S("abc", 2))
  expect(applyReadlineKey(S("abc", 0), "b", { ctrl: true })).toEqual(S("abc", 0))
  expect(applyReadlineKey(S("abc", 3), "f", { ctrl: true })).toEqual(S("abc", 3))
})

test("Ctrl+K kills to line end (keeps newline)", () => {
  expect(applyReadlineKey(S("abc def\nghi", 4), "k", { ctrl: true })).toEqual(S("abc \nghi", 4))
})

test("Ctrl+U kills to line start", () => {
  expect(applyReadlineKey(S("abc def\nghi", 10), "u", { ctrl: true })).toEqual(S("abc def\ni", 8))
  expect(applyReadlineKey(S("abc def", 6), "u", { ctrl: true })).toEqual(S("f", 0))
})

test("Ctrl+W deletes previous word", () => {
  expect(applyReadlineKey(S("abc def", 7), "w", { ctrl: true })).toEqual(S("abc ", 4))
  expect(applyReadlineKey(S("abc   ", 6), "w", { ctrl: true })).toEqual(S("", 0))
})

test("Ctrl+T transposes around caret / at end", () => {
  expect(applyReadlineKey(S("abc", 2), "t", { ctrl: true })).toEqual(S("acb", 3))
  expect(applyReadlineKey(S("abc", 3), "t", { ctrl: true })).toEqual(S("acb", 3))
  expect(applyReadlineKey(S("a", 1), "t", { ctrl: true })).toBeNull()
  expect(applyReadlineKey(S("a\nb", 2), "t", { ctrl: true })).toBeNull()
  expect(applyReadlineKey(S("abc", 0), "t", { ctrl: true })).toBeNull()
})

test("kill commands delete a non-empty selection first", () => {
  expect(applyReadlineKey(S("abcdef", 1, 4), "k", { ctrl: true })).toEqual(S("aef", 1))
  expect(applyReadlineKey(S("abcdef", 1, 4), "u", { ctrl: true })).toEqual(S("aef", 1))
  expect(applyReadlineKey(S("abcdef", 1, 4), "w", { ctrl: true })).toEqual(S("aef", 1))
})

test("movement collapses a selection", () => {
  expect(applyReadlineKey(S("abcdef", 1, 4), "b", { ctrl: true })).toEqual(S("abcdef", 1))
  expect(applyReadlineKey(S("abcdef", 1, 4), "f", { ctrl: true })).toEqual(S("abcdef", 4))
})

test("Alt+B/F move by word", () => {
  expect(applyReadlineKey(S("abc def ghi", 8), "b", { alt: true })).toEqual(S("abc def ghi", 4))
  expect(applyReadlineKey(S("abc def ghi", 4), "f", { alt: true })).toEqual(S("abc def ghi", 7))
})

test("returns null without ctrl/alt, or with meta/shift/ctrl+alt", () => {
  expect(applyReadlineKey(S("abc", 1), "a", {})).toBeNull()
  expect(applyReadlineKey(S("abc", 1), "a", { ctrl: true, meta: true })).toBeNull()
  expect(applyReadlineKey(S("abc", 1), "a", { ctrl: true, shift: true })).toBeNull()
  expect(applyReadlineKey(S("abc", 1), "a", { ctrl: true, alt: true })).toBeNull()
  expect(applyReadlineKey(S("abc", 1), "q", { ctrl: true })).toBeNull()
})
