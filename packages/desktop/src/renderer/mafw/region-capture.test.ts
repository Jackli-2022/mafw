import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { cropBox, dragRectPx } from "./region-capture"

describe("dragRectPx（图片拖框 px 逻辑）", () => {
  test("正向拖拽", () => {
    assert.deepEqual(dragRectPx(10, 20, 110, 70, 200, 100), { left: 10, top: 20, w: 100, h: 50 })
  })
  test("反向拖拽归一", () => {
    assert.deepEqual(dragRectPx(110, 70, 10, 20, 200, 100), { left: 10, top: 20, w: 100, h: 50 })
  })
  test("小于 8px 视为误触 → null", () => {
    assert.equal(dragRectPx(10, 10, 14, 17, 200, 100), null)
    assert.equal(dragRectPx(10, 10, 10, 10, 200, 100), null)
  })
  test("越界 clamp 到图片盒", () => {
    assert.deepEqual(dragRectPx(-10, -10, 300, 300, 200, 100), { left: 0, top: 0, w: 200, h: 100 })
  })
})

describe("cropBox（归一化区域 → 原图像素）", () => {
  test("常规区域", () => {
    assert.deepEqual(cropBox({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 400, 200), { sx: 100, sy: 100, sw: 200, sh: 50 })
  })
  test("clamp 越界 + 最小 1px", () => {
    assert.deepEqual(cropBox({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 100, 100), { sx: 90, sy: 90, sw: 10, sh: 10 })
    const tiny = cropBox({ x: 0, y: 0, w: 0.001, h: 0.001 }, 100, 100)
    assert.equal(tiny.sw, 1)
    assert.equal(tiny.sh, 1)
  })
})
