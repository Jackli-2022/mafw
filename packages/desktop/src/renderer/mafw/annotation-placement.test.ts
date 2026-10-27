import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { placeAnnotationBox } from "./annotation-placement"

const anchor = (left: number, top: number, width = 200, height = 18) => ({ left, top, width, height })

describe("placeAnnotationBox（批注框锚点旁智能定位）", () => {
  test("下方放得下 → below，左对齐锚点", () => {
    assert.deepEqual(placeAnnotationBox(anchor(100, 100), { w: 300, h: 160 }, { w: 600, h: 500 }), {
      left: 100,
      top: 126,
      placement: "below",
    })
  })
  test("下方不足 → above", () => {
    assert.deepEqual(placeAnnotationBox(anchor(100, 400), { w: 300, h: 160 }, { w: 600, h: 500 }), {
      left: 100,
      top: 232,
      placement: "above",
    })
  })
  test("水平越界 → clamp 到右边距", () => {
    const p = placeAnnotationBox(anchor(500, 100), { w: 300, h: 160 }, { w: 600, h: 500 })
    assert.equal(p.left, 600 - 300 - 8)
    assert.equal(p.placement, "below")
  })
  test("上下都不足 → 右侧", () => {
    const p = placeAnnotationBox(anchor(50, 150, 40, 20), { w: 200, h: 160 }, { w: 600, h: 300 })
    assert.equal(p.placement, "right")
    assert.equal(p.left, 98)
  })
  test("右侧不足 → 左侧", () => {
    const p = placeAnnotationBox(anchor(400, 150, 40, 20), { w: 200, h: 160 }, { w: 600, h: 300 })
    assert.equal(p.placement, "left")
    assert.equal(p.left, 400 - 200 - 8)
  })
  test("四面都放不下 → 取空间大的一侧并 clamp（允许压住锚点）", () => {
    const p = placeAnnotationBox(anchor(50, 120, 200, 18), { w: 500, h: 260 }, { w: 400, h: 300 })
    assert.equal(p.left, 8)
    assert.ok(p.top >= 8 && p.top <= 300 - 260 - 8)
  })
})
