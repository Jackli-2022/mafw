// W0-2（2026-10-28）：fork/revert 动作按 sessionBranchApi 能力门显隐。
// 语义对齐 CheckpointOverlay.conversationAvailable：undefined（caps 未加载）
// 不隐藏（opencode 零行为变化）；仅显式 false 的 runtime 隐藏。
import { describe, expect, test } from "bun:test"
import { branchActionsVisible } from "./branch-actions"

describe("branchActionsVisible", () => {
  test("caps 未加载（undefined）时保持显示", () => {
    expect(branchActionsVisible(undefined)).toBe(true)
  })
  test("sessionBranchApi=true 显示", () => {
    expect(branchActionsVisible({ sessionBranchApi: true })).toBe(true)
  })
  test("sessionBranchApi=false 隐藏", () => {
    expect(branchActionsVisible({ sessionBranchApi: false })).toBe(false)
  })
  test("sessionBranchApi 缺失（其他能力存在）按未加载处理，显示", () => {
    expect(branchActionsVisible({ diffApi: true } as any)).toBe(true)
  })
})
