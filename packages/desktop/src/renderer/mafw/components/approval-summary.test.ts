import { describe, test, expect } from "bun:test"
import { summarizeApprovals } from "./approval-summary"

const perm = (status: string) => ({ kind: "permission", data: { status } })
const ask = () => ({ kind: "ask", data: { status: "pending" } })

describe("summarizeApprovals", () => {
  test("无审批卡返回 null（提问卡不算）", () => {
    expect(summarizeApprovals([])).toBeNull()
    expect(summarizeApprovals([ask()])).toBeNull()
    expect(summarizeApprovals(null)).toBeNull()
  })

  test("单张 pending：一行待批准，默认展开", () => {
    const r = summarizeApprovals([perm("pending")])!
    expect(r.text).toBe("🛡 1 项待批准")
    expect(r.hasPending).toBe(true)
    expect(r.total).toBe(1)
  })

  test("pending + 已处理合并一行", () => {
    const r = summarizeApprovals([perm("pending"), perm("allowed-always"), perm("denied")])!
    expect(r.text).toBe("🛡 1 项待批准 · 已批准 ×1 · 已拒绝 ×1")
    expect(r.hasPending).toBe(true)
    expect(r.total).toBe(3)
  })

  test("全处理完：折叠态汇总", () => {
    const r = summarizeApprovals([perm("allowed-once"), perm("allowed-always")])!
    expect(r.text).toBe("🛡 已批准 ×2")
    expect(r.hasPending).toBe(false)
  })

  test("expired 计入拒绝侧", () => {
    const r = summarizeApprovals([perm("expired")])!
    expect(r.text).toBe("🛡 已拒绝 ×1")
  })

  test("混合审批卡与提问卡：只统计审批卡", () => {
    const r = summarizeApprovals([ask(), perm("pending"), ask()])!
    expect(r.total).toBe(1)
    expect(r.text).toBe("🛡 1 项待批准")
  })
})
