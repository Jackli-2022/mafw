import { describe, expect, test } from "bun:test"
import { enqueueTurn, removeTurnAt, takeFirstTurn, type QueuedTurn } from "./turn-queue"

const t = (text: string): QueuedTurn => ({ text, atts: [], agents: [] })

describe("turn queue", () => {
  test("enqueue appends and preserves order (FIFO)", () => {
    const q = enqueueTurn(enqueueTurn([], t("a")), t("b"))
    expect(q.map(x => x.text)).toEqual(["a", "b"])
  })

  test("enqueue does not mutate the input list", () => {
    const orig: QueuedTurn[] = []
    enqueueTurn(orig, t("x"))
    expect(orig).toEqual([])
  })

  test("takeFirstTurn returns head and rest", () => {
    const q = [t("a"), t("b"), t("c")]
    const { first, rest } = takeFirstTurn(q)
    expect(first?.text).toBe("a")
    expect(rest.map(x => x.text)).toEqual(["b", "c"])
    expect(q).toHaveLength(3) // source untouched
  })

  test("takeFirstTurn on empty list returns null and empty rest", () => {
    const { first, rest } = takeFirstTurn([])
    expect(first).toBeNull()
    expect(rest).toEqual([])
  })

  test("removeTurnAt drops only the targeted index", () => {
    const q = [t("a"), t("b"), t("c")]
    expect(removeTurnAt(q, 1).map(x => x.text)).toEqual(["a", "c"])
    expect(removeTurnAt(q, 99)).toEqual(q) // out of range is a no-op
  })
})
