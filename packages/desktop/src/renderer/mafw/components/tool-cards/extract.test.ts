import { describe, expect, test } from "bun:test"
import { TOOL_SPECS, parseOut, trunc, s } from "./extract"

describe("helpers", () => {
  test("parseOut：合法 JSON 解析，非法/空 → undefined", () => {
    expect(parseOut('{"a":1}')).toEqual({ a: 1 })
    expect(parseOut("not json")).toBeUndefined()
    expect(parseOut(undefined)).toBeUndefined()
    expect(parseOut("")).toBeUndefined()
  })
  test("trunc：超长截断加省略号", () => {
    expect(trunc("abcdef", 3)).toBe("abc…")
    expect(trunc("ab", 3)).toBe("ab")
    expect(trunc(undefined, 3)).toBe("")
  })
  test("s：缺失值回退", () => {
    expect(s(undefined)).toBe("-")
    expect(s(null)).toBe("-")
    expect(s("")).toBe("-")
    expect(s(0)).toBe("0")
    expect(s(undefined, 200)).toBe("200")
  })
})

describe("memory-write specs", () => {
  test("mafw_supersede_memory：ids 列表 + reason", () => {
    const secs = TOOL_SPECS.mafw_supersede_memory.extract(
      { ids: ["mem_1", "mem_2"], reason: "过期" }, undefined)
    expect(secs[0].kind).toBe("kv")
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[0][1]).toBe("mem_1, mem_2")
    expect(rows[1][1]).toBe("过期")
  })
  test("mafw_supersede_memory：字段缺失 fail-soft", () => {
    const secs = TOOL_SPECS.mafw_supersede_memory.extract({}, undefined)
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[0][1]).toBe("-")
  })
  test("mafw_pin_memory：sticky 上板徽标", () => {
    const secs = TOOL_SPECS.mafw_pin_memory.extract(
      { id: "mem_abc", sticky: true, stickyDays: 3 }, undefined)
    const tags = secs.find((x) => x.kind === "tags") as any
    expect(tags.items.join(" ")).toContain("sticky 3 天")
  })
  test("mafw_merge_memory：output JSON 提取统计", () => {
    const secs = TOOL_SPECS.mafw_merge_memory.extract(
      { sourceWorktree: "/tmp/wt" },
      JSON.stringify({ extracted: 5, conflicts: 2 }))
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows.map((r) => r[0])).toContain("提取")
    expect(rows.map((r) => r[0])).toContain("冲突")
  })
  test("mafw_merge_memory：畸形 output 降级 raw code 段", () => {
    const secs = TOOL_SPECS.mafw_merge_memory.extract({ sourceWorktree: "/tmp/wt" }, "oops")
    expect(secs.some((x) => x.kind === "code" && (x as any).text === "oops")).toBe(true)
  })
  test("mafw_resolve_merge：三字段 KV", () => {
    const secs = TOOL_SPECS.mafw_resolve_merge.extract(
      { conflictingId: "mem_x", newAbstraction: "合并摘要", action: "merge" }, undefined)
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[2]).toEqual(["动作", "merge"])
  })
  test("mafw_commit_heuristic：pattern 文本 + triggerContext tags", () => {
    const secs = TOOL_SPECS.mafw_commit_heuristic.extract(
      { pattern: "总是先跑测试", triggerContext: ["tdd", "test"] }, undefined)
    expect(secs[0]).toEqual({ kind: "text", text: "总是先跑测试" })
    expect((secs[1] as any).items).toEqual(["tdd", "test"])
  })
})

describe("memory-read specs", () => {
  test("mafw_get_memory：KV + anchors + 全文段", () => {
    const mem = {
      id: "mem_abc", type: "semantic", energy: 0.9,
      cue_anchors: ["tdd", "发布"], memory_value: "用户偏好 TDD",
    }
    const secs = TOOL_SPECS.mafw_get_memory.extract({ id: "mem_abc" }, JSON.stringify(mem))
    const kv = secs[0] as any
    expect(kv.rows.map((r: any) => r[0])).toEqual(["id", "类型", "能量", "pinned", "sticky"])
    expect((secs[1] as any).items).toEqual(["tdd", "发布"])
    expect((secs[2] as any).text).toBe("用户偏好 TDD")
  })
  test("mafw_get_memory：superseded 警告行", () => {
    const secs = TOOL_SPECS.mafw_get_memory.extract({}, JSON.stringify({ id: "m1", superseded_by: "m2" }))
    const warn = secs.find((x) => x.kind === "text") as any
    expect(warn.tone).toBe("warn")
    expect(warn.text).toContain("m2")
  })
  test("mafw_get_memory：非 JSON output 降级 raw", () => {
    const secs = TOOL_SPECS.mafw_get_memory.extract({}, "plain text")
    expect(secs[0]).toEqual({ kind: "code", text: "plain text" })
  })
  test("mafw_get_axioms：数组 → list 带能量徽标", () => {
    const secs = TOOL_SPECS.mafw_get_axioms.extract({}, JSON.stringify([
      { pattern: "先验证再宣称完成", energy: 0.85 },
      { primary_abstraction: "子代理不写记忆", energy: 0.6 },
    ]))
    const items = (secs[0] as any).items
    expect(items[0].title).toBe("先验证再宣称完成")
    expect(items[0].badge).toBe("E:0.8")
    expect(items[1].title).toBe("子代理不写记忆")
  })
  test("mafw_get_axioms：{axioms:[...]} 信封兼容", () => {
    const secs = TOOL_SPECS.mafw_get_axioms.extract({}, JSON.stringify({ axioms: [{ pattern: "p", energy: 1 }] }))
    expect((secs[0] as any).items).toHaveLength(1)
  })
})

