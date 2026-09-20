import { describe, expect, test } from "bun:test"
import { handleDiffEvent, type DiffDeps } from "./diff"
import type { ShellEventDeps } from "../dispatcher"

function makeDeps() {
  const calls: { name: string; args: unknown[] }[] = []
  const rec = (name: string) => (...args: unknown[]) => { calls.push({ name, args }) }
  const diff: DiffDeps = { trace: rec("trace"), setSessionDiff: rec("setSessionDiff") }
  return { deps: { diff } as unknown as ShellEventDeps, calls }
}

describe("handleDiffEvent", () => {
  test("session.diff → setSessionDiff（properties.diff 数组），消费", () => {
    const { deps, calls } = makeDeps()
    const ok = handleDiffEvent({ type: "session.diff", sessionID: "s1", properties: { diff: [{ file: "x.txt" }] } }, "s1", deps)
    expect(ok).toBe(true)
    expect(calls.find(c => c.name === "setSessionDiff")!.args).toEqual(["s1", [{ file: "x.txt" }]])
  })

  test("顶层 diff 形态（无 properties 壳）也可取", () => {
    const { deps, calls } = makeDeps()
    handleDiffEvent({ type: "session.diff", sessionID: "s1", diff: [{ file: "y.txt" }] }, "s1", deps)
    expect(calls.find(c => c.name === "setSessionDiff")!.args[1]).toEqual([{ file: "y.txt" }])
  })

  test("非数组 → 空数组兜底，仍消费", () => {
    const { deps, calls } = makeDeps()
    const ok = handleDiffEvent({ type: "session.diff", sessionID: "s1", properties: {} }, "s1", deps)
    expect(ok).toBe(true)
    expect(calls.find(c => c.name === "setSessionDiff")!.args[1]).toEqual([])
  })

  test("其他类型 → false", () => {
    const { deps } = makeDeps()
    expect(handleDiffEvent({ type: "session.idle" }, "s1", deps)).toBe(false)
  })
})
