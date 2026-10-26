import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { navigationPlan } from "./navigation-plan"

describe("browser navigation plan", () => {
  test("已有 webview → loadURL（不再依赖 src）", () => {
    assert.deepEqual(navigationPlan(true), { create: false, useSrc: false })
  })
  test("首次导航 → 创建并用 src（避免 attach 前 loadURL 抛错）", () => {
    assert.deepEqual(navigationPlan(false), { create: true, useSrc: true })
  })
})
