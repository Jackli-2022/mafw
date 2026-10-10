import { describe, expect, test } from "bun:test"
import { ruleSections } from "./rule-model"

const kvRows = (secs: any[]) => (secs[0] as any).rows as Array<[string, string]>

describe("ruleSections 按工具分派", () => {
  test("list_automation_rules → 读 .rules", () => {
    const secs = ruleSections("mafw_list_automation_rules", JSON.stringify({
      rules: [{ id: "r1", name: "每日衰减", enabled: true, trigger: { schedule: "0 3 * * *" } }], count: 1,
    }))
    const items = (secs[0] as any).items
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe("每日衰减")
    expect(items[0].badge).toBe("ON")
  })
  test("list_triage_items → 读 .items，severity 徽标", () => {
    const secs = ruleSections("mafw_list_triage_items", JSON.stringify({ items: [{ id: "t1", summary: "S", severity: "high" }] }))
    expect((secs[0] as any).items[0].badge).toBe("high")
    expect((secs[0] as any).items[0].badgeTone).toBe("err")
  })
  test("get_automation_history → 读 .history", () => {
    const secs = ruleSections("mafw_get_automation_history", JSON.stringify({ history: [{ id: "e1", status: "ok" }], count: 1 }))
    expect((secs[0] as any).items).toHaveLength(1)
  })
  test("get_automation_rule → 单对象 KV", () => {
    const secs = ruleSections("mafw_get_automation_rule", JSON.stringify({ id: "r1", name: "n", enabled: false, trigger: { schedule: "0 1 * * *" } }))
    expect(kvRows(secs).map((r) => r[0])).toContain("名称")
    expect(kvRows(secs).find((r) => r[0] === "启用")?.[1]).toBe("否")
  })
  test("get_triage_item → 单对象 KV", () => {
    const secs = ruleSections("mafw_get_triage_item", JSON.stringify({ id: "t1", title: "T", status: "PENDING_CONFIRMATION" }))
    expect(kvRows(secs).map((r) => r[0])).toContain("标题")
  })
  test("validate_rule → 有效 + errors list + nextTriggers tags", () => {
    const secs = ruleSections("mafw_validate_rule", JSON.stringify({ valid: false, errors: ["bad cron"], nextTriggers: ["a", "b"] }))
    expect(kvRows(secs)[0]).toEqual(["有效", "否"])
    expect(secs.some((x: any) => x.kind === "list")).toBe(true)
    expect(secs.some((x: any) => x.kind === "tags")).toBe(true)
  })
  test("draft_automation_rule → id/有效/启用", () => {
    const secs = ruleSections("mafw_draft_automation_rule", JSON.stringify({ id: "r9", valid: true, enabled: false, message: "ok" }))
    expect(kvRows(secs).map((r) => r[0])).toEqual(["id", "有效", "启用"])
  })
  test("run_automation / propose_triage_decision → status KV", () => {
    const a = ruleSections("mafw_run_automation", JSON.stringify({ status: "PENDING_CONFIRMATION", triage_id: "t1", message: "m" }))
    expect(kvRows(a).map((r) => r[0])).toEqual(["状态", "triage", "消息", "备注"])
    const b = ruleSections("mafw_propose_triage_decision", JSON.stringify({ status: "ok", message: "已记录" }))
    expect(kvRows(b)[0]).toEqual(["状态", "ok"])
  })
  test("非 JSON → raw code；未知工具 → generic 兜底", () => {
    expect(ruleSections("mafw_run_automation", "oops")[0]).toEqual({ kind: "code", text: "oops" })
    expect(ruleSections("mafw_unknown", JSON.stringify({ a: 1 }))[0].kind).toBe("kv")
  })
})
