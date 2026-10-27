import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { popoverTop } from "./popover-pos"

describe("popoverTop（M6：空间不足翻到锚点上方）", () => {
  test("下方放得下 → 原位", () => {
    assert.equal(popoverTop(100, 160, 600), 100)
  })
  test("下方放不下 → 翻上（锚点高度按 24px 估算）", () => {
    assert.equal(popoverTop(500, 160, 600), 316)
  })
  test("上方也放不下 → 贴顶 8px", () => {
    assert.equal(popoverTop(120, 400, 300), 8)
  })
  test("容器未知（0）→ 保持并按 8px 下限", () => {
    assert.equal(popoverTop(2, 160, 0), 8)
  })
})
