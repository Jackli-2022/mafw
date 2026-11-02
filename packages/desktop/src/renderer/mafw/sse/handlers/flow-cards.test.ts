import { describe, expect, test } from "bun:test"
import { handleFlowCardEvent, answersToRecord, mapAskCard, type FlowCardDeps } from "./flow-cards"
import type { ShellEventDeps } from "../dispatcher"

function makeDeps() {
  const calls: { name: string; args: unknown[] }[] = []
  const rec = (name: string) => (...args: unknown[]) => { calls.push({ name, args }) }
  const flowCards: FlowCardDeps = {
    upsertCard: rec("upsertCard"), resolveCard: rec("resolveCard"),
    setPermissionMode: rec("setPermissionMode"), setCompactionMark: rec("setCompactionMark"),
    notify: rec("notify"), trace: rec("trace"), scheduleReconcile: rec("scheduleReconcile"),
    agentTitleOf: () => "Agent",
    getAskCard: () => undefined,
  }
  const deps = { flowCards } as unknown as ShellEventDeps
  return { deps, calls }
}

describe("mapAskCard typed form", () => {
  test("preserves form/mode and typed field metadata", () => {
    const card = mapAskCard({
      id: "f1", sessionID: "s1", form: { id: "f1", fields: [{ type: "external" }] },
      questions: [
        { id: "count", question: "Count", type: "integer", required: true, minimum: 1, default: 2 },
        { id: "link", question: "Link", type: "external", url: "https://x" },
      ],
    }, 1, "Agent")
    expect(card.mode).toBe("url")
    expect(card.questions[0]).toMatchObject({
      id: "count", type: "integer", required: true, minimum: 1, defaultValue: 2,
    })
    expect(card.questions[1]).toMatchObject({ type: "external", url: "https://x", allowCustom: false })
  })
})

