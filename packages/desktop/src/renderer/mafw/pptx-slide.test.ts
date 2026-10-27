import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { slideIndexOf } from "./pptx-slide"

const fake = (classes: string[]) => ({ classList: classes }) as unknown as HTMLElement

describe("slideIndexOf（M5：优先用库给的后缀页码）", () => {
  test("解析 pptx-preview-slide-wrapper-<N>（0-based → 1-based）", () => {
    const el = fake(["pptx-preview-slide-wrapper", "pptx-preview-slide-wrapper-1"])
    assert.equal(slideIndexOf(el, []), 2)
  })
  test("无后缀 → 回退 DOM 顺序", () => {
    const a = fake(["pptx-preview-slide-wrapper"])
    const b = fake(["pptx-preview-slide-wrapper"])
    assert.equal(slideIndexOf(b, [a, b]), 2)
  })
  test("都解析不到 → 0（调用方跳过）", () => {
    assert.equal(slideIndexOf(fake([]), []), 0)
  })
})
