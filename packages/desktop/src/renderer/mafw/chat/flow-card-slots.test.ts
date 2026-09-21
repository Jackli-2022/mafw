import { describe, expect, test } from "bun:test"
import { turnOfMessage, cardsForTurn, unplacedCards } from "./flow-card-slots"

function mkStore(messages: Record<string, any[]>, parts: Record<string, any[]> = {}): any {
  return { message: messages, part: parts }
}
const partsOf = () => [] as any[]

describe("turnOfMessage", () => {
  test("user 消息归自身", () => {
    const store = mkStore({ s1: [{ id: "u1", role: "user", time: { created: 1 } }] })
    expect(turnOfMessage("u1", store, "s1")).toBe("u1")
  })
  test("assistant 经 parentID 归 turn", () => {
    const store = mkStore({ s1: [
      { id: "u1", role: "user", time: { created: 1 } },
      { id: "a1", role: "assistant", parentID: "u1", time: { created: 2 } },
    ] })
    expect(turnOfMessage("a1", store, "s1")).toBe("u1")
  })
  test("dangling parentID 原样返回（原行为：不回溯）", () => {
    const store = mkStore({ s1: [
      { id: "u1", role: "user", time: { created: 1 } },
      { id: "u2", role: "user", time: { created: 5 } },
      { id: "a9", role: "assistant", parentID: "missing", time: { created: 6 } },
    ] })
    expect(turnOfMessage("a9", store, "s1")).toBe("missing")
  })
  test("无 parentID 的 assistant 按时间向上找最近 user", () => {
    const store = mkStore({ s1: [
      { id: "u1", role: "user", time: { created: 1 } },
      { id: "u2", role: "user", time: { created: 5 } },
      { id: "a9", role: "assistant", time: { created: 6 } },
    ] })
    expect(turnOfMessage("a9", store, "s1")).toBe("u2")
  })
  test("未知消息返回 null", () => {
    const store = mkStore({ s1: [] })
    expect(turnOfMessage("nope", store, "s1")).toBeNull()
  })
})

describe("cardsForTurn", () => {
  test("带链接卡归对应 turn；无链接卡归最后一 turn", () => {
    const store = mkStore({ s1: [
      { id: "u1", role: "user", time: { created: 1 } },
      { id: "a1", role: "assistant", parentID: "u1", time: { created: 2 } },
    ] })
    const cards = [
      { kind: "ask", data: { id: "c1", messageID: "a1", createdAt: 1 } },
      { kind: "ask", data: { id: "c2", createdAt: 2 } },
    ] as any[]
    const forU1 = cardsForTurn(cards, "u1", store, "s1", partsOf, [{ id: "u1" }])
    expect(forU1.map((c) => c.data.id)).toEqual(["c1", "c2"])
  })
  test("有内联锚的卡被排除（防双重渲染）", () => {
    const store = mkStore(
      {
        s1: [
          { id: "u1", role: "user", time: { created: 1 } },
          { id: "a1", role: "assistant", parentID: "u1", time: { created: 2 } },
        ],
      },
      { a1: [{ type: "tool", callID: "x", tool: "bash", state: { status: "pending" } }] },
    )
    const cards = [{ kind: "ask", data: { id: "c1", messageID: "a1", callID: "x", createdAt: 1 } }] as any[]
    const partsOfReal = (mid: string) => store.part[mid] || []
    expect(cardsForTurn(cards, "u1", store, "s1", partsOfReal, [])).toEqual([])
  })
  test("非最后一 turn 不收无链接卡", () => {
    const store = mkStore({ s1: [
      { id: "u1", role: "user", time: { created: 1 } },
      { id: "u2", role: "user", time: { created: 5 } },
    ] })
    const cards = [{ kind: "ask", data: { id: "c1", createdAt: 1 } }] as any[]
    expect(cardsForTurn(cards, "u1", store, "s1", partsOf, [])).toEqual([])
    expect(cardsForTurn(cards, "u2", store, "s1", partsOf, [{ id: "u1" }, { id: "u2" }]).map((c) => c.data.id)).toEqual(["c1"])
  })
})

describe("unplacedCards", () => {
  test("有 user 消息时返回空", () => {
    const store = mkStore({ s1: [{ id: "u1", role: "user", time: { created: 1 } }] })
    expect(unplacedCards([{ kind: "ask", data: { id: "c1", createdAt: 1 } }] as any[], store, "s1", partsOf, [{ id: "u1" }])).toEqual([])
  })
  test("无 user 消息时全部落兜底", () => {
    const store = mkStore({ s1: [{ id: "a1", role: "assistant", time: { created: 2 } }] })
    const cards = [
      { kind: "ask", data: { id: "c1", createdAt: 1 } },
      { kind: "permission", data: { id: "c2", createdAt: 2 } },
    ] as any[]
    expect(unplacedCards(cards, store, "s1", partsOf, []).map((c) => c.data.id)).toEqual(["c1", "c2"])
  })
})