describe("handleFlowCardEvent", () => {
  test("question.asked → upsertCard(ask) + notify", () => {
    const { deps, calls } = makeDeps()
    const consumed = handleFlowCardEvent({ type: "question.asked", properties: { id: "q1", question: "哪个文件？" } }, "s1", deps)
    expect(consumed).toBe(true)
    expect(calls.map(c => c.name)).toEqual(["trace", "upsertCard", "notify"])
  })

  test("permission.asked 需人工 → notify；auto 兜底 → scheduleReconcile(5000)", () => {
    const { deps, calls } = makeDeps()
    handleFlowCardEvent({ type: "permission.asked", properties: { id: "p1", permission: "bash", tool: { messageID: "m1", callID: "c1" } } }, "s1", deps)
    expect(calls.map(c => c.name)).toContain("notify")

    const d2 = makeDeps()
    // mafwPolicy action auto-approve → autoResolved → 不 notify，走对账
    handleFlowCardEvent({ type: "permission.asked", properties: { id: "p2", permission: "bash", mafwPolicy: { action: "auto-approve", verdict: "safe", reason: "auto" } } }, "s1", d2.deps)
    expect(d2.calls.map(c => c.name)).not.toContain("notify")
    expect(d2.calls.find(c => c.name === "scheduleReconcile")!.args[0]).toBe(5000)
  })

  test("permission.replied always → allowed-always", () => {
    const { deps, calls } = makeDeps()
    handleFlowCardEvent({ type: "permission.replied", properties: { id: "p1", reply: "always" } }, "s1", deps)
    expect(calls.find(c => c.name === "resolveCard")!.args[2]).toEqual({ status: "allowed-always" })
  })

  test("permission.replied 用 canonical id 销账（pi 形状：id + requestId，无 reply）", () => {
    // 缺口 2：gateway 对 asked/replied 同一投影，pi replied 现在带 canonical `id`。
    const { deps, calls } = makeDeps()
    handleFlowCardEvent(
      { type: "permission.replied", properties: { id: "rq_1", requestId: "rq_1", approved: true } },
      "s1", deps,
    )
    const resolve = calls.find(c => c.name === "resolveCard")!
    expect(resolve.args.slice(0, 2)).toEqual(["s1", "rq_1"])
    expect(resolve.args[2]).toEqual({ status: "allowed-once" })
  })

  test("permission.replied canonical id 优先；旧 requestID 仍兜底（旧 gateway 载荷）", () => {
    const d1 = makeDeps()
    handleFlowCardEvent(
      { type: "permission.replied", properties: { id: "canonical", requestID: "legacy" } },
      "s1", d1.deps,
    )
    expect(d1.calls.find(c => c.name === "resolveCard")!.args[1]).toBe("canonical")

    const d2 = makeDeps()
    handleFlowCardEvent({ type: "permission.replied", properties: { requestID: "legacy" } }, "s1", d2.deps)
    expect(d2.calls.find(c => c.name === "resolveCard")!.args[1]).toBe("legacy")
  })

  test("permission.asked 通知正文用 canonical kind/targets（不再读 properties.permission.tool）", () => {
    const { deps, calls } = makeDeps()
    handleFlowCardEvent(
      { type: "permission.asked", properties: { id: "p9", kind: "bash", targets: ["rm -rf build"] } },
      "s1", deps,
    )
    const body = String(calls.find(c => c.name === "notify")!.args[1])
    expect(body).toContain("rm -rf build")
  })

  test("question.replied → answered + answersToRecord", () => {
    const { deps, calls } = makeDeps()
    const d = deps as ShellEventDeps
    // getAskCard 返回带问题的卡，验证 answers 映射
    d.flowCards.getAskCard = () => ({ id: "q1", questions: [{ id: "q1-q0" }, { id: "q1-q1" }] }) as any
    handleFlowCardEvent({ type: "question.replied", properties: { id: "q1", answers: [["a"], ["b"]] } }, "s1", d)
    expect(calls.find(c => c.name === "resolveCard")!.args[2]).toMatchObject({
      status: "answered",
      answers: { "q1-q0": ["a"], "q1-q1": ["b"] },
    })
  })

  test("permission_mode 三值解析；未知值回退 read-only", () => {
    const { deps, calls } = makeDeps()
    handleFlowCardEvent({ type: "permission_mode", sessionID: "s1", properties: { mode: "manual" } }, "s1", deps)
    expect(calls.find(c => c.name === "setPermissionMode")!.args).toEqual(["s1", "read-only"])

    const d2 = makeDeps()
    handleFlowCardEvent({ type: "permission_mode", sessionID: "s1", properties: { mode: "full-access" } }, "s1", d2.deps)
    expect(d2.calls.find(c => c.name === "setPermissionMode")!.args).toEqual(["s1", "full-access"])

    const d3 = makeDeps()
    handleFlowCardEvent({ type: "permission_mode", sessionID: "s1", properties: { mode: "yolo" } }, "s1", d3.deps)
    expect(d3.calls.find(c => c.name === "setPermissionMode")!.args).toEqual(["s1", "read-only"])
  })

  test("session.compacted → setCompactionMark", () => {
    const { deps, calls } = makeDeps()
    handleFlowCardEvent({ type: "session.compacted", properties: { summary: "s" } }, "s1", deps)
    expect(calls.map(c => c.name)).toContain("setCompactionMark")
  })

  test("unrelated type → not consumed", () => {
    const { deps } = makeDeps()
    expect(handleFlowCardEvent({ type: "plan.updated", properties: {} }, "s1", deps)).toBe(false)
  })
})

describe("answersToRecord (pure)", () => {
  test("maps positional answers onto question ids", () => {
    const card = { questions: [{ id: "a" }, { id: "b" }] } as any
    expect(answersToRecord([["x"], []], card)).toEqual({ a: ["x"], b: [] })
  })
  test("missing card → empty record", () => {
    expect(answersToRecord([["x"]], undefined)).toEqual({})
  })
})