describe("goal specs", () => {
  test("mafw_create_goal：KV 五字段", () => {
    const secs = TOOL_SPECS.mafw_create_goal.extract(
      { goalId: "003-foo", title: "做卡片", priority: "high", maxLoops: 5,
        budget: { maxTurns: 30, maxCostUsd: 2 } }, undefined)
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[0]).toEqual(["Goal", "003-foo"])
    expect(rows[4]).toEqual(["预算", "30 轮 / $2"])
  })
  test("mafw_get_goal_status：解析 output 阶段/判定", () => {
    const secs = TOOL_SPECS.mafw_get_goal_status.extract(
      { goalId: "g1" }, JSON.stringify({ goalId: "g1", phase: "EXECUTING", verdict: "PASS", loopNum: 2 }))
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[1]).toEqual(["阶段", "EXECUTING"])
    expect(rows[2]).toEqual(["判定", "PASS"])
  })
  test("mafw_list_goals：list + verdict 着色", () => {
    const secs = TOOL_SPECS.mafw_list_goals.extract({}, JSON.stringify([
      { goalId: "g1", title: "A", phase: "EXECUTING" },
      { goalId: "g2", title: "B", verdict: "FAILED" },
    ]))
    const items = (secs[0] as any).items
    expect(items).toHaveLength(2)
    expect(items[0].badge).toBe("EXECUTING")
    expect(items[1].badgeTone).toBe("err")
  })
  test("mafw_get_evidence：长文本 code 段截断", () => {
    const long = "x".repeat(5000)
    const secs = TOOL_SPECS.mafw_get_evidence.extract({ goalId: "g1" }, long)
    expect(secs[0].kind).toBe("code")
    expect((secs[0] as any).text.length).toBeLessThan(4200)
  })
  test("mafw_update_state：goalId + patch code 段", () => {
    const secs = TOOL_SPECS.mafw_update_state.extract(
      { goalId: "g1", patch: { loopNum: 3 } }, undefined)
    expect((secs[0] as any).rows[0]).toEqual(["Goal", "g1"])
    expect((secs[1] as any).text).toContain("loopNum")
  })
  test("mafw_load_state：output pretty code 段", () => {
    const secs = TOOL_SPECS.mafw_load_state.extract(
      { goalId: "g1" }, JSON.stringify({ goalId: "g1", loopNum: 1 }))
    expect(secs[0].kind).toBe("code")
    expect((secs[0] as any).text).toContain("loopNum")
  })
  test("mafw_answer_question：questionId + answer", () => {
    const secs = TOOL_SPECS.mafw_answer_question.extract(
      { goalId: "g1", questionId: "q9", answer: "选 A" }, undefined)
    const rows = (secs[0] as any).rows as Array<[string, string]>
    expect(rows[1]).toEqual(["问题", "q9"])
    expect(rows[2]).toEqual(["回答", "选 A"])
  })
  test("mafw_list_pending_questions：list 带 goalId 徽标", () => {
    const secs = TOOL_SPECS.mafw_list_pending_questions.extract({}, JSON.stringify([
      { id: "q1", question: "继续吗？", goalId: "g1" },
    ]))
    const items = (secs[0] as any).items
    expect(items[0].title).toBe("继续吗？")
    expect(items[0].badge).toBe("g1")
  })
  test("mafw_set_goal / mafw_cancel_goal：KV", () => {
    const a = TOOL_SPECS.mafw_set_goal.extract({ goalId: "g1", title: "T" }, undefined)
    expect((a[0] as any).rows[0]).toEqual(["Goal", "g1"])
    const b = TOOL_SPECS.mafw_cancel_goal.extract({ goalId: "g1" }, "cancelled")
    expect((b[0] as any).rows[0]).toEqual(["Goal", "g1"])
  })
})
