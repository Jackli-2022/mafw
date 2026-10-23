import { expect, test } from "bun:test"
import { sameQuoteSelection, snapshotQuoteSelection } from "./quote-selection"

const sel = (text: string, anchorNode: unknown, anchorOffset: number, focusNode: unknown, focusOffset: number) => ({
  toString: () => text,
  anchorNode,
  anchorOffset,
  focusNode,
  focusOffset,
})

test("same selection snapshot stays suppressed", () => {
  const node = {}
  const s = sel("hello", node, 1, node, 5)
  const snap = snapshotQuoteSelection(s as any)
  expect(sameQuoteSelection(s as any, snap)).toBe(true)
})

test("new text / node / offsets are not the suppressed selection", () => {
  const a = {}
  const b = {}
  const snap = snapshotQuoteSelection(sel("hello", a, 1, a, 5) as any)
  expect(sameQuoteSelection(sel("hello!", a, 1, a, 5) as any, snap)).toBe(false)
  expect(sameQuoteSelection(sel("hello", b, 1, b, 5) as any, snap)).toBe(false)
  expect(sameQuoteSelection(sel("hello", a, 2, a, 5) as any, snap)).toBe(false)
  expect(sameQuoteSelection(sel("hello", a, 1, a, 4) as any, snap)).toBe(false)
})

test("no suppression snapshot", () => {
  expect(sameQuoteSelection(sel("hello", {}, 0, {}, 0) as any, null)).toBe(false)
})
